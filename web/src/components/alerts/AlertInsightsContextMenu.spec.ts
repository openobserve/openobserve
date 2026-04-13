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

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { Dialog, Notify } from "quasar";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

installQuasar({ plugins: [Dialog, Notify] });

import AlertInsightsContextMenu from "@/components/alerts/AlertInsightsContextMenu.vue";

const alertNamePanelId = "Panel_Alert_Frequency";
const nonAlertPanelId  = "Panel_Volume_Chart";

const defaultProps = {
  x: 100,
  y: 200,
  value: "my-alert",
  panelTitle: "Alert Frequency",
  panelId: alertNamePanelId,
};

async function mountComp(props: Record<string, any> = {}) {
  return mount(AlertInsightsContextMenu, {
    props: { ...defaultProps, ...props },
    global: { plugins: [i18n, store] },
    attachTo: document.body,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AlertInsightsContextMenu - rendering", () => {
  it("renders the context menu wrapper", async () => {
    const w = await mountComp();
    expect(w.find('[data-test="alert-insights-context-menu"]').exists()).toBe(true);
  });

  it("positions via x and y props (inline style)", async () => {
    const w = await mountComp({ x: 150, y: 300 });
    const style = w.find('[data-test="alert-insights-context-menu"]').attributes("style");
    expect(style).toContain("top: 300px");
    expect(style).toContain("left: 150px");
  });

  it("shows alert-specific menu items when isAlertNameContext=true", async () => {
    const w = await mountComp({ value: "my-alert", panelId: alertNamePanelId });
    expect(w.find('[data-test="context-menu-configure-dedup"]').exists()).toBe(true);
    expect(w.find('[data-test="context-menu-edit-alert"]').exists()).toBe(true);
    expect(w.find('[data-test="context-menu-view-history"]').exists()).toBe(true);
    expect(w.find('[data-test="context-menu-cancel"]').exists()).toBe(true);
  });

  it("shows panel title in header when not alert name context", async () => {
    const w = await mountComp({ value: 42, panelId: nonAlertPanelId });
    expect(w.text()).toContain("Alert Frequency");
  });

  it("shows value in header when isAlertNameContext=true", async () => {
    const w = await mountComp({ value: "my-alert", panelId: alertNamePanelId });
    expect(w.text()).toContain("my-alert");
  });
});

describe("AlertInsightsContextMenu - isAlertNameContext computed", () => {
  it("returns true for Panel_Alert_Frequency with string value", async () => {
    const w = await mountComp({ value: "alert-a", panelId: "Panel_Alert_Frequency" });
    expect((w.vm as any).isAlertNameContext).toBe(true);
  });

  it("returns true for Panel_Dedup_Impact with string value", async () => {
    const w = await mountComp({ value: "alert-b", panelId: "Panel_Dedup_Impact" });
    expect((w.vm as any).isAlertNameContext).toBe(true);
  });

  it("returns true for Panel_Alert_Correlation with string value", async () => {
    const w = await mountComp({ value: "alert-c", panelId: "Panel_Alert_Correlation" });
    expect((w.vm as any).isAlertNameContext).toBe(true);
  });

  it("returns false for numeric value (even with alert panel id)", async () => {
    const w = await mountComp({ value: 123, panelId: alertNamePanelId });
    expect((w.vm as any).isAlertNameContext).toBe(false);
  });

  it("returns false for non-alert panel id with string value", async () => {
    const w = await mountComp({ value: "my-alert", panelId: nonAlertPanelId });
    expect((w.vm as any).isAlertNameContext).toBe(false);
  });
});

describe("AlertInsightsContextMenu - action clicks", () => {
  it("clicking configure-dedup emits configure-dedup and close", async () => {
    const w = await mountComp({ value: "my-alert", panelId: alertNamePanelId });
    await w.find('[data-test="context-menu-configure-dedup"]').trigger("click");
    expect(w.emitted("configure-dedup")).toBeTruthy();
    expect(w.emitted("configure-dedup")![0]).toEqual(["my-alert"]);
    expect(w.emitted("close")).toBeTruthy();
  });

  it("clicking edit-alert emits edit-alert and close", async () => {
    const w = await mountComp({ value: "my-alert", panelId: alertNamePanelId });
    await w.find('[data-test="context-menu-edit-alert"]').trigger("click");
    expect(w.emitted("edit-alert")).toBeTruthy();
    expect(w.emitted("edit-alert")![0]).toEqual(["my-alert"]);
    expect(w.emitted("close")).toBeTruthy();
  });

  it("clicking view-history emits view-history and close", async () => {
    const w = await mountComp({ value: "my-alert", panelId: alertNamePanelId });
    await w.find('[data-test="context-menu-view-history"]').trigger("click");
    expect(w.emitted("view-history")).toBeTruthy();
    expect(w.emitted("view-history")![0]).toEqual(["my-alert"]);
    expect(w.emitted("close")).toBeTruthy();
  });

  it("clicking cancel emits close", async () => {
    const w = await mountComp({ value: "my-alert", panelId: alertNamePanelId });
    await w.find('[data-test="context-menu-cancel"]').trigger("click");
    expect(w.emitted("close")).toBeTruthy();
  });
});

describe("AlertInsightsContextMenu - keyboard / outside click", () => {
  it("Escape key triggers close emit", async () => {
    const w = await mountComp();
    const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true });
    document.dispatchEvent(event);
    expect(w.emitted("close")).toBeTruthy();
    w.unmount();
  });

  it("click outside triggers close emit", async () => {
    const w = await mountComp();
    document.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(w.emitted("close")).toBeTruthy();
    w.unmount();
  });

  it("removes listeners on unmount (no duplicate fire)", async () => {
    const w = await mountComp();
    w.unmount();
    // Dispatching after unmount should not throw
    document.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
});
