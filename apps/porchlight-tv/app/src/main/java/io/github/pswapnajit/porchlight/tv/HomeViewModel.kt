package io.github.pswapnajit.porchlight.tv

import android.app.Application
import android.os.SystemClock
import android.util.Log
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

/** What Rose's TV is showing. */
sealed interface Screen {
    data object Connecting : Screen
    data object Ambient : Screen
    data class CheckInCard(val checkIn: CheckIn) : Screen
    data class VisitorCard(val visitor: Visitor) : Screen
    data class Thanks(val title: String, val body: String) : Screen
}

data class TvUi(
    val server: String = "",
    val home: HomeState? = null,
    /** SystemClock.elapsedRealtime() when [home] arrived, so the clock can run between updates. */
    val receivedAt: Long = 0,
    val connected: Boolean = false,
    val answering: Boolean = false,
    val error: String? = null,
    /** Check-ins answered on this TV. Some stay open on the server (heat clears only when the home cools), but Rose isn't asked twice. */
    val answered: Set<String> = emptySet(),
    val thanks: Screen.Thanks? = null,
    val visitorShownAt: Long? = null,
    val visitorDismissed: Long? = null,
    val visitorImage: ImageBitmap? = null,
) {
    /** The server's clock now: live time, or the simulated day at its demo speed. */
    fun serverNow(elapsed: Long): Long = home?.let { it.now + ((elapsed - receivedAt) * it.clockRate).toLong() } ?: System.currentTimeMillis()

    fun screen(elapsed: Long): Screen {
        val home = home ?: return Screen.Connecting
        thanks?.let { return it }
        home.checkIn?.takeIf { it.concernId !in answered }?.let { return Screen.CheckInCard(it) }
        val v = home.visitor
        val shownAt = visitorShownAt
        if (v != null && shownAt != null && v.at != visitorDismissed && elapsed - shownAt < VISITOR_CARD_MS) return Screen.VisitorCard(v)
        return Screen.Ambient
    }

    companion object {
        /** A doorbell card stays up for 90 seconds of real time, or until Rose presses OK or Back. */
        const val VISITOR_CARD_MS = 90_000L
    }
}

class HomeViewModel(app: Application) : AndroidViewModel(app) {
    private val _ui = MutableStateFlow(TvUi())
    val ui: StateFlow<TvUi> = _ui

    private val speaker = Speaker(app)
    private var api = PorchlightApi("")
    private var job: Job? = null
    private var refreshJob: Job? = null
    private var spokenCheckIn: String? = null
    private var seenVisitorAt: Long? = null

    /** Connects to a Porchlight server: the live event stream, plus a slow poll that keeps the clock honest. */
    fun connect(server: String) {
        if (server == _ui.value.server && job?.isActive == true) return
        job?.cancel()
        api.close()
        val client = PorchlightApi(server)
        api = client
        _ui.value = TvUi(server = server)
        Log.i(TAG, "Porchlight server: $server")
        job = viewModelScope.launch {
            launch(Dispatchers.IO) {
                while (isActive) {
                    try {
                        // Events arrive on this IO thread; all state changes happen on the main thread.
                        client.events(onOpen = { viewModelScope.launch { refreshSoon(0) } }, onEvent = { ev -> viewModelScope.launch { onEvent(ev) } })
                    } catch (e: Exception) {
                        if (!isActive) break
                        Log.i(TAG, "event stream ended: ${e.message}")
                    }
                    viewModelScope.launch { refreshSoon(0) }
                    delay(2_000)
                }
            }
            while (isActive) {
                refresh()
                delay(if ((_ui.value.home?.clockRate ?: 1.0) > 1.0) 5_000 else 30_000)
            }
        }
    }

    /** Rose pressed the big button on a check-in. */
    fun answer() {
        val c = _ui.value.home?.checkIn ?: return
        if (_ui.value.answering) return
        _ui.update { it.copy(answering = true, error = null) }
        viewModelScope.launch {
            val sent = withContext(Dispatchers.IO) { runCatching { if (c.isPackage) api.packageInside() else api.residentOk() } }
            sent.onFailure { e ->
                Log.w(TAG, "answer failed: ${e.message}")
                _ui.update { it.copy(answering = false, error = "Porchlight didn't hear that. Please press OK again.") }
                return@launch
            }
            speaker.stop()
            val name = _ui.value.home?.name.orEmpty()
            val thanks = if (c.isPackage) Screen.Thanks("Thank you, $name.", "Porchlight has noted that the package is inside.")
            else Screen.Thanks("Thank you, $name.", "Porchlight has noted that you're OK.")
            _ui.update { it.copy(answering = false, answered = it.answered + c.concernId, thanks = thanks) }
            speaker.say(thanks.title)
            refresh()
            delay(8_000)
            _ui.update { if (it.thanks == thanks) it.copy(thanks = null) else it }
        }
    }

