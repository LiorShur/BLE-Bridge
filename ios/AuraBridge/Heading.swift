import Foundation
import CoreLocation

/**
 * iOS compass heading source — the counterpart of Android's HeadingModule.kt
 * (P-i2b+). Exposes NativeModules.Heading with the SAME contract the shared JS
 * wrapper (src/sensors/useCompassHeading.ts) already expects:
 *
 *   - start() / stop() promises
 *   - a `Heading:update` event carrying { heading: Float, accuracy: Int }
 *
 * so the iPhone feeds the very same alignment math as Android and a facing-aware
 * bond forms across platforms (docs/GATT_SPEC.md, CLAUDE.md §4.3).
 *
 * CoreLocation reports heading accuracy as a *deviation in degrees* (negative =
 * invalid). We bucket that into Android's 0..3 SensorManager scale so the payload
 * (byte 7) and the alignment fallback see a uniform value on both platforms.
 *
 * Heading updates require location authorization (when-in-use) and the
 * NSLocationWhenInUseUsageDescription Info.plist key — see docs/IOS_SETUP.md.
 *
 * RCTEventEmitter / RCTPromise* come via the bridging header, so no `import
 * React` is needed here.
 */
@objc(Heading)
class Heading: RCTEventEmitter, CLLocationManagerDelegate {

  private let manager = CLLocationManager()
  private var hasListeners = false

  override init() {
    super.init()
    manager.delegate = self
    // Portrait phone held upright: the device points where the top edge faces.
    manager.headingOrientation = .portrait
    manager.headingFilter = 1 // degrees of change before a new update fires
  }

  @objc static override func requiresMainQueueSetup() -> Bool { return false }

  override func supportedEvents() -> [String]! { return ["Heading:update"] }

  // RCTEventEmitter lifecycle — only hold the sensor open while JS is listening.
  override func startObserving() { hasListeners = true }
  override func stopObserving() { hasListeners = false }

  // MARK: - React Native API

  @objc(start:rejecter:)
  func start(_ resolve: @escaping RCTPromiseResolveBlock,
             rejecter reject: @escaping RCTPromiseRejectBlock) {
    guard CLLocationManager.headingAvailable() else {
      reject("no_compass", "Heading not available on this device", nil)
      return
    }
    // Heading needs location auth on iOS; request it, then start regardless —
    // updates simply won't flow until the user grants it.
    manager.requestWhenInUseAuthorization()
    manager.startUpdatingHeading()
    resolve(nil)
  }

  @objc(stop:rejecter:)
  func stop(_ resolve: @escaping RCTPromiseResolveBlock,
            rejecter reject: @escaping RCTPromiseRejectBlock) {
    manager.stopUpdatingHeading()
    resolve(nil)
  }

  // MARK: - CLLocationManagerDelegate

  func locationManager(_ manager: CLLocationManager, didUpdateHeading newHeading: CLHeading) {
    guard hasListeners else { return }
    // Prefer true heading (map-referenced) when valid; fall back to magnetic.
    let deg = newHeading.trueHeading >= 0 ? newHeading.trueHeading : newHeading.magneticHeading
    sendEvent(withName: "Heading:update",
              body: ["heading": deg, "accuracy": bucketAccuracy(newHeading.headingAccuracy)])
  }

  /**
   * Map CoreLocation's degree-deviation accuracy to Android's 0..3 scale:
   *   < 0  → 0 (invalid — the alignment fallback then trusts proximity alone)
   *   > 40 → 1 (unreliable, needs figure-eight calibration)
   *   > 20 → 2 (usable)
   *   else → 3 (good)
   * The 2-vs-below split matches CLAUDE.md §4.3's "accuracy < 2 ⇒ fallback".
   */
  private func bucketAccuracy(_ deviationDeg: CLLocationDirection) -> Int {
    if deviationDeg < 0 { return 0 }
    if deviationDeg > 40 { return 1 }
    if deviationDeg > 20 { return 2 }
    return 3
  }
}
