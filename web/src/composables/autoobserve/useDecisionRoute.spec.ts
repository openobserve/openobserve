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
// The real toast store, so its de-duplication runs as it does in the app.
vi.mock("@/lib/feedback/Toast/useToast", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/feedback/Toast/useToast")>();
  return { ...actual, toast: vi.fn(actual.toast) };
});

import store from "@/test/unit/helpers/store";
import { withQueryClient } from "@/test/unit/helpers/queryClient";
import { queryClient } from "@/composables/query/queryClient";
import fixture from "@/components/autoobserve/live/__fixtures__/autoobserveDecisions.json";
import autoobserveDecisions, {
  type DecisionRequest,
  type DecisionResult,
  type DecisionView,
} from "@/services/autoobserveDecisions";
import { dismissAll, toastRecords } from "@/lib/feedback/Toast/useToast";
import { useDecisionRoute } from "./useDecisionRoute";

const ORG_A = store.state.selectedOrganization;
const ORG_B = { ...ORG_A, id: 160, identifier: "other", label: "other Organization" };

const view = (id: string, revision = 1): DecisionView => ({
  ...(fixture.decided.decision as DecisionView),
  decision_id: `alert_finding:${id}`,
  family: "alert_finding",
  id,
  reason: "intended_report",
  until: null,
  revision,
});
const decided = (id: string): { data: DecisionResult } => ({
  data: { change: "created", decision: view(id) },
});
const body = (id: string): DecisionRequest => ({
  family: "alert_finding",
  id,
  action: "dismiss",
  reason: "intended_report",
  until_reopened: true,
});
const httpError = (status: number) =>
  Object.assign(new Error(`HTTP ${status}`), {
    response: { status, data: { code: status, message: "server words" } },
  });

let wrapper: VueWrapper | null = null;
let route: ReturnType<typeof useDecisionRoute>;

const settle = async () => {
  for (let i = 0; i < 6; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await flushPromises();
  }
};
const mountRoute = async () => {
  wrapper = mount(
    defineComponent({
      setup() {
        route = useDecisionRoute();
        return () => h("div");
      },
    }),
    { global: { plugins: [store, withQueryClient(queryClient)] } },
  );
  await settle();
};
const openToasts = () => toastRecords.filter((r) => r.open);
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};
const invalidatedOrgs = (spy: ReturnType<typeof vi.spyOn>) =>
  spy.mock.calls.map((call) => (call[0] as { queryKey: unknown[] }).queryKey[1]);

