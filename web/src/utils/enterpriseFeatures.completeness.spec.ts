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

// Guards the one failure mode this whole file exists to prevent: a
// `FeatureKey` that nothing actually checks (a typo'd string at the one call
// site that was supposed to use it, or a gate someone defined and then never
// wired up — exactly what happened to the `enterprise` key's Service Graph
// tab, registered with its own doc comment naming that exact tab, but never
// called from it). This can't catch a WRONG key — only a key with zero
// callers anywhere in the app, which a type system already can't catch
// either (string-keyed `Record` access doesn't fail at compile time if a
// caller passes a different valid key than intended).

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { ALL_FEATURE_KEYS } from "./enterpriseFeatures";

const SRC_ROOT = resolve(__dirname, "..");
const SKIP_DIRS = new Set(["node_modules", "dist", ".git"]);
const SOURCE_EXTENSIONS = [".ts", ".vue"];

function walk(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, files);
    } else if (SOURCE_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
      files.push(full);
    }
  }
  return files;
}

// Read once for every test in this file — the repo has thousands of source
// files, and re-walking per `it()` would make this test suite the slow one.
const SOURCE_FILES = walk(SRC_ROOT);
const SOURCE_TEXT = new Map<string, string>(
  SOURCE_FILES.map((f) => [f, readFileSync(f, "utf-8")]),
);

/**
 * Every shape a `FeatureKey` can legitimately be spent through: a direct
 * function-call literal, or a `featureKey: "x"` entry in a declarative table
 * (e.g. `AI_OBSERVABILITY_SECTIONS`) that some generic code later passes to
 * `checkFeatureAccess`/`withFeatureGate` as a variable — a real call site,
 * just not a literal one this regex-based scan can follow through a
 * variable. Tables shaped like that are the intended, recommended pattern
 * for a module with many sections (see useAIObservabilityRoutes.ts), not a
 * loophole to close.
 */
function callSitePatterns(key: string): RegExp[] {
  return [
    new RegExp(`checkFeatureAccess\\(\\s*["']${key}["']`),
    new RegExp(`withFeatureGate\\(\\s*["']${key}["']`),
    new RegExp(`useLockedAffordance\\(\\s*["']${key}["']`),
    new RegExp(`featureKey:\\s*["']${key}["']`),
  ];
}

describe("FEATURE_GATES completeness", () => {
  it("every registered FeatureKey has at least one real call site", () => {
    const orphaned: string[] = [];
    for (const key of ALL_FEATURE_KEYS) {
      const patterns = callSitePatterns(key);
      const hasCallSite = SOURCE_FILES.some((file) => {
        // The registry file itself only ever *defines* keys (object property
        // syntax), never calls `checkFeatureAccess`/`withFeatureGate` with a
        // literal of its own keys, so it's safe to include — but excluding
        // this spec file matters, since its own patterns-as-strings above
        // would otherwise "use" every key trivially.
        if (file.endsWith("enterpriseFeatures.completeness.spec.ts")) return false;
        const text = SOURCE_TEXT.get(file)!;
        return patterns.some((p) => p.test(text));
      });
      if (!hasCallSite) orphaned.push(key);
    }
    expect(orphaned, `FeatureKey(s) with no checkFeatureAccess/withFeatureGate/useLockedAffordance call site anywhere in web/src — either wire them up or remove the registry entry: ${orphaned.join(", ")}`).toEqual(
      [],
    );
  });
});
