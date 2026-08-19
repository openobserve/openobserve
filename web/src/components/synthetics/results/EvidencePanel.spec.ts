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
import EvidencePanel from "./EvidencePanel.vue";
import EvidenceEvents from "./EvidenceEvents.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
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
    // JSON.parse on the whole payload throws: the bundle is one object per line,
    // not an array.
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
  // The panel no longer fetches; the composable does. It receives events.
  //
  // NDJSON's four lines all sit on s19, so a fifth on another step is added
  // here — without it, "filtered to s19" and "the whole run" are the same set
  // and the narrowing assertion below would pass on a broken filter.
  const OTHER_STEP =
    '{"ts":1785356287000,"kind":"response","method":"GET","url":"https://o2.example.dev/api/late","status":404,"initiated_ts":1785356286900,"first_party":true,"step_id":"fa1"}';

  // No step_id at all — the "not attributed to a step" case.
  const UNATTRIBUTED_EVENT =
    '{"ts":1785356287500,"kind":"console","level":"error","text":"orphan"}';

  const named = () =>
    parseEvidenceNdjson(`${NDJSON}\n${OTHER_STEP}`).map((e) => ({
      ...e,
      stepName: e.stepId ? STEP_DEFS.get(e.stepId)?.name || e.stepId : null,
    }));

  const namedWithUnattributed = () =>
    parseEvidenceNdjson(`${NDJSON}\n${OTHER_STEP}\n${UNATTRIBUTED_EVENT}`).map((e) => ({
      ...e,
      stepName: e.stepId ? STEP_DEFS.get(e.stepId)?.name || e.stepId : null,
    }));

  // Mirrors STEP_DEFS's two steps (s19, fa1) plus a third that never runs, so
  // "steps with zero events are omitted" has something to omit.
  const STEP_OPTIONS = [
    { stepId: "s19", number: 19, name: "Navigate to /web/login" },
    { stepId: "fa1", number: 20, name: 'Assert visible [data-test="element-that-never-exists"]' },
  ];

  const mountPanel = (props: Record<string, unknown> = {}) =>
    mount(EvidencePanel, {
      props: {
        evidenceKey: "synthetics/org/mon/RUN/EXEC/attempt-1-evidence.ndjson",
        stepDefs: STEP_DEFS,
        events: named(),
        status: "ready",
        error: null,
        truncated: false,
        stepFilter: null,
        stepOptions: STEP_OPTIONS,
        ...props,
      },
      global: { plugins: [i18n] },
    });

  it("renders ONE table, with kind as a column rather than as a section", () => {
    // Four tables bought four pagination bars, four column grids and four
    // restarting timelines to say what the view toggle already says.
    const w = mountPanel();
    expect(w.find('[data-test="synthetics-evidence-panel"]').exists()).toBe(true);
    expect(w.findAllComponents(EvidenceEvents)).toHaveLength(1);
    expect(
      new Set(w.findAll('[data-test="synthetics-evidence-events-type"]').map((b) => b.text())),
    ).toEqual(new Set(["Network", "Console"]));
  });

  it("orders the whole list by time, so a page error does not jump the queue", () => {
    // One table means one timeline; a timeline out of time order is not one.
    const w = mountPanel({
      events: parseEvidenceNdjson(
        [
          '{"ts":3,"kind":"response","status":200,"initiated_ts":3}',
          '{"ts":1,"kind":"response","status":200,"initiated_ts":1}',
          '{"ts":2,"kind":"pageerror","message":"boom"}',
        ].join("\n"),
      ),
    });
    expect(w.findAll('[data-test="synthetics-evidence-events-type"]').map((b) => b.text())).toEqual(
      ["Network", "Page error", "Network"],
    );
  });

  it("narrows the list to first-party without moving the view counts", async () => {
    // A checkbox narrows what is shown, never what the attempt contained.
    const w = mountPanel();
    const before = w.find('[data-test="synthetics-evidence-filter-all"]').text();
    w.findComponent(OCheckbox).vm.$emit("update:modelValue", true);
    await w.vm.$nextTick();
    // The one third-party row is gone from the list...
    expect(w.findAll('[data-test="synthetics-evidence-events-row"]')).toHaveLength(4);
    // ...but the tally still describes the attempt.
    expect(w.find('[data-test="synthetics-evidence-filter-all"]').text()).toBe(before);
  });

  it("shows which step each row belongs to", () => {
    const w = mountPanel();
    expect(w.find('[data-test="synthetics-evidence-events-step"]').text()).toContain(
      "Navigate to /web/login",
    );
  });

  it("offers exactly All, Network and Console", () => {
    const w = mountPanel();
    expect(
      w
        .findAll('[data-test^="synthetics-evidence-filter-"]')
        .map((t) => t.attributes("data-test")?.replace("synthetics-evidence-filter-", "")),
    ).toEqual(["all", "network", "console"]);
  });

  it("badges every option with its own count", () => {
    // 4 events on s19 plus 1 on fa1: 4 network responses, 1 console error.
    const w = mountPanel();
    expect(w.find('[data-test="synthetics-evidence-filter-all"]').text()).toContain("5");
    expect(w.find('[data-test="synthetics-evidence-filter-network"]').text()).toContain("4");
    expect(w.find('[data-test="synthetics-evidence-filter-console"]').text()).toContain("1");
  });

  it("keeps a zero-count option visible rather than hiding it", () => {
    // A hidden zero is indistinguishable from an option that does not exist, and
    // "nothing on the console" is information.
    const w = mountPanel({ events: named().filter((e) => e.kind !== "console") });
    expect(w.find('[data-test="synthetics-evidence-filter-console"]').text()).toContain("0");
  });

  it("narrows both the rows and the badge counts to the filtered step", () => {
    // A badge that counts the whole run while the list shows one step is a lie.
    const all = mountPanel();
    const scoped = mountPanel({ stepFilter: "s19" });
    expect(scoped.find('[data-test="synthetics-evidence-filter-all"]').text()).not.toBe(
      all.find('[data-test="synthetics-evidence-filter-all"]').text(),
    );
    expect(scoped.findComponent(OSelect).props("modelValue")).toBe("s19");
  });

  // D6: the step scope is a control the reader can change, not a caption they
  // can only dismiss — so a select replaces the old banner+Clear pair.
  it("renders a step-filter select instead of a dismissible banner", () => {
    const unfiltered = mountPanel();
    expect(unfiltered.find('[data-test="synthetics-evidence-step-filter"]').exists()).toBe(true);
    expect(unfiltered.findComponent(OBanner).exists()).toBe(false);

    const scoped = mountPanel({ stepFilter: "s19" });
    expect(scoped.findComponent(OBanner).exists()).toBe(false);
  });

  it("lists only steps that own at least one event, in stepOptions order", () => {
    const w = mountPanel({
      stepOptions: [...STEP_OPTIONS, { stepId: "zz9", number: 5, name: "Never reached" }],
    });
    const options = w.findComponent(OSelect).props("options") as { value: unknown }[];
    // "All steps" first, then s19 and fa1 (both own events, journey order),
    // never zz9 — a journey has ~13 steps and most own nothing.
    expect(options.map((o) => o.value)).toEqual([null, "s19", "fa1"]);
  });

  it("labels each step option with its number, name and its own event count", () => {
    const w = mountPanel();
    const options = w.findComponent(OSelect).props("options") as {
      value: unknown;
      label: string;
    }[];
    expect(options[0]).toMatchObject({ value: null, label: "All steps (5)" });
    expect(options.find((o) => o.value === "s19")?.label).toBe("19 · Navigate to /web/login (4)");
    expect(options.find((o) => o.value === "fa1")?.label).toBe(
      '20 · Assert visible [data-test="element-that-never-exists"] (1)',
    );
  });

  it("emits update:stepFilter with the chosen step's id", async () => {
    const w = mountPanel();
    await w.findComponent(OSelect).vm.$emit("update:modelValue", "fa1");
    expect(w.emitted("update:stepFilter")?.[0]).toEqual(["fa1"]);
  });

  it("emits update:stepFilter(null) when All steps is chosen", async () => {
    const w = mountPanel({ stepFilter: "s19" });
    await w.findComponent(OSelect).vm.$emit("update:modelValue", null);
    expect(w.emitted("update:stepFilter")?.[0]).toEqual([null]);
  });

  it("emits update:stepFilter(null) when the table's own clear-filters fires", async () => {
    // EvidenceEvents' empty-state "clear filters" action used to clear the
    // banner; it now goes through the same v-model as the select.
    const w = mountPanel({ stepFilter: "s19" });
    await w.findComponent(EvidenceEvents).vm.$emit("clear-filters");
    expect(w.emitted("update:stepFilter")?.[0]).toEqual([null]);
  });

  it("offers an unattributed option only when such events exist", () => {
    const optionsOf = (w: ReturnType<typeof mountPanel>) =>
      w.findComponent(OSelect).props("options") as { value: unknown; label: string }[];

    expect(optionsOf(mountPanel()).some((o) => o.value === "__unattributed__")).toBe(false);

    const withOrphan = optionsOf(mountPanel({ events: namedWithUnattributed() }));
    expect(withOrphan.find((o) => o.value === "__unattributed__")?.label).toBe(
      "Not attributed to a step (1)",
    );
  });

  it("scopes the list to events with no step when the unattributed option is active", () => {
    const w = mountPanel({ events: namedWithUnattributed(), stepFilter: "__unattributed__" });
    expect(w.findAll('[data-test="synthetics-evidence-events-row"]')).toHaveLength(1);
    expect(w.find('[data-test="synthetics-evidence-filter-all"]').text()).toContain("1");
  });

  it("reports a failed load instead of rendering a quiet run", () => {
    const w = mountPanel({ status: "error", error: "403 Forbidden", events: [] });
    expect(w.find('[data-test="synthetics-evidence-error"]').text()).toContain("403");
  });

  it("asks the owner to retry rather than refetching itself", async () => {
    const w = mountPanel({ status: "error", error: "403 Forbidden", events: [] });
    await w.find('[data-test="synthetics-evidence-retry-btn"]').trigger("click");
    expect(w.emitted("retry")).toBeTruthy();
  });

  it("distinguishes capture-off from not-kept from absent", () => {
    const off = mountPanel({ evidenceKey: null, captureOff: true });
    expect(off.find('[data-test="synthetics-evidence-empty"]').text()).toContain("capture is off");

    const passed = mountPanel({ evidenceKey: null, runPassed: true });
    expect(passed.find('[data-test="synthetics-evidence-empty"]').text()).toContain(
      "failed runs only",
    );

    const none = mountPanel({ evidenceKey: null });
    expect(none.find('[data-test="synthetics-evidence-empty"]').text()).toContain(
      "No evidence bundle",
    );
  });

  it("states truncation rather than showing a quietly short list", () => {
    const w = mountPanel({ truncated: true });
    expect(w.find('[data-test="synthetics-evidence-truncated"]').exists()).toBe(true);
  });

  it("offers a wrap toggle", () => {
    const w = mountPanel();
    expect(w.find('[data-test="synthetics-evidence-wrap-btn"]').exists()).toBe(true);
  });

  it("wraps the table only once the toggle is on", async () => {
    const w = mountPanel();
    expect(w.findComponent(EvidenceEvents).props("wrap")).toBe(false);
    await w.find('[data-test="synthetics-evidence-wrap-btn"]').trigger("click");
    expect(w.findComponent(EvidenceEvents).props("wrap")).toBe(true);
  });
});

