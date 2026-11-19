package `in`.dikho.crm

import android.content.Context
import android.media.MediaRecorder
import android.os.Build
import android.os.SystemClock
import java.io.File
import java.util.UUID

/**
 * Records a voice note to private cache storage. Android 10 and later write
 * OGG/Opus, which WhatsApp plays as a voice note. Older phones write AAC in MP4,
 * which goes as an ordinary audio message. Mono: Meta asks for it, and speech
 * loses nothing by it.
 */
internal class VoiceRecorder(private val context: Context) {
    private var recorder: MediaRecorder? = null
    private var file: File? = null
    private var startedAt = 0L
    private var isVoiceNote = false

    /** Returns false when the microphone could not be started. */
    fun start(): Boolean {
        cancel()
        val opus = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
        val dir = File(context.cacheDir, "voice").apply { mkdirs() }
        val target = File(dir, "${UUID.randomUUID()}.${if (opus) "ogg" else "m4a"}")
        val next = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            MediaRecorder(context)
        } else {
            @Suppress("DEPRECATION")
            MediaRecorder()
        }
        return try {
            next.setAudioSource(MediaRecorder.AudioSource.MIC)
            if (opus) {
                next.setOutputFormat(MediaRecorder.OutputFormat.OGG)
                next.setAudioEncoder(MediaRecorder.AudioEncoder.OPUS)
            } else {
                next.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
                next.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
            }
            next.setAudioChannels(1)
            next.setAudioSamplingRate(48000)
            next.setAudioEncodingBitRate(32000)
            next.setOutputFile(target.path)
            next.prepare()
            next.start()
            recorder = next
            file = target
            isVoiceNote = opus
            startedAt = SystemClock.elapsedRealtime()
            true
        } catch (_: Exception) {
            next.release()
            target.delete()
            false
        }
    }

    /** The finished file, or null if nothing usable was recorded. */
    fun stop(): Map<String, Any?>? {
        val active = recorder ?: return null
        val target = file
        val durationMs = SystemClock.elapsedRealtime() - startedAt
        recorder = null
        file = null
        val finished = try {
            active.stop()
            true
        } catch (_: RuntimeException) {
            // Android throws when it was stopped before any audio arrived.
            false
        } finally {
            active.release()
        }
        if (!finished || target == null || target.length() == 0L) {
            target?.delete()
            return null
        }
        return mapOf(
            "path" to target.path,
            "mime" to if (isVoiceNote) "audio/ogg" else "audio/mp4",
            "filename" to if (isVoiceNote) "voice.ogg" else "voice.m4a",
            "voice" to isVoiceNote,
            "durationMs" to durationMs,
        )
    }

    fun cancel() {
        val active = recorder ?: return
        recorder = null
        try {
            active.stop()
        } catch (_: RuntimeException) {
            // Nothing was recorded yet, which is fine for a discard.
        } finally {
            active.release()
        }
        file?.delete()
        file = null
    }
}
