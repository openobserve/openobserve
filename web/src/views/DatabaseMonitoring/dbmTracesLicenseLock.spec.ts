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

// Source-read like its siblings: these views need a router, a store and a dozen O2 children to mount.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const read = (file: string) => readFileSync(join(here, file), "utf8");

const templateOf = (source: string) => source.slice(0, source.indexOf("<script setup"));

const block = (source: string, start: string) => {
  const at = source.indexOf(start);
  expect(at, start).toBeGreaterThan(-1);
  return source.slice(at, source.indexOf("\n};", at));
};

describe.each([
  ["SamplesPage.vue", "const openSampleTrace", ["dbm-samples-trace-lock-"]],
  [
    "QueryDetailPage.vue",
    "const openTraces",
    ["dbm-detail-endpoint-traces-lock-", "dbm-detail-sample-trace-lock-"],
  ],
])("%s trace pivots", (file, opener, lockTests) => {
  const source = read(file);
  const template = templateOf(source);

  it("keys the lock on the traces license", () => {
    expect(source).toContain('const tracesLock = useLicenseLock("traces");');
  });

  it("renders a disabled lock with the locked reason while traces are locked", () => {
    for (const lockTest of lockTests) {
      const at = template.indexOf(lockTest);
      expect(at, lockTest).toBeGreaterThan(-1);
      const tooltipAt = template.lastIndexOf("<OTooltip", at);
      const markup = template.slice(tooltipAt, at);
      expect(markup).toContain("tracesLock.locked.value");
      expect(markup).toContain(':content="tracesLock.lockedReason.value"');
      expect(markup).toContain('<span class="inline-flex">');
      expect(markup).toContain("disabled");
      expect(markup).not.toContain("@click");
    }
  });

  it("keeps the live pivot on the enabled branch", () => {
    for (const lockTest of lockTests) {
      const closeAt = template.indexOf("</OTooltip>", template.indexOf(lockTest));
      const live = template.slice(closeAt, template.indexOf("</OButton>", closeAt));
      expect(live).toMatch(/<OButton\s+v-else/);
      expect(live).toMatch(/@click(\.stop)?="open\w+\(/);
    }
  });

  it("navigates nowhere from a row or chart click while traces are locked", () => {
    expect(block(source, opener)).toMatch(/tracesLock\.locked\.value\) return;/);
  });
});
