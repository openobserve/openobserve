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

import { vi } from "vitest";
import type { RouteLocationRaw, Router } from "vue-router";

/** A router whose push lands at once: it writes the pushed history state, as a real navigation does. */
export const landingRouter = () => {
  const push = vi.fn((to: RouteLocationRaw) => {
    const state = typeof to === "object" && "state" in to ? to.state : undefined;
    window.history.replaceState({ ...(state ?? {}) }, "");
    return Promise.resolve();
  });
  return { router: { push } as unknown as Router, push };
};

/** Moves to a page without a restore, such as a link, a reload or a second tab's navigation. */
export const landWithoutRestore = () => window.history.replaceState({}, "");
