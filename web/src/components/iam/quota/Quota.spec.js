import { describe, it, expect, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import i18n from "@/locales";

// Stub route guard and utils before router/component are imported
vi.mock("@/utils/zincutils", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    // minimal overrides used in Quota.vue and router guards
    getImageURL: vi.fn(() => "#"),
    getUUID: vi.fn(() => "uuid-1"),
    routeGuard: vi.fn((_to, _from, next) => next()),
  };
});

// Basic DOM/URL mocks similar to reference style
// @ts-expect-error - Partial URL mock for testing
global.URL = global.URL || {};
// @ts-expect-error - Attach functions if missing
if (typeof global.URL.createObjectURL !== "function") {
  // @ts-expect-error
  global.URL.createObjectURL = vi.fn(() => "blob://test");
}
// @ts-expect-error
if (typeof global.URL.revokeObjectURL !== "function") {
  // @ts-expect-error
  global.URL.revokeObjectURL = vi.fn();
}

import router from "@/test/unit/helpers/router";
import store from "@/test/unit/helpers/store";

// Avoid waiting for router.isReady() in tests
// @ts-ignore
router.isReady = () => Promise.resolve();
import Quota from "@/components/iam/quota/Quota.vue";

// Mocks
vi.mock("@/services/organizations", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: {
      os_list: vi.fn(async () => ({
        data: {
          data: [
            { name: "Org A", identifier: "org_a" },
            { name: "Org B", identifier: "org_b" },
          ],
        },
      })),
    },
  });
});
vi.mock("@/services/iam", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    getRoles: vi.fn(async () => ({ data: ["admin", "member"] })),
  });
});

// Mock toast — Quota.vue notifies via toast(), not a legacy notify plugin
const mockToast = vi.hoisted(() => vi.fn(() => vi.fn())); // toast returns a dismiss fn
vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: mockToast,
}));
vi.mock("@/services/rate_limit", () => ({
  default: {
    update_batch: vi.fn(async () => ({ status: 200, data: { message: "Saved" } })),
    download_template: vi.fn(async () => ({ status: 200, data: { some: "json" } })),
    upload_template: vi.fn(async () => ({ status: 200, data: { message: "Uploaded" } })),
  },
}));
vi.mock("@/composables/useRateLimiter", () => {
  const getApiLimitsByOrganization = vi.fn(async () => [
    { module_name: "module_1", list: 10, get: 20, create: 30, update: 40, delete: 50 },
    { module_name: "module_2", list: 10, get: "-", create: "-", update: 5, delete: 1 },
  ]);
  const getRoleLimitsByOrganization = vi.fn(async () => [
    { module_name: "module_1", list: 11, get: 21, create: 31, update: 41, delete: 51 },
  ]);
  const getModulesToDisplay = vi.fn(async () => [
    { label: "module_1", value: "module_1" },
    { label: "module_2", value: "module_2" },
  ]);
  return {
    default: () => ({
      getApiLimitsByOrganization,
      getRoleLimitsByOrganization,
      getModulesToDisplay,
    }),
  };
});

const iamSvc = await import("@/services/iam");

const mountQuota = async (routeQuery = {}) => {
  // ensure required store shape
  store.state.modulesToDisplay = store.state.modulesToDisplay || {};
  store.state.allApiLimitsByOrgId = store.state.allApiLimitsByOrgId || {};
  store.state.allRoleLimitsByOrgIdByRole = store.state.allRoleLimitsByOrgIdByRole || {};
  store.state.organizations = store.state.organizations || [];
  store.state.theme = store.state.theme || "light";

  await router.push({ name: "quota", query: routeQuery });
  await router.isReady();
  await flushPromises();

  return mount(Quota, {
    global: {
      plugins: [i18n, router, store],
      stubs: {
        QueryEditor: { template: '<div data-test="query-editor-stub" />' },
        ConfirmDialog: {
          props: ["modelValue", "title", "message"],
          template: '<div class="confirm-dialog-stub" />',
        },
        NoOrganizationSelected: { template: '<div data-test="no-org-selected" />' },
        NoData: { template: '<div data-test="no-data" />' },
        AppTabs: { template: '<div data-test="app-tabs-stub" />' },
        Pagination: { template: '<div data-test="pagination-stub" />' },
      },
    },
  });
};

describe("Quota role limits tab under a locked rbac license", () => {
  it("keeps the tab, shows the denied state and skips the roles fetch", async () => {
    const saved = store.state.zoConfig;
    store.state.zoConfig = { ...saved, features: { rbac: "locked" } };
    const wrapper = await mountQuota();
    const tab = wrapper.vm.tabs.find((t) => t.value === "role-limits");
    expect(tab).toBeDefined();
    expect(tab.tooltipLabel).toContain("Locked");

    iamSvc.getRoles.mockClear();
    await wrapper.vm.updateActiveTab("role-limits");
    await flushPromises();
    expect(iamSvc.getRoles).not.toHaveBeenCalled();
    expect(wrapper.find('[data-test="quota-role-limits-license-denied"]').exists()).toBe(true);
    wrapper.unmount();
    store.state.zoConfig = saved;
  });
});
