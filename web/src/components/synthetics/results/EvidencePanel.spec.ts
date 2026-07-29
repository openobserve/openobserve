// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";

import i18n from "@/locales";
import EvidencePanel from "./EvidencePanel.vue";
import {
  foldEvidenceBundle,
  isEvidenceAnomaly,
  parseEvidenceNdjson,
} from "@/composables/synthetics/syntheticResultsSchema";

// ── Real bundle lines, copied from a live run ───────────────────────────────
//
// `intro test (expect fail)`: 18 all-200 responses, the run failing on a locator
// timeout at step 20. That combination is the panel's whole reason for existing —
// `evidence_by_step` is EMPTY here because summarise() only emits for anomalous
// steps, so the record says "nothing to report" while the bundle says what the
// page was doing.
const NDJSON = [
  '{"ts":1785356285799,"kind":"response","method":"GET","url":"https://o2.example.dev/web/login","status":200,"resource_type":"document","initiated_ts":1785356285501,"duration_ms":298,"first_party":true,"step_id":"s19"}',
  '{"ts":1785356286100,"kind":"response","method":"GET","url":"https://cdn.third-party.io/a.js","status":200,"resource_type":"script","initiated_ts":1785356285900,"duration_ms":80,"first_party":false,"step_id":"s19"}',
  '{"ts":1785356286500,"kind":"response","method":"GET","url":"https://o2.example.dev/api/streams","status":500,"resource_type":"xhr","initiated_ts":1785356286200,"duration_ms":300,"first_party":true,"step_id":"s19"}',
  '{"ts":1785356286600,"kind":"console","level":"error","text":"Uncaught TypeError: e.map is not a function","step_id":"s19"}',
].join("\n");

const STEP_DEFS = new Map([
  ["s19", { name: "Navigate to /web/login", selector: null }],
  ["fa1", { name: 'Assert visible [data-test="element-that-never-exists"]', selector: null }],
]);

describe("evidence bundle parsing", () => {
  it("parses NDJSON line by line, not as a JSON document", () => {
    // JSON.parse on the whole payload throws — which is also why the download
    // button must not be labelled "JSON".
    expect(() => JSON.parse(NDJSON)).toThrow();
    expect(parseEvidenceNdjson(NDJSON)).toHaveLength(4);
  });

  it("drops only the malformed line, never the panel", () => {
    // A bundle truncated at the cap ends mid-line by construction, so this is
    // the expected case at the limit rather than corruption.
    const withJunk = `${NDJSON}\n{"ts":1,"kind":"response"`;
    expect(parseEvidenceNdjson(withJunk)).toHaveLength(4);
    expect(parseEvidenceNdjson("")).toEqual([]);
    expect(parseEvidenceNdjson("\n\n  \n")).toEqual([]);
  });

  it("keeps both timestamps distinct", () => {
    // Work begun in step 9 completes during step 10; collapsing ts and
    // initiated_ts would hide that rather than show it.
    const [first] = parseEvidenceNdjson(NDJSON);
    expect(first.ts).toBe(1785356285799);
    expect(first.initiatedTs).toBe(1785356285501);
  });

  it("treats a missing first_party as first-party, not third", () => {
    const [e] = parseEvidenceNdjson('{"ts":1,"kind":"response","status":200}');
    expect(e.firstParty).toBe(true);
  });
});

describe("anomaly classification", () => {
  it("counts only what an engineer would call a problem", () => {
    const mk = (o: any) => parseEvidenceNdjson(JSON.stringify({ ts: 1, ...o }))[0];
    expect(isEvidenceAnomaly(mk({ kind: "response", status: 200 }))).toBe(false);
    expect(isEvidenceAnomaly(mk({ kind: "response", status: 302 }))).toBe(false);
    expect(isEvidenceAnomaly(mk({ kind: "response", status: 404 }))).toBe(true);
    expect(isEvidenceAnomaly(mk({ kind: "requestfailed" }))).toBe(true);
    expect(isEvidenceAnomaly(mk({ kind: "pageerror" }))).toBe(true);
    // A console *warning* is not an anomaly; only an error is.
    expect(isEvidenceAnomaly(mk({ kind: "console", level: "warning" }))).toBe(false);
    expect(isEvidenceAnomaly(mk({ kind: "console", level: "error" }))).toBe(true);
  });
});

