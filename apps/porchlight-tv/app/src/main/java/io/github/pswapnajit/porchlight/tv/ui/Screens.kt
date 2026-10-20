package io.github.pswapnajit.porchlight.tv.ui

import android.os.SystemClock
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.tv.material3.Border
import androidx.tv.material3.Button
import androidx.tv.material3.ButtonDefaults
import androidx.tv.material3.Text
import io.github.pswapnajit.porchlight.tv.CheckIn
import io.github.pswapnajit.porchlight.tv.HomeState
import io.github.pswapnajit.porchlight.tv.Screen
import io.github.pswapnajit.porchlight.tv.TvUi
import io.github.pswapnajit.porchlight.tv.Visitor
import kotlinx.coroutines.delay
import java.time.Instant
import java.time.LocalTime
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.util.Locale

const val PRIVACY_LINE = "Your family can see if you're up and about, who rang the doorbell and when deliveries arrive. They can't see inside your home."

/** Rose's TV. Check-in first, then a doorbell card, otherwise the ambient clock. Nothing moves unless it has to. */
@Composable
fun PorchlightTv(ui: TvUi, onAnswer: () -> Unit, onImOk: () -> Unit, onDismissVisitor: () -> Unit) {
    val rate = ui.home?.clockRate ?: 1.0
    val elapsed by produceState(SystemClock.elapsedRealtime(), rate) {
        while (true) {
            value = SystemClock.elapsedRealtime()
            delay(if (rate > 1.0) 250 else 1_000)
        }
    }
    val screen = ui.screen(elapsed)
    val now = ui.home?.let { ZonedDateTime.ofInstant(Instant.ofEpochMilli(ui.serverNow(elapsed)), it.zone) }

    // Keep the TV awake while something needs Rose's attention; the ambient clock lets the screensaver come.
    val view = LocalView.current
    val needsAttention = screen is Screen.CheckInCard || screen is Screen.VisitorCard
    DisposableEffect(needsAttention) {
        view.keepScreenOn = needsAttention
        onDispose { }
    }
    BackHandler(enabled = screen is Screen.VisitorCard, onBack = onDismissVisitor)

    // Title-safe area: 5% of a 960x540 dp TV screen on each side.
    Box(Modifier.fillMaxSize().background(Palette.bg).padding(horizontal = 48.dp, vertical = 27.dp)) {
        // Cards keep clear of the status line in the top corner; the ambient screen lays out around it.
        Box(Modifier.fillMaxSize().padding(top = if (screen is Screen.Ambient) 0.dp else 36.dp)) {
            when (screen) {
                Screen.Connecting -> Connecting(ui)
                Screen.Ambient -> Ambient(ui.home!!, now!!, elapsed, ui, onImOk)
                is Screen.CheckInCard -> CheckInCard(screen.checkIn, ui, onAnswer)
                is Screen.VisitorCard -> VisitorCard(screen.visitor, ui, onDismissVisitor)
                is Screen.Thanks -> Thanks(screen)
            }
        }
        if (screen !is Screen.Connecting) {
            Row(Modifier.align(Alignment.TopEnd), verticalAlignment = Alignment.CenterVertically) {
                if (screen !is Screen.Ambient && now != null) Text(clock(now) + " " + amPm(now), fontSize = 24.sp, color = Palette.muted, modifier = Modifier.padding(end = 20.dp))
                Status(ui)
            }
        }
    }
}

@Composable
private fun Ambient(home: HomeState, now: ZonedDateTime, elapsed: Long, ui: TvUi, onImOk: () -> Unit) {
    // A static screen can burn into a TV panel, so the layout shifts by 8 dp every 10 minutes (no animation).
    val step = (elapsed / 600_000L % 4).toInt()
    val shift = Modifier.offset(x = if (step == 1 || step == 2) 8.dp else 0.dp, y = if (step >= 2) 8.dp else 0.dp)
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }
    Column(Modifier.fillMaxSize().then(shift), horizontalAlignment = Alignment.CenterHorizontally) {
        Spacer(Modifier.weight(1f))
        Row(verticalAlignment = Alignment.Bottom) {
            Text(clock(now), fontSize = 132.sp, lineHeight = 132.sp, fontWeight = FontWeight.Bold, color = Palette.ink)
            Text(" " + amPm(now), fontSize = 44.sp, fontWeight = FontWeight.SemiBold, color = Palette.muted, modifier = Modifier.padding(bottom = 18.dp))
        }
        Text(DateTimeFormatter.ofPattern("EEEE, MMMM d", Locale.US).format(now), fontSize = 32.sp, color = Palette.muted)
        Spacer(Modifier.height(22.dp))
        Text("${greeting(now)}, ${home.name}", fontSize = 50.sp, fontWeight = FontWeight.SemiBold, color = Palette.ink)
        todayLine(home, now)?.let {
            Spacer(Modifier.height(10.dp))
            Text(it, fontSize = 28.sp, color = Palette.accentInk)
        }
        Spacer(Modifier.height(26.dp))
        PorchButton("I'm OK", onImOk, Modifier.focusRequester(focus), prominent = false)
        ui.error?.let { Text(it, fontSize = 22.sp, color = Palette.warn, modifier = Modifier.padding(top = 10.dp)) }
        Spacer(Modifier.weight(1f))
        Text(PRIVACY_LINE, fontSize = 23.sp, lineHeight = 31.sp, color = Palette.muted, textAlign = TextAlign.Center, modifier = Modifier.widthIn(max = 780.dp))
    }
}

