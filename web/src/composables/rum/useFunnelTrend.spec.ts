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

import { describe, expect, it, vi } from "vitest";
import { computed, ref, type Ref } from "vue";
import useFunnelTrend from "@/composables/rum/useFunnelTrend";
import type { PanelState } from "@/composables/rum/useAnalyticsSearch";
import { raw, type TranslateFn } from "@/types/i18n";
import type { FunnelDef, FunnelPair, Granularity } from "@/utils/rum/productAnalyticsQueries";

const DAY = 86_400_000_000;
const START = Date.UTC(2026, 9, 8) * 1000;

const steps = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ kind: "p" as const, key: `/s${i + 1}` }));

const setup = () => {
  let release: () => void = () => {};
  const pending = new Promise<null>((r) => (release = () => r(null)));
  const panels = new Map<string, Ref<PanelState<unknown>>>();
  const runner = {
    panel: (id: string) => {
      if (!panels.has(id))
        panels.set(
          id,
          ref({ status: "idle", rows: [], error: null, partial: null, key: null, sampled: 1 }),
        );
      return panels.get(id)!;
    },
    run: vi.fn(async (id: string, _spec: { sql: string }, key: string) => {
      const p = runner.panel(id);
      p.value = { ...p.value, status: "loading", key };
      return p.value;
    }),
    hold: vi.fn((id: string) => {
      runner.panel(id).value = { ...runner.panel(id).value, status: "idle", key: null };
    }),
  };
  const pa = {
    funnelView: ref<"steps" | "trend">("trend"),
    funnelPair: ref<FunnelPair | null>(null),
    funnelInterval: ref<Granularity>("auto"),
    range: ref({ startUs: START, endUs: START + 7 * DAY }),
    dataStartUs: ref<number | null>(null),
    summary: ref(null),
    scope: ref({ app: "web", env: [], version: [], schema: {} }),
    loadDataStart: vi.fn(() => pending),
    newUsersRange: (r: { startUs: number; endUs: number }) => r,
  };
  const def = ref<FunnelDef>({
    steps: steps(3),
    unit: "sessions",
    window: "session",
    breakdown: null,
  });
  const trend = useFunnelTrend({
    pa: pa as never,
    runner: runner as never,
    t: ((k: string) => raw(k)) as unknown as TranslateFn,
    def: computed(() => def.value),
    usersMode: computed(() => false),
    identitySql: ref(null),
    events: computed(() => []),
    timezone: computed(() => "UTC"),
    funnelKey: computed(() => JSON.stringify(def.value.steps)),
    compareActive: computed(() => false),
    stepNames: computed(() => def.value.steps.map((s) => s.key)),
  });
  return { trend, runner, pa, def, release };
};

describe("useFunnelTrend", () => {
  it("a run whose funnel changed while it waited leaves the run to the newer funnel", async () => {
    const { trend, runner, def, release } = setup();
    const first = trend.run(def.value);
    def.value = { ...def.value, steps: steps(4) };
    const second = trend.run(def.value);
    release();
    await Promise.all([first, second]);
    const trendRuns = runner.run.mock.calls.filter((c) => c[0] === "funnel-trend");
    expect(trendRuns).toHaveLength(1);
    expect(trendRuns[0][1].sql).toContain("'/s4'");
    expect(trendRuns[0][1].sql).toContain("SUM(r4) AS cb");
    expect(trendRuns[0][2]).toBe(trend.key.value);
  });

  it("the interval setter keeps only values the link can round-trip", () => {
    const { trend, pa } = setup();
    trend.setInterval("week");
    expect(pa.funnelInterval.value).toBe("week");
    trend.setInterval("hour");
    expect(pa.funnelInterval.value).toBe("auto");
  });

  it("from lists steps 1 to n-1 and to lists only the steps after from", () => {
    const { trend, pa, def } = setup();
    def.value = { ...def.value, steps: steps(4) };
    const values = (o: { value: unknown }[]) => o.map((x) => x.value);
    expect(values(trend.fromOptions.value)).toEqual([1, 2, 3]);
    expect(values(trend.toOptions.value)).toEqual([2, 3, 4]);
    pa.funnelPair.value = { a: 2, b: 3 };
    expect(values(trend.fromOptions.value)).toEqual([1, 2, 3]);
    expect(values(trend.toOptions.value)).toEqual([3, 4]);
  });

  it("setFrom and setTo write the pair, and step 1 to the last step stays out of the link", () => {
    const { trend, pa, def } = setup();
    def.value = { ...def.value, steps: steps(6) };
    trend.setFrom(2);
    expect(pa.funnelPair.value).toEqual({ a: 2, b: 6 });
    expect(trend.pair.value).toEqual({ a: 2, b: 6 });
    trend.setTo(4);
    expect(pa.funnelPair.value).toEqual({ a: 2, b: 4 });
    expect(trend.pair.value).toEqual({ a: 2, b: 4 });
    trend.setFrom(3);
    expect(pa.funnelPair.value).toEqual({ a: 3, b: 4 });
    trend.setFrom(1);
    trend.setTo(6);
    expect(pa.funnelPair.value).toBeNull();
    expect(trend.pair.value).toEqual({ a: 1, b: 6 });
  });

  it("moving from to or past to sets to to the last step", () => {
    const { trend, pa, def } = setup();
    def.value = { ...def.value, steps: steps(6) };
    pa.funnelPair.value = { a: 2, b: 4 };
    trend.setFrom(4);
    expect(pa.funnelPair.value).toEqual({ a: 4, b: 6 });
    pa.funnelPair.value = { a: 2, b: 4 };
    trend.setFrom(5);
    expect(pa.funnelPair.value).toEqual({ a: 5, b: 6 });
  });

  it("a removed step resets a pair the funnel can no longer hold to step 1 to the last step", () => {
    const { trend, pa, def } = setup();
    def.value = { ...def.value, steps: steps(4) };
    pa.funnelPair.value = { a: 3, b: 4 };
    expect(trend.pair.value).toEqual({ a: 3, b: 4 });
    def.value = { ...def.value, steps: steps(3) };
    expect(trend.pair.value).toEqual({ a: 1, b: 3 });
    expect(trend.fromOptions.value.map((o) => o.value)).toEqual([1, 2]);
    expect(trend.toOptions.value.map((o) => o.value)).toEqual([2, 3]);
  });
});
