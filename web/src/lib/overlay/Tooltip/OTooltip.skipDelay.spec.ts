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

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import { KeepAlive, defineComponent, h, nextTick, ref } from "vue";
import { TooltipProvider } from "reka-ui";
import OTooltip from "./OTooltip.vue";

vi.mock("reka-ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("reka-ui")>();
  return { ...actual, TooltipPortal: actual.TooltipContent };
});

const here = dirname(fileURLToPath(import.meta.url));
const FIRST_OPEN_MS = 300;
const SKIP_WINDOW_MS = 300;

let wrapper: VueWrapper<any> | undefined;

function mountUnderAppProvider(children: () => ReturnType<typeof h>[]) {
  wrapper = mount(
    {
      render: () =>
        h(
          TooltipProvider,
          { delayDuration: FIRST_OPEN_MS, skipDelayDuration: SKIP_WINDOW_MS },
          { default: children },
        ),
    },
    { attachTo: document.body },
  );
  return wrapper;
}

const wrapperModeTooltips = () => [
  h(OTooltip, { content: "Alpha" }, { default: () => h("button", { "data-testid": "a" }, "A") }),
  h(OTooltip, { content: "Beta" }, { default: () => h("button", { "data-testid": "b" }, "B") }),
];

const childModeTooltips = () => [
  h("button", { "data-testid": "a" }, [h(OTooltip, { content: "Alpha" })]),
  h("button", { "data-testid": "b" }, [h(OTooltip, { content: "Beta" })]),
];

function el(id: string): Element {
  const found = document.querySelector(`[data-testid="${id}"]`);
  if (!found) throw new Error(`no ${id}`);
  return found;
}

const isOpen = (id: string) => el(id).getAttribute("data-state") !== "closed";
const shows = (text: string) => document.body.textContent?.includes(text) ?? false;

async function settle(ms = 0) {
  await vi.advanceTimersByTimeAsync(ms);
  await nextTick();
}

