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

import { afterEach, describe, expect, it } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createStore } from "vuex";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import TopPathsTable from "./TopPathsTable.vue";
import RetentionGrid from "./RetentionGrid.vue";
import AnalyticsSessionsTable, { type SessionRow } from "./AnalyticsSessionsTable.vue";

let wrapper: VueWrapper | null = null;

const button = (w: VueWrapper, dt: string) => {
  const found = w.findAllComponents(OButton).find((b) => b.attributes("data-test") === dt);
  if (!found) throw new Error(`no OButton ${dt}`);
  return found;
};

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  document.body.innerHTML = "";
});

describe("Top paths sessions count opens the branch side panel", () => {
  const mountTop = async () => {
    wrapper = mount(TopPathsTable, {
      props: {
        rows: [
          { s1: "p:/web/logs", s2: null, sessions: 1204 },
          { s1: "p:/web/metrics", s2: "c:save", sessions: 1 },
        ],
        anchorSessions: 2000,
        depth: 2,
        anchorKey: "p:/",
        direction: "next",
      },
      attachTo: document.body,
    });
    for (let i = 0; i < 8; i++) {
      await new Promise((r) => setTimeout(r, 10));
      await flushPromises();
    }
    return wrapper;
  };

  it("the count cell is a ghost-primary count with a chevron that says what it opens", async () => {
    const w = await mountTop();
    const btn = button(w, "rum-analytics-paths-top-row-0-sessions-btn");
    expect(btn.props("variant")).toBe("ghost-primary");
    expect(btn.props("size")).toBe("xs");
    expect(btn.props("iconRight")).toBe("chevron-right");
    expect(btn.findAllComponents(OIcon).map((i) => i.props("name"))).toContain("chevron-right");
    expect(btn.attributes("aria-haspopup")).toBe("dialog");
    expect(btn.attributes("aria-label")).toBe(
      "Open the 1,204 sessions on this path in a side panel",
    );
    expect(btn.text()).toContain("1,204 sessions");
    expect(btn.findComponent(OTooltip).props("content")).toBe(
      "Open these sessions in a side panel",
    );
    expect(button(w, "rum-analytics-paths-top-row-1-sessions-btn").text()).toContain("1 session");
  });

  it("drops the blank actions column now that the count opens the panel", async () => {
    const w = await mountTop();
    const ids = (w.findComponent(OTable).props("columns") as { id: string }[]).map((c) => c.id);
    expect(ids).toEqual(["path", "sessions", "share"]);
  });

  it("clicking the count emits the row's exact tuple", async () => {
    const w = await mountTop();
    await w.find('[data-test="rum-analytics-paths-top-row-0-sessions-btn"]').trigger("click");
    expect(w.emitted("select")?.[0]).toEqual([{ type: "tuple", tuple: ["p:/web/logs", null] }]);
  });
});

describe("Retention cells announce the side panel they open", () => {
  it("each cell has aria-haspopup and an aria-label that starts with its visible percentage (F11)", async () => {
    wrapper = mount(RetentionGrid, {
      props: {
        grid: {
          rows: [
            {
              cohort: 0,
              label: "Jan 1",
              size: 50,
              cells: [
                { k: 0, users: 50, pct: 1, incomplete: false },
                { k: 1, users: 20, pct: 0.4, incomplete: false },
              ],
            },
          ],
          average: [1, 0.4],
        },
        granularity: "day",
        mode: "on",
      },
      attachTo: document.body,
    });
    for (let i = 0; i < 8; i++) {
      await new Promise((r) => setTimeout(r, 10));
      await flushPromises();
    }
    const cell = button(wrapper, "rum-analytics-retention-cell-0-1");
    expect(cell.attributes("aria-haspopup")).toBe("dialog");
    expect(cell.text()).toBe("40.0%");
    expect(cell.attributes("aria-label")).toBe("40.0%, Jan 1, Day 1: 20 of 50 users");
    expect(cell.findComponent(OTooltip).props("content")).toBe("Jan 1, Day 1: 20 of 50 users");
  });
});

describe("Session rows that open the replay", () => {
  const ROW: SessionRow = {
    sid: "s1",
    step_t: 1,
    errors: 0,
    frustrations: 0,
    has_replay: 1,
    started: 1,
    ended: 2,
    total: 1,
  };

  it("carry a trailing chevron cue and rely on OTable's own pointer cursor", async () => {
    wrapper = mount(AnalyticsSessionsTable, {
      props: {
        rows: [ROW],
        total: 1,
        stepLabel: "x",
        stepIndex: null,
        loadingMore: false,
        dataTestPrefix: "pa-sessions",
      },
      global: { plugins: [createStore({ state: { timezone: "UTC" } })] },
      attachTo: document.body,
    });
    for (let i = 0; i < 8; i++) {
      await new Promise((r) => setTimeout(r, 10));
      await flushPromises();
    }
    const table = wrapper.findComponent(OTable);
    expect(table.props("rowClass")).toBeUndefined();
    const cue = wrapper
      .findAllComponents(OIcon)
      .find((i) => i.attributes("data-test") === "pa-sessions-row-0-open");
    expect(cue?.props("name")).toBe("chevron-right");
    await wrapper.find('[data-test="pa-sessions-row-0"]').trigger("click");
    expect(wrapper.emitted("open")?.[0]).toEqual([ROW]);
  });

  it("stacks a two-digit error tag and a frustration tag instead of clipping them (F12)", async () => {
    wrapper = mount(AnalyticsSessionsTable, {
      props: {
        rows: [{ ...ROW, errors: 12, frustrations: 3 }],
        total: 1,
        stepLabel: "x",
        stepIndex: null,
        loadingMore: false,
        dataTestPrefix: "pa-sessions",
      },
      global: { plugins: [createStore({ state: { timezone: "UTC" } })] },
      attachTo: document.body,
    });
    for (let i = 0; i < 8; i++) {
      await new Promise((r) => setTimeout(r, 10));
      await flushPromises();
    }
    const health = wrapper.find('[data-test="o2-table-cell-health"] span');
    expect(health.text()).toContain("12 errors");
    expect(health.text()).toContain("3");
    expect(health.classes()).toContain("flex-wrap");
    expect(health.classes()).not.toContain("truncate");
    const cols = wrapper.findComponent(OTable).props("columns") as { id: string; size: number }[];
    expect(cols.reduce((a, c) => a + c.size, 0)).toBeLessThanOrEqual(556);
    expect(wrapper.find('[data-test="pa-sessions-row-0-open"]').exists()).toBe(true);
  });
});
