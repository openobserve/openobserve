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

  /**
   * The data-test is the ONE thing that differed per page, so it must pass
   * through — and it must stay on the BUTTON, not on the wrapper the staleness
   * dot introduced. Nine pages and their e2e suites address the control by this
   * attribute; moving it up to the wrapper would keep every selector matching
   * while making it resolve to something that is no longer clickable.
   */
  it("carries the page's data-test on the button itself", () => {
    const button = mountButton().findComponent(OButton);

    expect(button.attributes("data-test")).toBe("dbm-samples-refresh");
  });

  it("spins while the page's fetch is in flight", () => {
    expect(mountButton({ loading: true }).findComponent(OButton).props("loading")).toBe(true);
    expect(mountButton().findComponent(OButton).props("loading")).toBe(false);
  });

  /**
   * `shrink-0` pins the width inside the flex toolbar row. Table health puts a
   * bare full-width input in the slot instead of that row and never carried the
   * class; opting out has to keep it off, or that page's toolbar shifts.
   *
   * Asserted on BOTH the wrapper and the button. The staleness dot made this
   * control a flex row rather than a lone button, so the wrapper is what the
   * toolbar lays out now — but the button inside it must stay pinned too, or
   * the dot can win the space and squash the control it annotates.
   */
  it("pins its width in a flex toolbar, and lets table health opt out", () => {
    const pinned = mountButton();
    expect(pinned.classes()).toContain("shrink-0");
    expect(pinned.findComponent(OButton).classes()).toContain("shrink-0");

    const loose = mountButton({ shrink: false });
    expect(loose.classes()).not.toContain("shrink-0");
    expect(loose.findComponent(OButton).classes()).not.toContain("shrink-0");
  });

  it("emits refresh on click so the page can force its reload", async () => {
    const wrapper = mountButton();
    // The button, not the wrapper: the staleness dot is a sibling inside the
    // same flex row, and a click on the row must not count as a refresh.
    await wrapper.findComponent(OButton).trigger("click");

    expect(wrapper.emitted("refresh")).toHaveLength(1);
  });

  /**
   * The tooltip names the action; without it the glyph is the only affordance.
   * Its reka tree mounts lazily on first hover, so the prop is what to read.
   */
  it("explains itself with the shared reload tooltip", () => {
    // The BUTTON's tooltip. With a staleness dot in the row there are two
    // tooltips, and `findComponent` returns the first in tree order — so the
    // one under test is addressed explicitly rather than by position.
    const tooltips = mountButton().findAllComponents(OTooltip);

    expect(tooltips).toHaveLength(1);
    expect(tooltips[0].props("content")).toBe("Refresh");
  });
});

/**
 * "How stale is this?" — the affordance ORefreshButton already provides, and
 * the reason it is here rather than adopted wholesale is argued in the SFC.
 *
 * What matters behaviourally is that the control says nothing until it has
 * something true to say: before the first successful load there is no
 * staleness to report, and a grey dot beside a "not yet refreshed" label would
 * read as a verdict on data that has not arrived.
 */
describe("DbmRefreshButton last-refreshed", () => {
  it("shows no staleness dot until a load has actually succeeded", () => {
    expect(mountButton().find('[data-test="dbm-samples-refresh-dot"]').exists()).toBe(false);
    expect(mountButton({ lastRunAt: null }).find("[data-test$='-dot']").exists()).toBe(false);
  });

  it("shows the dot once there is a timestamp to report", () => {
    const wrapper = mountButton({ lastRunAt: Date.now() });

    expect(wrapper.find('[data-test="dbm-samples-refresh-dot"]').exists()).toBe(true);
  });

  /**
   * The bands are ORefreshButton's own — green under 30s, amber under 5min,
   * red beyond — so the same data cannot read as fresh on one screen and stale
   * on another. Shared through `useDbmLastRefreshed` rather than re-derived.
   */
  it.each([
    [1_000, "bg-refresh-dot-fresh"],
    [60_000, "bg-refresh-dot-stale"],
    [600_000, "bg-refresh-dot-critical"],
  ])("colours the dot by age (%ims ago)", (ageMs, expected) => {
    const wrapper = mountButton({ lastRunAt: Date.now() - ageMs });

    expect(wrapper.find('[data-test="dbm-samples-refresh-dot"]').classes()).toContain(expected);
  });

  /**
   * A fetch in flight is not a staleness state: the answer is being replaced,
   * so painting it red would flag as stale exactly the data that is mid-refresh.
   */
  it("withholds the staleness verdict while a fetch is in flight", () => {
    const wrapper = mountButton({ lastRunAt: Date.now() - 600_000, loading: true });

    const dot = wrapper.find('[data-test="dbm-samples-refresh-dot"]');
    expect(dot.classes()).toContain("bg-refresh-dot-idle");
    expect(dot.classes()).not.toContain("bg-refresh-dot-critical");
  });

  /** The age rides the button's own tooltip rather than costing toolbar width. */
  it("names the action alone before a load, and adds the age after one", () => {
    expect(mountButton().findAllComponents(OTooltip)[0].props("content")).toBe("Refresh");

    const loaded = mountButton({ lastRunAt: Date.now() });
    // Two tooltips now — the dot's and the button's. The button's is last in
    // tree order, since the dot is rendered before it.
    const tooltips = loaded.findAllComponents(OTooltip);
    expect(tooltips).toHaveLength(2);
    expect(String(tooltips[1].props("content"))).toContain("Refresh");
    expect(String(tooltips[1].props("content"))).toContain("Last refreshed");
  });

  /** The dot alone encodes nothing to a reader who has not learned the colours. */
  it("explains the dot in words, with the exact time", () => {
    const wrapper = mountButton({ lastRunAt: Date.now() });
    const dotTooltip = wrapper.findAllComponents(OTooltip)[0];

    expect(String(dotTooltip.props("content"))).toContain("Data is fresh");
    expect(String(dotTooltip.props("content"))).toContain("Last refreshed:");
  });
});
