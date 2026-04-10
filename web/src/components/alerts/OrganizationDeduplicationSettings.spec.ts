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

import { describe, expect, it, beforeEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { Dialog, Notify } from "quasar";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

installQuasar({ plugins: [Dialog, Notify] });

vi.mock("@/services/alerts", () => ({
  default: {
    getOrganizationDeduplicationConfig: vi.fn().mockResolvedValue({
      data: {
        enabled: true,
        alert_dedup_enabled: false,
        alert_fingerprint_groups: [],
        time_window_minutes: 30,
      },
    }),
    setOrganizationDeduplicationConfig: vi.fn().mockResolvedValue({ data: {} }),
    getSemanticGroups: vi.fn().mockResolvedValue({
      data: [
        { id: "group1", display: "Group 1", fields: ["host"], normalize: false },
        { id: "group2", display: "Group 2", fields: ["service"], normalize: false },
      ],
    }),
  },
}));

import OrganizationDeduplicationSettings from "@/components/alerts/OrganizationDeduplicationSettings.vue";
import alertsService from "@/services/alerts";

async function mountComp(props: Record<string, any> = {}) {
  return mount(OrganizationDeduplicationSettings, {
    props: {
      orgId: "default",
      config: null,
      ...props,
    },
    global: {
      plugins: [i18n, store],
      stubs: {
        GroupHeader: {
          template: '<div data-test="group-header-stub"></div>',
          props: ["title", "showIcon"],
        },
      },
    },
  });
}

describe("OrganizationDeduplicationSettings - rendering", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders without errors", async () => {
    const w = await mountComp();
    await flushPromises();
    expect(w.exists()).toBe(true);
  });

  it("renders the enable checkbox", async () => {
    const w = await mountComp();
    await flushPromises();
    expect(w.find('[data-test="organization-deduplication-enable-checkbox"]').exists()).toBe(true);
  });

  it("renders the refresh button", async () => {
    const w = await mountComp();
    await flushPromises();
    expect(w.find('[data-test="dedup-settings-refresh-btn"]').exists()).toBe(true);
  });

  it("calls getOrganizationDeduplicationConfig on mount when config is null", async () => {
    await mountComp();
    await flushPromises();
    expect(alertsService.getOrganizationDeduplicationConfig).toHaveBeenCalledWith("default");
  });

  it("calls getSemanticGroups on mount", async () => {
    await mountComp();
    await flushPromises();
    expect(alertsService.getSemanticGroups).toHaveBeenCalledWith("default");
  });

  it("does not call service when config prop is provided", async () => {
    vi.clearAllMocks();
    const config = { enabled: true, alert_dedup_enabled: false, alert_fingerprint_groups: [] };
    const w = await mountComp({ config });
    await flushPromises();
    expect(alertsService.getOrganizationDeduplicationConfig).not.toHaveBeenCalled();
  });
});

describe("OrganizationDeduplicationSettings - cross-alert checkbox visibility", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows cross-alert checkbox when enabled=true", async () => {
    const w = await mountComp();
    await flushPromises();
    (w.vm as any).localConfig.enabled = true;
    await w.vm.$nextTick();
    expect(
      w.find('[data-test="organizationdeduplication-enable-cross-alert-checkbox"]').exists(),
    ).toBe(true);
  });

  it("hides cross-alert checkbox when enabled=false", async () => {
    const w = await mountComp();
    await flushPromises();
    (w.vm as any).localConfig.enabled = false;
    await w.vm.$nextTick();
    expect(
      w.find('[data-test="organizationdeduplication-enable-cross-alert-checkbox"]').exists(),
    ).toBe(false);
  });
});

describe("OrganizationDeduplicationSettings - saveSettings", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls setOrganizationDeduplicationConfig on save", async () => {
    const w = await mountComp();
    await flushPromises();
    await (w.vm as any).saveSettings();
    await flushPromises();
    expect(alertsService.setOrganizationDeduplicationConfig).toHaveBeenCalledWith(
      "default",
      expect.any(Object),
    );
  });

  it("emits saved after successful save", async () => {
    const w = await mountComp();
    await flushPromises();
    await (w.vm as any).saveSettings();
    await flushPromises();
    expect(w.emitted("saved")).toBeTruthy();
  });

  it("validates: blocks save when cross-alert enabled but no fingerprint groups", async () => {
    const w = await mountComp();
    await flushPromises();
    (w.vm as any).localConfig.alert_dedup_enabled = true;
    (w.vm as any).localConfig.alert_fingerprint_groups = [];
    await (w.vm as any).saveSettings();
    await flushPromises();
    expect(alertsService.setOrganizationDeduplicationConfig).not.toHaveBeenCalled();
  });

  it("allows save when cross-alert enabled and fingerprint groups set", async () => {
    const w = await mountComp();
    await flushPromises();
    (w.vm as any).localConfig.alert_dedup_enabled = true;
    (w.vm as any).localConfig.alert_fingerprint_groups = ["group1"];
    await (w.vm as any).saveSettings();
    await flushPromises();
    expect(alertsService.setOrganizationDeduplicationConfig).toHaveBeenCalled();
  });

  it("sets saving to false after completion", async () => {
    const w = await mountComp();
    await flushPromises();
    await (w.vm as any).saveSettings();
    await flushPromises();
    expect((w.vm as any).saving).toBe(false);
  });
});

