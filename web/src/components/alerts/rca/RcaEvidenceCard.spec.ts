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

const { push, toastMock } = vi.hoisted(() => ({ push: vi.fn(), toastMock: vi.fn() }));
vi.mock("vue-router", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: toastMock }));

import i18n from "@/locales";
import RcaEvidenceCard from "./RcaEvidenceCard.vue";
import type { RcaEvidenceEntry, RcaSummaryHypothesis } from "@/services/incidents";
import { rcaEvidenceLink } from "@/utils/incidents/rcaEvidenceLinks";
import { formatRcaDuration } from "@/utils/incidents/rcaThread";
import { rcaEvidenceEntry, rcaRunSummary } from "@/test/unit/fixtures/rcaThread";

const HYPOTHESES = rcaRunSummary().hypotheses;
const statementOf = (id: string) => HYPOTHESES.find((h) => h.id === id)!.statement;

const mountCard = (
  entry: RcaEvidenceEntry,
  withHeader = false,
  extra: { hypothesisId?: string; hypotheses?: RcaSummaryHypothesis[] } = {},
) =>
  mount(RcaEvidenceCard, {
    props: {
      entry,
      hypotheses: extra.hypotheses ?? HYPOTHESES,
      hypothesisId: extra.hypothesisId ?? null,
      org: "default",
      withHeader,
    },
    global: { plugins: [i18n] },
  });

const byTest = (wrapper: VueWrapper, id: string) => wrapper.find(`[data-test="${id}"]`);

