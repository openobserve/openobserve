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
import { mount } from "@vue/test-utils";
import en from "@/locales/languages/en-US.json";

vi.mock("@/types/i18n", () => ({
  raw: (v: unknown) => String(v ?? ""),
  useI18nTyped: () => ({
    t: (key: string, a?: Record<string, unknown> | number, b?: number) => {
      const params = typeof a === "object" ? a : {};
      const n = typeof a === "number" ? a : b;
      const msg = String(
        key.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], en) ?? key,
      );
      const forms = msg.split(" | ");
      const chosen = forms.length > 1 ? (n === 1 ? forms[0] : forms[1]) : msg;
      return chosen.replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? ""));
    },
  }),
}));

import VerdictCard from "./VerdictCard.vue";

const bands = (good: number, needs: number, poor: number) => ({ good, needs, poor });
const pct = (p75: number | null) => ({ p50: p75, p75, p95: p75 });

const vitals = (inp: number | null, cls = 0.05) => ({
  views: 1000,
  lcp: pct(2e9),
  inp: pct(inp),
  cls: pct(cls),
  lcpBands: bands(840, 110, 50),
  inpBands: bands(710, 150, 140),
  clsBands: bands(910, 60, 30),
});

const mountCard = (props: Record<string, unknown>) =>
  mount(VerdictCard, {
    props: {
      prev: null,
      percentile: "p75",
      hideVerdict: false,
      sessions: 4812,
      sessionsLink: () => "/",
      ...props,
    } as never,
    global: {
      stubs: {
        RouterLink: { template: "<a><slot /></a>" },
        OBadge: { template: "<span><slot /></span>" },
        OCard: { template: "<div><slot /></div>" },
        OSegmentedBar: true,
        OToggleGroup: { name: "OToggleGroup", template: "<div><slot /></div>" },
        OToggleGroupItem: { template: "<button><slot /></button>" },
      },
    },
  });

const lead = (w: ReturnType<typeof mountCard>) =>
  w.find('[data-test="rum-overview-verdict-lead"]').text();

describe("VerdictCard sentences", () => {
  it("names the failing metric, its threshold and the share of views as separate sentences", () => {
    const text = lead(mountCard({ vitals: vitals(240e6) }));
    expect(text).toContain("INP is over the 200 ms good threshold for 29% of page views.");
    expect(text).toContain(`${(4812).toLocaleString()} sessions in the range.`);
    expect(text).not.toContain("Compared with the previous period.");
  });

  it("mentions the previous period only when there is one to compare with", () => {
    const v = vitals(240e6);
    expect(lead(mountCard({ vitals: v, prev: v }))).toContain("Compared with the previous period.");
  });

  it("names every failing metric with its own sentence", () => {
    const text = lead(mountCard({ vitals: vitals(240e6, 0.3) }));
    expect(text).toContain("INP is over the 200 ms good threshold");
    expect(text).toContain("CLS is over the 0.10 good threshold");
  });

  it("says all three pass when nothing fails", () => {
    expect(lead(mountCard({ vitals: vitals(100e6) }))).toContain(
      "All three Core Web Vitals pass at p75.",
    );
  });

  it("explains that the verdict uses p75 in the failing and, off p75, the passing case", () => {
    expect(lead(mountCard({ vitals: vitals(240e6) }))).toContain("The verdict always uses p75");
    expect(lead(mountCard({ vitals: vitals(100e6) }))).not.toContain("always uses p75");
    expect(lead(mountCard({ vitals: vitals(100e6), percentile: "p95" }))).toContain(
      "The verdict always uses p75",
    );
  });

  it("omits the session count until it has loaded", () => {
    const text = lead(mountCard({ vitals: vitals(240e6), sessions: null }));
    expect(text).not.toContain("sessions in the range");
    expect(text).toContain("INP is over");
  });

  it("uses the singular for exactly one session", () => {
    expect(lead(mountCard({ vitals: vitals(100e6), sessions: 1 }))).toContain(
      "1 session in the range.",
    );
  });
});

describe("VerdictCard states", () => {
  it("uses a neutral heading, no chip and no repeated sentence for low data", () => {
    const w = mountCard({ vitals: vitals(240e6), hideVerdict: true });
    expect(w.find('[data-test="rum-overview-verdict-title"]').text()).toBe("Core Web Vitals");
    expect(w.find('[data-test="rum-overview-verdict-chip"]').exists()).toBe(false);
    expect(lead(w)).toBe("");
  });

  it("says there is no verdict when no vital has a value", () => {
    const empty = {
      views: 500,
      lcp: pct(null),
      inp: pct(null),
      cls: pct(null),
      lcpBands: bands(0, 0, 0),
      inpBands: bands(0, 0, 0),
      clsBands: bands(0, 0, 0),
    };
    const w = mountCard({ vitals: empty });
    expect(w.find('[data-test="rum-overview-verdict-title"]').text()).toBe(
      "No Core Web Vitals data",
    );
    expect(w.find('[data-test="rum-overview-verdict-chip"]').exists()).toBe(false);
    expect(lead(w)).toContain("None of the 500 page views");
  });

  it("emits the chosen percentile from the toggle", () => {
    const w = mountCard({ vitals: vitals(240e6) });
    w.findComponent({ name: "OToggleGroup" }).vm.$emit("update:modelValue", "p95");
    expect(w.emitted("update:percentile")).toEqual([["p95"]]);
  });

  it("labels the band as p75 when another percentile is shown", () => {
    const w = mountCard({ vitals: vitals(240e6), percentile: "p95" });
    expect(w.find('[data-test="rum-overview-vital-inp"]').text()).toContain("p75: Needs work");
  });

  it("gives the vital link an accessible name with value, band and delta", () => {
    const w = mountCard({ vitals: vitals(240e6), prev: vitals(202e6) });
    expect(w.find('[data-test="rum-overview-vital-inp-link"]').attributes("aria-label")).toBe(
      "INP p75 240 ms, Needs work, 38 ms slower. Open sessions.",
    );
  });

  it("describes a CLS change as lower or higher, not faster or slower", () => {
    const w = mountCard({ vitals: vitals(100e6, 0.05), prev: vitals(100e6, 0.1) });
    expect(w.find('[data-test="rum-overview-vital-cls-delta"]').text()).toBe("0.05 lower");
  });
});
