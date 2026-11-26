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

// The assistant door hides without the license, so these keep the locked "Suggest fix" in sight.
describe("DBM Suggest fix without the ai_assistant license", () => {
  it("keeps the Queries row action, locked with its reason, keyed on the license only", () => {
    const source = read("QueriesPage.vue");
    const at = source.indexOf("const rowActions = computed");
    const block = source.slice(at, source.indexOf("]);", at));
    expect(block).toMatch(/\.\.\.\(aiLock\.locked\.value\s*\?/);
    expect(block).toContain('label: t("dbm.ai.rowSuggestFix")');
    expect(block).toContain("lockedReason: aiLock.lockedReason.value");
  });

  it.each([
    ["QueryDetailPage.vue", "dbm-detail-suggest-fix"],
    ["BlockedQueriesPage.vue", "dbm-blocked-ask-ai"],
  ])("%s shows the locked button before the door", (file, dataTest) => {
    const source = read(file);
    const at = source.indexOf(`data-test="${dataTest}"`);
    const button = source.slice(source.lastIndexOf("<DbmSuggestFixButton", at), at);
    expect(button).toContain("aiLock.locked.value");
    expect(source.slice(at)).toMatch(/<AiEntryButton\s+v-else/);
    expect(source).toContain('const aiLock = useLicenseLock("ai_assistant");');
  });
});
