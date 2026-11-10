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

import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import { queryClient } from "@/composables/query/queryClient";
import autoobserve, {
  type AutoObserveIncidentItem,
  type AutoObserveIncidentList,
} from "@/services/autoobserve";
import fixture from "./__fixtures__/autoobserveIncidents.json";
import config from "@/aws-exports";
import appStore from "@/stores";
import { b64DecodeUnicode } from "@/utils/zincutils";
import { ASK_AI_KEY, type InsightAskPayload } from "../insight/insightCta";
import { analysisLink, incidentLink } from "./incidentsCopy";
import LivePaged from "./LivePaged.vue";
import oncall from "@/services/oncall";

const routeQuery: Record<string, string> = { live: "1" };
const push = vi.fn();
vi.mock("vue-router", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useRoute: () => ({ query: routeQuery }),
  useRouter: () => ({ push }),
}));

vi.mock("@/services/oncall", () => ({
  default: { getRoutingConfig: vi.fn(() => Promise.resolve({ data: { default_team_id: null } })) },
}));

vi.mock("@/services/autoobserve", () => ({
  default: { coverage: vi.fn(), suggestions: vi.fn(), incidents: vi.fn() },
}));

const api = vi.mocked(autoobserve.incidents);

const FIXTURE = fixture as unknown as AutoObserveIncidentList;
const pick = (...indexes: number[]): AutoObserveIncidentItem[] =>
  indexes.map((i) => FIXTURE.items[i]);

// Fixture row 4 re-keyed and given a not-run reason, so many rows can share one reason.
const notRun = (n: number, reason: string | null = "rca_disabled") => {
  const base = FIXTURE.items[4];
  return {
    ...base,
    finding: { ...base.finding, id: `f-off-${n}` },
    incident: { ...base.incident, id: `inc-off-${n}` },
    investigation: {
      run_id: null,
      state: null,
      outcome: null,
      summary: null,
      not_run_reason: reason,
    },
  } as AutoObserveIncidentItem;
};
const offRows = (n: number) => Array.from({ length: n }, (_, i) => notRun(i));

const page = (items: AutoObserveIncidentItem[], extra: Partial<AutoObserveIncidentList> = {}) =>
  ({ data: { paging: true, has_more: false, items, ...extra } }) as never;

const httpError = (status: number) => ({
  response: { status, data: { message: `status ${status}` } },
});

const later = <T>(ms: number, value: T) =>
  new Promise<T>((resolve) => setTimeout(() => resolve(value), ms));

const originalOrg = store.state.selectedOrganization;
const originalConfig = store.state.zoConfig;

let wrappers: ReturnType<typeof mountCard>[] = [];
const mountCard = (
  props: { cap?: number } = {},
  ask: ((payload: InsightAskPayload) => void) | null = null,
) => {
  const wrapper = mount(LivePaged, {
    props,
    attachTo: document.body,
    global: { plugins: [i18n, store], provide: ask ? { [ASK_AI_KEY as symbol]: ask } : {} },
  });
  wrappers.push(wrapper);
  return wrapper;
};

const sel = (name: string) => `[data-test="autoobserve2-paged${name ? `-${name}` : ""}"]`;
const rows = (w: ReturnType<typeof mountCard>) =>
  w.findAll('[data-test^="autoobserve2-paged-row-"]');
const sentences = (w: ReturnType<typeof mountCard>) =>
  w.findAll(sel("sentence")).map((s) => s.text());

const refetch = async () => {
  await queryClient.refetchQueries({ queryKey: ["org", "demo-org", "autoobserve", "incidents"] });
  await flushPromises();
};

