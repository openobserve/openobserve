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
  sources: [{ type: "function", status: "complete", has_more: true }],
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
async function search(q: string) {
  const input = document.querySelector<HTMLInputElement>("input")!;
  input.value = q;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await flushPromises();
  await vi.advanceTimersByTimeAsync(200);
  await flushPromises();
  return input;
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
  it("keeps license-locked pages discoverable without advertising creation", async () => {
    const { wrapper } = await setup();
    store.state.zoConfig.features = { pipelines: "locked" };
    await wrapper.setProps({
      flat: false,
      links: [
        { name: "pipeline", title: raw("Pipelines"), icon: "account-tree", link: "/pipeline" },
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
    expect(document.querySelector('[data-test="command-entry-pipelines:"]')).not.toBeNull();
    expect(document.querySelector('[data-test="command-entry-create:pipeline"]')).toBeNull();
    expect(document.querySelector('[data-test="command-entry-functionList:"]')).not.toBeNull();
    expect(document.querySelector('[data-test="command-entry-create:function"]')).toBeNull();
  });

  it("renders every enabled resource type as a peer toggle in order", async () => {
    await setup();
    expect(document.querySelector('[data-test="command-types-next"]')).toBeNull();
    expect(
      [...document.querySelectorAll('[data-test^="command-type-"]')].map((element) =>
        element.getAttribute("data-test"),
      ),
    ).toEqual(
      [
        "stream",
        "dashboard",
        "alert",
        "pipeline",
        "function",
        "synthetic",
        "user",
        "service_account",
      ].map((kind) => `command-type-${kind}`),
    );
  });
  it("scrolls the type row sideways by wheel or drag without toggling a type", async () => {
    await setup();
    const strip = document
      .querySelector('[data-test="command-type-stream"]')!
      .closest<HTMLElement>('[role="group"]')!;
    Object.defineProperties(strip, {
      clientWidth: { value: 220 },
      scrollWidth: { value: 874 },
    });
    strip.dispatchEvent(new WheelEvent("wheel", { deltaY: 120, bubbles: true, cancelable: true }));
    expect(strip.scrollLeft).toBe(120);
    const item = document.querySelector<HTMLElement>('[data-test="command-type-user"]')!;
    const pointer = (type: string, clientX: number) =>
      Object.assign(new MouseEvent(type, { clientX, button: 0, bubbles: true }), {
        pointerType: "mouse",
      });
    vi.advanceTimersByTime(1);
    item.dispatchEvent(pointer("pointerdown", 300));
    window.dispatchEvent(pointer("pointermove", 260));
    expect(strip.scrollLeft).toBe(160);
    window.dispatchEvent(pointer("pointerup", 260));
    item.click();
    await flushPromises();
    expect(item.getAttribute("data-state")).toBe("off");
  });
  it("toggles a type on and back off to search every type", async () => {
    await setup();
    await search("payment");
    const item = document.querySelector<HTMLElement>('[data-test="command-type-function"]')!;
    item.click();
    await flushPromises();
    await vi.advanceTimersByTimeAsync(200);
    await flushPromises();
    expect(vi.mocked(resources.search).mock.calls.at(-1)?.[1].types).toEqual(["function"]);
    item.click();
    await flushPromises();
    await vi.advanceTimersByTimeAsync(200);
    await flushPromises();
    expect(vi.mocked(resources.search).mock.calls.at(-1)?.[1].types).toEqual([
      "stream",
      "dashboard",
      "alert",
      "pipeline",
      "function",
      "synthetic",
      "user",
      "service_account",
    ]);
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
    const input = await search("payment");
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

  it("moves the selection only on real pointer motion, not when rows slide under the pointer", async () => {
    await setup();
    const input = await search("payment");
    const target = document.querySelector<HTMLElement>(
      '[data-test="command-entry-function:payment2"]',
    )!;
    const selected = input.getAttribute("aria-activedescendant");
    expect(selected).not.toBe(target.id);
    target.dispatchEvent(new MouseEvent("mouseenter"));
    await flushPromises();
    expect(input.getAttribute("aria-activedescendant")).toBe(selected);
    target.dispatchEvent(new MouseEvent("pointermove", { bubbles: true }));
    await flushPromises();
    expect(input.getAttribute("aria-activedescendant")).toBe(target.id);
  });

  it("opens on local pages without a request, navigates options and restores the opener", async () => {
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    const { wrapper } = await setup();
    const input = document.querySelector<HTMLInputElement>("input")!;
    expect(document.activeElement).toBe(input);
    expect(resources.search).not.toHaveBeenCalled();
    expect(document.querySelector('[data-test="command-entry-functionList:"]')).not.toBeNull();
    vi.useRealTimers();
    const first = input.getAttribute("aria-activedescendant");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    await flushPromises();
    expect(input.getAttribute("aria-activedescendant")).not.toBe(first);
    await wrapper.setProps({ open: false });
    await flushPromises();
    expect(document.activeElement).toBe(opener);
  });
  it("preserves the query when selecting a resource type", async () => {
    await setup();
    const input = document.querySelector<HTMLInputElement>("input")!;
    input.value = "payment";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await flushPromises();
    // Vue drops an event stamped no later than its listener, and fake timers freeze the clock.
    vi.advanceTimersByTime(1);
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
  it("previews three per type with no show more, leaving the type filter to see the rest", async () => {
    await setup();
    await search("payment");
    expect(document.querySelectorAll('[data-test^="command-entry-function:"]')).toHaveLength(3);
    expect(document.body.textContent).not.toContain("Show more");
  });
  it("lists every match of a selected type", async () => {
    await setup();
    await search("payment");
    vi.advanceTimersByTime(1);
    document.querySelector<HTMLElement>('[data-test="command-type-function"]')!.click();
    await flushPromises();
    await vi.advanceTimersByTimeAsync(200);
    await flushPromises();
    expect(document.querySelectorAll('[data-test^="command-entry-function:"]')).toHaveLength(6);
  });
  it("treats a denied source as settled, not as partial results to retry", async () => {
    vi.mocked(resources.search).mockResolvedValue({
      hits: [],
      sources: [
        { type: "function", status: "complete", has_more: false },
        { type: "user", status: "unavailable", has_more: null, reason: "permission_denied" },
      ],
      took_ms: 0,
    });
    await setup();
    await search("nothing");
    const text = document.body.textContent ?? "";
    expect(text).toContain("No matches");
    expect(text).not.toContain("Some results are unavailable");
    expect(text).not.toContain("This resource type is currently unavailable");
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
