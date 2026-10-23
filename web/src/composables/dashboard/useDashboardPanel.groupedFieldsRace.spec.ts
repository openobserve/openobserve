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

// updateGroupedFields coalesces concurrent calls. It used to do that by
// returning straight away, which made `await updateGroupedFields()` a lie for
// the second caller: it resolved before any field had been loaded.
//
// Both Build-tab entry points then do the same thing (BuildQueryPage.vue:339
// and :425):
//
//     await updateGroupedFields();
//     const generatedQuery = await makeAutoSQLQuery();
//     if (generatedQuery !== undefined) emit("queryGenerated", generatedQuery);
//
// and makeAutoSQLQuery returns undefined when groupedFields is empty. So the
// coalesced caller emitted no query, and nothing regenerated one afterwards —
// the logs query editor stayed empty for the life of the page. In CI that was
// ~half of all runs of the three "SQL ON ..." tests in
// logsQueryBuilder-editor.spec.js, each burning the full 60s wait twice before
// passing on a third attempt against a fresh page.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { flushPromises } from "@vue/test-utils";

const mockGetStream = vi.hoisted(() => vi.fn());

vi.mock("@/composables/useStreams", () => ({
  default: () => ({ getStream: mockGetStream }),
}));

const mockStore = vi.hoisted(() => ({
  state: {
    selectedOrganization: { identifier: "myorg" },
    zoConfig: { timestamp_column: "_timestamp" },
  },
}));
vi.mock("vuex", async (importOriginal) => {
  const actual = await importOriginal<typeof import("vuex")>();
  return { ...actual, useStore: vi.fn(() => mockStore) };
});

import useDashboardPanelData from "./useDashboardPanel";

const STREAM = {
  name: "e2e_automate",
  schema: [
    { name: "_timestamp", type: "Int64" },
    { name: "kubernetes_namespace_name", type: "Utf8" },
  ],
};

// A unique page key per test: useDashboardPanelData is a singleton per key, so
// a shared one leaks groupedFields between tests and hides the empty state.
let keyN = 0;
const panelWithStream = () => {
  const p = useDashboardPanelData(`grouped-fields-race-${++keyN}`, ((k: string) => k) as any);
  const q = p.dashboardPanelData.data.queries[p.dashboardPanelData.layout.currentQueryIndex];
  q.fields.stream = "e2e_automate";
  q.fields.stream_type = "logs";
  q.customQuery = false;
  return p;
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("updateGroupedFields — a coalesced caller waits for the fields", () => {
  it("does not resolve while the run it coalesced into is still loading", async () => {
    const p = panelWithStream();
    let releaseSchema: (v: unknown) => void = () => {};
    mockGetStream.mockImplementationOnce(() => new Promise((resolve) => (releaseSchema = resolve)));

    const first = p.updateGroupedFields();
    let secondSettled = false;
    const second = p.updateGroupedFields().then(() => (secondSettled = true));

    await flushPromises();
    // Before the fix this was already true: the guard returned a resolved
    // promise, so the caller moved on to makeAutoSQLQuery() with no fields.
    expect(secondSettled).toBe(false);

    releaseSchema(STREAM);
    await Promise.all([first, second]);
    expect(secondSettled).toBe(true);
  });

  it("has the grouped fields populated by the time it resolves", async () => {
    const p = panelWithStream();
    let releaseSchema: (v: unknown) => void = () => {};
    mockGetStream.mockImplementationOnce(() => new Promise((resolve) => (releaseSchema = resolve)));

    const first = p.updateGroupedFields();
    // What the second caller can see at the moment its await returns — this is
    // exactly what makeAutoSQLQuery() reads next.
    const fieldsAtResolve = p
      .updateGroupedFields()
      .then(() => p.dashboardPanelData.meta.streamFields.groupedFields.length);

    await flushPromises();
    releaseSchema(STREAM);
    await first;

    expect(await fieldsAtResolve).toBeGreaterThan(0);
  });

  it("still loads the fields for a single, uncontended call", async () => {
    const p = panelWithStream();
    mockGetStream.mockResolvedValue(STREAM);

    await p.updateGroupedFields();

    expect(p.dashboardPanelData.meta.streamFields.groupedFields).toHaveLength(1);
    expect(p.dashboardPanelData.meta.streamFields.groupedFields[0].name).toBe("e2e_automate");
  });
});
