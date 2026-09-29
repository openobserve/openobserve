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

import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { createMemoryHistory, createRouter } from "vue-router";

// Reka portals popover content into <body>; render it inline so the popover can be asserted.
vi.mock("reka-ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("reka-ui")>();
  return { ...actual, PopoverPortal: actual.PopoverContent };
});

import en from "@/locales/languages/en-US.json";
import type { SyntheticsFolder } from "@/types/synthetics";
import JourneyUsedByPopover from "./JourneyUsedByPopover.vue";

const i18n = createI18n({
  legacy: false,
  locale: "en-US",
  fallbackLocale: "en-US",
  messages: { "en-US": en as Record<string, unknown> },
});

const OIconStub = { props: ["name", "size"], template: '<i :data-icon="name" />' };
const Blank = { template: "<div />" };

const FOLDERS: SyntheticsFolder[] = [
  { folderId: "default", name: "Default" },
  { folderId: "f-shop", name: "Shop" },
];

const reference = (id: string, name: string, folder_id = "f-shop") => ({ id, name, folder_id });

const TRIGGER = '[data-test="synthetics-journey-used-by-trigger"]';
const VIEW_ALL = '[data-test="synthetics-journey-used-by-view-all"]';
const row = (id: string) => `[data-test="synthetics-journey-used-by-row-${id}"]`;
const rows = (w: VueWrapper) => w.findAll('[data-test^="synthetics-journey-used-by-row-"]');

function mountPopover(props: Record<string, unknown> = {}) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", component: Blank },
      { name: "synthetics-edit", path: "/synthetics/:id/edit", component: Blank },
    ],
  });
  return mount(JourneyUsedByPopover, {
    props: {
      references: [
        reference("c1", "Checkout — happy path"),
        reference("c2", "Account settings", "default"),
      ],
      hidden: 0,
      folders: FOLDERS,
      orgIdentifier: "acme",
      ...props,
    },
    attachTo: document.body,
    global: { plugins: [i18n, router], stubs: { OIcon: OIconStub } },
  }) as VueWrapper;
}

async function open(w: VueWrapper) {
  await w.get(TRIGGER).trigger("click");
  await flushPromises();
}

describe("JourneyUsedByPopover", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
  });

  it("lists each test with its folder and links to its editor", async () => {
    wrapper = mountPopover();
    expect(wrapper.get(TRIGGER).text()).toContain("Used by 2 tests");
    expect(wrapper.get(TRIGGER).attributes("aria-haspopup")).toBe("dialog");

    await open(wrapper);

    const first = wrapper.get(row("c1"));
    expect(first.text()).toContain("Checkout — happy path");
    expect(first.text()).toContain("Shop");
    const firstHref = (first.element.closest("a") ?? first.get("a").element).getAttribute("href");
    expect(firstHref).toContain("/synthetics/c1/edit");
    expect(firstHref).toContain("org_identifier=acme");
    expect(firstHref).toContain("folder=f-shop");

    const second = wrapper.get(row("c2"));
    expect(second.text()).toContain("Account settings");
    expect(second.text()).toContain("Default");
    const secondHref = (second.element.closest("a") ?? second.get("a").element).getAttribute(
      "href",
    );
    expect(secondHref).toContain("/synthetics/c2/edit");
  });

  it("says those tests use their own Starting URL, environments and secrets", async () => {
    wrapper = mountPopover();
    await open(wrapper);

    const content = wrapper.get("[data-o-popover-content]");
    expect(content.attributes("aria-label")).toBe("Tests that use this one");
    expect(content.text()).toContain(
      "They run these steps on their own page. This test's Starting URL, environments and secrets are not used there.",
    );
  });

  it("shows five tests and expands on View all", async () => {
    const references = Array.from({ length: 7 }, (_, i) => reference(`c${i + 1}`, `Test ${i + 1}`));
    wrapper = mountPopover({ references });
    await open(wrapper);

    expect(rows(wrapper)).toHaveLength(5);
    expect(wrapper.get(VIEW_ALL).text()).toContain("View all 7 tests");

    await wrapper.get(VIEW_ALL).trigger("click");
    await flushPromises();

    expect(rows(wrapper)).toHaveLength(7);
    expect(wrapper.find(row("c7")).exists()).toBe(true);
    expect(wrapper.find(VIEW_ALL).exists()).toBe(false);

    wrapper.unmount();
    wrapper = mountPopover({ references: references.slice(0, 5) });
    await open(wrapper);
    expect(rows(wrapper)).toHaveLength(5);
    expect(wrapper.find(VIEW_ALL).exists()).toBe(false);
  });

  it("counts the tests the user cannot open", async () => {
    wrapper = mountPopover({ hidden: 3 });
    expect(wrapper.get(TRIGGER).text()).toContain("Used by 5 tests");

    await open(wrapper);
    expect(wrapper.get("[data-o-popover-content]").text()).toContain(
      "3 tests you don't have access to",
    );
    expect(rows(wrapper)).toHaveLength(2);

    wrapper.unmount();
    wrapper = mountPopover({ hidden: 0 });
    await open(wrapper);
    expect(wrapper.get("[data-o-popover-content]").text()).not.toContain(
      "you don't have access to",
    );
  });
});
