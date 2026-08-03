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

/** Run a flow file under maestro/. Returns { ok }. Throws on non-zero unless throwOnFail=false. */
function runFlow(relativeFlowPath, { throwOnFail = true } = {}) {
  const flow = path.join(__dirname, '..', 'maestro', relativeFlowPath);
  try {
    execFileSync(MAESTRO_BIN, ['test', flow], {
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
