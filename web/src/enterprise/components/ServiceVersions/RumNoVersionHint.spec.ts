// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import en from "@/locales/languages/en-US.json";
import golden from "@/test/unit/fixtures/serviceVersions/stage7.json";
import { queryClient } from "@/composables/query/queryClient";
import Hint from "./RumNoVersionHint.vue";
import Compare from "./RumCompareVersions.vue";
import Unavailable from "./DeployMarkersUnavailable.vue";
import { unavailableDeployServices } from "@/composables/dashboard/deployMarkerScope";
const mocks = vi.hoisted(() => ({
  services: vi.fn(),
  copy: vi.fn(),
  open: vi.fn(),
}));
function translate(key: string, params: Record<string, unknown> = {}) {
  const text = key.split(".").reduce<unknown>((node, part) => (node as never)?.[part], en);
  return String(text ?? key).replace(/\{(\w+)\}/g, (_, name) => String(params[name]));
}
vi.mock("@/types/i18n", async (original) => ({
  ...(await original<object>()),
  useI18nTyped: () => ({ t: translate }),
}));
vi.mock("vuex", () => ({
  useStore: () => ({
    state: { selectedOrganization: { identifier: "org" }, userInfo: { email: "u@example.com" } },
  }),
}));
vi.mock("@/services/service_versions", async (original) => {
  const actual = await original<{ default: object }>();
  return {
    ...actual,
    default: { ...actual.default, services: mocks.services },
  };
});
vi.mock("@/utils/clipboard", () => ({ copyToClipboard: mocks.copy }));
vi.mock("@/enterprise/composables/useVersionCompareDrawer", () => ({
  useVersionCompareDrawer: () => ({ open: mocks.open }),
}));
const button = {
  emits: ["click"],
  template: '<button v-bind="$attrs" @click="$emit(\'click\')"><slot/></button>',
};
const stubs = {
  OButton: button,
};
const forApp = (app: string) => {
  const body = structuredClone(golden.services_rum);
  body.services = body.services.filter((row) => row.service === app);
  return { data: body };
};
function render(component: unknown, props: Record<string, unknown>) {
  queryClient.clear();
  queryClient.setDefaultOptions({ queries: { retryDelay: 0 } });
  return mount(component as never, { props, global: { stubs } });
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.services.mockImplementation(async (_org: string, params: { service?: string }) =>
    forApp(params.service || ""),
  );
});
it("says on one line that the app sends no version and copies the init snippet it does not show", async () => {
  const wrapper = mount(Hint, {
    props: { app: "shop-web", env: "prod", period: "24h" },
    global: { stubs },
  });
  const sentence = wrapper.find('[data-test="svcver-rum-noversion-sentence"]');
  expect(sentence.text()).toBe(
    "No version seen for shop-web in the last 24h. Set version in openobserveRum.init to get deploy markers and version comparisons.",
  );
  expect(wrapper.find('[data-test="svcver-rum-noversion-snippet"]').exists()).toBe(false);
  await wrapper.find('[data-test="svcver-rum-noversion-copy"]').trigger("click");
  expect(mocks.copy).toHaveBeenCalledWith(
    'openobserveRum.init({ service: "shop-web", env: "prod", version: import.meta.env.VITE_APP_VERSION })',
    expect.anything(),
    { successMessage: "Snippet copied" },
  );
  const absolute = mount(Hint, { props: { app: "shop-web" }, global: { stubs } });
  expect(absolute.text()).toContain("in the selected time range.");
});
it("compares the selected version, else the newest RUM version, with the auto baseline", async () => {
  const selected = render(Compare, { app: "storefront", env: "prod", version: "0.0.1" });
  await flushPromises();
  await selected.find('[data-test="svcver-rum-compare-versions"]').trigger("click");
  expect(mocks.open).toHaveBeenLastCalledWith({
    service: "storefront",
    where: "env:prod",
    a: "0.0.1",
  });
  const newest = render(Compare, { app: "storefront" });
  await flushPromises();
  await newest.find('[data-test="svcver-rum-compare-versions"]').trigger("click");
  expect(mocks.open).toHaveBeenLastCalledWith({
    service: "storefront",
    where: "env:prod",
    a: "0.0.2",
  });
  const none = render(Compare, { app: "shop-web" });
  await flushPromises();
  expect(none.find('[data-test="svcver-rum-compare-versions"]').exists()).toBe(false);
  const otherEnv = render(Compare, { app: "storefront", env: "staging" });
  await flushPromises();
  expect(otherEnv.find('[data-test="svcver-rum-compare-versions"]').exists()).toBe(false);
});
it("offers one grey retry while a deploy read is unavailable", async () => {
  unavailableDeployServices.clear();
  const wrapper = render(Unavailable, {});
  expect(wrapper.find('[data-test="svcver-marker-unavailable-retry"]').exists()).toBe(false);
  unavailableDeployServices.add("storefront");
  await flushPromises();
  const chip = wrapper.find('[data-test="svcver-marker-unavailable-retry"]');
  expect(chip.text()).toBe("verdict unavailable · retry");
  await chip.trigger("click");
  expect(wrapper.emitted("retry")).toHaveLength(1);
  expect(unavailableDeployServices.size).toBe(0);
});