describe("RcaEvidenceCard (03 VE23–VE29)", () => {
  const writeText = vi.mocked(navigator.clipboard.writeText);

  beforeEach(() => {
    push.mockReset();
    toastMock.mockReset();
    writeText.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => vi.restoreAllMocks());

  it("shows the query, each citation's weight and polarity with its hypothesis as a link, the agent's reading, and the result line", () => {
    const wrapper = mountCard(
      rcaEvidenceEntry({
        citations: [
          ...rcaEvidenceEntry().citations,
          {
            hypothesis_id: "h4",
            evidence_id: "e1",
            polarity: "rules_out",
            strength: "supporting",
            observation: "No CPU spike in the window.",
          },
        ],
      }),
    );

    expect(byTest(wrapper, "rca-evidence-query").text()).toBe(
      "SELECT count(*) FROM \"checkout_api\" WHERE level = 'error'",
    );
    const citations = wrapper.findAll('[data-test="rca-evidence-citation"]');
    const links = citations.map((c) => c.find('[data-test="rca-evidence-citation-hypothesis"]'));
    // The sole root cause is named by its role; the statement stays in the tooltip.
    const rootStatement = statementOf(rcaEvidenceEntry().citations[0].hypothesis_id);
    expect(links[0].text()).not.toBe(rootStatement);
    expect(links[0].attributes("title")).toBe(rootStatement);
    expect(citations[0].text()).toContain(
      `Agent's reading: ${rcaEvidenceEntry().citations[0].observation}`,
    );
    // A ruled-out hypothesis has no role name: the link is its statement.
    expect(links[1].text()).toBe(statementOf("h4"));
    // The result summary carries the query time; the card does not add the call's duration again.
    const result = byTest(wrapper, "rca-evidence-result").text();
    const entry = rcaEvidenceEntry();
    expect(result.split(entry.result_summary)).toHaveLength(2);
    expect(result).toContain(entry.link.streams[0]);
    expect(result).not.toContain(formatRcaDuration(entry.duration_ms));
  });

  it("a role two hypotheses share names the statement instead", () => {
    const wrapper = mountCard(rcaEvidenceEntry(), false, {
      hypotheses: HYPOTHESES.map((h) => (h.id === "h2" ? { ...h, status: "root_cause" } : h)),
    });

    expect(byTest(wrapper, "rca-evidence-citation-hypothesis").text()).toBe(
      statementOf(rcaEvidenceEntry().citations[0].hypothesis_id),
    );
  });

  it("a hypothesis link emits open-hypothesis; under its own hypothesis the citation has no link", async () => {
    const entry = rcaEvidenceEntry({
      citations: [
        ...rcaEvidenceEntry().citations,
        {
          hypothesis_id: "h4",
          evidence_id: "e1",
          polarity: "rules_out",
          strength: "supporting",
          observation: "No CPU spike in the window.",
        },
      ],
    });
    const wrapper = mountCard(entry, true, { hypothesisId: "h1" });

    const citations = wrapper.findAll('[data-test="rca-evidence-citation"]');
    expect(citations[0].find('[data-test="rca-evidence-citation-hypothesis"]').exists()).toBe(
      false,
    );
    expect(citations[0].text()).toContain(entry.citations[0].observation);
    await citations[1].find('[data-test="rca-evidence-citation-hypothesis"]').trigger("click");
    expect(wrapper.emitted("open-hypothesis")).toEqual([["h4"]]);
  });

  it("the header carries the number, kind and a strong pill for decisive evidence", () => {
    const wrapper = mountCard(rcaEvidenceEntry({ number: 3 }), true);

    const text = wrapper.text();
    expect(text).toContain("3");
    expect(text).toContain("SQL");
    expect(wrapper.findComponent({ name: "RcaPill" }).props("tone")).toBe("strong");
    expect(mountCard(rcaEvidenceEntry()).findComponent({ name: "RcaPill" }).exists()).toBe(false);
  });

  it.each([
    ["SQL", rcaEvidenceEntry()],
    [
      "PromQL",
      rcaEvidenceEntry({
        kind: "PromQL",
        target: "metrics",
        link: { signal: "metrics", streams: [], promql: "up" },
      }),
    ],
    [
      "Traces",
      rcaEvidenceEntry({
        kind: "Traces",
        target: "traces",
        link: { signal: "traces", streams: ["default"], filter: "status_code=500" },
      }),
    ],
  ])("%s: the open button pushes the evidence route", async (_kind, entry) => {
    const wrapper = mountCard(entry);
    const open = byTest(wrapper, "rca-evidence-open");

    await open.trigger("click");
    expect(push).toHaveBeenCalledWith(rcaEvidenceLink(entry.link, "default")!.route);
  });

  it.each([
    ["change", { signal: "change", streams: [] }],
    ["infra", { signal: "infra", streams: ["prod"] }],
    ["context", { signal: "context", streams: ["checkout_api"] }],
  ] as const)("%s has no link and no query to copy", (signal, link) => {
    const wrapper = mountCard(
      rcaEvidenceEntry({
        kind: "gh",
        target: signal,
        link: { ...link, streams: [...link.streams] },
      }),
    );

    expect(byTest(wrapper, "rca-evidence-open").exists()).toBe(false);
    expect(byTest(wrapper, "rca-evidence-copy").exists()).toBe(false);
  });

  it.each([
    ["change", "gh pr diff 812"],
    ["infra", "kubectl get pods -n checkout"],
  ] as const)(
    "%s with a command: shows it and copies it, still no explorer link",
    async (signal, command) => {
      const wrapper = mountCard(
        rcaEvidenceEntry({ kind: "shell", target: signal, link: { signal, streams: [], command } }),
      );

      expect(byTest(wrapper, "rca-evidence-open").exists()).toBe(false);
      expect(byTest(wrapper, "rca-evidence-query").text()).toBe(command);
      await byTest(wrapper, "rca-evidence-copy").trigger("click");
      await flushPromises();
      expect(writeText).toHaveBeenCalledWith(command);
    },
  );

  it("Copy query copies the stored query and confirms", async () => {
    const wrapper = mountCard(rcaEvidenceEntry());
    await byTest(wrapper, "rca-evidence-copy").trigger("click");
    await flushPromises();

    expect(writeText).toHaveBeenCalledWith(
      "SELECT count(*) FROM \"checkout_api\" WHERE level = 'error'",
    );
    expect(toastMock).toHaveBeenCalledWith({ variant: "success", message: "Query copied" });
  });

  it("a clipboard failure shows the failure toast", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    writeText.mockRejectedValue(new Error("denied"));
    const wrapper = mountCard(rcaEvidenceEntry());
    await byTest(wrapper, "rca-evidence-copy").trigger("click");
    await flushPromises();

    expect(toastMock).toHaveBeenCalledWith({
      variant: "error",
      message: "Could not copy the query",
    });
  });

  it("the agent's reading is text, never HTML (VE-D5)", () => {
    const wrapper = mountCard(
      rcaEvidenceEntry({
        citations: [
          {
            hypothesis_id: "h1",
            evidence_id: "e1",
            polarity: "supports",
            strength: "decisive",
            observation: '<a href="https://evil.example">click</a>',
          },
        ],
      }),
    );

    expect(wrapper.find("a").exists()).toBe(false);
    expect(byTest(wrapper, "rca-evidence-citation").text()).toContain(
      '<a href="https://evil.example">click</a>',
    );
  });

  it("agent inline code in the reading shows as code, never as backticks", () => {
    const wrapper = mountCard(
      rcaEvidenceEntry({
        citations: [
          {
            hypothesis_id: "h1",
            evidence_id: "e1",
            polarity: "supports",
            strength: "decisive",
            observation: "`GET /api/data` errors start at the toggle",
          },
        ],
      }),
    );

    const citation = byTest(wrapper, "rca-evidence-citation");
    expect(citation.text()).not.toContain("`");
    expect(citation.find("code").text()).toBe("GET /api/data");
  });
});
