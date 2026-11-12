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
import { byTest } from "@/test/unit/helpers/draftDom";
import { queryClient } from "@/composables/query/queryClient";
import fixture from "@/components/autoobserve/live/__fixtures__/autoobserveDecisions.json";
import autoobserveDecisions, {
  type DecisionListParams,
  type DecisionView,
} from "@/services/autoobserveDecisions";
import { dismissAll, toast } from "@/lib/feedback/Toast/useToast";
import DecisionsDismissedList from "./DecisionsDismissedList.vue";

const row = fixture.list.decisions[0] as DecisionView;
const rowsOf = (n: number): DecisionView[] =>
  Array.from({ length: n }, (_, i) => ({
    ...row,
    decision_id: `suggestion:s-${i}`,
    id: `s-${i}`,
    subject: { title: `svc-${i}`, folder: null, team: null },
  }));

let wrapper: VueWrapper | null = null;
const settle = async () => {
  for (let i = 0; i < 6; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await flushPromises();
  }
};
const all = (test: string) => [...document.body.querySelectorAll(`[data-test="${test}"]`)];

/** Serves a list of `total` rows by limit and offset, as the server pages them. */
const serve = (total: number) => {
  const rows = rowsOf(total);
  vi.mocked(autoobserveDecisions.list).mockImplementation(((
    _org: string,
    params: DecisionListParams,
  ) =>
    Promise.resolve({
      data: {
        decisions: rows.slice(params.offset, params.offset + params.limit),
        total,
        limit: params.limit,
        offset: params.offset,
      },
    })) as never);
};

const ORG_A = store.state.selectedOrganization;
const ORG_B = { ...ORG_A, id: 160, identifier: "other", label: "other Organization" };
const markRow: DecisionView = {
  ...row,
  decision_id: "alert_finding:f-nightly",
  family: "alert_finding",
  id: "f-nightly",
  reason: "intended_report",
  until: null,
  subject: { title: "nightly-summary", folder: "data", team: null },
};

const applyRow: DecisionView = {
  ...row,
  decision_id: "alert_finding:f-nodest-b:apply",
  family: "alert_finding",
  id: "f-nodest-b",
  action: "apply",
  state: "applied",
  reason: null,
  until: row.decided_at + 30 * 86_400_000_000,
  subject: { title: "T3-nodest-ops-b", folder: "ops", team: null },
  change: {
    alert: { id: "a-ops-b", title: "T3-nodest-ops-b" },
    fields: [{ field: "destinations", from: [], to: ["ops-webhook"] }],
  },
  via: "apply",
};

const mountList = async () => {
  wrapper = mount(DecisionsDismissedList, {
    attachTo: document.body,
    global: { plugins: [store, withQueryClient(queryClient)] },
  });
  await settle();
};