describe("useDecisionRoute", () => {
  beforeEach(() => {
    queryClient.clear();
    dismissAll();
    store.commit("setSelectedOrganization", ORG_A);
    for (const fn of Object.values(autoobserveDecisions)) vi.mocked(fn).mockReset();
    vi.mocked(autoobserveDecisions.list).mockResolvedValue({ data: fixture.list } as never);
    vi.mocked(autoobserveDecisions.undo).mockResolvedValue({ data: fixture.undone } as never);
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    store.commit("setSelectedOrganization", ORG_A);
    vi.restoreAllMocks();
  });

  it("a_write_that_lands_after_an_org_switch_shows_no_toast_and_refreshes_its_own_org", async () => {
    await mountRoute();
    const answer = deferred<{ data: DecisionResult }>();
    vi.mocked(autoobserveDecisions.decide).mockReturnValue(answer.promise as never);
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const write = route.decide(body("f1"), "nightly-summary");
    store.commit("setSelectedOrganization", ORG_B);
    dismissAll();
    answer.resolve(decided("f1"));
    await write;
    await settle();
    expect(vi.mocked(autoobserveDecisions.decide).mock.calls[0][0]).toBe("default");
    expect(openToasts()).toHaveLength(0);
    expect(invalidatedOrgs(invalidate)).toContain("default");
    expect(invalidatedOrgs(invalidate)).not.toContain("other");
  });

  it("undo_posts_to_the_org_the_write_was_made_in", async () => {
    await mountRoute();
    vi.mocked(autoobserveDecisions.decide).mockResolvedValue(decided("f1") as never);
    await route.decide(body("f1"), "nightly-summary");
    const handler = openToasts()[0].action?.handler;
    store.commit("setSelectedOrganization", ORG_B);
    handler?.();
    await settle();
    expect(vi.mocked(autoobserveDecisions.undo).mock.calls[0][0]).toBe("default");
  });

  it("two_writes_with_the_same_words_keep_undo_for_both", async () => {
    await mountRoute();
    const batchOf = (id: string) => ({
      data: {
        results: [{ index: 0, family: "alert_finding", id, status: 200, result: decided(id).data }],
        written: 1,
        unchanged: 0,
        failed: 0,
      },
    });
    vi.mocked(autoobserveDecisions.decideBatch)
      .mockResolvedValueOnce(batchOf("f1") as never)
      .mockResolvedValueOnce(batchOf("f2") as never);
    await route.decideBatch([body("f1")], () => "nightly-summary");
    await route.decideBatch([body("f2")], () => "daily-cost");
    expect(openToasts()).toHaveLength(1);
    expect(openToasts()[0].count).toBe(2);
    openToasts()[0].action?.handler();
    await settle();
    expect(
      vi
        .mocked(autoobserveDecisions.undo)
        .mock.calls.map((c) => c[1])
        .sort(),
    ).toEqual(["alert_finding:f1", "alert_finding:f2"]);
  });

  it("a_partial_undo_says_how_many_were_undone_and_retries_only_the_rest", async () => {
    await mountRoute();
    vi.mocked(autoobserveDecisions.undo).mockImplementation(((_org: string, id: string) =>
      id === "alert_finding:f2"
        ? Promise.reject(httpError(500))
        : Promise.resolve({ data: fixture.undone })) as never);
    await route.undo([
      { org: "default", view: view("f1"), title: "nightly-summary" },
      { org: "default", view: view("f2"), title: "daily-cost" },
    ]);
    await settle();
    const last = toastRecords.at(-1)!;
    expect(String(last.message)).toBe("1 of 2 undone. Not undone: daily-cost.");
    expect(last.variant).toBe("error");
    expect(last.action?.label).toBe("Retry");
    vi.mocked(autoobserveDecisions.undo).mockClear();
    vi.mocked(autoobserveDecisions.undo).mockResolvedValue({ data: fixture.undone } as never);
    last.action?.handler();
    await settle();
    expect(vi.mocked(autoobserveDecisions.undo).mock.calls.map((c) => c[1])).toEqual([
      "alert_finding:f2",
    ]);
  });

  it("a_partial_undo_with_a_conflict_says_why_in_amber", async () => {
    await mountRoute();
    vi.mocked(autoobserveDecisions.undo).mockImplementation(((_org: string, id: string) =>
      id === "alert_finding:f2"
        ? Promise.reject(httpError(409))
        : Promise.resolve({ data: fixture.undone })) as never);
    await route.undo([
      { org: "default", view: view("f1"), title: "nightly-summary" },
      { org: "default", view: view("f2"), title: "daily-cost" },
      { org: "default", view: view("f3"), title: "backup-report" },
    ]);
    await settle();
    const last = toastRecords.at(-1)!;
    expect(String(last.message)).toBe(
      "2 of 3 undone. Not undone: daily-cost. It changed since it was saved; refresh to see it.",
    );
    expect(last.variant).toBe("warning");
    expect(last.action).toBeUndefined();
  });

  it("two_failed_undos_with_the_same_words_retry_both", async () => {
    await mountRoute();
    vi.mocked(autoobserveDecisions.undo).mockRejectedValue(httpError(500));
    await route.undo([{ org: "default", view: view("f1"), title: "nightly-summary" }]);
    await route.undo([{ org: "default", view: view("f2"), title: "daily-cost" }]);
    await settle();
    expect(openToasts()).toHaveLength(1);
    expect(openToasts()[0].count).toBe(2);
    vi.mocked(autoobserveDecisions.undo).mockClear();
    vi.mocked(autoobserveDecisions.undo).mockResolvedValue({ data: fixture.undone } as never);
    openToasts()[0].action?.handler();
    await settle();
    expect(
      vi
        .mocked(autoobserveDecisions.undo)
        .mock.calls.map((c) => c[1])
        .sort(),
    ).toEqual(["alert_finding:f1", "alert_finding:f2"]);
  });
});
