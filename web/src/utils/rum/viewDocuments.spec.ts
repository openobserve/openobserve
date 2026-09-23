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
import { collapseViewDocuments } from "@/utils/rum/viewDocuments";

const view = (view_id: string, version: number | undefined, extra: Record<string, any> = {}) => ({
  type: "view",
  view_id,
  ...(version === undefined ? {} : { _o2_document_version: version }),
  date: 1000,
  ...extra,
});

describe("collapseViewDocuments", () => {
  it("keeps the highest document version, not the first one with time spent", () => {
    // Documents share `date`, so their order is arbitrary — as returned by the stream.
    const rows = [
      view("v1", 10, { view_time_spent: 1800e9 }),
      view("v1", 2, { view_time_spent: 0.03e9 }),
      view("v1", 14, { view_time_spent: 10514e9 }),
      view("v1", 4, { view_time_spent: 6.5e9 }),
    ];
    const out = collapseViewDocuments(rows);
    expect(out).toHaveLength(1);
    expect(out[0]._o2_document_version).toBe(14);
    expect(out[0].view_time_spent).toBe(10514e9);
  });

  it("reads the legacy _oo_ spelling of the version", () => {
    const rows = [
      { type: "view", view_id: "v1", _oo_document_version: 3, date: 1 },
      { type: "view", view_id: "v1", _oo_document_version: 1, date: 1 },
    ];
    expect(collapseViewDocuments(rows)[0]._oo_document_version).toBe(3);
  });

  it("falls back to the longest time spent when no version is present", () => {
    const rows = [
      view("v1", undefined, { view_time_spent: 5 }),
      view("v1", undefined, { view_time_spent: 9 }),
      view("v1", undefined, { view_time_spent: 0 }),
    ];
    expect(collapseViewDocuments(rows)[0].view_time_spent).toBe(9);
  });

  it("stamps the winner with the earliest date of its group", () => {
    const rows = [view("v1", 1, { date: 500 }), view("v1", 2, { date: 700 })];
    const out = collapseViewDocuments(rows);
    expect(out[0]._o2_document_version).toBe(2);
    expect(out[0].date).toBe(500);
  });

  it("ignores a missing date when choosing the earliest", () => {
    const rows = [view("v1", 1, { date: undefined }), view("v1", 2, { date: 700 })];
    expect(collapseViewDocuments(rows)[0].date).toBe(700);
  });

  it("keeps each view at its first position and passes other rows through in order", () => {
    const action = { type: "action", action_id: "a1", view_id: "v1", date: 1001 };
    const error = { type: "error", error_id: "e1", view_id: "v2", date: 2001 };
    const orphan = { type: "view", date: 3000 };
    const rows = [
      view("v1", 1, { date: 1000 }),
      action,
      view("v1", 2, { date: 1000 }),
      view("v2", 1, { date: 2000 }),
      error,
      view("v2", 3, { date: 2000 }),
      orphan,
    ];
    const out = collapseViewDocuments(rows);
    expect(out.map((r: any) => r.type + ":" + (r.view_id ?? "-"))).toEqual([
      "view:v1",
      "action:v1",
      "view:v2",
      "error:v2",
      "view:-",
    ]);
    expect(out[0]._o2_document_version).toBe(2);
    expect(out[2]._o2_document_version).toBe(3);
    expect(out[1]).toBe(action);
    expect(out[4]).toBe(orphan);
  });

  it("does not mutate its input", () => {
    const first = view("v1", 1, { date: 900 });
    const second = view("v1", 2, { date: 1000 });
    collapseViewDocuments([first, second]);
    expect(second.date).toBe(1000);
    expect(first._o2_document_version).toBe(1);
  });
});
