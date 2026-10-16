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
import type { RcaEvidenceEntry } from "@/services/incidents";
import { rcaEvidenceLink } from "@/utils/incidents/rcaEvidenceLinks";
import { rcaEvidenceEntry, rcaRunSummary } from "@/test/unit/fixtures/rcaThread";

const HYPOTHESES = rcaRunSummary().hypotheses;

const mountCard = (entry: RcaEvidenceEntry, withHeader = false) =>
  mount(RcaEvidenceCard, {
    props: { entry, hypotheses: HYPOTHESES, org: "default", withHeader },
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

  it("shows the query, each citation with its hypothesis, polarity, strength and the agent's reading, and the result line", () => {
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
    const citations = wrapper.findAll('[data-test="rca-evidence-citation"]').map((c) => c.text());
    expect(citations[0]).toMatch(
      /^Deploy 4f2c1e opens one orders-db connection per line item\s*· supports\s*· Decisive\s*Agent's reading:\s*Errors begin 116 s after the rollout\.$/,
    );
    expect(citations[1]).toContain("Node CPU saturation");
    expect(citations[1]).toContain("· rules out");
    expect(citations[1]).toContain("· Supporting");
    expect(byTest(wrapper, "rca-evidence-result").text()).toMatch(
      /^2 rows · took 41 ms\s*· checkout_api · 08:23:20–09:23:20 UTC · 0\.0s$/,
    );
  });

  it("the header carries the number, kind, title and the Decisive pill", () => {
    const wrapper = mountCard(rcaEvidenceEntry({ number: 3 }), true);

    const text = wrapper.text();
    expect(text).toContain("3");
    expect(text).toContain("SQL");
    expect(text).toContain("Logs · checkout_api");
    expect(text).toContain("Decisive");
    expect(mountCard(rcaEvidenceEntry()).text()).not.toContain("Logs · checkout_api");
  });

  it.each([
    ["SQL", rcaEvidenceEntry(), "Open in Logs"],
    [
      "PromQL",
      rcaEvidenceEntry({
        kind: "PromQL",
        target: "metrics",
        link: { signal: "metrics", streams: [], promql: "up" },
      }),
      "Open in Metrics",
    ],
    [
      "Traces",
      rcaEvidenceEntry({
        kind: "Traces",
        target: "traces",
        link: { signal: "traces", streams: ["default"], filter: "status_code=500" },
      }),
      "Open in Traces",
    ],
  ])("%s: the open button pushes the VE29 route", async (_kind, entry, label) => {
    const wrapper = mountCard(entry);
    const open = byTest(wrapper, "rca-evidence-open");

    expect(open.text()).toBe(label);
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
});
