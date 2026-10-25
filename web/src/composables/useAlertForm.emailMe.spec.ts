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

import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AddAlert from "@/components/alerts/AddAlert.vue";
import alertsService from "@/services/alerts";
import destinationService from "@/services/alert_destination";
import settingsService from "@/services/settings";
import { toast } from "@/lib/feedback/Toast/useToast";
import { queryClient } from "@/composables/query/queryClient";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import i18n from "@/locales";

vi.mock("@/composables/useStreams", () => ({
  default: () => ({
    getStream: vi.fn().mockResolvedValue({ schema: [{ name: "field1", type: "string" }] }),
    getStreams: vi.fn().mockResolvedValue({ list: [] }),
  }),
}));

vi.mock("@/composables/useFunctions", () => ({
  default: () => ({ getAllFunctions: vi.fn().mockResolvedValue({ functions: [] }) }),
}));

vi.mock("@/composables/useParser", () => ({
  default: () => ({
    sqlParser: async () => ({
      astify: vi.fn(() => ({ columns: [] })),
      parse: vi.fn(),
      sqlify: vi.fn(),
    }),
  }),
}));

vi.mock("@/utils/zincutils", async () => {
  const actual: any = await vi.importActual("@/utils/zincutils");
  return {
    ...actual,
    getUUID: vi.fn(() => "mock-uuid"),
    getTimezonesByOffset: vi.fn(() => Promise.resolve(["UTC"])),
  } as any;
});

vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: vi.fn(() => vi.fn()) }));

vi.mock("@/services/alerts", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: {
      create_by_alert_id: vi.fn(() => Promise.resolve({ data: { code: 200 } })),
      update_by_alert_id: vi.fn(() => Promise.resolve({ data: { success: true } })),
      listByFolderId: vi.fn(() => Promise.resolve({ data: { list: [] } })),
    },
  });
});

vi.mock("@/services/alert_destination", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: { list: vi.fn(), create: vi.fn(), testSend: vi.fn() },
  });
});

vi.mock("@/services/settings", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), { default: { getSetting: vi.fn() } });
});

vi.mock("@/services/product_analytics", () => ({ default: { track: vi.fn() } }));
vi.mock("@/services/reodotdev_analytics", () => ({ useReo: () => ({ track: vi.fn() }) }));

const ME = "example@gmail.com";
const EMAIL_ME = `email-${ME}`;

const stubs = {
  QueryConfig: true,
  AlertSettings: true,
  CompareWithPast: true,
  Deduplication: true,
  Advanced: true,
  PreviewAlert: true,
  AlertSummary: true,
  AnomalyDetectionConfig: true,
  AnomalyAlerting: true,
  AnomalySummary: true,
  AnomalyDataPreview: true,
  JsonEditor: true,
  InlineSelectFolderDropdown: true,
  OPageHeader: true,
};

const mountAlert = (props: Record<string, any> = {}) =>
  mount(AddAlert, {
    global: { provide: { store }, plugins: [i18n, router], stubs },
    props,
  });

const seedValidScheduled = (form: any) => {
  form.setFieldValue("name", "test_alert");
  form.setFieldValue("stream_type", "logs");
  form.setFieldValue("stream_name", "_rundata");
  form.setFieldValue("query_condition.type", "custom");
  form.setFieldValue("trigger_condition", {
    period: 10,
    operator: ">=",
    frequency: 10,
    cron: "",
    threshold: 3,
    silence: 10,
    frequency_type: "minutes",
    timezone: "UTC",
  });
};

const orgHas = (list: any[]) => (destinationService.list as any).mockResolvedValue({ data: list });
const defaultIs = (destination: string | null) =>
  (settingsService.getSetting as any).mockImplementation(() =>
    destination === null
      ? Promise.reject({ response: { status: 404 } })
      : Promise.resolve({ data: { setting_value: { destination } } }),
  );
const savedPayload = () => (alertsService.create_by_alert_id as any).mock.calls[0][1];

