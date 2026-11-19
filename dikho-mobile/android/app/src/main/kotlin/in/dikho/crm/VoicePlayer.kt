package `in`.dikho.crm

import android.media.AudioAttributes
import android.media.MediaPlayer
import android.os.Handler
import android.os.Looper

/** Plays one downloaded audio message at a time. Progress arrives as events. */
internal class VoicePlayer(private val emit: (Map<String, Any?>) -> Unit) {
    private val main = Handler(Looper.getMainLooper())
    private var player: MediaPlayer? = null
    private var currentId: String? = null
    private var ready = false

    private val tick = object : Runnable {
        override fun run() {
            val active = player ?: return
            if (ready && active.isPlaying) {
                report("playing")
                main.postDelayed(this, 200)
            }
        }
    }

    fun play(id: String, path: String) {
        if (id == currentId && ready) {
            player?.start()
            startTicking()
            return
        }
        stop()
        val next = MediaPlayer()
        try {
            next.setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build(),
            )
            next.setDataSource(path)
            next.setOnPreparedListener {
                ready = true
                it.start()
                startTicking()
            }
            next.setOnCompletionListener {
                report("completed")
                stop()
            }
            next.setOnErrorListener { _, _, _ ->
                report("error")
                stop()
                true
            }
            player = next
            currentId = id
            next.prepareAsync()
        } catch (_: Exception) {
            next.release()
            emit(mapOf("type" to "audio", "id" to id, "state" to "error", "positionMs" to 0, "durationMs" to 0))
        }
    }

    private fun startTicking() {
        main.removeCallbacks(tick)
        main.post(tick)
    }

    fun pause() {
        val active = player ?: return
        if (ready && active.isPlaying) {
            active.pause()
            report("paused")
        }
    }

    fun seek(ms: Int) {
        val active = player ?: return
        if (!ready) return
        active.seekTo(ms)
        report(if (active.isPlaying) "playing" else "paused")
    }

    fun stop() {
        main.removeCallbacks(tick)
        player?.release()
        player = null
        currentId = null
        ready = false
    }

    private fun report(state: String) {
        val active = player ?: return
        emit(
            mapOf(
                "type" to "audio",
                "id" to currentId,
                "state" to state,
                "positionMs" to if (ready) active.currentPosition else 0,
                "durationMs" to if (ready) active.duration else 0,
            ),
        )
    }
}
