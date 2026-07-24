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

import type { StorybookConfig } from "@storybook/vue3-vite";
import { fileURLToPath } from "node:url";
import Icons from "unplugin-icons/vite";

/**
 * Storybook for the O2 component library (web/src/lib).
 *
 * The preview is deliberately wired to the SAME runtime the app uses — the
 * app's Tailwind entry (design tokens + utilities), the OIcon `~icons/*`
 * resolver, and the `@`/`@enterprise` path aliases — so every story renders in
 * pixel-parity with production. Tailwind v4 itself is applied through the
 * project's root postcss.config.js, which the Vite builder picks up
 * automatically; only the icon plugin and aliases need re-declaring here.
 */
const config: StorybookConfig = {
  stories: ["../src/lib/**/*.stories.@(ts|tsx|js|jsx)"],
  addons: ["@storybook/addon-themes"],
  framework: {
    name: "@storybook/vue3-vite",
    options: {
      // Disable auto-docgen: it injects `object` controls for every array /
      // object / function prop (data, columns, getRowStyle, …) and for slots,
      // events and exposed methods — overriding the explicit `control: false`
      // each story declares. Clicking one of those "Set object" buttons sets
      // the prop to `{}` where the component expects an array/function, which
      // throws and blanks the story. Each story already declares full argTypes
      // (with descriptions), so nothing useful is lost.
      docgen: false,
    },
  },
  core: {
    disableTelemetry: true,
  },
  async viteFinal(cfg) {
    cfg.resolve = cfg.resolve ?? {};
    cfg.resolve.alias = {
      ...(cfg.resolve.alias || {}),
      "@": fileURLToPath(new URL("../src", import.meta.url)),
      "@enterprise": fileURLToPath(new URL("../src/enterprise", import.meta.url)),
    };
    cfg.plugins = cfg.plugins ?? [];
    // Mirror the app's on-demand SVG icon resolver so OIcon's `~icons/*`
    // imports resolve inside Storybook exactly as they do in the app build.
    cfg.plugins.push(Icons({ compiler: "vue3", autoInstall: false }));
    return cfg;
  },
};

export default config;
