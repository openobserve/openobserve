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
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";


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

// The component OWNS its <OForm> (Rule ③ owner pattern) — the single source of
// truth is the TanStack form on the OForm instance. Drive behavior through it.
const getForm = (w: any) => (w.findComponent({ name: "OForm" }).vm as any).form;

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
    await mountComp({ config });
    await flushPromises();
    expect(alertsService.getOrganizationDeduplicationConfig).not.toHaveBeenCalled();
  });
});

describe("OrganizationDeduplicationSettings - cross-alert checkbox visibility", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows cross-alert checkbox when enabled=true", async () => {
    const w = await mountComp();
    await flushPromises();
    getForm(w).setFieldValue("enabled", true);
    await flushPromises();
    expect(
      w.find('[data-test="organizationdeduplication-enable-cross-alert-checkbox"]').exists(),
    ).toBe(true);
  });

  it("hides cross-alert checkbox when enabled=false", async () => {
    const w = await mountComp();
    await flushPromises();
    getForm(w).setFieldValue("enabled", false);
    await flushPromises();
    expect(
      w.find('[data-test="organizationdeduplication-enable-cross-alert-checkbox"]').exists(),
    ).toBe(false);
  });
});

describe("OrganizationDeduplicationSettings - save (real OForm submit)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls setOrganizationDeduplicationConfig on a valid submit", async () => {
    const w = await mountComp();
    await flushPromises();
    await getForm(w).handleSubmit();
    await flushPromises();
    expect(alertsService.setOrganizationDeduplicationConfig).toHaveBeenCalledWith(
      "default",
      expect.any(Object),
    );
  });

  it("emits saved after a successful save", async () => {
    const w = await mountComp();
    await flushPromises();
    await getForm(w).handleSubmit();
    await flushPromises();
    expect(w.emitted("saved")).toBeTruthy();
  });

  it("blocks save when cross-alert enabled but no fingerprint groups (superRefine restore)", async () => {
    const w = await mountComp();
    await flushPromises();
    const form = getForm(w);
    form.setFieldValue("enabled", true);
    form.setFieldValue("alert_dedup_enabled", true);
    form.setFieldValue("alert_fingerprint_groups", []);
    await flushPromises();
    await form.handleSubmit();
    await flushPromises();
    expect(form.state.isValid).toBe(false);
    expect(alertsService.setOrganizationDeduplicationConfig).not.toHaveBeenCalled();
  });

  it("allows save when cross-alert enabled and fingerprint groups set", async () => {
    const w = await mountComp();
    await flushPromises();
    const form = getForm(w);
    form.setFieldValue("enabled", true);
    form.setFieldValue("alert_dedup_enabled", true);
    form.setFieldValue("alert_fingerprint_groups", ["group1"]);
    await flushPromises();
    await form.handleSubmit();
    await flushPromises();
    expect(alertsService.setOrganizationDeduplicationConfig).toHaveBeenCalled();
  });
});

describe("OrganizationDeduplicationSettings - cancel", () => {
  it("emits cancel when cancel is triggered", async () => {
    const w = await mountComp();
    await flushPromises();
    await w.vm.$emit("cancel");
    expect(w.emitted("cancel")).toBeTruthy();
  });
});

describe("OrganizationDeduplicationSettings - fingerprint groups", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders a checkbox per semantic group when cross-alert dedup is on", async () => {
    const w = await mountComp();
    await flushPromises();
    getForm(w).setFieldValue("alert_dedup_enabled", true);
    await flushPromises();
    expect(
      w.find('[data-test="organizationdeduplication-fingerprint-group1-checkbox"]').exists(),
    ).toBe(true);
    expect(
      w.find('[data-test="organizationdeduplication-fingerprint-group2-checkbox"]').exists(),
    ).toBe(true);
  });
});

describe("OrganizationDeduplicationSettings - external prop sync", () => {
  beforeEach(() => vi.clearAllMocks());

  it("resets the form from the config prop when it changes", async () => {
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
    const form = getForm(w);
    expect(form.state.values.enabled).toBe(false);
    expect(form.state.values.time_window_minutes).toBe(60);
  });
});

describe("OrganizationDeduplicationSettings - time_window sanitization (payload parity)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("saves null when time_window_minutes is empty", async () => {
    const w = await mountComp();
    await flushPromises();
    const form = getForm(w);
    form.setFieldValue("time_window_minutes", "");
    await flushPromises();
    await form.handleSubmit();
    await flushPromises();
    const callArg = (alertsService.setOrganizationDeduplicationConfig as any).mock.calls[0][1];
    expect(callArg.time_window_minutes).toBeNull();
  });

  it("saves the number when time_window_minutes is valid", async () => {
    const w = await mountComp();
    await flushPromises();
    const form = getForm(w);
    form.setFieldValue("time_window_minutes", 45);
    await flushPromises();
    await form.handleSubmit();
    await flushPromises();
    const callArg = (alertsService.setOrganizationDeduplicationConfig as any).mock.calls[0][1];
    expect(callArg.time_window_minutes).toBe(45);
  });
});