describe("LivePaged (D9-web)", () => {
  beforeEach(() => {
    api.mockReset();
    push.mockReset();
    routeQuery.live = "1";
    delete routeQuery.fixture;
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

  it("zero findings with paging on shows the empty state", async () => {
    api.mockResolvedValue(page([]));
    const w = mountCard();
    await flushPromises();
    expect(w.find(sel("empty")).text()).toContain("Nothing has paged anyone");
    expect(w.find(sel("empty")).text()).toContain("When a stream stops");
    expect(rows(w)).toHaveLength(0);
    expect(w.find('[role="alert"]').exists()).toBe(false);
  });

  it("paging off is a neutral note, not an error", async () => {
    api.mockResolvedValueOnce(page([], { paging: false }));
    const off = mountCard();
    await flushPromises();
    expect(off.find(sel("empty-off")).text()).toContain("Paging is off");
    expect(off.find('[role="alert"]').exists()).toBe(false);
    expect(off.html()).not.toContain("status-error");
    expect(off.find(sel("subtitle")).exists()).toBe(true);

    queryClient.clear();
    api.mockResolvedValueOnce(page(pick(0), { paging: false }));
    const one = mountCard();
    await flushPromises();
    expect(rows(one)).toHaveLength(1);
    expect(one.find(sel("subtitle-slot")).text()).toBe(
      "Paging is off for this organization, so AutoObserve opens no incidents.",
    );
    expect(one.find('[role="alert"]').exists()).toBe(false);
  });

  it("one, a few and many findings", async () => {
    api.mockResolvedValueOnce(page(pick(0)));
    const one = mountCard();
    await flushPromises();
    expect(rows(one)).toHaveLength(1);
    expect(one.find(sel("more")).exists()).toBe(false);

    queryClient.clear();
    api.mockResolvedValueOnce(page(pick(0, 1, 2)));
    const few = mountCard();
    await flushPromises();
    expect(rows(few)).toHaveLength(3);
    expect(few.find(sel("more")).exists()).toBe(false);
    expect(few.find(sel("see-all")).exists()).toBe(false);

    queryClient.clear();
    api.mockResolvedValueOnce(page(FIXTURE.items, { has_more: true }));
    const many = mountCard();
    await flushPromises();
    expect(rows(many)).toHaveLength(3);
    expect(many.find(sel("more")).text()).toBe("Showing the 3 newest");
    expect(many.find(sel("see-all")).text()).toBe("See all issues");
    await many.find(sel("see-all")).trigger("click");
    expect(push).toHaveBeenCalledWith({
      query: expect.objectContaining({ org_identifier: "demo-org", page: "issues" }),
    });
  });

  it("Open incident and View analysis route to the incident page", async () => {
    api.mockResolvedValueOnce(page(pick(0, 1, 3)));
    const w = mountCard();
    await flushPromises();
    const row = w.find(sel("row-1"));
    await row.find(sel("open")).trigger("click");
    expect(push).toHaveBeenLastCalledWith(incidentLink("demo-org", "inc-0002"));
    await row.find(sel("view-analysis")).trigger("click");
    expect(push).toHaveBeenLastCalledWith(analysisLink("demo-org", "inc-0002"));
    expect(push.mock.calls[1][0].query.tab).toBe("incidentAnalysis");
    const noRun = w.find(sel("row-2"));
    expect(noRun.find(sel("actions")).exists()).toBe(true);
    expect(noRun.find(sel("open")).exists()).toBe(true);
    expect(noRun.find(sel("view-analysis")).exists()).toBe(false);
  });

  it("a failed load is red and says what failed", async () => {
    api.mockRejectedValueOnce(httpError(500));
    const failed = mountCard();
    await flushPromises();
    const error = failed.find(sel("error"));
    expect(error.attributes("role")).toBe("alert");
    expect(error.text()).toContain("Couldn't load paged findings");
    expect(failed.find(sel("empty")).exists()).toBe(false);
    expect(failed.find(sel("error-details")).exists()).toBe(true);
    api.mockResolvedValueOnce(page(pick(0)));
    await failed.find(sel("retry")).trigger("click");
    await flushPromises();
    expect(api).toHaveBeenCalledTimes(2);
    expect(rows(failed)).toHaveLength(1);

    const cases = [
      [403, "denied", "alert", false],
      [404, "off", undefined, false],
      [503, "unavailable", "alert", true],
    ] as const;
    for (const [status, name, role, retry] of cases) {
      queryClient.clear();
      api.mockRejectedValueOnce(httpError(status));
      const w = mountCard();
      await flushPromises();
      const notice = w.find(sel(name));
      expect(notice.exists()).toBe(true);
      expect(notice.attributes("role")).toBe(role);
      expect(w.find(sel("retry")).exists()).toBe(retry);
      expect(w.find(sel("empty")).exists()).toBe(false);
    }
  });

  it("a failed load's Details never shows the server's message", async () => {
    const LEAK = /rca-agent|connection refused|Request failed|Network Error/;
    api.mockRejectedValueOnce({
      message: "Request failed with status code 500",
      response: {
        status: 500,
        data: { message: "dial http://rca-agent.internal:9000: connection refused" },
      },
    });
    const failed = mountCard();
    await flushPromises();
    await failed.find(sel("error-details")).trigger("click");
    expect(failed.find(sel("error")).text()).toMatch(/The request failed with status 500 at .+\./);
    expect(failed.text()).not.toMatch(LEAK);

    queryClient.clear();
    api.mockRejectedValueOnce({ message: "Network Error" });
    const offline = mountCard();
    await flushPromises();
    await offline.find(sel("error-details")).trigger("click");
    expect(offline.find(sel("error")).text()).toMatch(/The request got no response at .+\./);
    expect(offline.text()).not.toMatch(LEAK);
  });

  it("a failed refresh keeps the rows and reports in place", async () => {
    api.mockResolvedValueOnce(page(pick(0, 1)));
    const w = mountCard();
    await flushPromises();
    const slot = w.find(sel("subtitle-slot"));
    const body = w.find(sel("body"));
    const before = Array.from(body.element.parentElement!.children).indexOf(body.element);
    api.mockRejectedValueOnce(httpError(500));
    await refetch();
    expect(sentences(w)).toEqual([
      FIXTURE.items[0].incident.title,
      FIXTURE.items[1].incident.title,
    ]);
    const failed = w.find(sel("subtitle-slot")).find(sel("refresh-failed"));
    expect(failed.attributes("role")).toBe("alert");
    expect(failed.text()).toMatch(/Refresh failed at .+ · showing paged findings from .+/);
    expect(failed.find('[data-test="o-truncated-text"]').classes()).toContain("line-clamp-3");
    expect(w.find(sel("subtitle-slot")).element).toBe(slot.element);
    expect(slot.classes()).toContain("h-[2lh]");
    expect(Array.from(body.element.parentElement!.children).indexOf(body.element)).toBe(before);
    expect(w.findAll('[role="alert"]')).toHaveLength(1);
  });

  it("a new finding on refetch never moves the rows", async () => {
    api.mockResolvedValueOnce(page(pick(1, 2)));
    const w = mountCard();
    await flushPromises();
    const titles = (...i: number[]) => i.map((n) => FIXTURE.items[n].incident.title);
    expect(sentences(w)).toEqual(titles(1, 2));
    api.mockResolvedValueOnce(page(pick(0, 1, 2)));
    await refetch();
    expect(sentences(w)).toEqual(titles(1, 2));
    expect(w.find(sel("new")).text()).toContain("1 new finding");
    const show = w.find(sel("show-new"));
    expect(show.text()).toBe("Show");
    (show.element as HTMLElement).focus();
    await show.trigger("click");
    await flushPromises();
    expect(sentences(w)).toEqual(titles(0, 1, 2));
    expect(w.find(sel("new")).exists()).toBe(false);
    expect(document.activeElement).not.toBe(document.body);
    expect(w.element.contains(document.activeElement)).toBe(true);
  });

  it("no skeleton for a fast load, one skeleton row for a slow one", async () => {
    vi.useFakeTimers();
    api.mockReturnValueOnce(later(100, page(pick(0))) as never);
    const fast = mountCard();
    await vi.advanceTimersByTimeAsync(50);
    expect(fast.find(sel("body")).classes()).toContain("min-h-35");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fast.find(sel("skeleton")).exists()).toBe(false);
    expect(rows(fast)).toHaveLength(1);
    expect(fast.find(sel("body")).classes()).toContain("min-h-35");
    fast.unmount();
    wrappers = [];

    queryClient.clear();
    api.mockReturnValueOnce(later(900, page([])) as never);
    const slow = mountCard();
    await vi.advanceTimersByTimeAsync(299);
    expect(slow.find(sel("skeleton")).exists()).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    expect(slow.findAll(sel("skeleton"))).toHaveLength(1);
    expect(slow.find(sel("skeleton")).findAll("li")).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(500);
    expect(slow.find(sel("skeleton")).exists()).toBe(true);
    await vi.advanceTimersByTimeAsync(200);
    expect(slow.find(sel("skeleton")).exists()).toBe(false);
    expect(slow.find(sel("empty")).exists()).toBe(true);
    expect(slow.find(sel("body")).classes()).toContain("min-h-35");
  });

  it("no raw keys or ids reach the screen", async () => {
    const RAW =
      /stream_silence|stream_drop|stream_rise|stream_\w+|l0_off|waiting_input|root_cause_identified|inc-|run-|[0-9a-f]{64}|autoobserve\/incidents/;
    api.mockResolvedValueOnce(page(FIXTURE.items, { has_more: true }));
    const top = mountCard();
    await flushPromises();
    expect(rows(top)).toHaveLength(3);
    expect(top.text()).not.toMatch(RAW);

    queryClient.clear();
    const gap = FIXTURE.items[5];
    const unknownKind = { ...gap, finding: { ...gap.finding, kind: "stream_gap" } };
    api.mockResolvedValueOnce(page([...pick(3, 4), unknownKind]));
    const rest = mountCard();
    await flushPromises();
    expect(rows(rest)).toHaveLength(3);
    expect(rest.text()).not.toMatch(RAW);
    expect(rest.text()).toContain("RCA off");
    expect(rest.text()).toContain("Not analyzed");

    queryClient.clear();
    api.mockRejectedValueOnce(httpError(403));
    const denied = mountCard();
    await flushPromises();
    expect(denied.find(sel("denied")).exists()).toBe(true);
    expect(denied.text()).not.toMatch(RAW);
    expect(denied.text()).not.toContain("status 403");
  });

  it("loading and loaded are announced once", async () => {
    vi.useFakeTimers();
    api.mockReturnValueOnce(later(900, page(pick(0))) as never);
    const w = mountCard();
    const announce = () => w.find(sel("announce"));
    await vi.advanceTimersByTimeAsync(10);
    expect(announce().attributes("role")).toBe("status");
    expect(announce().text()).toBe("");
    expect(w.attributes("aria-busy")).toBe("true");
    await vi.advanceTimersByTimeAsync(400);
    expect(announce().text()).toBe("Loading paged findings…");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(announce().text()).toBe("Paged findings loaded");
    expect(w.attributes("aria-busy")).toBe("false");
  });

  it("the main card reads ten and says so", async () => {
    vi.useFakeTimers();
    queryClient.clear();
    api.mockReturnValueOnce(later(900, page(pick(0, 1, 2, 3), { has_more: true })) as never);
    const main = mountCard({ cap: 10 });
    await vi.advanceTimersByTimeAsync(301);
    expect(api).toHaveBeenCalledWith("demo-org", { limit: 10, offset: 0 });
    expect(main.find(sel("skeleton")).findAll("li")).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(rows(main)).toHaveLength(4);
    expect(main.find(sel("more")).text()).toBe("Showing the 10 newest");
  });

  it("the default cap stays three", async () => {
    vi.useFakeTimers();
    queryClient.clear();
    api.mockReturnValueOnce(later(900, page(FIXTURE.items, { has_more: true })) as never);
    const rail = mountCard();
    await vi.advanceTimersByTimeAsync(301);
    expect(api).toHaveBeenCalledWith("demo-org", { limit: 3, offset: 0 });
    expect(rail.find(sel("skeleton")).findAll("li")).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(rows(rail)).toHaveLength(3);
    expect(rail.find(sel("more")).text()).toBe("Showing the 3 newest");
  });

  it("fetches nothing in fixture mode", async () => {
    delete routeQuery.live;
    routeQuery.fixture = "1";
    api.mockResolvedValue(page(pick(0)));
    mountCard();
    await flushPromises();
    expect(api).not.toHaveBeenCalled();
  });

  describe("an analysis reason shared by rows", () => {
    const OFF_ONE = "AI analysis was off when this incident opened.";
    const OFF_MANY = "AI analysis was off when these incidents opened.";
    const details = (w: ReturnType<typeof mountCard>) =>
      w.findAll(sel("analysis-detail")).map((d) => d.text());

    it("zero rows state no reason", async () => {
      api.mockResolvedValueOnce(page([]));
      const w = mountCard();
      await flushPromises();
      expect(w.find(sel("empty")).exists()).toBe(true);
      expect(w.find(sel("shared-analysis")).exists()).toBe(false);
    });

    it("one row keeps its reason on the row", async () => {
      api.mockResolvedValueOnce(page(offRows(1)));
      const w = mountCard();
      await flushPromises();
      expect(details(w)).toEqual([OFF_ONE]);
      expect(w.find(sel("shared-analysis")).exists()).toBe(false);
    });

    it("three rows state it once next to the card's foot, each keeping its chip", async () => {
      api.mockResolvedValueOnce(page(offRows(3)));
      const w = mountCard();
      await flushPromises();
      expect(rows(w)).toHaveLength(3);
      expect(w.findAll(sel("analysis"))).toHaveLength(3);
      expect(details(w)).toEqual([]);
      expect(w.findAll(sel("shared-analysis"))).toHaveLength(1);
      expect(w.find(sel("shared-analysis")).text()).toBe(OFF_MANY);
      expect(w.text()).not.toContain(OFF_ONE);
      expect(w.find(sel("more")).exists()).toBe(false);
      expect(w.find(sel("see-all")).exists()).toBe(false);
    });

    it("twelve rows state it once next to the count", async () => {
      api.mockResolvedValueOnce(page(offRows(12), { has_more: true }));
      const w = mountCard({ cap: 10 });
      await flushPromises();
      expect(rows(w)).toHaveLength(10);
      expect(details(w)).toEqual([]);
      expect(w.findAll(sel("shared-analysis"))).toHaveLength(1);
      expect(w.find(sel("more")).text()).toBe("Showing the 10 newest");
      expect(w.find(sel("shared-analysis")).text()).toBe(OFF_MANY);
      expect(w.find(sel("see-all")).exists()).toBe(true);
    });

    it("mixed reasons state the common one once and keep only the exception on its row (T1-16)", async () => {
      api.mockResolvedValueOnce(page([notRun(0), notRun(1, null), notRun(2)]));
      const w = mountCard();
      await flushPromises();
      expect(details(w)).toHaveLength(1);
      expect(details(w)[0]).not.toBe(OFF_ONE);
      expect(w.findAll(sel("shared-analysis"))).toHaveLength(1);
      expect(w.find(sel("shared-analysis")).text()).toBe(`Not analyzed: ${OFF_MANY}`);
    });

    it("a failed refresh keeps the shared reason visible", async () => {
      api.mockResolvedValueOnce(page(offRows(3)));
      const w = mountCard();
      await flushPromises();
      api.mockRejectedValueOnce(httpError(500));
      await refetch();
      expect(w.find(sel("refresh-failed")).exists()).toBe(true);
      expect(rows(w)).toHaveLength(3);
      expect(w.find(sel("shared-analysis")).text()).toBe(OFF_MANY);
      expect(details(w)).toEqual([]);
    });
  });
  describe("the finding's own next steps", () => {
    const HOUR_US = 3_600_000_000;
    const originalBuild = config.isEnterprise;
    afterEach(() => {
      config.isEnterprise = originalBuild;
    });

    it("Open in Logs opens the stopped stream from one hour before the stop to now", async () => {
      vi.useFakeTimers({ toFake: ["Date"], now: 1_800_000_000_000 });
      config.isEnterprise = "true";
      const appOrg = appStore.state.selectedOrganization;
      appStore.commit("setSelectedOrganization", { ...appOrg, identifier: "demo-org" });
      onTestFinished(() => appStore.commit("setSelectedOrganization", appOrg));
      api.mockResolvedValueOnce(page(pick(0)));
      const w = mountCard();
      await flushPromises();
      const button = w.find(sel("row-0")).find(sel("logs"));
      expect(button.text()).toBe("Open in Logs");
      await button.trigger("click");
      const route = push.mock.calls[0][0];
      expect(route.path).toBe("/logs");
      expect(route.query).toMatchObject({
        stream: "checkout",
        stream_type: "logs",
        org_identifier: "demo-org",
        from: String(FIXTURE.items[0].finding.first_seen_at - HOUR_US),
        to: String(1_800_000_000_000 * 1000),
      });
      expect(b64DecodeUnicode(route.query.query)).toBe("");
    });

    it("no Open in Logs for a metrics stream, an unreadable finding or the open-source build", async () => {
      config.isEnterprise = "true";
      api.mockResolvedValueOnce(page(pick(3, 5)));
      const w = mountCard();
      await flushPromises();
      expect(w.findAll(sel("logs"))).toHaveLength(0);
      expect(w.findAll(sel("open"))).toHaveLength(2);
      config.isEnterprise = "false";
      queryClient.clear();
      api.mockResolvedValueOnce(page(pick(0)));
      const oss = mountCard();
      await flushPromises();
      expect(oss.findAll(sel("logs"))).toHaveLength(0);
    });

    it("Ask AI hands the chat a draft-only request about the stop, never sending it", async () => {
      store.commit("setConfig", { ...originalConfig, ai_enabled: true });
      const ask = vi.fn();
      api.mockResolvedValueOnce(page(pick(0, 1, 2)));
      const w = mountCard({}, ask);
      await flushPromises();
      const buttons = w.findAll(sel("ask-ai"));
      expect(buttons).toHaveLength(3);
      expect(buttons[0].text()).toBe("Ask AI");
      await buttons[0].trigger("click");
      const payload = ask.mock.calls[0][0] as InsightAskPayload;
      expect(payload.autoSend).toBe(false);
      expect(payload.newChat).toBe(true);
      expect(payload.prompt).toMatch(
        /^checkout \(logs\) stopped sending at .+\. What could stop it, and what should I check first\?$/,
      );
      expect(payload.chipName).toBe("AutoObserve finding · checkout (logs)");
      expect(payload.query).toContain("Stream: checkout");
      expect(payload.context).toEqual({ currentPage: "autoobserve", org_id: "demo-org" });
      await buttons[1].trigger("click");
      expect(ask.mock.calls[1][0].prompt).toMatch(/^payments \(logs\) dropped sharply at /);
      await buttons[2].trigger("click");
      expect(ask.mock.calls[2][0].prompt).toMatch(/^orders \(logs\) rose sharply at /);
    });

    it("Ask AI is absent when AI is off, with no chat to hand to, or for an unreadable finding", async () => {
      store.commit("setConfig", { ...originalConfig, ai_enabled: false });
      api.mockResolvedValueOnce(page(pick(0)));
      const off = mountCard({}, vi.fn());
      await flushPromises();
      expect(off.findAll(sel("ask-ai"))).toHaveLength(0);
      store.commit("setConfig", { ...originalConfig, ai_enabled: true });
      queryClient.clear();
      api.mockResolvedValueOnce(page(pick(0)));
      const alone = mountCard();
      await flushPromises();
      expect(alone.findAll(sel("ask-ai"))).toHaveLength(0);
      queryClient.clear();
      api.mockResolvedValueOnce(page(pick(5)));
      const unreadable = mountCard({}, vi.fn());
      await flushPromises();
      expect(unreadable.findAll(sel("ask-ai"))).toHaveLength(0);
    });
  });

  describe("who was paged (W2)", () => {
    const withPage = (
      i: number,
      outcome: string,
      team_name: string | null,
      extra: Partial<AutoObserveIncidentItem> = {},
    ) =>
      ({
        ...FIXTURE.items[i],
        page: { outcome, team_id: team_name ? "t-1" : null, team_name },
        ...extra,
      }) as AutoObserveIncidentItem;

    it("the subtitle no longer claims your on-call team was paged", async () => {
      api.mockResolvedValueOnce(page([]));
      const w = mountCard();
      await flushPromises();
      expect(w.find(sel("subtitle")).text()).toBe(
        "Findings that opened an incident, who was paged, and its analysis.",
      );
      expect(w.text()).not.toContain("for your on-call team");
    });

    it("an unrouted card stops offering routing setup once the org has a default team", async () => {
      vi.mocked(oncall.getRoutingConfig).mockResolvedValueOnce({
        data: { default_team_id: "t-default" },
      } as never);
      api.mockResolvedValueOnce(page([withPage(1, "unrouted", null)]));
      const w = mountCard({ cap: 10 });
      await flushPromises();
      await flushPromises();
      expect(rows(w)[0].find(sel("page")).text()).toContain("Nobody was paged");
      expect(rows(w)[0].find(sel("routing")).exists()).toBe(false);
      expect(rows(w)[0].text()).not.toContain("Set up on-call routing");
    });

    it("each outcome draws its own line, pending included", async () => {
      api.mockResolvedValueOnce(
        page([
          withPage(0, "paged", "SRE"),
          withPage(1, "unrouted", null),
          withPage(2, "failed", "SRE"),
          withPage(3, "pending", null),
        ]),
      );
      const w = mountCard({ cap: 10 });
      await flushPromises();
      const lines = rows(w).map((r) => r.find(sel("page")));
      expect(lines[0].text()).toBe("Paged SRE");
      expect(lines[0].attributes("data-tone")).toBe("neutral");
      expect(lines[1].text()).toContain("Nobody was paged");
      expect(lines[1].attributes("data-tone")).toBe("warning");
      expect(lines[2].text()).toContain("Paging failed");
      expect(lines[2].attributes("data-tone")).toBe("error");
      expect(lines[3].text()).toContain("hasn't confirmed the page yet");
      expect(lines[3].attributes("data-tone")).toBe("pending");
      expect(lines[3].findComponent({ name: "OIcon" }).props("name")).toBe("schedule");
      expect(lines[0].findComponent({ name: "OIcon" }).props("name")).toBe("check");
      expect(lines[1].classes()).toContain("text-badge-amber-soft-text");
      expect(rows(w)[0].findAll(sel("routing"))).toHaveLength(0);
      await rows(w)[1].find(sel("routing")).trigger("click");
      expect(push).toHaveBeenCalledWith({
        name: "onCallRouting",
        query: { org_identifier: "demo-org" },
      });
    });

    it("every readable row has a why and a next line", async () => {
      api.mockResolvedValueOnce(page(pick(0)));
      const w = mountCard();
      await flushPromises();
      expect(rows(w)[0].find(sel("why")).text()).toMatch(
        /^No data has arrived on checkout \(logs\) since /,
      );
      expect(rows(w)[0].find(sel("next")).text()).toContain("Check the sender or collector");
    });

    it("a grouped incident heads with the count and names three", async () => {
      const members = Array.from({ length: 12 }, (_, n) => ({
        id: `m-${n}`,
        title: "",
        stream_type: "logs",
        stream_name: `ingest_${n}`,
        first_seen_at: FIXTURE.items[0].finding.first_seen_at,
        recovered_at: null,
      }));
      api.mockResolvedValueOnce(page([withPage(0, "unrouted", null, { members })]));
      const w = mountCard();
      await flushPromises();
      expect(sentences(w)[0]).toBe("12 streams stopped sending data");
      expect(rows(w)[0].find(sel("why")).text()).toContain(
        "ingest_0, ingest_1, ingest_2, and 9 more",
      );
    });
  });

  describe("learning (W3)", () => {
    const coverageApi = vi.mocked(autoobserve.coverage);
    const NOV_24_US = Date.UTC(2026, 10, 24, 12, 0) * 1000;
    const coverage = (streams_learning: number, streams_ready: number) =>
      ({
        data: {
          view: "strict",
          pass_at: null,
          refreshed_at: null,
          quality: null,
          classes: [],
          rows: [],
          learning: {
            streams_learning,
            streams_ready,
            history_days_needed: 14,
            next_ready_at: NOV_24_US,
          },
        },
      }) as never;

    afterEach(() => coverageApi.mockReset());

    it("the subtitle slot carries the learning line while streams learn", async () => {
      coverageApi.mockResolvedValue(coverage(9, 10));
      api.mockResolvedValueOnce(page([]));
      const w = mountCard();
      await flushPromises();
      expect(w.find(sel("learning")).text()).toBe(
        "Learning 9 streams. The first is ready on Nov 24; AutoObserve needs 14 days of history to judge a stream.",
      );
      expect(w.find(sel("subtitle")).exists()).toBe(false);
      expect(w.find(sel("empty")).text()).toContain("Nothing has paged anyone");
    });

    it("an org with no ready stream says what it waits for instead of looking empty", async () => {
      coverageApi.mockResolvedValue(coverage(12, 0));
      api.mockResolvedValueOnce(page([]));
      const w = mountCard();
      await flushPromises();
      expect(w.find(sel("subtitle")).exists()).toBe(true);
      const empty = w.find(sel("empty-learning"));
      expect(empty.text()).toContain("Learning your streams");
      expect(empty.text()).toContain("The first of 12 streams is ready on Nov 24.");
    });

    it("says paging is off while every stream is still learning (T1-11)", async () => {
      coverageApi.mockResolvedValue(coverage(12, 0));
      api.mockResolvedValueOnce(page([], { paging: false }));
      const w = mountCard();
      await flushPromises();
      expect(w.find(sel("subtitle-slot")).text()).toBe(
        "Paging is off for this organization, so AutoObserve opens no incidents.",
      );
      expect(w.find(sel("empty-learning")).text()).toContain("Learning your streams");
      expect(w.find(sel("empty-off")).exists()).toBe(false);
    });

    it("a server without the learning block keeps today's card", async () => {
      coverageApi.mockResolvedValue({ data: { rows: [] } } as never);
      api.mockResolvedValueOnce(page([]));
      const w = mountCard();
      await flushPromises();
      expect(w.find(sel("learning")).exists()).toBe(false);
      expect(w.find(sel("subtitle")).exists()).toBe(true);
      expect(w.find(sel("empty")).exists()).toBe(true);
    });
  });
});
