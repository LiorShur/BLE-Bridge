import Foundation
import CoreBluetooth

/**
 * iOS GATT peripheral for the interop path (docs/GATT_SPEC.md) + the Tier 2
 * messaging channel (docs/GATT_MESSAGING_SPEC.md).
 *
 * iOS cannot advertise manufacturer data, so the iPhone makes itself discoverable
 * by advertising the Bridge SERVICE UUID and exposes:
 *   - PAYLOAD char (read + notify): the 24-byte advertisement payload.
 *   - MESSAGE char (write + notify): the messaging channel — a central writes
 *     frames here; we notify frames back. Frames are chunked to the MTU in JS.
 *
 * One CBPeripheralManager does BOTH advertising and the GATT server on iOS.
 *
 * Exposed to React Native as NativeModules.BlePeripheral (see BlePeripheral.m).
 * It is an RCTEventEmitter so inbound message frames + the notify size can be
 * pushed to JS as events. The RCT* types come via the bridging header.
 */
@objc(BlePeripheral)
class BlePeripheral: RCTEventEmitter, CBPeripheralManagerDelegate {

  private var manager: CBPeripheralManager?
  private let serviceUUID = CBUUID(string: "A0E1B5D2-7C3F-4E8A-9B10-2F6C1D4E7A90")
  private let charUUID = CBUUID(string: "A0E1B5D2-7C3F-4E8A-9B10-2F6C1D4E7A91")
  private let msgCharUUID = CBUUID(string: "A0E1B5D2-7C3F-4E8A-9B10-2F6C1D4E7A92")
  private var payloadChar: CBMutableCharacteristic?
  private var messageChar: CBMutableCharacteristic?
  private var currentPayload = Data()
  private var wantAdvertising = false
  private var serviceAdded = false
  private var subscriberCount = 0
  private var hasListeners = false

  @objc static override func requiresMainQueueSetup() -> Bool { return false }

  // MARK: - RCTEventEmitter

  override func supportedEvents() -> [String]! { return ["BlePeripheral:message", "BlePeripheral:mtu"] }
  override func startObserving() { hasListeners = true }
  override func stopObserving() { hasListeners = false }

  private func emit(_ name: String, _ body: [String: Any]) {
    guard hasListeners else { return }
    sendEvent(withName: name, body: body)
  }

  // MARK: - React Native API

  @objc(startPeripheral:resolver:rejecter:)
  func startPeripheral(_ base64: String,
                       resolver resolve: @escaping RCTPromiseResolveBlock,
                       rejecter reject: @escaping RCTPromiseRejectBlock) {
    if let data = Data(base64Encoded: base64) { currentPayload = data }
    wantAdvertising = true
    if manager == nil {
      // nil queue == main queue; CoreBluetooth calls the delegate there.
      manager = CBPeripheralManager(delegate: self, queue: nil)
    } else if manager?.state == .poweredOn {
      setupAndAdvertise()
    }
    resolve(nil)
  }

  @objc(updatePayload:resolver:rejecter:)
  func updatePayload(_ base64: String,
                     resolver resolve: @escaping RCTPromiseResolveBlock,
                     rejecter reject: @escaping RCTPromiseRejectBlock) {
    if let data = Data(base64Encoded: base64) {
      currentPayload = data
      if let ch = payloadChar {
        // nil centrals == notify everyone subscribed.
        manager?.updateValue(data, for: ch, onSubscribedCentrals: nil)
      }
    }
    resolve(nil)
  }

  /**
   * Notify a message frame to centrals subscribed to the MESSAGE characteristic.
   * Frames are pre-chunked to the negotiated size in JS (messaging.ts). Returns
   * whether CoreBluetooth accepted the value; a false means the transmit queue is
   * full and JS should retry (the ack/retransmit layer covers this too).
   */
  @objc(notifyMessage:resolver:rejecter:)
  func notifyMessage(_ base64: String,
                     resolver resolve: @escaping RCTPromiseResolveBlock,
                     rejecter reject: @escaping RCTPromiseRejectBlock) {
    guard let data = Data(base64Encoded: base64) else {
      reject("INVALID_BASE64", "Frame failed to decode", nil)
      return
    }
    guard let ch = messageChar, let mgr = manager else {
      resolve(false) // not running
      return
    }
    let ok = mgr.updateValue(data, for: ch, onSubscribedCentrals: nil)
    resolve(ok)
  }

