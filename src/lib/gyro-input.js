/**
 * Gyroscope / Mouse Input Handler
 *
 * Single source of tilt data for the entire app.
 * Used by both HoloLogo and HoloCard components.
 */

export function createGyroInput(config = {}) {
  let xP = 50, yP = 50; // percentage 0-100
  let gyroAvailable = false;
  let listeners = [];
  let permissionGranted = false;
  let permissionRequested = false;

  const deadZone = config.deadZone || 0.15;
  const rampPower = config.rampPower || 1.8;

  function computeDerived(rawX, rawY) {
    const angle = Math.atan2(rawY - 50, rawX - 50) * (180 / Math.PI) + 180;
    const rawTiltDist = Math.sqrt((rawX - 50) ** 2 + (rawY - 50) ** 2) / 50;

    // Dead zone + ramp curve
    const effectiveTilt = rawTiltDist <= deadZone
      ? 0
      : Math.pow((rawTiltDist - deadZone) / (1 - deadZone), rampPower);

    return { xP: rawX, yP: rawY, angle, tiltDist: effectiveTilt, rawTiltDist };
  }

  function notify(rawX, rawY) {
    xP = rawX;
    yP = rawY;
    const data = computeDerived(rawX, rawY);
    listeners.forEach(fn => fn(data));
  }

  // Mouse (desktop fallback)
  function handleMouseMove(e) {
    if (gyroAvailable) return;
    notify(
      (e.clientX / window.innerWidth) * 100,
      (e.clientY / window.innerHeight) * 100
    );
  }

  // Touch move (mobile fallback when gyro unavailable)
  function handleTouchMove(e) {
    if (gyroAvailable) return;
    const touch = e.touches[0];
    if (touch) {
      notify(
        (touch.clientX / window.innerWidth) * 100,
        (touch.clientY / window.innerHeight) * 100
      );
    }
  }

  // Gyroscope (mobile)
  function handleGyro(e) {
    gyroAvailable = true;
    const x = Math.max(0, Math.min(100, 50 + (e.gamma || 0) * 1.5));
    const y = Math.max(0, Math.min(100, 50 + ((e.beta || 0) - 40) * 1.2));
    notify(x, y);
  }

  // iOS permission request - must be triggered by user gesture
  function requestPermission() {
    if (permissionGranted) return Promise.resolve('already_granted');

    if (typeof DeviceOrientationEvent !== 'undefined' &&
        typeof DeviceOrientationEvent.requestPermission === 'function') {
      // iOS 13+ requires permission request
      return DeviceOrientationEvent.requestPermission()
        .then(r => {
          if (r === 'granted') {
            permissionGranted = true;
            window.addEventListener('deviceorientation', handleGyro);
          }
          return r;
        })
        .catch(err => {
          console.warn('[GyroInput] Permission request failed:', err);
          return 'denied';
        });
    } else if (typeof DeviceOrientationEvent !== 'undefined') {
      // Android and older iOS - no permission needed
      permissionGranted = true;
      window.addEventListener('deviceorientation', handleGyro);
      return Promise.resolve('granted');
    }
    return Promise.resolve('unavailable');
  }

  // Auto-request permission on first touch (for iOS)
  function handleFirstTouch() {
    if (permissionRequested) return;
    permissionRequested = true;
    requestPermission();
    document.removeEventListener('touchstart', handleFirstTouch);
  }

  function subscribe(fn) {
    listeners.push(fn);
    // Immediately call with current state
    fn(computeDerived(xP, yP));
    return () => {
      listeners = listeners.filter(l => l !== fn);
    };
  }

  function getCurrentTilt() {
    return computeDerived(xP, yP);
  }

  function isGyroAvailable() {
    return gyroAvailable;
  }

  // Initialize listeners
  if (typeof document !== 'undefined') {
    // Mouse for desktop
    document.addEventListener('mousemove', handleMouseMove);

    // Touch move for mobile fallback
    document.addEventListener('touchmove', handleTouchMove, { passive: true });

    // Check if iOS needs permission or if we can auto-init
    if (typeof DeviceOrientationEvent !== 'undefined') {
      if (typeof DeviceOrientationEvent.requestPermission === 'function') {
        // iOS 13+ - need to wait for user gesture
        document.addEventListener('touchstart', handleFirstTouch, { once: true });
      } else {
        // Android / older iOS - can init immediately
        window.addEventListener('deviceorientation', handleGyro);
        permissionGranted = true;
      }
    }
  }

  return {
    subscribe,
    requestPermission,
    getCurrentTilt,
    isGyroAvailable,
  };
}

// Singleton instance
let gyroInputInstance = null;

export function getGyroInput(config = {}) {
  if (!gyroInputInstance) {
    gyroInputInstance = createGyroInput(config);
  }
  return gyroInputInstance;
}

export default { createGyroInput, getGyroInput };
