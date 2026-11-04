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
import { mount } from "@vue/test-utils";
import { KeepAlive, computed, defineComponent, h, nextTick, ref, watch, type Ref } from "vue";
import { useTypewriterPlaceholder } from "./useTypewriterPlaceholder";

const SPEED = { typeSpeedMs: 10, eraseSpeedMs: 5, holdMs: 20, initialDelayMs: 0 };

let observed: IntersectionObserverCallback[] = [];

const probe = (prompts: string[], seen: string[], enabled?: Ref<boolean>) =>
  defineComponent({
    name: "TypewriterProbe",
    setup() {
      const { placeholder } = useTypewriterPlaceholder(prompts, { ...SPEED, enabled });
      watch(placeholder, (text) => seen.push(text), { flush: "sync" });
      return () => h("div", placeholder.value);
    },
  });

const setReducedMotion = (reduce: boolean) =>
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({ matches: reduce && query.includes("reduce"), media: query })),
  );

const scrollOut = (onScreen: boolean) =>
  observed.forEach((cb) =>
    cb([{ isIntersecting: onScreen } as IntersectionObserverEntry], {} as IntersectionObserver),
  );

describe("useTypewriterPlaceholder", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    observed = [];
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(cb: IntersectionObserverCallback) {
          observed.push(cb);
        }
        observe() {}
        disconnect() {}
      },
    );
    setReducedMotion(false);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("types each prompt once, then rests on the last one with nothing left running", async () => {
    const seen: string[] = [];
    const wrapper = mount(probe(["ab", "cd"], seen));
    await vi.runAllTimersAsync();

    expect(seen).toEqual(["a", "ab", "a", "", "c", "cd"]);
    expect(wrapper.text()).toBe("cd");
    expect(vi.getTimerCount()).toBe(0);
    wrapper.unmount();
  });

  it("shows the resting prompt from the start, with no typing, under reduced motion", async () => {
    setReducedMotion(true);
    const seen: string[] = [];
    const wrapper = mount(probe(["ab", "cd"], seen));
    await nextTick();

    expect(wrapper.text()).toBe("cd");
    expect(seen).toEqual(["cd"]);
    expect(vi.getTimerCount()).toBe(0);
    wrapper.unmount();
  });

  it("pauses while its page is deactivated in the keep-alive cache and resumes on return", async () => {
    const seen: string[] = [];
    const shown = ref(true);
    const Probe = probe(["abcd"], seen);
    const host = mount(
      defineComponent({
        setup: () => () => h(KeepAlive, null, [shown.value ? h(Probe) : h("span")]),
      }),
    );
    await vi.advanceTimersByTimeAsync(SPEED.typeSpeedMs - 1);
    expect(seen.at(-1)).toBe("a");

    shown.value = false;
    await nextTick();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(seen.at(-1)).toBe("a");

    shown.value = true;
    await nextTick();
    await vi.runAllTimersAsync();
    expect(seen.at(-1)).toBe("abcd");
    host.unmount();
  });

  it("pauses while the editor is scrolled offscreen", async () => {
    const seen: string[] = [];
    const wrapper = mount(probe(["abcd"], seen));
    await vi.advanceTimersByTimeAsync(SPEED.typeSpeedMs - 1);
    expect(seen.at(-1)).toBe("a");

    scrollOut(false);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(seen.at(-1)).toBe("a");

    scrollOut(true);
    await vi.runAllTimersAsync();
    expect(seen.at(-1)).toBe("abcd");
    wrapper.unmount();
  });

  it("reads its prompts only after the caller's setup has finished", async () => {
    const LateState = defineComponent({
      setup() {
        const prompts = computed(() => [later.value]);
        const enabled = computed(() => later.value !== "");
        const { placeholder } = useTypewriterPlaceholder(prompts, { ...SPEED, enabled });
        const later = ref("ab");
        return () => h("div", { onClick: () => (later.value = "cd") }, placeholder.value);
      },
    });
    const wrapper = mount(LateState);
    await vi.runAllTimersAsync();
    expect(wrapper.text()).toBe("ab");

    await wrapper.trigger("click");
    await vi.runAllTimersAsync();
    expect(wrapper.text()).toBe("cd");
    wrapper.unmount();
  });

  it("stays empty while disabled", async () => {
    const seen: string[] = [];
    const enabled = ref(false);
    const wrapper = mount(probe(["ab"], seen, enabled));
    await vi.advanceTimersByTimeAsync(1000);
    expect(wrapper.text()).toBe("");

    enabled.value = true;
    await nextTick();
    await vi.runAllTimersAsync();
    expect(wrapper.text()).toBe("ab");
    wrapper.unmount();
  });
});
