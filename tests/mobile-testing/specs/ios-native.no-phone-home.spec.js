const { noPhoneHomeIosSuite } = require('../utils/rumChecks');
const cfg = require('../utils/config');

// Negative/security: the OpenObserve iOS SDK is a Datadog fork, so prove the built app ships ZERO
// Datadog intake hosts (they were stripped) — scanned from the installed .app bundle.
noPhoneHomeIosSuite({
  name: 'iOS-native · No phone-home (no Datadog hosts)',
  tags: ['@mobile', '@ios-native'],
  appId: cfg.NATIVE_IOS_APP_ID,
  device: cfg.IOS_SIM_UDID,
});
