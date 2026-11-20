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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import { h, nextTick, ref } from "vue";
import { TooltipProvider } from "reka-ui";
import OTooltip from "./OTooltip.vue";

const DELAY_MS = 300;

let wrapper: VueWrapper<any> | undefined;

function mountUnderAppProvider(children: () => ReturnType<typeof h>[]) {
  wrapper = mount(
    {
      render: () =>
        h(
          TooltipProvider,
          { delayDuration: DELAY_MS, skipDelayDuration: DELAY_MS },
          { default: children },
        ),
    },
    { attachTo: document.body },
  );
}

function el(id: string): Element {
  const found = document.querySelector(`[data-testid="${id}"]`);
  if (!found) throw new Error(`no ${id}`);
  return found;
}

const isOpen = (id: string) => el(id).getAttribute("data-state") !== "closed";
const shows = (text: string) => document.body.textContent?.includes(text) ?? false;
const move = (id: string) => el(id).dispatchEvent(new MouseEvent("pointermove", { bubbles: true }));
const leave = (id: string) =>
  el(id).dispatchEvent(new MouseEvent("pointerleave", { bubbles: true }));

async function settle(ms = 0) {
  await vi.advanceTimersByTimeAsync(ms);
  await nextTick();
}

const wrapperTooltip = (id: string, text: string, extra: Record<string, unknown> = {}) =>
  h(
    OTooltip,
    { content: text, ...extra },
    { default: () => h("button", { "data-testid": id }, id) },
  );

describe("OTooltip keeps its behaviour under the shared app provider, with a real portal", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
    vi.useRealTimers();
  });

  it("opens on a fresh hover after the pointer left while the tooltip was disabled", async () => {
    const disabled = ref(false);
    mountUnderAppProvider(() => [wrapperTooltip("a", "Alpha", { disabled: disabled.value })]);
    move("a");
    await settle(DELAY_MS);
    expect(isOpen("a")).toBe(true);

    disabled.value = true;
    await settle();
    leave("a");
    disabled.value = false;
    await settle(DELAY_MS + 100);

    move("a");
    await settle(DELAY_MS);
    expect(isOpen("a")).toBe(true);
    expect(shows("Alpha")).toBe(true);
  });

  it.each([
    ["wrapper", false],
    ["hoverable wrapper", true],
  ])(
    "opens a %s neighbour on the first move out of a hoverable tooltip",
    async (_label, hoverable) => {
      mountUnderAppProvider(() => [
        wrapperTooltip("a", "Alpha", { hoverable: true }),
        wrapperTooltip("b", "Beta", { hoverable }),
      ]);
      move("a");
      await settle(DELAY_MS);
      expect(isOpen("a")).toBe(true);

      leave("a");
      await settle();
      move("b");
      await settle(DELAY_MS);
      expect(isOpen("b")).toBe(true);
      expect(shows("Beta")).toBe(true);
    },
  );

  it("opens a wrapper neighbour on the first move out of a hoverable child-mode bubble", async () => {
    mountUnderAppProvider(() => [
      h("span", { "data-testid": "a" }, [
        h(OTooltip, { content: "Alpha", hoverable: true, delay: 0 }),
      ]),
      wrapperTooltip("b", "Beta"),
    ]);
    el("a").dispatchEvent(new MouseEvent("mouseenter"));
    await settle();
    const bubble = document.querySelector('[data-test="o-tooltip-content"]')!;
    bubble.dispatchEvent(new MouseEvent("pointerleave", { bubbles: true }));
    await settle();
    move("b");
    await settle(DELAY_MS);
    expect(isOpen("b")).toBe(true);
  });

  it("counts a tooltip nested in another one's trigger towards the shared skip window", async () => {
    const anchor = document.createElement("div");
    document.body.appendChild(anchor);
    mountUnderAppProvider(() => [
      h(
        OTooltip,
        { content: "Outer" },
        {
          default: () =>
            h("span", [h(OTooltip, { content: "Pinned", anchor, open: true }), "outer"]),
        },
      ),
      h("button", { "data-testid": "a" }, [h(OTooltip, { content: "Alpha" })]),
      wrapperTooltip("b", "Beta"),
    ]);
    await settle();
    el("a").dispatchEvent(new MouseEvent("mouseenter"));
    await settle(DELAY_MS);
    expect(shows("Alpha")).toBe(true);

    el("a").dispatchEvent(new MouseEvent("mouseleave"));
    await settle(DELAY_MS + 1);
    move("b");
    await settle();
    expect(isOpen("b")).toBe(true);
    anchor.remove();
  });

  it("reports no close to its caller for a pass-over that never opened it", async () => {
    const changes: boolean[] = [];
    mountUnderAppProvider(() => [
      wrapperTooltip("a", "Alpha", { "onUpdate:open": (next: boolean) => changes.push(next) }),
    ]);
    move("a");
    await settle(100);
    leave("a");
    await settle(DELAY_MS);
    expect(changes).toEqual([]);
  });

  it.each([
    ["a wrapper", {}],
    ["an exclusive wrapper", { exclusive: true }],
    ["a child", {}],
  ] as const)(
    "reopens %s tooltip re-enabled while the pointer is still over it",
    async (mode, extra) => {
      const disabled = ref(false);
      const child = mode === "a child";
      mountUnderAppProvider(() => [
        child
          ? h("button", { "data-testid": "a" }, [
              h(OTooltip, { content: "Alpha", disabled: disabled.value }),
            ])
          : wrapperTooltip("a", "Alpha", { disabled: disabled.value, ...extra }),
      ]);
      el("a").dispatchEvent(
        new MouseEvent(child ? "mouseenter" : "pointermove", { bubbles: true }),
      );
      await settle(DELAY_MS);
      expect(shows("Alpha")).toBe(true);

      disabled.value = true;
      await settle();
      expect(shows("Alpha")).toBe(false);
      disabled.value = false;
      await settle();
      expect(shows("Alpha")).toBe(true);
    },
  );

  it("reports no second open when a controlled tooltip is re-enabled under the pointer and moved over", async () => {
    const disabled = ref(false);
    const open = ref(false);
    const changes: boolean[] = [];
    mountUnderAppProvider(() => [
      wrapperTooltip("a", "Alpha", {
        disabled: disabled.value,
        open: open.value,
        "onUpdate:open": (next: boolean) => {
          changes.push(next);
          open.value = next;
        },
      }),
    ]);
    move("a");
    await settle(DELAY_MS);
    disabled.value = true;
    await settle();
    disabled.value = false;
    await settle();
    move("a");
    await settle(DELAY_MS);
    expect(isOpen("a")).toBe(true);
    expect(changes).toEqual([true]);
  });
});