describe("OTooltip skip-delay window", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
    vi.useRealTimers();
  });

  it("keeps the 300 ms first open, then opens a neighbour at once in wrapper mode", async () => {
    mountUnderAppProvider(wrapperModeTooltips);
    el("a").dispatchEvent(new MouseEvent("pointermove", { bubbles: true }));
    await settle(FIRST_OPEN_MS - 1);
    expect(isOpen("a")).toBe(false);
    await settle(1);
    expect(isOpen("a")).toBe(true);

    el("a").dispatchEvent(new MouseEvent("pointerleave", { bubbles: true }));
    el("b").dispatchEvent(new MouseEvent("pointermove", { bubbles: true }));
    await settle();
    expect(isOpen("b")).toBe(true);
  });

  it("waits the full delay again once the skip window has passed", async () => {
    mountUnderAppProvider(wrapperModeTooltips);
    el("a").dispatchEvent(new MouseEvent("pointermove", { bubbles: true }));
    await settle(FIRST_OPEN_MS);
    el("a").dispatchEvent(new MouseEvent("pointerleave", { bubbles: true }));
    await settle(SKIP_WINDOW_MS + 1);

    el("b").dispatchEvent(new MouseEvent("pointermove", { bubbles: true }));
    await settle();
    expect(isOpen("b")).toBe(false);
    await settle(FIRST_OPEN_MS);
    expect(isOpen("b")).toBe(true);
  });

  it("honours the same skip window in child mode", async () => {
    mountUnderAppProvider(childModeTooltips);
    el("a").dispatchEvent(new MouseEvent("mouseenter"));
    await settle(FIRST_OPEN_MS - 1);
    expect(shows("Alpha")).toBe(false);
    await settle(1);
    expect(shows("Alpha")).toBe(true);

    el("a").dispatchEvent(new MouseEvent("mouseleave"));
    el("b").dispatchEvent(new MouseEvent("mouseenter"));
    await settle();
    expect(shows("Beta")).toBe(true);
  });

  it("waits the full delay in child mode once the skip window has passed", async () => {
    mountUnderAppProvider(childModeTooltips);
    el("a").dispatchEvent(new MouseEvent("mouseenter"));
    await settle(FIRST_OPEN_MS);
    el("a").dispatchEvent(new MouseEvent("mouseleave"));
    await settle(SKIP_WINDOW_MS + 1);

    el("b").dispatchEvent(new MouseEvent("mouseenter"));
    await settle();
    expect(shows("Beta")).toBe(false);
    await settle(FIRST_OPEN_MS);
    expect(shows("Beta")).toBe(true);
  });

  describe("a tooltip that unmounts while open", () => {
    const shownA = ref(true);
    const anchoredOpen = ref(false);
    const anchor = document.createElement("div");

    beforeEach(() => {
      shownA.value = true;
      anchoredOpen.value = false;
      document.body.appendChild(anchor);
    });

    afterEach(() => {
      anchor.remove();
    });

    const wrapperA = () =>
      h(
        OTooltip,
        { content: "Alpha" },
        { default: () => h("button", { "data-testid": "a" }, "A") },
      );
    const childA = () =>
      h("button", { key: "a", "data-testid": "a" }, [h(OTooltip, { content: "Alpha" })]);
    const anchoredA = () =>
      h(OTooltip, { key: "a", content: "Alpha", anchor, open: anchoredOpen.value });
    const nextB = () =>
      h(
        OTooltip,
        { key: "b", content: "Beta" },
        { default: () => h("button", { "data-testid": "b" }, "B") },
      );

    async function openA(mode: "wrapper" | "child" | "anchored") {
      if (mode === "wrapper")
        el("a").dispatchEvent(new MouseEvent("pointermove", { bubbles: true }));
      if (mode === "child") el("a").dispatchEvent(new MouseEvent("mouseenter"));
      if (mode === "anchored") anchoredOpen.value = true;
      await settle(FIRST_OPEN_MS);
      expect(shows("Alpha")).toBe(true);
    }

    it.each([
      ["wrapper", wrapperA],
      ["child", childA],
      ["anchored", anchoredA],
    ] as const)(
      "ends the skip window in %s mode, so the next first open waits again",
      async (mode, a) => {
        mountUnderAppProvider(() => [...(shownA.value ? [a()] : []), nextB()]);
        await openA(mode);

        shownA.value = false;
        await settle(SKIP_WINDOW_MS + 1);
        el("b").dispatchEvent(new MouseEvent("pointermove", { bubbles: true }));
        await settle();
        expect(isOpen("b")).toBe(false);
        await settle(FIRST_OPEN_MS);
        expect(isOpen("b")).toBe(true);
      },
    );

    it("keeps the skip window while another tooltip is still open", async () => {
      mountUnderAppProvider(() => [
        h(OTooltip, { key: "pinned", content: "Pinned", anchor, open: true }),
        ...(shownA.value ? [childA()] : []),
        nextB(),
      ]);
      await settle();
      await openA("child");

      shownA.value = false;
      await settle(SKIP_WINDOW_MS + 1);
      el("b").dispatchEvent(new MouseEvent("pointermove", { bubbles: true }));
      await settle();
      expect(isOpen("b")).toBe(true);
    });
  });

  it("keeps the skip window while a pinned tooltip remains open after another closes", async () => {
    const anchor = document.createElement("div");
    document.body.appendChild(anchor);
    mountUnderAppProvider(() => [
      h(OTooltip, { content: "Pinned", anchor, open: true }),
      ...childModeTooltips(),
    ]);
    await settle();
    el("a").dispatchEvent(new MouseEvent("mouseenter"));
    await settle(FIRST_OPEN_MS);
    expect(shows("Alpha")).toBe(true);

    el("a").dispatchEvent(new MouseEvent("mouseleave"));
    await settle(SKIP_WINDOW_MS + 1);
    el("b").dispatchEvent(new MouseEvent("mouseenter"));
    await settle();
    expect(shows("Beta")).toBe(true);
    anchor.remove();
  });

  it("restores the first-open delay after a wrapper tooltip's kept-alive page is left", async () => {
    const page = (id: string, text: string) =>
      defineComponent({
        name: `Page${id}`,
        render: () =>
          h(OTooltip, { content: text }, { default: () => h("button", { "data-testid": id }, id) }),
      });
    const pages = { a: page("a", "Alpha"), b: page("b", "Beta") };
    const current = ref<"a" | "b">("a");
    mountUnderAppProvider(() => [h(KeepAlive, null, [h(pages[current.value])])]);
    el("a").dispatchEvent(new MouseEvent("pointermove", { bubbles: true }));
    await settle(FIRST_OPEN_MS);
    expect(isOpen("a")).toBe(true);

    current.value = "b";
    await settle(1000);
    el("b").dispatchEvent(new MouseEvent("pointermove", { bubbles: true }));
    await settle();
    expect(el("b").getAttribute("data-state")).toBe("closed");
    await settle(FIRST_OPEN_MS);
    expect(isOpen("b")).toBe(true);
  });

  describe("a wrapper tooltip on a kept-alive page", () => {
    const current = ref<"a" | "b">("a");
    const page = (id: string, render: () => ReturnType<typeof h>[]) =>
      defineComponent({ name: `CachedPage${id}`, render: () => h("div", render()) });
    const hoverable = (id: string, text: string, extra: Record<string, unknown> = {}) =>
      h(
        OTooltip,
        { content: text, ...extra },
        { default: () => h("button", { "data-testid": id }, id) },
      );

    function mountPages(a: () => ReturnType<typeof h>[]) {
      const pages = { a: page("a", a), b: page("b", () => [hoverable("b", "Beta")]) };
      current.value = "a";
      mountUnderAppProvider(() => [h(KeepAlive, null, [h(pages[current.value])])]);
    }

    async function visit(id: "a" | "b", ms = 0) {
      current.value = id;
      await settle(ms);
    }

    it("does not open on return when its hover timer expired while away", async () => {
      mountPages(() => [hoverable("a", "Alpha")]);
      el("a").dispatchEvent(new MouseEvent("pointermove", { bubbles: true }));
      await settle(100);

      await visit("b", 1000);
      await visit("a");
      expect(isOpen("a")).toBe(false);
      expect(shows("Alpha")).toBe(false);
    });

    it("opens on the first hover after returning to a page left while hovered", async () => {
      mountPages(() => [hoverable("a", "Alpha")]);
      el("a").dispatchEvent(new MouseEvent("pointermove", { bubbles: true }));
      await settle(FIRST_OPEN_MS);
      expect(isOpen("a")).toBe(true);

      await visit("b", 1000);
      await visit("a");
      el("a").dispatchEvent(new MouseEvent("pointermove", { bubbles: true }));
      await settle(FIRST_OPEN_MS);
      expect(isOpen("a")).toBe(true);
    });

    it("leaves an open hoverable tooltip without errors and opens it on the next hover", async () => {
      const errors: unknown[] = [];
      const onError = (e: ErrorEvent) => errors.push(e.error);
      window.addEventListener("error", onError);
      mountPages(() => [hoverable("a", "Alpha", { hoverable: true })]);
      el("a").dispatchEvent(new MouseEvent("pointermove", { bubbles: true }));
      await settle(FIRST_OPEN_MS);
      expect(isOpen("a")).toBe(true);

      await visit("b", 1000);
      expect(shows("Alpha")).toBe(false);
      await visit("a");
      el("a").dispatchEvent(new MouseEvent("pointermove", { bubbles: true }));
      await settle(FIRST_OPEN_MS);
      window.removeEventListener("error", onError);
      expect(errors).toEqual([]);
      expect(isOpen("a")).toBe(true);
    });

    it.each([
      ["closed", 0],
      ["open", FIRST_OPEN_MS],
    ])("reports no open change to its caller when left %s", async (_state, hoverMs) => {
      const changes: boolean[] = [];
      mountPages(() => [
        hoverable("a", "Alpha", { "onUpdate:open": (next: boolean) => changes.push(next) }),
      ]);
      if (hoverMs) el("a").dispatchEvent(new MouseEvent("pointermove", { bubbles: true }));
      await settle(hoverMs);
      const before = [...changes];

      await visit("b", 1000);
      await visit("a");
      expect(changes).toEqual(before);
    });

    it("releases a pinned tooltip's skip window while away and restores it on return", async () => {
      mountPages(() => [hoverable("p", "Pinned", { open: true }), hoverable("a", "Alpha")]);
      await settle();

      await visit("b", SKIP_WINDOW_MS + 1);
      el("b").dispatchEvent(new MouseEvent("pointermove", { bubbles: true }));
      await settle();
      expect(isOpen("b")).toBe(false);
      el("b").dispatchEvent(new MouseEvent("pointerleave", { bubbles: true }));
      await settle(SKIP_WINDOW_MS + 1);

      await visit("a");
      el("a").dispatchEvent(new MouseEvent("pointermove", { bubbles: true }));
      await settle();
      expect(isOpen("a")).toBe(true);
    });
  });

  describe("trigger and open state across lifecycle changes", () => {
    const Counter = defineComponent({
      setup() {
        const count = ref(0);
        return () =>
          h("button", { "data-testid": "a", onClick: () => count.value++ }, String(count.value));
      },
    });

    it.each([
      ["enabled", false],
      ["disabled", true],
    ])(
      "keeps a stateful %s trigger's state when its kept-alive page is left and returned to",
      async (_label, disabled) => {
        const away = ref(false);
        const Page = defineComponent({
          name: "CounterPage",
          render: () =>
            h(OTooltip, { content: "Counter", disabled }, { default: () => h(Counter) }),
        });
        const Other = defineComponent({ name: "OtherPage", render: () => h("p", "Other") });
        mountUnderAppProvider(() => [h(KeepAlive, null, [h(away.value ? Other : Page)])]);
        el("a").dispatchEvent(new MouseEvent("pointermove", { bubbles: true }));
        el("a").dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await settle(FIRST_OPEN_MS);
        expect(el("a").textContent).toBe("1");

        away.value = true;
        await settle(1000);
        away.value = false;
        await settle();
        expect(el("a").textContent).toBe("1");
      },
    );

    it.each([
      ["wrapper", "pointermove"],
      ["child", "mouseenter"],
    ])(
      "does not open a %s tooltip whose hover delay ran out while it was disabled",
      async (mode, hoverEvent) => {
        const disabled = ref(false);
        mountUnderAppProvider(() => [
          mode === "wrapper"
            ? h(
                OTooltip,
                { content: "Alpha", disabled: disabled.value },
                { default: () => h("button", { "data-testid": "a" }, "A") },
              )
            : h("button", { "data-testid": "a" }, [
                h(OTooltip, { content: "Alpha", disabled: disabled.value }),
              ]),
        ]);
        el("a").dispatchEvent(new MouseEvent(hoverEvent, { bubbles: true }));
        await settle(100);
        disabled.value = true;
        await settle(1000);
        disabled.value = false;
        await settle();
        expect(shows("Alpha")).toBe(false);
      },
    );

    it("does not reopen a tooltip that was disabled while open and re-enabled after the pointer left", async () => {
      const disabled = ref(false);
      mountUnderAppProvider(() => [
        h(
          OTooltip,
          { content: "Alpha", disabled: disabled.value },
          { default: () => h("button", { "data-testid": "a" }, "A") },
        ),
        ...wrapperModeTooltips().slice(1),
      ]);
      el("a").dispatchEvent(new MouseEvent("pointermove", { bubbles: true }));
      await settle(FIRST_OPEN_MS);
      expect(isOpen("a")).toBe(true);

      disabled.value = true;
      await settle();
      el("a").dispatchEvent(new MouseEvent("pointerleave", { bubbles: true }));
      document.body.dispatchEvent(new Event("scroll", { bubbles: true }));
      await settle(SKIP_WINDOW_MS + 1);
      disabled.value = false;
      await settle();
      expect(isOpen("a")).toBe(false);
      expect(shows("Alpha")).toBe(false);

      el("b").dispatchEvent(new MouseEvent("pointermove", { bubbles: true }));
      await settle();
      expect(isOpen("b")).toBe(false);
    });
  });

  it("starts the skip window for a wrapper tooltip mounted open", async () => {
    mountUnderAppProvider(() => [
      h(
        OTooltip,
        { content: "Pinned", open: true },
        { default: () => h("button", { "data-testid": "p" }, "P") },
      ),
      ...wrapperModeTooltips(),
    ]);
    await settle();
    expect(isOpen("p")).toBe(true);

    el("a").dispatchEvent(new MouseEvent("pointermove", { bubbles: true }));
    await settle();
    expect(el("a").getAttribute("data-state")).toBe("instant-open");
  });

  it("mounts the one provider at the app root", () => {
    const app = readFileSync(join(here, "../../../App.vue"), "utf8");
    expect(app).toMatch(/<TooltipProvider[\s\S]*:skip-delay-duration=/);
  });
});
