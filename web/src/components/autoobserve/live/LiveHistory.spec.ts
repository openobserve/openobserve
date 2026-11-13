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
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import config from "@/aws-exports";
import autoobserve, {
  type AutoObserveIncidentItem,
  type AutoObserveIncidentList,
} from "@/services/autoobserve";
import autoobserveDecisions, { type DecisionView } from "@/services/autoobserveDecisions";
import incidents from "./__fixtures__/autoobserveIncidents.json";
import LiveHistory from "./LiveHistory.vue";

const push = vi.fn();
vi.mock("vue-router", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useRouter: () => ({ push }),
}));
vi.mock("@/services/autoobserve", () => ({ default: { incidents: vi.fn() } }));
vi.mock("@/services/autoobserveDecisions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/autoobserveDecisions")>();
  return { ...actual, default: { ...actual.default, list: vi.fn() } };
});

enableAutoUnmount(afterEach);

const incidentsApi = vi.mocked(autoobserve.incidents);
const decisionsApi = vi.mocked(autoobserveDecisions.list);
const httpError = (status: number) =>
  Object.assign(new Error(`HTTP ${status}`), { response: { status } });
const pending = () => new Promise<never>(() => undefined);

const base = (incidents as unknown as AutoObserveIncidentList).items[0];
const incident = (id: string, title: string, ms: number): AutoObserveIncidentItem =>
  ({ ...base, incident: { ...base.incident, id, title, created_at: ms * 1000 } }) as never;
const decision = (id: string, ms: number): DecisionView => ({
  decision_id: `suggestion:${id}`,
  family: "suggestion",
  id,
  action: "dismiss",
  state: "active",
  reason: "not_needed",
  note: null,
  has_note: false,
  actor: "ops-lead@example.com",
  source: "ui",
  decided_at: ms * 1000,
  until: null,
  revision: 1,
  subject: { title: `Nothing watches ${id}`, folder: null, team: null },
});
const incidentPage = (items: AutoObserveIncidentItem[], has_more = false) =>
  ({ data: { paging: true, has_more, items } }) as never;
const decisionPage = (decisions: DecisionView[]) =>
  ({ data: { decisions, total: decisions.length, limit: 50, offset: 0 } }) as never;

const sel = (name: string) => `[data-test="autoobserve-live-history${name ? `-${name}` : ""}"]`;
const mountFeed = () => mount(LiveHistory, { global: { plugins: [i18n, store] } });
const originalBuild = config.isEnterprise;

