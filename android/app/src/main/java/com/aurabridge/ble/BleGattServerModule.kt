package com.aurabridge.ble

import android.Manifest
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothGattServer
import android.bluetooth.BluetoothGattServerCallback
import android.bluetooth.BluetoothGattService
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.util.Base64
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.util.Collections
import java.util.UUID

/**
 * GATT **server** (peripheral) for the interop path — docs/GATT_SPEC.md.
 *
 * Hosts the Bridge service with a single PAYLOAD characteristic (read + notify)
 * whose value IS the 24-byte payload (same codec as the connectionless path).
 * When the local payload changes, subscribed centrals are notified. This is only
 * used when the GATT interop path is enabled (src/config.ts GATT_ENABLED); the
 * connectionless manufacturer-data advertiser is untouched and remains the
 * Android↔Android transport.
 *
 * Threading: GATT server callbacks arrive on binder threads; all mutation of the
 * subscriber set and payload is confined to the main thread. The subscriber set
 * itself is a synchronized set so a notify iterating it can't race a callback.
 */
class BleGattServerModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

  companion object {
    const val NAME = "BleGattServer"
    // Keep in sync with src/ble/gatt/constants.ts.
    private val SERVICE_UUID = UUID.fromString("a0e1b5d2-7c3f-4e8a-9b10-2f6c1d4e7a90")
    private val PAYLOAD_CHAR_UUID = UUID.fromString("a0e1b5d2-7c3f-4e8a-9b10-2f6c1d4e7a91")
    // Message characteristic (write + notify) — docs/GATT_MESSAGING_SPEC.md.
    private val MESSAGE_CHAR_UUID = UUID.fromString("a0e1b5d2-7c3f-4e8a-9b10-2f6c1d4e7a92")
    // Standard Client Characteristic Configuration Descriptor — how a central
    // subscribes to notifications.
    private val CCCD_UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")
    private const val MAX_PAYLOAD_BYTES = 24
    // Inbound message frames + MTU changes are pushed to JS via these events.
    private const val EVENT_MESSAGE = "BleGattServer:message"
    private const val EVENT_MTU = "BleGattServer:mtu"
  }

  private var gattServer: BluetoothGattServer? = null
  private var payloadChar: BluetoothGattCharacteristic? = null
  private var messageChar: BluetoothGattCharacteristic? = null
  private var currentPayload: ByteArray = ByteArray(0)
  // Centrals that have enabled notifications on the payload characteristic.
  private val subscribers: MutableSet<BluetoothDevice> =
      Collections.synchronizedSet(mutableSetOf())
  // Centrals that have enabled notifications on the MESSAGE characteristic.
  private val msgSubscribers: MutableSet<BluetoothDevice> =
      Collections.synchronizedSet(mutableSetOf())

  override fun getName(): String = NAME

  private val serverCallback =
      object : BluetoothGattServerCallback() {
        override fun onConnectionStateChange(device: BluetoothDevice, status: Int, newState: Int) {
          if (newState == BluetoothProfile.STATE_DISCONNECTED) {
            subscribers.remove(device)
            msgSubscribers.remove(device)
          }
        }

        override fun onMtuChanged(device: BluetoothDevice, mtu: Int) {
          // JS chunks outbound message frames to this MTU (minus ATT overhead).
          val params = Arguments.createMap()
          params.putString("device", device.address)
          params.putInt("mtu", mtu)
          emit(EVENT_MTU, params)
        }

        override fun onCharacteristicWriteRequest(
            device: BluetoothDevice,
            requestId: Int,
            characteristic: BluetoothGattCharacteristic,
            preparedWrite: Boolean,
            responseNeeded: Boolean,
            offset: Int,
            value: ByteArray?,
        ) {
          if (characteristic.uuid == MESSAGE_CHAR_UUID) {
            if (value != null && value.isNotEmpty()) {
              val params = Arguments.createMap()
              params.putString("device", device.address)
              params.putString("data", Base64.encodeToString(value, Base64.NO_WRAP))
              emit(EVENT_MESSAGE, params)
            }
            if (responseNeeded) {
              safeSendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, value)
            }
          } else if (responseNeeded) {
            safeSendResponse(device, requestId, BluetoothGatt.GATT_FAILURE, offset, null)
          }
        }

        override fun onCharacteristicReadRequest(
            device: BluetoothDevice,
            requestId: Int,
            offset: Int,
            characteristic: BluetoothGattCharacteristic,
        ) {
          if (characteristic.uuid == PAYLOAD_CHAR_UUID) {
            val value = currentPayload
            val slice = if (offset >= value.size) ByteArray(0) else value.copyOfRange(offset, value.size)
            safeSendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, slice)
          } else {
            safeSendResponse(device, requestId, BluetoothGatt.GATT_FAILURE, offset, null)
          }
        }

        override fun onDescriptorWriteRequest(
            device: BluetoothDevice,
            requestId: Int,
            descriptor: BluetoothGattDescriptor,
            preparedWrite: Boolean,
            responseNeeded: Boolean,
            offset: Int,
            value: ByteArray?,
        ) {
          if (descriptor.uuid == CCCD_UUID) {
            val enable =
                value != null &&
                    value.contentEquals(BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE)
            // Route the subscription to the set for the descriptor's OWN
            // characteristic — payload and message notify independently.
            val target =
                if (descriptor.characteristic?.uuid == MESSAGE_CHAR_UUID) msgSubscribers
                else subscribers
            if (enable) target.add(device) else target.remove(device)
          }
          if (responseNeeded) {
            safeSendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, value)
          }
        }
      }

  // ---- Public API ---------------------------------------------------------

  @ReactMethod
  fun startServer(payloadBase64: String, promise: Promise) {
    UiThreadUtil.runOnUiThread {
      if (!hasConnectPermission()) {
        promise.reject("PERMISSION_DENIED", "BLUETOOTH_CONNECT not granted.")
        return@runOnUiThread
      }
      val bytes = decode(payloadBase64) ?: run {
        promise.reject("INVALID_BASE64", "Payload failed to decode.")
        return@runOnUiThread
      }
      currentPayload = bytes

      if (gattServer != null) {
        promise.resolve(null) // already running
        return@runOnUiThread
      }
      val manager = reactContext.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
      if (manager == null) {
        promise.reject("BLUETOOTH_UNAVAILABLE", "No Bluetooth manager.")
        return@runOnUiThread
      }
      try {
        val server = manager.openGattServer(reactContext, serverCallback)
        if (server == null) {
          promise.reject("INTERNAL_ERROR", "openGattServer returned null.")
          return@runOnUiThread
        }
        val characteristic =
            BluetoothGattCharacteristic(
                PAYLOAD_CHAR_UUID,
                BluetoothGattCharacteristic.PROPERTY_READ or BluetoothGattCharacteristic.PROPERTY_NOTIFY,
                BluetoothGattCharacteristic.PERMISSION_READ,
            )
        val cccd =
            BluetoothGattDescriptor(
                CCCD_UUID,
                BluetoothGattDescriptor.PERMISSION_READ or BluetoothGattDescriptor.PERMISSION_WRITE,
            )
        characteristic.addDescriptor(cccd)

        // Message characteristic: central writes frames here; we notify frames
        // back (docs/GATT_MESSAGING_SPEC.md). Its own CCCD → its own subscribers.
        val msgCharacteristic =
            BluetoothGattCharacteristic(
                MESSAGE_CHAR_UUID,
                BluetoothGattCharacteristic.PROPERTY_WRITE or
                    BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE or
                    BluetoothGattCharacteristic.PROPERTY_NOTIFY,
                BluetoothGattCharacteristic.PERMISSION_WRITE,
            )
        msgCharacteristic.addDescriptor(
            BluetoothGattDescriptor(
                CCCD_UUID,
                BluetoothGattDescriptor.PERMISSION_READ or BluetoothGattDescriptor.PERMISSION_WRITE,
            ),
        )

        val service = BluetoothGattService(SERVICE_UUID, BluetoothGattService.SERVICE_TYPE_PRIMARY)
        service.addCharacteristic(characteristic)
        service.addCharacteristic(msgCharacteristic)
        server.addService(service)

        gattServer = server
        payloadChar = characteristic
        messageChar = msgCharacteristic
        promise.resolve(null)
      } catch (e: SecurityException) {
        promise.reject("PERMISSION_DENIED", "BLUETOOTH_CONNECT not granted.")
      } catch (e: Exception) {
        promise.reject("INTERNAL_ERROR", e.message ?: "GATT server start failed.")
      }
    }
  }

  @ReactMethod
  fun updatePayload(payloadBase64: String, promise: Promise) {
    UiThreadUtil.runOnUiThread {
      val bytes = decode(payloadBase64) ?: run {
        promise.reject("INVALID_BASE64", "Payload failed to decode.")
        return@runOnUiThread
      }
      currentPayload = bytes
      val server = gattServer
      val characteristic = payloadChar
      if (server == null || characteristic == null) {
        promise.resolve(null) // server not running — nothing to notify
        return@runOnUiThread
      }
      characteristic.value = bytes
      // Snapshot to avoid holding the lock across the platform call.
      val targets = synchronized(subscribers) { subscribers.toList() }
      try {
        for (device in targets) {
          server.notifyCharacteristicChanged(device, characteristic, false)
        }
        promise.resolve(null)
      } catch (e: SecurityException) {
        promise.reject("PERMISSION_DENIED", "BLUETOOTH_CONNECT not granted.")
      } catch (e: Exception) {
        promise.reject("INTERNAL_ERROR", e.message ?: "notify failed.")
      }
    }
  }

  @ReactMethod
  fun stopServer(promise: Promise) {
    UiThreadUtil.runOnUiThread {
      try {
        gattServer?.close()
      } catch (e: Exception) {
        /* ignore */
      }
      gattServer = null
      payloadChar = null
      messageChar = null
      subscribers.clear()
      msgSubscribers.clear()
      promise.resolve(null)
    }
  }

  /**
   * Notify a message frame to every central subscribed to the message
   * characteristic. Frames are pre-chunked to the MTU in JS (messaging.ts); this
   * just pushes the bytes. Best-effort — a missed notify is handled by the ack /
   * retransmit layer (outbound.ts).
   */
  @ReactMethod
  fun notifyMessage(dataBase64: String, promise: Promise) {
    UiThreadUtil.runOnUiThread {
      val bytes =
          try {
            Base64.decode(dataBase64, Base64.NO_WRAP)
          } catch (e: IllegalArgumentException) {
            promise.reject("INVALID_BASE64", "Frame failed to decode.")
            return@runOnUiThread
          }
      val server = gattServer
      val characteristic = messageChar
      if (server == null || characteristic == null) {
        promise.resolve(null) // server not running
        return@runOnUiThread
      }
      characteristic.value = bytes
      val targets = synchronized(msgSubscribers) { msgSubscribers.toList() }
      try {
        for (device in targets) {
          server.notifyCharacteristicChanged(device, characteristic, false)
        }
        promise.resolve(null)
      } catch (e: SecurityException) {
        promise.reject("PERMISSION_DENIED", "BLUETOOTH_CONNECT not granted.")
      } catch (e: Exception) {
        promise.reject("INTERNAL_ERROR", e.message ?: "notify failed.")
      }
    }
  }

  // NativeEventEmitter requires these to exist (no-op — we emit unconditionally).
  @ReactMethod fun addListener(eventName: String) {}

  @ReactMethod fun removeListeners(count: Int) {}

  @ReactMethod
  fun getStatus(promise: Promise) {
    val map = com.facebook.react.bridge.Arguments.createMap()
    map.putBoolean("running", gattServer != null)
    map.putInt("subscribers", subscribers.size)
    promise.resolve(map)
  }

  // ---- Internals ----------------------------------------------------------

  private fun emit(event: String, params: WritableMap) {
    try {
      reactContext
          .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
          .emit(event, params)
    } catch (e: Exception) {
      /* bridge torn down — nothing to do */
    }
  }

  private fun safeSendResponse(
      device: BluetoothDevice,
      requestId: Int,
      status: Int,
      offset: Int,
      value: ByteArray?,
  ) {
    try {
      gattServer?.sendResponse(device, requestId, status, offset, value)
    } catch (e: SecurityException) {
      /* permission revoked mid-session — nothing we can do */
    } catch (e: Exception) {
      /* never crash on a response */
    }
  }

  private fun decode(base64: String): ByteArray? =
      try {
        val bytes = Base64.decode(base64, Base64.NO_WRAP)
        if (bytes.size > MAX_PAYLOAD_BYTES) null else bytes
      } catch (e: IllegalArgumentException) {
        null
      }

  private fun hasConnectPermission(): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true
    return ContextCompat.checkSelfPermission(
        reactContext, Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED
  }
}
