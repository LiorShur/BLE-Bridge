import Foundation
import CoreBluetooth

/**
 * iOS GATT peripheral for the interop path (docs/GATT_SPEC.md), P-i2b.
 *
 * iOS cannot advertise manufacturer data, so the iPhone makes itself discoverable
 * by advertising the Bridge SERVICE UUID and exposes its 24-byte payload as a
 * read+notify characteristic. An Android central discovers the service UUID,
 * connects, and reads/subscribes — the mirror of what the Android GATT server
 * does for the Android side.
 *
 * One CBPeripheralManager does BOTH advertising and the GATT server on iOS.
 *
 * Exposed to React Native as NativeModules.BlePeripheral (see BlePeripheral.m).
 * The RCTPromise* / RCT* types are provided via the bridging header
 * (#import <React/RCTBridgeModule.h>), so no `import React` is needed here.
 */
@objc(BlePeripheral)
class BlePeripheral: NSObject, CBPeripheralManagerDelegate {

  private var manager: CBPeripheralManager?
  private let serviceUUID = CBUUID(string: "A0E1B5D2-7C3F-4E8A-9B10-2F6C1D4E7A90")
  private let charUUID = CBUUID(string: "A0E1B5D2-7C3F-4E8A-9B10-2F6C1D4E7A91")
  private var payloadChar: CBMutableCharacteristic?
  private var currentPayload = Data()
  private var wantAdvertising = false
  private var serviceAdded = false
  private var subscriberCount = 0

  @objc static func requiresMainQueueSetup() -> Bool { return false }

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
      let service = CBMutableService(type: serviceUUID, primary: true)
      service.characteristics = [ch]
      payloadChar = ch
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

  func peripheralManager(_ peripheral: CBPeripheralManager,
                         central: CBCentral,
                         didSubscribeTo characteristic: CBCharacteristic) {
    subscriberCount += 1
    // Push the current value immediately so the central doesn't wait for the next update.
    if let ch = payloadChar { peripheral.updateValue(currentPayload, for: ch, onSubscribedCentrals: [central]) }
  }

  func peripheralManager(_ peripheral: CBPeripheralManager,
                         central: CBCentral,
                         didUnsubscribeFrom characteristic: CBCharacteristic) {
    subscriberCount = max(0, subscriberCount - 1)
  }
}
