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
import OButton from "@/lib/core/Button/OButton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import RankedKeysTable from "./RankedKeysTable.vue";
import type { RankedRow } from "@/utils/rum/productAnalyticsModel";
import type { StepRef } from "@/utils/rum/productAnalyticsQueries";

const row = (key: string, sessions: number): RankedRow => ({
  kind: "p",
  key,
  sessions,
  prevSessions: sessions,
  users: null,
  prevUsers: null,
  events: sessions,
  prevEvents: sessions,
  share: 0.5,
  prevShare: 0.5,
  delta: { kind: "none" },
  pages: null,
  topPage: null,
});

const ROWS = [row("/web/logs", 20), row("/web/metrics", 10)];
const DT = "pa-pages-table";

let wrapper: VueWrapper | null = null;

const mountTable = async (props: { trended?: StepRef[]; trendFull?: boolean } = {}) => {
  wrapper = mount(RankedKeysTable, {
    props: {
      rows: ROWS,
      kind: "p",
      view: "all",
      chip: "all",
      showUsers: false,
      state: { status: "ok", rows: [], error: null, partial: null, key: null, sampled: 1 },
      dataTest: DT,
      keyLabel: "Page" as never,
      compareLabel: "vs previous" as never,
      ...props,
    },
    attachTo: document.body,
  });
  await flushPromises();
  return wrapper;
};

const trendBtn = (w: VueWrapper, i: number) => w.find(`[data-test="${DT}-row-${i}-trend-btn"]`);

describe("RankedKeysTable trend toggle (scope addition 8, U1)", () => {
  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.body.innerHTML = "";
  });

  it("marks a plotted key as pressed and leaves the others unpressed", async () => {
    const w = await mountTable({ trended: [{ kind: "p", key: "/web/logs" }] });
    expect(trendBtn(w, 0).attributes("aria-pressed")).toBe("true");
    expect(trendBtn(w, 1).attributes("aria-pressed")).toBe("false");
  });

  it("a key of another kind with the same text is not shown as plotted", async () => {
    const w = await mountTable({ trended: [{ kind: "c", key: "/web/logs" }] });
    expect(trendBtn(w, 0).attributes("aria-pressed")).toBe("false");
  });

  it("at the series limit a plotted key can still be removed while the others are disabled", async () => {
    const w = await mountTable({ trended: [{ kind: "p", key: "/web/logs" }], trendFull: true });
    expect(trendBtn(w, 0).attributes("disabled")).toBeUndefined();
    expect(trendBtn(w, 1).attributes("disabled")).toBeDefined();
    await trendBtn(w, 0).trigger("click");
    expect(w.emitted("trend")?.[0]).toEqual([{ kind: "p", key: "/web/logs" }]);
  });

  it("clicking an unplotted key emits it once and does not lose focus", async () => {
    const w = await mountTable();
    const btn = trendBtn(w, 1);
    (btn.element as HTMLButtonElement).focus();
    await btn.trigger("click");
    expect(w.emitted("trend")).toEqual([[{ kind: "p", key: "/web/metrics" }]]);
    expect(document.activeElement).toBe(btn.element);
  });
});

describe("RankedKeysTable navigation actions name where they go", () => {
  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.body.innerHTML = "";
  });

  it("Build funnel, Paths from here and Define as event keep their icons and carry a destination tooltip", async () => {
    wrapper = mount(RankedKeysTable, {
      props: {
        rows: [{ ...ROWS[0], kind: "c", key: "save-btn" }],
        kind: "c",
        view: "all",
        chip: "all",
        showUsers: false,
        state: { status: "ok", rows: [], error: null, partial: null, key: null, sampled: 1 },
        dataTest: DT,
        keyLabel: "Click" as never,
        compareLabel: "vs previous" as never,
      },
      attachTo: document.body,
    });
    await flushPromises();
    const btn = (id: string) =>
      wrapper!.findAllComponents(OButton).find((b) => b.attributes("data-test") === id)!;
    const cases: [string, string, string][] = [
      [`${DT}-row-0-funnel-btn`, "filter-alt", "Open in Funnels"],
      [`${DT}-row-0-paths-btn`, "account-tree", "Open in Paths"],
      [`${DT}-row-0-define-event-btn`, "bookmark-add", "Create a named event"],
    ];
    for (const [id, icon, tip] of cases) {
      expect(btn(id).props("iconLeft")).toBe(icon);
      expect(btn(id).findComponent(OTooltip).props("content")).toBe(tip);
    }
  });

  it("names the phone row menu button (W20)", async () => {
    const w = await mountTable();
    expect(w.find(`[data-test="${DT}-row-0-menu"]`).attributes("aria-label")).toBe("More actions");
  });
});
