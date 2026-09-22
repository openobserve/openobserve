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

import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import Ingestion from "@/views/Ingestion.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import organizationsService from "@/services/organizations";
import apiKeysService from "@/services/api_keys";
import segment from "@/services/segment_analytics";
import { queryClient } from "@/composables/query/queryClient";

// Mock services with default resolved values
vi.mock("@/services/organizations", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: {
      get_organization_passcode: vi.fn(() =>
        Promise.resolve({
          data: {
            data: {
              token: "default-token",
              passcode: "default-passcode",
            },
          },
        }),
      ),
      update_organization_passcode: vi.fn(() =>
        Promise.resolve({
          data: {
            data: {
              token: "updated-token",
              passcode: "updated-passcode",
            },
          },
        }),
      ),
      list_org_ingestion_tokens: vi.fn(() =>
        Promise.resolve({
          data: {
            data: [],
          },
        }),
      ),
    },
  });
});

vi.mock("@/services/api_keys", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: {
      createRUMToken: vi.fn(() =>
        Promise.resolve({
          data: {
            data: {
              new_key: "default-rum-token",
            },
          },
        }),
      ),
      updateRUMToken: vi.fn(() =>
        Promise.resolve({
          data: { success: true },
        }),
      ),
      listRUMTokens: vi.fn(() =>
        Promise.resolve({
          data: {
            data: {
              rum_token: "default-rum-token",
              id: "default-rum-id",
            },
          },
        }),
      ),
    },
  });
});

vi.mock("@/services/segment_analytics", () => ({
  default: {
    track: vi.fn(),
  },
}));

vi.mock("@/utils/zincutils", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getImageURL: vi.fn(() => "mock-image-url"),
    verifyOrganizationStatus: vi.fn(),
    mergeRoutes: vi.fn((routes1, routes2) => [...(routes1 || []), ...(routes2 || [])]),
    getPath: vi.fn(() => "/"),
    useLocalOrganization: vi.fn(() => ({ value: "default" })),
    useLocalCurrentUser: vi.fn(() => ({ value: "test-user" })),
  };
});

vi.mock("@/aws-exports", () => ({
  default: {
    aws_project_region: "us-east-1",
    aws_cognito_region: "us-east-1",
  },
}));

// Mock clipboard and toast
const mockNotify = vi.fn();

vi.mock("@/utils/clipboard", () => ({
  copyToClipboard: vi.fn(),
}));

vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: (...args: any[]) => mockNotify(...args),
}));

