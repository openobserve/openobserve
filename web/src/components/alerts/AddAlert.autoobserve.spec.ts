// Copyright 2026 OpenObserve Inc.

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.

// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import { RouterView, createMemoryHistory, createRouter } from "vue-router";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import alertsService from "@/services/alerts";
import destinationService from "@/services/alert_destination";
import { queryClient } from "@/composables/query/queryClient";
import { toast } from "@/lib/feedback/Toast/useToast";
import config from "@/aws-exports";
import { raw } from "@/types/i18n";
import { normalizePrefill } from "@/utils/alerts/alertPrefill";
import { writeAlertPrefill } from "@/utils/alerts/alertPrefillStorage";
import { noDataAlert, type AutoObserveAlertOptions } from "@/utils/alerts/prefill/fromAutoObserve";
import { destinationHandoff } from "@/components/autoobserve/insight/targets/editTargets";
import { byTest } from "@/test/unit/helpers/draftDom";
import {
  serviceKeyOf,
  useRecentlyCreated,
} from "@/components/autoobserve/insight/bulk/useRecentlyCreated";
import AddAlert from "./AddAlert.vue";

vi.mock("@/aws-exports", async (importOriginal) => {
  const actual = (await importOriginal<{ default: Record<string, unknown> }>()).default;
  return { default: { ...actual, isEnterprise: "true" } };
});
const configFull = vi.hoisted(() => vi.fn());
vi.mock("@/services/config", () => ({ default: { get_config_full: configFull } }));
vi.mock("@/composables/useStreams", () => ({
  default: () => ({
    getStream: vi.fn(() => Promise.resolve({ schema: [{ name: "service_name", type: "Utf8" }] })),
    getStreams: vi.fn(() => Promise.resolve({ list: [{ name: "default" }, { name: "ingest_b" }] })),
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
vi.mock("@/utils/zincutils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/zincutils")>()),
  getTimezonesByOffset: vi.fn(() => Promise.resolve(["UTC"])),
}));
vi.mock("@/lib/feedback/Toast/useToast", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/feedback/Toast/useToast")>()),
  toast: vi.fn(() => () => {}),
}));
vi.mock("@/services/alerts", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: {
      update_by_alert_id: vi.fn(() => Promise.resolve({ data: { code: 200 } })),
      create_by_alert_id: vi.fn(() => Promise.resolve({ data: { code: 200, id: "new" } })),
      get_by_alert_id: vi.fn(),
      listByFolderId: vi.fn(() => Promise.resolve({ data: { list: [] } })),
    },
  });
});
vi.mock("@/services/alert_destination", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: {
      list: vi.fn(() => Promise.resolve({ data: [{ name: "ops-webhook" }, { name: "ops-mail" }] })),
    },
  });
});
vi.mock("@/services/product_analytics", () => ({ default: { track: vi.fn() } }));
vi.mock("@/services/reodotdev_analytics", () => ({ useReo: () => ({ track: vi.fn() }) }));

interface AddAlertVm {
  formData: Record<string, any>;
  handleSave: () => Promise<void>;
  saveAlertJson: (json: string) => Promise<void>;
}

interface AddAlertSetter {
  updateDestinations: (destinations: string[]) => void;
}

// Shape of GET /api/v2/{org}/alerts/{id}, with neutral names.
const savedAlert = {
  id: "a1",
  name: "svc_c_errors",
  org_id: "default",
  stream_type: "logs",
  stream_name: "default",
  is_real_time: false,
  query_condition: {
    type: "sql",
    conditions: null,
    sql: "SELECT * FROM default",
    promql: null,
    promql_condition: null,
    aggregation: null,
    vrl_function: null,
    multi_time_range: [],
  },
  trigger_condition: {
    period: 10,
    operator: ">=",
    threshold: 1,
    frequency: 10,
    cron: "",
    frequency_type: "minutes",
    silence: 10,
    timezone: "UTC",
  },
  destinations: [] as string[],
  context_attributes: {},
  row_template: "",
  row_template_type: "String",
  description: "",
  enabled: true,
  tz_offset: 0,
  owner: "root@example.com",
  last_edited_by: "root@example.com",
  pending_period_sec: 60,
  keep_firing_for: 0,
  recovery_destinations: [],
};

const options: AutoObserveAlertOptions = {
  team: { name: "ops", folderId: "ops", folderName: "ops", source: "folder", reason: raw("") },
  notify: { destinations: ["ops-webhook"], reason: raw("") },
  now: 1_793_966_400_000_000,
};

const stubs = {
  QueryConfig: true,
  AlertSettings: true,
  CompareWithPast: true,
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
  CompositeAlertForm: true,
};

