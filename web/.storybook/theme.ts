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

import { create } from "storybook/theming";

/**
 * Manager (chrome) theme — brands the sidebar, toolbar, and browser tab as the
 * OpenObserve Design System rather than stock Storybook. Colours mirror the
 * app's primary accent so the shell feels native.
 */
export default create({
  base: "light",
  brandTitle: "OpenObserve Design System",
  brandUrl: "https://openobserve.ai",
  brandTarget: "_blank",

  // Accent — the app's default primary.
  colorPrimary: "#5960b2",
  colorSecondary: "#5960b2",
});
