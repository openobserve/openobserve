// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import type { Preview } from "@storybook/vue3-vite";
import { setup } from "@storybook/vue3-vite";
import { withThemeByClassName } from "@storybook/addon-themes";
import { createRouter, createMemoryHistory } from "vue-router";

import store from "../src/stores";
import i18n from "../src/locales";
import { applyThemeForMode, bootstrapTheme } from "../src/utils/themeManager";

// The app's Tailwind v4 entry — design tokens (`--color-*`), the palette reset,
// and every utility class. Importing it here makes O2 components render with
// their real styling. `.dark` on <html> (toggled by the theme switcher below)
// drives dark mode, exactly as in the app.
import "../src/styles/tailwind.css";

// Minimal router so components that call `useRoute` / `useRouter` or render a
// RouterLink (e.g. ORouteTab) have the injection they need. A single catch-all
// route keeps navigation inert — no app auth guards, no redirects.
const router = createRouter({
  history: createMemoryHistory(),
  routes: [{ path: "/:pathMatch(.*)*", component: { template: "<div />" } }],
});

setup((app) => {
  app.use(store);
  app.use(i18n);
  app.use(router);
  // Apply the app's default theme palette (utils/theme.ts derives the full
  // --color-primary-* ramp + accent tokens from the default theme colour at
  // runtime; without this the CSS carries only the static fallback).
  bootstrapTheme();
});

const preview: Preview = {
  parameters: {
    layout: "centered",
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    backgrounds: { disable: true },
  },
  decorators: [
    // Re-derive the O2 palette for the selected mode (utils/theme.ts sets the
    // primary ramp + accent tokens per light/dark at runtime). Runs alongside
    // the class toggle below so both the `.dark` class and the JS-applied
    // tokens stay in sync with the toolbar.
    (story, context) => {
      const mode = context.globals.theme === "dark" ? "dark" : "light";
      applyThemeForMode(mode, store);
      return story();
    },
    // Toolbar toggle that adds/removes `.dark` on the preview <html>, matching
    // how utils/theme.ts switches the app between light and dark.
    withThemeByClassName({
      themes: { light: "", dark: "dark" },
      defaultTheme: "light",
    }),
  ],
};

export default preview;
