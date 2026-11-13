// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { queryClient } from "@/composables/query/queryClient";
import { AxiosError, AxiosHeaders } from "axios";
import en from "@/locales/languages/en-US.json";
import golden from "@/test/unit/fixtures/serviceVersions/stage7.json";
import { formatDeployTime } from "@/utils/serviceVersionsCopy";
import Strip from "./RumVersionStrip.vue";
import { rumHintContext } from "./rumStrip";
const mocks = vi.hoisted(() => ({
  services: vi.fn(),
  unresolved: vi.fn(),
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
const storeState = vi.hoisted(() => ({
  selectedOrganization: { identifier: "org" },
  userInfo: { email: "u@example.com" },
  timezone: "UTC",
  zoConfig: { features: {} as Record<string, string> },
}));
vi.mock("vuex", () => ({
  useStore: () => ({ state: storeState }),
}));
vi.mock("@/services/service_versions", async (original) => {
  const actual = await original<{ default: object }>();
  return {
    ...actual,
    default: {
      ...actual.default,
      services: mocks.services,
      identityUnresolved: mocks.unresolved,
    },
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
  OIcon: true,
  OSkeleton: { template: '<div v-bind="$attrs" />' },
  OButton: button,
  ODropdown: { template: '<div><slot name="trigger"/><slot/></div>' },
  ODropdownItem: {
    emits: ["select"],
    template: '<button v-bind="$attrs" @click="$emit(\'select\')"><slot/></button>',
  },
  ServiceEnvChip: {
    props: ["identity", "service"],
    template: '<span data-test="chip">{{ service }} {{ identity.env }}</span>',
  },
  VerdictChip: {
    props: ["verdict"],
    template: '<span data-test="svcver-rum-strip-verdict">{{ verdict.verdict }}</span>',
  },
};
type Services = typeof golden.services_rum;
const services = (): Services => structuredClone(golden.services_rum);
const website = (body: Services) => body.services.find((row) => row.service === "storefront")!;
function httpError(status: number) {
  const response = {
    status,
    data: {},
    statusText: "",
    headers: {},
    config: { headers: new AxiosHeaders() },
  };
  return new AxiosError("failed", String(status), undefined, undefined, response);
}
// The shared test setup installs the app client, so each render starts from an empty cache.
function render(props: Record<string, unknown> = {}) {
  queryClient.clear();
  queryClient.setDefaultOptions({ queries: { retryDelay: 0 } });
  // useFeatureLock is preloaded before this spec's vuex mock, so its real useStore needs the provide.
  return mount(Strip, { props, global: { stubs, provide: { store: { state: storeState } } } });
}
const find = (wrapper: ReturnType<typeof render>, id: string) =>
  wrapper.find(`[data-test="${id}"]`);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.services.mockResolvedValue({ data: services() });
  mocks.unresolved.mockResolvedValue({ data: structuredClone(golden.unresolved) });
  window.localStorage.clear();
  Object.assign(rumHintContext, { env: "", period: "" });
  storeState.zoConfig.features = {};
});
it("shows a skeleton while the RUM scopes load", () => {
  mocks.services.mockReturnValue(new Promise(() => {}));
  const wrapper = render();
  expect(find(wrapper, "svcver-rum-strip-loading").exists()).toBe(true);
});
it("describes the newest RUM deploy with its headline metric and opens the compare drawer", async () => {
  const wrapper = render();
  await flushPromises();
  expect(mocks.services).toHaveBeenCalledWith(
    "org",
    expect.objectContaining({ signal: "rum" }),
    expect.anything(),
  );
  expect(find(wrapper, "svcver-rum-strip-app").text()).toBe("storefront");
  expect(find(wrapper, "chip").text()).toBe("storefront prod");
  const at = website(services()).newest_verdict!.deploy!.at;
  // One stamp format for every deploy time in the feature, in the app's timezone.
  const when = formatDeployTime(at, Date.now(), "UTC");
  expect(find(wrapper, "svcver-rum-strip-version").text()).toMatch(
    new RegExp(`^0\\.0\\.2\\s*deployed ${when}$`),
  );
  expect(find(wrapper, "svcver-rum-strip-verdict").text()).toBe(
    website(services()).newest_verdict!.verdict,
  );
  expect(find(wrapper, "svcver-rum-strip-summary").text()).toBe(
    "INP +19.4% (179 → 213 ms), LCP and CLS improved",
  );
  await find(wrapper, "svcver-rum-strip-compare").trigger("click");
  expect(mocks.open).toHaveBeenCalledWith({
    service: "storefront",
    where: "env:prod",
    a: "0.0.2",
    deployKey: website(services()).newest_verdict!.deploy_key,
  });
});
it.each([503, 500])("keeps a %s visible as unavailable with Retry", async (status) => {
  mocks.services.mockRejectedValue(httpError(status));
  const wrapper = render();
  await vi.waitFor(() => expect(find(wrapper, "svcver-rum-strip-unavailable").exists()).toBe(true));
  expect(find(wrapper, "svcver-rum-strip-unavailable").text()).toBe("Version status unavailable");
  const calls = mocks.services.mock.calls.length;
  mocks.services.mockResolvedValue({ data: services() });
  await find(wrapper, "svcver-rum-strip-retry").trigger("click");
  await flushPromises();
  expect(mocks.services.mock.calls.length).toBe(calls + 1);
  expect(find(wrapper, "svcver-rum-strip-app").text()).toBe("storefront");
});
it.each([403, 404])("renders nothing on %s", async (status) => {
  mocks.services.mockRejectedValue(httpError(status));
  const wrapper = render();
  await flushPromises();
  expect(find(wrapper, "svcver-rum-strip").exists()).toBe(false);
  expect(mocks.services).toHaveBeenCalledTimes(1);
});
it("renders nothing without a RUM scope or when no app sends a version", async () => {
  const none = services();
  none.services = [];
  mocks.services.mockResolvedValue({ data: none });
  const empty = render();
  await flushPromises();
  expect(find(empty, "svcver-rum-strip").exists()).toBe(false);
  const unversioned = services();
  unversioned.services = unversioned.services.filter((row) => row.service === "shop-web");
  mocks.services.mockResolvedValue({ data: unversioned });
  const wrapper = render({ app: "shop-web" });
  await flushPromises();
  expect(find(wrapper, "svcver-rum-strip").exists()).toBe(false);
});
it("keeps the hint off other tabs, for a versioned app, an unlisted app and a failed read", async () => {
  const otherTab = render({ app: "shop-web" });
  await flushPromises();
  expect(find(otherTab, "svcver-rum-strip").exists()).toBe(false);
  expect(mocks.unresolved).not.toHaveBeenCalled();
  const versioned = render({ app: "storefront", noVersionHint: true });
  await flushPromises();
  expect(find(versioned, "svcver-rum-strip-version").exists()).toBe(true);
  expect(find(versioned, "svcver-rum-noversion-hint").exists()).toBe(false);
  mocks.unresolved.mockResolvedValue({ data: { no_version: [], placeholder_names: [] } });
  const unlisted = render({ app: "shop-web", noVersionHint: true });
  await flushPromises();
  expect(find(unlisted, "svcver-rum-strip").exists()).toBe(false);
  mocks.unresolved.mockRejectedValue(httpError(503));
  const failed = render({ app: "shop-web", noVersionHint: true });
  await flushPromises();
  await vi.waitFor(() => expect(find(failed, "svcver-rum-strip").exists()).toBe(false));
  expect(find(failed, "svcver-rum-noversion-hint").exists()).toBe(false);
});
it("remembers a hint dismissal per app and survives storage that throws", async () => {
  const wrapper = render({ app: "shop-web", noVersionHint: true });
  await flushPromises();
  await find(wrapper, "svcver-rum-noversion-dismiss").trigger("click");
  expect(find(wrapper, "svcver-rum-strip").exists()).toBe(false);
  expect(window.localStorage.getItem("svcver.rumNoVersion.dismissed.org.shop-web")).toBe("1");
  const again = render({ app: "shop-web", noVersionHint: true });
  await flushPromises();
  expect(find(again, "svcver-rum-strip").exists()).toBe(false);
  window.localStorage.clear();
  const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("denied");
  });
  const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("denied");
  });
  const locked = render({ app: "shop-web", noVersionHint: true });
  await flushPromises();
  expect(find(locked, "svcver-rum-noversion-hint").exists()).toBe(true);
  await find(locked, "svcver-rum-noversion-dismiss").trigger("click");
  expect(find(locked, "svcver-rum-strip").exists()).toBe(false);
  get.mockRestore();
  set.mockRestore();
});
it("names the version and says unavailable when verdicts cannot be read", async () => {
  const body = services();
  body.verdict_status = "unavailable";
  mocks.services.mockResolvedValue({ data: body });
  const wrapper = render();
  await flushPromises();
  expect(find(wrapper, "svcver-rum-strip-version").text()).toContain("0.0.2");
  expect(find(wrapper, "svcver-rum-strip-unavailable").exists()).toBe(true);
  expect(find(wrapper, "svcver-rum-strip-verdict").exists()).toBe(false);
});
it("states every verdict: judged with a headline, early with its sentence, others by chip only", async () => {
  const cases: [Record<string, unknown>, string | null][] = [
    [{ verdict: "watch" }, "INP +19.4% (179 → 213 ms), LCP and CLS improved"],
    [{ verdict: "ok" }, "INP +19.4% (179 → 213 ms), LCP and CLS improved"],
    [{ verdict: "not_serving" }, null],
    [{ verdict: "regressed", state: "pre_existing" }, null],
  ];
  for (const [change, summary] of cases) {
    const body = services();
    Object.assign(website(body).newest_verdict!, change);
    mocks.services.mockResolvedValue({ data: body });
    const wrapper = render();
    await flushPromises();
    expect(find(wrapper, "svcver-rum-strip-verdict").text()).toBe(String(change.verdict));
    if (summary) expect(find(wrapper, "svcver-rum-strip-summary").text()).toBe(summary);
    else expect(find(wrapper, "svcver-rum-strip-summary").exists()).toBe(false);
    wrapper.unmount();
  }
  const early = services();
  Object.assign(website(early).newest_verdict!, { verdict: "insufficient" });
  mocks.services.mockResolvedValue({ data: early });
  const wrapper = render();
  await flushPromises();
  expect(find(wrapper, "svcver-rum-strip-summary").text().length).toBeGreaterThan(0);
});
it("says which version a rollback left and compares a launch-day version without a deploy key", async () => {
  const body = services();
  const verdict = website(body).newest_verdict!;
  verdict.deploy = { ...verdict.deploy, kind: "rollback", from_version: "0.0.3" };
  mocks.services.mockResolvedValue({ data: body });
  const rolled = render();
  await flushPromises();
  expect(find(rolled, "svcver-rum-strip-rolled-back").text()).toBe("rolled back from 0.0.3");
  const launch = services();
  Object.assign(website(launch).newest_verdict!, { state: "pre_existing" });
  mocks.services.mockResolvedValue({ data: launch });
  const wrapper = render();
  await flushPromises();
  await find(wrapper, "svcver-rum-strip-compare").trigger("click");
  expect(mocks.open).toHaveBeenLastCalledWith(
    expect.objectContaining({ a: "0.0.2", deployKey: undefined }),
  );
});
it("switches between versioned apps locally and follows the tab's own app", async () => {
  const body = services();
  const other = {
    ...structuredClone(website(body)),
    service: "docs-web",
    scope_key: "docs",
    newest_first_seen: 1,
  };
  body.services.push(other);
  mocks.services.mockResolvedValue({ data: body });
  const wrapper = render();
  await flushPromises();
  expect(find(wrapper, "svcver-rum-strip-more-apps").text()).toBe("· 1 more app");
  await find(wrapper, "svcver-rum-strip-app-option-docs").trigger("click");
  expect(find(wrapper, "chip").text()).toBe("docs-web prod");
  const scoped = render({ app: "docs-web" });
  await flushPromises();
  expect(find(scoped, "chip").text()).toBe("docs-web prod");
});
it("stays hidden without reading versions while the traces licence is locked", async () => {
  storeState.zoConfig.features = { traces: "locked" };
  const wrapper = render();
  await flushPromises();
  expect(find(wrapper, "svcver-rum-strip").exists()).toBe(false);
  expect(mocks.services).not.toHaveBeenCalled();
});
it("skips the no-version hint read while the correlation licence is locked", async () => {
  storeState.zoConfig.features = { correlation: "locked" };
  mocks.services.mockResolvedValue({ data: { services: [] } });
  const wrapper = render({ app: "storefront", noVersionHint: true });
  await flushPromises();
  expect(find(wrapper, "svcver-rum-strip").exists()).toBe(false);
  expect(mocks.unresolved).not.toHaveBeenCalled();
});
