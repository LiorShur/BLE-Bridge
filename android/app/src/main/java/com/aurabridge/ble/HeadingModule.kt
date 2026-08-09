package com.aurabridge.ble

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule

/**
 * Compass heading via the rotation-vector sensor (TASKS.md P2-4). Written as a
 * native module — like the advertiser — rather than pulling an unmaintained
 * third-party lib, so we control the accuracy value (0..3, same scale as payload
 * byte 7) and avoid AGP build breakage.
 *
 * The matrix is remapped for a phone held UPRIGHT in portrait (camera pointing at
 * the horizon), which is how you hold it to "look through" the AR view
 * (CLAUDE.md §3.2). Only relative opposition matters for the alignment gate, so
 * as long as both devices use this same convention, facing each other yields
 * headings ~180° apart.
 */
class HeadingModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext), SensorEventListener {

  companion object {
    const val NAME = "Heading"
    const val EVENT = "Heading:update"
  }

  private val sensorManager = reactContext.getSystemService(Context.SENSOR_SERVICE) as? SensorManager
  private val rotationSensor: Sensor? = sensorManager?.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR)
  private var listening = false
  private var lastAccuracy = 0
  private val rotationMatrix = FloatArray(9)
  private val remapped = FloatArray(9)
  private val orientation = FloatArray(3)

  override fun getName(): String = NAME

  @ReactMethod
  fun start(promise: Promise) {
    if (rotationSensor == null) {
      promise.reject("NO_SENSOR", "No rotation-vector sensor on this device.")
      return
    }
    if (!listening) {
      sensorManager?.registerListener(this, rotationSensor, SensorManager.SENSOR_DELAY_UI)
      listening = true
    }
    promise.resolve(null)
  }

  @ReactMethod
  fun stop(promise: Promise) {
    if (listening) {
      sensorManager?.unregisterListener(this)
      listening = false
    }
    promise.resolve(null)
  }

  // Required so RN's NativeEventEmitter doesn't warn about a missing subscription API.
  @ReactMethod fun addListener(eventName: String) {}

  @ReactMethod fun removeListeners(count: Int) {}

  override fun onSensorChanged(event: SensorEvent) {
    if (event.sensor.type != Sensor.TYPE_ROTATION_VECTOR) return
    SensorManager.getRotationMatrixFromVector(rotationMatrix, event.values)
    // Remap so azimuth reflects where the phone points when held upright.
    SensorManager.remapCoordinateSystem(
        rotationMatrix, SensorManager.AXIS_X, SensorManager.AXIS_Z, remapped)
    SensorManager.getOrientation(remapped, orientation)
    var azimuth = Math.toDegrees(orientation[0].toDouble())
    if (azimuth < 0) azimuth += 360.0

    val map: WritableMap = Arguments.createMap()
    map.putDouble("heading", azimuth)
    map.putInt("accuracy", lastAccuracy) // SENSOR_STATUS_ACCURACY_* is already 0..3
    reactContext
        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        .emit(EVENT, map)
  }

  override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {
    lastAccuracy = accuracy
  }
}
