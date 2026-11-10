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
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h } from "vue";

vi.mock("@/aws-exports", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/aws-exports")>();
  return { default: { ...actual.default, isEnterprise: "true" } };
});
vi.mock("@/services/autoobserveDecisions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/autoobserveDecisions")>();
  return {
    ...actual,
    default: {
      preview: vi.fn(),
      decide: vi.fn(),
      decideBatch: vi.fn(),
      undo: vi.fn(),
      list: vi.fn(),
    },
  };
});

import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import { withQueryClient } from "@/test/unit/helpers/queryClient";
import { queryClient } from "@/composables/query/queryClient";
import autoobserveDecisions, { type DecisionView } from "@/services/autoobserveDecisions";
import { dismissAll, toastRecords } from "@/lib/feedback/Toast/useToast";
import { useDecisionRoute } from "@/composables/autoobserve/useDecisionRoute";
import { createMemoryHistory, createRouter } from "vue-router";
import AppliedChangesList from "./AppliedChangesList.vue";
import { clearAppliedSession, recordApplied, useAppliedChanges } from "./appliedChanges";
import { autoobserveKeys } from "@/services/autoobserve.querykeys";

const api = vi.mocked(autoobserveDecisions);

const view = (over: Partial<DecisionView> = {}): DecisionView => ({
  decision_id: "alert_finding:f-1",
  family: "alert_finding",
  id: "f-1",
  action: "apply",
  state: "applied",
  reason: null,
  note: null,
  has_note: false,
  actor: "ops@example.com",
  source: "ui",
  decided_at: Date.UTC(2026, 10, 10, 14, 2) * 1000,
  until: null,
  revision: 4,
  ...over,
});

const list = (decisions: DecisionView[]) =>
  ({ data: { decisions, total: decisions.length, limit: 50, offset: 0 } }) as never;

let wrapper: VueWrapper | null = null;
let route: ReturnType<typeof useDecisionRoute>;
const mountWithRoute = async () => {
  wrapper = mount(
    defineComponent({
      setup() {
        route = useDecisionRoute();
        return () =>
          h(AppliedChangesList, null, { default: () => h("p", { "data-test": "fallback" }) });
      },
    }),
    { attachTo: document.body, global: { plugins: [i18n, store, withQueryClient(queryClient)] } },
  );
  await flushPromises();
  await flushPromises();
  return wrapper;
};
const mountList = async () => {
  wrapper = mount(AppliedChangesList, {
    slots: { default: () => h("p", { "data-test": "fallback" }, "Nothing changed yet") },
    attachTo: document.body,
    global: { plugins: [i18n, store, withQueryClient(queryClient)] },
  });
  await flushPromises();
  await flushPromises();
  return wrapper;
};