describe("useAlertForm: who a new alert notifies", () => {
  let wrapper: any;

  beforeEach(() => {
    store.state.zoConfig.smtp_enabled = true;
    orgHas([]);
    defaultIs(null);
    (destinationService.create as any).mockResolvedValue({ data: {} });
    (destinationService.testSend as any).mockResolvedValue({ data: {} });
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    queryClient.clear();
    delete store.state.zoConfig.smtp_enabled;
    vi.clearAllMocks();
  });

  describe("preselection", () => {
    it("pre-selects Email me on a new alert in an org with no destinations", async () => {
      wrapper = mountAlert();
      await flushPromises();

      expect(wrapper.vm.form.state.values.destinations).toEqual([EMAIL_ME]);
      expect(wrapper.vm.getFormattedDestinations).toContainEqual({
        label: i18n.global.t("alerts.alertSettings.emailMeOption", { address: ME }),
        value: EMAIL_ME,
      });
    });

    it("pre-selects the org default destination when one is set", async () => {
      orgHas([{ name: "team-slack", type: "http" }]);
      defaultIs("team-slack");
      wrapper = mountAlert({ destinations: [{ name: "team-slack" }] });
      await flushPromises();

      expect(wrapper.vm.form.state.values.destinations).toEqual(["team-slack"]);
    });

    it("leaves the field empty when the org already has destinations", async () => {
      orgHas([{ name: "team-slack", type: "http" }]);
      wrapper = mountAlert();
      await flushPromises();

      expect(wrapper.vm.form.state.values.destinations).toEqual([]);
    });

    it("leaves the field empty when SMTP is off", async () => {
      store.state.zoConfig.smtp_enabled = false;
      wrapper = mountAlert();
      await flushPromises();

      expect(wrapper.vm.form.state.values.destinations).toEqual([]);
    });

    it("hands the field its resolver and the failure to show", async () => {
      wrapper = mountAlert();
      await flushPromises();

      const settings = wrapper.findComponent({ name: "AlertSettings" });
      expect(settings.props("resolveDestinations")).toBe(wrapper.vm.resolveEmailMe);
      expect(settings.props("emailMeError")).toBe("");
    });

    it("never adds a recipient when editing", async () => {
      defaultIs("team-slack");
      orgHas([{ name: "team-slack", type: "http" }]);
      wrapper = mountAlert({
        isUpdated: true,
        modelValue: { name: "existing", destinations: [], stream_type: "logs" },
      });
      await flushPromises();

      expect(wrapper.vm.form.state.values.destinations).toEqual([]);
      expect(settingsService.getSetting).not.toHaveBeenCalled();
    });
  });

  describe("on save", () => {
    it("creates the email destination for the signed-in user and saves with it", async () => {
      wrapper = mountAlert();
      await flushPromises();
      seedValidScheduled(wrapper.vm.form);

      await wrapper.vm.form.handleSubmit();
      await flushPromises();

      expect(destinationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { name: EMAIL_ME, type: "email", emails: [ME], template: "prebuilt_email" },
        }),
      );
      expect(savedPayload().destinations).toEqual([EMAIL_ME]);
    });

    it("reuses an email destination whose only recipient is the user", async () => {
      wrapper = mountAlert();
      await flushPromises();
      seedValidScheduled(wrapper.vm.form);
      orgHas([{ name: "my-inbox", type: "email", emails: ["Example@Gmail.com"] }]);

      await wrapper.vm.form.handleSubmit();
      await flushPromises();

      expect(destinationService.create).not.toHaveBeenCalled();
      expect(savedPayload().destinations).toEqual(["my-inbox"]);
    });

    it("does not reuse an email destination shared with someone else", async () => {
      wrapper = mountAlert();
      await flushPromises();
      seedValidScheduled(wrapper.vm.form);
      orgHas([{ name: "team-mail", type: "email", emails: [ME, "ops@example.com"] }]);

      await wrapper.vm.form.handleSubmit();
      await flushPromises();

      expect(destinationService.create).toHaveBeenCalledTimes(1);
      expect(savedPayload().destinations).toEqual([EMAIL_ME]);
    });

    it("creates nothing once the user removed Email me", async () => {
      wrapper = mountAlert();
      await flushPromises();
      seedValidScheduled(wrapper.vm.form);
      wrapper.vm.form.setFieldValue("destinations", []);

      await wrapper.vm.form.handleSubmit();
      await flushPromises();

      expect(destinationService.create).not.toHaveBeenCalled();
      expect(savedPayload().destinations).toEqual([]);
    });

    it("does not save the alert when creating the destination fails, and shows why on the field", async () => {
      (destinationService.create as any).mockRejectedValue({
        response: { status: 400, data: { message: "SMTP unavailable" } },
      });
      wrapper = mountAlert();
      await flushPromises();
      seedValidScheduled(wrapper.vm.form);

      await wrapper.vm.form.handleSubmit();
      await flushPromises();

      expect(alertsService.create_by_alert_id).not.toHaveBeenCalled();
      expect(wrapper.vm.emailMeError).toBe("SMTP unavailable");
    });

    it("asks for an admin when the user may not create destinations", async () => {
      (destinationService.create as any).mockRejectedValue({ response: { status: 403 } });
      wrapper = mountAlert();
      await flushPromises();
      seedValidScheduled(wrapper.vm.form);

      await wrapper.vm.form.handleSubmit();
      await flushPromises();

      expect(alertsService.create_by_alert_id).not.toHaveBeenCalled();
      expect(wrapper.vm.emailMeError).toBe(i18n.global.t("alerts.alertSettings.emailMeForbidden"));
    });

    it("says where the email goes and offers a test send after saving", async () => {
      wrapper = mountAlert();
      await flushPromises();
      seedValidScheduled(wrapper.vm.form);

      await wrapper.vm.form.handleSubmit();
      await flushPromises();

      const saved = (toast as any).mock.calls
        .map(([options]: any[]) => options)
        .find((options: any) => options.variant === "success");
      expect(saved.message).toBe(
        i18n.global.t("alerts.messages.alertSavedEmailMe", { address: ME }),
      );
      expect(saved.action.label).toBe(i18n.global.t("alert_templates.testSend"));

      saved.action.handler();
      await flushPromises();
      expect(destinationService.testSend).toHaveBeenCalledWith(
        expect.objectContaining({ destination_name: EMAIL_ME }),
      );
    });

    it("creates no destination when the SQL check fails before the save", async () => {
      wrapper = mountAlert();
      await flushPromises();
      seedValidScheduled(wrapper.vm.form);
      wrapper.vm.form.setFieldValue("query_condition.type", "sql");
      wrapper.vm.form.setFieldValue("query_condition.sql", "SELECT count(*) FROM _rundata");
      const failed = Promise.reject(new Error("validation request failed"));
      failed.catch(() => {});
      wrapper.vm.validateSqlQueryPromise = failed;

      await wrapper.vm.form.handleSubmit();
      await flushPromises();

      expect(alertsService.create_by_alert_id).not.toHaveBeenCalled();
      expect(destinationService.create).not.toHaveBeenCalled();
    });

    // The recovery field offers the same planned option, so its pick must resolve too.
    it("creates Email me when it is picked only for recovery", async () => {
      wrapper = mountAlert();
      await flushPromises();
      const form = wrapper.vm.form;
      seedValidScheduled(form);
      form.setFieldValue("destinations", ["team-slack"]);
      form.setFieldValue("notify_on_recovery", true);
      form.setFieldValue("recovery_destinations", [EMAIL_ME]);

      await form.handleSubmit();
      await flushPromises();

      expect(destinationService.create).toHaveBeenCalledTimes(1);
      expect(savedPayload().recovery_destinations).toEqual([EMAIL_ME]);
    });

    it("says where the email goes when Email me is picked only for recovery", async () => {
      wrapper = mountAlert();
      await flushPromises();
      const form = wrapper.vm.form;
      seedValidScheduled(form);
      form.setFieldValue("destinations", ["team-slack"]);
      form.setFieldValue("notify_on_recovery", true);
      form.setFieldValue("recovery_destinations", [EMAIL_ME]);

      await form.handleSubmit();
      await flushPromises();

      const saved = (toast as any).mock.calls
        .map(([options]: any[]) => options)
        .find((options: any) => options.variant === "success");
      expect(saved.message).toBe(
        i18n.global.t("alerts.messages.alertSavedEmailMe", { address: ME }),
      );
      expect(saved.action.label).toBe(i18n.global.t("alert_templates.testSend"));
    });

    it("swaps a reused destination into the recovery list as well", async () => {
      wrapper = mountAlert();
      await flushPromises();
      const form = wrapper.vm.form;
      seedValidScheduled(form);
      form.setFieldValue("notify_on_recovery", true);
      form.setFieldValue("recovery_destinations", [EMAIL_ME]);
      orgHas([{ name: "my-inbox", type: "email", emails: [ME] }]);

      await form.handleSubmit();
      await flushPromises();

      expect(destinationService.create).not.toHaveBeenCalled();
      expect(savedPayload().destinations).toEqual(["my-inbox"]);
      expect(savedPayload().recovery_destinations).toEqual(["my-inbox"]);
    });

    it("creates the destination on the first Send test, so the save reuses it", async () => {
      wrapper = mountAlert();
      await flushPromises();
      seedValidScheduled(wrapper.vm.form);

      expect(await wrapper.vm.resolveEmailMe([EMAIL_ME])).toEqual([EMAIL_ME]);
      await wrapper.vm.form.handleSubmit();
      await flushPromises();

      expect(destinationService.create).toHaveBeenCalledTimes(1);
      expect(savedPayload().destinations).toEqual([EMAIL_ME]);
    });
  });
});
