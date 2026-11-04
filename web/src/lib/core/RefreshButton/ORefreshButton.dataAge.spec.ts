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
import { nextTick } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import store from "@/stores";
import { LOADER_DELAY_MS } from "@/lib/styles/motion";
import ORefreshButton from "./ORefreshButton.vue";

const stubs = {
  OTooltip: { props: ["content"], template: '<span data-test="tooltip">{{ content }}</span>' },
};
const now = Date.UTC(2026, 10, 1, 5, 12, 7);
const failedAt = Date.UTC(2026, 10, 1, 5, 17, 2);
const zone = "Asia/Calcutta";

const mountButton = (props: Record<string, unknown>) =>
  mount(ORefreshButton, { props, global: { stubs }, attachTo: document.body });

describe("ORefreshButton data age and failed refresh", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
  });
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("keeps today's relative age and name when the new props are absent", () => {
    const wrapper = mountButton({ lastRunAt: now - 12_000, layout: "inline" });
    const button = wrapper.find('[data-test="refresh-button"]');
    expect(button.text()).toContain("12s ago");
    expect(button.attributes("aria-label")).toBe("Refresh, last refreshed 12s ago");
    expect(button.attributes("data-state")).toBeUndefined();
    wrapper.unmount();
  });

  it("re-evaluates relative text as time passes", async () => {
    const wrapper = mountButton({ lastRunAt: now, layout: "inline" });
    expect(wrapper.text()).toContain("just now");
    vi.advanceTimersByTime(20_000);
    await nextTick();
    expect(wrapper.text()).toContain("20s ago");
    vi.advanceTimersByTime(60_000);
    await nextTick();
    expect(wrapper.text()).toContain("1m ago");
    wrapper.unmount();
  });

  it("shows Updated hh:mm in clock mode with the zone in its name and tooltip", () => {
    const wrapper = mountButton({
      lastRunAt: now,
      layout: "inline",
      ageFormat: "clock",
      timeZone: zone,
    });
    const button = wrapper.find('[data-test="refresh-button"]');
    expect(button.text()).toContain("Updated 10:42");
    expect(button.text()).not.toContain("Asia/Calcutta · ");
    expect(button.attributes("aria-label")).toBe("Refresh, updated 10:42 Asia/Calcutta");
    expect(wrapper.find('[data-test="tooltip"]').text()).toBe("Updated 10:42:07 · Asia/Calcutta");
  });

  it("names the app's selected timezone in its name and tooltip when no zone is passed", () => {
    const before = store.state.timezone;
    store.commit("setTimezone", "Asia/Calcutta");
    try {
      const wrapper = mountButton({ lastRunAt: now, layout: "inline", ageFormat: "clock" });
      expect(wrapper.find("button").attributes("aria-label")).toBe(
        "Refresh, updated 10:42 Asia/Calcutta",
      );
      expect(wrapper.find('[data-test="tooltip"]').text()).toBe("Updated 10:42:07 · Asia/Calcutta");
      wrapper.unmount();
    } finally {
      store.commit("setTimezone", before);
    }
  });

  it("does not drift a clock time as time passes", async () => {
    const wrapper = mountButton({ lastRunAt: now, ageFormat: "clock", timeZone: zone });
    vi.advanceTimersByTime(120_000);
    await nextTick();
    expect(wrapper.text()).toContain("Updated 10:42");
    wrapper.unmount();
  });

  it("turns the same inline button into the red sentence with Retry, keeping focus", async () => {
    const onClick = vi.fn();
    const wrapper = mountButton({
      lastRunAt: now,
      layout: "inline",
      ageFormat: "clock",
      timeZone: zone,
      dataTest: "traces-search-result-refresh",
      onClick,
    });
    const before = wrapper.find<HTMLButtonElement>("button").element;
    before.focus();
    await wrapper.setProps({ failedAt });
    const button = wrapper.find<HTMLButtonElement>("button");
    expect(button.element).toBe(before);
    expect(document.activeElement).toBe(before);
    expect(button.attributes("data-state")).toBe("failed");
    expect(button.attributes("aria-label")).toBe("Retry");
    const sentence = button.find('[data-test="traces-search-result-refresh-failed"]');
    expect(sentence.text()).toBe("Refresh failed at 10:47 · showing data from 10:42");
    expect(button.attributes("aria-describedby")).toBe(sentence.attributes("id"));
    expect(button.text()).toContain("Retry");
    expect(button.text()).not.toContain("Updated");
    await button.trigger("click");
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("uses dataFrom over lastRunAt for the data still shown", () => {
    const wrapper = mountButton({
      lastRunAt: failedAt,
      dataFrom: now,
      failedAt,
      layout: "inline",
      timeZone: zone,
    });
    expect(wrapper.text()).toContain("showing data from 10:42");
  });

  it("drops the fresh dot and the age in the split layout and names the button Retry", async () => {
    const wrapper = mountButton({ lastRunAt: now, timeZone: zone });
    expect(wrapper.find(".rounded-full").exists()).toBe(true);
    await wrapper.setProps({ failedAt });
    expect(wrapper.find(".rounded-full").exists()).toBe(false);
    expect(wrapper.find('[data-test="refresh-button-failed"]').text()).toContain(
      "Refresh failed at 10:47 · showing data from 10:42",
    );
    const button = wrapper.find("button");
    expect(button.attributes("aria-label")).toBe("Retry");
    const described = document.getElementById(button.attributes("aria-describedby")!);
    expect(described?.textContent?.trim()).toBe(
      "Refresh failed at 10:47 · showing data from 10:42",
    );
    expect(wrapper.text()).not.toContain("just now");
  });

  it("truncates the failed sentence and falls back to the short marker below sm, never to the icon alone", async () => {
    for (const layout of ["inline", "split"]) {
      const wrapper = mountButton({ lastRunAt: now, timeZone: zone, failedAt, layout });
      const button = wrapper.find("button");
      const sentence = document.getElementById(button.attributes("aria-describedby")!)!;
      expect(sentence.textContent?.trim()).toBe(
        "Refresh failed at 10:47 · showing data from 10:42",
      );
      expect(sentence.classList).toContain("min-w-0");
      expect(sentence.classList).toContain("max-sm:hidden");
      expect(sentence.classList).not.toContain("max-md:hidden");
      const short = wrapper.findAll("span.sm\\:hidden");
      expect(short).toHaveLength(1);
      expect(short[0].text()).toBe("Refresh failed");
      expect(short[0].attributes("aria-hidden")).toBe("true");
      wrapper.unmount();
    }
  });

  it("lets the inline failed button shrink from sm up so its sentence truncates, never below its short marker", () => {
    const wrapper = mountButton({ lastRunAt: now, timeZone: zone, failedAt, layout: "inline" });
    const classes = wrapper.find("button").classes();
    expect(classes).toContain("sm:min-w-0");
    expect(classes).not.toContain("min-w-0");
    expect(classes).toContain("max-w-full");
    expect(wrapper.find("button").text()).toContain("Retry");
    wrapper.unmount();
  });

  it("keeps the clock time without Updated in the narrow layout, full text in tooltip and name", () => {
    for (const layout of ["inline", "split"]) {
      const wrapper = mountButton({ lastRunAt: now, ageFormat: "clock", timeZone: zone, layout });
      const short = wrapper.find('[data-test="refresh-button-age-short"]');
      expect(short.text()).toBe("10:42");
      expect(short.classes()).toContain("md:hidden");
      expect(short.element.parentElement?.className).not.toContain("max-md:hidden");
      const long = short.element.previousElementSibling!;
      expect(long.textContent).toBe("Updated 10:42");
      expect(long.classList).toContain("max-md:hidden");
      expect(wrapper.find("button").attributes("aria-label")).toBe(
        "Refresh, updated 10:42 Asia/Calcutta",
      );
      expect(wrapper.findAll('[data-test="tooltip"]').map((tip) => tip.text())).toContain(
        "Updated 10:42:07 · Asia/Calcutta",
      );
      wrapper.unmount();
    }
  });

  it("keeps today's relative age hidden below md when no clock format is set", () => {
    for (const layout of ["inline", "split"]) {
      const wrapper = mountButton({ lastRunAt: now - 12_000, layout });
      expect(wrapper.find('[data-test="refresh-button-age-short"]').exists()).toBe(false);
      const age = wrapper.find("span.tabular-nums");
      expect(age.text()).toContain("12s ago");
      expect(age.classes()).toContain("max-md:hidden");
      wrapper.unmount();
    }
  });

  it("spins while loading by default, in both layouts", async () => {
    for (const layout of ["inline", "split"]) {
      const wrapper = mountButton({ lastRunAt: now, layout, loading: true });
      vi.advanceTimersByTime(LOADER_DELAY_MS);
      await nextTick();
      expect(wrapper.find(".animate-spin").exists()).toBe(true);
      expect(wrapper.find("button").attributes("aria-busy")).toBe("true");
      wrapper.unmount();
    }
  });

  it("with spinner off, is busy at once and keeps focus but never spins", async () => {
    for (const layout of ["inline", "split"]) {
      const onClick = vi.fn();
      const wrapper = mountButton({ lastRunAt: now, layout, spinner: false, onClick });
      const button = wrapper.find<HTMLButtonElement>("button");
      button.element.focus();
      await wrapper.setProps({ loading: true });
      expect(button.attributes("aria-busy")).toBe("true");
      expect(document.activeElement).toBe(button.element);
      vi.advanceTimersByTime(LOADER_DELAY_MS * 20);
      await nextTick();
      expect(wrapper.find(".animate-spin").exists()).toBe(false);
      expect(button.find("span.contents").classes()).not.toContain("text-transparent");
      await button.trigger("click");
      expect(onClick).not.toHaveBeenCalled();
      await wrapper.setProps({ loading: false });
      expect(button.attributes("aria-busy")).toBeUndefined();
      wrapper.unmount();
    }
  });

  it("shows the failed sentence after a refresh rejected with a 4xx, and returns to the age on success", async () => {
    const wrapper = mountButton({
      lastRunAt: now,
      layout: "inline",
      ageFormat: "clock",
      timeZone: zone,
    });
    const refresh = (status: number) =>
      (status >= 400 ? Promise.reject({ response: { status } }) : Promise.resolve()).then(
        () => wrapper.setProps({ failedAt: null, lastRunAt: failedAt }),
        () => wrapper.setProps({ failedAt }),
      );
    await refresh(400);
    await flushPromises();
    expect(wrapper.text()).toContain("Refresh failed at 10:47 · showing data from 10:42");
    await refresh(200);
    await flushPromises();
    expect(wrapper.text()).toContain("Updated 10:47");
    const button = wrapper.find("button");
    expect(button.attributes("data-state")).toBeUndefined();
    expect(button.attributes("aria-describedby")).toBeUndefined();
    expect(button.attributes("aria-label")).toBe("Refresh, updated 10:47 Asia/Calcutta");
  });
});

