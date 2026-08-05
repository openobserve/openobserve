const { networkSuite } = require('../utils/rumChecks');
const cfg = require('../utils/config');

networkSuite({
  name: 'RN iOS · Network / resource tracking (A4)',
  tags: ['@mobile', '@rn-ios'],
  service: cfg.RN_SERVICE,
  urlSubstring: 'jsonplaceholder.typicode.com',
  flows: ['ios-react-native/network.yaml'],
  device: cfg.IOS_SIM_UDID,
});
