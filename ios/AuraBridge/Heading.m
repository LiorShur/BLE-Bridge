//
// React Native bridge for the Swift Heading class (Heading.swift).
// Exposes it to JS as NativeModules.Heading — the iOS compass source for the
// alignment gate (CLAUDE.md §4.3). Consumed by src/sensors/useCompassHeading.ts,
// which is shared with Android's HeadingModule.kt.
//
// RCT_EXTERN_MODULE names the Swift class; because Heading subclasses
// RCTEventEmitter, JS wraps it in a NativeEventEmitter and receives
// `Heading:update` events.
//
#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

@interface RCT_EXTERN_MODULE(Heading, RCTEventEmitter)

RCT_EXTERN_METHOD(start:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(stop:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end
