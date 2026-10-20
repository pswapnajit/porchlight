package io.github.pswapnajit.porchlight.tv

import android.content.Context
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.util.Log
import java.util.Locale

/** Reads check-ins aloud with the TV's own text-to-speech engine. If the device has none, the screen still shows them. */
class Speaker(context: Context) : TextToSpeech.OnInitListener {
    private val tts = TextToSpeech(context.applicationContext, this)
    private var ready = false
    private var pending: String? = null
    private var count = 0

    override fun onInit(status: Int) {
        ready = status == TextToSpeech.SUCCESS
        if (!ready) {
            Log.w(TAG, "No text-to-speech engine (status $status): check-ins are shown but not read aloud")
            return
        }
        tts.language = Locale.US
        tts.setSpeechRate(0.9f)
        tts.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
            override fun onStart(utteranceId: String) {
                Log.i(TAG, "speaking $utteranceId")
            }

            override fun onDone(utteranceId: String) {
                Log.i(TAG, "spoke $utteranceId")
            }

            @Deprecated("Deprecated in Java")
            override fun onError(utteranceId: String) {
                Log.w(TAG, "couldn't speak $utteranceId")
            }
        })
        pending?.let(::say)
        pending = null
    }

    fun say(text: String) {
        if (!ready) {
            pending = text
            return
        }
        Log.i(TAG, "say: $text")
        tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "porchlight-${++count}")
    }

    fun stop() {
        pending = null
        if (ready) tts.stop()
    }

    fun shutdown() = tts.shutdown()

    private companion object {
        const val TAG = "PorchlightSpeaker"
    }
}
