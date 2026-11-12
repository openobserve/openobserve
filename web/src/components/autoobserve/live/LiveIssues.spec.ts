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
import { reactive } from "vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import { queryClient } from "@/composables/query/queryClient";
import autoobserve, {
  type AutoObserveIncidentItem,
  type AutoObserveIncidentList,
} from "@/services/autoobserve";
import fixture from "./__fixtures__/autoobserveIncidents.json";
import LiveIssues from "./LiveIssues.vue";

const routeQuery = reactive<Record<string, string | undefined>>({});
const push = vi.fn();
const replace = vi.fn(({ query }: { query: Record<string, string | undefined> }) => {
  for (const key of Object.keys(routeQuery)) delete routeQuery[key];
  Object.assign(routeQuery, query);
});
vi.mock("vue-router", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useRoute: () => ({ query: routeQuery }),
  useRouter: () => ({ push, replace }),
}));

vi.mock("@/services/autoobserve", () => ({
  default: { coverage: vi.fn(), suggestions: vi.fn(), incidents: vi.fn() },
}));

vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

const api = vi.mocked(autoobserve.incidents);

const NOW = Date.UTC(2026, 10, 6, 12, 0);
const HOUR_US = 3_600_000_000;
const FIXTURE = fixture as unknown as AutoObserveIncidentList;

// Fixture rows re-dated to `hoursAgo`, so the range filter keeps them.
const at = (index: number, hoursAgo: number, id = `inc-${index}-${hoursAgo}`) => {
  const base = FIXTURE.items[index];
  const us = NOW * 1000 - hoursAgo * HOUR_US;
  return {
    ...base,
    finding: { ...base.finding, id: `f-${id}`, first_seen_at: us },
    incident: { ...base.incident, id, created_at: us },
  } as AutoObserveIncidentItem;
};

// The same fixture row at an exact microsecond, for rows that sit on the range boundary.
const atUs = (index: number, us: number, id: string) => {
  const base = FIXTURE.items[index];
  return {
    ...base,
    finding: { ...base.finding, id: `f-${id}`, first_seen_at: us },
    incident: { ...base.incident, id, created_at: us },
  } as AutoObserveIncidentItem;
};

// Fixture row 4 has no run, so nothing polls and only the clock changes the rows.
const quiet = (n: number) => Array.from({ length: n }, (_, i) => at(4, 1 + i, `inc-q-${i}`));

const notRun = (item: AutoObserveIncidentItem, reason: string | null) =>
  ({
    ...item,
    investigation: {
      run_id: null,
      state: null,
      outcome: null,
      summary: null,
      not_run_reason: reason,
    },
  }) as AutoObserveIncidentItem;

const page = (items: AutoObserveIncidentItem[], extra: Partial<AutoObserveIncidentList> = {}) =>
  ({ data: { paging: true, has_more: false, items, ...extra } }) as never;

const httpError = (status: number) => ({
  response: { status, data: { message: `status ${status}` } },
});

const originalOrg = store.state.selectedOrganization;
const originalConfig = store.state.zoConfig;

let wrappers: ReturnType<typeof mountTable>[] = [];
const mountTable = (range: "7d" | "30d" | "90d" = "30d") => {
  const wrapper = mount(LiveIssues, {
    props: { range, initialFilter: "all" },
    attachTo: document.body,
    global: {
      plugins: [i18n, store],
      // The drawer and the per-row chart have their own specs; here only what the table hands them counts.
      stubs: { AutoObserveIssueDrawer: true, IssueSignal: true },
    },
  });
  wrappers.push(wrapper);
  return wrapper;
};

const sel = (name: string) => `[data-test="autoobserve-live-issues-${name}"]`;
const bodyRows = (w: ReturnType<typeof mountTable>) => w.findAll('[data-test^="o2-table-row-"]');
const sentences = (w: ReturnType<typeof mountTable>) =>
  w.findAll(sel("sentence")).map((s) => s.text());

const ticking = () => {
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  vi.setSystemTime(NOW);
};

const nextPage = (w: ReturnType<typeof mountTable>) =>
  w.find('[data-test="o2-table-next-page-btn"]').trigger("click");

