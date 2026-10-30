import config from "./vitest.config";

export default {
  ...config,
  test: {
    ...config.test,
    coverage: {
      ...config.test?.coverage,
      reporter: ["json-summary", "text-summary"],
    },
  },
};
