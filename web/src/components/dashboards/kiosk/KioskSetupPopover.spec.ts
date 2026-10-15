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

import { afterEach, describe, expect, it } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import i18n from "@/locales";
import { raw } from "@/types/i18n";
import KioskSetupPopover from "./KioskSetupPopover.vue";

const body = (selector: string) => document.body.querySelector<HTMLElement>(selector);

describe("KioskSetupPopover", () => {
  let wrapper: VueWrapper<any> | null = null;

  const mountPopover = (props: Record<string, unknown> = {}) => {
    wrapper = mount(KioskSetupPopover, {
      props: {
        timeRangeLabel: raw("Past 15 Minutes, keeps moving"),
        tabName: "Overview",
        variables: ["region=eu"],
        ...props,
      },
      attachTo: document.body,
      global: { plugins: [i18n] },
    });
    return wrapper;
  };

  const openPopover = async () => {
    await wrapper!.find('[data-test="dashboard-kiosk-btn"]').trigger("click");
    await flushPromises();
  };

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.body.innerHTML = "";
  });

  it("labels the toolbar entry and keeps it icon-only when compact", () => {
    mountPopover();
    expect(wrapper!.find('[data-test="dashboard-kiosk-btn"]').text()).toContain("TV mode");

    wrapper!.unmount();
    mountPopover({ compact: true });
    expect(wrapper!.find('[data-test="dashboard-kiosk-btn"]').text()).not.toContain("TV mode");
  });

  it("shows what the TV will get: time range, tab and variables", async () => {
    mountPopover();
    await openPopover();
    const summary = body('[data-test="dashboard-kiosk-summary"]');
    expect(summary?.textContent).toContain("Past 15 Minutes, keeps moving");
    expect(summary?.textContent).toContain("Overview");
    expect(summary?.textContent).toContain("region=eu");
  });

  it("defaults an off refresh to 5 minutes so the TV keeps updating", async () => {
    mountPopover({ currentRefreshSeconds: 0 });
    await openPopover();
    body('[data-test="dashboard-kiosk-open"]')!.click();
    await flushPromises();

    expect(wrapper!.emitted("open")?.[0]).toEqual([
      { refreshSeconds: 300, theme: "current", fit: true },
    ]);
  });

  it("keeps the dashboard's own refresh and emits the chosen theme on copy", async () => {
    mountPopover({ currentRefreshSeconds: 60 });
    await openPopover();
    body('[data-test="dashboard-kiosk-theme-dark"]')!.click();
    await flushPromises();
    body('[data-test="dashboard-kiosk-copy-link"]')!.click();
    await flushPromises();

    expect(wrapper!.emitted("copy")?.[0]).toEqual([
      { refreshSeconds: 60, theme: "dark", fit: true },
    ]);
    expect(wrapper!.emitted("open")).toBeUndefined();
  });

  it("lets fit be switched off for a new link", async () => {
    mountPopover({ currentRefreshSeconds: 60 });
    await openPopover();
    body('[data-test="dashboard-kiosk-fit-btn"]')!.click();
    await flushPromises();
    body('[data-test="dashboard-kiosk-open"]')!.click();
    await flushPromises();

    expect(wrapper!.emitted("open")?.[0]?.[0]).toMatchObject({ fit: false });
  });

  it("raises a refresh below the server minimum", async () => {
    mountPopover({ currentRefreshSeconds: 5, minRefreshSeconds: 30 });
    await openPopover();
    body('[data-test="dashboard-kiosk-open"]')!.click();
    await flushPromises();

    expect(wrapper!.emitted("open")?.[0]?.[0]).toMatchObject({ refreshSeconds: 30 });
  });
});