@Composable
private fun CheckInCard(checkIn: CheckIn, ui: TvUi, onAnswer: () -> Unit) {
    val focus = remember { FocusRequester() }
    LaunchedEffect(checkIn.concernId) { runCatching { focus.requestFocus() } }
    val shape = RoundedCornerShape(40.dp)
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(
            Modifier.width(820.dp).clip(shape).background(Palette.accentSoft).border(3.dp, Palette.accent, shape).padding(horizontal = 56.dp, vertical = 40.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text("Porchlight is checking in", fontSize = 26.sp, fontWeight = FontWeight.SemiBold, color = Palette.accentInk)
            Spacer(Modifier.height(18.dp))
            Text(checkIn.tvText, fontSize = 36.sp, lineHeight = 46.sp, color = Palette.ink, textAlign = TextAlign.Center)
            Spacer(Modifier.height(32.dp))
            PorchButton(
                if (ui.answering) "One moment…" else if (checkIn.isPackage) "I brought it in" else "I'm OK",
                onAnswer,
                Modifier.focusRequester(focus),
            )
            Spacer(Modifier.height(20.dp))
            Text(
                ui.error ?: if (checkIn.isPackage) "Press OK on your remote once it's inside." else "Press OK on your remote, or say “Alexa, tell Porchlight I'm OK.”",
                fontSize = 24.sp,
                color = if (ui.error != null) Palette.warn else Palette.muted,
                textAlign = TextAlign.Center,
            )
        }
    }
}

@Composable
private fun VisitorCard(visitor: Visitor, ui: TvUi, onDismiss: () -> Unit) {
    val focus = remember { FocusRequester() }
    LaunchedEffect(visitor.at) { runCatching { focus.requestFocus() } }
    val zone = ui.home?.zone ?: ZoneId.systemDefault()
    val at = ZonedDateTime.ofInstant(Instant.ofEpochMilli(visitor.at), zone)
    val shape = RoundedCornerShape(28.dp)
    Row(Modifier.fillMaxSize(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(40.dp, Alignment.CenterHorizontally)) {
        Column(Modifier.width(500.dp)) {
            Box(Modifier.fillMaxWidth().aspectRatio(16 / 9f).clip(shape).background(Palette.surface).border(2.dp, Palette.line, shape), contentAlignment = Alignment.Center) {
                val image = ui.visitorImage
                if (image != null) {
                    Image(image, contentDescription = "Snapshot from the front door camera at ${clock(at)} ${amPm(at)}, with privacy zones blacked out", contentScale = ContentScale.Fit, modifier = Modifier.fillMaxSize())
                } else {
                    Text(if (visitor.snapshotPath != null) "Loading the doorbell picture…" else "No picture from the doorbell", fontSize = 24.sp, color = Palette.muted)
                }
            }
            Text("Ring doorbell · privacy zones are blacked out", fontSize = 20.sp, color = Palette.muted, modifier = Modifier.padding(top = 10.dp))
        }
        Column(Modifier.width(330.dp)) {
            Text("Someone rang the doorbell", fontSize = 40.sp, lineHeight = 48.sp, fontWeight = FontWeight.SemiBold, color = Palette.ink)
            Text("at ${clock(at)} ${amPm(at)}", fontSize = 28.sp, color = Palette.muted, modifier = Modifier.padding(top = 6.dp))
            Spacer(Modifier.height(22.dp))
            if (visitor.expectedWho != null) {
                Text("${visitor.expectedWho} is due at ${visitor.expectedTime}.", fontSize = 30.sp, lineHeight = 38.sp, color = Palette.accentInk)
            } else {
                Text("No visit is scheduled right now.", fontSize = 28.sp, lineHeight = 36.sp, color = Palette.muted)
            }
            Spacer(Modifier.height(30.dp))
            PorchButton("OK", onDismiss, Modifier.focusRequester(focus), minWidth = 200.dp)
        }
    }
}

@Composable
private fun Thanks(t: Screen.Thanks) {
    Column(Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
        Box(Modifier.size(88.dp).clip(CircleShape).background(Palette.ok), contentAlignment = Alignment.Center) {
            Text("✓", fontSize = 52.sp, fontWeight = FontWeight.Bold, color = Palette.onAccent)
        }
        Spacer(Modifier.height(28.dp))
        Text(t.title, fontSize = 60.sp, fontWeight = FontWeight.SemiBold, color = Palette.ink)
        Spacer(Modifier.height(12.dp))
        Text(t.body, fontSize = 32.sp, color = Palette.muted)
    }
}

@Composable
private fun Connecting(ui: TvUi) {
    Column(Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
        Text("Connecting to Porchlight…", fontSize = 48.sp, fontWeight = FontWeight.SemiBold, color = Palette.ink)
        Spacer(Modifier.height(16.dp))
        Text(ui.server, fontSize = 28.sp, color = Palette.muted)
        Spacer(Modifier.height(28.dp))
        Text("To use another server, see “Fire TV” in the Porchlight README.", fontSize = 22.sp, color = Palette.muted)
    }
}

/** Connection and clock state, in words as well as color. */
@Composable
private fun Status(ui: TvUi) {
    val home = ui.home
    val (color, text) = when {
        !ui.connected -> Palette.warn to "Can't reach Porchlight. Trying again…"
        home?.mode == "sim" && home.clockRate == 0.0 -> Palette.ok to "Connected · simulated day, paused"
        home?.mode == "sim" -> Palette.ok to "Connected · simulated day, ${home.clockRate.toInt()}× time"
        else -> Palette.ok to "Connected to Porchlight"
    }
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(12.dp).clip(CircleShape).background(color))
        Text(text, fontSize = 18.sp, color = Palette.muted, modifier = Modifier.padding(start = 10.dp))
    }
}

