package com.aurabridge.ble

import android.Manifest
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.bluetooth.le.AdvertiseCallback
import android.bluetooth.le.AdvertiseData
import android.bluetooth.le.AdvertiseSettings
import android.bluetooth.le.BluetoothLeAdvertiser
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.ParcelUuid
import android.util.Base64
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.facebook.react.bridge.UiThreadUtil

/**
 * Native BLE advertiser wrapping [BluetoothLeAdvertiser].
 *
 * Contract: docs/BLE_ADVERTISER_MODULE.md. Every public method returns a promise
 * and rejects with a STABLE STRING code (§5) rather than leaking a raw Android
 * integer or letting a SecurityException propagate. All AdvertiseCallback work is
 * marshalled to the main thread because the callback fires on a binder thread.
 */
class BleAdvertiserModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext), LifecycleEventListener {

  companion object {
    const val NAME = "BleAdvertiser"
    private const val MAX_PAYLOAD_BYTES = 24
    private const val COMPANY_ID = 0xFFFF
    private const val MIN_REPUBLISH_INTERVAL_MS = 500L

    // Event names — keep in sync with src/ble/advertiser.ts.
    private const val EVENT_STARTED = "BleAdvertiser:started"
    private const val EVENT_FAILED = "BleAdvertiser:failed"
    private const val EVENT_STOPPED = "BleAdvertiser:stopped"
  }

  // State — only mutated on the main thread.
  private var isAdvertising = false
  private var lastPayload: ByteArray? = null
  private var lastError: String? = null
  private var lastPublishAtMs = 0L
  private var wasActiveBeforePause = false

  // A SINGLE callback instance: Android requires the same reference to stop an
  // advertisement it started with. A fresh callback per call silently no-ops stop.
  private val advertiseCallback =
      object : AdvertiseCallback() {
        override fun onStartSuccess(settingsInEffect: AdvertiseSettings) {
          UiThreadUtil.runOnUiThread {
            isAdvertising = true
            lastError = null
            emit(EVENT_STARTED, Arguments.createMap())
          }
        }

        override fun onStartFailure(errorCode: Int) {
          UiThreadUtil.runOnUiThread {
            isAdvertising = false
            val code = mapAdvertiseError(errorCode)
            lastError = code
            val map = Arguments.createMap()
            map.putString("code", code)
            map.putString("message", "AdvertiseCallback onStartFailure ($errorCode)")
            emit(EVENT_FAILED, map)
          }
        }
      }

  init {
    reactContext.addLifecycleEventListener(this)
  }

  override fun getName(): String = NAME

  // ---- Public API ---------------------------------------------------------

  @ReactMethod
  fun isSupported(promise: Promise) {
    // Never throws — this is what the startup capability screen (P0-6) reads.
    val report: WritableMap = Arguments.createMap()
    val adapter = getAdapter()
    val btPresent = adapter != null
    val btEnabled = adapter?.isEnabled == true
    // isMultipleAdvertisementSupported() is the real gate; false on a minority of
    // devices. bluetoothLeAdvertiser is null when unsupported OR simply BT-off, so
    // check isEnabled first to avoid telling a BT-off user their phone is incapable.
    val advertisingSupported = btPresent && adapter?.isMultipleAdvertisementSupported == true

    report.putBoolean("bluetoothPresent", btPresent)
    report.putBoolean("bluetoothEnabled", btEnabled)
    report.putBoolean("advertisingSupported", advertisingSupported)
    val supported = btPresent && btEnabled && advertisingSupported
    report.putBoolean("supported", supported)
    if (!supported) {
      report.putString(
          "reason",
          when {
            !btPresent -> "This device has no Bluetooth adapter."
            !advertisingSupported -> "This device cannot advertise over BLE (isMultipleAdvertisementSupported = false)."
            !btEnabled -> "Bluetooth is switched off."
            else -> "Advertising unavailable."
          })
    }
    promise.resolve(report)
  }

  @ReactMethod
  fun startAdvertising(payloadBase64: String, promise: Promise) {
    UiThreadUtil.runOnUiThread {
      if (isAdvertising) {
        promise.reject("ALREADY_STARTED", "Already advertising; use updatePayload().")
        return@runOnUiThread
      }
      beginAdvertising(payloadBase64, promise)
    }
  }

