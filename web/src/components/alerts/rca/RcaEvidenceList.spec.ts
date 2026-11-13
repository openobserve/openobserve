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
import { mount, type VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";

vi.mock("vue-router", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import i18n from "@/locales";
import RcaEvidenceList from "./RcaEvidenceList.vue";
import type { RcaEvidenceEntry, RcaUnverifiedCitation } from "@/services/incidents";
import { rcaEvidenceEntry, rcaRunSummary } from "@/test/unit/fixtures/rcaThread";

/** 7 entries, 4 of them Decisive. */
const SEVEN: RcaEvidenceEntry[] = [1, 2, 3, 4, 5, 6, 7].map((number) =>
  rcaEvidenceEntry({
    number,
    ids: [`e${number}`],
    call_id: `call-${number}`,
    decisive: number % 2 === 1,
    result_summary: `${number} rows`,
  }),
);

const UNVERIFIED: RcaUnverifiedCitation[] = [
  {
    hypothesis_id: "h4",
    evidence_id: "e9",
    tool: "PrometheusRangeQuery",
    query: "avg(node_cpu)",
    reason: "not_run",
  },
  {
    hypothesis_id: "h3",
    evidence_id: "e10",
    tool: "SearchSQL",
    query: "SELECT * FROM flags",
    reason: "failed",
  },
  {
    hypothesis_id: "h1",
    evidence_id: "e11",
    tool: "SearchSQL",
    ref: "ccglip",
    query: "",
    reason: "ambiguous",
  },
];

const mountList = (evidence = SEVEN, unverified = UNVERIFIED) =>
  mount(RcaEvidenceList, {
    props: { evidence, unverified, hypotheses: rcaRunSummary().hypotheses, org: "default" },
    global: { plugins: [i18n] },
    attachTo: document.body,
  });

/** What the list exposes to its parent; `wrapper.vm` does not type `defineExpose`. */
interface EvidenceListApi {
  openEntry: (n: number) => Promise<void>;
  showUnverified: () => Promise<void>;
}

const numbers = (wrapper: VueWrapper) =>
  wrapper
    .findAll('[data-test="rca-evidence-entry"]')
    .map((row) => Number(row.attributes("data-number")));

describe("RcaEvidenceList (03 VE23–VE30)", () => {
  it("lists the numbered entries with the count and the Decisive count", () => {
    const wrapper = mountList();

    expect(numbers(wrapper)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(wrapper.text()).toContain("7 · 4 decisive");
    wrapper.unmount();
  });

  it("each row leads with the claim it supports; kind, source and query open below", async () => {
    const wrapper = mountList();
    const row = wrapper.find('[data-test="rca-fold-row-toggle"]');

    expect(row.text()).toMatch(/^1\s*Errors begin 116 s after the rollout\.\s*Decisive$/);
    expect(row.text()).not.toContain("SQL");
    await row.trigger("click");
    const card = wrapper.find('[data-number="1"] [data-test="rca-evidence-card"]');
    expect(card.text()).toContain("1 rows");
    wrapper.unmount();
  });

  it("an entry no hypothesis cites leads with its source and result", () => {
    const wrapper = mountList([rcaEvidenceEntry({ number: 1, citations: [] })], []);
    expect(wrapper.find('[data-test="rca-fold-row-toggle"]').text()).toMatch(
      /^1\s*Logs · checkout_api · 2 rows · took 41 ms\s*Decisive$/,
    );
    wrapper.unmount();
  });

  it("VE28: the filter shows the Decisive count and filters the rows", async () => {
    const wrapper = mountList();
    const option = (value: string) => wrapper.find(`[data-test="rca-evidence-filter-${value}"]`);

    expect(option("all").text()).toBe("All");
    expect(option("decisive").text()).toBe("Decisive 4");
    expect(option("supporting").text()).toBe("Supporting");
    expect(option("all").attributes("aria-pressed")).toBe("true");

    await option("decisive").trigger("click");
    expect(numbers(wrapper)).toEqual([1, 3, 5, 7]);
    expect(option("decisive").attributes("aria-pressed")).toBe("true");
    await option("supporting").trigger("click");
    expect(numbers(wrapper)).toEqual([2, 4, 6]);
    await option("all").trigger("click");
    expect(numbers(wrapper)).toHaveLength(7);
    wrapper.unmount();
  });

  it("a row toggles its card", async () => {
    const wrapper = mountList();
    const row = wrapper.findAll('[data-test="rca-fold-row-toggle"]')[1];

    await row.trigger("click");
    expect(row.element.closest("button")?.getAttribute("aria-expanded")).toBe("true");
    const card = wrapper.find('[data-number="2"] [data-test="rca-evidence-card"]');
    expect(card.exists()).toBe(true);

    await row.trigger("click");
    expect(wrapper.find('[data-test="rca-evidence-card"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("VE30: 'Cited but not verified' lists id, tool, query and reason, with no number and no link", () => {
    const wrapper = mountList();
    const section = wrapper.find('[data-test="rca-unverified"]');

    expect(section.find("h4").text()).toMatch(/^Cited but not verified\s*3$/);
    const rows = section.findAll('[data-test="rca-unverified-entry"]');
    expect(rows[0].text()).toMatch(/^e9\s*PrometheusRangeQuery\s*Not run\s*avg\(node_cpu\)$/);
    expect(rows[1].text()).toMatch(/^e10\s*SearchSQL\s*Failed\s*SELECT \* FROM flags$/);
    expect(rows[2].text()).toMatch(/^e11\s*SearchSQL\s*\[ref ccglip\]\s*Ambiguous$/);
    expect(section.find("a").exists()).toBe(false);
    expect(section.find("button").exists()).toBe(false);
    wrapper.unmount();
  });

  it("no unverified citations: no section; no evidence: the empty line and no filter", () => {
    const wrapper = mountList([], []);

    expect(wrapper.find('[data-test="rca-unverified"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="rca-evidence-empty"]').text()).toBe("No verified evidence.");
    expect(wrapper.find('[data-test="rca-evidence-filter"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("openEntry(n) opens and scrolls to the entry, clearing a filter that hides it (F9)", async () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const wrapper = mountList();
    const list: EvidenceListApi = wrapper.vm as unknown as EvidenceListApi;
    await wrapper.find('[data-test="rca-evidence-filter-decisive"]').trigger("click");

    await list.openEntry(4);
    await nextTick();

    expect(numbers(wrapper)).toHaveLength(7);
    expect(wrapper.find('[data-number="4"] [data-test="rca-evidence-card"]').exists()).toBe(true);
    expect(scrollIntoView).toHaveBeenCalled();

    // An unknown number does nothing.
    await list.openEntry(99);
    expect(wrapper.findAll('[data-test="rca-evidence-card"]')).toHaveLength(1);
    wrapper.unmount();
  });

  it("showUnverified() scrolls to and focuses 'Cited but not verified' (VE33 band chip)", async () => {
    Element.prototype.scrollIntoView = vi.fn();
    const wrapper = mountList();
    const list: EvidenceListApi = wrapper.vm as unknown as EvidenceListApi;

    await list.showUnverified();

    expect(document.activeElement).toBe(wrapper.find('[data-test="rca-unverified"]').element);
    wrapper.unmount();
  });
});
