/* eslint-env node */
require("@rushstack/eslint-patch/modern-module-resolution");

module.exports = {
  root: true,
  extends: [
    "plugin:vue/vue3-essential",
    "eslint:recommended",
    "@vue/eslint-config-typescript",
    "@vue/eslint-config-prettier",
  ],
  overrides: [
    {
      files: ["cypress/e2e/**/*.{cy,spec}.{js,ts,jsx,tsx}"],
      extends: ["plugin:cypress/recommended"],
    },
  ],
  rules: {
    "vue/max-attributes-per-line": [
      1,
      {
        singleline: {
          max: 2,
        },
        multiline: {
          max: 1,
        },
      },
    ],
    "prettier/prettier": [
      "error",
      {
        endOfLine: "auto",
      },
    ],
    "no-unused-imports": "error",
  },
  parserOptions: {
    ecmaVersion: "latest",
  },
};
