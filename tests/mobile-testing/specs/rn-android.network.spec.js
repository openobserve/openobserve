const { networkSuite } = require('../utils/rumChecks');
const cfg = require('../utils/config');

networkSuite({
  name: 'RN Android · Network / resource tracking (A4)',
  tags: ['@mobile', '@rn-android'],
  service: cfg.RN_SERVICE,
  urlSubstring: 'jsonplaceholder.typicode.com',
  flows: ['react-native/network.yaml'],
});
