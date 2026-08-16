//
// React Native bridge for the Swift Sound class (Sound.swift).
// Exposes it to JS as NativeModules.Sound — iOS audio + haptic cues matching
// Android's SoundModule.kt. Consumed by src/audio/sound.ts.
//
#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(Sound, NSObject)

RCT_EXTERN_METHOD(formation)
RCT_EXTERN_METHOD(breakTone)
RCT_EXTERN_METHOD(send)
RCT_EXTERN_METHOD(receive)
RCT_EXTERN_METHOD(delivered)

+ (BOOL)requiresMainQueueSetup { return NO; }

@end