  @objc(stopPeripheral:rejecter:)
  func stopPeripheral(_ resolve: @escaping RCTPromiseResolveBlock,
                      rejecter reject: @escaping RCTPromiseRejectBlock) {
    wantAdvertising = false
    manager?.stopAdvertising()
    manager?.removeAllServices()
    serviceAdded = false
    subscriberCount = 0
    resolve(nil)
  }

  @objc(getStatus:rejecter:)
  func getStatus(_ resolve: @escaping RCTPromiseResolveBlock,
                 rejecter reject: @escaping RCTPromiseRejectBlock) {
    let running = manager?.isAdvertising ?? false
    resolve(["running": running, "subscribers": subscriberCount])
  }

  // MARK: - Internals

  private func setupAndAdvertise() {
    guard let manager = manager, manager.state == .poweredOn, wantAdvertising else { return }
    if !serviceAdded {
      let ch = CBMutableCharacteristic(
        type: charUUID,
        properties: [.read, .notify],
        value: nil,
        permissions: [.readable]
      )
      let msg = CBMutableCharacteristic(
        type: msgCharUUID,
        properties: [.write, .writeWithoutResponse, .notify],
        value: nil,
        permissions: [.writeable]
      )
      let service = CBMutableService(type: serviceUUID, primary: true)
      service.characteristics = [ch, msg]
      payloadChar = ch
      messageChar = msg
      manager.add(service) // advertising starts in didAdd, once the service exists
    } else if !manager.isAdvertising {
      manager.startAdvertising([CBAdvertisementDataServiceUUIDsKey: [serviceUUID]])
    }
  }

  // MARK: - CBPeripheralManagerDelegate

  func peripheralManagerDidUpdateState(_ peripheral: CBPeripheralManager) {
    if peripheral.state == .poweredOn && wantAdvertising { setupAndAdvertise() }
  }

  func peripheralManager(_ peripheral: CBPeripheralManager, didAdd service: CBService, error: Error?) {
    guard error == nil else { return }
    serviceAdded = true
    peripheral.startAdvertising([CBAdvertisementDataServiceUUIDsKey: [serviceUUID]])
  }

  func peripheralManager(_ peripheral: CBPeripheralManager, didReceiveRead request: CBATTRequest) {
    guard request.characteristic.uuid == charUUID else {
      peripheral.respond(to: request, withResult: .attributeNotFound)
      return
    }
    if request.offset > currentPayload.count {
      peripheral.respond(to: request, withResult: .invalidOffset)
      return
    }
    request.value = currentPayload.subdata(in: request.offset ..< currentPayload.count)
    peripheral.respond(to: request, withResult: .success)
  }

  func peripheralManager(_ peripheral: CBPeripheralManager, didReceiveWrite requests: [CBATTRequest]) {
    for request in requests where request.characteristic.uuid == msgCharUUID {
      if let value = request.value, !value.isEmpty {
        emit("BlePeripheral:message", ["data": value.base64EncodedString()])
      }
    }
    // Ack the first request (CoreBluetooth applies the result to the batch).
    if let first = requests.first {
      peripheral.respond(to: first, withResult: .success)
    }
  }

  func peripheralManager(_ peripheral: CBPeripheralManager,
                         central: CBCentral,
                         didSubscribeTo characteristic: CBCharacteristic) {
    if characteristic.uuid == msgCharUUID {
      // The max bytes one notify can carry — JS chunks message frames to this.
      emit("BlePeripheral:mtu", ["mtu": central.maximumUpdateValueLength])
      return
    }
    subscriberCount += 1
    // Push the current payload immediately so the central doesn't wait for the next update.
    if let ch = payloadChar { peripheral.updateValue(currentPayload, for: ch, onSubscribedCentrals: [central]) }
  }

  func peripheralManager(_ peripheral: CBPeripheralManager,
                         central: CBCentral,
                         didUnsubscribeFrom characteristic: CBCharacteristic) {
    if characteristic.uuid == charUUID {
      subscriberCount = max(0, subscriberCount - 1)
    }
  }
}
