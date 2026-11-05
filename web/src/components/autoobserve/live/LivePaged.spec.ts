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
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import { queryClient } from "@/composables/query/queryClient";
import autoobserve, {
  type AutoObserveIncidentItem,
  type AutoObserveIncidentList,
} from "@/services/autoobserve";
import fixture from "./__fixtures__/autoobserveIncidents.json";
import { analysisLink, incidentLink } from "./incidentsCopy";
import LivePaged from "./LivePaged.vue";

const routeQuery: Record<string, string> = { live: "1" };
const push = vi.fn();
vi.mock("vue-router", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useRoute: () => ({ query: routeQuery }),
  useRouter: () => ({ push }),
}));

vi.mock("@/services/autoobserve", () => ({
  default: { coverage: vi.fn(), suggestions: vi.fn(), incidents: vi.fn() },
}));

const api = vi.mocked(autoobserve.incidents);

const FIXTURE = fixture as unknown as AutoObserveIncidentList;
const pick = (...indexes: number[]): AutoObserveIncidentItem[] =>
  indexes.map((i) => FIXTURE.items[i]);

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
const mountCard = (props: { cap?: number } = {}) => {
  const wrapper = mount(LivePaged, {
    props,
    attachTo: document.body,
    global: { plugins: [i18n, store] },
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
    await many.find(sel("see-all")).trigger("click");
    expect(push).toHaveBeenCalledWith({
      name: "incidentList",
      query: { org_identifier: "demo-org" },
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

  it("fetches nothing outside live mode", async () => {
    delete routeQuery.live;
    api.mockResolvedValue(page(pick(0)));
    mountCard();
    await flushPromises();
    expect(api).not.toHaveBeenCalled();
  });
});
