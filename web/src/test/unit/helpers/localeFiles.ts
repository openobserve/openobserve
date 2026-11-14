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

import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export const LANGUAGES_DIR = resolve(__dirname, "../../../locales/languages");

/** Subdirectories that each hold one lazily loaded namespace of every locale (see locales/index.ts). */
export const SPLIT_LOCALE_DIRS = ["security"] as const;

/** Every file making up a locale: the main file, then one per split namespace. */
export const localeFilePaths = (stem: string): string[] => [
  resolve(LANGUAGES_DIR, `${stem}.json`),
  ...SPLIT_LOCALE_DIRS.map((dir) => resolve(LANGUAGES_DIR, dir, `${stem}.json`)),
];

/** Locale file stems on disk, e.g. `en-US`. */
export const localeStems = (): string[] =>
  readdirSync(LANGUAGES_DIR)
    .filter((name) => name.endsWith(".json"))
    .map((name) => name.replace(/\.json$/, ""))
    .sort();

/** Raw text of every file making up a locale, for whole-locale text scans. */
export const readLocaleText = (stem: string): string =>
  localeFilePaths(stem)
    .map((path) => readFileSync(path, "utf8"))
    .join("\n");

/** A locale's messages as the app sees them once every namespace is loaded. */
export const readLocaleMessages = (stem: string): Record<string, unknown> =>
  Object.assign({}, ...localeFilePaths(stem).map((path) => JSON.parse(readFileSync(path, "utf8"))));
