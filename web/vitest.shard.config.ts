import config from "./vitest.config";
import DurationSequencer from "./scripts/ui-tests/sequencer";

export default {
  ...config,
  test: {
    ...config.test,
    logHeapUsage: true,
    reporters: ["default", "./scripts/ui-tests/reporter.ts"],
    sequence: { sequencer: DurationSequencer },
    coverage: {
      ...config.test?.coverage,
      // Only the merged coverage map can satisfy the whole-suite thresholds.
      thresholds: undefined,
      reporter: [],
    },
  },
};
