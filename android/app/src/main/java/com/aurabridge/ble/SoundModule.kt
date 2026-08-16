package com.aurabridge.ble

import android.media.AudioManager
import android.media.ToneGenerator
import android.os.Handler
import android.os.Looper
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * Tiny audio cues via Android's built-in [ToneGenerator] — no bundled assets and
 * no third-party audio library (both were avoidable risk given this project's
 * history). Fire-and-forget short system tones; every call is guarded so audio
 * can never crash the app.
 *
 * The DTMF tones happen to form a usable little scale (their low-group
 * frequencies rise 1→2→3→A), so a scheduled sequence of them reads as an
 * ascending "connect" swell or a descending "break" fall without needing any
 * real synthesis.
 *
 * formation = rising swell (connect) · breakTone = falling (disconnect) ·
 * send = single mid beep · receive = double beep · delivered = short high
 * confirmation on the sender's device.
 */
class SoundModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

  companion object {
    const val NAME = "Sound"
  }

  private val handler = Handler(Looper.getMainLooper())

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

  /** Play a sequence of tones back-to-back, each held [stepMs]. */
  private fun sequence(steps: IntArray, stepMs: Int) {
    steps.forEachIndexed { i, type ->
      handler.postDelayed({ play(type, stepMs) }, (i.toLong()) * stepMs)
    }
  }

  // Ascending: connection forming. Three rising DTMF tones.
  @ReactMethod
  fun formation() = sequence(
    intArrayOf(ToneGenerator.TONE_DTMF_1, ToneGenerator.TONE_DTMF_5, ToneGenerator.TONE_DTMF_9),
    110,
  )

  // Descending: bond broken.
  @ReactMethod
  fun breakTone() = sequence(
    intArrayOf(ToneGenerator.TONE_DTMF_9, ToneGenerator.TONE_DTMF_1),
    120,
  )

  // Outgoing reaction — one low, soft beep.
  @ReactMethod fun send() = play(ToneGenerator.TONE_DTMF_3, 90)

  // Incoming reaction — a distinct double chirp so it never sounds like "send".
  @ReactMethod fun receive() = play(ToneGenerator.TONE_PROP_BEEP2, 150)

  // Our reaction reached the peer — short high two-tone "delivered" confirmation.
  @ReactMethod
  fun delivered() = sequence(
    intArrayOf(ToneGenerator.TONE_DTMF_D, ToneGenerator.TONE_DTMF_D),
    70,
  )

  override fun onCatalystInstanceDestroy() {
    try {
      handler.removeCallbacksAndMessages(null)
      tone?.release()
    } catch (e: Exception) {
      /* no-op */
    }
  }
}