describe("What I've changed (W5, D2)", () => {
  beforeEach(() => {
    queryClient.clear();
    clearAppliedSession();
    dismissAll();
    store.state.selectedOrganization.identifier = "demo-org";
    api.list.mockReset();
    api.undo.mockReset();
    api.decide.mockReset();
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.body.innerHTML = "";
  });

  it("lists the server's applies with old to new, who and Undo", async () => {
    api.list.mockResolvedValue(
      list([
        view({
          change: {
            alert: { id: "al-1", title: "disk latency" },
            fields: [{ field: "pending_period_secs", from: 0, to: 120 }],
          },
          via: "apply",
        }),
        view({ decision_id: "alert_finding:f-2", action: "dismiss" }),
      ]),
    );
    const w = await mountList();
    const rows = w.findAll('[data-test="autoobserve-applied-row"]');
    expect(rows).toHaveLength(1);
    expect(rows[0].text()).toContain("disk latency");
    expect(rows[0].find('[data-test="autoobserve-applied-detail"]').text()).toMatch(
      /^Hold for .+ → 2 minutes · by ops@example\.com at /,
    );
    expect(w.find('[data-test="fallback"]').exists()).toBe(false);
  });

  it("an_undone_apply_is_read_back_after_a_reload_and_stays_undone", async () => {
    api.list.mockResolvedValue(
      list([
        view({
          state: "undone",
          change: {
            alert: { id: "al-1", title: "T3-nodest-ops-a" },
            fields: [{ field: "destinations", from: [], to: ["ops-webhook"] }],
          },
        }),
      ]),
    );
    const w = await mountList();
    const reads = api.list.mock.calls.map((c) => c[1]).filter((p) => p.limit !== 1);
    expect(reads.length).toBeGreaterThan(0);
    for (const params of reads) expect(params).not.toHaveProperty("state");
    expect(w.find('[data-test="autoobserve-applied-undone"]').exists()).toBe(true);
    expect(w.find('[data-test="autoobserve-applied-undo"]').exists()).toBe(false);
    expect(w.find('[data-test="fallback"]').exists()).toBe(false);
  });

  it("the_alert_name_links_to_the_alert", async () => {
    api.list.mockResolvedValue(
      list([
        view({
          change: {
            alert: { id: "al-1", title: "disk latency" },
            fields: [{ field: "pending_period_secs", from: 0, to: 120 }],
          },
        }),
      ]),
    );
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: "/", component: { render: () => h("div") } },
        {
          path: "/alerts/detail/:alert_id",
          name: "alertDetail",
          component: { render: () => h("div") },
        },
      ],
    });
    await router.push("/");
    wrapper = mount(AppliedChangesList, {
      attachTo: document.body,
      global: { plugins: [i18n, store, router, withQueryClient(queryClient)] },
    });
    await flushPromises();
    await flushPromises();
    const link = wrapper.find('[data-test="autoobserve-applied-alert-link"]');
    expect(link.text()).toBe("disk latency");
    expect(link.attributes("href")).toContain("/alerts/detail/al-1");
    expect(link.attributes("href")).toContain("org_identifier=demo-org");
  });

  it("an older server that lists no applies falls back to this session's", async () => {
    api.list.mockResolvedValue(list([view({ action: "dismiss" })]));
    recordApplied({
      org: "demo-org",
      view: view(),
      title: "disk latency",
      fields: [{ field: "pending_period_secs", from: 0, to: 120 }],
    });
    recordApplied({
      org: "other-org",
      view: view({ decision_id: "x" }),
      title: "elsewhere",
      fields: [],
    });
    const w = await mountList();
    expect(w.findAll('[data-test="autoobserve-applied-row"]').map((r) => r.text())).toEqual([
      expect.stringContaining("disk latency"),
    ]);
  });

  it("nothing applied keeps today's empty state", async () => {
    api.list.mockResolvedValue(list([]));
    const w = await mountList();
    expect(w.find('[data-test="fallback"]').exists()).toBe(true);
  });

  it("Undo sends the revision and marks a session row undone once it succeeds", async () => {
    api.list.mockResolvedValue(list([]));
    api.undo.mockResolvedValue({
      data: { change: "undone", decision: view({ state: "undone" }) },
    } as never);
    recordApplied({
      org: "demo-org",
      view: view(),
      title: "disk latency",
      fields: [{ field: "pending_period_secs", from: 0, to: 120 }],
    });
    const w = await mountList();
    await w.find('[data-test="autoobserve-applied-undo"]').trigger("click");
    await flushPromises();
    expect(api.undo).toHaveBeenCalledWith(
      "demo-org",
      "alert_finding:f-1",
      expect.objectContaining({ expected_revision: 4 }),
    );
    expect(w.find('[data-test="autoobserve-applied-undone"]').text()).toBe("Undone");
  });

  it("an_undone_row_says_who_undid_it_at_the_time_the_server_gives", async () => {
    api.list.mockResolvedValue(
      list([
        view({
          state: "undone",
          actor: "root@example.com",
          change: { alert: { id: "al-1", title: "disk latency" }, fields: [] },
        }),
      ]),
    );
    const w = await mountList();
    const detail = w.find('[data-test="autoobserve-applied-detail"]').text();
    expect(detail).toMatch(/^undone by root@example\.com at /);
  });

  it("an_undone_row_keeps_its_change_time_when_the_server_sends_the_undo_time_apart", async () => {
    api.list.mockResolvedValue(
      list([
        {
          ...view({
            state: "undone",
            change: { alert: { id: "al-1", title: "disk latency" }, fields: [] },
          }),
          undone_at: Date.UTC(2026, 10, 10, 15, 30) * 1000,
          undone_by: "root@example.com",
        } as DecisionView,
      ]),
    );
    const w = await mountList();
    const detail = w.find('[data-test="autoobserve-applied-detail"]').text();
    expect(detail).toMatch(/^by ops@example\.com at .+ · undone by root@example\.com at .+$/);
  });

  it("a_row_undone_here_takes_the_undo_time_and_actor_the_server_returned", async () => {
    api.list.mockResolvedValue(list([]));
    api.undo.mockResolvedValue({
      data: {
        change: "undone",
        decision: view({
          state: "undone",
          actor: "root@example.com",
          decided_at: Date.UTC(2026, 10, 10, 15, 30) * 1000,
          revision: 5,
        }),
      },
    } as never);
    recordApplied({ org: "demo-org", view: view(), title: "disk latency", fields: [] });
    const w = await mountList();
    await w.find('[data-test="autoobserve-applied-undo"]').trigger("click");
    await flushPromises();
    const detail = w.find('[data-test="autoobserve-applied-detail"]').text();
    expect(detail).toMatch(/^undone by root@example\.com at /);
  });

  it("a failed Undo leaves the row offering Undo", async () => {
    api.list.mockResolvedValue(list([]));
    api.undo.mockRejectedValue({ response: { status: 409, data: {} } });
    recordApplied({ org: "demo-org", view: view(), title: "disk latency", fields: [] });
    const w = await mountList();
    await w.find('[data-test="autoobserve-applied-undo"]').trigger("click");
    await flushPromises();
    expect(w.find('[data-test="autoobserve-applied-undo"]').exists()).toBe(true);
  });
  it("Undo from the Apply toast marks this session's row Undone (D8)", async () => {
    api.list.mockResolvedValue(list([]));
    api.decide.mockResolvedValue({ data: { change: "created", decision: view() } } as never);
    api.undo.mockResolvedValue({
      data: { change: "undone", decision: view({ state: "undone" }) },
    } as never);
    const w = await mountWithRoute();
    const result = await route.decide(
      { family: "alert_finding", id: "f-1", action: "apply" },
      "disk latency",
    );
    recordApplied({ org: "demo-org", view: result.decision, title: "disk latency", fields: [] });
    await flushPromises();
    expect(w.find('[data-test="autoobserve-applied-undo"]').exists()).toBe(true);
    toastRecords
      .filter((r) => r.open)
      .at(-1)
      ?.action?.handler();
    await flushPromises();
    await flushPromises();
    expect(api.undo).toHaveBeenCalledTimes(1);
    expect(w.find('[data-test="autoobserve-applied-undone"]').text()).toBe("Undone");
    expect(w.find('[data-test="autoobserve-applied-undo"]').exists()).toBe(false);
    expect(String(toastRecords.filter((r) => r.open).at(-1)?.message)).toBe(
      "Undone: disk latency is back to how it was.",
    );
  });

  it("a failed Undo from the toast leaves the session row offering Undo (D8)", async () => {
    api.list.mockResolvedValue(list([]));
    api.decide.mockResolvedValue({ data: { change: "created", decision: view() } } as never);
    api.undo.mockRejectedValue({ response: { status: 500, data: {} } });
    const w = await mountWithRoute();
    const result = await route.decide(
      { family: "alert_finding", id: "f-1", action: "apply" },
      "disk latency",
    );
    recordApplied({ org: "demo-org", view: result.decision, title: "disk latency", fields: [] });
    toastRecords
      .filter((r) => r.open)
      .at(-1)
      ?.action?.handler();
    await flushPromises();
    await flushPromises();
    expect(w.find('[data-test="autoobserve-applied-undo"]').exists()).toBe(true);
  });
  it("undoing a server-listed apply keeps it as Undone while another apply stays listed (F4)", async () => {
    const applied = (id: string, title: string, at: number) =>
      view({
        decision_id: `alert_finding:${id}`,
        id,
        decided_at: at,
        change: {
          alert: { id: `al-${id}`, title },
          fields: [{ field: "pending_period_secs", from: 0, to: 120 }],
        },
        via: "apply",
      });
    const a = applied("a", "disk latency", 2_000);
    const b = applied("b", "queue depth", 1_000);
    api.list.mockImplementation(async () => list(api.undo.mock.calls.length ? [b] : [a, b]));
    api.undo.mockResolvedValue({
      data: { change: "undone", decision: { ...a, state: "undone" } },
    } as never);
    const w = await mountList();
    expect(w.findAll('[data-test="autoobserve-applied-row"]')).toHaveLength(2);
    await w.findAll('[data-test="autoobserve-applied-undo"]')[0].trigger("click");
    await flushPromises();
    await flushPromises();
    expect(api.list.mock.calls.length).toBeGreaterThan(1);
    const rows = w.findAll('[data-test="autoobserve-applied-row"]');
    expect(rows.map((r) => r.text())).toEqual([
      expect.stringContaining("disk latency"),
      expect.stringContaining("queue depth"),
    ]);
    expect(rows[0].find('[data-test="autoobserve-applied-undone"]').text()).toBe("Undone");
    expect(rows[1].find('[data-test="autoobserve-applied-undo"]').exists()).toBe(true);
  });

  it("a session apply undone from the toast stays Undone beside another server apply (F4)", async () => {
    const other = view({
      decision_id: "alert_finding:b",
      id: "b",
      decided_at: 1_000,
      change: { alert: { id: "al-b", title: "queue depth" }, fields: [] },
      via: "apply",
    });
    api.list.mockResolvedValue(list([other]));
    api.decide.mockResolvedValue({ data: { change: "created", decision: view() } } as never);
    api.undo.mockResolvedValue({
      data: { change: "undone", decision: view({ state: "undone" }) },
    } as never);
    const w = await mountWithRoute();
    const result = await route.decide(
      { family: "alert_finding", id: "f-1", action: "apply" },
      "disk latency",
    );
    recordApplied({ org: "demo-org", view: result.decision, title: "disk latency", fields: [] });
    toastRecords
      .filter((r) => r.open)
      .at(-1)
      ?.action?.handler();
    await flushPromises();
    await flushPromises();
    const rows = w.findAll('[data-test="autoobserve-applied-row"]');
    expect(rows.map((r) => r.text())).toEqual([
      expect.stringContaining("disk latency"),
      expect.stringContaining("queue depth"),
    ]);
    expect(rows[0].find('[data-test="autoobserve-applied-undone"]').exists()).toBe(true);
  });
  describe("rows reconcile by revision (F4)", () => {
    const applied = (revision: number) =>
      view({
        revision,
        change: {
          alert: { id: "al-1", title: "disk latency" },
          fields: [{ field: "pending_period_secs", from: 0, to: 120 }],
        },
        via: "apply",
      });
    const relist = async () => {
      await queryClient.invalidateQueries({ queryKey: autoobserveKeys.decisionsPages("demo-org") });
      await flushPromises();
      await flushPromises();
    };

    it("a reapply by another client after this session's Undo shows the newer apply with Undo", async () => {
      let server: DecisionView[] = [applied(4)];
      api.list.mockImplementation(async () => list(server));
      api.undo.mockResolvedValue({
        data: { change: "undone", decision: { ...applied(5), state: "undone" } },
      } as never);
      const w = await mountList();
      server = [];
      await w.find('[data-test="autoobserve-applied-undo"]').trigger("click");
      await flushPromises();
      await flushPromises();
      expect(w.find('[data-test="autoobserve-applied-undone"]').exists()).toBe(true);
      server = [applied(6)];
      await relist();
      expect(w.find('[data-test="autoobserve-applied-undone"]').exists()).toBe(false);
      await w.find('[data-test="autoobserve-applied-undo"]').trigger("click");
      await flushPromises();
      expect(api.undo).toHaveBeenLastCalledWith(
        "demo-org",
        "alert_finding:f-1",
        expect.objectContaining({ expected_revision: 6 }),
      );
    });

    it("Undo keeps the revision the server returned, so an older listed apply cannot bring Undo back", async () => {
      let server: DecisionView[] = [applied(4)];
      api.list.mockImplementation(async () => list(server));
      api.undo.mockResolvedValue({
        data: { change: "undone", decision: { ...applied(5), state: "undone" } },
      } as never);
      const w = await mountList();
      await w.find('[data-test="autoobserve-applied-undo"]').trigger("click");
      await flushPromises();
      await flushPromises();
      server = [applied(4)];
      await relist();
      expect(w.find('[data-test="autoobserve-applied-undone"]').text()).toBe("Undone");
      expect(w.find('[data-test="autoobserve-applied-undo"]').exists()).toBe(false);
      const rows = useAppliedChanges("demo-org", [applied(4)]).value;
      expect(rows.map((r) => [r.view.revision, r.view.state])).toEqual([[5, "undone"]]);
    });

    it("a session apply older than the server's row sends the server's revision on Undo", async () => {
      recordApplied({ org: "demo-org", view: applied(2), title: "disk latency", fields: [] });
      api.list.mockResolvedValue(list([applied(6)]));
      api.undo.mockResolvedValue({
        data: { change: "undone", decision: { ...applied(7), state: "undone" } },
      } as never);
      const w = await mountList();
      expect(w.findAll('[data-test="autoobserve-applied-row"]')).toHaveLength(1);
      expect(w.find('[data-test="autoobserve-applied-detail"]').text()).toMatch(/^Hold for /);
      await w.find('[data-test="autoobserve-applied-undo"]').trigger("click");
      await flushPromises();
      expect(api.undo).toHaveBeenCalledWith(
        "demo-org",
        "alert_finding:f-1",
        expect.objectContaining({ expected_revision: 6 }),
      );
    });

    it("a session row at the same revision as the server's row stays this session's", async () => {
      recordApplied({
        org: "demo-org",
        view: { ...applied(4), state: "undone" },
        title: "disk latency",
        fields: [],
      });
      api.list.mockResolvedValue(list([applied(4)]));
      const w = await mountList();
      expect(w.find('[data-test="autoobserve-applied-undone"]').text()).toBe("Undone");
    });
  });
});
