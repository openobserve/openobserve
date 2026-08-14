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

import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import OButton from "@/lib/core/Button/OButton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import i18n from "@/locales";

import DbmRefreshButton from "./DbmRefreshButton.vue";

const mountButton = (props: Record<string, unknown> = {}) =>
  mount(DbmRefreshButton, {
    props: { dataTest: "dbm-samples-refresh", ...props },
    global: { plugins: [i18n] },
  });

describe("DbmRefreshButton", () => {
  /**
   * Nine tables carried this button verbatim. What made them one button was the
   * exact OButton shape — an outline icon-sm with the refresh glyph — so that is
   * what a page adopting the component keeps getting.
   */
  it("is the outline icon-sm refresh button the tables shared", () => {
    const button = mountButton().findComponent(OButton);

    expect(button.props("variant")).toBe("outline");
    expect(button.props("size")).toBe("icon-sm");
    expect(button.props("iconLeft")).toBe("refresh");
  });

  /** The data-test is the ONE thing that differed per page, so it must pass through. */
  it("carries the page's data-test", () => {
    expect(mountButton().attributes("data-test")).toBe("dbm-samples-refresh");
  });

  it("spins while the page's fetch is in flight", () => {
    expect(mountButton({ loading: true }).findComponent(OButton).props("loading")).toBe(true);
    expect(mountButton().findComponent(OButton).props("loading")).toBe(false);
  });

  /**
   * `shrink-0` pins the width inside the flex toolbar row. Table health puts a
   * bare full-width input in the slot instead of that row and never carried the
   * class; opting out has to keep it off, or that page's toolbar shifts.
   */
  it("pins its width in a flex toolbar, and lets table health opt out", () => {
    expect(mountButton().classes()).toContain("shrink-0");
    expect(mountButton({ shrink: false }).classes()).not.toContain("shrink-0");
  });

  it("emits refresh on click so the page can force its reload", async () => {
    const wrapper = mountButton();
    await wrapper.trigger("click");

    expect(wrapper.emitted("refresh")).toHaveLength(1);
  });

  /**
   * The tooltip names the action; without it the glyph is the only affordance.
   * Its reka tree mounts lazily on first hover, so the prop is what to read.
   */
  it("explains itself with the shared reload tooltip", () => {
    expect(mountButton().findComponent(OTooltip).props("content")).toBe("Refresh");
  });
});