let wrapper: VueWrapper | null = null;
let editorProps: Record<string, unknown> = {};

const EditorRoute = defineComponent({
  setup() {
    return () => h(AddAlert, { ...editorProps });
  },
});

const mountAt = async (path: string, props: Record<string, unknown>) => {
  editorProps = props;
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/alerts/edit/:alert_id", name: "editAlert", component: EditorRoute },
      { path: "/alerts/add", name: "addAlert", component: EditorRoute },
    ],
  });
  await router.push(path);
  wrapper = mount(
    { render: () => h(RouterView) },
    { attachTo: document.body, global: { plugins: [i18n, router], provide: { store }, stubs } },
  );
  await flushPromises();
  await flushPromises();
};

const vm = () => wrapper!.findComponent(AddAlert).vm as unknown as AddAlertVm;
const bannerText = () => byTest("add-alert-calibration-banner")?.textContent?.trim() ?? "";
const toastMessages = () =>
  vi.mocked(toast).mock.calls.map(([arg]) => (arg as { message: string }).message);

const openNoDataPrefill = async (
  build: "enterprise" | "oss" = "enterprise",
  opts: AutoObserveAlertOptions = options,
) => {
  const prefill = noDataAlert(
    {
      service: "svc-ingest-b",
      cluster: null,
      namespace: null,
      stream: { type: "logs", name: "ingest_b" },
      schema: ["service_name"],
    },
    opts,
  )!;
  writeAlertPrefill(normalizePrefill(prefill));
  // An OSS build never writes this prefill, so the OSS case seeds the enterprise one, as the Playwright case does.
  if (build === "oss") config.isEnterprise = "false";
  await mountAt("/alerts/add?prefill=autoobserve&folder=ops", {
    modelValue: {},
    isUpdated: false,
    destinations: [],
  });
};