  @ReactMethod
  fun updatePayload(payloadBase64: String, promise: Promise) {
    UiThreadUtil.runOnUiThread {
      val now = System.currentTimeMillis()
      // Native-side debounce safety net; JS enforces the real republish policy.
      if (isAdvertising && now - lastPublishAtMs < MIN_REPUBLISH_INTERVAL_MS) {
        promise.resolve(null)
        return@runOnUiThread
      }
      val advertiser = getAdvertiserOrReject(promise) ?: return@runOnUiThread
      if (isAdvertising) {
        advertiser.stopAdvertising(advertiseCallback)
        isAdvertising = false
      }
      beginAdvertising(payloadBase64, promise)
    }
  }

  @ReactMethod
  fun stopAdvertising(promise: Promise) {
    UiThreadUtil.runOnUiThread {
      if (!isAdvertising) {
        promise.resolve(null) // idempotent
        return@runOnUiThread
      }
      val advertiser = getAdvertiserOrReject(promise) ?: return@runOnUiThread
      advertiser.stopAdvertising(advertiseCallback)
      isAdvertising = false
      emit(EVENT_STOPPED, stoppedPayload("user"))
      promise.resolve(null)
    }
  }

  @ReactMethod
  fun getStatus(promise: Promise) {
    val map = Arguments.createMap()
    map.putBoolean("advertising", isAdvertising)
    if (lastError == null) map.putNull("lastError") else map.putString("lastError", lastError)
    promise.resolve(map)
  }

  // ---- Internals ----------------------------------------------------------

  private fun beginAdvertising(payloadBase64: String, promise: Promise) {
    if (!hasAdvertisePermission()) {
      promise.reject("PERMISSION_DENIED", "BLUETOOTH_ADVERTISE not granted.")
      return
    }

    val bytes =
        try {
          Base64.decode(payloadBase64, Base64.NO_WRAP)
        } catch (e: IllegalArgumentException) {
          promise.reject("INVALID_BASE64", "Payload string failed to decode.")
          return
        }

    if (bytes.size > MAX_PAYLOAD_BYTES) {
      // Catch before the platform call to return the specific code, not DATA_TOO_LARGE.
      promise.reject("PAYLOAD_TOO_LARGE", "Payload is ${bytes.size} bytes; max $MAX_PAYLOAD_BYTES.")
      return
    }

    val adapter = getAdapter()
    if (adapter == null) {
      promise.reject("BLUETOOTH_UNAVAILABLE", "No Bluetooth adapter.")
      return
    }
    if (!adapter.isEnabled) {
      promise.reject("BLUETOOTH_DISABLED", "Bluetooth is switched off.")
      return
    }
    val advertiser = adapter.bluetoothLeAdvertiser
    if (advertiser == null) {
      promise.reject("FEATURE_UNSUPPORTED", "This device cannot advertise over BLE.")
      return
    }

    val settings =
        AdvertiseSettings.Builder()
            .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
            .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH)
            .setConnectable(false) // deliberate — connectionless design (CLAUDE.md §3.1)
            .setTimeout(0) // advertise indefinitely; non-zero caps at 180 s
            .build()

    val data =
        AdvertiseData.Builder()
            .setIncludeDeviceName(false) // MUST be false — 31-byte budget (PAYLOAD_SPEC §1)
            .setIncludeTxPowerLevel(false) // MUST be false
            .addManufacturerData(COMPANY_ID, bytes)
            .build()

