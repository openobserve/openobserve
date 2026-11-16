import { mount, flushPromises } from "@vue/test-utils";
import { createRouter, createMemoryHistory } from "vue-router";
import { defineComponent, h } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import store from "@/test/unit/helpers/store";
import i18n from "@/locales";
import { queryClient } from "@/composables/query/queryClient";
import { raw } from "@/types/i18n";
import resources from "@/services/resources";
import type { ResourceSearchResponse } from "@/ts/interfaces/resources";
import CommandPalette from "./CommandPalette.vue";

vi.mock("@/services/resources", () => ({ default: { search: vi.fn() } }));
const wrappers: ReturnType<typeof mount>[] = [];
const result: ResourceSearchResponse = {
  hits: Array.from({ length: 6 }, (_, i) => ({
    type: "function",
    id: `payment${i}`,
    name: `payment ${i}`,
    route_ref: { function_name: `payment${i}` },
  })),
  sources: [{ type: "function", status: "complete", has_more: true, next_cursor: "next" }],
  took_ms: 1,
};
async function setup() {
  const view = defineComponent({ setup: () => () => h("div") });
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      ...[
        "logs",
        "metrics",
        "traces",
        "dashboards",
        "alertList",
        "pipelines",
        "synthetics",
        "users",
        "serviceAccounts",
      ].map((name) => ({ path: `/${name}`, name, component: view })),
      { path: "/", name: "home", component: view },
      { path: "/functions", name: "functionList", component: view },
      { path: "/search/resources", name: "resourceSearch", component: view },
    ],
  });
  await router.push("/");
  await router.isReady();
  const wrapper = mount(CommandPalette, {
    attachTo: document.body,
    props: {
      open: true,
      flat: true,
      links: [{ name: "functionList", title: raw("Functions"), icon: "code", link: "/functions" }],
    },
    global: { plugins: [store, i18n, router] },
  });
  wrappers.push(wrapper);
  await flushPromises();
  return { wrapper, router };
}
beforeEach(() => {
  vi.useFakeTimers();
  store.state.zoConfig.synthetics_enabled = true;
  store.state.zoConfig.features = {};
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
describe("Command K palette", () => {
  it("preserves a grouped child's license lock while keeping its page link discoverable", async () => {
    const { wrapper } = await setup();
    store.state.zoConfig.features = { pipelines: "locked" };
    await wrapper.setProps({
      flat: false,
      links: [
        { name: "pipeline", title: raw("Pipelines"), icon: "account-tree", link: "/pipeline" },
      ],
    });
    await flushPromises();
    expect(document.querySelector('[data-test="command-entry-pipelines:"]')).not.toBeNull();
    expect(document.querySelector('[data-test="command-entry-create:pipeline"]')).toBeNull();
  });

  it("keeps license-locked pages discoverable without advertising creation", async () => {
    const { wrapper } = await setup();
    await wrapper.setProps({
      links: [
        {
          name: "functionList",
          title: raw("Functions"),
          icon: "code",
          link: "/functions",
          licenseLocked: true,
        },
      ],
    });
    await flushPromises();
    expect(document.querySelector('[data-test="command-entry-functionList:"]')).not.toBeNull();
    expect(document.querySelector('[data-test="command-entry-create:function"]')).toBeNull();
  });

  it("renders all nine enabled peer types with icons and no secondary type dropdown", async () => {
    await setup();
    for (const kind of [
      "all",
      "stream",
      "dashboard",
      "alert",
      "saved_view",
      "function",
      "pipeline",
      "synthetic",
      "user",
      "service_account",
    ])
      expect(document.querySelector(`[data-test="command-type-${kind}"]`)).not.toBeNull();
    expect(document.querySelector('[data-test="command-more-types"]')).toBeNull();
    expect(
      [...document.querySelectorAll('[data-test^="command-type-"]')].map((element) =>
        element.getAttribute("data-test"),
      ),
    ).toEqual(
      [
        "all",
        "stream",
        "dashboard",
        "alert",
        "pipeline",
        "function",
        "saved_view",
        "synthetic",
        "user",
        "service_account",
      ].map((kind) => `command-type-${kind}`),
    );
  });
  it("scrolls and measures the toggle group's overflowing viewport on narrow screens", async () => {
    await setup();
    const strip = document
      .querySelector('[data-test="command-type-all"]')!
      .closest<HTMLElement>('[role="group"]')!;
    Object.defineProperties(strip, {
      clientWidth: { value: 220 },
      scrollWidth: { value: 874 },
    });
    Object.defineProperties(strip.parentElement!, {
      clientWidth: { value: 220 },
      scrollWidth: { value: 220 },
    });
    const scrollBy = vi.fn();
    strip.scrollBy = scrollBy;
    const next = document.querySelector<HTMLButtonElement>('[data-test="command-types-next"]')!;
    const previous = document.querySelector<HTMLButtonElement>(
      '[data-test="command-types-previous"]',
    )!;
    strip.dispatchEvent(new Event("scroll"));
    await flushPromises();
    expect(next.disabled).toBe(false);
    expect(previous.disabled).toBe(true);
    next.click();
    expect(scrollBy).toHaveBeenLastCalledWith({ left: 154, behavior: "smooth" });
    strip.scrollLeft = 654;
    strip.dispatchEvent(new Event("scroll"));
    await flushPromises();
    expect(next.disabled).toBe(true);
    expect(previous.disabled).toBe(false);
    previous.click();
    expect(scrollBy).toHaveBeenLastCalledWith({ left: -154, behavior: "smooth" });
  });
  it("preserves the selected resource identity when a preceding group arrives", async () => {
    vi.mocked(resources.search)
      .mockResolvedValueOnce(result)
      .mockResolvedValue({
        ...result,
        hits: [
          {
            type: "dashboard",
            id: "d",
            name: "payment dashboard",
            route_ref: { dashboard_id: "d", folder_id: "default" },
          },
          ...result.hits,
        ],
        sources: [{ type: "dashboard", status: "complete", has_more: false }, ...result.sources],
      });
    await setup();
    const input = document.querySelector<HTMLInputElement>("input")!;
    input.value = "payment";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await flushPromises();
    await vi.advanceTimersByTimeAsync(200);
    await flushPromises();
    vi.useRealTimers();
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    await flushPromises();
    const selected = input.getAttribute("aria-activedescendant");
    await queryClient.invalidateQueries({ queryKey: ["org", "acme", "resource-search"] });
    await flushPromises();
    expect(input.getAttribute("aria-activedescendant")).toBe(selected);
    expect(document.querySelector('[role="option"][aria-selected="true"]')?.textContent).toContain(
      "payment 1",
    );
  });

  it("focuses the input, navigates options and restores the opener on close", async () => {
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    const { wrapper } = await setup();
    await flushPromises();
    const input = document.querySelector<HTMLInputElement>("input")!;
    expect(document.activeElement).toBe(input);
    vi.useRealTimers();
    expect(document.querySelectorAll("[role=option]").length).toBeGreaterThan(1);
    const first = input.getAttribute("aria-activedescendant");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    await flushPromises();
    expect(input.getAttribute("aria-activedescendant")).not.toBe(first);
    await wrapper.setProps({ open: false });
    await flushPromises();
    expect(document.activeElement).toBe(opener);
  });

  it("opens with local pages and history without requesting resources", async () => {
    await setup();
    expect(resources.search).not.toHaveBeenCalled();
    expect(document.querySelector('[data-test="command-palette-input"]')).not.toBeNull();
    expect(document.querySelector('[data-test="command-entry-functionList:"]')).not.toBeNull();
  });
  it("preserves the query when selecting a resource type", async () => {
    await setup();
    const input = document.querySelector<HTMLInputElement>(
      '[data-test="command-palette-input"] input, input[data-test="command-palette-input"]',
    )!;
    input.value = "payment";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await flushPromises();
    document.querySelector<HTMLElement>('[data-test="command-type-dashboard"]')!.click();
    await flushPromises();
    await vi.advanceTimersByTimeAsync(200);
    await flushPromises();
    expect(input.value).toBe("payment");
    expect(vi.mocked(resources.search).mock.calls.at(-1)?.[1]).toMatchObject({
      q: "payment",
      types: ["dashboard"],
    });
  });
  it("starts each resource group at three and provides a condition-preserving continuation link", async () => {
    await setup();
    const input = document.querySelector<HTMLInputElement>("input")!;
    input.value = "payment";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await flushPromises();
    await vi.advanceTimersByTimeAsync(200);
    await flushPromises();
    expect(document.querySelectorAll('[data-test^="command-entry-function:"]')).toHaveLength(3);
    const continuation = Array.from(document.querySelectorAll<HTMLAnchorElement>("a")).find((a) =>
      a.href.includes("/search/resources"),
    )!;
    expect(continuation.href).toContain("type=function");
    expect(continuation.href).toContain("q=payment");
    const more = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((b) =>
      b.textContent?.includes("Show more"),
    )!;
    more.click();
    await flushPromises();
    expect(document.querySelectorAll('[data-test^="command-entry-function:"]')).toHaveLength(6);
  });
  it("keeps focus and state when a destination guard cancels navigation", async () => {
    const { wrapper, router } = await setup();
    router.beforeEach(() => false);
    document.querySelector<HTMLElement>('[data-test="command-entry-functionList:"]')!.click();
    await flushPromises();
    expect(wrapper.emitted("update:open")).toBeUndefined();
    expect(router.currentRoute.value.name).toBe("home");
  });
});
