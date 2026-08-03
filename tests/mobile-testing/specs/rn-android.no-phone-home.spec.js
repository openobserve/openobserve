const { test, expect } = require('@playwright/test');
const { execSync } = require('child_process');
const os = require('os');
const path = require('path');
const cfg = require('../utils/config');

const ANDROID_HOME =
  process.env.ANDROID_HOME || '/opt/homebrew/share/android-commandlinetools';
const ADB = path.join(ANDROID_HOME, 'platform-tools', 'adb');

test.describe('RN Android · Security (no-phone-home)', () => {
  test(
    'the installed app contains zero Datadog hosts',
    { tag: ['@mobile', '@rn-android', '@security', '@no-phone-home', '@P0'] },
    async () => {
      // Locate + pull the installed APK.
      const apkPath = execSync(`"${ADB}" shell pm path ${cfg.RN_ANDROID_APP_ID}`)
        .toString()
        .split('\n')[0]
        .replace(/^package:/, '')
        .trim();
      expect(apkPath, 'app is installed').toContain('.apk');

      const tmp = path.join(os.tmpdir(), 'o2rumtester-nophonehome.apk');
      execSync(`"${ADB}" pull "${apkPath}" "${tmp}"`, { stdio: 'ignore' });

      // Scan the whole APK for any Datadog intake host.
      const hits = execSync(
        `unzip -p "${tmp}" | strings | ` +
          `grep -ioE 'datadoghq\\.(com|eu)|ddog-gov\\.com|browser-intake-datadoghq' | sort -u || true`,
      )
        .toString()
        .trim();

      expect(hits, `no Datadog hosts must be present (found: "${hits}")`).toBe('');
    },
  );
});
