import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createStore } from "vuex";
import { createI18n } from "vue-i18n";
import ExternalAlertSourcesList from "./ExternalAlertSourcesList.vue";
import alertSources from "@/services/alert_sources";

vi.mock("@/services/alert_sources", () => ({
  default: {
    list: vi.fn(),
    listSenders: vi.fn(),
    setEnabled: vi.fn(),
    rotate: vi.fn(),
    create: vi.fn(),
  },
}));

vi.mock("@/utils/clipboard", () => ({
  copyToClipboard: vi.fn(),
}));

const DEFAULT_SOURCE = {
  id: "int-1",
  org_id: "myorg",
  name: "default",
  source_type: "auto",
  token: "o2iat_abcd1234efgh5678",
  enabled: true,
  config: {},
  created_by: "admin@example.com",
  created_at: 1,
  updated_at: 1,
  url: "/api/v2/myorg/incidents/events/o2iat_abcd1234efgh5678",
};

function buildWrapper() {
  const store = createStore({
    state: {
      selectedOrganization: { identifier: "myorg" },
      zoConfig: { incidents_enabled: true },
      userInfo: { email: "admin@example.com" },
      organizationData: { organizationPasscode: "passcode" },
      API_ENDPOINT: "http://localhost:5080",
    },
  });
  const i18n = createI18n({ legacy: false, locale: "en", messages: { en: {} } });
  return mount(ExternalAlertSourcesList, {
    global: { plugins: [store, i18n] },
  });
}

describe("ExternalAlertSourcesList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (alertSources.list as any).mockResolvedValue({
      data: { integrations: [DEFAULT_SOURCE] },
    });
    (alertSources.listSenders as any).mockResolvedValue({
      data: { senders: [] },
    });
  });

  it("fetches integrations and senders on mount", async () => {
    buildWrapper();
    await flushPromises();
    expect(alertSources.list).toHaveBeenCalledWith("myorg");
    expect(alertSources.listSenders).toHaveBeenCalledWith("myorg", "int-1");
  });

  it("masks the token by default", async () => {
    const wrapper = buildWrapper();
    await flushPromises();
    expect(wrapper.text()).not.toContain("abcd1234efgh5678");
    expect(wrapper.text()).toContain("****");
  });

  it("reveals the full token when reveal is toggled", async () => {
    const wrapper = buildWrapper();
    await flushPromises();
    await (wrapper.vm as any).toggleReveal();
    await flushPromises();
    expect(wrapper.text()).toContain("o2iat_abcd1234efgh5678");
  });

  it("copies the full URL via copyToClipboard", async () => {
    const { copyToClipboard } = await import("@/utils/clipboard");
    const wrapper = buildWrapper();
    await flushPromises();
    await (wrapper.vm as any).copyUrl();
    expect(copyToClipboard).toHaveBeenCalledWith(`http://localhost:5080${DEFAULT_SOURCE.url}`);
  });

  it("shows 'not_connected' status when no senders exist", async () => {
    const wrapper = buildWrapper();
    await flushPromises();
    expect((wrapper.vm as any).sourceStatuses).toEqual([]);
  });

  it("shows sender status rows derived from listSenders response", async () => {
    (alertSources.listSenders as any).mockResolvedValue({
      data: {
        senders: [
          {
            integration_id: "int-1",
            detected_source: "grafana",
            display_name: "grafana",
            first_received_at: 1,
            last_received_at: Date.now() * 1000,
            accepted_count: 5,
            rejected_count: 0,
            resolved_seen: false,
            resolve_wiring_hint: true,
          },
        ],
      },
    });
    const wrapper = buildWrapper();
    await flushPromises();
    expect((wrapper.vm as any).sourceStatuses.length).toBe(1);
    expect((wrapper.vm as any).sourceStatuses[0].displayName).toBe("grafana");
    expect((wrapper.vm as any).sourceStatuses[0].resolveWiringHint).toBe(true);
  });

  it("shows the sender's display_name instead of detected_source when present", async () => {
    (alertSources.listSenders as any).mockResolvedValue({
      data: {
        senders: [
          {
            integration_id: "int-1",
            detected_source: "generic",
            display_name: "solarwinds",
            first_received_at: 1,
            last_received_at: Date.now() * 1000,
            accepted_count: 5,
            rejected_count: 0,
            resolved_seen: false,
            resolve_wiring_hint: false,
          },
        ],
      },
    });
    const wrapper = buildWrapper();
    await flushPromises();
    expect((wrapper.vm as any).sourceStatuses[0].displayName).toBe("solarwinds");
    expect(wrapper.text()).toContain("solarwinds");
  });

  it("calls setEnabled with the inverse of current enabled state", async () => {
    const wrapper = buildWrapper();
    await flushPromises();
    (alertSources.setEnabled as any).mockResolvedValue({ data: {} });
    await (wrapper.vm as any).toggleEnabled();
    expect(alertSources.setEnabled).toHaveBeenCalledWith("myorg", "int-1", false);
  });

  it("advanced section is collapsed by default", async () => {
    const wrapper = buildWrapper();
    await flushPromises();
    expect((wrapper.vm as any).showAdvanced).toBe(false);
  });

  it("shows additional (non-default) integrations in the advanced table", async () => {
    (alertSources.list as any).mockResolvedValue({
      data: {
        integrations: [
          DEFAULT_SOURCE,
          { ...DEFAULT_SOURCE, id: "int-2", name: "grafana-staging", source_type: "grafana" },
        ],
      },
    });
    const wrapper = buildWrapper();
    await flushPromises();
    expect((wrapper.vm as any).additionalIntegrations.length).toBe(1);
    expect((wrapper.vm as any).additionalIntegrations[0].name).toBe("grafana-staging");
  });

  it("toggling showAddEditor shows the AddExternalAlertSource component", async () => {
    const wrapper = buildWrapper();
    await flushPromises();
    (wrapper.vm as any).showAdvanced = true;
    (wrapper.vm as any).showAddEditor = true;
    await flushPromises();
    expect(wrapper.findComponent({ name: "AddExternalAlertSource" }).exists()).toBe(true);
  });
});
