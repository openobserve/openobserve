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
  RN_ANDROID_APP_ID: process.env.RN_ANDROID_APP_ID || 'com.o2rumtester',
  RN_SERVICE: process.env.RN_SERVICE || 'o2-rum-tester',
  RN_ENV: process.env.RN_ENV || 'testing',
  RUM_STREAM: '_rumdata',
};