describe("AddAlert with an AutoObserve prefill", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    queryClient.clear();
    vi.mocked(toast).mockClear();
    vi.mocked(alertsService.get_by_alert_id).mockImplementation(
      async () => ({ data: structuredClone(savedAlert) }) as any,
    );
    vi.mocked(destinationService.list).mockImplementation((() =>
      Promise.resolve({ data: [{ name: "ops-webhook" }, { name: "ops-mail" }] })) as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    wrapper?.unmount();
    wrapper = null;
    config.isEnterprise = "true";
  });

  it("opens the create form with the query, the origin line and the destination, and says where it came from", async () => {
    await openNoDataPrefill();

    expect(vm().formData.stream_name).toBe("ingest_b");
    expect(vm().formData.query_condition.sql).toBe(
      'SELECT count(*) AS row_count FROM "ingest_b" WHERE "service_name" = \'svc-ingest-b\' HAVING count(*) = 0',
    );
    expect(vm().formData.description).toBe(
      "Created from an AutoObserve suggestion for svc-ingest-b on Nov 6.",
    );
    expect(vm().formData.destinations).toEqual(["ops-webhook"]);
    expect(toastMessages()).toContain(
      "Suggested by AutoObserve for svc-ingest-b. Nothing is saved until you save.",
    );
  });

  it("on an OSS build the same stash shows no AutoObserve wording and sets no description or destination", async () => {
    await openNoDataPrefill("oss");

    expect(toastMessages()).toContain("Query imported into the alert form");
    expect(toastMessages().join(" ")).not.toContain("AutoObserve");
    expect(vm().formData.description).toBe("");
    expect(vm().formData.destinations).toEqual([]);
  });

  it("the edit route with prefill=autoobserve applies Choose who gets notified and keeps the saved query", async () => {
    await destinationHandoff("a1", ["ops-webhook"]);
    await mountAt("/alerts/edit/a1?prefill=autoobserve", {
      modelValue: structuredClone(savedAlert),
      isUpdated: true,
    });

    expect(vm().formData.query_condition.type).toBe("sql");
    expect(vm().formData.query_condition.sql).toBe("SELECT * FROM default");
    expect(vm().formData.destinations).toEqual(["ops-webhook"]);
    expect(bannerText()).toContain("Suggested by AutoObserve");
    expect(bannerText()).toContain("ops-webhook");
    expect(bannerText()).not.toContain("Alert Calibration");
  });

  describe("AutoObserve is the destination: saves only an alert that reaches someone", () => {
    const silent: AutoObserveAlertOptions = {
      ...options,
      notify: { destinations: [], reason: "none" },
    };
    const save = () => byTest("add-alert-submit-btn") as HTMLButtonElement;
    const reason = () => byTest("add-alert-no-destination");
    const via = () => byTest("add-alert-via-incident");
    const reach = (incidents: boolean, oncall: boolean, pagesOncall?: boolean) => {
      const { incidents_page_oncall: _drop, ...rest } = store.state.zoConfig ?? {};
      store.state.zoConfig = {
        ...rest,
        incidents_enabled: incidents,
        oncall_enabled: oncall,
        ...(pagesOncall === undefined ? {} : { incidents_page_oncall: pagesOncall }),
      };
    };
    beforeEach(() => reach(false, false));
    afterEach(() => reach(false, false));

    it("with incidents paging on-call, a draft with no destination opens an incident and saves", async () => {
      reach(true, true);
      await openNoDataPrefill("enterprise", silent);
      expect(vm().formData.creates_incident).toBe(true);
      expect(save().disabled).toBe(false);
      expect(reason()).toBeNull();
      expect(via()?.textContent?.trim()).toBe(
        "No destination: this alert opens an incident, and the incident pages on-call.",
      );
      expect(via()?.className).not.toMatch(/status-(warning|error)-text/);
      expect(wrapper!.findComponent({ name: "AlertSettings" }).props("destinationRequired")).toBe(
        false,
      );
    });

    it("in an org with no on-call team, the incident pages no one: Save is blocked in red with a way to set up on-call (F1)", async () => {
      reach(true, true, false);
      await openNoDataPrefill("enterprise", silent);
      expect(vm().formData.creates_incident).toBe(true);
      expect(save().disabled).toBe(true);
      expect(via()).toBeNull();
      expect(reason()?.className).toContain("text-status-error-text");
      expect(reason()?.textContent).toContain(
        "Choose a destination for this alert, or set up on-call. This organization has no on-call team, so its incident pages no one.",
      );
      expect(byTest("add-alert-setup-oncall")?.textContent?.trim()).toBe("Set up on-call");
      expect(wrapper!.findComponent({ name: "AlertSettings" }).props("destinationRequired")).toBe(
        true,
      );
    });

    it("sets up on-call in a new tab, and Check again lifts the block without leaving the form", async () => {
      reach(true, true, false);
      const open = vi.spyOn(window, "open").mockReturnValue(null);
      await openNoDataPrefill("enterprise", silent);
      byTest("add-alert-setup-oncall")!.click();
      await flushPromises();
      expect(open).toHaveBeenCalledWith(
        expect.stringContaining("oncall/teams"),
        "_blank",
        "noopener",
      );
      configFull.mockResolvedValue({
        data: { ...store.state.zoConfig, incidents_page_oncall: true },
      });
      expect(byTest("add-alert-check-oncall")?.textContent?.trim()).toBe("Check again");
      byTest("add-alert-check-oncall")!.click();
      await flushPromises();
      expect(reason()).toBeNull();
      expect(save().disabled).toBe(false);
      open.mockRestore();
    });

    it("turning off Creates Incident brings the block back, saying how to lift it", async () => {
      reach(true, true);
      await openNoDataPrefill("enterprise", silent);
      const form = wrapper!.findComponent({ name: "OForm" }).props("form") as {
        setFieldValue: (name: string, value: unknown) => void;
      };
      form.setFieldValue("creates_incident", false);
      await flushPromises();
      expect(vm().formData.creates_incident).toBe(false);
      expect(save().disabled).toBe(true);
      expect(reason()?.textContent?.trim()).toBe(
        "Choose a destination for this alert, or turn on Creates Incident. With neither, it reaches no one.",
      );
    });

    it("with incidents off, a draft with no destination blocks Save with the red reason naming what is off", async () => {
      reach(false, true);
      await openNoDataPrefill("enterprise", silent);
      expect(vm().formData.destinations).toEqual([]);
      expect(save().disabled).toBe(true);
      expect(reason()?.textContent?.trim()).toBe(
        "Choose a destination for this alert. Incidents are off in this organization, so an alert with no destination reaches no one.",
      );
      expect(reason()?.className).toContain("text-status-error-text");
    });

    it("choosing a destination lifts the block", async () => {
      await openNoDataPrefill("enterprise", silent);
      (wrapper!.findComponent(AddAlert).vm as unknown as AddAlertSetter).updateDestinations([
        "ops-webhook",
      ]);
      await flushPromises();
      expect(vm().formData.destinations).toEqual(["ops-webhook"]);
      expect(save().disabled).toBe(false);
      expect(reason()).toBeNull();
    });

    it("an AutoObserve draft that already notifies someone saves as before", async () => {
      await openNoDataPrefill();
      expect(save().disabled).toBe(false);
      expect(reason()).toBeNull();
    });

    const REASON =
      "Choose a destination for this alert. Incidents and on-call are off in this organization, so an alert with no destination reaches no one.";
    const blockedToast = () =>
      vi
        .mocked(toast)
        .mock.calls.find(
          ([o]) => String(o.message) === REASON && (o as { variant?: string }).variant === "error",
        );

    it("Enter in a field (the form's own submit) saves nothing without a destination", async () => {
      await openNoDataPrefill("enterprise", silent);
      vi.mocked(toast).mockClear();
      vi.mocked(alertsService.create_by_alert_id).mockClear();
      await wrapper!.findComponent({ name: "OForm" }).find("form").trigger("submit");
      await vi.waitFor(() => expect(blockedToast()).toBeDefined());
      expect(alertsService.create_by_alert_id).not.toHaveBeenCalled();
      expect(blockedToast()).toBeDefined();
    });

    it("the leave dialog's Save (handleSave) saves nothing without a destination", async () => {
      await openNoDataPrefill("enterprise", silent);
      vi.mocked(toast).mockClear();
      vi.mocked(alertsService.create_by_alert_id).mockClear();
      await vm().handleSave();
      await flushPromises();
      expect(alertsService.create_by_alert_id).not.toHaveBeenCalled();
      expect(blockedToast()).toBeDefined();
    });

    it("JSON Save saves nothing without a destination", async () => {
      await openNoDataPrefill("enterprise", silent);
      vi.mocked(toast).mockClear();
      vi.mocked(alertsService.create_by_alert_id).mockClear();
      await vm().saveAlertJson(JSON.stringify({ ...vm().formData, destinations: [] }));
      await flushPromises();
      expect(alertsService.create_by_alert_id).not.toHaveBeenCalled();
      expect(blockedToast()).toBeDefined();
    });

    describe("a draft the org already has is not saved twice", () => {
      const recently = useRecentlyCreated();
      const submit = async () => {
        await wrapper!.findComponent({ name: "OForm" }).find("form").trigger("submit");
        await flushPromises();
        await flushPromises();
      };
      const listed = (name: string) => ({
        data: {
          list: [
            {
              alert_id: "3Lwzv5LmG19lvOBHqrZ0n5TxzRR",
              name,
              folder_id: "ops",
              folder_name: "ops",
              stream_type: "logs",
              stream_name: "elsewhere",
              condition: { sql: "SELECT 1" },
            },
          ],
        },
      });
      afterEach(() => recently.clearOnPass("default", Number.MAX_SAFE_INTEGER));

      it("Save checks the org's alerts first and saves nothing when the same name is in the folder", async () => {
        reach(true, true);
        await openNoDataPrefill();
        vi.mocked(alertsService.listByFolderId).mockResolvedValue(
          listed(vm().formData.name) as any,
        );
        vi.mocked(alertsService.create_by_alert_id).mockClear();
        vi.mocked(toast).mockClear();
        await submit();
        await vi.waitFor(() =>
          expect(toastMessages().some((m) => String(m).startsWith("Already added as"))).toBe(true),
        );
        expect(alertsService.create_by_alert_id).not.toHaveBeenCalled();
        const shown = vi
          .mocked(toast)
          .mock.calls.map(([o]) => o as { message: string; variant?: string; action?: unknown })
          .find((o) => String(o.message).startsWith("Already added as"));
        expect(shown?.variant).toBe("warning");
        expect(String(shown?.message)).toBe(
          `Already added as ${vm().formData.name} in folder ops, so this alert wasn't saved again.`,
        );
        expect(shown?.action).toBeDefined();
      });

      it("a saved draft is remembered, so AutoObserve stops offering it before the next check", async () => {
        reach(true, true);
        await openNoDataPrefill();
        vi.mocked(alertsService.listByFolderId).mockResolvedValue({ data: { list: [] } } as any);
        vi.mocked(alertsService.create_by_alert_id).mockClear();
        await submit();
        await vi.waitFor(() => expect(alertsService.create_by_alert_id).toHaveBeenCalledTimes(1));
        await flushPromises();
        const org = store.state.selectedOrganization.identifier;
        expect(recently.has(serviceKeyOf(org, "svc-ingest-b", null, null), "no_data")).toBe(true);
      });

      it("a draft saved from the JSON editor is remembered too", async () => {
        reach(true, true);
        await openNoDataPrefill();
        vi.mocked(alertsService.listByFolderId).mockResolvedValue({ data: { list: [] } } as any);
        vi.mocked(alertsService.create_by_alert_id).mockClear();
        // The JSON check only accepts destinations the form was handed; this draft pages on-call through its incident.
        await vm().saveAlertJson(JSON.stringify({ ...vm().formData, destinations: [] }));
        await flushPromises();
        await vi.waitFor(() => expect(alertsService.create_by_alert_id).toHaveBeenCalledTimes(1));
        await flushPromises();
        const org = store.state.selectedOrganization.identifier;
        expect(recently.has(serviceKeyOf(org, "svc-ingest-b", null, null), "no_data")).toBe(true);
      });

      it("JSON Save checks the org's alerts first and saves nothing when the same name is in the folder", async () => {
        reach(true, true);
        await openNoDataPrefill();
        vi.mocked(alertsService.listByFolderId).mockResolvedValue(
          listed(vm().formData.name) as any,
        );
        vi.mocked(alertsService.create_by_alert_id).mockClear();
        await vm().saveAlertJson(JSON.stringify(vm().formData));
        await flushPromises();
        expect(alertsService.create_by_alert_id).not.toHaveBeenCalled();
        expect(toastMessages().some((m) => String(m).startsWith("Already added as"))).toBe(true);
      });

      describe("an org or folder switch during Save", () => {
        const org = () => store.state.selectedOrganization.identifier;
        let home = "";
        beforeEach(() => {
          home = org();
        });
        afterEach(() => {
          store.state.selectedOrganization.identifier = home;
          recently.clearOnPass("elsewhere-org", Number.MAX_SAFE_INTEGER);
        });

        // The check awaits the alerts list; the switch lands while it is in flight.
        const switchDuringCheck = (move: () => void) =>
          vi.mocked(alertsService.listByFolderId).mockImplementation((async () => {
            move();
            return { data: { list: [] } };
          }) as any);

        it("saves nothing in either org and says it couldn't save when the org changes", async () => {
          reach(true, true);
          await openNoDataPrefill();
          vi.mocked(alertsService.create_by_alert_id).mockClear();
          vi.mocked(toast).mockClear();
          switchDuringCheck(() => {
            store.state.selectedOrganization.identifier = "elsewhere-org";
          });
          await submit();
          await vi.waitFor(() => expect(toastMessages()).toContain("Could not save the alert."));
          expect(alertsService.listByFolderId).toHaveBeenCalled();
          expect(vi.mocked(alertsService.listByFolderId).mock.calls[0][5]).toBe(home);
          expect(alertsService.create_by_alert_id).not.toHaveBeenCalled();
          const shown = vi
            .mocked(toast)
            .mock.calls.map(([o]) => o as { message: string; variant?: string })
            .find((o) => String(o.message) === "Could not save the alert.");
          expect(shown?.variant).toBe("error");
          for (const id of [home, "elsewhere-org"]) {
            expect(recently.has(serviceKeyOf(id, "svc-ingest-b", null, null), "no_data")).toBe(
              false,
            );
          }
        });

        it("saves nothing when the folder changes", async () => {
          reach(true, true);
          await openNoDataPrefill();
          vi.mocked(alertsService.create_by_alert_id).mockClear();
          vi.mocked(toast).mockClear();
          switchDuringCheck(() => {
            (vm() as unknown as { activeFolderId: string }).activeFolderId = "pay";
          });
          await submit();
          await vi.waitFor(() => expect(toastMessages()).toContain("Could not save the alert."));
          expect(alertsService.create_by_alert_id).not.toHaveBeenCalled();
        });

        it("JSON Save saves nothing when the org changes", async () => {
          reach(true, true);
          await openNoDataPrefill();
          vi.mocked(alertsService.create_by_alert_id).mockClear();
          vi.mocked(toast).mockClear();
          switchDuringCheck(() => {
            store.state.selectedOrganization.identifier = "elsewhere-org";
          });
          await vm().saveAlertJson(JSON.stringify({ ...vm().formData, destinations: [] }));
          await flushPromises();
          expect(alertsService.create_by_alert_id).not.toHaveBeenCalled();
          expect(toastMessages()).toContain("Could not save the alert.");
        });
      });
    });

    it("tells the destination field it is required for an AutoObserve draft", async () => {
      await openNoDataPrefill("enterprise", silent);
      expect(wrapper!.findComponent({ name: "AlertSettings" }).props("destinationRequired")).toBe(
        true,
      );
    });

    it("a plain new alert with no destination is never blocked", async () => {
      await mountAt("/alerts/add", { modelValue: {}, isUpdated: false, destinations: [] });
      expect(vm().formData.destinations).toEqual([]);
      expect(save().disabled).toBe(false);
      expect(reason()).toBeNull();
      expect(wrapper!.findComponent({ name: "AlertSettings" }).props("destinationRequired")).toBe(
        false,
      );
    });
  });
});
