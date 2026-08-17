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

import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";

import i18n from "@/locales";
import EvidenceEventDetail from "./EvidenceEventDetail.vue";
import type { EvidenceEvent } from "@/composables/synthetics/syntheticResultsSchema";

const ev = (over: Partial<EvidenceEvent>): EvidenceEvent => ({
  ts: 0,
  stepId: "s1",
  kind: "response",
  level: null,
  text: null,
  message: null,
  stack: null,
  method: null,
  url: null,
  status: null,
  resourceType: null,
  initiatedTs: null,
  durationMs: null,
  firstParty: true,
  stepName: "Click Sign In",
  ...over,
});

const mountDetail = (event: EvidenceEvent) =>
  mount(EvidenceEventDetail, { props: { event }, global: { plugins: [i18n] } });

const LONG_URL =
  "https://cloud.openobserve.ai/dex/auth/local/login?back=%2Fdex%2Fauth%3Fclient_id%3Do2-client";

describe("EvidenceEventDetail", () => {
  it("shows the URL whole, host and query string included", () => {
    const w = mountDetail(ev({ url: LONG_URL, method: "POST", status: 500 }));
    const value = w.find('[data-test="synthetics-evidence-event-detail-value"]');
    expect(value.text()).toBe(LONG_URL);
  });

  it("falls back to text, then message, then kind for the value", () => {
    const sel = '[data-test="synthetics-evidence-event-detail-value"]';
    expect(
      mountDetail(ev({ kind: "console", text: "boom" }))
        .find(sel)
        .text(),
    ).toBe("boom");
    expect(
      mountDetail(ev({ kind: "pageerror", message: "bang" }))
        .find(sel)
        .text(),
    ).toBe("bang");
    expect(
      mountDetail(ev({ kind: "crash" }))
        .find(sel)
        .text(),
    ).toBe("crash");
  });

  it("renders the raw kind, not the row's collapsed category label", () => {
    const w = mountDetail(ev({ kind: "requestfailed", url: LONG_URL }));
    expect(w.find('[data-test="synthetics-evidence-event-detail-fields"]').text()).toContain(
      "requestfailed",
    );
  });

  it("omits fields that have no value rather than rendering a dash", () => {
    const w = mountDetail(ev({ kind: "console", level: "warning", text: "hm" }));
    const fields = w.find('[data-test="synthetics-evidence-event-detail-fields"]').text();
    expect(fields).toContain("Level");
    expect(fields).not.toContain("Method");
    expect(fields).not.toContain("Status");
    expect(fields).not.toContain("Took");
    expect(fields).not.toContain("Resource type");
  });

  it("keeps millisecond precision so occurred and initiated cannot print alike", () => {
    const w = mountDetail(ev({ ts: 1_755_420_753_481, initiatedTs: 1_755_420_753_298 }));
    const fields = w.find('[data-test="synthetics-evidence-event-detail-fields"]').text();
    expect(fields).toContain(".481");
    expect(fields).toContain(".298");
  });

  it("hides Initiated when it matches Occurred, since there is no ambiguity to show", () => {
    const w = mountDetail(ev({ ts: 1_755_420_753_481, initiatedTs: 1_755_420_753_481 }));
    expect(w.find('[data-test="synthetics-evidence-event-detail-fields"]').text()).not.toContain(
      "Initiated",
    );
  });

  it("names the origin instead of leaving it to opacity", () => {
    const first = mountDetail(ev({ firstParty: true }));
    const third = mountDetail(ev({ firstParty: false }));
    const sel = '[data-test="synthetics-evidence-event-detail-fields"]';
    expect(first.find(sel).text()).toContain("First-party");
    expect(third.find(sel).text()).toContain("Third-party");
  });

  it("names an unattributed step rather than leaving the row blank", () => {
    const w = mountDetail(ev({ stepName: null }));
    expect(w.find('[data-test="synthetics-evidence-event-detail-fields"]').text()).toContain(
      "Not attributed to a step",
    );
  });

  it("renders the stack trace, which no other surface shows today", () => {
    const stack = "TypeError: nope\n    at h (main.js:2:1)";
    const w = mountDetail(ev({ kind: "pageerror", message: "nope", stack }));
    expect(w.find('[data-test="synthetics-evidence-event-detail-stack"]').text()).toContain(
      "at h (main.js:2:1)",
    );
  });

  it("omits the stack block entirely when the event has none", () => {
    const w = mountDetail(ev({ kind: "console", text: "hm" }));
    expect(w.find('[data-test="synthetics-evidence-event-detail-stack"]').exists()).toBe(false);
  });

  it("offers a copy button for the value, and one for the stack only when it exists", () => {
    const plain = mountDetail(ev({ url: LONG_URL }));
    expect(plain.find('[data-test="synthetics-evidence-event-detail-copy-value"]').exists()).toBe(
      true,
    );
    expect(plain.find('[data-test="synthetics-evidence-event-detail-copy-stack"]').exists()).toBe(
      false,
    );

    const withStack = mountDetail(ev({ kind: "pageerror", message: "x", stack: "at h" }));
    expect(
      withStack.find('[data-test="synthetics-evidence-event-detail-copy-stack"]').exists(),
    ).toBe(true);
  });
});
