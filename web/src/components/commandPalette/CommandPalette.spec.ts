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
      { path: "/dashboards/view", name: "viewDashboard", component: view },
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
const typeChip = (kind: string) =>
  document.querySelector<HTMLElement>(`[data-test="command-type-${kind}"]`)!;
const activeOption = () =>
  document.querySelector<HTMLElement>('[role="option"][aria-selected="true"]');
const key = (target: Element, key: string, init: KeyboardEventInit = {}) =>
  target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...init }));
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
  Element.prototype.scrollIntoView = vi.fn();
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

  it("renders All, then every enabled resource type as a filter chip in order", async () => {
    await setup();
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
        "synthetic",
        "user",
        "service_account",
      ].map((kind) => `command-type-${kind}`),
    );
    expect(typeChip("all").getAttribute("aria-pressed")).toBe("true");
  });
  it("shows match counts on the chips only once there is a query", async () => {
    await setup();
    expect(typeChip("function").querySelector('[data-test="o-stat-card-value"]')).toBeNull();
    await search("payment");
    expect(typeChip("function").textContent).toContain("6+");
    expect(typeChip("dashboard").textContent).toContain("—");
    expect(typeChip("all").textContent).toContain("6+");
  });
  it("filters the loaded results by several types without a new request, and back to every type", async () => {
    await setup();
    await search("payment");
    const calls = vi.mocked(resources.search).mock.calls.length;
    const total = typeChip("all").textContent;
    vi.advanceTimersByTime(1);
    typeChip("function").click();
    await flushPromises();
    typeChip("dashboard").click();
    await flushPromises();
    await vi.advanceTimersByTimeAsync(200);
    await flushPromises();
    expect(vi.mocked(resources.search).mock.calls).toHaveLength(calls);
    expect(document.querySelector('[data-test="command-entry-functionList:"]')).toBeNull();
    expect(typeChip("function").getAttribute("aria-pressed")).toBe("true");
    expect(typeChip("dashboard").getAttribute("aria-pressed")).toBe("true");
    expect(typeChip("all").getAttribute("aria-pressed")).toBe("false");
    expect(typeChip("all").textContent).toBe(total);
    expect(document.querySelectorAll('[data-test^="command-entry-function:"]')).toHaveLength(6);
    typeChip("all").click();
    await flushPromises();
    expect(typeChip("all").getAttribute("aria-pressed")).toBe("true");
    expect(typeChip("function").getAttribute("aria-pressed")).toBe("false");
    expect(vi.mocked(resources.search).mock.calls).toHaveLength(calls);
  });
  it("moves focus between type chips with the arrow keys without changing the filter, and ↑ returns to the search", async () => {
    await setup();
    const input = await search("payment");
    typeChip("all").focus();
    key(typeChip("all"), "ArrowRight");
    await flushPromises();
    expect(document.activeElement).toBe(typeChip("stream"));
    expect(typeChip("stream").getAttribute("aria-pressed")).toBe("false");
    expect(typeChip("all").getAttribute("aria-pressed")).toBe("true");
    expect(typeChip("all").getAttribute("tabindex")).toBe("-1");
    key(typeChip("stream"), "End");
    await flushPromises();
    expect(document.activeElement).toBe(typeChip("service_account"));
    key(typeChip("service_account"), "ArrowUp");
    await flushPromises();
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe("payment");
  });
  it("goes down from the chips into the results, and back up to the chips from the first row", async () => {
    await setup();
    const input = await search("payment");
    const results = document.querySelector<HTMLElement>('[data-test="command-palette-results"]')!;
    const first = activeOption();
    typeChip("all").focus();
    key(typeChip("all"), "ArrowDown");
    await flushPromises();
    expect(document.activeElement).toBe(results);
    expect(results.getAttribute("aria-activedescendant")).toBe(first?.id);
    key(results, "ArrowDown");
    await flushPromises();
    expect(activeOption()).not.toBe(first);
    expect(results.getAttribute("aria-activedescendant")).toBe(activeOption()?.id);
    key(results, "ArrowUp");
    await flushPromises();
    expect(activeOption()).toBe(first);
    key(results, "ArrowUp");
    await flushPromises();
    expect(document.activeElement).toBe(typeChip("all"));
    key(typeChip("all"), "ArrowDown");
    await flushPromises();
    key(results, "x");
    await flushPromises();
    expect(document.activeElement).toBe(input);
  });
  it("opens the highlighted result with Enter from the focused results", async () => {
    const { router } = await setup();
    await search("payment");
    const results = document.querySelector<HTMLElement>('[data-test="command-palette-results"]')!;
    typeChip("all").focus();
    key(typeChip("all"), "ArrowDown");
    await flushPromises();
    const href = activeOption()?.getAttribute("href");
    key(results, "Enter");
    await flushPromises();
    expect(href).toBeTruthy();
    expect(router.currentRoute.value.fullPath).toBe(href!.replace(/^\/web/, ""));
  });
  it("drops the latest type pick with each Backspace in an empty search", async () => {
    await setup();
    vi.advanceTimersByTime(1);
    typeChip("function").click();
    await flushPromises();
    typeChip("dashboard").click();
    await flushPromises();
    const input = document.querySelector<HTMLInputElement>("input")!;
    key(input, "Backspace");
    await flushPromises();
    expect(typeChip("dashboard").getAttribute("aria-pressed")).toBe("false");
    expect(typeChip("function").getAttribute("aria-pressed")).toBe("true");
    key(input, "Backspace");
    await flushPromises();
    expect(typeChip("all").getAttribute("aria-pressed")).toBe("true");
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
  it("browses only the picked types while the search is empty", async () => {
    await setup();
    vi.advanceTimersByTime(1);
    typeChip("dashboard").click();
    await flushPromises();
    typeChip("function").click();
    await flushPromises();
    await vi.advanceTimersByTimeAsync(200);
    await flushPromises();
    expect(vi.mocked(resources.search).mock.calls.at(-1)?.[1]).toMatchObject({
      q: "",
      types: ["dashboard", "function"],
    });
  });
  it("holds placeholder rows where the first answer will land, so the list never empties", async () => {
    let answer!: (value: typeof result) => void;
    vi.mocked(resources.search).mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    await setup();
    await search("payment");
    expect(document.querySelector('[data-test="command-palette-searching"]')).not.toBeNull();
    answer(result);
    await flushPromises();
    expect(document.querySelector('[data-test="command-palette-searching"]')).toBeNull();
    expect(document.querySelectorAll('[data-test^="command-entry-function:"]')).toHaveLength(3);
  });
  it("keeps the last answer up between keystrokes, narrowed to the new text", async () => {
    await setup();
    await search("payment");
    vi.mocked(resources.search).mockReturnValueOnce(new Promise(() => {}));
    const input = document.querySelector<HTMLInputElement>("input")!;
    input.value = "payment 4";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await flushPromises();
    await vi.advanceTimersByTimeAsync(200);
    await flushPromises();
    expect(vi.mocked(resources.search).mock.calls.at(-1)?.[1]).toMatchObject({ q: "payment 4" });
    const held = [...document.querySelectorAll('[data-test^="command-entry-function:"]')];
    expect(held.map((row) => row.getAttribute("data-test"))).toEqual([
      "command-entry-function:payment4",
    ]);
    expect(document.querySelector('[data-test="command-palette-searching"]')).toBeNull();
  });
  it("keeps the browser's saved-entry suggestions off the search field", async () => {
    await setup();
    const input = document.querySelector<HTMLInputElement>(
      'input[aria-controls="command-palette-results"]',
    );
    expect(input?.getAttribute("autocomplete")).toBe("off");
  });
  it("highlights the first result as soon as a search answers", async () => {
    await setup();
    await search("payment");
    expect(activeOption()?.getAttribute("data-test")).toBe("command-entry-function:payment0");
    await search("payment 2");
    expect(activeOption()?.getAttribute("data-test")).toBe("command-entry-function:payment0");
  });
  it("jumps between groups with Page Down and Page Up", async () => {
    vi.mocked(resources.search).mockResolvedValue({
      ...result,
      hits: [
        ...result.hits,
        {
          type: "dashboard",
          id: "d",
          name: "payment dashboard",
          route_ref: { dashboard_id: "d", folder_id: "default" },
        },
      ],
      sources: [{ type: "dashboard", status: "complete", has_more: false }, ...result.sources],
    });
    await setup();
    const input = await search("payment");
    expect(activeOption()?.getAttribute("data-test")).toBe("command-entry-dashboard:d");
    key(input, "PageDown");
    await flushPromises();
    expect(activeOption()?.getAttribute("data-test")).toBe("command-entry-function:payment0");
    key(input, "ArrowDown");
    key(input, "PageUp");
    await flushPromises();
    expect(activeOption()?.getAttribute("data-test")).toBe("command-entry-function:payment0");
    key(input, "PageUp");
    await flushPromises();
    expect(activeOption()?.getAttribute("data-test")).toBe("command-entry-dashboard:d");
  });
  it("opens the highlighted result in a new tab with Ctrl or Cmd and Enter", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const { wrapper } = await setup();
    const input = await search("payment");
    key(input, "Enter", { ctrlKey: true });
    await flushPromises();
    expect(open).toHaveBeenCalledWith(activeOption()?.getAttribute("href"), "_blank", "noopener");
    expect(wrapper.emitted("update:open")).toBeUndefined();
  });
  it("previews three per type with no show more, leaving the type filter to see the rest", async () => {
    await setup();
    await search("payment");
    expect(document.querySelectorAll('[data-test^="command-entry-function:"]')).toHaveLength(3);
    expect(document.body.textContent).not.toContain("Show more");
  });
  it("lists every match of a selected type and says when more are left", async () => {
    await setup();
    await search("payment");
    vi.advanceTimersByTime(1);
    typeChip("function").click();
    await flushPromises();
    expect(document.querySelectorAll('[data-test^="command-entry-function:"]')).toHaveLength(6);
    expect(document.querySelector('[data-test="command-palette-capped"]')?.textContent).toContain(
      "first 6 matches",
    );
  });
  it("gives a failed search the whole footer for its retry, so the hints never wrap", async () => {
    await setup();
    expect(document.querySelector('[data-test="command-palette-hints"]')).not.toBeNull();
    vi.mocked(resources.search).mockRejectedValue(new Error("offline"));
    await search("payment");
    await vi.advanceTimersByTimeAsync(5000);
    await flushPromises();
    expect(document.querySelector('[data-test="command-palette-retry"]')).not.toBeNull();
    expect(document.querySelector('[data-test="command-palette-hints"]')).toBeNull();
  });
  it("keeps the key hints on a partial answer and offers Retry for the failed types", async () => {
    vi.mocked(resources.search).mockResolvedValue({
      hits: result.hits,
      sources: [
        { type: "function", status: "complete", has_more: false },
        { type: "dashboard", status: "unavailable", has_more: null, reason: "source_unavailable" },
      ],
      took_ms: 0,
    });
    await setup();
    await search("payment");
    expect(document.querySelector('[data-test="command-palette-hints"]')).not.toBeNull();
    const retry = document.querySelector<HTMLElement>('[data-test="command-palette-retry"]')!;
    expect(retry.textContent).toContain("Some results are unavailable");
    const calls = vi.mocked(resources.search).mock.calls.length;
    retry.click();
    await flushPromises();
    await vi.advanceTimersByTimeAsync(200);
    await flushPromises();
    expect(vi.mocked(resources.search).mock.calls.length).toBeGreaterThan(calls);
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
