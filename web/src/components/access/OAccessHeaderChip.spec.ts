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
import { computed, shallowRef, type ShallowRef } from "vue";
import i18n from "@/locales";
import OAccessHeaderChip from "@/components/access/OAccessHeaderChip.vue";
import { viewDenial, type AccessSectionEntry } from "@/composables/useAccessStore";

const state = vi.hoisted(() => ({
  entries: null as unknown as ShallowRef<AccessSectionEntry[]>,
}));

const screen = vi.hoisted(() => ({ lgUp: true }));
vi.mock("@/composables/useBreakpoint", () => ({
  default: () => ({ lgUp: computed(() => screen.lgUp) }),
}));

vi.mock("@/composables/useAccessStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/composables/useAccessStore")>();
  return { ...actual, useAccessBoundary: () => ({ sectionEntries: state.entries }) };
});

let wrapper: VueWrapper | null = null;

const announcer = () => wrapper!.find('[data-test="access-header-chip-announcer"]');
const chipName = () => wrapper!.find('[data-test="access-header-chip"]').attributes("aria-label");
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

beforeEach(() => {
  screen.lgUp = true;
  state.entries = shallowRef([viewDenial("templates", "list", ["GET /api/default/templates"])]);
  wrapper = mount(OAccessHeaderChip, { attachTo: document.body, global: { plugins: [i18n] } });
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

describe("OAccessHeaderChip", () => {
  it("announces the chip once through a polite live region", async () => {
    const region = announcer();
    expect(region.attributes("aria-live")).toBe("polite");
    expect(region.attributes("role")).toBe("status");
    expect(region.text()).toBe("");
    await wait(400);
    expect(region.text()).toBe(chipName());
    expect(region.text()).toContain("templates");
  });

  it("does not re-announce when the same denials render again", async () => {
    await wait(400);
    const changes: MutationRecord[] = [];
    const observer = new MutationObserver((records) => changes.push(...records));
    observer.observe(announcer().element, { childList: true, characterData: true, subtree: true });
    state.entries.value = [viewDenial("templates", "list", ["GET /api/default/templates"])];
    await flushPromises();
    await wait(400);
    observer.disconnect();
    expect(changes).toHaveLength(0);
  });

  it("announces again when the denials change", async () => {
    await wait(400);
    state.entries.value = [
      viewDenial("templates", "list", ["GET /api/default/templates"]),
      viewDenial("destinations", "list", ["GET /api/default/destinations"]),
    ];
    await flushPromises();
    expect(announcer().text()).toBe(chipName());
    expect(announcer().text()).not.toContain("templates");
  });

  it("asks for an administrator, naming no permission, for a read no role grant lifts", async () => {
    state.entries.value = [
      {
        resource: {
          key: "_unnamed/synthetics",
          labelKey: "accessBoundary.resourcesInline.unnamed",
          path: "/api/default/synthetics/variables",
          grantable: false,
        },
        permission: "list",
        requests: ["GET /api/default/synthetics/variables"],
      },
    ];
    await flushPromises();
    await wrapper!.find('[data-test="access-header-chip"]').trigger("click");
    await flushPromises();
    const card = document.querySelector('[data-test="access-header-popover"]')!;
    expect(card.querySelector('[data-test="access-denied-title"]')?.textContent).toBe(
      "You can't view this resource",
    );
    expect(card.querySelector('[data-test="access-denied-ask-admin"]')?.textContent).toBe(
      "Ask your administrator for access.",
    );
    expect(card.textContent).not.toContain("permission");
  });

  it("is no taller than the title it sits beside below lg", async () => {
    wrapper!.unmount();
    screen.lgUp = false;
    wrapper = mount(OAccessHeaderChip, { attachTo: document.body, global: { plugins: [i18n] } });
    const chip = wrapper.find('[data-test="access-header-chip"]');
    expect(chip.classes()).toContain("h-6");
  });
});