describe("DecisionsDismissedList", () => {
  beforeEach(() => {
    queryClient.clear();
    vi.mocked(toast).mockClear();
    dismissAll();
    for (const fn of Object.values(autoobserveDecisions)) vi.mocked(fn).mockReset();
    vi.mocked(autoobserveDecisions.undo).mockResolvedValue({ data: fixture.undone } as never);
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    store.commit("setSelectedOrganization", ORG_A);
  });

  it("lists_both_kinds_by_default_with_a_kind_column", async () => {
    vi.mocked(autoobserveDecisions.list).mockResolvedValue({
      data: { decisions: [row, markRow], total: 2, limit: 20, offset: 0 },
    } as never);
    await mountList();
    expect(vi.mocked(autoobserveDecisions.list).mock.calls.map((c) => c[1])).toContainEqual({
      state: "active",
      limit: 500,
      offset: 0,
    });
    expect(all("decision-dismissed-kind").map((k) => k.textContent?.trim())).toEqual([
      "Suggestion",
      "Alert finding",
    ]);
    expect(all("decision-dismissed-summary")[0].textContent).toContain("Planned work");
    expect(all("decision-dismissed-summary")[1].textContent).toContain("Marked as intended report");
    expect(byTest("decision-dismissed")?.textContent).not.toContain("alert_finding");
  });

  it("a_mark_made_here_lists_and_undoes_from_the_list", async () => {
    vi.mocked(autoobserveDecisions.list).mockResolvedValue({
      data: { decisions: [markRow], total: 1, limit: 20, offset: 0 },
    } as never);
    await mountList();
    (byTest("decision-dismissed-undo") as HTMLButtonElement).click();
    await settle();
    expect(autoobserveDecisions.undo).toHaveBeenCalledWith("default", "alert_finding:f-nightly", {
      expected_revision: markRow.revision,
      request_id: expect.any(String),
    });
  });

  it("the_kind_filter_asks_the_server_for_that_kind_from_the_first_page", async () => {
    serve(45);
    await mountList();
    (byTest("decision-dismissed-next") as HTMLButtonElement).click();
    await settle();
    (byTest("decision-dismissed-filter-alert_finding") as HTMLButtonElement).click();
    await settle();
    expect(vi.mocked(autoobserveDecisions.list).mock.calls.at(-1)?.[1]).toEqual({
      state: "active",
      family: "alert_finding",
      limit: 500,
      offset: 0,
    });
    expect(byTest("decision-dismissed-range")?.textContent?.trim()).toBe("1–20 of 45");
  });

  it("each_kind_says_its_own_empty_line", async () => {
    serve(0);
    await mountList();
    expect(byTest("decision-dismissed-empty")?.textContent?.trim()).toBe(
      "Nothing is dismissed or marked.",
    );
    (byTest("decision-dismissed-filter-suggestion") as HTMLButtonElement).click();
    await settle();
    expect(byTest("decision-dismissed-empty")?.textContent?.trim()).toBe(
      "No suggestion is dismissed.",
    );
    (byTest("decision-dismissed-filter-alert_finding") as HTMLButtonElement).click();
    await settle();
    expect(byTest("decision-dismissed-empty")?.textContent?.trim()).toBe(
      "No alert finding is dismissed or marked.",
    );
  });

  it("rows_from_the_previous_org_never_show_while_the_next_org_loads", async () => {
    vi.mocked(autoobserveDecisions.list).mockImplementation(((org: string) =>
      org === "default"
        ? Promise.resolve({ data: fixture.list })
        : new Promise(() => undefined)) as never);
    await mountList();
    expect(all("decision-dismissed-row")).toHaveLength(1);
    store.commit("setSelectedOrganization", ORG_B);
    await settle();
    expect(all("decision-dismissed-row")).toHaveLength(0);
    expect(all("decision-dismissed-undo")).toHaveLength(0);
  });

  it("zero_rows_say_so_in_one_line", async () => {
    serve(0);
    await mountList();
    expect(byTest("decision-dismissed-empty")?.textContent).toContain(
      "Nothing is dismissed or marked.",
    );
    expect(byTest("decision-dismissed-pager")).toBeNull();
  });

  it("one_row_says_who_why_and_until_when_without_ids", async () => {
    vi.mocked(autoobserveDecisions.list).mockResolvedValue({ data: fixture.list } as never);
    await mountList();
    const paged = vi.mocked(autoobserveDecisions.list).mock.calls.map((call) => call[1]);
    expect(paged).toContainEqual({ state: "active", limit: 500, offset: 0 });
    const rows = all("decision-dismissed-row");
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain("cluster-d k8s_events");
    expect(byTest("decision-dismissed-summary")?.textContent?.trim()).toBe(
      "Planned work · by alice@demo-org.test, Nov 6, 16:00 · shown again Nov 6, 18:00 if still true",
    );
    expect(rows[0].textContent).not.toContain("s-cluster-d");
    expect(rows[0].textContent).not.toContain("planned_work");
    expect(byTest("decision-dismissed-total")?.textContent?.trim()).toBe("1");
  });

  it("undo_sends_the_rows_revision", async () => {
    vi.mocked(autoobserveDecisions.list).mockResolvedValue({ data: fixture.list } as never);
    await mountList();
    (byTest("decision-dismissed-undo") as HTMLButtonElement).click();
    await settle();
    expect(autoobserveDecisions.undo).toHaveBeenCalledWith("default", row.decision_id, {
      expected_revision: row.revision,
      request_id: expect.any(String),
    });
    expect(String(vi.mocked(toast).mock.calls[0][0].message)).toBe(
      "Undone: cluster-d k8s_events is shown again.",
    );
  });

  it("many_rows_page_by_limit_and_offset", async () => {
    serve(45);
    await mountList();
    expect(all("decision-dismissed-row")).toHaveLength(20);
    expect(byTest("decision-dismissed-range")?.textContent?.trim()).toBe("1–20 of 45");
    expect((byTest("decision-dismissed-previous") as HTMLButtonElement).disabled).toBe(true);
    (byTest("decision-dismissed-next") as HTMLButtonElement).click();
    await settle();
    (byTest("decision-dismissed-next") as HTMLButtonElement).click();
    await settle();
    expect(all("decision-dismissed-row")).toHaveLength(5);
    expect(byTest("decision-dismissed-range")?.textContent?.trim()).toBe("41–45 of 45");
    expect((byTest("decision-dismissed-next") as HTMLButtonElement).disabled).toBe(true);
  });

  it("more_than_one_server_read_of_rows_lists_them_all", async () => {
    serve(620);
    await mountList();
    const reads = vi.mocked(autoobserveDecisions.list).mock.calls.filter((c) => c[1].limit === 500);
    expect(reads.map((c) => c[1].offset)).toEqual([0, 500]);
    expect(byTest("decision-dismissed-range")?.textContent?.trim()).toBe("1–20 of 620");
  });

  it("an_applied_change_is_never_listed_counted_or_undone_here", async () => {
    vi.mocked(autoobserveDecisions.list).mockResolvedValue({
      data: { decisions: [applyRow, markRow], total: 2, limit: 500, offset: 0 },
    } as never);
    await mountList();
    const rows = all("decision-dismissed-row");
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain("nightly-summary");
    expect(byTest("decision-dismissed")?.textContent).not.toContain("T3-nodest-ops-b");
    expect(byTest("decision-dismissed")?.textContent).not.toContain("Another reason");
    expect(byTest("decision-dismissed-total")?.textContent?.trim()).toBe("1");
    for (const undo of all("decision-dismissed-undo")) (undo as HTMLButtonElement).click();
    await settle();
    expect(vi.mocked(autoobserveDecisions.undo).mock.calls.map((c) => c[1])).toEqual([
      "alert_finding:f-nightly",
    ]);
  });

  it("applies_between_dismissals_never_leave_a_page_short_or_the_total_wrong", async () => {
    const dismissals = rowsOf(25);
    const mixed = dismissals.flatMap((d, i) =>
      i % 2 ? [d] : [d, { ...applyRow, decision_id: `alert_finding:f-${i}:apply`, id: `f-${i}` }],
    );
    vi.mocked(autoobserveDecisions.list).mockImplementation(((
      _org: string,
      params: DecisionListParams,
    ) =>
      Promise.resolve({
        data: {
          decisions: mixed.slice(params.offset, params.offset + params.limit),
          total: mixed.length,
          limit: params.limit,
          offset: params.offset,
        },
      })) as never);
    await mountList();
    expect(all("decision-dismissed-row")).toHaveLength(20);
    expect(byTest("decision-dismissed-range")?.textContent?.trim()).toBe("1–20 of 25");
    (byTest("decision-dismissed-next") as HTMLButtonElement).click();
    await settle();
    expect(all("decision-dismissed-row")).toHaveLength(5);
    expect(byTest("decision-dismissed-total")?.textContent?.trim()).toBe("25");
  });

  it("a_note_shows_under_its_row_as_plain_text", async () => {
    vi.mocked(autoobserveDecisions.list).mockResolvedValue({
      data: {
        decisions: [{ ...markRow, note: "<b>retired</b> & @here", has_note: true }],
        total: 1,
        limit: 500,
        offset: 0,
      },
    } as never);
    await mountList();
    expect(byTest("decision-dismissed-note")?.textContent?.trim()).toBe("<b>retired</b> & @here");
    expect(byTest("decision-dismissed-note")?.querySelector("b")).toBeNull();
  });
});
