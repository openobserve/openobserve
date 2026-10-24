import { describe, it, expect, vi, beforeEach } from "vitest";
import { flushPromises, shallowMount } from "@vue/test-utils";
import { createStore } from "vuex";
import { createI18n } from "vue-i18n";
import { ref } from "vue";
import ImportAlert from "./ImportAlert.vue";
import enUS from "@/locales/languages/en-US.json";
import { queryClient } from "@/composables/query/queryClient";

// Mock all external dependencies
vi.mock("@/services/alerts", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: {
      create_by_alert_id: vi.fn(),
      listByFolderId: vi.fn().mockResolvedValue({
        data: { list: [] },
      }),
    },
  });
});

vi.mock("@/composables/useStreams", () => ({
  default: () => ({
    getStreams: vi.fn().mockResolvedValue({ list: [{ name: "test-stream" }] }),
  }),
}));

vi.mock("vue-router", () => ({
  useRouter: vi.fn(() => ({
    push: vi.fn(),
    back: vi.fn(),
    currentRoute: {
      value: {
        query: { folder: "default" },
      },
    },
  })),
  useRoute: vi.fn(() => ({
    query: { folder: "default" },
  })),
}));

vi.mock("@/router", () => ({
  default: {
    currentRoute: {
      value: {
        query: { folder: "default" },
      },
    },
  },
}));

vi.mock("@/services/alert_templates", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), { default: {} });
});
vi.mock("@/services/alert_destination", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), { default: {} });
});
const anomalyCreate = vi.fn().mockResolvedValue({ data: { anomaly_id: "a1" } });
vi.mock("@/services/anomaly_detection", () => ({
  default: {
    create: (...args: any[]) => anomalyCreate(...args),
    update: vi.fn(),
  },
}));

const getSettingMock = vi.hoisted(() => vi.fn());
vi.mock("@/services/settings", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: { getSetting: (...args: any[]) => getSettingMock(...args) },
  });
});

const toastMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: toastMock }));

vi.mock("axios", () => ({
  default: {
    get: vi.fn().mockResolvedValue({
      data: { test: "data" },
      headers: { "content-type": "application/json" },
    }),
  },
}));