describe("EvidencePanel view filter", () => {
  const named = () =>
    parseEvidenceNdjson(NDJSON).map((e) => ({
      ...e,
      stepName: e.stepId ? STEP_DEFS.get(e.stepId)?.name || e.stepId : null,
    }));

  const mountPanel = (props: Record<string, unknown> = {}) =>
    mount(EvidencePanel, {
      props: {
        evidenceKey: "k",
        stepDefs: STEP_DEFS,
        events: named(),
        status: "ready",
        error: null,
        ...props,
      },
      global: { plugins: [i18n] },
    });

  /** Which kinds the single table is currently showing. */
  const kinds = (w: ReturnType<typeof mountPanel>) =>
    new Set(w.findAll('[data-test="synthetics-evidence-events-type"]').map((b) => b.text()));

  it("narrows the list to the chosen surface", async () => {
    const w = mountPanel();
    await w.find('[data-test="synthetics-evidence-filter-console"]').trigger("click");
    await w.vm.$nextTick();
    expect(kinds(w)).toEqual(new Set(["Console"]));
  });

  it("keeps the selection when the active option is clicked again", async () => {
    // OToggleGroup can deselect on re-click. It must not here: an empty
    // selection would blank the row and silently show everything, a state the
    // group has no way to render.
    const w = mountPanel();
    const consoleOption = '[data-test="synthetics-evidence-filter-console"]';
    await w.find(consoleOption).trigger("click");
    await w.vm.$nextTick();
    await w.find(consoleOption).trigger("click");
    await w.vm.$nextTick();
    expect(kinds(w)).toEqual(new Set(["Console"]));
  });

  it("returns to the whole attempt when All is chosen", async () => {
    const w = mountPanel();
    await w.find('[data-test="synthetics-evidence-filter-console"]').trigger("click");
    await w.vm.$nextTick();
    await w.find('[data-test="synthetics-evidence-filter-all"]').trigger("click");
    await w.vm.$nextTick();
    expect(kinds(w)).toEqual(new Set(["Network", "Console"]));
  });

  it("keeps failed requests under Network and page errors under Console", async () => {
    // The two that matter most used to sit in filters of their own, away from
    // the surface they belong to.
    const w = mountPanel({
      events: parseEvidenceNdjson(
        [
          '{"ts":1,"kind":"pageerror","message":"boom"}',
          '{"ts":2,"kind":"requestfailed","url":"https://o2.example.dev/api/x"}',
        ].join("\n"),
      ),
    });
    await w.find('[data-test="synthetics-evidence-filter-network"]').trigger("click");
    await w.vm.$nextTick();
    expect(kinds(w)).toEqual(new Set(["Failed req."]));

    await w.find('[data-test="synthetics-evidence-filter-console"]').trigger("click");
    await w.vm.$nextTick();
    expect(kinds(w)).toEqual(new Set(["Page error"]));
  });

  it("says the view is empty rather than rendering nothing", async () => {
    const w = mountPanel({
      events: parseEvidenceNdjson('{"ts":1,"kind":"response","status":200}'),
    });
    await w.find('[data-test="synthetics-evidence-filter-console"]').trigger("click");
    await w.vm.$nextTick();
    // The table's own empty state now carries this — one table, one empty case.
    expect(w.findComponent(OEmptyState).exists()).toBe(true);
    expect(kinds(w).size).toBe(0);
  });
});
