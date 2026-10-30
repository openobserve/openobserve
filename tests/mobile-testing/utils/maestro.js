// Runs a Maestro flow (the "drive the app" layer). Cross-platform selectors by text,
// so flows are robust — no coordinate taps.
const { execFileSync } = require('child_process');
const path = require('path');
const os = require('os');

const MAESTRO_BIN = path.join(os.homedir(), '.maestro', 'bin', 'maestro');

function maestroEnv() {
  const androidHome = process.env.ANDROID_HOME || '/opt/homebrew/share/android-commandlinetools';
  const javaHome = process.env.JAVA_HOME || '/opt/homebrew/opt/openjdk@17';
  return {
    ...process.env,
    ANDROID_HOME: androidHome,
    ANDROID_SDK_ROOT: androidHome,
    JAVA_HOME: javaHome,
    PATH: [
      path.join(os.homedir(), '.maestro', 'bin'),
      path.join(javaHome, 'bin'),
      path.join(androidHome, 'platform-tools'),
      process.env.PATH,
    ].join(':'),
  };
}

/** First attached Android emulator (e.g. "emulator-5554"), or '' if none. */
function androidEmulator() {
  const androidHome = process.env.ANDROID_HOME || '/opt/homebrew/share/android-commandlinetools';
  try {
    const out = execFileSync(path.join(androidHome, 'platform-tools', 'adb'), ['devices'], {
      encoding: 'utf8',
    });
    const line = out.split('\n').find((l) => /^emulator-\d+\s+device/.test(l));
    return line ? line.split(/\s+/)[0] : '';
  } catch (e) {
    return '';
  }
}

/** Run a flow file under maestro/. Returns { ok }. Throws on non-zero unless throwOnFail=false. */
function runFlow(relativeFlowPath, { throwOnFail = true, device = '' } = {}) {
  const flow = path.join(__dirname, '..', 'maestro', relativeFlowPath);
  // iOS passes the simulator udid explicitly; Android flows default to the attached emulator
  // (needed because Maestro is ambiguous when a sim AND an emulator are both booted).
  const target = device || androidEmulator();
  const args = target ? ['--device', target, 'test', flow] : ['test', flow];
  try {
    execFileSync(MAESTRO_BIN, args, {
      env: maestroEnv(),
      stdio: 'inherit',
      timeout: 5 * 60 * 1000,
    });
    return { ok: true };
  } catch (e) {
    if (throwOnFail) throw new Error(`Maestro flow failed: ${relativeFlowPath}\n${e.message}`);
    return { ok: false };
  }
}

module.exports = { runFlow, MAESTRO_BIN };