/**
 * The one button style. Focus is unmistakable from across the room (a filled amber button with a light ring),
 * and nothing zooms or glows: no motion that isn't needed.
 */
@Composable
private fun PorchButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, prominent: Boolean = true, minWidth: Dp = 380.dp, fontSize: TextUnit = 34.sp) {
    val shape = RoundedCornerShape(28.dp)
    Button(
        onClick = onClick,
        modifier = modifier.defaultMinSize(minWidth = minWidth, minHeight = 84.dp),
        scale = ButtonDefaults.scale(scale = 1f, focusedScale = 1f, pressedScale = 1f),
        shape = ButtonDefaults.shape(shape = shape),
        colors = ButtonDefaults.colors(
            containerColor = Palette.surface2,
            contentColor = Palette.ink,
            focusedContainerColor = if (prominent) Palette.accent else Palette.surface2,
            focusedContentColor = if (prominent) Palette.onAccent else Palette.ink,
            pressedContainerColor = Palette.accentInk,
            pressedContentColor = Palette.onAccent,
        ),
        border = ButtonDefaults.border(
            border = Border(BorderStroke(3.dp, Palette.line), shape = shape),
            focusedBorder = Border(BorderStroke(5.dp, if (prominent) Palette.focusRing else Palette.accent), shape = shape),
            pressedBorder = Border(BorderStroke(5.dp, Palette.focusRing), shape = shape),
        ),
        contentPadding = PaddingValues(horizontal = 48.dp, vertical = 18.dp),
    ) {
        Text(text, fontSize = fontSize, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
    }
}

private fun clock(t: ZonedDateTime) = DateTimeFormatter.ofPattern("h:mm", Locale.US).format(t)

private fun amPm(t: ZonedDateTime) = DateTimeFormatter.ofPattern("a", Locale.US).format(t)

private fun greeting(t: ZonedDateTime) = when {
    t.hour < 12 -> "Good morning"
    t.hour < 18 -> "Good afternoon"
    else -> "Good evening"
}

/** "Today: Ana (home aide) at 10:00 AM." when the care schedule has a visit today. */
private fun todayLine(home: HomeState, now: ZonedDateTime): String? {
    val weekday = now.dayOfWeek.value % 7 // the schedule counts from Sunday = 0
    val visits = home.visits.filter { weekday in it.days }
    if (visits.isEmpty()) return null
    return "Today: " + visits.joinToString(" and ") { v ->
        val time = runCatching { DateTimeFormatter.ofPattern("h:mm a", Locale.US).format(LocalTime.parse(v.time)) }.getOrDefault(v.time)
        "${v.who} at $time"
    } + "."
}
