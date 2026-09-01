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

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

// The locale files are read from disk, not imported: the vue-i18n build plugin
// compiles them into message functions, so an `import` gives back code rather
// than the object this needs to walk.

type Json = Record<string, unknown>;

// Resolved from the working directory rather than the module URL: under the
// SSR transform `import.meta.url` is not a file: URL at module scope. The
// working directory is vitest's root, which the npm script sets to `src/` and
// an IDE runner often leaves at `web/`.
const dir = ["locales/languages", "src/locales/languages", "web/src/locales/languages"]
  .map((candidate) => resolve(process.cwd(), candidate))
  .find((candidate) => existsSync(candidate));

if (!dir) throw new Error(`locale directory not found from ${process.cwd()}`);

const read = (file: string): Json => JSON.parse(readFileSync(resolve(dir, file), "utf8")) as Json;

const en = read("en-US.json");

const LOCALES: Array<[string, Json]> = readdirSync(dir)
  .filter((file) => file.endsWith(".json") && file !== "en-US.json")
  .sort()
  .map((file) => [file.replace(/\.json$/, ""), read(file)]);

const paths = (value: unknown, prefix = ""): string[] => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return [prefix];
  return Object.entries(value as Json).flatMap(([key, child]) =>
    paths(child, prefix ? `${prefix}.${key}` : key),
  );
};

const at = (root: Json, path: string): unknown =>
  path.split(".").reduce<unknown>((node, key) => (node as Json | undefined)?.[key], root);

const englishKeys = paths(en.alert_library, "alert_library");

/** Copy with the interpolation tokens removed — `{installed}` is an identifier, not a word. */
const prose = (value: unknown): string =>
  typeof value === "string" ? value.replace(/\{\w+\}/g, " ") : "";

/** Interpolation tokens must survive translation or the string renders `{foo}`. */
const placeholders = (value: unknown): string[] =>
  typeof value === "string" ? [...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort() : [];

describe("alert_library locale parity", () => {
  it("has keys to check", () => {
    // A typo in the subtree name would make every assertion below vacuous.
    expect(englishKeys.length).toBeGreaterThan(40);
  });

  it.each(LOCALES)("%s defines every alert_library key en-US does", (_name, locale) => {
    const missing = englishKeys.filter((path) => at(locale, path) === undefined);
    expect(missing).toEqual([]);
  });

  it.each(LOCALES)("%s keeps every interpolation placeholder", (_name, locale) => {
    const broken = englishKeys.filter((path) => {
      const translated = at(locale, path);
      if (translated === undefined) return false;
      return placeholders(at(en, path)).join() !== placeholders(translated).join();
    });
    expect(broken).toEqual([]);
  });

  // The rename's real failure mode is a locale left saying "install" while
  // English says "add" — silent, because a present-but-stale key never falls
  // back. Scoped to the keys whose MEANING changes: outside them, a stem like
  // Russian "установ" is also the stem of "set" and would flag correct copy.
  const RENAMED = [
    "alert_library.subtitle",
    "alert_library.statReady",
    "alert_library.notIngestedHint",
    "alert_library.drawer.install",
    "alert_library.drawer.needsDataCallout",
    "alert_library.install.title",
    "alert_library.install.subtitle",
    "alert_library.install.stepInstall",
    "alert_library.install.folderIntro",
    "alert_library.install.tuneHint",
    "alert_library.install.run",
    "alert_library.install.allInstalled",
    "alert_library.install.someFailed",
    "alert_library.install.unreadableConditions",
  ];

  // Per locale, never one shared list: a stem is only meaningful inside its own
  // language. Turkish alone needs two verbs — the current copy uses "kur" and
  // "yükle" interchangeably — and must exclude "kuruluş", which means
  // organization, not installation.
  const INSTALL_STEMS: Record<string, RegExp[]> = {
    "de-DE": [/instal/i],
    "es-ES": [/instal/i, /instál/i],
    "fr-FR": [/instal/i],
    "it-IT": [/instal/i],
    "ja-JP": [/インストール/],
    "ko-KR": [/설치/],
    "nl-NL": [/instal/i, /ïnstal/i],
    "pl-PL": [/instal/i],
    "pt-PT": [/instal/i],
    "ru-RU": [/установ/i],
    "tr-TR": [/\bkur(?!uluş)\w*/i, /\byükle\w*/i],
    "vi-VN": [/cài đặt/i],
    "zh-CN": [/安装/],
    "zh-TW": [/安裝/],
  };

  it("checks the keys the rename actually touches", () => {
    // A path that stopped existing would make every assertion below vacuous.
    expect(RENAMED.filter((path) => at(en, path) === undefined)).toEqual([]);
  });

  it("knows a stem for every locale it will check", () => {
    // A locale with no entry would pass the assertion below no matter what it
    // says — which is how Turkish went unchecked in an earlier draft.
    const unstemmed = LOCALES.map(([name]) => name).filter((name) => !INSTALL_STEMS[name]);
    expect(unstemmed).toEqual([]);
  });

  it.each(LOCALES)("%s stops saying install where the meaning changed", (name, locale) => {
    const stems = INSTALL_STEMS[name] ?? [];
    const stale = RENAMED.filter((path) => stems.some((stem) => stem.test(prose(at(locale, path)))));
    expect(stale).toEqual([]);
  });

  it("defines the new selection keys in English, which types every other locale", () => {
    // vue-i18n answers a missing key with the key path, so a test comparing a
    // rendered label against `t(key)` passes while the UI shows the raw path.
    const ADDED = [
      "alert_library.selectAlert",
      "alert_library.selectAllInView",
      "alert_library.selectAllInGroup",
      "alert_library.clearGroupSelection",
      "alert_library.selectionCount",
      "alert_library.selectionOffscreen",
      "alert_library.clearSelection",
      "alert_library.addSelected",
    ];
    expect(ADDED.filter((path) => typeof at(en, path) !== "string")).toEqual([]);
  });

  it("says nothing about installing anywhere in the English library copy", () => {
    const stale = englishKeys.filter((path) => /install/i.test(prose(at(en, path))));
    expect(stale).toEqual([]);
  });
});
