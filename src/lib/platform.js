/**
 * Where the app is running. The web app and the iOS app build from the same code; the
 * native shell (Capacitor) exposes `window.Capacitor`. Anything that must differ by platform
 * (how purchases are made, where the camera comes from) asks here, nowhere else.
 */
export function isNativeApp() {
  try { return Boolean(globalThis.Capacitor?.isNativePlatform?.()); } catch { return false; }
}
export function isIOSApp() {
  try { return isNativeApp() && globalThis.Capacitor?.getPlatform?.() === 'ios'; } catch { return false; }
}
