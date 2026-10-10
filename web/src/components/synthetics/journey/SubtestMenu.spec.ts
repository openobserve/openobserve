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
import { createI18n } from "vue-i18n";

// Reka portals popover content into <body>; render it inline so the menu can be asserted.
vi.mock("reka-ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("reka-ui")>();
  return { ...actual, PopoverPortal: actual.PopoverContent };
});

vi.mock("@/services/synthetics", () => ({
  default: { listByFolderId: vi.fn(), get: vi.fn() },
}));

// The real toast is a no-op in jsdom, so the failure path has to be observed through a mock.
const mockToast = vi.fn();
vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: (...args: unknown[]) => mockToast(...args),
}));

import store from "@/test/unit/helpers/store";
import en from "@/locales/languages/en-US.json";
import syntheticsService from "@/services/synthetics";
import SubtestMenu from "./SubtestMenu.vue";

const i18n = createI18n({
  legacy: false,
  locale: "en-US",
  fallbackLocale: "en-US",
  messages: { "en-US": en as Record<string, unknown> },
});

const list = syntheticsService.listByFolderId as ReturnType<typeof vi.fn>;
const get = syntheticsService.get as ReturnType<typeof vi.fn>;

const OTooltipStub = {
  name: "OTooltip",
  props: ["content", "disabled", "side"],
  template: '<span class="o-tooltip-stub" :data-content="content" />',
};

const ROWS = [
  { id: "self", name: "Checkout", type: "browser", steps: 4, references: 0 },
  { id: "holder", name: "Full flow", type: "browser", steps: 20, references: 1 },
  {
    id: "login",
    name: "Login",
    type: "browser",
    steps: 13,
    referenced_by: 5,
    references: 0,
    enabled: true,
  },
  {
    id: "staging",
    name: "Login (staging)",
    type: "browser",
    steps: 2,
    referenced_by: 1,
    references: 0,
    enabled: false,
  },
  { id: "api", name: "Orders API", type: "http" },
];

const TRIGGER = '[data-test="synthetics-journey-add-subtest-btn"]';
const MENU = '[data-test="synthetics-subtest-menu"]';
const SEARCH = '[data-test="synthetics-subtest-menu-search"] input';
const row = (id: string) => `[data-test="synthetics-subtest-menu-row-${id}"]`;

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function mountMenu(props: Record<string, unknown> = {}) {
  return mount(SubtestMenu, {
    props: { ownCheckId: "self", disabled: false, ...props },
    attachTo: document.body,
    global: { plugins: [store, i18n], stubs: { OTooltip: OTooltipStub } },
  }) as VueWrapper;
}

async function open(w: VueWrapper) {
  await w.get(TRIGGER).trigger("click");
  await flushPromises();
}

const rowIds = (w: VueWrapper) =>
  w
    .findAll('[data-test^="synthetics-subtest-menu-row-"]')
    .map((r) => r.attributes("data-test")!.replace("synthetics-subtest-menu-row-", ""));

