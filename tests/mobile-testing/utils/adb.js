// Thin wrapper over the Android Debug Bridge for device-level steps the Maestro flows
// can't express — backgrounding, resuming a process, pulling the installed APK. Keeps raw
// `adb` invocations (and the ANDROID_HOME/path plumbing) out of the spec files.
const { execSync } = require('child_process');
const path = require('path');

const ANDROID_HOME = process.env.ANDROID_HOME || '/opt/homebrew/share/android-commandlinetools';
const ADB = path.join(ANDROID_HOME, 'platform-tools', 'adb');

/** Run an adb shell command (output discarded). */
function shell(cmd) {
  execSync(`"${ADB}" shell ${cmd}`, { stdio: 'ignore' });
}

/** Press a hardware key, e.g. 'KEYCODE_HOME'. */
function keyevent(code) {
  shell(`input keyevent ${code}`);
}

/** Resume an activity in the running process (am start does NOT force-stop). */
function startActivity(component) {
  shell(`am start -n ${component}`);
}

/** Absolute path of the installed APK for a package (from `pm path`). */
function apkPath(appId) {
  return execSync(`"${ADB}" shell pm path ${appId}`)
    .toString()
    .split('\n')[0]
    .replace(/^package:/, '')
    .trim();
}

/** Pull a device file to a local path. */
function pull(remote, local) {
  execSync(`"${ADB}" pull "${remote}" "${local}"`, { stdio: 'ignore' });
}

module.exports = { ADB, ANDROID_HOME, shell, keyevent, startActivity, apkPath, pull };
