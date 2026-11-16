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
import { flushPromises, mount } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

vi.mock("vue-router", () => ({
  useRouter: () => ({
    resolve: vi.fn().mockReturnValue({ href: "/alerts/destinations" }),
    push: vi.fn(),
  }),
  useRoute: () => ({ params: {}, query: {} }),
}));

vi.mock("@/services/alert_templates", () => ({
  default: {
    list: vi.fn().mockResolvedValue({ data: [{ name: "ops-card", kind: "content" }] }),
  },
}));

import AnomalyAlerting from "@/components/anomaly_detection/steps/AnomalyAlerting.vue";
import templateService from "@/services/alert_templates";
import { SETTING_ROW_BARE_KEY } from "@/lib/core/SettingRow/OSettingRow.types";

const makeConfig = (overrides: Record<string, any> = {}) => ({
  alert_enabled: true,
  alert_destination_ids: [] as string[],
  ...overrides,
});

const makeDestinations = () => [
  { name: "slack-dest", type: "slack" },
  { name: "pagerduty-dest", type: "pagerduty" },
];

async function mountComp(props: Record<string, any> = {}, provide: Record<symbol, unknown> = {}) {
  return mount(AnomalyAlerting, {
    props: {
      config: makeConfig(),
      destinations: makeDestinations(),
      ...props,
    },
    global: { plugins: [i18n, store], provide },
  });
}

describe("AnomalyAlerting - rendering", () => {
  it("renders without errors", async () => {
    const w = await mountComp();
    expect(w.exists()).toBe(true);
  });

  it("renders the alert_enabled toggle", async () => {
    const w = await mountComp();
    expect(w.find('[data-test="anomaly-alert-enabled"]').exists()).toBe(true);
  });

  it("renders destination select when alert_enabled=true", async () => {
    const w = await mountComp({ config: makeConfig({ alert_enabled: true }) });
    expect(w.find('[data-test="anomaly-destination"]').exists()).toBe(true);
  });

  it("hides destination select when alert_enabled=false", async () => {
    const w = await mountComp({ config: makeConfig({ alert_enabled: false }) });
    expect(w.find('[data-test="anomaly-destination"]').exists()).toBe(false);
  });

  it("shows info note when alert_enabled=false", async () => {
    const w = await mountComp({ config: makeConfig({ alert_enabled: false }) });
    expect(w.text()).toContain("_anomalies");
  });

  it("notes that no destination is notified when alerting is on with none", async () => {
    const w = await mountComp({
      config: makeConfig({ alert_enabled: true, alert_destination_ids: [] }),
    });
    expect(w.find('[data-test="anomaly-destination-note"]').exists()).toBe(true);
    expect(w.text()).not.toContain("*");
  });

  it("swaps the note for where it sends once a destination is selected", async () => {
    const w = await mountComp({
      config: makeConfig({ alert_enabled: true, alert_destination_ids: ["slack-dest"] }),
    });
    expect(w.find('[data-test="anomaly-destination-note"]').exists()).toBe(false);
    expect(w.find('[data-test="anomaly-destination-status"]').text()).toContain("slack-dest");
  });
});

describe("AnomalyAlerting - destinations", () => {
  it("receives destinations as prop", async () => {
    const w = await mountComp();
    expect(w.props("destinations")).toHaveLength(2);
  });

  it("renders destination options from props", async () => {
    const w = await mountComp({ config: makeConfig({ alert_enabled: true }) });
    const selectEl = w.find('[data-test="anomaly-destination"]');
    expect(selectEl.exists()).toBe(true);
  });

  it("lists Jira destinations in the options", async () => {
    const w = await mountComp({
      destinations: [...makeDestinations(), { name: "jira-ops", destination_type_name: "jira" }],
    });
    const select = w
      .findAllComponents({ name: "OSelect" })
      .find((c) => c.attributes("data-test") === "anomaly-destination");
    expect(select?.props("options").map((d: { name: string }) => d.name)).toEqual([
      "slack-dest",
      "pagerduty-dest",
      "jira-ops",
    ]);
  });
});

describe("AnomalyAlerting - emits", () => {
  it("emits refresh:destinations when refresh button is clicked", async () => {
    const w = await mountComp({ config: makeConfig({ alert_enabled: true }) });
    // Find the refresh button (icon="refresh")
    const refreshBtn = w.find('button[title="Refresh destinations"]');
    if (refreshBtn.exists()) {
      await refreshBtn.trigger("click");
      expect(w.emitted("refresh:destinations")).toBeTruthy();
    }
  });
});

describe("AnomalyAlerting - openAddDestination", () => {
  it("openAddDestination calls window.open", async () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    const w = await mountComp({ config: makeConfig({ alert_enabled: true }) });
    (w.vm as any).openAddDestination();
    expect(openSpy).toHaveBeenCalled();
    openSpy.mockRestore();
  });
});

