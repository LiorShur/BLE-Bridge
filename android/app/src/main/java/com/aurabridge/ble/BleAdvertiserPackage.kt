package com.aurabridge.ble

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

/**
 * Registers [BleAdvertiserModule]. Add to the host's package list in
 * MainApplication (see BUILD.md):
 *
 *   override fun getPackages(): List<ReactPackage> =
 *       PackageList(this).packages.apply { add(BleAdvertiserPackage()) }
 */
class BleAdvertiserPackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
      listOf(BleAdvertiserModule(reactContext), HeadingModule(reactContext))

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> =
      emptyList()
}
