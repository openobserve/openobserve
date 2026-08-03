const { test, expect } = require('@playwright/test');
const { runFlow } = require('../utils/maestro');
const { search, pollUntil } = require('../utils/ooClient');
const cfg = require('../utils/config');

const USER_EMAIL = 'alex.morgan@example.com';

test.describe('RN Android · User identity (setUser)', () => {
  test(
    'RUM events are attributed to the user set via setUserInfo',
    { tag: ['@mobile', '@rn-android', '@user-identity', '@P1'] },
    async () => {
      const start = Date.now() - 30000;

      // DRIVE — generate data (the app calls setUserInfo on init).
      runFlow('react-native/network.yaml');

      // API — events carry the user identity (usr_* fields), not "Unknown".
      const rows = await pollUntil(
        () =>
          search(
            `SELECT usr_email, usr_id, usr_name FROM ${cfg.RUM_STREAM} ` +
              `WHERE service='${cfg.RN_SERVICE}'`,
            start,
          ),
        (r) => r.some((x) => x.usr_email === USER_EMAIL),
        { tries: 20, delayMs: 5000 },
      );

      const withUser = rows.find((x) => x.usr_email === USER_EMAIL);
      expect(withUser, 'events attributed to the set user').toBeTruthy();
      expect(withUser.usr_email).toBe(USER_EMAIL);
    },
  );
});