describe("Ingestion", () => {
  let wrapper: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    // vi.clearAllMocks() clears calls but KEEPS a mockRejectedValue set by a
    // previous test. onBeforeMount now reads the passcode, so a leftover
    // rejection would settle into the next test's spies. Re-establish a benign
    // default, and start every test from a cold query cache.
    queryClient.clear();
    organizationsService.get_organization_passcode.mockResolvedValue({
      data: { data: { token: "default-token", passcode: "default-passcode" } },
    });
    store.state.organizationData.organizationPasscodeForbidden = false;

    try {
      wrapper = mount(Ingestion, {
        global: {
          provide: {
            store: store,
          },
          plugins: [i18n, router],
          stubs: {
            ConfirmDialog: {
              name: "ConfirmDialog",
              template: '<div class="mock-confirm-dialog"><slot /></div>',
              props: ["title", "message", "modelValue"],
              emits: ["update:ok", "update:cancel"],
            },
            OButton: {
              template: '<button class="o-button-stub" @click="$emit(\'click\')"><slot /></button>',
              props: ["variant", "size", "disabled", "icon", "title", "data-test", "class"],
              emits: ["click"],
            },
            OTabs: {
              template: '<div class="o-tabs-stub"><slot /></div>',
              props: ["modelValue", "horizontal", "align"],
              emits: ["update:modelValue"],
            },
            ORouteTab: {
              template: '<div class="o-route-tab-stub"><slot /></div>',
              props: ["name", "to", "label", "icon"],
            },
            "router-view": {
              template:
                '<div class="router-view" @copy-to-clipboard-fn="$emit(\'copy-to-clipboard-fn\', $event)"><slot /></div>',
              emits: ["copy-to-clipboard-fn"],
            },
          },
        },
      });
      await flushPromises();
    } catch (error) {
      console.error("Error mounting component:", error);
      wrapper = null;
    }
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
      wrapper = null;
    }
  });

  describe("Component Initialization", () => {
    it("should render component correctly", () => {
      if (!wrapper) {
        expect.fail("Component failed to mount");
        return;
      }
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.find(".ingestionPage").exists()).toBe(true);
    });

    it("should have correct component name", () => {
      if (!wrapper) {
        expect.fail("Component failed to mount");
        return;
      }
      expect(wrapper.vm.$options.name).toBe("PageIngestion");
    });

    it("should initialize reactive properties correctly", () => {
      if (!wrapper) {
        expect.fail("Component failed to mount");
        return;
      }
      expect(wrapper.vm.confirmUpdate).toBe(false);
      expect(wrapper.vm.confirmRUMUpdate).toBe(false);
      expect(wrapper.vm.ingestTabType).toBe("recommended");
      expect(wrapper.vm.activeTab).toBe("recommended");
      expect(wrapper.vm.currentOrgIdentifier).toBe("default");
    });

    it("should have correct tabs configuration", () => {
      if (!wrapper) {
        expect.fail("Component failed to mount");
        return;
      }
      expect(wrapper.vm.tabs).toHaveLength(3);
      expect(wrapper.vm.tabs[0].value).toBe("recommended");
      expect(wrapper.vm.tabs[1].value).toBe("custom");
      expect(wrapper.vm.tabs[2].value).toBe("database");
    });

    it("should have correct route arrays", () => {
      if (!wrapper) {
        expect.fail("Component failed to mount");
        return;
      }
      expect(wrapper.vm.rumRoutes).toEqual(["frontendMonitoring"]);
      expect(wrapper.vm.metricRoutes).toEqual([
        "prometheus",
        "vmagent",
        "nightingale",
        "categraf",
        "otelCollector",
        "telegraf",
        "cloudwatchMetrics",
      ]);
      expect(wrapper.vm.traceRoutes).toEqual(["tracesOTLP"]);
    });
  });

  describe("generateRUMToken", () => {
    it("should successfully generate RUM token", async () => {
      if (!wrapper) {
        expect.fail("Component failed to mount");
        return;
      }

      const mockResponse = {
        data: {
          data: {
            new_key: "test-rum-token-123",
          },
        },
      };

      apiKeysService.createRUMToken.mockResolvedValue(mockResponse);
      apiKeysService.listRUMTokens.mockResolvedValue({
        data: { data: { rum_token: "test-rum-token-123" } },
      });

      const dispatchSpy = vi.spyOn(wrapper.vm.store, "dispatch");

      await wrapper.vm.generateRUMToken();

      expect(apiKeysService.createRUMToken).toHaveBeenCalledWith("default");
      expect(dispatchSpy).toHaveBeenCalledWith("setRUMToken", { rum_token: "test-rum-token-123" });
      expect(mockNotify).toHaveBeenCalledWith({
        variant: "success",
        message: "RUM Token generated successfully.",
        timeout: 5000,
      });
      expect(segment.track).toHaveBeenCalledWith("Button Click", {
        button: "Generate RUM Token",
        user_org: "default",
        user_id: "example@gmail.com",
        page: "Ingestion",
      });
    });

    it("should handle error when generating RUM token (non-403 error)", async () => {
      if (!wrapper) {
        expect.fail("Component failed to mount");
        return;
      }

      const mockError = {
        response: {
          status: 500,
          data: { message: "Internal server error" },
        },
      };

      apiKeysService.createRUMToken.mockRejectedValue(mockError);

      // Test that the function executes without throwing an error
      expect(() => wrapper.vm.generateRUMToken()).not.toThrow();

      // Wait a bit for async operations
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Verify that the service was called
      expect(apiKeysService.createRUMToken).toHaveBeenCalledWith("default");
    });

    it("should handle error when generating RUM token (403 error - should not notify)", async () => {
      if (!wrapper) {
        expect.fail("Component failed to mount");
        return;
      }

      const mockError = {
        response: {
          status: 403,
          data: { message: "Forbidden" },
        },
      };

      apiKeysService.createRUMToken.mockRejectedValue(mockError);

      await wrapper.vm.generateRUMToken();

      expect(mockNotify).not.toHaveBeenCalled();
    });

    it("should handle error without response message", async () => {
      if (!wrapper) {
        expect.fail("Component failed to mount");
        return;
      }

      const mockError = {
        response: {
          status: 500,
          data: {},
        },
      };

      apiKeysService.createRUMToken.mockRejectedValue(mockError);

      // Test that the function executes without throwing an error
      expect(() => wrapper.vm.generateRUMToken()).not.toThrow();

      // Wait a bit for async operations
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Verify that the service was called
      expect(apiKeysService.createRUMToken).toHaveBeenCalledWith("default");
    });
  });

  describe("updateRUMToken", () => {
    beforeEach(() => {
      if (wrapper && wrapper.vm) {
        wrapper.vm.store.state.organizationData.rumToken.id = "rum-token-id-123";
      }
    });

    it("should successfully update RUM token", async () => {
      if (!wrapper) {
        expect.fail("Component failed to mount");
        return;
      }

      const mockResponse = { data: { success: true } };
      apiKeysService.updateRUMToken.mockResolvedValue(mockResponse);
      apiKeysService.listRUMTokens.mockResolvedValue({
        data: { data: { rum_token: "updated-rum-token" } },
      });

      await wrapper.vm.updateRUMToken();

      expect(apiKeysService.updateRUMToken).toHaveBeenCalledWith("default", "rum-token-id-123");
      expect(mockNotify).toHaveBeenCalledWith({
        variant: "success",
        message: "RUM Token updated successfully.",
        timeout: 5000,
      });
      expect(segment.track).toHaveBeenCalledWith("Button Click", {
        button: "Update RUM Token",
        user_org: "default",
        user_id: "example@gmail.com",
        page: "Ingestion",
      });
    });

    it("should handle error when updating RUM token (non-403 error)", async () => {
      if (!wrapper) {
        expect.fail("Component failed to mount");
        return;
      }

      const mockError = {
        response: {
          status: 500,
          data: { message: "Server error" },
        },
      };

      apiKeysService.updateRUMToken.mockRejectedValue(mockError);

      // Test that the function executes without throwing an error
      expect(() => wrapper.vm.updateRUMToken()).not.toThrow();

      // Wait a bit for async operations
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Verify that the service was called
      expect(apiKeysService.updateRUMToken).toHaveBeenCalled();
    });

    it("should handle error when updating RUM token (403 error - should not notify)", async () => {
      if (!wrapper) {
        expect.fail("Component failed to mount");
        return;
      }

      const mockError = {
        response: {
          status: 403,
          data: { message: "Forbidden" },
        },
      };

      apiKeysService.updateRUMToken.mockRejectedValue(mockError);

      await wrapper.vm.updateRUMToken();

      expect(mockNotify).not.toHaveBeenCalled();
    });

    it("should handle error without response message", async () => {
      if (!wrapper) {
        expect.fail("Component failed to mount");
        return;
      }

      const mockError = {
        response: {
          status: 500,
          data: {},
        },
      };

      apiKeysService.updateRUMToken.mockRejectedValue(mockError);

      // Test that the function executes without throwing an error
      expect(() => wrapper.vm.updateRUMToken()).not.toThrow();

      // Wait a bit for async operations
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Verify that the service was called
      expect(apiKeysService.updateRUMToken).toHaveBeenCalled();
    });
  });

  // The feature this guards was previously dead code: the 403 handling lived in
  // getOrganizationPasscode(), which onBeforeMount never called, so the banner
  // could never appear in the running app while unit tests that invoked the
  // method directly still passed. These tests mount the component and drive the
  // REAL lifecycle entry point, so they fail if the wiring is removed again.
  describe("passcode 403 via the real mount path", () => {
    const mountIngestion = async () => {
      const w = mount(Ingestion, {
        global: {
          provide: { store },
          plugins: [i18n, router],
          stubs: {
            ConfirmDialog: { template: "<div />" },
            OButton: { template: "<button><slot /></button>" },
            OTabs: { template: "<div><slot /></div>" },
            ORouteTab: { template: "<div><slot /></div>" },
            "router-view": { template: "<div />" },
          },
        },
      });
      await flushPromises();
      return w;
    };

    beforeEach(() => {
      queryClient.clear();
      store.state.organizationData.organizationPasscodeForbidden = false;
    });

    it("sets organizationPasscodeForbidden on mount when /passcode returns 403", async () => {
      organizationsService.get_organization_passcode.mockRejectedValue({
        response: { status: 403 },
      });

      const w = await mountIngestion();

      // Asserting store state (not a spy) — this is what the banner renders from.
      expect(store.state.organizationData.organizationPasscodeForbidden).toBe(true);
      // The passcode must not have been overwritten with an empty credential.
      expect(store.state.organizationData.organizationPasscode).not.toBe("");
      w.unmount();
    });

    it("leaves organizationPasscodeForbidden false on mount for a non-403 failure", async () => {
      organizationsService.get_organization_passcode.mockRejectedValue({
        response: { status: 500 },
      });

      const w = await mountIngestion();

      expect(store.state.organizationData.organizationPasscodeForbidden).toBe(false);
      w.unmount();
    });

    it("leaves organizationPasscodeForbidden false on mount when the passcode loads", async () => {
      organizationsService.get_organization_passcode.mockResolvedValue({
        data: { data: { passcode: "live-passcode", user: "a@b.c" } },
      });

      const w = await mountIngestion();

      expect(store.state.organizationData.organizationPasscodeForbidden).toBe(false);
      expect(store.state.organizationData.organizationPasscode).toBe("live-passcode");
      w.unmount();
    });
  });

  // Regression: the 403 banner used to be defeated by a race.
  //
  // onBeforeMount fires GET /{org}/ingestion-tokens and GET /{org}/passcode
  // concurrently. Both are now guarded server-side by the same check, so they
  // agree — but they are still two independent requests, and a tokens response
  // already in flight (or served from cache) can land alongside a passcode 403.
  // When it did, the tokenOptions watcher dispatched
  // setOrganizationPasscodeForbidden(false) plus the real token, so whichever
  // promise resolved last decided whether the credential was shown — and the
  // banner was routinely cleared right after a 403 had been observed.
  //
  // The rest of the suite could not catch this because list_org_ingestion_tokens
  // defaults to an EMPTY list, so the tokenOptions watcher never ran. These
  // tests stub a NON-EMPTY token list alongside the 403 — the configuration that
  // actually reproduces it.
  //
  // NOTE: assertions read `w.vm.store`, the store the component itself resolves
  // through useStore(). That is the real app store, NOT the `store` helper this
  // file only *provides* — asserting on the helper would silently observe an
  // object the component never writes to.
  describe("passcode 403 is authoritative over a concurrent /ingestion-tokens", () => {
    const ORG_TOKEN = "o2oi_orgwide_token_value";

    const mountIngestion = async () => {
      const w = mount(Ingestion, {
        global: {
          provide: { store },
          plugins: [i18n, router],
          stubs: {
            ConfirmDialog: { template: "<div />" },
            OButton: { template: "<button><slot /></button>" },
            OTabs: { template: "<div><slot /></div>" },
            ORouteTab: { template: "<div><slot /></div>" },
            "router-view": { template: "<div />" },
          },
        },
      });
      await flushPromises();
      return w;
    };

    const orgData = (w: any) => w.vm.store.state.organizationData;

    const tokenRow = {
      name: "default",
      token: ORG_TOKEN,
      enabled: true,
      is_default: true,
      description: "",
      created_by: "a@b.c",
      created_at: 0,
    };

    const stubNonEmptyTokens = () => {
      // The query returns the axios body; fetchOrgTokens then dispatches its
      // `.data`, so the token array has to sit one level deeper than it looks.
      organizationsService.list_org_ingestion_tokens.mockResolvedValue({
        data: { data: [tokenRow] },
      });
    };

    beforeEach(() => {
      queryClient.clear();
      organizationsService.list_org_ingestion_tokens.mockResolvedValue({ data: { data: [] } });
    });

    afterEach(() => {
      organizationsService.list_org_ingestion_tokens.mockResolvedValue({ data: { data: [] } });
    });

    it("keeps the banner when /ingestion-tokens succeeds and /passcode 403s", async () => {
      stubNonEmptyTokens();
      organizationsService.get_organization_passcode.mockRejectedValue({
        response: { status: 403 },
      });

      const w = await mountIngestion();

      // The tokens response really did arrive — otherwise this would be
      // re-proving the already-covered empty-list case rather than the race.
      expect(orgData(w).orgTokens).toHaveLength(1);
      // ...and the observed 403 survived it.
      expect(orgData(w).organizationPasscodeForbidden).toBe(true);
      // The org-wide credential must not have been published by the selector.
      expect(orgData(w).organizationPasscode).not.toBe(ORG_TOKEN);
      w.unmount();
    });

    it("keeps the banner when the tokens response lands AFTER the 403", async () => {
      // Ordering must not matter. Here the passcode rejects promptly and the
      // token list resolves on a later macrotask — the opposite interleaving.
      organizationsService.get_organization_passcode.mockRejectedValue({
        response: { status: 403 },
      });
      organizationsService.list_org_ingestion_tokens.mockImplementation(
        () =>
          new Promise((resolve) => setTimeout(() => resolve({ data: { data: [tokenRow] } }), 0)),
      );

      const w = await mountIngestion();
      await new Promise((resolve) => setTimeout(resolve, 5));
      await flushPromises();

      expect(orgData(w).orgTokens).toHaveLength(1);
      expect(orgData(w).organizationPasscodeForbidden).toBe(true);
      expect(orgData(w).organizationPasscode).not.toBe(ORG_TOKEN);
      w.unmount();
    });

    it("does not let picking a token from the dropdown clear an observed 403", async () => {
      stubNonEmptyTokens();
      organizationsService.get_organization_passcode.mockRejectedValue({
        response: { status: 403 },
      });

      const w = await mountIngestion();
      expect(orgData(w).organizationPasscodeForbidden).toBe(true);

      // User-initiated rather than a race, but the rule is the same: a 403 means
      // the credential was never this role's to see.
      w.vm.onTokenSelected("default");
      await flushPromises();

      expect(orgData(w).organizationPasscodeForbidden).toBe(true);
      expect(orgData(w).organizationPasscode).not.toBe(ORG_TOKEN);
      w.unmount();
    });

    it("still shows tokens to a caller the passcode endpoint allows", async () => {
      // The guard must not become a blanket "never show tokens": an Admin/Root
      // (or an FGA-granted user) gets a 200 and the selector works as before.
      stubNonEmptyTokens();
      organizationsService.get_organization_passcode.mockResolvedValue({
        data: { data: { passcode: "allowed-passcode", user: "a@b.c" } },
      });

      const w = await mountIngestion();

      expect(orgData(w).organizationPasscodeForbidden).toBe(false);
      expect(orgData(w).orgTokens).toHaveLength(1);

      w.vm.onTokenSelected("default");
      await flushPromises();

      expect(orgData(w).organizationPasscode).toBe(ORG_TOKEN);
      expect(orgData(w).organizationPasscodeForbidden).toBe(false);
      w.unmount();
    });

    it("re-evaluates after an org switch instead of latching forever", async () => {
      stubNonEmptyTokens();
      organizationsService.get_organization_passcode.mockRejectedValue({
        response: { status: 403 },
      });

      const w = await mountIngestion();
      expect(orgData(w).organizationPasscodeForbidden).toBe(true);

      // Switch orgs: MainLayout wipes organizationData, and the new org's own
      // passcode read (a 200 here) must be free to decide again.
      const componentStore = w.vm.store;
      const previous = componentStore.state.selectedOrganization.identifier;
      componentStore.state.selectedOrganization = {
        ...componentStore.state.selectedOrganization,
        identifier: `${previous}-other`,
      };
      componentStore.dispatch("setOrganizationPasscodeForbidden", false);
      await flushPromises();

      organizationsService.get_organization_passcode.mockResolvedValue({
        data: { data: { passcode: "other-org-passcode", user: "a@b.c" } },
      });
      queryClient.clear();
      await w.vm.getOrganizationPasscode();
      await flushPromises();

      expect(orgData(w).organizationPasscodeForbidden).toBe(false);
      expect(orgData(w).organizationPasscode).toBe("other-org-passcode");

      componentStore.state.selectedOrganization = {
        ...componentStore.state.selectedOrganization,
        identifier: previous,
      };
      w.unmount();
    });
  });

  // NOTE: these exercise getOrganizationPasscode() directly. They are retained
  // only because the function is now genuinely reachable (onBeforeMount calls
  // it); on their own they prove nothing about the app actually running it —
  // that is what the "real mount path" block above is for.
  describe("getOrganizationPasscode", () => {
    it("should successfully get organization passcode", async () => {
      if (!wrapper) {
        expect.fail("Component failed to mount");
        return;
      }

      const mockResponse = {
        data: {
          data: {
            token: "test-token",
            passcode: "test-passcode-123",
          },
        },
      };

      organizationsService.get_organization_passcode.mockResolvedValue(mockResponse);
      const dispatchSpy = vi.spyOn(wrapper.vm.store, "dispatch");

      // onBeforeMount now performs this read, so it is a cache hit for an hour —
      // drop it so the call under test reaches the mock above.
      queryClient.clear();
      await wrapper.vm.getOrganizationPasscode();

      expect(organizationsService.get_organization_passcode).toHaveBeenCalledWith("default");
      expect(dispatchSpy).toHaveBeenCalledWith("setOrganizationPasscode", "test-passcode-123");
      expect(wrapper.vm.currentOrgIdentifier).toBe("default");
    });

    it("should handle empty token response", async () => {
      if (!wrapper) {
        expect.fail("Component failed to mount");
        return;
      }

      const mockResponse = {
        data: {
          data: {
            token: "",
            passcode: "",
          },
        },
      };

      organizationsService.get_organization_passcode.mockResolvedValue(mockResponse);

      queryClient.clear();
      await wrapper.vm.getOrganizationPasscode();

      expect(mockNotify).toHaveBeenCalledWith({
        variant: "error",
        message: "Passcode not found.",
        timeout: 5000,
      });
    });

    it("should flag passcode as forbidden on 403 so snippets are withheld", async () => {
      if (!wrapper) {
        expect.fail("Component failed to mount");
        return;
      }

      organizationsService.get_organization_passcode.mockRejectedValue({
        response: { status: 403 },
      });
      const dispatchSpy = vi.spyOn(wrapper.vm.store, "dispatch");

      queryClient.clear();
      await wrapper.vm.getOrganizationPasscode();

      expect(dispatchSpy).toHaveBeenCalledWith("setOrganizationPasscodeForbidden", true);
      expect(dispatchSpy).not.toHaveBeenCalledWith("setOrganizationPasscode", "");
    });

    it("should stay silent and not flag forbidden on a non-403 error", async () => {
      if (!wrapper) {
        expect.fail("Component failed to mount");
        return;
      }

      organizationsService.get_organization_passcode.mockRejectedValue({
        response: { status: 500 },
      });
      const dispatchSpy = vi.spyOn(wrapper.vm.store, "dispatch");

      queryClient.clear();
      await wrapper.vm.getOrganizationPasscode();

      expect(dispatchSpy).not.toHaveBeenCalledWith("setOrganizationPasscodeForbidden", true);
      expect(mockNotify).not.toHaveBeenCalled();
    });
  });

  describe("getRUMToken", () => {
    it("should successfully get RUM token", async () => {
      if (!wrapper) {
        expect.fail("Component failed to mount");
        return;
      }

      const mockResponse = {
        data: {
          data: {
            rum_token: "retrieved-rum-token",
            id: "token-id-123",
          },
        },
      };

      apiKeysService.listRUMTokens.mockResolvedValue(mockResponse);
      const dispatchSpy = vi.spyOn(wrapper.vm.store, "dispatch");

      // Mounting already cached a token, and the read is a cache hit for an
      // hour — drop it so the call under test reaches the mock above.
      queryClient.clear();
      await wrapper.vm.getRUMToken();

      expect(apiKeysService.listRUMTokens).toHaveBeenCalledWith("default");
      expect(dispatchSpy).toHaveBeenCalledWith("setRUMToken", mockResponse.data.data);
    });
  });

  describe("updatePasscode", () => {
    it("should successfully update passcode", async () => {
      if (!wrapper) {
        expect.fail("Component failed to mount");
        return;
      }

      const mockResponse = {
        data: {
          data: {
            token: "new-token",
            passcode: "new-passcode-123",
          },
        },
      };

      organizationsService.update_organization_passcode.mockResolvedValue(mockResponse);
      const dispatchSpy = vi.spyOn(wrapper.vm.store, "dispatch");

      await wrapper.vm.updatePasscode();

      expect(organizationsService.update_organization_passcode).toHaveBeenCalledWith("default");
      expect(dispatchSpy).toHaveBeenCalledWith("setOrganizationPasscode", "new-passcode-123");
      expect(mockNotify).toHaveBeenCalledWith({
        variant: "success",
        message: "Token reset successfully.",
        timeout: 5000,
      });
      expect(segment.track).toHaveBeenCalledWith("Button Click", {
        button: "Update Passcode",
        user_org: "default",
        user_id: "example@gmail.com",
        page: "Ingestion",
      });
    });

    it("should handle empty token response when updating passcode", async () => {
      if (!wrapper) {
        expect.fail("Component failed to mount");
        return;
      }

      const mockResponse = {
        data: {
          data: {
            token: "",
            passcode: "",
          },
        },
      };

      organizationsService.update_organization_passcode.mockResolvedValue(mockResponse);

      await wrapper.vm.updatePasscode();

      expect(mockNotify).toHaveBeenCalledWith({
        variant: "error",
        message: "Passcode not found.",
        timeout: 5000,
      });
    });

    it("should handle error when updating passcode (non-403 error)", async () => {
      if (!wrapper) {
        expect.fail("Component failed to mount");
        return;
      }

      const mockError = {
        response: {
          status: 500,
        },
        error: "Network error",
      };

      organizationsService.update_organization_passcode.mockRejectedValue(mockError);

      // Test that the function executes without throwing an error
      expect(() => wrapper.vm.updatePasscode()).not.toThrow();

      // Wait a bit for async operations
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Verify that the service was called
      expect(organizationsService.update_organization_passcode).toHaveBeenCalledWith("default");
    });

    it("should handle error when updating passcode (403 error - should not notify)", async () => {
      if (!wrapper) {
        expect.fail("Component failed to mount");
        return;
      }

      const mockError = {
        response: {
          status: 403,
        },
        error: "Forbidden",
      };

      organizationsService.update_organization_passcode.mockRejectedValue(mockError);

      await wrapper.vm.updatePasscode();

      expect(mockNotify).not.toHaveBeenCalled();
    });
  });

  describe("Simple Function Tests", () => {
    it("should set confirmRUMUpdate to true via showRUMUpdateDialogFn", () => {
      if (!wrapper) {
        expect.fail("Component failed to mount");
        return;
      }

      expect(wrapper.vm.confirmRUMUpdate).toBe(false);
      wrapper.vm.showRUMUpdateDialogFn();
      expect(wrapper.vm.confirmRUMUpdate).toBe(true);
    });

    it("should handle copyToClipboardFn successfully", async () => {
      if (!wrapper) {
        expect.fail("Component failed to mount");
        return;
      }

      const mockContent = {
        innerText: "test content to copy",
      };

      const { copyToClipboard } = await import("@/utils/clipboard");
      copyToClipboard.mockResolvedValue(true);

      await wrapper.vm.copyToClipboardFn(mockContent);
      await flushPromises();

      expect(copyToClipboard).toHaveBeenCalledWith("test content to copy", expect.any(Function), {
        successMessage: "Content Copied Successfully!",
        errorMessage: "Error while copy content.",
        timeout: 5000,
      });
    });

    it("should handle copyToClipboardFn error", async () => {
      if (!wrapper) {
        expect.fail("Component failed to mount");
        return;
      }

      const mockContent = {
        innerText: "test content to copy",
      };

      const { copyToClipboard } = await import("@/utils/clipboard");
      copyToClipboard.mockRejectedValue(new Error("Copy failed"));

      // Test that the function executes without throwing an error
      expect(() => wrapper.vm.copyToClipboardFn(mockContent)).not.toThrow();

      await flushPromises();

      // Verify that copyToClipboard was called
      expect(copyToClipboard).toHaveBeenCalledWith("test content to copy", expect.any(Function), {
        successMessage: "Content Copied Successfully!",
        errorMessage: "Error while copy content.",
        timeout: 5000,
      });
    });
  });

  describe("Template Rendering", () => {
    it("should render tabs correctly", () => {
      if (!wrapper) {
        expect.fail("Component failed to mount");
        return;
      }

      const tabs = wrapper.find(".o-tabs-stub");
      expect(tabs.exists()).toBe(true);
    });

    it("should render route tabs with correct properties", () => {
      if (!wrapper) {
        expect.fail("Component failed to mount");
        return;
      }

      const routeTabs = wrapper.findAll(".o-route-tab-stub");
      expect(routeTabs.length).toBeGreaterThan(0);
    });

    it("should render confirm dialogs", () => {
      if (!wrapper) {
        expect.fail("Component failed to mount");
        return;
      }

      const confirmDialogs = wrapper.findAll(".mock-confirm-dialog");
      expect(confirmDialogs).toHaveLength(1);
    });

    it("should render router-view", () => {
      if (!wrapper) {
        expect.fail("Component failed to mount");
        return;
      }

      const routerView = wrapper.find(".router-view");
      expect(routerView.exists()).toBe(true);
    });
  });

  describe("Conditional Button Rendering Logic", () => {
    it("should show reset RUM token button when rum token exists and route is in rumRoutes", async () => {
      if (!wrapper) {
        expect.fail("Component failed to mount");
        return;
      }

      wrapper.vm.store.state.organizationData.rumToken.rum_token = "existing-token";
      wrapper.vm.router.currentRoute.value.name = "frontendMonitoring";
      await wrapper.vm.$nextTick();

      const shouldShowResetRUM =
        wrapper.vm.rumRoutes.indexOf(wrapper.vm.router.currentRoute.value.name) > -1 &&
        wrapper.vm.store.state.organizationData.rumToken.rum_token !== "";

      expect(shouldShowResetRUM).toBe(true);
    });

    it("should show generate RUM token button when no rum token exists and route is in rumRoutes", async () => {
      if (!wrapper) {
        expect.fail("Component failed to mount");
        return;
      }

      wrapper.vm.store.state.organizationData.rumToken.rum_token = "";
      wrapper.vm.router.currentRoute.value.name = "frontendMonitoring";
      await wrapper.vm.$nextTick();

      const shouldShowGenerateRUM =
        wrapper.vm.rumRoutes.indexOf(wrapper.vm.router.currentRoute.value.name) > -1 &&
        wrapper.vm.store.state.organizationData.rumToken.rum_token === "";

      expect(shouldShowGenerateRUM).toBe(true);
    });

    it("should show reset token button for non-RUM routes", async () => {
      if (!wrapper) {
        expect.fail("Component failed to mount");
        return;
      }

      wrapper.vm.router.currentRoute.value.name = "logs";
      await wrapper.vm.$nextTick();

      const isRumRoute =
        wrapper.vm.rumRoutes.indexOf(wrapper.vm.router.currentRoute.value.name) > -1;
      expect(isRumRoute).toBe(false);
    });
  });

  describe("Warning Message Display Logic", () => {
    it("should show warning message when restricted routes condition is met", async () => {
      if (!wrapper) {
        expect.fail("Component failed to mount");
        return;
      }

      wrapper.vm.store.state.zoConfig.restricted_routes_on_empty_data = true;
      wrapper.vm.store.state.organizationData.isDataIngested = false;
      await wrapper.vm.$nextTick();

      const shouldShowWarning =
        Object.prototype.hasOwnProperty.call(
          wrapper.vm.store.state.zoConfig,
          "restricted_routes_on_empty_data",
        ) &&
        wrapper.vm.store.state.zoConfig.restricted_routes_on_empty_data === true &&
        wrapper.vm.store.state.organizationData.isDataIngested === false;

      expect(shouldShowWarning).toBe(true);
    });

    it("should not show warning message when data is ingested", async () => {
      if (!wrapper) {
        expect.fail("Component failed to mount");
        return;
      }

      wrapper.vm.store.state.zoConfig.restricted_routes_on_empty_data = true;
      wrapper.vm.store.state.organizationData.isDataIngested = true;
      await wrapper.vm.$nextTick();

      const shouldShowWarning =
        Object.prototype.hasOwnProperty.call(
          wrapper.vm.store.state.zoConfig,
          "restricted_routes_on_empty_data",
        ) &&
        wrapper.vm.store.state.zoConfig.restricted_routes_on_empty_data === true &&
        wrapper.vm.store.state.organizationData.isDataIngested === false;

      expect(shouldShowWarning).toBe(false);
    });
  });

  describe("Data Properties", () => {
    it("should have correct splitterModel value", () => {
      if (!wrapper) {
        expect.fail("Component failed to mount");
        return;
      }

      expect(wrapper.vm.splitterModel).toBe(200);
    });

    it("should have correct currentUserEmail", () => {
      if (!wrapper) {
        expect.fail("Component failed to mount");
        return;
      }

      expect(wrapper.vm.currentUserEmail).toBe("example@gmail.com");
    });

    it("should have correct config reference", () => {
      if (!wrapper) {
        expect.fail("Component failed to mount");
        return;
      }

      expect(wrapper.vm.config).toBeDefined();
    });

    it("should have getImageURL function available", () => {
      if (!wrapper) {
        expect.fail("Component failed to mount");
        return;
      }

      expect(wrapper.vm.getImageURL).toBeDefined();
      expect(typeof wrapper.vm.getImageURL).toBe("function");
    });

    it("should have correct router reference", () => {
      if (!wrapper) {
        expect.fail("Component failed to mount");
        return;
      }

      expect(wrapper.vm.router).toBeDefined();
    });

    it("should have correct store reference", () => {
      if (!wrapper) {
        expect.fail("Component failed to mount");
        return;
      }

      expect(wrapper.vm.store).toBeDefined();
    });
  });

  describe("Lifecycle Hooks Logic", () => {
    it("should determine when to call services on beforeMount", () => {
      if (!wrapper) {
        expect.fail("Component failed to mount");
        return;
      }

      wrapper.vm.store.state.organizationData.organizationPasscode = "";
      wrapper.vm.store.state.organizationData.rumToken.rum_token = "";
      wrapper.vm.store.state.selectedOrganization.identifier = "test-org";

      const shouldCallServices =
        (!wrapper.vm.store.state.organizationData.organizationPasscode ||
          !wrapper.vm.store.state.organizationData.rumToken.rum_token) &&
        wrapper.vm.store.state.selectedOrganization.identifier !== undefined;

      expect(shouldCallServices).toBe(true);
    });

    it("should not call services when organization identifier is undefined", () => {
      if (!wrapper) {
        expect.fail("Component failed to mount");
        return;
      }

      wrapper.vm.store.state.selectedOrganization.identifier = undefined;

      const shouldCallServices =
        (!wrapper.vm.store.state.organizationData.organizationPasscode ||
          !wrapper.vm.store.state.organizationData.rumToken.rum_token) &&
        wrapper.vm.store.state.selectedOrganization.identifier !== undefined;

      expect(shouldCallServices).toBe(false);
    });

    it("should handle route redirection logic correctly", () => {
      if (!wrapper) {
        expect.fail("Component failed to mount");
        return;
      }

      // Ensure organization identifier is set
      wrapper.vm.store.state.selectedOrganization.identifier = "default";

      const mockPush = vi.fn();
      wrapper.vm.router = {
        currentRoute: { value: { name: "ingestion" } },
        push: mockPush,
      };

      if (wrapper.vm.router.currentRoute.value.name === "ingestion") {
        wrapper.vm.router.push({
          name: "recommended",
          query: {
            org_identifier: wrapper.vm.store.state.selectedOrganization.identifier,
          },
        });
      }

      expect(mockPush).toHaveBeenCalledWith({
        name: "recommended",
        query: {
          org_identifier: "default",
        },
      });
    });
  });

  describe("Additional Edge Cases", () => {
    it("should handle updateRUMToken when no token ID is present", async () => {
      if (!wrapper) {
        expect.fail("Component failed to mount");
        return;
      }

      // Ensure organization identifier is set
      wrapper.vm.store.state.selectedOrganization.identifier = "default";
      wrapper.vm.store.state.organizationData.rumToken.id = undefined;

      const mockResponse = { data: { success: true } };
      apiKeysService.updateRUMToken.mockResolvedValue(mockResponse);

      await wrapper.vm.updateRUMToken();

      expect(apiKeysService.updateRUMToken).toHaveBeenCalledWith("default", undefined);
    });

    it("should handle generateRUMToken tracking with different organization", async () => {
      if (!wrapper) {
        expect.fail("Component failed to mount");
        return;
      }

      wrapper.vm.store.state.selectedOrganization.identifier = "test-org";
      wrapper.vm.store.state.userInfo.email = "test@example.com";

      const mockResponse = {
        data: {
          data: {
            new_key: "test-token",
          },
        },
      };

      apiKeysService.createRUMToken.mockResolvedValue(mockResponse);
      apiKeysService.listRUMTokens.mockResolvedValue({
        data: { data: { rum_token: "test-token" } },
      });

      await wrapper.vm.generateRUMToken();

      expect(segment.track).toHaveBeenCalledWith("Button Click", {
        button: "Generate RUM Token",
        user_org: "test-org",
        user_id: "test@example.com",
        page: "Ingestion",
      });
    });

    it("should handle copyToClipboardFn with different route name", async () => {
      if (!wrapper) {
        expect.fail("Component failed to mount");
        return;
      }

      // Reset to default user state
      wrapper.vm.store.state.selectedOrganization.identifier = "default";
      wrapper.vm.store.state.userInfo.email = "example@gmail.com";
      wrapper.vm.router.currentRoute.value.name = "custom";

      const mockContent = { innerText: "test content" };
      const { copyToClipboard } = await import("@/utils/clipboard");
      copyToClipboard.mockResolvedValue(true);

      await wrapper.vm.copyToClipboardFn(mockContent);
      await flushPromises();

      expect(segment.track).toHaveBeenCalledWith("Button Click", {
        button: "Copy to Clipboard",
        ingestion: "custom",
        user_org: "default",
        user_id: "example@gmail.com",
        page: "Ingestion",
      });
    });
  });
});
