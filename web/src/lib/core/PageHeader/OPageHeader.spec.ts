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
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { computed, defineComponent, h, ref, shallowRef, type Component } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import i18n from "@/locales";
import OPageHeader from "@/lib/core/PageHeader/OPageHeader.vue";
import { providePageHeaderStatus } from "@/lib/core/PageHeader/pageHeaderStatus";
import { raw } from "@/types/i18n";
import OAccessHeaderChip from "@/components/access/OAccessHeaderChip.vue";
import { viewDenial } from "@/composables/useAccessStore";

const lgUp = ref(true);
vi.mock("@/composables/useBreakpoint", () => ({
  default: () => ({ isMobile: computed(() => false), lgUp: computed(() => lgUp.value) }),
}));

const entries = shallowRef([viewDenial("templates", "list", ["GET /api/default/templates"])]);
vi.mock("@/composables/useAccessStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/composables/useAccessStore")>();
  return { ...actual, useAccessBoundary: () => ({ sectionEntries: entries }) };
});

const Status = defineComponent({ setup: () => () => h("button", { "data-test": "status" }) });
const ROW_FLOORS = ["md:max-lg:min-w-40", "max-md:min-w-24"];

let wrapper: VueWrapper | null = null;

let resizeCallbacks: ResizeObserverCallback[] = [];
class MockResizeObserver {
  constructor(cb: ResizeObserverCallback) {
    resizeCallbacks.push(cb);
  }
  observe = vi.fn();
  disconnect = vi.fn();
}

// Mounts inside a page container of `pageWidth` px when given, as OPageLayout provides one.
async function mountHeader(
  withStatus: boolean,
  desktop: boolean,
  pageWidth?: number,
  status: Component = Status,
) {
  lgUp.value = desktop;
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/", component: { render: () => null } }],
  });
  const Host = defineComponent({
    setup() {
      providePageHeaderStatus(
        () => (withStatus ? status : null),
        () => "/",
      );
      return () => {
        const header = h(
          OPageHeader,
          { title: raw("Alerts") },
          { actions: () => h("button", "New alert") },
        );
        return pageWidth === undefined
          ? header
          : h("div", { class: "@container/page", ref: setPageWidth }, [header]);
      };
    },
  });
  const setPageWidth = (el: unknown) => {
    if (el instanceof HTMLElement)
      Object.defineProperty(el, "clientWidth", { configurable: true, value: pageWidth });
  };
  wrapper = mount(Host, { attachTo: document.body, global: { plugins: [i18n, router] } });
  await flushPromises();
}

const titleBlock = () => wrapper!.find("h1").element.closest(".flex-1")!;
// The status is one element in the title block; on one row CSS order moves it beside the actions.
const statusInTitleRow = () => {
  const status = titleBlock().querySelector('[data-test="status"]');
  return status !== null && !status.parentElement!.classList.contains("order-last");
};
const pageEl = () =>
  wrapper!.element.parentElement!.querySelector<HTMLElement>('[class~="@container/page"]')!;
async function resizePage(width: number) {
  Object.defineProperty(pageEl(), "clientWidth", { configurable: true, value: width });
  for (const cb of resizeCallbacks) cb([], {} as ResizeObserver);
  await flushPromises();
}
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
// Classes this header adds only for a status; a chipless header must render as it did before.
const STATUS_ONLY = /@max-4xl\/page:min-w-|\border-last\b|-me-2/;

beforeEach(() => {
  resizeCallbacks = [];
  vi.stubGlobal("ResizeObserver", MockResizeObserver);
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  vi.unstubAllGlobals();
});

describe("OPageHeader with a status", () => {
  it("shows the status with the actions on desktop", async () => {
    await mountHeader(true, true);
    expect(wrapper!.findAll('[data-test="status"]')).toHaveLength(1);
    expect(statusInTitleRow()).toBe(false);
  });

  it("puts the status beside the title below lg, keeping the row's wrap floors", async () => {
    await mountHeader(true, false);
    expect(wrapper!.findAll('[data-test="status"]')).toHaveLength(1);
    expect(statusInTitleRow()).toBe(true);
    for (const floor of ROW_FLOORS) expect(titleBlock().className).toContain(floor);
    expect(wrapper!.html()).not.toContain("md:max-lg:min-w-32");
  });

  it("puts the status beside the title when a narrow page container wraps the row on a wide viewport", async () => {
    await mountHeader(true, true, 700);
    expect(wrapper!.findAll('[data-test="status"]')).toHaveLength(1);
    expect(statusInTitleRow()).toBe(true);
    // The container floor is what makes the actions wrap instead of the title collapsing under the status.
    expect(titleBlock().className).toContain("md:@max-4xl/page:min-w-40");
  });

  it("moves the status back to the actions once the page container widens", async () => {
    await mountHeader(true, true, 700);
    const page = wrapper!.element.parentElement!.querySelector<HTMLElement>(
      '[class~="@container/page"]',
    )!;
    Object.defineProperty(page, "clientWidth", { configurable: true, value: 1200 });
    for (const cb of resizeCallbacks) cb([], {} as ResizeObserver);
    await flushPromises();
    expect(wrapper!.findAll('[data-test="status"]')).toHaveLength(1);
    expect(statusInTitleRow()).toBe(false);
  });

  it("keeps the status with the actions in a wide page container", async () => {
    await mountHeader(true, true, 1200);
    expect(statusInTitleRow()).toBe(false);
  });

  it("keeps the title's own floor when no status is shown", async () => {
    await mountHeader(false, false);
    expect(wrapper!.html()).toContain("md:max-lg:min-w-32");
  });

  it("adds no status class to a chipless header in a narrow page container", async () => {
    await mountHeader(false, true, 700);
    expect(wrapper!.html()).not.toMatch(STATUS_ONLY);
    expect(titleBlock().className).not.toContain("md:@max-4xl/page:min-w-40");
  });
});

describe("OPageHeader with the access chip", () => {
  const chip = () => document.querySelector<HTMLElement>('[data-test="access-header-chip"]')!;
  const card = () => document.querySelector('[data-test="access-header-popover"]');
  const announcer = () =>
    document.querySelector<HTMLElement>('[data-test="access-header-chip-announcer"]')!;

  it("sizes the chip by the row's wrap, not the viewport", async () => {
    await mountHeader(true, true, 700, OAccessHeaderChip);
    expect(chip().className).toContain("h-6");
    expect(chip().textContent).not.toContain("Access denied");
    await resizePage(1200);
    expect(chip().className).not.toContain("h-6");
    expect(chip().textContent).toContain("Access denied");
  });

  it("moves one chip when the row's wrap flips, keeping its card open and its announcement", async () => {
    await mountHeader(true, true, 1200, OAccessHeaderChip);
    await wait(400);
    const before = { chip: chip(), announcer: announcer(), text: announcer().textContent };
    chip().click();
    await flushPromises();
    expect(card()).not.toBeNull();
    const changes: MutationRecord[] = [];
    const observer = new MutationObserver((records) => changes.push(...records));
    observer.observe(announcer(), { childList: true, characterData: true, subtree: true });
    await resizePage(700);
    await wait(400);
    observer.disconnect();
    expect(titleBlock().contains(chip())).toBe(true);
    expect(chip()).toBe(before.chip);
    expect(announcer()).toBe(before.announcer);
    expect(announcer().textContent).toBe(before.text);
    expect(changes).toHaveLength(0);
    expect(card()).not.toBeNull();
  });
});
