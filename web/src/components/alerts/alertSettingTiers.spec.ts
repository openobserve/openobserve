// Copyright 2026 OpenObserve Inc.

import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import i18n from "@/locales";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import { defineComponent, h, nextTick, provide, ref } from "vue";
import AlertTierLinks from "./AlertTierLinks.vue";
import AlertTierPlace from "./AlertTierPlace.vue";
import {
  ALERT_SETTING_TIERS_KEY,
  useAlertSettingTiers,
} from "@/composables/alerts/useAlertSettingTiers";
import {
  ALERT_SETTING_TIERS,
  alertTierContext,
  isTierVisible,
  sectionPlacementOrder,
  sectionTierView,
  tierApplies,
  tierAvailable,
  tierIsSet,
  type AlertSettingId,
  type AlertTierContext,
  type AlertTierState,
  type AlertTierValues,
} from "./alertSettingTiers";
import type { AlertSectionId } from "./alertFormSections";

const ctx = (over: Partial<AlertTierContext> = {}): AlertTierContext => ({
  kind: "scheduled",
  shape: "filters",
  aggregate: false,
  incidentsEnabled: false,
  oncallEnabled: false,
  suppressRepeatsEnabled: false,
  ...over,
});

const state = (c: AlertTierContext, over: Partial<AlertTierState> = {}): AlertTierState => ({
  available: (id) => tierAvailable(id, c),
  isSet: () => false,
  revealed: new Set<AlertSettingId>(),
  showAll: false,
  expanded: () => false,
  ...over,
});

const ALL_ON = { incidentsEnabled: true, oncallEnabled: true, suppressRepeatsEnabled: true };
const SECTIONS: AlertSectionId[] = ["watch", "condition", "notify", "schedule", "details"];

describe("sectionTierView: the More options line per mockup screen", () => {
  it.each<[string, AlertSectionId, Partial<AlertTierContext>, AlertSettingId[]]>([
    ["A2 filters", "condition", {}, ["holdFor", "generatedSql"]],
    ["B0/B1 SQL", "condition", { shape: "sql" }, ["holdFor", "compareWithPast", "vrl"]],
    ["DRY-C2 PromQL", "condition", { shape: "promql" }, ["holdFor", "ruleExpression"]],
    [
      "filters, aggregate",
      "condition",
      { aggregate: true },
      ["holdFor", "generatedSql", "groupBy"],
    ],
    ["A3 notify", "notify", ALL_ON, ["recovery", "keepFiring", "suppressRepeats", "oncall"]],
    ["A5 details", "details", {}, ["tags", "priority"]],
    [
      "E1 anomaly",
      "condition",
      { kind: "anomaly", shape: "anomaly" },
      ["anomalyDirection", "anomalyWindow", "anomalySqlPreview"],
    ],
    [
      "E1b anomaly notify",
      "notify",
      { kind: "anomaly", shape: "anomaly", ...ALL_ON },
      ["anomalyRecordOnly"],
    ],
    [
      "E1c anomaly details",
      "details",
      { kind: "anomaly", shape: "anomaly" },
      ["anomalyTags", "anomalyPriority"],
    ],
    [
      "E2 composite",
      "condition",
      { kind: "composite", shape: "composite" },
      ["compositeWarningCounts", "compositeStalePolicy", "holdFor"],
    ],
    ["real-time condition", "condition", { kind: "realtime" }, []],
    ["A4 schedule", "schedule", {}, []],
  ])("%s", (_name, section, over, expected) => {
    expect(sectionTierView(section, state(ctx(over))).more.map((d) => d.id)).toEqual(expected);
  });

  it("lists every unset setting on the line, never cutting it (Review Focus 4)", () => {
    expect(sectionTierView("notify", state(ctx(ALL_ON))).more).toHaveLength(4);
  });
});

