// Fixes a build-blocking bug in @openobserve/mobile-react-native-session-replay@0.1.0-alpha.5:
// android/build.gradle references the un-rebranded ':datadog_mobile-react-native' project, which
// does not exist (the module is ':openobserve_mobile-react-native'), so assembleRelease fails.
// Reported in o2-enterprise#2289. Runs on postinstall; idempotent.
const fs = require('fs');
const path = require('path');

const target = path.join(
  __dirname,
  '..',
  'node_modules',
  '@openobserve',
  'mobile-react-native-session-replay',
  'android',
  'build.gradle',
);

if (!fs.existsSync(target)) {
  console.log('[patch-sdk] session-replay build.gradle not found — skipping');
  process.exit(0);
}

const src = fs.readFileSync(target, 'utf8');
const fixed = src.replace(/:datadog_mobile-react-native/g, ':openobserve_mobile-react-native');
if (fixed !== src) {
  fs.writeFileSync(target, fixed);
  console.log('[patch-sdk] fixed session-replay build.gradle project reference (o2-enterprise#2289)');
} else {
  console.log('[patch-sdk] session-replay build.gradle already correct');
}

// The core SDK ships a required postinstall (replace-react-require) that some npm
// configs block (allow-scripts). Run it here so the app works regardless of env.
const rrr = path.join(
  __dirname,
  '..',
  'node_modules',
  '@openobserve',
  'mobile-react-native',
  'scripts',
  'replace-react-require.js',
);
if (fs.existsSync(rrr)) {
  try {
    require(rrr);
    console.log('[patch-sdk] ran SDK replace-react-require');
  } catch (e) {
    console.log('[patch-sdk] replace-react-require skipped:', e.message);
  }
}

// iOS build-blocker (o2-enterprise#2289): the session-replay package's Swift code
// calls the un-rebranded Datadog method Int64.ddWithNoOverflow; the OpenObserve iOS
// SDK renamed it to ooWithNoOverflow. Fix it so `pod install` + xcodebuild succeed.
const iosRecorder = path.join(
  __dirname,
  '..',
  'node_modules',
  '@openobserve',
  'mobile-react-native-session-replay',
  'ios',
  'Sources',
  'RCTTextViewRecorder.swift',
);
if (fs.existsSync(iosRecorder)) {
  const s = fs.readFileSync(iosRecorder, 'utf8');
  const fixed = s.replace(/ddWithNoOverflow/g, 'ooWithNoOverflow');
  if (fixed !== s) {
    fs.writeFileSync(iosRecorder, fixed);
    console.log('[patch-sdk] fixed iOS session-replay ddWithNoOverflow (o2-enterprise#2289)');
  } else {
    console.log('[patch-sdk] iOS session-replay already correct');
  }
}
