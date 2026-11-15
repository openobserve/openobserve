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

const STORAGE_KEY = "o2.topBar";

/** What the top bar showed once settled, so a reload draws it at that width before the config and org list arrive. */
export interface TopBarMemory {
  aiButton?: boolean;
  org?: { identifier: string; label: string };
}

export function readTopBarMemory(): TopBarMemory {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}");
    return parsed && typeof parsed === "object" ? (parsed as TopBarMemory) : {};
  } catch {
    return {};
  }
}

export function rememberTopBar(patch: TopBarMemory): void {
  const next = { ...readTopBarMemory(), ...patch };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Without storage the bar only reserves less on the next reload.
  }
}
