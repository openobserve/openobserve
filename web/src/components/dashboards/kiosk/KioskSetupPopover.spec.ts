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
import i18n from "@/locales";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import KioskSetupPopover from "./KioskSetupPopover.vue";

const body = (selector: string) => document.body.querySelector<HTMLElement>(selector);

describe("KioskSetupPopover", () => {
  let wrapper: VueWrapper<any> | null = null;

  const mountPopover = (props: Record<string, unknown> = {}) => {
    wrapper = mount(KioskSetupPopover, {
      props,
      attachTo: document.body,
      global: { plugins: [i18n] },
    });
    return wrapper;
  };

  const openPopover = async () => {
    await wrapper!.find('[data-test="dashboard-kiosk-btn"]').trigger("click");
    await flushPromises();
  };

  const clickOpen = async () => {
    body('[data-test="dashboard-kiosk-open"]')!.click();
    await flushPromises();
  };

  afterEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
    wrapper?.unmount();
    wrapper = null;
    document.body.innerHTML = "";
  });

  it("is an icon-only toolbar button with a TV mode tooltip", () => {
    mountPopover();
    const button = wrapper!.find('[data-test="dashboard-kiosk-btn"]');
    expect(button.text()).toBe("");
    expect(button.attributes("aria-label")).toBe("TV mode");
    expect(wrapper!.findComponent(OTooltip).props("content")).toBe("TV mode");
  });

  it("holds only the fields and the open action, with no copy link or summary", async () => {
    mountPopover();
    await openPopover();
    const popover = body('[data-test="dashboard-kiosk-popover"]')!;
    expect(popover.querySelector('[data-test="dashboard-kiosk-refresh"]')).not.toBeNull();
    expect(popover.querySelector('[data-test="dashboard-kiosk-theme"]')).not.toBeNull();
    expect(popover.querySelector('[data-test="dashboard-kiosk-fit"]')).not.toBeNull();
    expect(popover.querySelector('[data-test="dashboard-kiosk-open"]')).not.toBeNull();
    expect(popover.querySelector('[data-test="dashboard-kiosk-copy-link"]')).toBeNull();
    expect(popover.querySelector('[data-test="dashboard-kiosk-summary"]')).toBeNull();
    expect(popover.querySelector("p")).toBeNull();
  });

  it("defaults an off refresh to 5 minutes and leaves fit off", async () => {
    mountPopover({ currentRefreshSeconds: 0 });
    await openPopover();
    await clickOpen();

    expect(wrapper!.emitted("open")?.[0]).toEqual([
      { refreshSeconds: 300, theme: "current", fit: false },
    ]);
  });

  it("keeps the dashboard's own refresh and emits the chosen theme and fit", async () => {
    mountPopover({ currentRefreshSeconds: 60 });
    await openPopover();
    body('[data-test="dashboard-kiosk-theme-dark"]')!.click();
    body('[data-test="dashboard-kiosk-fit-btn"]')!.click();
    await flushPromises();
    await clickOpen();

    expect(wrapper!.emitted("open")?.[0]).toEqual([
      { refreshSeconds: 60, theme: "dark", fit: true },
    ]);
  });

  it("remembers the last theme and fit for the session, but follows the dashboard's refresh", async () => {
    mountPopover({ currentRefreshSeconds: 60 });
    await openPopover();
    body('[data-test="dashboard-kiosk-theme-light"]')!.click();
    body('[data-test="dashboard-kiosk-fit-btn"]')!.click();
    await flushPromises();
    await clickOpen();
    wrapper!.unmount();

    mountPopover({ currentRefreshSeconds: 900 });
    await openPopover();
    await clickOpen();
    expect(wrapper!.emitted("open")?.[0]).toEqual([
      { refreshSeconds: 900, theme: "light", fit: true },
    ]);
  });

  it("does not remember choices from a popover closed without opening TV mode", async () => {
    mountPopover();
    await openPopover();
    body('[data-test="dashboard-kiosk-theme-dark"]')!.click();
    await flushPromises();
    wrapper!.vm.$.setupState.open = false;
    await flushPromises();
    await openPopover();
    await clickOpen();
    expect(wrapper!.emitted("open")?.[0]?.[0]).toMatchObject({ theme: "current", fit: false });
  });

  it("still works when session storage is unavailable", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    mountPopover({ currentRefreshSeconds: 60 });
    await openPopover();
    await clickOpen();
    expect(wrapper!.emitted("open")?.[0]).toEqual([
      { refreshSeconds: 60, theme: "current", fit: false },
    ]);
  });

  it("raises a refresh below the server minimum", async () => {
    mountPopover({ currentRefreshSeconds: 5, minRefreshSeconds: 30 });
    await openPopover();
    await clickOpen();

    expect(wrapper!.emitted("open")?.[0]?.[0]).toMatchObject({ refreshSeconds: 30 });
  });
});