describe("AlertTierLinks: the More options line names every unset rare setting", () => {
  it.each<[string, Partial<AlertTierContext>, AlertSettingId[]]>([
    ["filters", {}, []],
    ["filters, aggregate, Must last set", { aggregate: true }, ["holdFor"]],
    ["SQL", { shape: "sql" }, []],
    ["PromQL", { shape: "promql" }, []],
    ["real-time", { kind: "realtime" }, []],
    ["anomaly", { kind: "anomaly", shape: "anomaly" }, []],
    ["composite, tags set", { kind: "composite", shape: "composite" }, ["tags"]],
  ])("%s", (_name, over, set) => {
    const c = ctx({ ...over, ...ALL_ON });
    for (const section of SECTIONS) {
      const unset = ALERT_SETTING_TIERS.filter(
        (d) =>
          d.section === section &&
          d.tier !== "add" &&
          tierAvailable(d.id, c) &&
          !set.includes(d.id),
      );
      const view = sectionTierView(section, state(c, { isSet: (id) => set.includes(id) }));
      const wrapper = mount(AlertTierLinks, {
        props: { section, view },
        global: { plugins: [i18n] },
      });
      const names = wrapper.find(`[data-test="add-alert-section-${section}-more-names"]`);
      expect(names.exists()).toBe(unset.length > 0);
      if (!unset.length) continue;
      expect(wrapper.get(`[data-test="add-alert-section-${section}-more"]`).text()).toContain(
        `(${unset.length})`,
      );
      for (const d of unset) expect(names.text()).toContain(i18n.global.t(d.nameKey));
      for (const id of set) expect(view.more.map((d) => d.id)).not.toContain(id);
      expect(names.text()).not.toMatch(/…|\+\d+ more/);
      expect(names.findComponent(OTruncatedText).exists()).toBe(false);
      wrapper.unmount();
    }
  });
});

