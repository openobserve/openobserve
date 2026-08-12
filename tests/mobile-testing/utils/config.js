// Central config for the mobile-testing suite. Loads .env once.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const need = (k) => {
  const v = process.env[k];
  if (!v) throw new Error(`Missing env var ${k} — copy .env.example to .env and fill it in.`);
  return v;
};

module.exports = {
  OO_URL: need('OO_URL').replace(/\/$/, ''),
  OO_ORG: need('OO_ORG'),
  OO_USER: need('OO_USER'),
  OO_PASS: need('OO_PASS'),
  RN_ENV: process.env.RN_ENV || 'production',
  RUM_STREAM: '_rumdata',

  // Per-platform app ids + service names (the RN app is one service across both platforms;
  // distinguish RN-iOS vs RN-Android by `source`/`os`, natives have their own service).
  RN_SERVICE: process.env.RN_SERVICE || 'o2-rum-tester',
  RN_ANDROID_APP_ID: process.env.RN_ANDROID_APP_ID || 'com.o2rumtester',
  RN_IOS_APP_ID: process.env.RN_IOS_APP_ID || 'org.reactjs.native.example.O2RumTester',

  NATIVE_ANDROID_SERVICE: process.env.NATIVE_ANDROID_SERVICE || 'o2-native-android',
  NATIVE_ANDROID_APP_ID: process.env.NATIVE_ANDROID_APP_ID || 'com.o2native',

  NATIVE_IOS_SERVICE: process.env.NATIVE_IOS_SERVICE || 'o2-native-ios',
  NATIVE_IOS_APP_ID: process.env.NATIVE_IOS_APP_ID || 'com.o2native.ios',

  // Maestro needs a device id for iOS; Android uses the single attached emulator.
  IOS_SIM_UDID: process.env.IOS_SIM_UDID || '',
};
