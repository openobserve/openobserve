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

// The user's theme choice ("system" follows the OS). localStorage "theme" keeps
// holding the resolved light/dark mode, because many readers use it directly.
export type ThemePreference = "system" | "light" | "dark";

const PREF_KEY = "themePreference";
const DARK_QUERY = "(prefers-color-scheme: dark)";

const read = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

/** Saved choice; someone who once picked light or dark keeps it, everyone else follows the OS. */
export const getThemePreference = (): ThemePreference => {
  const pref = read(PREF_KEY);
  if (pref === "system" || pref === "light" || pref === "dark") return pref;
  const legacy = read("theme");
  return legacy === "light" || legacy === "dark" ? legacy : "system";
};

export const systemThemeMode = (): "light" | "dark" =>
  typeof window !== "undefined" && window.matchMedia?.(DARK_QUERY).matches ? "dark" : "light";

export const resolveThemeMode = (pref: ThemePreference = getThemePreference()): "light" | "dark" =>
  pref === "system" ? systemThemeMode() : pref;

export const setThemePreference = (pref: ThemePreference): void => {
  try {
    localStorage.setItem(PREF_KEY, pref);
  } catch {
    // Storage blocked: the choice lasts for this page only.
  }
};

/** Calls back with the new mode whenever the OS theme flips while the preference is "system". */
export const watchSystemTheme = (onChange: (mode: "light" | "dark") => void): (() => void) => {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const media = window.matchMedia(DARK_QUERY);
  const listener = () => {
    if (getThemePreference() === "system") onChange(media.matches ? "dark" : "light");
  };
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
};