describe("SubtestMenu", () => {
  let wrapper: VueWrapper;

  beforeEach(() => {
    list.mockResolvedValue({ data: { checks: ROWS } });
    get.mockImplementation((_org: string, id: string) =>
      Promise.resolve({ data: { id, name: ROWS.find((r) => r.id === id)?.name } }),
    );
  });

  afterEach(() => {
    wrapper?.unmount();
    list.mockReset();
    get.mockReset();
    mockToast.mockReset();
  });

  it("is a labelled Add subtest trigger that fetches nothing until opened", async () => {
    wrapper = mountMenu();
    await flushPromises();

    expect(wrapper.get(TRIGGER).text()).toContain("Add subtest");
    expect(wrapper.get(TRIGGER).attributes("disabled")).toBeUndefined();
    expect(list).not.toHaveBeenCalled();
    expect(wrapper.find(MENU).exists()).toBe(false);
  });

  it("is disabled like Add step while the journey cannot take a row", () => {
    wrapper = mountMenu({ disabled: true });

    expect(wrapper.get(TRIGGER).attributes("disabled")).toBeDefined();
  });

  it("opens with its title, help, a focused search box and the tip", async () => {
    wrapper = mountMenu();
    await open(wrapper);

    const menu = wrapper.get(MENU);
    expect(menu.text()).toContain("Add subtest");
    expect(menu.text()).toContain(
      "Reuse a shared flow. Edits to it update every test that uses it.",
    );
    expect(menu.text()).toContain("Tip: select steps, then Extract to subtest to create one.");
    expect(document.activeElement).toBe(wrapper.get(SEARCH).element);
  });

  it("lists usable tests first and the nested-holding ones last, disabled, without its own check", async () => {
    wrapper = mountMenu();
    await open(wrapper);

    expect(rowIds(wrapper)).toEqual(["login", "staging", "holder"]);
    const group = wrapper.get('[data-test="synthetics-subtest-menu-blocked-group"]');
    expect(group.text()).toBe("Can't be nested");
    expect(
      group.element.compareDocumentPosition(wrapper.get(row("holder")).element) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(wrapper.get(row("holder")).attributes("disabled")).toBeDefined();
    expect(wrapper.get(row("holder")).text()).toContain(
      "Already contains a subtest — nesting is limited to one level",
    );
    expect(wrapper.get(row("login")).attributes("disabled")).toBeUndefined();
  });

  it("describes each row by its steps and users, and marks a paused test", async () => {
    wrapper = mountMenu();
    await open(wrapper);

    expect(wrapper.get(row("login")).text()).toContain("13 steps · Used by 5 tests");
    expect(wrapper.get(row("staging")).text()).toContain("2 steps · Used by 1 test · Paused");
    expect(wrapper.get(row("login")).attributes("aria-label")).toBe('Add "Login" as a subtest');
  });

  it("filters by name, case-insensitively, and says when nothing matches", async () => {
    wrapper = mountMenu();
    await open(wrapper);

    await wrapper.get(SEARCH).setValue("STAG");
    await flushPromises();
    expect(rowIds(wrapper)).toEqual(["staging"]);
    expect(wrapper.find('[data-test="synthetics-subtest-menu-blocked-group"]').exists()).toBe(
      false,
    );

    await wrapper.get(SEARCH).setValue("zzz");
    await flushPromises();
    expect(rowIds(wrapper)).toEqual([]);
    expect(wrapper.get('[data-test="synthetics-subtest-menu-no-match"]').text()).toContain(
      'No tests match "zzz"',
    );
  });

  it("shows the empty state when no other browser test exists", async () => {
    list.mockResolvedValue({ data: { checks: [ROWS[0], ROWS[4]] } });
    wrapper = mountMenu();
    await open(wrapper);

    expect(wrapper.get('[data-test="synthetics-subtest-menu-empty"]').text()).toContain(
      "No other browser tests in this organization yet.",
    );
    expect(wrapper.find('[data-test="synthetics-subtest-menu-no-match"]').exists()).toBe(false);
  });

  it("shows loading while the list is in flight", async () => {
    const pending = deferred<unknown>();
    list.mockReturnValue(pending.promise);
    wrapper = mountMenu();
    await open(wrapper);

    expect(wrapper.find('[data-test="synthetics-subtest-menu-loading"]').exists()).toBe(true);

    pending.resolve({ data: { checks: ROWS } });
    await flushPromises();
    expect(wrapper.find('[data-test="synthetics-subtest-menu-loading"]').exists()).toBe(false);
    expect(rowIds(wrapper)).toContain("login");
  });

  it("says inline when the list fails to load, and Retry fetches it again", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    list.mockRejectedValueOnce(new Error("boom"));
    wrapper = mountMenu();
    await open(wrapper);

    const error = wrapper.get('[data-test="synthetics-subtest-menu-load-error"]');
    expect(error.text()).toContain("Couldn't load the list of browser tests. Try again.");
    expect(mockToast).not.toHaveBeenCalled();

    await error.get("button").trigger("click");
    await flushPromises();

    expect(list).toHaveBeenCalledTimes(2);
    expect(wrapper.find('[data-test="synthetics-subtest-menu-load-error"]').exists()).toBe(false);
    expect(rowIds(wrapper)).toContain("login");
    consoleError.mockRestore();
  });

  it("fetches the list on the first open only", async () => {
    wrapper = mountMenu();
    await flushPromises();
    expect(list).not.toHaveBeenCalled();

    await open(wrapper);
    await open(wrapper);
    await open(wrapper);

    expect(list).toHaveBeenCalledTimes(1);
  });

  it("shows the cached rows at once when remounted, without a second request", async () => {
    wrapper = mountMenu();
    await open(wrapper);
    wrapper.unmount();

    wrapper = mountMenu();
    await wrapper.get(TRIGGER).trigger("click");

    expect(wrapper.find('[data-test="synthetics-subtest-menu-loading"]').exists()).toBe(false);
    expect(rowIds(wrapper)).toEqual(["login", "staging", "holder"]);
    await flushPromises();
    expect(list).toHaveBeenCalledTimes(1);
  });

  it("a pick loads the test, emits its id and name, and closes", async () => {
    wrapper = mountMenu();
    await open(wrapper);

    await wrapper.get(row("login")).trigger("click");
    await flushPromises();

    expect(get).toHaveBeenCalledWith("default", "login");
    expect(wrapper.emitted("pick")).toEqual([[{ id: "login", name: "Login" }]]);
    expect(wrapper.find(MENU).exists()).toBe(false);
  });

  it("while a pick loads, its row spins and the other rows are inert", async () => {
    const pending = deferred<unknown>();
    get.mockReturnValue(pending.promise);
    wrapper = mountMenu();
    await open(wrapper);

    await wrapper.get(row("login")).trigger("click");
    await flushPromises();

    expect(wrapper.get(row("login")).attributes("aria-busy")).toBe("true");
    expect(wrapper.get(row("staging")).attributes("disabled")).toBeDefined();
    await wrapper.get(row("staging")).trigger("click");
    expect(get).toHaveBeenCalledTimes(1);

    pending.resolve({ data: { name: "Login" } });
    await flushPromises();
    expect(wrapper.emitted("pick")).toHaveLength(1);
  });

  it("a pick whose load fails appends nothing, says so, and stays open", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    get.mockRejectedValue(new Error("gone"));
    wrapper = mountMenu();
    await open(wrapper);

    await wrapper.get(row("login")).trigger("click");
    await flushPromises();

    expect(wrapper.emitted("pick")).toBeUndefined();
    expect(mockToast).toHaveBeenCalledWith({
      variant: "error",
      message: "Couldn't add Login. Try again.",
    });
    expect(wrapper.find(MENU).exists()).toBe(true);
    expect(wrapper.get(row("login")).attributes("disabled")).toBeUndefined();
    consoleError.mockRestore();
  });
});
