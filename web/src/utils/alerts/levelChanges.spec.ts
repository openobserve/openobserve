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

import { describe, expect, it } from "vitest";
import "@/locales";
import { gt } from "@/types/i18n";
import { levelChangesEmptyText } from "./levelChanges";

const BASE = "Level changes appear here as groups start firing, escalate or recover.";

describe("levelChangesEmptyText", () => {
  it("the empty level changes say how long changes are kept", () => {
    expect(levelChangesEmptyText(gt, "en-US", 97)).toBe(
      `${BASE} Changes older than 97 days are not kept.`,
    );
    expect(levelChangesEmptyText(gt, "en-US", 1)).toBe(
      `${BASE} Changes older than 1 day are not kept.`,
    );
    expect(levelChangesEmptyText(gt, "en-US", 1000)).toBe(
      `${BASE} Changes older than 1,000 days are not kept.`,
    );
  });

  it("keeps the old text when nothing is reaped or the server does not say", () => {
    expect(levelChangesEmptyText(gt, "en-US", 0)).toBe(BASE);
    expect(levelChangesEmptyText(gt, "en-US", -1)).toBe(BASE);
    expect(levelChangesEmptyText(gt, "en-US", undefined)).toBe(BASE);
    expect(levelChangesEmptyText(gt, "en-US", "97")).toBe(BASE);
  });
});
