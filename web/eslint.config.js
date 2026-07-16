import vue from "eslint-plugin-vue";
import js from "@eslint/js";
import typescript from "@typescript-eslint/eslint-plugin";
import typescriptParser from "@typescript-eslint/parser";
import vueParser from "vue-eslint-parser";
import prettier from "eslint-plugin-prettier";
import cypress from "eslint-plugin-cypress";
import fs from "fs";

// Read .gitignore to use as ignore patterns
const gitignore = fs.existsSync(".gitignore")
  ? fs
      .readFileSync(".gitignore", "utf8")
      .split("\n")
      .filter((line) => line.trim() && !line.startsWith("#"))
      .map((line) => line.trim())
  : [];

export default [
  js.configs.recommended,
  ...vue.configs["flat/essential"],
  {
    files: ["**/*.{js,mjs,cjs,ts,tsx,vue}"],
    ignores: [
      "node_modules/**",
      "dist/**",
      "coverage/**",
      ".vscode/**",
      "*.min.js",
      "packages/rrweb-player/**",
      ...gitignore,
    ],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parser: vueParser,
      parserOptions: {
        parser: typescriptParser,
        ecmaVersion: "latest",
        sourceType: "module",
      },
    },
    plugins: {
      vue,
      "@typescript-eslint": typescript,
      prettier,
    },
    rules: {
      // Disable noisy rules inherited from recommended configs
      "prettier/prettier": "off",
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "no-undef": "off",
      "no-prototype-builtins": "off",
      "no-async-promise-executor": "off",
      "no-empty": "off",
      "no-self-assign": "off",
      "no-useless-escape": "off",
      "no-redeclare": "off",
      "no-unsafe-optional-chaining": "off",
      "no-import-assign": "off",
      "no-useless-catch": "off",
      "no-unreachable": "off",
      "no-case-declarations": "off",
      "no-shadow-restricted-names": "off",
      "vue/max-attributes-per-line": "off",
      "vue/no-mutating-props": "off",
      "vue/no-unused-components": "off",
      "vue/no-dupe-keys": "off",
      "vue/no-side-effects-in-computed-properties": "off",
      "vue/require-valid-default-prop": "off",
      "vue/no-unused-vars": "off",
      "vue/no-use-v-if-with-v-for": "off",
      "vue/no-reserved-component-names": "off",
      "vue/valid-v-for": "off",
      "vue/valid-v-else-if": "off",
      "vue/require-v-for-key": "off",
      "vue/return-in-computed-property": "off",
      "vue/require-toggle-inside-transition": "off",
      "vue/no-deprecated-v-bind-sync": "off",
      "vue/no-parsing-error": "off",
      "vue/valid-next-tick": "off",
      "vue/no-v-text-v-html-on-component": "off",
      "vue/prefer-import-from-vue": "off",
      "vue/valid-attribute-name": "off",
      "vue/no-ref-as-operand": "off",
      "vue/multi-word-component-names": "off",

      // Enforced rules
      "vue/no-restricted-html-elements": [
        "error",
        // Dropdown / list
        {
          element: "q-menu",
          message:
            'Use <ODropdown> from "@/lib/overlay/Dropdown/ODropdown.vue" instead of <q-menu>.',
        },
        {
          element: "q-list",
          message:
            'Drop <q-list> inside <ODropdown> (not needed), or replace standalone <q-list> with a native <ul> / <div> + Tailwind.',
        },
        {
          element: "q-item",
          message:
            'Use <ODropdownItem> from "@/lib/overlay/Dropdown/ODropdownItem.vue" (inside <ODropdown>), or a native <li> / <div> + Tailwind (display rows).',
        },
        {
          element: "q-item-section",
          message:
            "Use <ODropdownItem>'s #icon-left / #default / #icon-right slots (inside <ODropdown>), or a native <div class=\"flex ...\"> (display).",
        },
        {
          element: "q-item-label",
          message:
            'Use plain text / <span class="text-sm">, <span class="block text-xs text-muted-foreground"> (caption), or <ODropdownGroup :label="..."> (header) instead of <q-item-label>.',
        },
        // Button
        {
          element: "q-btn",
          message: 'Use <OButton> from "@/lib/core/Button/OButton.vue" instead of <q-btn>.',
        },
        {
          element: "q-btn-group",
          message: 'Use <OButtonGroup> from "@/lib/core/Button/OButtonGroup.vue" instead of <q-btn-group>.',
        },
        {
          element: "q-btn-toggle",
          message: 'Use <OToggleGroup> from "@/lib/core/ToggleGroup/OToggleGroup.vue" instead of <q-btn-toggle>.',
        },
        {
          element: "q-btn-dropdown",
          message: 'Use <OButton> with <ODropdown> instead of <q-btn-dropdown>.',
        },
        // Tabs
        {
          element: "q-tabs",
          message: 'Use <OTabs> from "@/lib/navigation/Tabs/OTabs.vue" instead of <q-tabs>.',
        },
        {
          element: "q-tab",
          message: 'Use <OTab> from "@/lib/navigation/Tabs/OTab.vue" instead of <q-tab>.',
        },
        {
          element: "q-tab-panels",
          message: 'Use <OTabPanels> from "@/lib/navigation/Tabs/OTabPanels.vue" instead of <q-tab-panels>.',
        },
        {
          element: "q-tab-panel",
          message: 'Use <OTabPanel> from "@/lib/navigation/Tabs/OTabPanel.vue" instead of <q-tab-panel>.',
        },
        {
          element: "q-route-tab",
          message: 'Use <ORouteTab> from "@/lib/navigation/Tabs/ORouteTab.vue" instead of <q-route-tab>.',
        },
        // Toolbar / layout primitives
        {
          element: "q-bar",
          message: "Use a plain <div> instead of <q-bar>.",
        },
        {
          element: "q-toolbar",
          message: "Use a plain <div> instead of <q-toolbar>.",
        },
        {
          element: "q-toolbar-title",
          message: "Remove <q-toolbar-title> — use a plain <div> or <span> for the title content.",
        },
        // Icon
        {
          element: "q-icon",
          message: 'Use <OIcon> from "@/lib/core/Icon/OIcon.vue" instead of <q-icon>. To add a new icon update OIcon.icons.ts.',
        },
        // Overlay
        {
          element: "q-dialog",
          message: 'Use <ODialog> from "@/lib/overlay/Dialog/ODialog.vue" for modals, or <ODrawer> from "@/lib/overlay/Drawer/ODrawer.vue" for side-panel drawers, instead of <q-dialog>.',
        },
        {
          element: "q-tooltip",
          message: 'Use <OTooltip> from "@/lib/overlay/Tooltip/OTooltip.vue" instead of <q-tooltip>.',
        },
        {
          element: "q-drawer",
          message: 'Use <ODrawer> from "@/lib/overlay/Drawer/ODrawer.vue" instead of <q-drawer>.',
        },
        // Badge / chip / avatar / image
        {
          element: "q-badge",
          message: 'Use <OBadge> from "@/lib/core/Badge/OBadge.vue" instead of <q-badge>.',
        },
        {
          element: "q-chip",
          message: 'Use <OBadge> from "@/lib/core/Badge/OBadge.vue" instead of <q-chip>.',
        },
        {
          element: "q-avatar",
          message: 'Use a plain <div class="rounded-full ..."> wrapper with an inner <OIcon> or <img> instead of <q-avatar>.',
        },
        {
          element: "q-img",
          message: "Use a native <img> element instead of <q-img>. q-img features (lazy load, aspect-ratio, spinner) are not used anywhere in this codebase.",
        },
        // Card
        {
          element: "q-card",
          message: 'Use <OCard> from "@/lib/core/Card/OCard.vue" instead of <q-card>.',
        },
        {
          element: "q-card-actions",
          message: 'Use <OCardActions> from "@/lib/core/Card/OCardActions.vue" instead of <q-card-actions>.',
        },
        {
          element: "q-card-section",
          message: 'Use <OCardSection> from "@/lib/core/Card/OCardSection.vue" instead of <q-card-section>.',
        },
        // Collapsible / separator / splitter
        {
          element: "q-expansion-item",
          message: 'Use <OCollapsible> from "@/lib/core/Collapsible/OCollapsible.vue" instead of <q-expansion-item>.',
        },
        {
          element: "q-separator",
          message: 'Use <OSeparator> from "@/lib/core/Separator/OSeparator.vue" instead of <q-separator>.',
        },
        {
          element: "q-splitter",
          message: 'Use <OSplitter> from "@/lib/core/Splitter/OSplitter.vue" instead of <q-splitter>.',
        },
        // Navigation
        {
          element: "q-pagination",
          message: 'Use <OPagination> from "@/lib/navigation/Pagination/OPagination.vue" instead of <q-pagination>.',
        },
        {
          element: "q-stepper",
          message: 'Use <OStepper> from "@/lib/navigation/Stepper/OStepper.vue" instead of <q-stepper>.',
        },
        {
          element: "q-step",
          message: 'Use <OStep> from "@/lib/navigation/Stepper/OStep.vue" instead of <q-step>.',
        },
        {
          element: "q-stepper-navigation",
          message: "Remove <q-stepper-navigation> — place Back/Continue buttons in a single nav div outside </OStepper>.",
        },
        // Data display
        {
          element: "q-table",
          message: 'Use <OTable> from "@/lib/core/Table/OTable.vue" instead of <q-table>.',
        },
        {
          element: "q-timeline",
          message: 'Use <OTimeline> from "@/lib/data/Timeline/OTimeline.vue" instead of <q-timeline>.',
        },
        {
          element: "q-timeline-entry",
          message: 'Use <OTimelineItem> from "@/lib/data/Timeline/OTimelineItem.vue" instead of <q-timeline-entry>.',
        },
        {
          element: "q-tree",
          message: 'Use <OTree> from "@/lib/data/Tree/OTree.vue" instead of <q-tree>.',
        },
        {
          element: "q-virtual-scroll",
          message: 'Use <OVirtualScroll> from "@/lib/core/VirtualScroll/OVirtualScroll.vue" instead of <q-virtual-scroll>.',
        },
        // Feedback / loading
        {
          element: "q-spinner",
          message: 'Use <OSpinner> from "@/lib/feedback/Spinner/OSpinner.vue" instead of <q-spinner>.',
        },
        {
          element: "q-spinner-hourglass",
          message: 'Use <OSpinner> from "@/lib/feedback/Spinner/OSpinner.vue" instead of <q-spinner-hourglass>.',
        },
        {
          element: "q-spinner-dots",
          message: 'Use <OSpinner variant="dots"> from "@/lib/feedback/Spinner/OSpinner.vue" instead of <q-spinner-dots>.',
        },
        {
          element: "q-spinner-gears",
          message: 'Use <OSpinner> from "@/lib/feedback/Spinner/OSpinner.vue" instead of <q-spinner-gears>.',
        },
        {
          element: "q-circular-progress",
          message: 'Use <OSpinner> from "@/lib/feedback/Spinner/OSpinner.vue" instead of <q-circular-progress>.',
        },
        {
          element: "q-linear-progress",
          message: 'Use <OProgressBar> from "@/lib/data/ProgressBar/OProgressBar.vue" instead of <q-linear-progress>.',
        },
        {
          element: "q-inner-loading",
          message: 'Use <OInnerLoading> from "@/lib/feedback/InnerLoading/OInnerLoading.vue" instead of <q-inner-loading>.',
        },
        {
          element: "q-skeleton",
          message: 'Use <OSkeleton> from "@/lib/feedback/Skeleton/OSkeleton.vue" instead of <q-skeleton>.',
        },
        {
          element: "q-banner",
          message: 'Use <OBanner> from "@/lib/feedback/Banner/OBanner.vue" instead of <q-banner>.',
        },
        // Forms
        {
          element: "q-form",
          message: 'Use <OForm> from "@/lib/forms/Form/OForm.vue" instead of <q-form>.',
        },
        {
          element: "q-input",
          message: 'Use <OInput> from "@/lib/forms/Input/OInput.vue" instead of <q-input>. For textarea use <OTextarea>. For form-bound fields use <OFormInput> / <OFormTextarea>.',
        },
        {
          element: "q-select",
          message: 'Use <OSelect> from "@/lib/forms/Select/OSelect.vue" instead of <q-select>. For form-bound fields use <OFormSelect>.',
        },
        {
          element: "q-checkbox",
          message: 'Use <OCheckbox> / <OCheckboxGroup> from "@/lib/forms/Checkbox/OCheckbox.vue" instead of <q-checkbox>. For form-bound fields use <OFormCheckbox>.',
        },
        {
          element: "q-radio",
          message: 'Use <ORadio> inside <ORadioGroup> from "@/lib/forms/Radio/" instead of <q-radio>. Wrap items in <ORadioGroup v-model="...">.',
        },
        {
          element: "q-toggle",
          message: 'Use <OSwitch> from "@/lib/forms/Switch/OSwitch.vue" instead of <q-toggle>. For form-bound fields use <OFormSwitch>.',
        },
        {
          element: "q-slider",
          message: 'Use <OSlider> from "@/lib/forms/Slider/OSlider.vue" instead of <q-slider>. For form-bound fields use <OFormSlider>.',
        },
        {
          element: "q-range",
          message: 'Use <ORange> from "@/lib/forms/Range/ORange.vue" instead of <q-range>. For form-bound fields use <OFormRange>.',
        },
        {
          element: "q-file",
          message: 'Use <OFile> from "@/lib/forms/File/OFile.vue" instead of <q-file>. For form-bound fields use <OFormFile>.',
        },
        {
          element: "q-date",
          message: 'Use <ODate> from "@/lib/forms/Date/ODate.vue" instead of <q-date>. For form-bound fields use <OFormDate>.',
        },
        {
          element: "q-time",
          message: 'Use <OTime> from "@/lib/forms/Time/OTime.vue" instead of <q-time>. For form-bound fields use <OFormTime>.',
        },
        {
          element: "q-color",
          message: 'Use <OColor> from "@/lib/forms/Color/OColor.vue" instead of <q-color>. For form-bound fields use <OFormColor>.',
        },
        {
          element: "q-option-group",
          message: 'Use <OOptionGroup> from "@/lib/forms/OptionGroup/OOptionGroup.vue" instead of <q-option-group>. For form-bound fields use <OFormOptionGroup>.',
        },
      ],
    },
  },
  {
    files: ["cypress/e2e/**/*.{cy,spec}.{js,ts,jsx,tsx}"],
    plugins: {
      cypress,
    },
    rules: {
      ...cypress.configs.recommended.rules,
    },
  },
];
