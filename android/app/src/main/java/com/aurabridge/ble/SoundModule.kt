package com.aurabridge.ble

import android.media.AudioManager
import android.media.ToneGenerator
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * Tiny audio cues via Android's built-in [ToneGenerator] — no bundled assets and
 * no third-party audio library (both were avoidable risk given this project's
 * history). Fire-and-forget short system tones; every call is guarded so audio
 * can never crash the app.
 *
 * formation = success ack · send = single beep · receive = double beep ·
 * breakTone = nack.
 */
class SoundModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

  companion object {
    const val NAME = "Sound"
  }

  private val tone: ToneGenerator? by lazy {
    try {
      ToneGenerator(AudioManager.STREAM_MUSIC, 80) // 0..100 volume
    } catch (e: RuntimeException) {
      null // some devices deny/limit tone resources — degrade silently
    }
  }

  override fun getName(): String = NAME

  private fun play(type: Int, durationMs: Int) {
    try {
      tone?.startTone(type, durationMs)
    } catch (e: Exception) {
      /* never let a cue crash the app */
    }
  }

  @ReactMethod fun formation() = play(ToneGenerator.TONE_PROP_ACK, 200)

  @ReactMethod fun breakTone() = play(ToneGenerator.TONE_PROP_NACK, 200)

  @ReactMethod fun send() = play(ToneGenerator.TONE_PROP_BEEP, 120)

  @ReactMethod fun receive() = play(ToneGenerator.TONE_PROP_BEEP2, 150)

  override fun onCatalystInstanceDestroy() {
    try {
      tone?.release()
    } catch (e: Exception) {
      /* no-op */
    }
  }
}
