import Foundation
import AVFoundation
import AudioToolbox
import UIKit

/**
 * iOS audio + haptic cues — the counterpart of Android's SoundModule.kt
 * (ToneGenerator). Exposes NativeModules.Sound with the SAME five methods the
 * shared JS wrapper (src/audio/sound.ts) calls, so the moment-to-moment feedback
 * matches across platforms:
 *
 *   formation  — bond forms   (rising tone + success haptic)
 *   breakTone  — bond breaks   (low tone + warning haptic)
 *   send       — you react     (blip + light tap)
 *   receive    — peer reacts   (blip + medium tap)
 *   delivered  — peer confirms (tick + selection tick)
 *
 * Tones are short synthesized sine bursts played through AVAudioPlayer on an
 * ambient session (mixes with other audio, respects the ring/silent switch).
 * Haptics use the Taptic engine via UIFeedbackGenerator. Everything is
 * best-effort — a failure never propagates to JS (the wrapper also guards).
 *
 * Haptics live here (not RN's Vibration) so the iPhone gets crisp Taptic
 * feedback; src/ui/BridgeOverlay.tsx therefore fires RN Vibration on Android only.
 */
@objc(Sound)
class Sound: NSObject {

  // Retain players until they finish; AVAudioPlayer is deallocated-silent otherwise.
  private var players: [AVAudioPlayer] = []
  private let notify = UINotificationFeedbackGenerator()

  @objc static func requiresMainQueueSetup() -> Bool { return false }

  override init() {
    super.init()
    // Playback (not ambient) so cues are audible even with the ring/silent switch
    // set to silent — for a demo the "whoa" sound must fire regardless. mixWithOthers
    // keeps us polite: we layer over other audio instead of interrupting it.
    try? AVAudioSession.sharedInstance().setCategory(.playback, options: [.mixWithOthers])
    try? AVAudioSession.sharedInstance().setActive(true)
  }

  /** Ensure the session is active right before playing (it can get deactivated). */
  private func activateSession() {
    try? AVAudioSession.sharedInstance().setActive(true)
  }

  // MARK: - React Native API (matches src/audio/sound.ts)

  @objc func formation() {
    playSweep(from: 660, to: 1320, duration: 0.28)
    runOnMain { self.notify.notificationOccurred(.success) }
  }

  @objc func breakTone() {
    playSweep(from: 440, to: 220, duration: 0.30)
    runOnMain { self.notify.notificationOccurred(.warning) }
  }

  @objc func send() {
    playTone(freq: 880, duration: 0.09)
    runOnMain { UIImpactFeedbackGenerator(style: .light).impactOccurred() }
  }

  @objc func receive() {
    playTone(freq: 990, duration: 0.11)
    runOnMain { UIImpactFeedbackGenerator(style: .medium).impactOccurred() }
  }

  @objc func delivered() {
    playTone(freq: 1245, duration: 0.06)
    runOnMain { UISelectionFeedbackGenerator().selectionChanged() }
  }

  // MARK: - Tone synthesis

  private func runOnMain(_ block: @escaping () -> Void) {
    DispatchQueue.main.async(execute: block)
  }

  private func playTone(freq: Double, duration: Double) {
    playSweep(from: freq, to: freq, duration: duration)
  }

  /** Build a short mono PCM WAV of a (possibly gliding) sine tone and play it. */
  private func playSweep(from f0: Double, to f1: Double, duration: Double) {
    guard let data = Self.makeSineWav(from: f0, to: f1, duration: duration) else { return }
    activateSession()
    do {
      let player = try AVAudioPlayer(data: data)
      player.volume = 0.6
      player.prepareToPlay()
      player.play()
      players.append(player)
      // Drop the reference a little after playback ends.
      DispatchQueue.main.asyncAfter(deadline: .now() + duration + 0.2) { [weak self] in
        self?.players.removeAll { !$0.isPlaying }
      }
    } catch {
      // best-effort; silence on failure
    }
  }

  private static let sampleRate = 44_100.0

  /** Render a linear-frequency-sweep sine into a 16-bit mono WAV in memory. */
  private static func makeSineWav(from f0: Double, to f1: Double, duration: Double) -> Data? {
    let frames = Int(sampleRate * duration)
    guard frames > 0 else { return nil }

    var samples = [Int16](repeating: 0, count: frames)
    var phase = 0.0
    for i in 0..<frames {
      let t = Double(i) / Double(frames)
      let freq = f0 + (f1 - f0) * t
      phase += 2.0 * Double.pi * freq / sampleRate
      // Short attack/release envelope so tones don't click.
      let env = min(1.0, min(Double(i), Double(frames - i)) / (sampleRate * 0.01))
      samples[i] = Int16(sin(phase) * env * 32000.0)
    }

    let byteRate = Int(sampleRate) * 2
    let dataSize = frames * 2
    var wav = Data()
    func appendLE32(_ v: Int) { var x = UInt32(v).littleEndian; wav.append(Data(bytes: &x, count: 4)) }
    func appendLE16(_ v: Int) { var x = UInt16(v).littleEndian; wav.append(Data(bytes: &x, count: 2)) }

    wav.append("RIFF".data(using: .ascii)!)
    appendLE32(36 + dataSize)
    wav.append("WAVE".data(using: .ascii)!)
    wav.append("fmt ".data(using: .ascii)!)
    appendLE32(16)          // PCM chunk size
    appendLE16(1)           // audio format = PCM
    appendLE16(1)           // channels = mono
    appendLE32(Int(sampleRate))
    appendLE32(byteRate)
    appendLE16(2)           // block align
    appendLE16(16)          // bits per sample
    wav.append("data".data(using: .ascii)!)
    appendLE32(dataSize)
    samples.withUnsafeBytes { wav.append(contentsOf: $0) }
    return wav
  }
}
