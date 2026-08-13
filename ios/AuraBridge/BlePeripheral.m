//
// React Native bridge for the Swift BlePeripheral class (BlePeripheral.swift).
// Exposes it to JS as NativeModules.BlePeripheral — the iOS GATT peripheral for
// the interop path (docs/GATT_SPEC.md, P-i2b). See src/ble/gatt/iosPeripheral.ts.
//
#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

// Subclasses RCTEventEmitter so inbound message frames + notify-size are pushed to
// JS as 'BlePeripheral:message' / 'BlePeripheral:mtu' events.
@interface RCT_EXTERN_MODULE(BlePeripheral, RCTEventEmitter)

RCT_EXTERN_METHOD(startPeripheral:(NSString *)base64
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(updatePayload:(NSString *)base64
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(notifyMessage:(NSString *)base64
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(stopPeripheral:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(getStatus:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

+ (BOOL)requiresMainQueueSetup { return NO; }

@end
