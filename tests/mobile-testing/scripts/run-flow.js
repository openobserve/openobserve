// Run a single Maestro flow by name (no assertions) — handy for manual repro.
//   node scripts/run-flow.js crash
const { runFlow } = require('../utils/maestro');

const name = process.argv[2];
if (!name) {
  console.error('usage: node scripts/run-flow.js <flow-name>   e.g. crash | network | masking');
  process.exit(1);
}
runFlow(`react-native/${name}.yaml`);
