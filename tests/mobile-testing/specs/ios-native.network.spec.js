const { networkSuite } = require('../utils/rumChecks');
const cfg = require('../utils/config');

// A URLSession built with the instrumented O2SessionDelegate is tracked by the SDK, so requests are
// captured as RUM `resource` events (a 200 to jsonplaceholder and a 404 for the negative assertion).
networkSuite({
  name: 'iOS-native · Network / resource tracking',
  tags: ['@mobile', '@ios-native'],
  service: cfg.NATIVE_IOS_SERVICE,
  urlSubstring: 'jsonplaceholder.typicode.com',
  flows: ['ios-native/network.yaml'],
  device: cfg.IOS_SIM_UDID,
});
