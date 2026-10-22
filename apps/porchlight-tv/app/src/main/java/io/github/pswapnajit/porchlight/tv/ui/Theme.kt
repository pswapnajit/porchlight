package io.github.pswapnajit.porchlight.tv.ui

import androidx.compose.runtime.Composable
import android.graphics.Typeface
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.lightColorScheme

/**
 * The Brainyjuice palette, shared with the web app (web/assets/app.css): light greys, white, near-black ink,
 * mint teal and coin yellow. Every text pair is at least WCAG AA (4.5:1).
 */
object Palette {
    val bg = Color(0xFFF0F1F3)
    val surface = Color(0xFFFFFFFF)
    val surface2 = Color(0xFFF4F5F7)
    val ink = Color(0xFF111315) // 16.8:1 on bg
    val muted = Color(0xFF646970) // 4.8:1 on bg
    val line = Color(0xFFE4E6E9)
    val accent = Color(0xFFFFD54A) // coin yellow: the check-in card's border
    val accentSoft = Color(0xFFFFF3C4)
    val accentInk = Color(0xFF8A5A00) // 5.3:1 on accentSoft, 4.7:1 on bg
    val teal = Color(0xFF0A7F61) // focused button fill; white text on it is 5.0:1
    val onAccent = Color(0xFFFFFFFF)
    val ok = Color(0xFF0A7F61)
    val warn = Color(0xFFB4511F)
    val focusRing = Color(0xFF111315)
}

/** Tall condensed headings, like Brainyjuice: Roboto Condensed ships with Android TV and Fire OS. */
val Display = FontFamily(Typeface.create("sans-serif-condensed", Typeface.BOLD))

@Composable
fun PorchlightTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = lightColorScheme(
            primary = Palette.teal,
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
