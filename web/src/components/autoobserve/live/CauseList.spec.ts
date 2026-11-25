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

import { afterEach, describe, expect, it, vi } from "vitest";
import { enableAutoUnmount, mount } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import type {
  AutoObserveCauseLine,
  AutoObserveChecked,
  AutoObserveIssueContext,
} from "@/services/autoobserve";
import CauseList from "./CauseList.vue";

vi.mock("vue-router", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useRouter: () => ({ push: vi.fn() }),
}));

enableAutoUnmount(afterEach);

const AT_US = Date.UTC(2026, 10, 16, 14, 12) * 1000;

const cause = (i: number): AutoObserveCauseLine =>
  ({
    id: `c${i}`,
    record: { kind: "deploy", open: null },
    grade: "possible",
    sentence: `Service s${i} was deployed, 11 minutes before the issue started.`,
    used: false,
  }) as AutoObserveCauseLine;

const context = (over: Partial<AutoObserveIssueContext>): AutoObserveIssueContext => ({
  causes: { top: [cause(0)], more: 0 },
  impact: [],
  classes: [],
  window: [AT_US - 40 * 60_000_000, AT_US - 5 * 60_000_000],
  asked_at: AT_US,
  settled: true,
  checks: [],
  hidden: 0,
  region_only: false,
  next_step: null,
  ...over,
});

const mountList = (cx: AutoObserveIssueContext | null) =>
  mount(CauseList, {
    props: { context: cx, recovered: false, nowMs: AT_US / 1000 },
    global: { plugins: [i18n, store] },
  });

const sel = (name: string) => `[data-test="autoobserve-cause-list-${name}"]`;

describe("CauseList", () => {
  it.each<[string, AutoObserveChecked | null, string[]]>([
    ["every check ran: no notice", { kind: "ok" }, []],
    ["not recorded: no notice, a footer note", { kind: "not_recorded" }, []],
    ["off: amber", { kind: "off" }, ["gap:warning"]],
    ["partly checked: amber", { kind: "partial" }, ["gap:warning"]],
    ["failed: red", { kind: "failed", reason: "timeout" }, ["failed:error"]],
  ])("the title's notice follows the checks: %s", (_name, state, want) => {
    const checks = state ? [{ label: "pipelines", state }] : [];
    const wrapper = mountList(context({ checks }));
    const notices = ["gap", "failed"].flatMap((n) => {
      const el = wrapper.find(sel(n));
      return el.exists() ? [`${n}:${el.attributes("data-variant")}`] : [];
    });
    expect(notices).toEqual(want);
  });

  it("holds a skeleton until the first ask is stored", () => {
    const wrapper = mountList(context({ asked_at: null }));
    expect(wrapper.find(sel("block")).attributes("aria-busy")).toBe("true");
    expect(wrapper.findAll(sel("row"))).toHaveLength(0);
  });

  it.each([
    ["3 rows", 0, 3],
    ["1 row when an impact callout takes two slots", 1, 1],
  ])(
    "folds 12 changes to %s and expands to the 10 served, naming the 2 it does not list",
    async (_name, impacts, collapsed) => {
      const top = Array.from({ length: 10 }, (_, i) => cause(i));
      const impact = Array.from({ length: impacts }, (_, i) => ({
        id: `i${i}`,
        sentence: "12 detections get no data.",
        redacted: false,
        used: false,
        record: { kind: "detection", effect: "blind", items: [], more: 0 },
      })) as unknown as AutoObserveIssueContext["impact"];
      const wrapper = mountList(context({ causes: { top, more: 2 }, impact }));
      expect(wrapper.findAll(sel("impact"))).toHaveLength(impacts);
      expect(wrapper.findAll(sel("row"))).toHaveLength(collapsed);
      expect(wrapper.find(sel("unlisted")).exists()).toBe(false);
      await wrapper.find(sel("fold")).trigger("click");
      expect(wrapper.findAll(sel("row"))).toHaveLength(10);
      expect(wrapper.find(sel("unlisted")).exists()).toBe(true);
      await wrapper.find(sel("fold")).trigger("click");
      expect(wrapper.findAll(sel("row"))).toHaveLength(collapsed);
    },
  );
});
