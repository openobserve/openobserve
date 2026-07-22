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

import { describe, it, expect, vi, afterEach } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import en from "@/locales/languages/en-US.json";
import AlertSettingsHelpDrawer from "@/components/alerts/AlertSettingsHelpDrawer.vue";

vi.mock("@/utils/clipboard", () => ({ copyToClipboard: vi.fn() }));

const i18n = createI18n({ legacy: false, locale: "en", messages: { en } });

function mountDrawer(props: Record<string, any>): VueWrapper {
  return mount(AlertSettingsHelpDrawer, {
    props: { open: true, topic: "template", ...props },
    global: {
      plugins: [i18n],
      stubs: {
        // Stub ODrawer to render its default slot inline so we can query the body.
        ODrawer: { template: "<div><slot /></div>" },
        OSeparator: true,
        OSelect: {
          props: ["modelValue", "options"],
          emits: ["update:modelValue"],
          template: "<select />",
        },
        OButton: { template: "<button><slot /></button>" },
      },
    },
  });
}

describe("AlertSettingsHelpDrawer", () => {
  let w: VueWrapper;

  afterEach(() => {
    w?.unmount();
    vi.clearAllMocks();
  });

  it("renders the current section for topic=template", () => {
    w = mountDrawer({ topic: "template" });
    expect(w.find('[data-test="help-current-section"]').exists()).toBe(true);
  });

  it("lists destinations, their template names, and renders each current body when no override is set", async () => {
    w = mountDrawer({
      topic: "template",
      currentTemplate: "",
      selectedDestinations: ["slack-dest", "pd-dest"],
      destinations: [
        // name form: template body resolved from the templates list
        { name: "slack-dest", template: "slack-tpl" },
        // object form: template carries its own body inline
        { name: "pd-dest", template: { name: "pd-tpl", body: "PD: {alert_name}" } },
      ],
      templates: [{ name: "slack-tpl", body: "Slack alert {alert_name}" }],
      facts: { alert_name: "High CPU" },
    });

    // The watcher fires on open: true at mount — but snapshotDestinations is
    // set at that point. Toggle open to force the watcher to re-snapshot with
    // the destinations already in place.
    await w.setProps({ open: false });
    await w.setProps({ open: true });

    const rows = w.findAll('[data-test="help-destination-row"]');
    expect(rows).toHaveLength(2);
    expect(rows[0].text()).toContain("slack-dest");
    expect(rows[0].text()).toContain("slack-tpl");
    expect(rows[1].text()).toContain("pd-dest");
    expect(rows[1].text()).toContain("pd-tpl");

    // Each destination renders its CURRENT template body (the comparison the
    // user asked for), with the alert_name substituted as live data.
    const previews = w.findAll('[data-test="help-destination-preview"]');
    expect(previews).toHaveLength(2);
    // body resolved from the templates list (name form):
    expect(previews[0].text()).toContain("Slack alert High CPU");
    // body taken from the inline template object (object form):
    expect(previews[1].text()).toContain("PD: High CPU");
  });

  it("hides the built-in variables list until the user expands it (no upfront wall of 18 chips)", () => {
    w = mountDrawer({ topic: "variables" });
    // collapsed by default
    expect(w.findAll('[data-test="help-builtin-var"]').length).toBe(0);
    expect(w.find('[data-test="help-builtin-list"]').exists()).toBe(false);
    // toggle present and labeled
    expect(w.find('[data-test="help-builtin-toggle"]').exists()).toBe(true);
  });

  it("resolves every component it renders (no unregistered-component import bug)", () => {
    // Regression guard: the built-in disclosure renders <OIcon>; if its import
    // is dropped, Vue emits a 'Failed to resolve component' warning at runtime.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // Don't auto-stub OIcon — let it resolve from the real import.
    const wrapper = mount(AlertSettingsHelpDrawer, {
      props: { open: true, topic: "variables" },
      global: {
        plugins: [i18n],
        stubs: { ODrawer: { template: "<div><slot /></div>" } },
      },
    });
    const unresolved = warn.mock.calls
      .map((c) => String(c[0]))
      .filter((m) => /Failed to resolve component/.test(m));
    expect(unresolved).toEqual([]);
    warn.mockRestore();
    wrapper.unmount();
  });

  it("renders the built-in variable chips once expanded, including {alert_name}", async () => {
    w = mountDrawer({ topic: "variables" });
    await w.find('[data-test="help-builtin-toggle"]').trigger("click");
    const chips = w.findAll('[data-test="help-builtin-var"]');
    expect(chips.length).toBeGreaterThan(10);
    expect(chips.some((c) => c.text() === "{alert_name}")).toBe(true);
  });

  it("does NOT advertise {alert_agg_value} (server never substitutes it)", async () => {
    // Regression: this is a phantom variable; offering it would send literal
    // '{alert_agg_value}' to the destination.
    w = mountDrawer({ topic: "variables" });
    await w.find('[data-test="help-builtin-toggle"]').trigger("click");
    const chips = w.findAll('[data-test="help-builtin-var"]');
    expect(chips.some((c) => c.text() === "{alert_agg_value}")).toBe(false);
    // and it should advertise the real {alert_description}
    expect(chips.some((c) => c.text() === "{alert_description}")).toBe(true);
  });

  it("teaches the WHY with a before/after comparison", () => {
    w = mountDrawer({ topic: "variables" });
    const why = w.find('[data-test="help-why"]');
    expect(why.exists()).toBe(true);
    expect(why.text()).toContain((en as any).alerts.alertSettings.helpWhyWithoutLabel);
    expect(why.text()).toContain((en as any).alerts.alertSettings.helpWhyWithLabel);
    // the "with a variable" side shows a real {placeholder}, not empty i18n
    expect(why.text()).toContain("{severity}");
    expect(why.text()).toContain("{team}");
  });

  it("shows a concrete worked example with the rendered result for topic=variables", () => {
    w = mountDrawer({ topic: "variables" });
    const ex = w.find('[data-test="help-example"]');
    expect(ex.exists()).toBe(true);
    // template references a built-in and the user's variables
    expect(ex.text()).toContain("{alert_name}");
    expect(ex.text()).toContain("{severity}");
    expect(ex.text()).toContain("{team}");
    // and shows what actually gets sent (input -> result), with vars filled in
    expect(ex.text()).toContain((en as any).alerts.alertSettings.helpExampleResultLabel);
    expect(ex.text()).toContain("Owned by payments");
  });

  it("explains WHEN to override on the template panel", () => {
    w = mountDrawer({ topic: "template" });
    const note = w.find('[data-test="help-template-when"]');
    expect(note.exists()).toBe(true);
    expect(note.text()).toContain((en as any).alerts.alertSettings.helpTemplateWhenHeading);
  });

  it("teaches WHY a row template + a compose example on the rowTemplate panel", () => {
    w = mountDrawer({ topic: "rowTemplate" });
    const why = w.find('[data-test="help-row-why"]');
    expect(why.exists()).toBe(true);
    expect(why.text()).toContain((en as any).alerts.alertSettings.helpRowTemplateWhyHeading);

    const ex = w.find('[data-test="help-row-example"]');
    expect(ex.exists()).toBe(true);
    // the compose example shows a per-row format and the main template's {rows}
    expect(ex.text()).toContain("{pod}");
    expect(ex.text()).toContain("{rows}");
    expect(ex.text()).toContain("{alert_count}");
  });

  it("shows empty-state text when contextAttributes is empty", () => {
    w = mountDrawer({ topic: "variables", contextAttributes: [] });
    expect(w.find('[data-test="help-your-variables"]').text()).toContain(
      (en as any).alerts.alertSettings.helpYourVariablesEmpty,
    );
  });

  it("treats blank-key variable rows as empty (no stray {} row)", () => {
    // The form often carries a blank starter row; it must NOT render as "{}".
    w = mountDrawer({
      topic: "variables",
      contextAttributes: [{ id: "1", key: "", value: "" }],
    });
    const section = w.find('[data-test="help-your-variables"]');
    expect(section.text()).toContain((en as any).alerts.alertSettings.helpYourVariablesEmpty);
    expect(section.text()).not.toContain("{}");
  });

  it("renders only the non-blank variables a user actually added", () => {
    w = mountDrawer({
      topic: "variables",
      contextAttributes: [
        { id: "1", key: "service", value: "checkout" },
        { id: "2", key: "", value: "" },
      ],
    });
    const section = w.find('[data-test="help-your-variables"]');
    expect(section.text()).toContain("{service}");
    expect(section.text()).toContain("checkout");
    expect(section.text()).not.toContain("{}");
  });

  it("renders {your_name} literally in the explain text (no broken i18n interpolation)", () => {
    w = mountDrawer({ topic: "variables" });
    // Regression: vue-i18n was eating {your_name} as an interpolation slot,
    // rendering 'write  anywhere in the template'. The literal must show.
    expect(w.text()).toContain("{your_name}");
  });

  it("emits apply:template and update:open=false when applyTemplate is called", async () => {
    w = mountDrawer({
      topic: "template",
      currentTemplate: "",
      templates: [{ name: "tpl-a", body: "hello {alert_name}" }],
    });

    // previewTemplate and applyTemplate are exposed via defineExpose
    (w.vm as any).previewTemplate = "tpl-a";
    await w.vm.$nextTick();

    // The Apply button must show the resolved i18n string, not a raw key —
    // guards against referencing a key that doesn't exist in en.json.
    const applyBtn = w.find('[data-test="help-apply-template-btn"]');
    expect(applyBtn.exists()).toBe(true);
    expect(applyBtn.text()).toBe((en as any).alerts.alertSettings.helpApplyToAlert);
    expect(applyBtn.text()).not.toContain("alertSettings.help");

    await (w.vm as any).applyTemplate();

    expect(w.emitted("apply:template")?.[0]).toEqual(["tpl-a"]);
    expect(w.emitted("update:open")?.at(-1)).toEqual([false]);
  });

  it("legend explains the preview with a title and concrete examples (not abstract 'Aa')", () => {
    // currentTemplate set so a preview (and thus the legend) is shown.
    w = mountDrawer({
      topic: "template",
      currentTemplate: "tpl-a",
      templates: [{ name: "tpl-a", body: "Alert {alert_name}" }],
    });
    const legend = w.find('[data-test="help-legend"]');
    expect(legend.exists()).toBe(true);
    expect(legend.text()).toContain((en as any).alerts.alertSettings.helpLegendTitle);
    // concrete, self-explanatory swatches — not the old abstract "Aa"
    expect(legend.text()).toContain("High CPU");
    expect(legend.text()).toContain("{rows}");
    expect(legend.text()).not.toContain("Aa");
  });

  it("shows the current row-template type in a readable labeled badge", () => {
    w = mountDrawer({ topic: "rowTemplate", rowTemplateType: "Json" });
    const row = w.find('[data-test="help-row-template-type"]');
    expect(row.exists()).toBe(true);
    expect(row.text()).toContain((en as any).alerts.alertSettings.helpRowTemplateTypeCurrent);
    expect(row.text()).toContain("Json");
  });

  it("hides the legend entirely when there is no preview to explain", () => {
    // rowTemplate empty → no rendered preview → legend must not appear.
    w = mountDrawer({ topic: "rowTemplate", rowTemplate: "" });
    expect(w.find('[data-test="help-legend"]').exists()).toBe(false);
  });

  // ── Empty-state coverage: no section should render a blank preview box ──

  it("rowTemplate panel shows guidance (not a blank box) when no row template is set", () => {
    w = mountDrawer({ topic: "rowTemplate", rowTemplate: "" });
    expect(w.find('[data-test="help-row-preview-empty"]').exists()).toBe(true);
    expect(w.find('[data-test="help-row-preview-empty"]').text()).toBe(
      (en as any).alerts.alertSettings.helpRowTemplatePreviewEmpty,
    );
    // no empty <pre> preview box left on screen
    // only the worked-example blocks (row code, main code, rendered result) —
    // no empty preview box for the absent row template.
    expect(w.findAll("pre.preview-box").length).toBe(3);
  });

  it("rowTemplate panel renders the preview box when a row template IS set", () => {
    w = mountDrawer({ topic: "rowTemplate", rowTemplate: "row: {alert_name}" });
    expect(w.find('[data-test="help-row-preview-empty"]').exists()).toBe(false);
  });

  it("template panel prompts to pick a template when none is selected (no blank box)", () => {
    w = mountDrawer({ topic: "template", currentTemplate: "", templates: [] });
    expect(w.find('[data-test="help-preview-select-empty"]').exists()).toBe(true);
    expect(w.find('[data-test="help-apply-template-btn"]').exists()).toBe(false);
  });

  it("never renders an empty preview box anywhere in any panel", async () => {
    for (const topic of ["template", "variables", "rowTemplate"] as const) {
      w = mountDrawer({ topic, currentTemplate: "", rowTemplate: "" });
      await w.vm.$nextTick();
      const emptyPre = w.findAll("pre.preview-box").filter((p) => p.text().trim() === "");
      expect(emptyPre.length).toBe(0);
      w.unmount();
    }
  });
});
