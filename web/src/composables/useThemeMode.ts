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

import { switchThemeMode } from "@/utils/theme";

/** The one sequence that flips the theme: storage, the html class for the O2 library, then the store. */
export function applyThemeMode(
  mode: "light" | "dark",
  store: { dispatch: (a: string, p: unknown) => unknown },
): void {
  try {
    localStorage.setItem("theme", mode);
  } catch {
    // Storage unavailable: the in-memory theme still flips for this session.
  }
  switchThemeMode(mode, () => {
    document.documentElement.classList.toggle("dark", mode === "dark");
    store.dispatch("appTheme", mode);
  });
}