describe("OrganizationDeduplicationSettings - cancel", () => {
  it("emits cancel when cancel button is clicked", async () => {
    const w = await mountComp();
    await flushPromises();
    // Trigger cancel emit directly (button uses @click="$emit('cancel')")
    await w.vm.$emit("cancel");
    expect(w.emitted("cancel")).toBeTruthy();
  });
});

describe("OrganizationDeduplicationSettings - toggleFingerprintGroup", () => {
  beforeEach(() => vi.clearAllMocks());

  it("adds group to alert_fingerprint_groups when checked=true", async () => {
    const w = await mountComp();
    await flushPromises();
    (w.vm as any).localConfig.alert_fingerprint_groups = [];
    (w.vm as any).toggleFingerprintGroup("group1", true);
    expect((w.vm as any).localConfig.alert_fingerprint_groups).toContain("group1");
  });

  it("removes group from alert_fingerprint_groups when checked=false", async () => {
    const w = await mountComp();
    await flushPromises();
    (w.vm as any).localConfig.alert_fingerprint_groups = ["group1", "group2"];
    (w.vm as any).toggleFingerprintGroup("group1", false);
    expect((w.vm as any).localConfig.alert_fingerprint_groups).not.toContain("group1");
    expect((w.vm as any).localConfig.alert_fingerprint_groups).toContain("group2");
  });

  it("initializes alert_fingerprint_groups if undefined", async () => {
    const w = await mountComp();
    await flushPromises();
    (w.vm as any).localConfig.alert_fingerprint_groups = undefined;
    (w.vm as any).toggleFingerprintGroup("group1", true);
    expect((w.vm as any).localConfig.alert_fingerprint_groups).toContain("group1");
  });

  it("does not add duplicate group IDs", async () => {
    const w = await mountComp();
    await flushPromises();
    (w.vm as any).localConfig.alert_fingerprint_groups = ["group1"];
    (w.vm as any).toggleFingerprintGroup("group1", true);
    const groups = (w.vm as any).localConfig.alert_fingerprint_groups;
    expect(groups.filter((g: string) => g === "group1")).toHaveLength(1);
  });
});

describe("OrganizationDeduplicationSettings - watcher", () => {
  beforeEach(() => vi.clearAllMocks());

  it("syncs localConfig when config prop changes", async () => {
    const w = await mountComp();
    await flushPromises();
    await w.setProps({
      config: {
        enabled: false,
        alert_dedup_enabled: true,
        alert_fingerprint_groups: ["group1"],
        time_window_minutes: 60,
      },
    });
    await flushPromises();
    expect((w.vm as any).localConfig.enabled).toBe(false);
    expect((w.vm as any).localConfig.time_window_minutes).toBe(60);
  });
});

describe("OrganizationDeduplicationSettings - time_window sanitization", () => {
  beforeEach(() => vi.clearAllMocks());

  it("saves null when time_window_minutes is empty string", async () => {
    const w = await mountComp();
    await flushPromises();
    (w.vm as any).localConfig.time_window_minutes = "";
    await (w.vm as any).saveSettings();
    await flushPromises();
    const callArg = (alertsService.setOrganizationDeduplicationConfig as any).mock.calls[0][1];
    expect(callArg.time_window_minutes).toBeNull();
  });

  it("saves number when time_window_minutes is valid", async () => {
    const w = await mountComp();
    await flushPromises();
    (w.vm as any).localConfig.time_window_minutes = 45;
    await (w.vm as any).saveSettings();
    await flushPromises();
    const callArg = (alertsService.setOrganizationDeduplicationConfig as any).mock.calls[0][1];
    expect(callArg.time_window_minutes).toBe(45);
  });
});