    try {
      lastPayload = bytes
      lastPublishAtMs = System.currentTimeMillis()
      advertiser.startAdvertising(settings, data, advertiseCallback)
      // Resolve only after onStartSuccess is emitted as an event; the JS wrapper
      // waits on the 'started' event. We resolve the promise optimistically here
      // for the call itself, but success/failure is authoritative via events.
      promise.resolve(null)
    } catch (e: SecurityException) {
      promise.reject("PERMISSION_DENIED", "BLUETOOTH_ADVERTISE not granted.")
    } catch (e: Exception) {
      promise.reject("INTERNAL_ERROR", e.message ?: "Advertise start failed.")
    }
  }

  private fun getAdvertiserOrReject(promise: Promise): BluetoothLeAdvertiser? {
    val adapter = getAdapter()
    if (adapter == null) {
      promise.reject("BLUETOOTH_UNAVAILABLE", "No Bluetooth adapter.")
      return null
    }
    if (!adapter.isEnabled) {
      promise.reject("BLUETOOTH_DISABLED", "Bluetooth is switched off.")
      return null
    }
    val advertiser = adapter.bluetoothLeAdvertiser
    if (advertiser == null) {
      promise.reject("FEATURE_UNSUPPORTED", "This device cannot advertise over BLE.")
    }
    return advertiser
  }

  private fun getAdapter(): BluetoothAdapter? {
    val manager = reactContext.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
    return manager?.adapter
  }

  private fun hasAdvertisePermission(): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true // no such permission pre-API 31
    return ContextCompat.checkSelfPermission(
        reactContext, Manifest.permission.BLUETOOTH_ADVERTISE) == PackageManager.PERMISSION_GRANTED
  }

  private fun mapAdvertiseError(code: Int): String =
      when (code) {
        AdvertiseCallback.ADVERTISE_FAILED_DATA_TOO_LARGE -> "DATA_TOO_LARGE"
        AdvertiseCallback.ADVERTISE_FAILED_TOO_MANY_ADVERTISERS -> "TOO_MANY_ADVERTISERS"
        AdvertiseCallback.ADVERTISE_FAILED_ALREADY_STARTED -> "ALREADY_STARTED"
        AdvertiseCallback.ADVERTISE_FAILED_INTERNAL_ERROR -> "INTERNAL_ERROR"
        AdvertiseCallback.ADVERTISE_FAILED_FEATURE_UNSUPPORTED -> "FEATURE_UNSUPPORTED"
        else -> "INTERNAL_ERROR"
      }

  private fun stoppedPayload(reason: String): WritableMap {
    val map = Arguments.createMap()
    map.putString("reason", reason)
    return map
  }

  private fun emit(event: String, params: WritableMap) {
    reactContext
        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        .emit(event, params)
  }

  // ---- Lifecycle (no leaked advertisers) ----------------------------------

  override fun onHostPause() {
    UiThreadUtil.runOnUiThread {
      wasActiveBeforePause = isAdvertising
      if (isAdvertising) {
        getAdapter()?.bluetoothLeAdvertiser?.stopAdvertising(advertiseCallback)
        isAdvertising = false
        emit(EVENT_STOPPED, stoppedPayload("lifecycle"))
      }
    }
  }

  override fun onHostResume() {
    UiThreadUtil.runOnUiThread {
      val payload = lastPayload
      if (wasActiveBeforePause && payload != null && !isAdvertising) {
        beginAdvertising(Base64.encodeToString(payload, Base64.NO_WRAP), NoopPromise)
      }
      wasActiveBeforePause = false
    }
  }

  override fun onHostDestroy() {
    UiThreadUtil.runOnUiThread {
      if (isAdvertising) {
        getAdapter()?.bluetoothLeAdvertiser?.stopAdvertising(advertiseCallback)
        isAdvertising = false
      }
      lastPayload = null
    }
  }

  /** A promise sink for internally-triggered lifecycle restarts. */
  private object NoopPromise : Promise {
    override fun resolve(value: Any?) {}
    override fun reject(code: String, message: String?) {}
    override fun reject(code: String, throwable: Throwable?) {}
    override fun reject(code: String, message: String?, throwable: Throwable?) {}
    override fun reject(throwable: Throwable) {}
    override fun reject(throwable: Throwable, userInfo: com.facebook.react.bridge.WritableMap) {}
    override fun reject(code: String, userInfo: com.facebook.react.bridge.WritableMap) {}
    override fun reject(code: String, throwable: Throwable?, userInfo: com.facebook.react.bridge.WritableMap) {}
    override fun reject(code: String, message: String?, userInfo: com.facebook.react.bridge.WritableMap) {}
    override fun reject(
        code: String,
        message: String?,
        throwable: Throwable?,
        userInfo: com.facebook.react.bridge.WritableMap
    ) {}
    override fun reject(message: String) {}
  }
}