describe("evidence grouping", () => {
  const fold = (text = NDJSON) => foldEvidenceBundle(parseEvidenceNdjson(text), STEP_DEFS);

  it("groups by kind, not by step", () => {
    // Step grouping reads well in a wireframe and degenerates on real data: a
    // live 158-event bundle held two distinct step_ids, so it produced one
    // section of 136 and one of 22 and told the reader nothing.
    expect(fold().groups.map((g) => g.kind)).toEqual(["console", "network"]);
  });

  it("orders groups by severity, not by volume", () => {
    // 153 responses must not bury one page error.
    const text = [
      '{"ts":5,"kind":"response","status":200,"initiated_ts":5}',
      '{"ts":1,"kind":"pageerror","message":"boom"}',
      '{"ts":2,"kind":"requestfailed","url":"https://x/y"}',
      '{"ts":3,"kind":"console","level":"error","text":"bad"}',
    ].join("\n");
    expect(fold(text).groups.map((g) => g.kind)).toEqual([
      "pageErrors",
      "requestsFailed",
      "console",
      "network",
    ]);
  });

  it("orders events within a group by when they were initiated", () => {
    const g = fold().groups.find((x) => x.kind === "network")!;
    expect(g.events.map((e) => e.initiatedTs)).toEqual([
      1785356285501, 1785356285900, 1785356286200,
    ]);
  });

  it("flags a group that contains an anomaly", () => {
    const groups = fold().groups;
    // network holds the 502, console holds the error.
    expect(groups.find((g) => g.kind === "network")!.hasAnomaly).toBe(true);
    expect(groups.find((g) => g.kind === "console")!.hasAnomaly).toBe(true);
    // All-200 network is not flagged.
    const clean = fold('{"ts":1,"kind":"response","status":200}');
    expect(clean.groups[0].hasAnomaly).toBe(false);
  });

  it("resolves the step name onto each row, falling back to the id", () => {
    // Attribution is kept; it just moved off the grouping axis.
    const g = fold().groups.find((x) => x.kind === "network")!;
    expect(g.events[0].stepName).toBe("Navigate to /web/login");
    const unknown = fold('{"ts":1,"kind":"response","status":200,"step_id":"s99"}');
    expect(unknown.groups[0].events[0].stepName).toBe("s99");
  });

  it("leaves an unattributed event's step name null rather than guessing", () => {
    const b = fold('{"ts":1,"kind":"pageerror","message":"boom"}');
    expect(b.groups[0].events[0].stepName).toBeNull();
  });

  it("counts each anomaly kind separately", () => {
    expect(fold().counts).toMatchObject({
      all: 4,
      consoleErrors: 1,
      nonNon2xx: 1,
      pageErrors: 0,
      requestsFailed: 0,
    });
  });

  it("reports truncation from either the record or a truncation event", () => {
    expect(fold().truncated).toBe(false);
    expect(foldEvidenceBundle(parseEvidenceNdjson(NDJSON), STEP_DEFS, true).truncated).toBe(true);
    expect(
      foldEvidenceBundle(parseEvidenceNdjson('{"ts":1,"kind":"truncation"}'), STEP_DEFS).truncated,
    ).toBe(true);
  });
});

describe("EvidencePanel", () => {
  const mountPanel = (props: Record<string, unknown> = {}) =>
    mount(EvidencePanel, {
      props: {
        evidenceKey: "synthetics/org/mon/2026/07/29/RUN/EXEC/attempt-1-evidence.ndjson",
        resolveUrl: (k: string) => `/artifact?key=${k}`,
        stepDefs: STEP_DEFS,
        ...props,
      },
      global: { plugins: [i18n] },
    });

  beforeEach(() => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () => NDJSON,
    })) as any;
  });

  it("fetches the bundle and renders a section per kind", async () => {
    const w = mountPanel();
    await flushPromises();
    expect(w.find('[data-test="synthetics-evidence-panel"]').exists()).toBe(true);
    expect(w.find('[data-test="synthetics-evidence-group-network"]').exists()).toBe(true);
    expect(w.find('[data-test="synthetics-evidence-group-console"]').exists()).toBe(true);
    // No page errors in this bundle, so no empty section header for them.
    expect(w.find('[data-test="synthetics-evidence-group-pageErrors"]').exists()).toBe(false);
  });

  it("shows which step each row belongs to", async () => {
    const w = mountPanel();
    await flushPromises();
    expect(w.find('[data-test="synthetics-evidence-row-step"]').text()).toContain(
      "Navigate to /web/login",
    );
  });

  it("refetches when the attempt changes, so bundles never cross labels", async () => {
    const w = mountPanel();
    await flushPromises();
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    await w.setProps({ evidenceKey: "…/evidence.ndjson" });
    await flushPromises();
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect((globalThis.fetch as any).mock.calls[1][0]).toContain("/evidence.ndjson");
  });

  it("keeps zero-count chips visible rather than hiding them", async () => {
    const w = mountPanel();
    await flushPromises();
    // A hidden zero is indistinguishable from a chip that does not exist, and
    // "no page errors" is information.
    expect(w.find('[data-test="synthetics-evidence-chip-pageErrors"]').exists()).toBe(true);
    expect(w.find('[data-test="synthetics-evidence-chip-pageErrors"]').text()).toContain("0");
  });

  it("reports a failed fetch instead of rendering a quiet run", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 403,
      statusText: "Forbidden",
      text: async () => "",
    })) as any;
    const w = mountPanel();
    await flushPromises();
    expect(w.find('[data-test="synthetics-evidence-error"]').exists()).toBe(true);
    expect(w.find('[data-test="synthetics-evidence-panel"]').text()).toContain("403");
  });

  it("distinguishes capture-off from not-kept from absent", async () => {
    const off = mountPanel({ evidenceKey: null, captureOff: true });
    await flushPromises();
    expect(off.find('[data-test="synthetics-evidence-empty"]').text()).toContain("capture is off");

    const passed = mountPanel({ evidenceKey: null, runPassed: true });
    await flushPromises();
    expect(passed.find('[data-test="synthetics-evidence-empty"]').text()).toContain("failed runs only");

    const none = mountPanel({ evidenceKey: null });
    await flushPromises();
    expect(none.find('[data-test="synthetics-evidence-empty"]').text()).toContain("No evidence bundle");
    // Never fetch when there is no key.
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("states truncation rather than showing a quietly short list", async () => {
    const w = mountPanel({ recordTruncated: true });
    await flushPromises();
    expect(w.find('[data-test="synthetics-evidence-truncated"]').exists()).toBe(true);
  });

  it("labels the download as NDJSON", async () => {
    const w = mountPanel();
    await flushPromises();
    expect(w.find('[data-test="synthetics-evidence-download"]').text()).toContain(".ndjson");
  });
});