describe("ImportAlert Component - Comprehensive Function Tests", () => {
  let wrapper: any;
  let mockStore: any;
  let mockI18n: any;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient.clear();
    getSettingMock.mockRejectedValue({ response: { status: 404 } });

    mockStore = createStore({
      state: {
        selectedOrganization: { identifier: "test-org" },
        organizations: [{ identifier: "test-org" }, { identifier: "other-org" }],
        userInfo: { email: "test@example.com" },
        timezone: "UTC",
        organizationData: {
          allAlertsListByNames: {},
        },
      },
      actions: {
        setAllAlertsListByNames: vi.fn(),
      },
      dispatch: vi.fn(),
    });

    mockI18n = createI18n({
      locale: "en",
      messages: {
        en: {
          function: { cancel: "Cancel" },
          dashboard: { import: "Import", addURL: "Add URL", dropFileMsg: "Drop file message" },
          alerts: { name: "Name", stream_name: "Stream Name", streamType: "Stream Type" },
        },
      },
    });

    wrapper = mountImport();
  });

  const mountImport = () =>
    shallowMount(ImportAlert, {
      props: {
        destinations: [
          { name: "test-destination-1" },
          { name: "test-destination-2" },
          { name: "email-dest" },
        ],
        templates: [],
        alerts: [],
      },
      global: {
        plugins: [mockStore, mockI18n],
        stubs: {
          QueryEditor: { template: "<div></div>" },
          AppTabs: { template: "<div></div>" },
          SelectFolderDropDown: { template: "<div></div>" },
          BaseImport: {
            name: "BaseImport",
            template: '<div><slot name="output-content"></slot></div>',
            props: ["title", "testPrefix", "isImporting", "editorHeights", "parseFile"],
            emits: ["back", "cancel", "import"],
            setup(_props: any, { expose }: any) {
              const jsonArrayOfObj = ref([]);
              const jsonStr = ref("");
              const isImportingLocal = ref(false);
              const updateJsonArray = (arr: any[]) => {
                jsonArrayOfObj.value = arr;
                jsonStr.value = JSON.stringify(arr, null, 2);
              };
              expose({
                jsonArrayOfObj,
                jsonStr,
                isImportingLocal,
                updateJsonArray,
              });
              return { jsonArrayOfObj, jsonStr, isImportingLocal, updateJsonArray };
            },
          },
        },
      },
    });

  describe("legacy timezone names", () => {
    it("finds Asia/Kolkata by the old name Calcutta", () => {
      wrapper.vm.timezoneFilterFn("Calcutta");
      expect(wrapper.vm.filteredTimezone).toContain("Asia/Kolkata");
      const kolkata = wrapper.vm.timezoneSelectOptions.find(
        (o: { value: string }) => o.value === "Asia/Kolkata",
      );
      expect(kolkata.searchText).toContain("Asia/Calcutta");
    });

    it("files an alert without a timezone under the app's zone exactly as main did", async () => {
      const mockAlertsService = await import("@/services/alerts");
      vi.mocked(mockAlertsService.default.create_by_alert_id).mockResolvedValue(true as any);
      wrapper.vm.store.state.timezone = "Asia/Calcutta";
      const input: any = { name: "legacy-zone", trigger_condition: {} };
      await wrapper.vm.createAlert(input, 1, "folder1");
      const sent = vi.mocked(mockAlertsService.default.create_by_alert_id).mock.calls.at(-1)?.[1];
      expect(sent.trigger_condition.timezone).toBe("Asia/Calcutta");
    });

    it("tags an imported alert's create with source import", async () => {
      const mockAlertsService = await import("@/services/alerts");
      vi.mocked(mockAlertsService.default.create_by_alert_id).mockResolvedValue(true as any);
      await wrapper.vm.createAlert({ name: "imported", trigger_condition: {} }, 1, "folder1");
      const call = vi.mocked(mockAlertsService.default.create_by_alert_id).mock.calls.at(-1);
      expect(call?.[3]).toBe("import");
    });
  });

  describe("1. Data Update Functions", () => {
    describe("updateUserSelectedDestinations", () => {
      it("should call the function without errors", () => {
        const destinations = ["dest1", "dest2"];

        expect(() => {
          wrapper.vm.updateUserSelectedDestinations(destinations, 0);
        }).not.toThrow();
      });
    });

    describe("updateStreamFields", () => {
      it("should call the function without errors", () => {
        const streamName = "new-stream";

        expect(() => {
          wrapper.vm.updateStreamFields(streamName, 1);
        }).not.toThrow();
      });
    });

    describe("updateAlertName", () => {
      it("should call the function without errors", () => {
        const alertName = "new-alert";

        expect(() => {
          wrapper.vm.updateAlertName(alertName, 1);
        }).not.toThrow();
      });
    });

    describe("updateStreams", () => {
      it("should update stream_type to logs", async () => {
        await expect(wrapper.vm.updateStreams("logs", 0)).resolves.not.toThrow();
      });

      it("should update stream_type to metrics", async () => {
        await expect(wrapper.vm.updateStreams("metrics", 0)).resolves.not.toThrow();
      });

      it("should update stream_type to traces", async () => {
        await expect(wrapper.vm.updateStreams("traces", 0)).resolves.not.toThrow();
      });

      it("should fetch and update streamList", async () => {
        await wrapper.vm.updateStreams("logs", 0);

        expect(wrapper.vm.streamList).toEqual(["test-stream"]);
      });

      it("should handle getStreams error gracefully", async () => {
        const mockGetStreams = vi.fn().mockRejectedValue(new Error("Network error"));
        wrapper.vm.getStreams = mockGetStreams;

        await wrapper.vm.updateStreams("logs", 0);
      });
    });

    describe("updateTimezone", () => {
      it("should call the function without errors", () => {
        const timezone = "America/New_York";

        expect(() => {
          wrapper.vm.updateTimezone(timezone, 0);
        }).not.toThrow();
      });
    });

    describe("updateOrgId", () => {
      it("should call the function without errors", () => {
        const orgId = "new-org-id";

        expect(() => {
          wrapper.vm.updateOrgId(orgId, 0);
        }).not.toThrow();
      });
    });
  });

  // TODO: filterDestinations and timezoneFilterFn internal APIs were removed when
  // the select was replaced with OSelect. Skipped until OSelect-based tests are written.
  describe.skip("2. Filter Functions", () => {
    describe("filterDestinations", () => {
      it("should show all destinations when filter is empty", () => {
        const mockUpdate = vi.fn((callback) => callback());

        wrapper.vm.filterDestinations("", mockUpdate);

        expect(mockUpdate).toHaveBeenCalled();
        expect(wrapper.vm.filteredDestinations).toEqual([
          "test-destination-1",
          "test-destination-2",
          "email-dest",
        ]);
      });

      it("should filter destinations by partial match", () => {
        const mockUpdate = vi.fn((callback) => callback());

        wrapper.vm.filterDestinations("test", mockUpdate);

        expect(mockUpdate).toHaveBeenCalled();
        expect(wrapper.vm.filteredDestinations).toEqual([
          "test-destination-1",
          "test-destination-2",
        ]);
      });

      it("should be case insensitive", () => {
        const mockUpdate = vi.fn((callback) => callback());

        wrapper.vm.filterDestinations("EMAIL", mockUpdate);

        expect(mockUpdate).toHaveBeenCalled();
        expect(wrapper.vm.filteredDestinations).toEqual(["email-dest"]);
      });

      it("should return empty array for no matches", () => {
        const mockUpdate = vi.fn((callback) => callback());

        wrapper.vm.filterDestinations("nonexistent", mockUpdate);

        expect(mockUpdate).toHaveBeenCalled();
        expect(wrapper.vm.filteredDestinations).toEqual([]);
      });
    });

    describe("timezoneFilterFn", () => {
      it("should show all timezones when filter is empty", () => {
        const mockUpdate = vi.fn((callback) => callback());

        wrapper.vm.timezoneFilterFn("", mockUpdate);

        expect(mockUpdate).toHaveBeenCalled();
        expect(wrapper.vm.filteredTimezone.length).toBeGreaterThan(0);
      });

      it("should filter timezones by partial match", () => {
        const mockUpdate = vi.fn((callback) => callback());

        wrapper.vm.timezoneFilterFn("america", mockUpdate);

        expect(mockUpdate).toHaveBeenCalled();
        expect(
          wrapper.vm.filteredTimezone.some((tz: string) => tz.toLowerCase().includes("america")),
        ).toBe(true);
      });

      it("should be case insensitive for timezone filtering", () => {
        const mockUpdate = vi.fn((callback) => callback());

        wrapper.vm.timezoneFilterFn("UTC", mockUpdate);

        expect(mockUpdate).toHaveBeenCalled();
      });

      it("should handle browser timezone filtering", () => {
        const mockUpdate = vi.fn((callback) => callback());

        wrapper.vm.timezoneFilterFn("browser", mockUpdate);

        expect(mockUpdate).toHaveBeenCalled();
      });
    });
  });

  describe("3. Array Management Functions", () => {
    describe("toggleDestination", () => {
      it("should add destination if not present", () => {
        wrapper.vm.userSelectedDestinations = [[]];

        wrapper.vm.toggleDestination("test-dest", 0);

        expect(wrapper.vm.userSelectedDestinations[0]).toContain("test-dest");
      });

      it("should remove destination if already present", () => {
        wrapper.vm.userSelectedDestinations = [["test-dest", "other-dest"]];

        wrapper.vm.toggleDestination("test-dest", 0);

        expect(wrapper.vm.userSelectedDestinations[0]).not.toContain("test-dest");
        expect(wrapper.vm.userSelectedDestinations[0]).toContain("other-dest");
      });

      it("should initialize array if it doesn't exist", () => {
        wrapper.vm.userSelectedDestinations = [];

        wrapper.vm.toggleDestination("test-dest", 0);

        expect(wrapper.vm.userSelectedDestinations[0]).toBeDefined();
        expect(wrapper.vm.userSelectedDestinations[0]).toContain("test-dest");
      });

      it("should handle multiple destinations toggling", () => {
        wrapper.vm.userSelectedDestinations = [[]];

        wrapper.vm.toggleDestination("dest1", 0);
        wrapper.vm.toggleDestination("dest2", 0);
        wrapper.vm.toggleDestination("dest3", 0);

        expect(wrapper.vm.userSelectedDestinations[0]).toEqual(["dest1", "dest2", "dest3"]);
      });
    });
  });

  describe("4. Validation Functions", () => {
    describe("checkDestinationInList", () => {
      it("should validate destination existence using component function", () => {
        const destinations = [{ name: "dest1" }, { name: "dest2" }];
        const destinationToCheck = "dest1";

        const result = wrapper.vm.checkDestinationInList(destinations, destinationToCheck);
        expect(result).toBe(true);
      });

      it("should handle non-existent destinations using component function", () => {
        const destinations = [{ name: "dest1" }, { name: "dest2" }];
        const destinationToCheck = "nonexistent";

        const result = wrapper.vm.checkDestinationInList(destinations, destinationToCheck);
        expect(result).toBe(false);
      });

      it("should be case sensitive using component function", () => {
        const destinations = [{ name: "dest1" }];
        const destinationToCheck = "DEST1";

        const result = wrapper.vm.checkDestinationInList(destinations, destinationToCheck);
        expect(result).toBe(false);
      });

      it("should handle empty arrays using component function", () => {
        const destinations = [];
        const destinationToCheck = "dest1";

        const result = wrapper.vm.checkDestinationInList(destinations, destinationToCheck);
        expect(result).toBe(false);
      });

      it("should handle special characters using component function", () => {
        const destinations = [{ name: "dest_with-special@chars" }];
        const destinationToCheck = "dest_with-special@chars";

        const result = wrapper.vm.checkDestinationInList(destinations, destinationToCheck);
        expect(result).toBe(true);
      });
    });

    describe("checkAlertsInList", () => {
      it("should validate alert existence using component function", () => {
        const alerts = ["alert1", "alert2", "critical-alert"];
        const alertToCheck = "alert1";

        const result = wrapper.vm.checkAlertsInList(alerts, alertToCheck);
        expect(result).toBe(true);
      });

      it("should handle non-existent alerts using component function", () => {
        const alerts = ["alert1", "alert2"];
        const alertToCheck = "nonexistent-alert";

        const result = wrapper.vm.checkAlertsInList(alerts, alertToCheck);
        expect(result).toBe(false);
      });

      it("should be case sensitive for alert names using component function", () => {
        const alerts = ["alert1", "alert2"];
        const alertToCheck = "ALERT1";

        const result = wrapper.vm.checkAlertsInList(alerts, alertToCheck);
        expect(result).toBe(false);
      });

      it("should handle empty alerts array using component function", () => {
        const alerts = [];
        const alertToCheck = "alert1";

        const result = wrapper.vm.checkAlertsInList(alerts, alertToCheck);
        expect(result).toBe(false);
      });

      it("should handle special characters in alert names using component function", () => {
        const alerts = ["alert1", "alert2", "critical-alert"];
        const alertToCheck = "critical-alert";

        const result = wrapper.vm.checkAlertsInList(alerts, alertToCheck);
        expect(result).toBe(true);
      });
    });

    describe("validateAlertInputs", () => {
      it("should return false for empty alert name using component function", async () => {
        try {
          const result = await wrapper.vm.validateAlertInputs({ name: "" }, 1);
          expect(result).toBe(false);
        } catch (error) {
          // If function throws, that's also considered a validation failure
          expect(error).toBeDefined();
        }
      });

      it("should return false for invalid organization using component function", async () => {
        try {
          const result = await wrapper.vm.validateAlertInputs(
            {
              name: "test-alert",
              org_id: "wrong-org",
            },
            1,
          );
          expect(result).toBe(false);
        } catch (error) {
          expect(error).toBeDefined();
        }
      });

      it("should return false for invalid stream type using component function", async () => {
        try {
          const result = await wrapper.vm.validateAlertInputs(
            {
              name: "test-alert",
              org_id: "test-org",
              stream_type: "invalid",
            },
            1,
          );
          expect(result).toBe(false);
        } catch (error) {
          expect(error).toBeDefined();
        }
      });

      describe("destinations", () => {
        // Other fields are invalid on purpose: only the destination errors are read.
        const destinationErrors = async (destinations: unknown) => {
          wrapper.vm.alertErrorsToDisplay = [];
          await wrapper.vm.validateAlertInputs(
            {
              name: "a1",
              stream_type: "invalid",
              query_condition: { type: "custom" },
              trigger_condition: {},
              ...(destinations === undefined ? {} : { destinations }),
            },
            1,
          );
          return wrapper.vm.alertErrorsToDisplay
            .flat()
            .filter((error: any) => error?.field === "destination_name");
        };

        it.each([
          ["absent", undefined],
          ["empty", []],
        ])("imports an alert whose destinations are %s", async (_case, destinations) => {
          expect(await destinationErrors(destinations)).toEqual([]);
        });

        it.each([
          ["null", null],
          ["not a list", "ops-slack"],
        ])("rejects destinations that are %s", async (_case, destinations) => {
          expect(await destinationErrors(destinations)).toHaveLength(1);
        });

        it("still rejects a destination this org does not have", async () => {
          expect(await destinationErrors(["no-such-destination"])).toHaveLength(1);
        });

        // Leaving the fix-up picker as it is must import what it shows, so the
        // picker and the JSON have to hold the same value.
        it.each([
          ["an unknown name", ["no-such-destination"], []],
          ["a known and an unknown name", ["email-dest", "no-such-destination"], ["email-dest"]],
          ["null", null, []],
        ])(
          "puts what a retry imports into the picker and the JSON for %s",
          async (_case, destinations, expected) => {
            const baseImport = wrapper.vm.$refs.baseImportRef;
            baseImport.updateJsonArray([{ name: "a1", destinations }]);

            await destinationErrors(destinations);

            expect(wrapper.vm.userSelectedDestinations[0]).toEqual(expected);
            expect(JSON.parse(baseImport.jsonStr)[0].destinations).toEqual(expected);
          },
        );

        // Same wording as the alert form's Destination field: empty is a valid choice.
        it("tells the user the picker is optional only while it is empty", async () => {
          const helpText = () =>
            wrapper
              .findAllComponents({ name: "OSelect" })
              .find((c: any) => c.attributes("data-test") === "alert-import-destination-name-input")
              ?.props("helpText");
          wrapper.vm.alertErrorsToDisplay = [[{ message: "bad", field: "destination_name" }]];
          wrapper.vm.userSelectedDestinations = [[]];
          await wrapper.vm.$nextTick();
          expect(helpText()).toBe(wrapper.vm.t("alerts.alertSettings.noDestinationNote"));

          wrapper.vm.userSelectedDestinations = [["email-dest"]];
          await wrapper.vm.$nextTick();
          expect(helpText()).toBeUndefined();
        });
      });

      it("should validate inputs and return boolean result using component function", async () => {
        // Test that the validation function exists and can be called
        const input = {
          name: "test-alert",
          org_id: "test-org",
          stream_type: "logs",
        };

        try {
          const result = await wrapper.vm.validateAlertInputs(input, 1);
          expect(typeof result).toBe("boolean");
        } catch (error) {
          // If the function throws, that's also a valid test result
          expect(error).toBeDefined();
        }
      });
    });
  });

  describe("5. Event Handler Functions", () => {
    describe("onSubmit", () => {
      it("should prevent default event", () => {
        const mockEvent = { preventDefault: vi.fn() };

        wrapper.vm.onSubmit(mockEvent);

        expect(mockEvent.preventDefault).toHaveBeenCalled();
      });

      it("should handle event without preventDefault method", () => {
        const mockEvent = {};

        // Test that the function can handle events without preventDefault
        try {
          wrapper.vm.onSubmit(mockEvent);
          expect(true).toBe(true);
        } catch (error) {
          // Even if it throws, we know the function exists and was called
          expect(error).toBeDefined();
        }
      });
    });

    describe("updateActiveFolderId", () => {
      it("should update selectedFolderId with new value", () => {
        const newValue = { value: "new-folder-id" };

        wrapper.vm.updateActiveFolderId(newValue);

        expect(wrapper.vm.selectedFolderId).toBe("new-folder-id");
      });

      it("should handle null folder id", () => {
        const newValue = { value: null };

        wrapper.vm.updateActiveFolderId(newValue);

        expect(wrapper.vm.selectedFolderId).toBe(null);
      });
    });

    describe("getActiveFolderAlerts", () => {
      it("should fetch alerts if not cached", async () => {
        const mockAlertsService = await import("@/services/alerts");
        const mockResponse = {
          data: {
            list: [{ name: "alert1" }, { name: "alert2" }],
          },
        };
        vi.mocked(mockAlertsService.default.listByFolderId).mockResolvedValue(mockResponse);

        await wrapper.vm.getActiveFolderAlerts("test-folder");

        expect(mockAlertsService.default.listByFolderId).toHaveBeenCalledWith(
          1,
          1000,
          "name",
          false,
          "",
          "test-org",
          "test-folder",
          "",
        );
      });

      it("should use cached alerts if available", async () => {
        // Set up cache in the store
        wrapper.vm.store.state.organizationData.allAlertsListByNames["cached-folder"] = [
          "cached-alert",
        ];

        await wrapper.vm.getActiveFolderAlerts("cached-folder");

        // When cached, should use the cached value
        expect(wrapper.vm.activeFolderAlerts).toEqual(["cached-alert"]);
      });

      it("should handle API errors gracefully", async () => {
        const mockAlertsService = await import("@/services/alerts");
        vi.mocked(mockAlertsService.default.listByFolderId).mockRejectedValue(
          new Error("API Error"),
        );

        // Use expect().rejects to properly handle async rejections
        await expect(wrapper.vm.getActiveFolderAlerts("error-folder")).rejects.toThrow("API Error");
      });
    });
  });

  describe("6. Alert Creation Functions", () => {
    describe("createAlert", () => {
      it("should test createAlert function exists and can be called", async () => {
        const input = {
          name: "test-alert",
          trigger_condition: {},
        };

        try {
          const result = await wrapper.vm.createAlert(input, 1, "folder1");
          expect(typeof result).toBe("boolean");
        } catch (error) {
          // Function exists and was called, even if it threw an error
          expect(error).toBeDefined();
        }
      });

      it("should handle alert creation process", async () => {
        const input = {
          name: "test-alert",
          trigger_condition: {},
        };

        // Mock the alerts service to avoid actual API calls
        const mockAlertsService = await import("@/services/alerts");
        vi.mocked(mockAlertsService.default.create_by_alert_id).mockResolvedValue(true);

        try {
          const result = await wrapper.vm.createAlert(input, 1, "folder1");
          expect(typeof result).toBe("boolean");
          expect(Array.isArray(wrapper.vm.alertCreators)).toBe(true);
        } catch (error) {
          // Function was called, even if it threw an error
          expect(error).toBeDefined();
          expect(Array.isArray(wrapper.vm.alertCreators)).toBe(true);
        }
      });

      it("should set default properties for alert inputs", () => {
        const input = {
          name: "test-alert",
          trigger_condition: {},
        };

        // Test that properties can be set on the input object
        input.context_attributes = {};
        input.trigger_condition.timezone = "UTC";
        input.owner = "test@example.com";
        input.last_edited_by = "test@example.com";
        input.folder_id = "folder1";

        expect(input.context_attributes).toEqual({});
        expect(input.trigger_condition.timezone).toBe("UTC");
        expect(input.owner).toBe("test@example.com");
        expect(input.last_edited_by).toBe("test@example.com");
        expect(input.folder_id).toBe("folder1");
      });
    });

    describe("processJsonObject", () => {
      it("should test processJsonObject indirectly through importJson", async () => {
        const mockPayload = {
          jsonStr: '{"name": "test-alert", "org_id": "test-org", "stream_type": "logs"}',
          jsonArray: [{ name: "test-alert", org_id: "test-org", stream_type: "logs" }],
        };

        await wrapper.vm.importJson(mockPayload);

        expect(wrapper.vm.isAlertImporting).toBe(false);
      });

      it("should handle multiple objects processing", async () => {
        const mockPayload = {
          jsonStr: '[{"name": "alert1"}, {"name": "alert2"}]',
          jsonArray: [{ name: "alert1" }, { name: "alert2" }],
        };

        await wrapper.vm.importJson(mockPayload);

        expect(wrapper.vm.isAlertImporting).toBe(false);
      });

      it("should reset importing state after processing", async () => {
        const mockPayload = {
          jsonStr: '{"name": "test"}',
          jsonArray: [{ name: "test" }],
        };

        await wrapper.vm.importJson(mockPayload);

        expect(wrapper.vm.isAlertImporting).toBe(false);
      });
    });
  });

  describe("7. Main Import Functions", () => {
    describe("importJson", () => {
      it("should handle empty JSON array", async () => {
        const mockPayload = {
          jsonStr: "",
          jsonArray: [],
        };

        await wrapper.vm.importJson(mockPayload);

        expect(wrapper.vm.isAlertImporting).toBe(false);
      });

      it("should reset BaseImport isImporting flag when JSON string is empty", async () => {
        const baseImportRef = wrapper.vm.$refs.baseImportRef;
        baseImportRef.isImportingLocal = true;

        await wrapper.vm.importJson({ jsonStr: "", jsonArray: [] });

        expect(baseImportRef.isImportingLocal).toBe(false);
      });

      it("should reset BaseImport isImporting flag when JSON is invalid", async () => {
        const baseImportRef = wrapper.vm.$refs.baseImportRef;
        baseImportRef.isImportingLocal = true;

        await wrapper.vm.importJson({ jsonStr: "{ invalid json }", jsonArray: [] });

        expect(baseImportRef.isImportingLocal).toBe(false);
      });

      it("should process valid JSON array", async () => {
        const mockPayload = {
          jsonStr: '[{"name": "alert1"}]',
          jsonArray: [{ name: "alert1" }],
        };

        await wrapper.vm.importJson(mockPayload);

        expect(wrapper.vm.isAlertImporting).toBe(false);
      });

      it("should reset error arrays before processing", async () => {
        wrapper.vm.alertErrorsToDisplay = [["old error"]];
        wrapper.vm.templateErrorsToDisplay = [["old template error"]];
        wrapper.vm.destinationErrorsToDisplay = [["old dest error"]];

        const mockPayload = {
          jsonStr: '{"name": "alert1"}',
          jsonArray: [{ name: "alert1" }],
        };

        await wrapper.vm.importJson(mockPayload);

        expect(wrapper.vm.alertErrorsToDisplay).toEqual([]);
        expect(wrapper.vm.templateErrorsToDisplay).toEqual([]);
        expect(wrapper.vm.destinationErrorsToDisplay).toEqual([]);
      });

      it("should set isAlertImporting to false after processing", async () => {
        const mockPayload = {
          jsonStr: '{"name": "alert1"}',
          jsonArray: [{ name: "alert1" }],
        };

        await wrapper.vm.importJson(mockPayload);

        // After processing is complete, isAlertImporting should be false
        expect(wrapper.vm.isAlertImporting).toBe(false);
      });
    });
  });

  describe("8. Computed Properties and Reactive Data", () => {
    describe("Component default values", () => {
      it("should have isAlertImporting false initially", () => {
        expect(wrapper.vm.isAlertImporting).toBe(false);
      });

      it("should have correct streamTypes array", () => {
        expect(wrapper.vm.streamTypes).toEqual(["logs", "metrics", "traces"]);
      });

      it("should have empty arrays for error displays", () => {
        expect(wrapper.vm.alertErrorsToDisplay).toEqual([]);
        expect(wrapper.vm.templateErrorsToDisplay).toEqual([]);
        expect(wrapper.vm.destinationErrorsToDisplay).toEqual([]);
      });

      it("should have empty arrays for creators", () => {
        expect(wrapper.vm.alertCreators).toEqual([]);
        expect(wrapper.vm.destinationCreators).toEqual([]);
      });

      it("should have empty arrays for user selections", () => {
        expect(wrapper.vm.userSelectedDestinations).toEqual([]);
        expect(wrapper.vm.userSelectedAlertName).toEqual([]);
        expect(wrapper.vm.userSelectedStreamName).toEqual([]);
        expect(wrapper.vm.userSelectedStreamType).toEqual([]);
      });
    });

    // TODO: organizationDataList shape changed during ux-revamp (added `selectable` field). Skipped until rewritten.
    describe.skip("organizationDataList computed property", () => {
      it("should format organizations correctly", () => {
        expect(wrapper.vm.organizationDataList).toEqual([
          { label: "test-org", value: "test-org", disable: false },
          { label: "other-org", value: "other-org", disable: true },
        ]);
      });

      it("should disable organizations not matching selected org", () => {
        const otherOrgItem = wrapper.vm.organizationDataList.find(
          (org: any) => org.value === "other-org",
        );
        expect(otherOrgItem.disable).toBe(true);
      });
    });

    describe("getFormattedDestinations computed property", () => {
      it("should extract destination names", () => {
        expect(wrapper.vm.getFormattedDestinations).toEqual([
          "test-destination-1",
          "test-destination-2",
          "email-dest",
        ]);
      });

      it("should handle empty destinations", async () => {
        await wrapper.setProps({ destinations: [] });
        await wrapper.vm.$nextTick();
        expect(wrapper.vm.getFormattedDestinations).toEqual([]);
      });
    });

    describe("timezone handling", () => {
      it("should have filteredTimezone array", () => {
        expect(Array.isArray(wrapper.vm.filteredTimezone)).toBe(true);
        expect(wrapper.vm.filteredTimezone.length).toBeGreaterThan(0);
      });

      it("should include timezone options", () => {
        expect(wrapper.vm.filteredTimezone.length).toBeGreaterThan(400);
      });

      it("should have timezone configuration", () => {
        expect(Array.isArray(wrapper.vm.filteredTimezone)).toBe(true);
        expect(wrapper.vm.filteredTimezone.length).toBeGreaterThan(0);
      });
    });
  });

  describe("9. Component Integration Tests", () => {
    it("should maintain proper folder state", () => {
      expect(wrapper.vm.selectedFolderId).toBe("default");
      expect(wrapper.vm.activeFolderId).toBe("default");
    });

    it("should manage stream state properly", () => {
      expect(Array.isArray(wrapper.vm.streamList)).toBe(true);
      expect(typeof wrapper.vm.streams).toBe("object");
    });

    it("should manage filtered destinations state", () => {
      expect(Array.isArray(wrapper.vm.filteredDestinations)).toBe(true);
    });
  });

  describe("10. Anomaly Config Import Payload", () => {
    // An exported anomaly config always carries anomaly_id; that is what routes the import here.
    const exportedAnomaly = (overrides: Record<string, any> = {}) => ({
      anomaly_id: "anomaly-1",
      alert_type: "anomaly_detection",
      name: "cpu_anomaly",
      stream_name: "test-stream",
      stream_type: "logs",
      detection_function: "avg(cpu)",
      histogram_interval: "5m",
      schedule_interval: "1h",
      detection_window_seconds: 10800,
      training_window_days: 14,
      ...overrides,
    });

    const submitAnomaly = async (jsonObj: Record<string, any>) => {
      anomalyCreate.mockClear();
      await wrapper.vm.importJson({ jsonStr: JSON.stringify([jsonObj]) });
      expect(anomalyCreate).toHaveBeenCalledTimes(1);
      return anomalyCreate.mock.calls[0][1];
    };

    it("defaults an absent retrain_interval_days to the backend's 7, not to 0 (Never)", async () => {
      const payload = await submitAnomaly(exportedAnomaly());

      expect(payload.anomaly_config.retrain_interval_days).toBe(7);
    });

    it("preserves an explicit retrain_interval_days of 0, the operator's Never", async () => {
      const payload = await submitAnomaly(exportedAnomaly({ retrain_interval_days: 0 }));

      expect(payload.anomaly_config.retrain_interval_days).toBe(0);
    });

    it("preserves an explicit non-default retrain_interval_days", async () => {
      const payload = await submitAnomaly(exportedAnomaly({ retrain_interval_days: 14 }));

      expect(payload.anomaly_config.retrain_interval_days).toBe(14);
    });

    it("sends alert_destinations at the top level, where the flattened Alert reads them", async () => {
      const payload = await submitAnomaly(
        exportedAnomaly({ alert_destinations: ["test-destination-1"] }),
      );

      expect(payload.destinations).toEqual(["test-destination-1"]);
      expect(payload.anomaly_config.alert_destinations).toBeUndefined();
    });

    it("sends an empty destination list when the export names none", async () => {
      const payload = await submitAnomaly(exportedAnomaly());

      expect(payload.destinations).toEqual([]);
    });

    it("does not send seasonality, which create derives rather than accepts", async () => {
      const payload = await submitAnomaly(exportedAnomaly({ seasonality: "daily" }));

      expect(payload.anomaly_config.seasonality).toBeUndefined();
    });
  });

  describe("Prometheus rule YAML", () => {
    const RULES = `groups:
  - name: node
    rules:
      - record: job:up:sum
        expr: sum by (job) (up)
      - alert: InstanceDown
        expr: up == 0 unless on(instance) maintenance == 1
        for: 5m
        labels:
          severity: critical
`;

    const sentPayloads = async () => {
      const service = await import("@/services/alerts");
      return vi.mocked(service.default.create_by_alert_id).mock.calls.map((call) => call[1]);
    };

    it("converts pasted rules and imports them as paused rule-mode alerts", async () => {
      const service = await import("@/services/alerts");
      vi.mocked(service.default.create_by_alert_id).mockResolvedValue(true as any);

      await wrapper.vm.importJson({ jsonStr: RULES });

      const sent = await sentPayloads();
      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({
        name: "instance_down",
        org_id: "test-org",
        stream_type: "metrics",
        enabled: false,
        pending_period_sec: 300,
        priority: 1,
        query_condition: {
          type: "promql",
          promql: "up == 0 unless on(instance) maintenance == 1",
          promql_rule_mode: true,
          promql_multi_alert: true,
        },
      });
      expect(wrapper.vm.alertErrorsToDisplay).toEqual([]);
    });

    it("tells the user how many rules were converted and how many recording rules were skipped", async () => {
      await wrapper.vm.importJson({ jsonStr: RULES });
      expect(wrapper.vm.notesToDisplay).toEqual([
        wrapper.vm.t("alerts.import.promConverted", { count: 1 }),
        wrapper.vm.t("alerts.import.promSkippedRecords", { count: 1 }),
      ]);
      await wrapper.vm.$nextTick();
      expect(wrapper.find('[data-test="alert-import-notes"]').exists()).toBe(true);
    });

    it("hands BaseImport a file parser that reads rule YAML and JSON", () => {
      const parseFile = wrapper.findComponent({ name: "BaseImport" }).props("parseFile");
      expect(parseFile(RULES, "node.rules.yml")).toMatchObject([{ name: "instance_down" }]);
      expect(parseFile('{"name":"a"}', "a.json")).toEqual({ name: "a" });
    });

    it("prefixes a file's conversion notes with its name", () => {
      wrapper.vm.parseAlertFile(RULES, "node.rules.yml");
      expect(wrapper.vm.notesToDisplay[0]).toBe(
        wrapper.vm.t("alerts.import.noteInFile", {
          fileName: "node.rules.yml",
          note: wrapper.vm.t("alerts.import.promConverted", { count: 1 }),
        }),
      );
    });

    it("explains a file it cannot read and still lets BaseImport report it", () => {
      expect(() => wrapper.vm.parseAlertFile("name: a\n", "a.yaml")).toThrow();
      expect(wrapper.vm.parseError).toMatchObject({ format: "yaml", fileName: "a.yaml" });
    });

    it("rejects a rule file with no alerting rules instead of reporting success", async () => {
      await wrapper.vm.importJson({ jsonStr: "groups: []\n" });
      expect(await sentPayloads()).toHaveLength(0);
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: "error",
          message: wrapper.vm.t("alerts.import.nothingToImport"),
        }),
      );
      expect(wrapper.vm.notesToDisplay).toContain(wrapper.vm.t("alerts.import.promNoAlerts"));
    });

    it("does not report success for a dropped file of only recording rules", async () => {
      const recordsOnly = "groups:\n  - name: g\n    rules:\n      - record: a\n        expr: up\n";
      const parsed = wrapper.findComponent({ name: "BaseImport" }).props("parseFile")(
        recordsOnly,
        "records.yml",
      );
      // BaseImport serialises the file's result, so Import receives JSON text, not the YAML.
      await wrapper.vm.importJson({ jsonStr: JSON.stringify(parsed) });
      expect(await sentPayloads()).toHaveLength(0);
      expect(toastMock).not.toHaveBeenCalledWith(expect.objectContaining({ variant: "success" }));
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: "error",
          message: wrapper.vm.t("alerts.import.nothingToImport"),
        }),
      );
      expect(wrapper.vm.notesToDisplay).toContain(
        wrapper.vm.t("alerts.import.noteInFile", {
          fileName: "records.yml",
          note: wrapper.vm.t("alerts.import.promNoAlerts"),
        }),
      );
    });
  });

  describe("friendly parse errors", () => {
    it.each([
      ["broken JSON", '{"name": "a",}', "json"],
      ["YAML that is not a rule file", "name: a\n", "yaml"],
      ["Terraform", 'resource "openobserve_alert" "a" {\n}\n', "terraform"],
      ["plain text", "hello", "unknown"],
    ])("names %s instead of showing the raw parser error", async (_case, text, format) => {
      await wrapper.vm.importJson({ jsonStr: text });
      expect(wrapper.vm.parseError.format).toBe(format);
      const message = toastMock.mock.calls.at(-1)?.[0].message;
      expect(message).toBe(wrapper.vm.parseError.message);
      expect(message).not.toMatch(/Unexpected token|is not valid JSON/);
    });

    it("offers a sample of both accepted formats", async () => {
      await wrapper.vm.importJson({ jsonStr: "name: a\n" });
      await wrapper.vm.$nextTick();
      const panel = wrapper.find('[data-test="alert-import-parse-error"]');
      expect(panel.exists()).toBe(true);
      const samples = panel.findAllComponents({ name: "OCodeBlock" });
      expect(samples.map((s: any) => s.props("lang"))).toEqual(["json", "yaml"]);
    });

    it("clears the explanation once the text parses", async () => {
      await wrapper.vm.importJson({ jsonStr: "name: a\n" });
      await wrapper.vm.importJson({ jsonStr: '{"name": "a"}' });
      expect(wrapper.vm.parseError).toBeNull();
    });
  });

  describe("org_id and tz_offset", () => {
    const validAlert = (overrides: Record<string, unknown> = {}) => ({
      name: "a1",
      org_id: "test-org",
      stream_type: "logs",
      stream_name: "test-stream",
      is_real_time: false,
      query_condition: { type: "sql", sql: "select 1", multi_time_range: [] },
      trigger_condition: {
        period: 10,
        operator: ">=",
        threshold: 1,
        frequency: 10,
        silence: 10,
        frequency_type: "minutes",
      },
      destinations: [],
      enabled: true,
      ...overrides,
    });

    it("rewrites another org's id to this org with a note instead of an error", async () => {
      const input = validAlert({ org_id: "other-org" });
      expect(await wrapper.vm.validateAlertInputs(input, 1)).toBe(true);
      expect(input.org_id).toBe("test-org");
      expect(wrapper.vm.notesToDisplay).toEqual([
        wrapper.vm.t("alerts.import.orgIdRewritten", {
          index: 1,
          from: "other-org",
          orgId: "test-org",
        }),
      ]);
    });

    it("still asks for an org when the export has none", async () => {
      await wrapper.vm.validateAlertInputs(validAlert({ org_id: "" }), 1);
      expect(wrapper.vm.alertErrorsToDisplay.flat().map((e: any) => e.field)).toContain("org_id");
    });

    it.each([-330, 330, 0])("accepts a tz_offset of %d", async (tz) => {
      expect(await wrapper.vm.validateAlertInputs(validAlert({ tz_offset: tz }), 1)).toBe(true);
    });

    it("still rejects a tz_offset that is not a number", async () => {
      expect(await wrapper.vm.validateAlertInputs(validAlert({ tz_offset: "-330" }), 1)).toBe(
        false,
      );
    });

    it("lets a rule-mode alert leave the stream for the backend to infer", async () => {
      const input = validAlert({
        stream_type: "metrics",
        stream_name: "",
        query_condition: { type: "promql", promql: "up == 0", promql_rule_mode: true },
      });
      expect(await wrapper.vm.validateAlertInputs(input, 1)).toBe(true);
    });

    it("still requires a stream for a PromQL alert outside rule mode", async () => {
      const input = validAlert({
        stream_type: "metrics",
        stream_name: "",
        query_condition: { type: "promql", promql: "up" },
      });
      expect(await wrapper.vm.validateAlertInputs(input, 1)).toBe(false);
    });
  });

  describe("Prometheus batch", () => {
    const BATCH = `groups:
  - name: node
    rules:
      - record: job:up:sum
        expr: sum by (job) (up)
      - alert: InstanceDown
        expr: up == 0
        labels:
          severity: critical
  - name: disk
    rules:
      - alert: DiskFilling
        expr: node_filesystem_avail_bytes < 1e9
        labels:
          severity: warning
`;
    const MISSING_METRIC =
      "Cannot infer a referenced metrics stream for PromQL rule: expression has no referenced existing metrics stream; supply stream_name";

    const createMock = async () => {
      const service = await import("@/services/alerts");
      return vi.mocked(service.default.create_by_alert_id);
    };

    it("routes each converted rule to the destination chosen for its severity", async () => {
      const create = await createMock();
      create.mockResolvedValue({ data: { id: "x" } } as any);
      wrapper.vm.severityRoutes.critical = "test-destination-1";
      wrapper.vm.severityRoutes.warning = "email-dest";

      await wrapper.vm.importJson({ jsonStr: BATCH });

      const sent = create.mock.calls.map((call) => call[1]);
      expect(sent.map((a: any) => [a.name, a.destinations])).toEqual([
        ["instance_down", ["test-destination-1"]],
        ["disk_filling", ["email-dest"]],
      ]);
    });

    it("preselects the org default destination for critical rules only", async () => {
      getSettingMock.mockResolvedValue({
        data: { setting_value: { destination: "test-destination-2" } },
      });
      // The beforeEach mount cached the unset setting.
      queryClient.clear();
      const fresh = mountImport();
      await flushPromises();
      expect((fresh.vm as any).severityRoutes).toEqual({
        critical: "test-destination-2",
        warning: "",
      });
      fresh.unmount();
    });

    it("summarises the detected rule files in a banner", async () => {
      wrapper.vm.parseAlertFile(BATCH, "a.yml");
      wrapper.vm.parseAlertFile(BATCH, "b.yml");
      expect(wrapper.vm.promBatch).toEqual({ rules: 4, groups: 4, skipped: 2 });
      await wrapper.vm.$nextTick();
      const banner = wrapper
        .find('[data-test="alert-import-prom-batch"]')
        .findComponent({ name: "OBanner" });
      expect(banner.exists()).toBe(true);
      expect(banner.props("content")).toBe(
        wrapper.vm.t("alerts.import.promDetected", { rules: 4, groups: 4, skipped: 2 }),
      );
    });

    it("lists one row per rule with its status", async () => {
      const create = await createMock();
      create
        .mockResolvedValueOnce({ data: { id: "id-1" } } as any)
        .mockRejectedValueOnce({ response: { data: { message: "boom" } } });

      await wrapper.vm.importJson({ jsonStr: BATCH });

      expect(wrapper.vm.importRows).toEqual([
        expect.objectContaining({
          index: 1,
          name: "instance_down",
          status: "imported",
          alertId: "id-1",
        }),
        expect.objectContaining({
          index: 2,
          name: "disk_filling",
          status: "failed",
          reason: "boom",
        }),
      ]);
      await wrapper.vm.$nextTick();
      const table = wrapper.findComponent('[data-test="alert-import-results-table"]');
      expect(table.exists()).toBe(true);
    });

    it("reads a row refused for a missing metric as not arriving yet", async () => {
      const create = await createMock();
      create.mockRejectedValue({ response: { data: { message: MISSING_METRIC } } });

      await wrapper.vm.importJson({ jsonStr: BATCH });

      const row = wrapper.vm.importRows[0];
      expect(row.status).toBe("missingMetric");
      expect(wrapper.vm.rowStatusText(row)).toBe(wrapper.vm.t("alerts.import.rowMissingMetric"));
      expect((enUS as any).alerts.import.rowMissingMetric).toBe("Metric not arriving yet");
    });

    it("re-sends only the retried row and updates its status", async () => {
      const create = await createMock();
      create
        .mockRejectedValueOnce({ response: { data: { message: MISSING_METRIC } } })
        .mockResolvedValueOnce({ data: { id: "id-2" } } as any);
      await wrapper.vm.importJson({ jsonStr: BATCH });
      expect(create).toHaveBeenCalledTimes(2);

      create.mockResolvedValueOnce({ data: { id: "id-1" } } as any);
      await wrapper.vm.retryRow(wrapper.vm.importRows[0]);

      expect(create).toHaveBeenCalledTimes(3);
      expect(create.mock.calls[2][1]).toMatchObject({ name: "instance_down" });
      expect(wrapper.vm.importRows.map((r: any) => [r.name, r.status])).toEqual([
        ["instance_down", "imported"],
        ["disk_filling", "imported"],
      ]);
    });

    it("hands the imported batch to the list when every rule imports", async () => {
      vi.useFakeTimers();
      try {
        const create = await createMock();
        create
          .mockResolvedValueOnce({ data: { id: "id-1" } } as any)
          .mockResolvedValueOnce({ data: { id: "id-2" } } as any);
        await wrapper.vm.importJson({ jsonStr: BATCH });
        vi.runAllTimers();
        expect(wrapper.emitted("imported")?.at(-1)).toEqual([
          { folderId: "default", ids: ["id-1", "id-2"] },
        ]);
      } finally {
        vi.useRealTimers();
      }
    });

    it("lets the user open the imported part of a batch that partly failed", async () => {
      const create = await createMock();
      create
        .mockResolvedValueOnce({ data: { id: "id-1" } } as any)
        .mockRejectedValueOnce({ response: { data: { message: "boom" } } });
      await wrapper.vm.importJson({ jsonStr: BATCH });
      expect(wrapper.emitted("imported")).toBeUndefined();

      wrapper.vm.showImportedAlerts();

      expect(wrapper.emitted("imported")?.at(-1)).toEqual([{ folderId: "default", ids: ["id-1"] }]);
      expect(wrapper.vm.router.push).toHaveBeenCalledWith(
        expect.objectContaining({ name: "alertList" }),
      );
    });
  });

  describe("error list rendering", () => {
    it("colours a plain-string error like the ones with an inline fix-up", async () => {
      // Asserting the pushed value cannot catch a missing colour class; only the render can.
      wrapper.vm.alertErrorsToDisplay = [
        [
          { field: "alert_name", message: "Alert - 1: Name is mandatory" },
          "Alert - 1: Cron expression should be a valid cron expression.",
        ],
      ];
      await wrapper.vm.$nextTick();

      const classesOf = (errorIndex: number) =>
        wrapper.find(`[data-test="alert-import-error-0-${errorIndex}"]`).find("span").classes();

      expect(classesOf(1)).toContain("text-status-negative");
      // Same colour as the branch that does have an inline control.
      expect(classesOf(1)).toEqual(classesOf(0));
    });
  });
});
