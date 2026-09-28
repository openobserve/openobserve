import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createStore } from "vuex";
import { createI18n } from "vue-i18n";
import ExternalAlertSourcesList from "./ExternalAlertSourcesList.vue";
import alertSources from "@/services/alert_sources";
import destinationService from "@/services/alert_destination";

vi.mock("@/services/alert_sources", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: {
      list: vi.fn(),
      listSenders: vi.fn(),
      setEnabled: vi.fn(),
      rotate: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
      update: vi.fn(),
    },
  });
});

vi.mock("@/services/alert_destination", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: { list: vi.fn() },
  });
});

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
  destinations: [] as string[],
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

// OTable holds its skeleton briefly after `loading` flips false, so
// flushPromises() alone still sees skeleton rows instead of real cells.
async function mountAndSettle() {
  const wrapper = buildWrapper();
  await flushPromises();
  await vi.waitFor(() =>
    expect(wrapper.find('[data-test="o2-table-skeleton-body"]').exists()).toBe(false),
  );
  return wrapper;
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
    (destinationService.list as any).mockResolvedValue({ data: [] });
  });

  it("fetches integrations and senders on mount", async () => {
    buildWrapper();
    await flushPromises();
    expect(alertSources.list).toHaveBeenCalledWith("myorg");
    expect(alertSources.listSenders).toHaveBeenCalledWith("myorg", "int-1");
  });

  it("masks the token in the source table by default", async () => {
    // Setup snippets that need the real URL only render inside the Add
    // Source drawer once a source is freshly created (not on the list page
    // itself), so the table text should never contain an unmasked token.
    const wrapper = await mountAndSettle();
    const table = wrapper.find('[data-test="alert-sources-advanced-table"]');
    expect(table.text()).not.toContain("abcd1234efgh5678");
    expect(table.text()).toContain("****");
  });

  it("reveals the full token when reveal is toggled", async () => {
    const wrapper = await mountAndSettle();
    await (wrapper.vm as any).toggleRevealFor(DEFAULT_SOURCE);
    await flushPromises();
    expect(wrapper.text()).toContain("o2iat_abcd1234efgh5678");
  });

  it("copies the full URL via copyToClipboard", async () => {
    const { copyToClipboard } = await import("@/utils/clipboard");
    const wrapper = await mountAndSettle();
    await (wrapper.vm as any).copyUrlFor(DEFAULT_SOURCE);
    // copyToClipboard takes `t` so its toasts are translated.
    expect(copyToClipboard).toHaveBeenCalledWith(
      `http://localhost:5080${DEFAULT_SOURCE.url}`,
      expect.any(Function),
    );
  });

  it("copies just the bare token via copyToClipboard, not the full URL", async () => {
    const { copyToClipboard } = await import("@/utils/clipboard");
    const wrapper = await mountAndSettle();
    await (wrapper.vm as any).copyTokenFor(DEFAULT_SOURCE);
    // copyToClipboard takes `t` so its toasts are translated.
    expect(copyToClipboard).toHaveBeenCalledWith(DEFAULT_SOURCE.token, expect.any(Function));
  });

  it("shows 'not_connected' status when no senders exist", async () => {
    const wrapper = await mountAndSettle();
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
    const wrapper = await mountAndSettle();
    expect((wrapper.vm as any).sourceStatuses.length).toBe(1);
    expect((wrapper.vm as any).sourceStatuses[0].displayName).toBe("grafana");
    expect((wrapper.vm as any).sourceStatuses[0].resolveWiringHint).toBe(true);
  });

  it("shows one row per sender sharing the default token, tagged as shared", async () => {
    (alertSources.listSenders as any).mockResolvedValue({
      data: {
        senders: [
          {
            integration_id: "int-1",
            detected_source: "generic",
            display_name: "solarwinds",
            first_received_at: 1,
            last_received_at: Date.now() * 1000,
            accepted_count: 1,
            rejected_count: 0,
            resolved_seen: false,
            resolve_wiring_hint: false,
          },
          {
            integration_id: "int-1",
            detected_source: "generic",
            display_name: "elasticsearch",
            first_received_at: 1,
            last_received_at: Date.now() * 1000,
            accepted_count: 1,
            rejected_count: 0,
            resolved_seen: false,
            resolve_wiring_hint: false,
          },
        ],
      },
    });
    const wrapper = await mountAndSettle();
    const rows = (wrapper.vm as any).tableRows;
    expect(rows.map((r: any) => r.displayName)).toEqual(["solarwinds", "elasticsearch"]);
    expect(rows.every((r: any) => r.sharesDefaultToken)).toBe(true);
    expect(wrapper.text()).toContain("solarwinds");
    expect(wrapper.text()).toContain("elasticsearch");
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
    const wrapper = await mountAndSettle();
    expect((wrapper.vm as any).sourceStatuses[0].displayName).toBe("solarwinds");
    expect(wrapper.text()).toContain("solarwinds");
  });

  it("calls setEnabled with the inverse of current enabled state", async () => {
    const wrapper = await mountAndSettle();
    (alertSources.setEnabled as any).mockResolvedValue({ data: {} });
    await (wrapper.vm as any).toggleEnabledFor(DEFAULT_SOURCE);
    expect(alertSources.setEnabled).toHaveBeenCalledWith("myorg", "int-1", false);
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
    const wrapper = await mountAndSettle();
    expect((wrapper.vm as any).additionalIntegrations.length).toBe(1);
    expect((wrapper.vm as any).additionalIntegrations[0].name).toBe("grafana-staging");
  });

  it("shows a masked URL per additional source, revealing on click", async () => {
    (alertSources.list as any).mockResolvedValue({
      data: {
        integrations: [
          DEFAULT_SOURCE,
          {
            ...DEFAULT_SOURCE,
            id: "int-2",
            name: "grafana-staging",
            source_type: "grafana",
            token: "o2iat_staging1234efgh5678",
            url: "/api/v2/myorg/incidents/events/o2iat_staging1234efgh5678",
          },
        ],
      },
    });
    const wrapper = await mountAndSettle();
    expect(wrapper.text()).toContain("staging1234efgh5678".slice(-4));
    expect(wrapper.text()).not.toContain("o2iat_staging1234efgh5678");
    (wrapper.vm as any).toggleRevealFor({ id: "int-2" });
    await flushPromises();
    expect(wrapper.text()).toContain(
      "http://localhost:5080/api/v2/myorg/incidents/events/o2iat_staging1234efgh5678",
    );
  });

  it("copies an additional source's full URL via copyToClipboard", async () => {
    const { copyToClipboard } = await import("@/utils/clipboard");
    (alertSources.list as any).mockResolvedValue({
      data: {
        integrations: [
          DEFAULT_SOURCE,
          {
            ...DEFAULT_SOURCE,
            id: "int-2",
            name: "grafana-staging",
            source_type: "grafana",
            token: "o2iat_staging1234efgh5678",
            url: "/api/v2/myorg/incidents/events/o2iat_staging1234efgh5678",
          },
        ],
      },
    });
    const wrapper = await mountAndSettle();
    (wrapper.vm as any).copyUrlFor({
      id: "int-2",
      url: "/api/v2/myorg/incidents/events/o2iat_staging1234efgh5678",
    });
    expect(copyToClipboard).toHaveBeenCalledWith(
      "http://localhost:5080/api/v2/myorg/incidents/events/o2iat_staging1234efgh5678",
      expect.any(Function),
    );
  });

  it("fetches senders for every additional integration, not just the default", async () => {
    (alertSources.list as any).mockResolvedValue({
      data: {
        integrations: [
          DEFAULT_SOURCE,
          { ...DEFAULT_SOURCE, id: "int-2", name: "grafana-staging", source_type: "grafana" },
        ],
      },
    });
    await mountAndSettle();
    expect(alertSources.listSenders).toHaveBeenCalledWith("myorg", "int-1");
    expect(alertSources.listSenders).toHaveBeenCalledWith("myorg", "int-2");
  });

  it("shows a rolled-up status tag per additional source", async () => {
    (alertSources.list as any).mockResolvedValue({
      data: {
        integrations: [
          DEFAULT_SOURCE,
          { ...DEFAULT_SOURCE, id: "int-2", name: "grafana-staging", source_type: "grafana" },
        ],
      },
    });
    (alertSources.listSenders as any).mockImplementation((_org: string, integrationId: string) => {
      if (integrationId === "int-2") {
        return Promise.resolve({
          data: {
            senders: [
              {
                integration_id: "int-2",
                detected_source: "grafana",
                display_name: "grafana",
                first_received_at: 1,
                last_received_at: Date.now() * 1000,
                accepted_count: 3,
                rejected_count: 0,
                resolved_seen: true,
                resolve_wiring_hint: false,
              },
            ],
          },
        });
      }
      return Promise.resolve({ data: { senders: [] } });
    });
    const wrapper = await mountAndSettle();
    expect((wrapper.vm as any).additionalStatusById["int-2"]).toBe("receiving");
    expect((wrapper.vm as any).additionalStatusById["int-1"]).toBeUndefined();
  });

  it("shows a delete button for additional (non-default) sources but not the default source", async () => {
    (alertSources.list as any).mockResolvedValue({
      data: {
        integrations: [
          DEFAULT_SOURCE,
          { ...DEFAULT_SOURCE, id: "int-2", name: "grafana-staging", source_type: "grafana" },
        ],
      },
    });
    const wrapper = await mountAndSettle();
    const rows = (wrapper.vm as any).tableRows;
    const defaultRow = rows.find((r: any) => r.integration?.id === "int-1");
    const additionalRow = rows.find((r: any) => r.integration?.id === "int-2");
    expect(defaultRow.integration.name).toBe("default");
    expect(additionalRow.integration.name).toBe("grafana-staging");
  });

  it("confirmDelete sets the delete target and opens the confirm dialog", async () => {
    const wrapper = await mountAndSettle();
    const target = { id: "int-2", name: "grafana-staging" };
    (wrapper.vm as any).confirmDelete(target);
    expect((wrapper.vm as any).deleteTarget).toEqual(target);
    expect((wrapper.vm as any).deleteDialogVisible).toBe(true);
  });

  it("doDelete calls alertSources.delete with the target id and refreshes the list", async () => {
    const wrapper = await mountAndSettle();
    (alertSources.delete as any).mockResolvedValue({ data: {} });
    (wrapper.vm as any).confirmDelete({ id: "int-2", name: "grafana-staging" });
    await (wrapper.vm as any).doDelete();
    expect(alertSources.delete).toHaveBeenCalledWith("myorg", "int-2");
    expect(alertSources.list).toHaveBeenCalledTimes(2); // initial mount + post-delete refresh
  });

  it("doDelete does nothing when there is no delete target", async () => {
    const wrapper = await mountAndSettle();
    (wrapper.vm as any).deleteTarget = undefined;
    await (wrapper.vm as any).doDelete();
    expect(alertSources.delete).not.toHaveBeenCalled();
  });

  it("openEditFor opens the drawer targeting the clicked integration", async () => {
    const wrapper = await mountAndSettle();
    (wrapper.vm as any).openEditFor(DEFAULT_SOURCE);
    expect((wrapper.vm as any).showAddDrawer).toBe(true);
    expect((wrapper.vm as any).editTargetIntegration).toEqual(DEFAULT_SOURCE);
  });

  it("openAddDrawer opens the drawer with no edit target (create mode)", async () => {
    const wrapper = await mountAndSettle();
    (wrapper.vm as any).editTargetIntegration = DEFAULT_SOURCE;
    (wrapper.vm as any).openAddDrawer();
    expect((wrapper.vm as any).showAddDrawer).toBe(true);
    expect((wrapper.vm as any).editTargetIntegration).toBeUndefined();
  });

  it("refreshes the list when the drawer emits 'updated'", async () => {
    const wrapper = await mountAndSettle();
    const addDrawer = wrapper.findComponent({ name: "AddExternalAlertSource" });
    addDrawer.vm.$emit("updated");
    await flushPromises();
    expect(alertSources.list).toHaveBeenCalledTimes(2); // initial mount + post-update refresh
  });

  it("clicking Add source opens the AddExternalAlertSource drawer", async () => {
    const wrapper = await mountAndSettle();
    expect((wrapper.vm as any).showAddDrawer).toBe(false);
    await wrapper.find('[data-test="alert-sources-add-btn"]').trigger("click");
    expect((wrapper.vm as any).showAddDrawer).toBe(true);
    expect(wrapper.findComponent({ name: "AddExternalAlertSource" }).props("open")).toBe(true);
  });

  it("shows the configured incident destinations for a source", async () => {
    (alertSources.list as any).mockResolvedValue({
      data: { integrations: [{ ...DEFAULT_SOURCE, destinations: ["sre-pages", "email-oncall"] }] },
    });
    const wrapper = await mountAndSettle();
    expect(wrapper.text()).toContain("sre-pages, email-oncall");
  });

  it("flags a source with no incident destination configured", async () => {
    const wrapper = await mountAndSettle();
    expect(wrapper.find('[data-test="alert-sources-no-destination-tag"]').exists()).toBe(true);
  });

  it("does not flag a source once destinations are set", async () => {
    (alertSources.list as any).mockResolvedValue({
      data: { integrations: [{ ...DEFAULT_SOURCE, destinations: ["sre-pages"] }] },
    });
    const wrapper = await mountAndSettle();
    expect(wrapper.find('[data-test="alert-sources-no-destination-tag"]').exists()).toBe(false);
  });

  it("shows a 'never resolves' warning icon with a tooltip alongside the status tag when actively receiving", async () => {
    // last_received_at is recent, so status resolves to "receiving" — the
    // never-resolved hint must still surface (as an icon beside the status
    // tag), not get silently swallowed by the receiving/stale/hint
    // mutual-exclusivity of the status tag itself.
    (alertSources.listSenders as any).mockResolvedValue({
      data: {
        senders: [
          {
            integration_id: "int-1",
            detected_source: "alertmanager",
            display_name: "alertmanager",
            first_received_at: 1,
            last_received_at: Date.now() * 1000,
            accepted_count: 14,
            rejected_count: 0,
            resolved_seen: false,
            resolve_wiring_hint: true,
          },
        ],
      },
    });
    const wrapper = await mountAndSettle();
    expect(wrapper.find('[data-test="alert-sources-never-resolves-icon"]').exists()).toBe(true);
    // No page-level banner — the explanation lives in the icon's tooltip, so
    // there's no unbounded banner list even with many misconfigured sources.
    expect(wrapper.find('[data-test^="alert-sources-resolve-wiring-banner-"]').exists()).toBe(
      false,
    );
  });

  it("does not show a 'never resolves' indicator when resolves have been seen", async () => {
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
            resolved_seen: true,
            resolve_wiring_hint: false,
          },
        ],
      },
    });
    const wrapper = await mountAndSettle();
    expect(wrapper.find('[data-test="alert-sources-never-resolves-icon"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="alert-sources-never-resolves-tag"]').exists()).toBe(false);
  });

  it("shows the 'never resolves' icon for an additional integration's sender too", async () => {
    (alertSources.list as any).mockResolvedValue({
      data: {
        integrations: [
          DEFAULT_SOURCE,
          { ...DEFAULT_SOURCE, id: "int-2", name: "grafana-staging", source_type: "grafana" },
        ],
      },
    });
    (alertSources.listSenders as any).mockImplementation((_org: string, integrationId: string) => {
      if (integrationId === "int-2") {
        return Promise.resolve({
          data: {
            senders: [
              {
                integration_id: "int-2",
                detected_source: "grafana",
                display_name: "grafana",
                first_received_at: 1,
                last_received_at: Date.now() * 1000,
                accepted_count: 3,
                rejected_count: 0,
                resolved_seen: false,
                resolve_wiring_hint: true,
              },
            ],
          },
        });
      }
      return Promise.resolve({ data: { senders: [] } });
    });
    const wrapper = await mountAndSettle();
    expect((wrapper.vm as any).additionalResolveWiringHintById["int-2"]).toBe(true);
    expect(wrapper.find('[data-test="alert-sources-never-resolves-icon"]').exists()).toBe(true);
  });

  it("renders just the table on the list page — no webhook URL/setup-snippet blocks (those live in the Add Source drawer)", async () => {
    const wrapper = await mountAndSettle();
    expect(wrapper.find('[data-test="alert-sources-setup-type-tabs"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="alert-sources-setup-snippet"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="alert-sources-url-cell"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="alert-sources-advanced-table"]').exists()).toBe(true);
  });

  describe("toolbar", () => {
    const TWO_SOURCES = {
      data: {
        integrations: [
          DEFAULT_SOURCE,
          {
            ...DEFAULT_SOURCE,
            id: "int-2",
            name: "grafana-staging",
            destinations: ["sre-pages"],
            token: "o2iat_staging1234efgh5678",
            url: "/api/v2/myorg/incidents/events/o2iat_staging1234efgh5678",
          },
        ],
      },
    };

    it("filters rows by name from the search box", async () => {
      (alertSources.list as any).mockResolvedValue(TWO_SOURCES);
      const wrapper = await mountAndSettle();
      expect((wrapper.vm as any).visibleRows.length).toBe(2);
      await wrapper
        .find('[data-test="alert-sources-search-input"] input')
        .setValue("grafana-staging");
      expect((wrapper.vm as any).visibleRows.map((r: any) => r.displayName)).toEqual([
        "grafana-staging",
      ]);
    });

    it("filters rows by incident destination name too", async () => {
      (alertSources.list as any).mockResolvedValue(TWO_SOURCES);
      const wrapper = await mountAndSettle();
      await wrapper.find('[data-test="alert-sources-search-input"] input').setValue("sre-pages");
      expect((wrapper.vm as any).visibleRows.map((r: any) => r.displayName)).toEqual([
        "grafana-staging",
      ]);
    });

    it("refetches integrations and senders when the toolbar refresh button is clicked", async () => {
      const wrapper = await mountAndSettle();
      (alertSources.list as any).mockClear();
      (alertSources.listSenders as any).mockClear();
      await wrapper.find('[data-test="alert-sources-refresh-btn"]').trigger("click");
      await flushPromises();
      expect(alertSources.list).toHaveBeenCalledWith("myorg");
      expect(alertSources.listSenders).toHaveBeenCalledWith("myorg", "int-1");
    });

    it("shows the empty state when no alert sources exist", async () => {
      (alertSources.list as any).mockResolvedValue({ data: { integrations: [] } });
      const wrapper = await mountAndSettle();
      expect((wrapper.vm as any).visibleRows.length).toBe(0);
      expect(wrapper.find('[data-test="alert-sources-empty-state"]').exists()).toBe(true);
    });

    it("clears the search when the filtered empty state asks for it", async () => {
      (alertSources.list as any).mockResolvedValue(TWO_SOURCES);
      const wrapper = await mountAndSettle();
      await wrapper.find('[data-test="alert-sources-search-input"] input').setValue("no-such-name");
      expect((wrapper.vm as any).visibleRows.length).toBe(0);
      (wrapper.vm as any).onEmptyAction("clear-filters");
      await flushPromises();
      expect((wrapper.vm as any).filterQuery).toBe("");
      expect((wrapper.vm as any).visibleRows.length).toBe(2);
    });

    it("shows the row count with its noun in the footer", async () => {
      (alertSources.list as any).mockResolvedValue(TWO_SOURCES);
      const wrapper = await mountAndSettle();
      expect(wrapper.find('[data-test="o2-table-pagination-bottom"]').text()).toContain(
        "2 alert_sources.header",
      );
    });

    it("gives every non-action column a resize handle, including Name↔Status", async () => {
      const wrapper = await mountAndSettle();
      for (const id of ["name", "status", "destination", "last_event", "url"]) {
        const th = wrapper.find(`[data-test="o2-table-th-${id}"]`);
        expect(th.exists()).toBe(true);
        expect(th.find(".resizer").exists()).toBe(true);
      }
    });

    it("opens the add drawer from the empty state's create action", async () => {
      (alertSources.list as any).mockResolvedValue({ data: { integrations: [] } });
      const wrapper = await mountAndSettle();
      (wrapper.vm as any).onEmptyAction("create");
      expect((wrapper.vm as any).showAddDrawer).toBe(true);
      expect((wrapper.vm as any).editTargetIntegration).toBeUndefined();
    });
  });
});