describe("AnomalyAlerting - direction and window share", () => {
  const t = (key: string, named: Record<string, unknown> = {}) => i18n.global.t(key, named);

  it("shows an unset direction as both, since NULL on the wire means both", async () => {
    const w = await mountComp({ config: makeConfig({ alert_direction: null }) });
    expect((w.vm as any).directionModel).toBe("both");
  });

  it("writes the chosen direction back into the config", async () => {
    const config = makeConfig({ alert_direction: "both" });
    const w = await mountComp({ config });
    (w.vm as any).directionModel = "above";
    expect(config.alert_direction).toBe("above");
  });

  it("does not restate the window share rule under its inputs", async () => {
    const w = await mountComp({ config: makeConfig({ alert_window_buckets: 5 }) });
    expect(w.find('[data-test="anomaly-window-share-hint"]').exists()).toBe(false);
  });

  it("flags a recover share above the fire share instead of stating the rule", async () => {
    const w = await mountComp({
      config: makeConfig({ alert_window_fire_pct: 50, alert_window_recover_pct: 60 }),
    });
    const errors = w.findAll('[data-test="anomaly-window-share-error"]');
    expect(errors.map((e) => e.text())).toEqual([t("alerts.anomaly.windowRecoverRange")]);
    expect(w.find('[data-test="anomaly-window-share-hint"]').exists()).toBe(false);
  });

  it("flags a bucket count below 1", async () => {
    const w = await mountComp({ config: makeConfig({ alert_window_buckets: 0 }) });
    expect(w.find('[data-test="anomaly-window-share-error"]').text()).toBe(
      t("alerts.anomaly.windowBucketsRange"),
    );
  });

  it("names the notifications switch after its row label and state", async () => {
    const w = await mountComp({ config: makeConfig({ alert_enabled: true }) });
    const btn = w.find('[role="switch"]');
    const name = btn
      .attributes("aria-labelledby")!
      .split(" ")
      .map((id) => w.find(`#${id}`).text())
      .join(" ");
    expect(name).toBe("Notifications Enabled");
  });
});

describe("AnomalyAlerting - template override", () => {
  it("lists anomaly templates and writes the pick to the config", async () => {
    const config = makeConfig({ template: null, template_error: "old" });
    const w = await mountComp({ config });
    await flushPromises();
    expect(templateService.list).toHaveBeenCalledWith(
      expect.objectContaining({ applies_to: "anomaly" }),
    );
    const picker = w.findComponent({ name: "TemplateOverridePicker" });
    await picker.vm.$emit("update:modelValue", "ops-card");
    expect(config.template).toBe("ops-card");
    expect(config.template_error).toBeNull();
  });

  it("hides the picker while notifications are off", async () => {
    const w = await mountComp({ config: makeConfig({ alert_enabled: false }) });
    expect(w.findComponent({ name: "TemplateOverridePicker" }).exists()).toBe(false);
  });
});

describe("AnomalyAlerting - setting rows", () => {
  const rowTests = [
    "anomaly-priority-row",
    "anomaly-tags-row",
    "anomaly-notifications-row",
    "anomaly-destination-row",
    "anomaly-template-row",
    "anomaly-alert-direction-row",
    "anomaly-window-share-row",
  ];

  it("lays every setting out as a flat row inside the sectioned editor", async () => {
    const w = await mountComp({}, { [SETTING_ROW_BARE_KEY]: true });
    const rows = w.findAll("[data-o-setting-row]");
    expect(rows.map((r) => r.attributes("data-test"))).toEqual(rowTests);
    expect(rows.every((r) => !r.classes().includes("border-b"))).toBe(true);
    expect(w.find(".step-content").classes()).not.toContain("border");
  });

  it("keeps its own card when rendered outside the sectioned editor", async () => {
    const w = await mountComp();
    expect(w.find(".step-content").classes()).toContain("border");
  });

  it("puts the three window share inputs in one row, each named for screen readers", async () => {
    const w = await mountComp();
    const row = w.find('[data-test="anomaly-window-share-row"]');
    const inputs = row.findAll("input");
    expect(inputs.map((i) => i.attributes("aria-label"))).toEqual([
      i18n.global.t("alerts.anomaly.windowBuckets"),
      i18n.global.t("alerts.anomaly.windowFirePct"),
      i18n.global.t("alerts.anomaly.windowRecoverPct"),
    ]);
    expect(row.text()).toContain(i18n.global.t("alerts.anomaly.windowBucketsPrefix"));
    expect(row.text()).toContain(i18n.global.t("alerts.anomaly.windowBucketsSuffix"));
  });

  it("writes a typed bucket count back into the config as a number", async () => {
    const config = makeConfig({ alert_window_buckets: 1 });
    const w = await mountComp({ config });
    await w.find('[data-test="anomaly-window-buckets"] input').setValue("4");
    expect(config.alert_window_buckets).toBe(4);
  });

  it("opens the destinations page from the add button", async () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    const w = await mountComp();
    await w.find('[data-test="anomaly-add-destination"]').trigger("click");
    expect(openSpy).toHaveBeenCalledWith("/alerts/destinations", "_blank");
    openSpy.mockRestore();
  });
});
