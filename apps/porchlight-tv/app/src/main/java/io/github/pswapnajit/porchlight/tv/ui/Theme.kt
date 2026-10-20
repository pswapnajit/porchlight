package io.github.pswapnajit.porchlight.tv.ui

import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.darkColorScheme

/**
 * Porchlight's dark palette from the web app (web/assets/app.css), for a TV in a living room.
 * Every text pair is at least WCAG AA (4.5:1); most are above 7:1. Lowest: accent on accentSoft, 6.7:1.
 */
object Palette {
    val bg = Color(0xFF14110E)
    val surface = Color(0xFF1D1915)
    val surface2 = Color(0xFF26211B)
    val ink = Color(0xFFF5EEE4) // 16.3:1 on bg
    val muted = Color(0xFFB8AB9B) // 8.4:1 on bg
    val line = Color(0xFF3A3229)
    val accent = Color(0xFFF2A54A) // 9.2:1 on bg
    val accentSoft = Color(0xFF3D2A12)
    val accentInk = Color(0xFFFFD9A8) // 10.2:1 on accentSoft
    val onAccent = Color(0xFF1E1A16) // 8.4:1 on accent
    val ok = Color(0xFF6CC795)
    val warn = Color(0xFFF3B453)
    val focusRing = Color(0xFFFFF4E6)
}

@Composable
fun PorchlightTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = darkColorScheme(
            primary = Palette.accent,
            onPrimary = Palette.onAccent,
            background = Palette.bg,
            onBackground = Palette.ink,
            surface = Palette.surface,
            onSurface = Palette.ink,
            surfaceVariant = Palette.surface2,
            onSurfaceVariant = Palette.muted,
            border = Palette.line,
        ),
        content = content,
    )
}
