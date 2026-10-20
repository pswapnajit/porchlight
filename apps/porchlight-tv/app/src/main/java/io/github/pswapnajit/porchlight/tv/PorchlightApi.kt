package io.github.pswapnajit.porchlight.tv

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.time.ZoneId

/** The parts of GET /api/state that Rose's TV shows. */
data class HomeState(
    val mode: String,
    val now: Long,
    val zone: ZoneId,
    val name: String,
    val checkIn: CheckIn?,
    val visitor: Visitor?,
    val visits: List<CareVisit>,
    /** How fast the server's clock runs: 1 when live, the demo speed in the simulator, 0 while paused. */
    val clockRate: Double,
) {
    /** Applies the `home` object from a server-sent `{"type":"home"}` event. */
    fun withHome(home: JSONObject) = copy(
        checkIn = home.optJSONObject("message")?.let(::parseCheckIn),
        visitor = home.optJSONObject("visitor")?.let(::parseVisitor),
    )
}

data class CheckIn(val concernId: String, val kind: String, val text: String) {
    /** A package check-in is answered with "I brought it in", every other one with "I'm OK". */
    val isPackage get() = kind == "package_waiting"

    /** Check-ins are written for touchscreens (Tap "I'm OK"); on the TV it's the OK button on the remote. */
    val tvText get() = text.replace("Tap \"I'm OK\"", "Press OK")
}

/** The latest doorbell ring. [expectedWho] comes from the care schedule: who is due now, never who the camera saw. */
data class Visitor(val at: Long, val expectedWho: String?, val expectedTime: String?, val snapshotPath: String?)

data class CareVisit(val who: String, val days: List<Int>, val time: String)

/** A small client for the Porchlight server: HttpURLConnection and org.json only, nothing that needs Google Play Services. */
class PorchlightApi(val baseUrl: String) {
    @Volatile private var stream: HttpURLConnection? = null

    fun state(): HomeState = parseState(JSONObject(request("GET", "/api/state")))

    fun residentOk() {
        request("POST", "/api/resident/ok")
    }

    fun packageInside() {
        request("POST", "/api/resident/package-inside")
    }

    fun snapshot(path: String): Bitmap? {
        val conn = open(path)
        return try {
            conn.inputStream.use(BitmapFactory::decodeStream)
        } finally {
            conn.disconnect()
        }
    }

    /** Reads GET /api/events until the stream ends, passing each server-sent event to [onEvent]. */
    fun events(onOpen: () -> Unit, onEvent: (JSONObject) -> Unit) {
        val conn = open("/api/events", readTimeoutMs = 45_000) // the server sends a ping every 20 s
        stream = conn
        try {
            conn.setRequestProperty("Accept", "text/event-stream")
            check(conn.responseCode == 200) { "GET /api/events: HTTP ${conn.responseCode}" }
            onOpen()
            val data = StringBuilder()
            conn.inputStream.bufferedReader().forEachLine { line ->
                when {
                    line.startsWith("data:") -> data.append(line.removePrefix("data:").trimStart())
                    line.isEmpty() && data.isNotEmpty() -> {
                        runCatching { JSONObject(data.toString()) }.getOrNull()?.let(onEvent)
                        data.setLength(0)
                    }
                }
            }
        } finally {
            stream = null
            conn.disconnect()
        }
    }

    /** Ends a running [events] call. */
    fun close() {
        stream?.disconnect()
    }

    private fun open(path: String, readTimeoutMs: Int = 10_000): HttpURLConnection =
        (URL(baseUrl.trimEnd('/') + path).openConnection() as HttpURLConnection).apply {
            connectTimeout = 5_000
            readTimeout = readTimeoutMs
        }

    private fun request(method: String, path: String): String {
        val conn = open(path)
        try {
            conn.requestMethod = method
            if (method == "POST") {
                conn.doOutput = true
                conn.setRequestProperty("Content-Type", "application/json")
                conn.outputStream.use { it.write("{}".toByteArray()) }
            }
            val code = conn.responseCode
            val body = (if (code < 400) conn.inputStream else conn.errorStream)?.bufferedReader()?.use { it.readText() }.orEmpty()
            check(code < 400) { "$method $path: HTTP $code" }
            return body
        } finally {
            conn.disconnect()
        }
    }
}

internal fun parseState(j: JSONObject): HomeState {
    val household = j.getJSONObject("household")
    val home = j.optJSONObject("home")
    val sim = j.optJSONObject("sim")
    val schedule = household.optJSONArray("careSchedule")
    return HomeState(
        mode = j.optString("mode", "sim"),
        now = j.getLong("now"),
        zone = runCatching { ZoneId.of(j.getString("timeZone")) }.getOrElse { ZoneId.systemDefault() },
        name = household.getJSONObject("resident").optString("preferredName"),
        checkIn = home?.optJSONObject("message")?.let(::parseCheckIn),
        visitor = home?.optJSONObject("visitor")?.let(::parseVisitor),
        visits = (0 until (schedule?.length() ?: 0)).map { i ->
            val v = schedule!!.getJSONObject(i)
            val days = v.getJSONArray("days")
            CareVisit(v.getString("who"), (0 until days.length()).map(days::getInt), v.getString("time"))
        },
        clockRate = when {
            sim == null -> 1.0
            sim.optBoolean("paused") -> 0.0
            else -> sim.optDouble("speed", 1.0)
        },
    )
}

private fun parseCheckIn(m: JSONObject) = CheckIn(m.getString("concernId"), m.optString("kind"), m.getString("text"))

private fun parseVisitor(v: JSONObject): Visitor {
    val expected = v.optJSONObject("expected")
    return Visitor(
        at = v.getLong("at"),
        expectedWho = expected?.text("who"),
        expectedTime = expected?.text("time"),
        snapshotPath = v.optJSONObject("snapshot")?.text("url"),
    )
}

/** optString() turns JSON null into "null"; this returns null instead. */
private fun JSONObject.text(key: String): String? = if (isNull(key)) null else optString(key)