describe("AlertTierLinks: rows open below the line", () => {
  it("More options renders exactly the listed rows, in order, after the toggle", async () => {
    const c = ctx({ shape: "promql" });
    const Host = defineComponent({
      setup() {
        const tiers = useAlertSettingTiers({
          available: (id) => tierAvailable(id, c),
          isSet: () => false,
          showAll: ref(false),
        });
        provide(ALERT_SETTING_TIERS_KEY, tiers);
        // Rows sit above the line at home, in the opposite order to the line.
        return () =>
          h("div", [
            ...(["ruleExpression", "holdFor"] as AlertSettingId[]).map((id) =>
              h(AlertTierPlace, { id }, () =>
                tiers.isVisible(id) ? [h("div", { "data-row": id })] : [],
              ),
            ),
            h(AlertTierLinks, {
              section: "condition",
              view: tiers.view("condition"),
              onToggle: () => tiers.toggle("condition"),
            }),
          ]);
      },
    });
    const wrapper = mount(Host, { global: { plugins: [i18n] }, attachTo: document.body });
    const listed = sectionTierView("condition", state(c)).more.map((d) => d.id);
    await wrapper.get('[data-test="add-alert-section-condition-more"]').trigger("click");
    await nextTick();
    const toggle = wrapper.get('[data-test="add-alert-section-condition-more"]').element;
    const rows = [...wrapper.element.querySelectorAll("[data-row]")];
    expect(rows.map((r) => r.getAttribute("data-row"))).toEqual(listed);
    for (const row of rows) {
      expect(toggle.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    wrapper.unmount();
  });
});

describe("tier rules", () => {
  it("offers Show generated SQL only for Filters", () => {
    for (const shape of ["sql", "promql", "anomaly", "composite"] as const) {
      expect(tierAvailable("generatedSql", ctx({ shape }))).toBe(false);
    }
    expect(tierAvailable("generatedSql", ctx())).toBe(true);
  });

  it("with Show all, no section has links and every available setting shows", () => {
    for (const over of [
      {},
      { shape: "sql" as const },
      { kind: "anomaly" as const, shape: "anomaly" as const },
    ]) {
      const c = ctx({ ...over, ...ALL_ON });
      const s = state(c, { showAll: true });
      for (const section of SECTIONS) {
        expect(sectionTierView(section, s)).toEqual({ addLinks: [], more: [], expanded: true });
      }
      for (const d of ALERT_SETTING_TIERS.filter((x) => tierAvailable(x.id, c))) {
        expect(isTierVisible(d.id, s)).toBe(true);
      }
    }
  });

  it("a set or revealed setting shows and leaves its link and the line", () => {
    for (const over of [
      { isSet: (id: AlertSettingId) => id === "holdFor" },
      { revealed: new Set<AlertSettingId>(["holdFor", "warning"]) },
    ]) {
      const s = state(ctx(), over);
      const view = sectionTierView("condition", s);
      expect(view.more.map((d) => d.id)).not.toContain("holdFor");
      expect(isTierVisible("holdFor", s)).toBe(true);
    }
    expect(isTierVisible("holdFor", state(ctx()))).toBe(false);
  });

  it("an expanded section shows its rare settings but keeps its + links", () => {
    const s = state(ctx(), { expanded: (section) => section === "condition" });
    expect(isTierVisible("holdFor", s)).toBe(true);
    expect(isTierVisible("warning", s)).toBe(false);
    expect(sectionTierView("condition", s).addLinks.map((d) => d.id)).toContain("warning");
  });

  it.each<[AlertSettingId, Partial<AlertTierContext>, AlertTierValues]>([
    [
      "ruleExpression",
      { shape: "promql" },
      { form: { _ui: { forecast: { U: "up" } } }, anomaly: null },
    ],
    [
      "anomalySqlPreview",
      { kind: "anomaly", shape: "anomaly" },
      { form: {}, anomaly: { query_mode: "custom_sql" } },
    ],
    [
      "anomalyTemplate",
      { kind: "anomaly", shape: "anomaly" },
      { form: {}, anomaly: { alert_enabled: false } },
    ],
  ])("%s leaves the line while the setting that replaces its row is set", (id, over, values) => {
    const c = ctx(over);
    expect(tierApplies(id, c, { form: {}, anomaly: values.anomaly && {} })).toBe(true);
    expect(tierApplies(id, c, values)).toBe(false);
  });

  it("lists Generated SQL only once the builder has a query to show", () => {
    expect(tierAvailable("generatedSql", ctx({ generatedSql: false }))).toBe(false);
  });

  it.each<[string, Partial<AlertTierContext>, AlertSectionId]>([
    ["filters", { aggregate: true }, "condition"],
    ["composite", { kind: "composite", shape: "composite" }, "condition"],
    ["notify", ALL_ON, "notify"],
  ])(
    "rows brought below the %s line take the More options order, then the + rows",
    (_n, over, section) => {
      const s = state(ctx({ ...over, ...ALL_ON }));
      const more = sectionTierView(section, s).more.map((d) => d.id);
      const order = sectionPlacementOrder(section, s);
      expect(order.slice(0, more.length)).toEqual(more);
      expect(
        order
          .slice(more.length)
          .every((id) => ALERT_SETTING_TIERS.find((d) => d.id === id)?.tier === "add"),
      ).toBe(true);
    },
  );

  it("every smart setting has a name for the More options line", () => {
    for (const d of ALERT_SETTING_TIERS.filter((x) => x.tier === "smart")) {
      expect(d.nameKey).toMatch(/^alerts\.tiers\.names\./);
    }
  });
});

describe("alertTierContext", () => {
  it.each<[string, string | undefined, Pick<AlertTierContext, "kind" | "shape">]>([
    ["false", "custom", { kind: "scheduled", shape: "filters" }],
    ["false", "sql", { kind: "scheduled", shape: "sql" }],
    ["false", "promql", { kind: "scheduled", shape: "promql" }],
    ["true", "sql", { kind: "realtime", shape: "filters" }],
    ["anomaly", undefined, { kind: "anomaly", shape: "anomaly" }],
    ["composite", "custom", { kind: "composite", shape: "composite" }],
  ])("is_real_time %s, type %s", (isRealTime, queryType, expected) => {
    expect(alertTierContext({ isRealTime, queryType, aggregate: false, ...ALL_ON })).toMatchObject(
      expected,
    );
  });
});

describe("tierIsSet", () => {
  const v = (form: AlertTierValues["form"], anomaly: AlertTierValues["anomaly"] = null) => ({
    form,
    anomaly,
  });
  it.each<[AlertSettingId, AlertTierValues, boolean]>([
    ["holdFor", v({ pending_period_sec: 600 }), true],
    ["holdFor", v({ pending_period_sec: 0 }), false],
    ["keepFiring", v({ keep_firing_for: 45 }), true],
    ["cron", v({ trigger_condition: { frequency_type: "cron" } }), true],
    ["cron", v({ trigger_condition: { frequency_type: "minutes" } }), false],
    ["vrl", v({ query_condition: { vrl_function: "LiAuCg==" } }), true],
    ["anomalyRecordOnly", v({}, { alert_enabled: false }), true],
    ["anomalyRecordOnly", v({}, null), false],
    ["anomalyWindow", v({}, { alert_window_buckets: 1, alert_window_fire_pct: 100 }), false],
    ["anomalyWindow", v({}, { alert_window_buckets: 3, alert_window_fire_pct: 100 }), true],
    [
      "compositeStalePolicy",
      v({ composite_condition: { stale_child_policy: "treat_as_false" } }),
      true,
    ],
    [
      "compositeStalePolicy",
      v({ composite_condition: { stale_child_policy: "use_last_state" } }),
      false,
    ],
  ])("%s %#", (id, values, expected) => {
    expect(tierIsSet(id, values)).toBe(expected);
  });
});
