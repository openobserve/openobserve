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

// Guards the base locale file against a silent failure mode: JSON.parse accepts
// duplicate keys and keeps the LAST one. Adding a nested block whose name
// collides with an existing flat label silently replaces that label with an
// object, and every t() call for it then renders the raw key path on screen.
//
// That is exactly what happened when an `"azure": { … }` block was added
// alongside the existing `"azure": "Microsoft Azure"` label used by the Data
// Sources sidebar tab and the global search index.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const LOCALE = resolve(__dirname, "./languages/en-US.json");

/**
 * Returns the names of keys that appear more than once within the same object.
 * Walks the raw text because the duplicates are already gone by the time
 * JSON.parse returns.
 */
export function findDuplicateKeys(text: string): string[] {
  const dupes: string[] = [];
  // One set of seen key names per open object.
  const scopes: Array<Set<string>> = [];
  let pendingKey: string | null = null;
  let i = 0;

  while (i < text.length) {
    const ch = text[i];

    if (ch === '"') {
      // Read a complete string token, honouring escapes.
      let value = "";
      i++;
      while (i < text.length && text[i] !== '"') {
        if (text[i] === "\\") {
          value += text[i] + text[i + 1];
          i += 2;
          continue;
        }
        value += text[i];
        i++;
      }
      i++; // closing quote
      pendingKey = value;
      continue;
    }

    if (ch === "{") {
      scopes.push(new Set());
      pendingKey = null;
    } else if (ch === "}") {
      scopes.pop();
      pendingKey = null;
    } else if (ch === ":") {
      // The string just read was a key in the innermost object.
      const scope = scopes[scopes.length - 1];
      if (scope && pendingKey !== null) {
        if (scope.has(pendingKey)) dupes.push(pendingKey);
        scope.add(pendingKey);
      }
      pendingKey = null;
    } else if (ch === "," || ch === "[" || ch === "]") {
      pendingKey = null;
    }
    i++;
  }

  return [...new Set(dupes)];
}

describe("findDuplicateKeys", () => {
  it("detects a duplicate key within the same object", () => {
    // The exact shape of the bug this guard exists for.
    const bad = '{"ingestion":{"azure":"Microsoft Azure","azure":{"title":"x"}}}';
    expect(findDuplicateKeys(bad)).toEqual(["azure"]);
  });

  it("does not flag the same name used in different objects", () => {
    const ok = '{"a":{"title":"x"},"b":{"title":"y"}}';
    expect(findDuplicateKeys(ok)).toEqual([]);
  });

  it("is not confused by braces or colons inside string values", () => {
    const ok = '{"a":"{not: a key}","b":"plain"}';
    expect(findDuplicateKeys(ok)).toEqual([]);
  });
});

describe("en-US locale file", () => {
  const raw = readFileSync(LOCALE, "utf8");

  it("parses as valid JSON", () => {
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it("has no duplicate keys within any object", () => {
    expect(findDuplicateKeys(raw)).toEqual([]);
  });

  it("keeps the Data Sources sidebar labels as strings", () => {
    // Rendered directly by Recommended.vue and the Ingestion search index — if
    // any becomes an object, that tab shows its raw key path instead of a name.
    const { ingestion } = JSON.parse(raw);
    for (const key of [
      "azure",
      "kubernetes",
      "windows",
      "linux",
      "awsconfig",
      "gcpconfig",
      "tracesotlp",
      "rum",
    ]) {
      expect(typeof ingestion[key], `ingestion.${key}`).toBe("string");
      expect(ingestion[key].length).toBeGreaterThan(0);
    }
  });
});
