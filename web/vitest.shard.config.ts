import config from "./vitest.config";

export default {
  ...config,
  test: {
    ...config.test,
    reporters: ["default", "blob"],
    coverage: {
      ...config.test?.coverage,
      // Only the merged coverage map can satisfy the whole-suite thresholds.
      thresholds: undefined,
      reporter: [],
    },
  },
};
