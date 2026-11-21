import { mount, flushPromises } from "@vue/test-utils";
import { createRouter, createMemoryHistory } from "vue-router";
import { defineComponent, h } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import store from "@/test/unit/helpers/store";
import i18n from "@/locales";
import resources from "@/services/resources";
import type { ResourceSearchResponse } from "@/ts/interfaces/resources";
import ResourceSearch from "./ResourceSearch.vue";
vi.mock("@/services/resources", () => ({ default: { search: vi.fn() } }));
const result: ResourceSearchResponse = {
  hits: [{ type: "function", id: "pay", name: "Payment", route_ref: { function_name: "pay" } }],
  sources: [{ type: "function", status: "complete", has_more: true }],
  took_ms: 1,
};
const wrappers: ReturnType<typeof mount>[] = [];
async function setup() {
  const view = defineComponent({ setup: () => () => h("div") });
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", name: "home", component: view },
      { path: "/search/resources", name: "resourceSearch", component: view },
      { path: "/functions", name: "functionList", component: view },
    ],
  });
  await router.push("/search/resources?org_identifier=acme&type=function&q=pay");
  await router.isReady();
  const wrapper = mount(ResourceSearch, {
    attachTo: document.body,
    global: { plugins: [store, i18n, router] },
  });
  wrappers.push(wrapper);
  await flushPromises();
  await vi.advanceTimersByTimeAsync(200);
  await flushPromises();
  return { wrapper, router };
}
beforeEach(() => {
  vi.useFakeTimers();
  store.state.selectedOrganization.identifier = "acme";
  store.state.userInfo = { ...store.state.userInfo, email: "alice@example.invalid" };
  vi.mocked(resources.search).mockResolvedValue(result);
});
afterEach(() => {
  wrappers.splice(0).forEach((w) => w.unmount());
  vi.useRealTimers();
  vi.clearAllMocks();
  document.body.innerHTML = "";
});
describe("Resource search continuation", () => {
  it("pages by offset with the same conditions and goes back to the first page", async () => {
    const { wrapper, router } = await setup();
    await wrapper.get('[data-test="resource-search-next"]').trigger("click");
    await flushPromises();
    await vi.advanceTimersByTimeAsync(200);
    await flushPromises();
    expect(vi.mocked(resources.search).mock.calls.at(-1)?.[1]).toMatchObject({
      q: "pay",
      types: ["function"],
      offset: 20,
    });
    expect(router.currentRoute.value.query).toMatchObject({ q: "pay", type: "function" });
    await wrapper.get('[data-test="resource-search-previous"]').trigger("click");
    await flushPromises();
    await vi.advanceTimersByTimeAsync(200);
    await flushPromises();
    expect(vi.mocked(resources.search).mock.calls.at(-1)?.[1].offset).toBeUndefined();
  });
  it("does not describe an unavailable source as no matches", async () => {
    vi.mocked(resources.search).mockResolvedValue({
      hits: [],
      sources: [
        { type: "function", status: "unavailable", has_more: null, reason: "source_unavailable" },
      ],
      took_ms: 1,
    });
    const { wrapper } = await setup();
    expect(wrapper.text()).toContain("This resource type is currently unavailable");
    expect(wrapper.text()).not.toContain("No matches");
  });
});
