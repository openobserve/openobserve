const { networkSuite } = require('../utils/rumChecks');
const cfg = require('../utils/config');

// The app's OkHttpClient is instrumented with OpenObserveInterceptor, so requests are captured as
// RUM `resource` events (a 200 to jsonplaceholder and a 404 for the negative status assertion).
networkSuite({
  name: 'Android-native · Network / resource tracking',
  tags: ['@mobile', '@android-native'],
  service: cfg.NATIVE_ANDROID_SERVICE,
  urlSubstring: 'jsonplaceholder.typicode.com',
  flows: ['android-native/network.yaml'],
});