    /** "I'm OK" from the ambient screen, with no check-in open: a sign of life, which also heads off a quiet-morning check-in. */
    fun imOk() {
        if (_ui.value.answering) return
        _ui.update { it.copy(answering = true, error = null) }
        viewModelScope.launch {
            val sent = withContext(Dispatchers.IO) { runCatching { api.residentOk() } }
            val name = _ui.value.home?.name.orEmpty()
            val thanks = Screen.Thanks("Thanks, $name.", "Have a lovely day.")
            _ui.update { if (sent.isSuccess) it.copy(answering = false, thanks = thanks) else it.copy(answering = false, error = "Porchlight didn't hear that. Please try again.") }
            if (sent.isFailure) return@launch
            delay(5_000)
            _ui.update { if (it.thanks == thanks) it.copy(thanks = null) else it }
        }
    }

    fun dismissVisitor() {
        speaker.stop()
        _ui.update { it.copy(visitorDismissed = it.home?.visitor?.at) }
    }

    private fun onEvent(ev: JSONObject) {
        when (ev.optString("type")) {
            // The family dashboard's API and activity logs: nothing on the TV changes.
            "api", "activity" -> return
            // Show a check-in or visitor at once, with the clock carried forward to now; the refresh below fills in the rest.
            "home" -> ev.optJSONObject("home")?.let { home ->
                val ui = _ui.value
                ui.home?.let { apply(it.withHome(home).copy(now = ui.serverNow(SystemClock.elapsedRealtime()))) }
            }
        }
        refreshSoon()
    }

    private fun refreshSoon(delayMs: Long = 300) {
        if (refreshJob?.isActive == true) return
        refreshJob = viewModelScope.launch {
            delay(delayMs)
            refresh()
        }
    }

    private suspend fun refresh() {
        val client = api
        val state = withContext(Dispatchers.IO) { runCatching { client.state() } }
        if (client !== api) return
        state.onSuccess(::apply).onFailure { e ->
            Log.i(TAG, "can't reach ${client.baseUrl}: ${e.message}")
            _ui.update { it.copy(connected = false) }
        }
    }

    private fun apply(home: HomeState) {
        val elapsed = SystemClock.elapsedRealtime()
        var next = _ui.value.copy(home = home, receivedAt = elapsed, connected = true)
        home.checkIn?.takeIf { it.concernId !in next.answered }?.let { c ->
            val key = c.concernId + c.text
            if (key != spokenCheckIn) {
                spokenCheckIn = key
                next = next.copy(error = null)
                speaker.say(c.tvText)
            }
        }
        val v = home.visitor
        if (v != null && v.at != seenVisitorAt) {
            seenVisitorAt = v.at
            // Only a ring from the last few minutes gets a card; an old one stays history.
            if (home.now - v.at < 10 * 60_000) {
                next = next.copy(visitorShownAt = elapsed, visitorImage = null)
                v.snapshotPath?.let { loadSnapshot(v.at, it) }
                if (home.checkIn == null) speaker.say(visitorSentence(v))
            }
        }
        _ui.value = next
    }

    private fun loadSnapshot(at: Long, path: String) {
        val client = api
        viewModelScope.launch {
            val bitmap = withContext(Dispatchers.IO) { runCatching { client.snapshot(path) }.getOrNull() }
            if (bitmap != null && _ui.value.home?.visitor?.at == at) _ui.update { it.copy(visitorImage = bitmap.asImageBitmap()) }
        }
    }

    override fun onCleared() {
        job?.cancel()
        api.close()
        speaker.shutdown()
    }

    private companion object {
        const val TAG = "Porchlight"
    }
}

fun visitorSentence(v: Visitor): String =
    if (v.expectedWho != null) "Someone rang the doorbell. ${v.expectedWho} is due at ${v.expectedTime}." else "Someone rang the doorbell."
