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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h, ref } from "vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import autoobserve, {
  type AutoObserveIncidentItem,
  type AutoObserveIncidentList,
} from "@/services/autoobserve";
import type { IssuesRange } from "../v2/fixtures";
import fixture from "./__fixtures__/autoobserveIncidents.json";
import { useLiveIssues } from "./useLiveIssues";

const routeQuery: Record<string, string> = {};
vi.mock("vue-router", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useRoute: () => ({ query: routeQuery }),
}));

vi.mock("@/services/autoobserve", () => ({
  default: { coverage: vi.fn(), suggestions: vi.fn(), incidents: vi.fn() },
}));

const api = vi.mocked(autoobserve.incidents);

const NOW = Date.UTC(2026, 10, 6, 12, 0);
const DAY_US = 86_400_000_000;
const NOW_US = NOW * 1000;
const BASE = (fixture as unknown as AutoObserveIncidentList).items[0];

const item = (n: number, ageUs: number, org = "a"): AutoObserveIncidentItem => ({
  ...BASE,
  finding: { ...BASE.finding, id: `${org}-f-${n}`, first_seen_at: NOW_US - ageUs },
  incident: { ...BASE.incident, id: `${org}-inc-${n}`, created_at: NOW_US - ageUs },
  investigation: { ...BASE.investigation, state: null, run_id: null },
});

const page = (items: AutoObserveIncidentItem[], has_more: boolean) =>
  ({ data: { paging: true, has_more, items } }) as never;

// Each page holds `size` rows, ageing by `step` microseconds from row to row.
const series = (from: number, size: number, step: number, org = "a") =>
  Array.from({ length: size }, (_, i) => item(from + i, (from + i) * step, org));

const httpError = (status: number) => ({
  response: { status, data: { message: `status ${status}` } },
});

const pending = () => new Promise<never>(() => undefined);

type Issues = ReturnType<typeof useLiveIssues>;

const originalOrg = store.state.selectedOrganization;
let wrappers: { unmount: () => void }[] = [];

const mountIssues = (range: IssuesRange = "7d") => {
  const out: { issues?: Issues } = {};
  const Harness = defineComponent({
    setup() {
      out.issues = useLiveIssues(ref(range));
      return () => h("span");
    },
  });
  wrappers.push(mount(Harness, { global: { plugins: [i18n, store] } }));
  return out as { issues: Issues };
};

const offsets = () => api.mock.calls.map((call) => call[1].offset);

const settle = async (calls: number) => {
  await vi.waitFor(() => expect(api).toHaveBeenCalledTimes(calls));
  await flushPromises();
  await flushPromises();
};

describe("useLiveIssues", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    api.mockReset();
    for (const key of Object.keys(routeQuery)) delete routeQuery[key];
    store.commit("setSelectedOrganization", { ...originalOrg, identifier: "org-a" });
  });

  afterEach(() => {
    for (const w of wrappers) w.unmount();
    wrappers = [];
    vi.useRealTimers();
    store.commit("setSelectedOrganization", originalOrg);
  });

  it("fetches by default, with no live flag in the URL", async () => {
    api.mockResolvedValue(page(series(0, 3, 1), false));
    const { issues } = mountIssues();
    await settle(1);
    expect(issues.rows.value).toHaveLength(3);
  });

  it("stops after the page that reaches past the range start, keeping only rows inside it", async () => {
    const hourUs = DAY_US / 24;
    api.mockImplementation(async (_org, { offset }) => {
      if (offset === 0) return page(series(0, 100, hourUs / 2), true);
      // Rows 100..199 age an hour each, so the range ends inside this page.
      if (offset === 100) return page(series(100, 100, hourUs), true);
      return page(series(offset, 100, hourUs), true);
    });
    const { issues } = mountIssues("7d");
    await settle(2);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(offsets()).toEqual([0, 100]);
    const startUs = NOW_US - 7 * DAY_US;
    expect(issues.rows.value.length).toBeGreaterThan(100);
    expect(issues.rows.value.length).toBeLessThan(200);
    expect(issues.rows.value.every((r) => r.finding.first_seen_at >= startUs)).toBe(true);
    expect(issues.capped.value).toBe(false);
    expect(issues.hasMore.value).toBe(false);
  });

  it("stops at the cap of 500 and says it is capped while the server has more", async () => {
    // The server runs out at 1,000 rows, so a missing cap ends in a wrong count rather than a hang.
    api.mockImplementation(async (_org, { offset }) => page(series(offset, 100, 1), offset < 900));
    const { issues } = mountIssues("90d");
    await settle(5);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(offsets()).toEqual([0, 100, 200, 300, 400]);
    expect(issues.rows.value).toHaveLength(500);
    expect(issues.capped.value).toBe(true);
    expect(issues.hasMore.value).toBe(true);
  });

  it("is not capped when the 500th row is the last one the server has", async () => {
    api.mockImplementation(async (_org, { offset }) => page(series(offset, 100, 1), offset < 400));
    const { issues } = mountIssues("90d");
    await settle(5);
    expect(issues.rows.value).toHaveLength(500);
    expect(issues.capped.value).toBe(false);
    expect(issues.hasMore.value).toBe(false);
  });

  it("an org switch keeps no row of the old org and forgets its failure", async () => {
    api.mockResolvedValueOnce(page(series(0, 2, 1, "a"), false));
    const { issues } = mountIssues("30d");
    await settle(1);
    expect(issues.rows.value.map((r) => r.incident.id)).toEqual(["a-inc-0", "a-inc-1"]);

    api.mockReturnValueOnce(pending());
    store.commit("setSelectedOrganization", { ...originalOrg, identifier: "org-b" });
    await settle(2);
    expect(api.mock.calls[1][0]).toBe("org-b");
    expect(issues.rows.value).toEqual([]);
    expect(issues.state.value.status).toBe("loading");

    api.mockRejectedValueOnce(httpError(500));
    store.commit("setSelectedOrganization", { ...originalOrg, identifier: "org-c" });
    await settle(3);
    expect(issues.state.value.status).toBe("error");

    api.mockReturnValueOnce(pending());
    store.commit("setSelectedOrganization", { ...originalOrg, identifier: "org-d" });
    await settle(4);
    expect(issues.state.value.status).toBe("loading");
    expect(issues.state.value.failure).toBeNull();
    expect(issues.rows.value).toEqual([]);
  });

  it("counts open rows and flags more when another page exists", async () => {
    api.mockResolvedValueOnce(
      page(
        [
          item(0, 1),
          { ...item(1, 2), incident: { ...item(1, 2).incident, status: "resolved" } },
          { ...item(2, 3), incident: { ...item(2, 3).incident, status: "acknowledged" } },
        ],
        false,
      ),
    );
    const { issues } = mountIssues("30d");
    await settle(1);
    expect(issues.openCount.value).toBe(2);
    expect(issues.hasMore.value).toBe(false);
  });
});