describe("LiveHistory (G6)", () => {
  beforeEach(() => {
    config.isEnterprise = "true";
    push.mockReset();
    incidentsApi.mockReset();
    decisionsApi.mockReset();
  });

  afterEach(() => {
    config.isEnterprise = originalBuild;
  });

  it("lists incidents and decisions newest first, and opens an incident", async () => {
    const now = Date.now();
    incidentsApi.mockResolvedValue(
      incidentPage([incident("inc-1", "pay_api stopped", now - 60_000)]),
    );
    decisionsApi.mockResolvedValue(decisionPage([decision("checkout", now - 30_000)]));
    const w = mountFeed();
    await flushPromises();
    const rows = w.findAll(`${sel("list")} li`);
    expect(rows.map((r) => r.find("p").text())).toEqual([
      "ops-lead@example.com dismissed Nothing watches checkout",
      expect.stringContaining("Opened an incident: pay_api stopped"),
    ]);
    expect(decisionsApi).toHaveBeenCalledWith(
      expect.any(String),
      expect.not.objectContaining({ family: expect.anything() }),
      expect.anything(),
    );
    await w.find(sel("open-inc-1")).trigger("click");
    expect(push).toHaveBeenCalledWith(
      expect.objectContaining({ name: "incidentDetail", params: { id: "inc-1" } }),
    );
    expect(w.find(sel("newest")).exists()).toBe(false);
  });

  it("still lists incidents while the decisions route is off", async () => {
    incidentsApi.mockResolvedValue(
      incidentPage([incident("inc-1", "pay_api stopped", Date.now())]),
    );
    decisionsApi.mockRejectedValue(httpError(404));
    const w = mountFeed();
    await flushPromises();
    expect(w.findAll(`${sel("list")} li`)).toHaveLength(1);
    expect(w.find(sel("error")).exists()).toBe(false);
  });

  it("shows a red failure with Retry when incidents fail to load", async () => {
    incidentsApi.mockRejectedValue(httpError(500));
    decisionsApi.mockResolvedValue(decisionPage([]));
    const w = mountFeed();
    await flushPromises();
    expect(w.find(sel("error")).text()).toContain("Couldn't load history");
    expect(w.find(sel("list")).exists()).toBe(false);
    incidentsApi.mockResolvedValue(
      incidentPage([incident("inc-1", "pay_api stopped", Date.now())]),
    );
    await w.find(sel("retry")).trigger("click");
    await flushPromises();
    expect(w.findAll(`${sel("list")} li`)).toHaveLength(1);
  });

  it("holds a skeleton, not the empty state, while loading", async () => {
    incidentsApi.mockReturnValue(pending());
    decisionsApi.mockReturnValue(pending());
    const w = mountFeed();
    await flushPromises();
    expect(w.find(sel("skeleton")).exists()).toBe(true);
    expect(w.find('[data-test="autoobserve-live-empty-history"]').exists()).toBe(false);
  });

  it("with nothing to list keeps the empty state that sends the reader to Issues", async () => {
    incidentsApi.mockResolvedValue(incidentPage([]));
    decisionsApi.mockResolvedValue(decisionPage([]));
    const w = mountFeed();
    await flushPromises();
    expect(w.find('[data-test="autoobserve-live-empty-history"]').exists()).toBe(true);
    await w.find('[data-test="autoobserve-live-empty-history-action"]').trigger("click");
    expect(w.emitted("see-issues")).toHaveLength(1);
  });

  it("says when older items are left out", async () => {
    incidentsApi.mockResolvedValue(
      incidentPage([incident("inc-1", "pay_api stopped", Date.now())], true),
    );
    decisionsApi.mockResolvedValue(decisionPage([]));
    const w = mountFeed();
    await flushPromises();
    expect(w.find(sel("newest")).text()).toContain("Older incidents are on the Issues page.");
  });

  it("reads every decision state, so applied, undone and marked ones are listed (T1-N1)", async () => {
    const now = Date.now();
    incidentsApi.mockResolvedValue(incidentPage([]));
    decisionsApi.mockResolvedValue(
      decisionPage([
        { ...decision("undone-apply", now - 10_000), action: "apply", state: "undone" },
        { ...decision("marked", now - 20_000), action: "accept" },
      ]),
    );
    const w = mountFeed();
    await flushPromises();
    expect(decisionsApi).toHaveBeenCalledWith(
      expect.any(String),
      expect.not.objectContaining({ state: expect.anything() }),
      expect.anything(),
    );
    const rows = w.findAll(`${sel("list")} li`).map((r) => r.find("p").text());
    expect(rows[0]).toContain("ops-lead@example.com changed Nothing watches undone-apply");
    expect(rows[0]).toContain("Undone");
    expect(rows[1]).toBe(
      "ops-lead@example.com marked Nothing watches marked as an intended report",
    );
  });

  it("lists the decisions a user may read when incidents are denied, with one red line (T1-N2)", async () => {
    incidentsApi.mockRejectedValue(httpError(403));
    decisionsApi.mockResolvedValue(decisionPage([decision("checkout", Date.now())]));
    const w = mountFeed();
    await flushPromises();
    expect(w.find(sel("error")).exists()).toBe(false);
    expect(w.findAll(`${sel("list")} li`)).toHaveLength(1);
    const note = w.find(sel("partial"));
    expect(note.text()).toBe("Incidents aren't listed: you don't have permission to see them.");
    expect(note.classes()).toContain("text-status-error-text");
  });

  it("keeps the whole-feed denial when incidents are denied and there are no decisions", async () => {
    incidentsApi.mockRejectedValue(httpError(403));
    decisionsApi.mockResolvedValue(decisionPage([]));
    const w = mountFeed();
    await flushPromises();
    expect(w.find(sel("error")).text()).toContain("permission");
    expect(w.find(sel("partial")).exists()).toBe(false);
  });

  it("lists incidents with one red line when decisions are denied", async () => {
    incidentsApi.mockResolvedValue(
      incidentPage([incident("inc-1", "pay_api stopped", Date.now())]),
    );
    decisionsApi.mockRejectedValue(httpError(403));
    const w = mountFeed();
    await flushPromises();
    expect(w.findAll(`${sel("list")} li`)).toHaveLength(1);
    expect(w.find(sel("partial")).text()).toBe(
      "Decisions aren't listed: you don't have permission to see them.",
    );
  });

  it("reads no decisions in the open-source build", async () => {
    config.isEnterprise = "false";
    incidentsApi.mockResolvedValue(
      incidentPage([incident("inc-1", "pay_api stopped", Date.now())]),
    );
    const w = mountFeed();
    await flushPromises();
    expect(decisionsApi).not.toHaveBeenCalled();
    expect(w.findAll(`${sel("list")} li`)).toHaveLength(1);
  });
});