const loaded = async () => {
  await vi.waitFor(() => expect(api).toHaveBeenCalled());
  await flushPromises();
  await flushPromises();
};

describe("LiveIssues", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    api.mockReset();
    push.mockReset();
    replace.mockClear();
    for (const key of Object.keys(routeQuery)) delete routeQuery[key];
    store.commit("setSelectedOrganization", { ...originalOrg, identifier: "demo-org" });
    store.commit("setConfig", { ...originalConfig, incidents_rca_enabled: true });
  });

  afterEach(() => {
    for (const w of wrappers) w.unmount();
    wrappers = [];
    vi.useRealTimers();
    store.commit("setSelectedOrganization", originalOrg);
    store.commit("setConfig", originalConfig);
  });

  it("zero rows in the range shows the range's empty state", async () => {
    api.mockResolvedValue(page([at(0, 24 * 40)]));
    const w = mountTable("30d");
    await loaded();
    expect(w.find(sel("empty")).text()).toContain("No issues in the last 30 days");
    expect(bodyRows(w)).toHaveLength(0);
    expect(w.find('[role="alert"]').exists()).toBe(false);
  });

  it("paging off with no rows is a neutral note, not an error", async () => {
    api.mockResolvedValue(page([], { paging: false }));
    const w = mountTable();
    await loaded();
    expect(w.find(sel("empty-off")).text()).toContain("Paging is off");
    expect(w.find(sel("empty-off")).find('[data-test="o2-icon"], svg').exists()).toBe(true);
    expect(w.find('[role="alert"]').exists()).toBe(false);
  });

  it("one row reads in the singular, with a short incident id and no finding id", async () => {
    api.mockResolvedValue(page([at(0, 1, "V5wPnqa6c0qfMLxGTdrwcF68Xq8")]));
    const w = mountTable();
    await loaded();
    expect(bodyRows(w)).toHaveLength(1);
    expect(w.find(sel("count")).text()).toBe("1 issue");
    expect(sentences(w)).toEqual(["checkout (logs) stopped sending data"]);
    expect(w.find(sel("stream")).text()).toBe("checkout");
    expect(w.find(sel("id")).text()).toBe("V5wPnqa6");
    expect(w.find(sel("id")).attributes("title")).toBe("V5wPnqa6c0qfMLxGTdrwcF68Xq8");
    expect(w.text()).not.toContain("f-inc");
  });

  it("the meta line holds the span, duration, grouping, who was paged and the analysis", async () => {
    const base = at(4, 1, "inc-meta");
    api.mockResolvedValue(
      page([{ ...base, page: { outcome: "paged", team_id: "t", team_name: "SRE" } } as never]),
    );
    const w = mountTable();
    await loaded();
    const meta = w.get(sel("meta")).text();
    expect(meta).toContain("→ now");
    expect(meta).toContain("1 hour");
    expect(meta).toContain("Paged SRE");
    // No dot dangles before the badge when it wraps.
    expect(meta).not.toMatch(/Paged SRE\s*·/);
    expect(w.find(sel("analysis")).exists()).toBe(true);
    expect(w.get(sel("cause")).text()).toContain("search (logs) has received much less data");
  });

  it("each row hands its lead stream to the shared signal chart, live only while open", async () => {
    api.mockResolvedValue(page([at(4, 1, "inc-open"), at(2, 2, "inc-done")]));
    const w = mountTable();
    await loaded();
    const charts = w.findAllComponents({ name: "IssueSignal" });
    expect(charts).toHaveLength(2);
    expect(charts[0].props("stream")).toMatchObject({ type: "logs", name: "search", lead: true });
    expect(charts[0].props("active")).toBe(true);
    expect(charts[1].props("active")).toBe(false);
  });

  it("search matches the incident id and the cause, not only the sentence", async () => {
    api.mockResolvedValue(page([at(0, 1, "inc-findme"), at(4, 2, "inc-other")]));
    const w = mountTable();
    await loaded();
    await w.find(`${sel("search")} input`).setValue("inc-findme");
    await flushPromises();
    expect(sentences(w)).toEqual(["checkout (logs) stopped sending data"]);
    await w.find(`${sel("search")} input`).setValue("much less data");
    await flushPromises();
    expect(sentences(w)).toEqual(["search (logs) volume dropped sharply"]);
  });

  it("twelve rows across three days make three day groups, newest first", async () => {
    const items = [0, 1, 2, 3].flatMap((i) => [at(i, 1 + i), at(i, 25 + i), at(i, 49 + i)]);
    items.sort((a, b) => b.finding.first_seen_at - a.finding.first_seen_at);
    api.mockResolvedValue(page(items));
    const w = mountTable();
    await loaded();
    expect(bodyRows(w)).toHaveLength(12);
    expect(w.find(sel("count")).text()).toBe("12 issues");
    const days = w.findAll('[data-test^="autoobserve-live-issues-day-"]');
    expect(days).toHaveLength(3);
    expect(days[0].text()).toContain("Today");
    expect(days[0].text()).toContain("· 4");
    expect(days[1].text()).toContain("Yesterday");
  });

  it("a row click opens the AutoObserve drawer on Overview and records it in the URL", async () => {
    api.mockResolvedValue(page([at(0, 1, "inc-abc")]));
    const w = mountTable();
    await loaded();
    const drawer = w.findComponent({ name: "AutoObserveIssueDrawer" });
    expect(drawer.props("open")).toBe(false);
    await bodyRows(w)[0].trigger("click");
    await flushPromises();
    expect(push).not.toHaveBeenCalled();
    expect(routeQuery.incident).toBe("inc-abc");
    expect(drawer.props("open")).toBe(true);
    expect(drawer.props("liveItem")?.incident.id).toBe("inc-abc");
    expect(drawer.props("liveTab")).toBe("overview");
    drawer.vm.$emit("update:open", false);
    await flushPromises();
    expect(routeQuery.incident).toBeUndefined();
    expect(drawer.props("open")).toBe(false);
  });

  it("a linked incident reopens its drawer on reload", async () => {
    routeQuery.incident = "inc-linked";
    api.mockResolvedValue(page([at(0, 1, "inc-linked")]));
    const w = mountTable();
    await loaded();
    const drawer = w.findComponent({ name: "AutoObserveIssueDrawer" });
    expect(drawer.props("open")).toBe(true);
  });

  it("the analysis badge of a run opens the drawer on its analysis tab", async () => {
    api.mockResolvedValue(page([at(1, 1, "inc-run")]));
    const w = mountTable();
    await loaded();
    await w.find(sel("analysis-link")).trigger("click");
    await flushPromises();
    expect(push).not.toHaveBeenCalled();
    expect(routeQuery.incident).toBe("inc-run");
    expect(w.findComponent({ name: "AutoObserveIssueDrawer" }).props("liveTab")).toBe("analysis");
  });

  it("a 403 is the red denial with no Retry", async () => {
    api.mockRejectedValue(httpError(403));
    const w = mountTable();
    await loaded();
    const denied = w.find(sel("denied"));
    expect(denied.attributes("role")).toBe("alert");
    expect(denied.text()).toContain("You don't have permission to see issues");
    expect(w.find(sel("retry")).exists()).toBe(false);
    expect(w.find(sel("count-skeleton")).exists()).toBe(false);
  });

  it("a 503 is unavailable, with Retry", async () => {
    api.mockRejectedValue(httpError(503));
    const w = mountTable();
    await loaded();
    expect(w.find(sel("unavailable")).text()).toContain("temporarily unavailable");
    expect(w.find(sel("retry")).exists()).toBe(true);
  });

  it("a failed refresh after data keeps the rows under a stale banner", async () => {
    api.mockResolvedValueOnce(page([at(0, 1), at(3, 2)]));
    const w = mountTable();
    await loaded();
    expect(bodyRows(w)).toHaveLength(2);
    api.mockRejectedValueOnce(httpError(500));
    await queryClient.refetchQueries({
      queryKey: ["org", "demo-org", "autoobserve", "incidents", "pages"],
    });
    await flushPromises();
    expect(w.find(sel("refresh-failed")).exists()).toBe(true);
    expect(bodyRows(w)).toHaveLength(2);
    expect(w.find(sel("error")).exists()).toBe(false);
  });

  it("search filters to the matching stream, round-trips q, and offers Clear search", async () => {
    api.mockResolvedValue(page([at(0, 1), at(3, 2), at(4, 3)]));
    const w = mountTable();
    await loaded();
    expect(bodyRows(w)).toHaveLength(3);
    await w.find(`${sel("search")} input`).setValue("INVENTORY");
    await vi.waitFor(() => expect(replace).toHaveBeenCalled());
    expect(routeQuery.q).toBe("INVENTORY");
    await flushPromises();
    expect(sentences(w)).toEqual(["inventory (metrics) stopped sending data"]);

    await w.find(`${sel("search")} input`).setValue("no-such-stream");
    await vi.waitFor(() => expect(routeQuery.q).toBe("no-such-stream"));
    await flushPromises();
    const none = w.find(sel("no-match"));
    expect(none.text()).toContain("No issues match");
    expect(none.text()).toContain("Clear search");
  });

  it("a q in the URL filters on first paint", async () => {
    routeQuery.q = "payments";
    api.mockResolvedValue(page([at(0, 1), at(1, 2)]));
    const w = mountTable();
    await loaded();
    expect(sentences(w)).toEqual(["payments (logs) volume dropped sharply"]);
  });

  it("page 2 survives a clock tick; a search or a range change goes back to page 1", async () => {
    ticking();
    api.mockResolvedValue(page(quiet(25)));
    const w = mountTable("30d");
    await loaded();
    expect(bodyRows(w)).toHaveLength(20);
    await nextPage(w);
    expect(bodyRows(w)).toHaveLength(5);

    vi.advanceTimersByTime(60_000);
    await flushPromises();
    expect(bodyRows(w)).toHaveLength(5);

    const stream = FIXTURE.items[4].finding.stream_name ?? "";
    await w.find(`${sel("search")} input`).setValue(stream);
    await flushPromises();
    expect(bodyRows(w)).toHaveLength(20);

    await nextPage(w);
    expect(bodyRows(w)).toHaveLength(5);
    await w.setProps({ range: "90d" });
    await flushPromises();
    expect(bodyRows(w)).toHaveLength(20);
  });

  it("a status filter change goes back to page 1", async () => {
    api.mockResolvedValue(page(quiet(25)));
    const w = mountTable("30d");
    await loaded();
    await nextPage(w);
    expect(bodyRows(w)).toHaveLength(5);
    await w.find(sel("filter-open")).trigger("click");
    await flushPromises();
    expect(bodyRows(w).length).toBeGreaterThan(5);
  });

  it("a tick that drops rows out of the range lands on the last page left", async () => {
    ticking();
    const edge = (NOW - 7 * 24 * 3_600_000 + 30_000) * 1000;
    const old = Array.from({ length: 5 }, (_, i) => atUs(4, edge - i, `inc-edge-${i}`));
    api.mockResolvedValue(page([...quiet(20), ...old]));
    const w = mountTable("7d");
    await loaded();
    await nextPage(w);
    expect(bodyRows(w)).toHaveLength(5);

    vi.advanceTimersByTime(60_000);
    await flushPromises();
    await flushPromises();
    expect(bodyRows(w)).toHaveLength(20);
  });

  it("one row keeps its analysis reason on the row", async () => {
    api.mockResolvedValue(page([notRun(at(4, 1), "rca_disabled")]));
    const w = mountTable();
    await loaded();
    expect(w.findAll(sel("analysis-detail")).map((d) => d.text())).toEqual([
      "AI analysis was off when this incident opened.",
    ]);
    expect(w.find(sel("shared-analysis")).exists()).toBe(false);
  });

  it("three rows that share a reason state it once, above the table", async () => {
    const items = [1, 2, 3].map((h) => notRun(at(4, h, `inc-off-${h}`), "rca_disabled"));
    api.mockResolvedValue(page(items));
    const w = mountTable();
    await loaded();
    expect(w.findAll(sel("analysis"))).toHaveLength(3);
    expect(w.findAll(sel("analysis-detail"))).toHaveLength(0);
    expect(w.find(sel("shared-analysis")).text()).toBe(
      "AI analysis was off when these incidents opened.",
    );
    expect(w.text()).not.toContain("when this incident opened");
  });

  it("rows with different reasons keep each reason on its row", async () => {
    const items = [notRun(at(4, 1, "inc-a"), "rca_disabled"), notRun(at(4, 2, "inc-b"), null)];
    api.mockResolvedValue(page(items));
    const w = mountTable();
    await loaded();
    expect(w.findAll(sel("analysis-detail"))).toHaveLength(2);
    expect(w.find(sel("shared-analysis")).exists()).toBe(false);
  });

  it("twelve rows that share a reason still state it once", async () => {
    const items = Array.from({ length: 12 }, (_, i) =>
      notRun(at(4, 1 + i, `inc-twelve-${i}`), "rca_disabled"),
    );
    api.mockResolvedValue(page(items));
    const w = mountTable();
    await loaded();
    expect(bodyRows(w)).toHaveLength(12);
    expect(w.findAll(sel("analysis-detail"))).toHaveLength(0);
    expect(w.findAll(sel("shared-analysis"))).toHaveLength(1);
    expect(w.find(sel("count")).text()).toBe("12 issues");
  });

  it("a failed refresh keeps a shared reason beside the stale banner", async () => {
    const items = [1, 2, 3].map((h) => notRun(at(4, h, `inc-stale-${h}`), "rca_disabled"));
    api.mockResolvedValueOnce(page(items));
    const w = mountTable();
    await loaded();
    api.mockRejectedValueOnce(httpError(500));
    await queryClient.refetchQueries({
      queryKey: ["org", "demo-org", "autoobserve", "incidents", "pages"],
    });
    await flushPromises();
    const summary = w.find(sel("summary"));
    expect(summary.find(sel("refresh-failed")).attributes("role")).toBe("alert");
    expect(summary.find(sel("shared-analysis")).text()).toBe(
      "AI analysis was off when these incidents opened.",
    );
    expect(bodyRows(w)).toHaveLength(3);
    expect(w.findAll(sel("analysis-detail"))).toHaveLength(0);
  });

  it("a failed refresh over mixed reasons keeps each reason on its row", async () => {
    const items = [notRun(at(4, 1, "inc-m1"), "rca_disabled"), notRun(at(4, 2, "inc-m2"), null)];
    api.mockResolvedValueOnce(page(items));
    const w = mountTable();
    await loaded();
    api.mockRejectedValueOnce(httpError(500));
    await queryClient.refetchQueries({
      queryKey: ["org", "demo-org", "autoobserve", "incidents", "pages"],
    });
    await flushPromises();
    expect(w.find(sel("refresh-failed")).exists()).toBe(true);
    expect(w.find(sel("shared-analysis")).exists()).toBe(false);
    expect(w.findAll(sel("analysis-detail"))).toHaveLength(2);
  });

  describe("rows say what the home card says (W2)", () => {
    const member = (name: string) => ({
      id: `f-${name}`,
      title: `${name} (logs) stopped sending data`,
      stream_type: "logs",
      stream_name: name,
      first_seen_at: NOW * 1000 - HOUR_US,
      recovered_at: null,
    });
    const cohort = () => {
      const base = at(0, 1, "inc-cohort");
      return {
        ...base,
        finding: { ...base.finding, kind: "stream_silence", stream_name: "batch_x1" },
        members: [member("batch_x1"), member("batch_x2"), member("batch_x3")],
      } as AutoObserveIncidentItem;
    };
    const paged = (i: number, outcome: string, team: string | null) =>
      ({
        ...at(4, 1 + i, `inc-p-${i}`),
        page: { outcome, team_id: team, team_name: team },
      }) as AutoObserveIncidentItem;

    it("a group reads as the group, names its lead plus the rest, and every member is searchable", async () => {
      api.mockResolvedValue(page([cohort()]));
      const w = mountTable();
      await loaded();
      expect(sentences(w)).toEqual(["3 streams stopped sending data"]);
      const chips = w.get(sel("stream"));
      expect(chips.findAll(sel("stream-text")).map((c) => c.text())).toEqual([
        "batch_x1",
        "batch_x2",
      ]);
      expect(chips.get(sel("stream-more")).text()).toBe("+1");
      expect(chips.attributes("title")).toBe("batch_x1, batch_x2, batch_x3");
      expect(w.get(sel("meta")).text()).toContain("3 streams → 1 incident");
      await w.find(`${sel("search")} input`).setValue("batch_x3");
      await flushPromises();
      expect(sentences(w)).toEqual(["3 streams stopped sending data"]);
    });

    it("each row says who was paged, with failures red and nobody amber", async () => {
      api.mockResolvedValue(
        page([
          paged(0, "paged", "SRE"),
          paged(1, "unrouted", null),
          paged(2, "failed", "SRE"),
          paged(3, "pending", null),
        ]),
      );
      const w = mountTable();
      await loaded();
      const cells = w.findAll(sel("page"));
      expect(cells.map((c) => c.text())).toEqual([
        "Paged SRE",
        "Nobody paged",
        "Paging failed",
        "Not confirmed yet",
      ]);
      expect(cells[1].attributes("data-tone")).toBe("warning");
      expect(cells[2].attributes("data-tone")).toBe("error");
      expect(cells[0].attributes("data-tone")).toBe("neutral");
    });

    it("cuts a long team name and a long unbroken sentence with an ellipsis, not mid-glyph (T1-N7)", async () => {
      api.mockResolvedValue(
        page([paged(0, "paged", "A Very Long Team Name For The Platform On Call Rotation")]),
      );
      const w = mountTable();
      await loaded();
      const chip = w.get(sel("page"));
      expect(chip.classes()).toContain("max-w-full");
      expect(chip.classes()).toContain("truncate");
      expect(w.get(sel("sentence")).classes()).toContain("wrap-anywhere");
    });

    it("cuts a long stream name with an ellipsis inside the cell (T1-N7)", async () => {
      const base = at(4, 1, "inc-long-stream");
      const long = "k8s_cluster_e_namespace_g_payments_backend_ingest_and_enrichment_pipeline_logs";
      api.mockResolvedValue(page([{ ...base, finding: { ...base.finding, stream_name: long } }]));
      const w = mountTable();
      await loaded();
      const chip = w.get(sel("stream"));
      expect(chip.classes()).toContain("overflow-hidden");
      const text = chip.get('[data-test="autoobserve-live-issues-stream-text"]');
      expect(text.classes()).toContain("truncate");
      expect(text.text()).toBe(long);
    });

    it("keeps the two-line sentence clamp clear of the cell padding, so no third line peeks (F-N2)", async () => {
      api.mockResolvedValue(page([at(4, 1)]));
      const w = mountTable();
      await loaded();
      const sentence = w.get(sel("sentence"));
      expect(sentence.classes().some((c) => /^p[ytb]?-/.test(c))).toBe(false);
      expect(sentence.element.parentElement?.classList.contains("py-1.5")).toBe(true);
    });

    it("the status filter says Open, the word the status chip uses", async () => {
      api.mockResolvedValue(page([at(4, 1)]));
      const w = mountTable();
      await loaded();
      expect(w.find(sel("filter-open")).text()).toBe("Open");
    });

    it("a denial hides the search, filters and counts but keeps their space, so the table doesn't jump (T5-N4)", async () => {
      api.mockRejectedValue(httpError(403));
      const w = mountTable();
      await loaded();
      expect(w.find(sel("denied")).exists()).toBe(true);
      for (const part of ["controls", "summary"]) {
        const box = w.get(sel(part));
        expect(box.classes(), part).toContain("invisible");
        expect(box.attributes("inert"), part).toBeDefined();
        expect(box.attributes("aria-hidden"), part).toBe("true");
      }
    });

    it("loaded, the controls are visible and usable", async () => {
      api.mockResolvedValue(page([at(4, 1)]));
      const w = mountTable();
      await loaded();
      expect(w.get(sel("controls")).classes()).not.toContain("invisible");
      expect(w.get(sel("controls")).attributes("inert")).toBeUndefined();
    });

    it("while loading, the priority counts are blank, not zero", async () => {
      api.mockReturnValue(new Promise(() => {}) as never);
      const w = mountTable();
      await flushPromises();
      expect(w.find(sel("priority")).findAll(".tabular-nums")).toHaveLength(0);
    });

    it("a failed load names the page's own noun", async () => {
      api.mockRejectedValue(httpError(500));
      const w = mountTable();
      await loaded();
      expect(w.find(sel("error")).text()).toContain("Couldn't load issues");
    });
  });
});