describe("ORefreshButton split-layout tooltips at each width (real OTooltip)", () => {
  // jsdom has no media queries or Tailwind, so each width's rules are applied as a plain stylesheet.
  const hiddenAt = {
    desktop: ".md\\:hidden { display: none; }",
    narrow: ".max-md\\:hidden, .max-sm\\:hidden { display: none; }",
  } as const;
  let sheet: HTMLStyleElement;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
  });
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
    sheet?.remove();
  });

  const useWidth = (width: keyof typeof hiddenAt) => {
    sheet = document.createElement("style");
    sheet.textContent = `.contents { display: contents; } ${hiddenAt[width]}`;
    document.head.appendChild(sheet);
  };
  const shown = (el: Element) => getComputedStyle(el).display !== "none";
  const bubble = () =>
    document.body.querySelector('[data-test="o-tooltip-content"]')?.textContent ?? null;
  async function hover(el: Element) {
    el.dispatchEvent(new MouseEvent("mouseenter"));
    vi.advanceTimersByTime(1000);
    await nextTick();
    await nextTick();
  }

  it.each(["desktop", "narrow"] as const)(
    "opens the clock age's zone from the label shown at %s width",
    async (width) => {
      useWidth(width);
      const wrapper = mount(ORefreshButton, {
        props: { lastRunAt: now, ageFormat: "clock", timeZone: zone },
        attachTo: document.body,
      });
      const short = wrapper.find('[data-test="refresh-button-age-short"]').element;
      const long = short.previousElementSibling!;
      const visible = width === "desktop" ? long : short;
      expect(shown(visible)).toBe(true);
      expect(visible.textContent).toBe(width === "desktop" ? "Updated 10:42" : "10:42");
      const trigger = visible.closest("[data-o-tooltip-trigger]");
      expect(trigger).not.toBeNull();
      expect(shown(trigger!)).toBe(true);
      expect(trigger!.contains(long) && trigger!.contains(short)).toBe(true);
      expect(trigger!.tagName).not.toBe("BUTTON");
      await hover(trigger!);
      expect(bubble()).toContain("Updated 10:42:07 · Asia/Calcutta");
      wrapper.unmount();
    },
  );

  it.each(["desktop", "narrow"] as const)(
    "binds the inline clock and failed tooltips to the button at %s width",
    async (width) => {
      useWidth(width);
      for (const extra of [{}, { failedAt }]) {
        const wrapper = mount(ORefreshButton, {
          props: { lastRunAt: now, ageFormat: "clock", timeZone: zone, layout: "inline", ...extra },
          attachTo: document.body,
        });
        const button = wrapper.find("button").element;
        expect(button.hasAttribute("data-o-tooltip-trigger")).toBe(true);
        await hover(button);
        expect(bubble()).toContain(
          "failedAt" in extra
            ? "Refresh failed at 10:47 · showing data from 10:42"
            : "Updated 10:42:07 · Asia/Calcutta",
        );
        wrapper.unmount();
        document.body.innerHTML = "";
      }
    },
  );

  it("keeps today's relative age tooltip on the age label", async () => {
    useWidth("desktop");
    const wrapper = mount(ORefreshButton, {
      props: { lastRunAt: now - 12_000 },
      attachTo: document.body,
    });
    const label = wrapper.find("span.tabular-nums").element;
    expect(label.hasAttribute("data-o-tooltip-trigger")).toBe(true);
    await hover(label);
    expect(bubble()).toContain("Last refreshed");
    wrapper.unmount();
  });

  it.each(["desktop", "narrow"] as const)(
    "opens the full failed sentence from the text shown at %s width",
    async (width) => {
      useWidth(width);
      const wrapper = mount(ORefreshButton, {
        props: { lastRunAt: now, failedAt, timeZone: zone },
        attachTo: document.body,
      });
      const failed = wrapper.find('[data-test="refresh-button-failed"]').element;
      const visibleText = Array.from(failed.querySelectorAll("span"))
        .filter((el) => shown(el) && !el.closest('[style*="display: none"]'))
        .map((el) => el.textContent?.trim());
      expect(visibleText).toContain(
        width === "desktop"
          ? "Refresh failed at 10:47 · showing data from 10:42"
          : "Refresh failed",
      );
      expect(failed.hasAttribute("data-o-tooltip-trigger")).toBe(true);
      expect(shown(failed)).toBe(true);
      await hover(failed);
      expect(bubble()).toContain("Refresh failed at 10:47 · showing data from 10:42");
      wrapper.unmount();
    },
  );
});
