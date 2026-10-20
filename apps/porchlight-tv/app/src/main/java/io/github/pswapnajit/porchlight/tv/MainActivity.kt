package io.github.pswapnajit.porchlight.tv

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import androidx.compose.runtime.getValue
import androidx.core.content.edit
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.pswapnajit.porchlight.tv.ui.PorchlightTheme
import io.github.pswapnajit.porchlight.tv.ui.PorchlightTv

/**
 * Porchlight on Fire TV: Rose's screen on the TV she already watches. It is a client of the Porchlight
 * server (GET /api/state, the /api/events stream, POST /api/resident/ok and /api/resident/package-inside).
 */
class MainActivity : ComponentActivity() {
    private val vm: HomeViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        vm.connect(serverFrom(intent))
        setContent {
            PorchlightTheme {
                val ui by vm.ui.collectAsStateWithLifecycle()
                PorchlightTv(ui, onAnswer = vm::answer, onImOk = vm::imOk, onDismissVisitor = vm::dismissVisitor)
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        vm.connect(serverFrom(intent))
    }

    /** The server comes from the build (-Pporchlight.server), unless set once with `adb shell am start ... --es server <url>`. */
    private fun serverFrom(intent: Intent?): String {
        val prefs = getSharedPreferences("porchlight", MODE_PRIVATE)
        intent?.getStringExtra("server")?.trim()?.trimEnd('/')?.takeIf { it.startsWith("http://") || it.startsWith("https://") }?.let { prefs.edit { putString("server", it) } }
        return prefs.getString("server", null) ?: BuildConfig.PORCHLIGHT_SERVER
    }
}
