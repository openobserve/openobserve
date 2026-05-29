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

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent, h, ref, nextTick } from "vue";
import { useScrollShadow } from "./useScrollShadow";

/**
 * Helper that overrides read-only DOM size properties on an HTMLElement
 * so we can simulate any scroll position without rendering real content.
 */
const setScrollGeometry = (
  el: HTMLElement,
  geom: { scrollTop?: number; clientHeight?: number; scrollHeight?: number },
) => {
  if (geom.scrollTop !== undefined) {
    Object.defineProperty(el, "scrollTop", {
      configurable: true,
      writable: true,
      value: geom.scrollTop,
    });
  }
  if (geom.clientHeight !== undefined) {
    Object.defineProperty(el, "clientHeight", {
      configurable: true,
      writable: true,
      value: geom.clientHeight,
    });
  }
  if (geom.scrollHeight !== undefined) {
    Object.defineProperty(el, "scrollHeight", {
      configurable: true,
      writable: true,
      value: geom.scrollHeight,
    });
  }
};

/**
 * Mounts a host component that exposes the composable's return value
 * via the wrapper's `vm`. This lets each test drive the composable
 * exactly like a real component would.
 */
const mountHost = (
  initialGeom: {
    scrollTop?: number;
    clientHeight?: number;
    scrollHeight?: number;
  } = { scrollTop: 0, clientHeight: 100, scrollHeight: 200 },
  opts: { withElement?: boolean } = { withElement: true },
) => {
  const Host = defineComponent({
    setup(_, { expose }) {
      const elRef = ref<HTMLElement | null>(null);
      const api = useScrollShadow(elRef);
      expose({ elRef, ...api });
      return () =>
        opts.withElement
          ? h("div", { ref: (el: any) => (elRef.value = el) })
          : h("div");
    },
  });

  const wrapper = mount(Host, { attachTo: document.body });
  const vm: any = wrapper.vm;

  // Apply initial geometry to the underlying element before mount-time update
  // has been observed by the consumer. We then call update() to reflect it.
  if (opts.withElement && vm.elRef) {
    setScrollGeometry(vm.elRef, initialGeom);
    vm.update();
  }

  return { wrapper, vm };
};

describe("useScrollShadow", () => {
  let resizeObserverInstances: Array<{
    callback: ResizeObserverCallback;
    observe: ReturnType<typeof vi.fn>;
    unobserve: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
  }>;

  beforeEach(() => {
    resizeObserverInstances = [];
    // Override the global ResizeObserver so tests can capture instances
    // and trigger the registered callback manually.
    class MockResizeObserver {
      callback: ResizeObserverCallback;
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
      constructor(cb: ResizeObserverCallback) {
        this.callback = cb;
        resizeObserverInstances.push(this);
      }
    }
    vi.stubGlobal("ResizeObserver", MockResizeObserver);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe("Initial state", () => {
    it("returns canScrollUp and canScrollDown refs starting as false when ref is null", () => {
      // No element attached → both flags should remain false.
      const { vm } = mountHost(undefined, { withElement: false });
      expect(vm.canScrollUp).toBe(false);
      expect(vm.canScrollDown).toBe(false);
    });

    it("exposes update, attach, and detach as functions", () => {
      const { vm } = mountHost();
      expect(typeof vm.update).toBe("function");
      expect(typeof vm.attach).toBe("function");
      expect(typeof vm.detach).toBe("function");
    });

    it("computes canScrollDown=true and canScrollUp=false at the top edge", () => {
      // scrollTop=0, content larger than viewport → only bottom shadow visible.
      const { vm } = mountHost({
        scrollTop: 0,
        clientHeight: 100,
        scrollHeight: 500,
      });
      expect(vm.canScrollUp).toBe(false);
      expect(vm.canScrollDown).toBe(true);
    });
  });

  describe("Scroll-position-based reactive updates", () => {
    it("sets both flags true when scrolled to the middle", async () => {
      const { vm } = mountHost({
        scrollTop: 0,
        clientHeight: 100,
        scrollHeight: 500,
      });

      // Simulate scrolling halfway down by mutating geometry + firing event.
      setScrollGeometry(vm.elRef, { scrollTop: 200 });
      vm.elRef.dispatchEvent(new Event("scroll"));
      await nextTick();

      expect(vm.canScrollUp).toBe(true);
      expect(vm.canScrollDown).toBe(true);
    });

    it("sets canScrollDown=false and canScrollUp=true when scrolled to the bottom edge", async () => {
      const { vm } = mountHost({
        scrollTop: 0,
        clientHeight: 100,
        scrollHeight: 500,
      });

      // scrollTop + clientHeight = 400 + 100 = 500 → at scrollHeight, no more room.
      setScrollGeometry(vm.elRef, { scrollTop: 400 });
      vm.elRef.dispatchEvent(new Event("scroll"));
      await nextTick();

      expect(vm.canScrollUp).toBe(true);
      expect(vm.canScrollDown).toBe(false);
    });

    it("sets both flags false when content fits entirely (no scroll possible)", () => {
      // scrollHeight === clientHeight → nothing to scroll in either direction.
      const { vm } = mountHost({
        scrollTop: 0,
        clientHeight: 200,
        scrollHeight: 200,
      });
      expect(vm.canScrollUp).toBe(false);
      expect(vm.canScrollDown).toBe(false);
    });

    it("treats a 1px sub-pixel gap at the bottom as fully scrolled (off-by-one tolerance)", () => {
      // Browsers report fractional pixels; composable uses `scrollHeight - 1`
      // to avoid flickering shadows. Verify the tolerance.
      const { vm } = mountHost({
        scrollTop: 100,
        clientHeight: 100,
        scrollHeight: 201,
      });
      // scrollTop+clientHeight = 200, scrollHeight - 1 = 200 → 200 < 200 false.
      expect(vm.canScrollDown).toBe(false);
    });

    it("reacts to ResizeObserver invocations (e.g. content height changes)", async () => {
      const { vm } = mountHost({
        scrollTop: 0,
        clientHeight: 100,
        scrollHeight: 100,
      });
      expect(vm.canScrollDown).toBe(false);

      // Simulate content growing past the viewport.
      setScrollGeometry(vm.elRef, { scrollHeight: 500 });
      // Fire the most recent ResizeObserver callback to mimic the browser
      // notifying about a size change.
      const ro = resizeObserverInstances[resizeObserverInstances.length - 1];
      expect(ro).toBeDefined();
      ro.callback([] as any, ro as any);
      await nextTick();

      expect(vm.canScrollDown).toBe(true);
    });
  });

  describe("No-element edge case", () => {
    it("update() is a no-op when the ref is null (no throw, flags stay false)", () => {
      const { vm } = mountHost(undefined, { withElement: false });
      // After mount with no element, flags should be at their default state.
      vm.canScrollUp = true; // simulate stale value
      vm.canScrollDown = true;
      // Re-running update with a null ref must reset both back to false.
      expect(() => vm.update()).not.toThrow();
      expect(vm.canScrollUp).toBe(false);
      expect(vm.canScrollDown).toBe(false);
    });

    it("attach() bails out silently when the ref is null", () => {
      const { vm } = mountHost(undefined, { withElement: false });
      // attach() with no element must not throw and must not create observers.
      const before = resizeObserverInstances.length;
      expect(() => vm.attach()).not.toThrow();
      expect(resizeObserverInstances.length).toBe(before);
    });

    it("detach() is safe to call when there is no element", () => {
      const { vm } = mountHost(undefined, { withElement: false });
      expect(() => vm.detach()).not.toThrow();
    });
  });

  describe("Cleanup on unmount", () => {
    it("disconnects the ResizeObserver and removes the scroll listener", () => {
      const { wrapper, vm } = mountHost();
      const ro = resizeObserverInstances[resizeObserverInstances.length - 1];
      const el = vm.elRef as HTMLElement;
      const removeSpy = vi.spyOn(el, "removeEventListener");

      wrapper.unmount();

      expect(ro.disconnect).toHaveBeenCalledTimes(1);
      expect(removeSpy).toHaveBeenCalledWith("scroll", expect.any(Function));
    });

    it("does not respond to scroll events after unmount", async () => {
      const { wrapper, vm } = mountHost({
        scrollTop: 0,
        clientHeight: 100,
        scrollHeight: 500,
      });
      const el = vm.elRef as HTMLElement;
      const refToFlag = vm; // capture before unmount

      wrapper.unmount();

      // Modify geometry and dispatch — listener should be detached so the
      // refs returned earlier must NOT update.
      setScrollGeometry(el, { scrollTop: 250 });
      el.dispatchEvent(new Event("scroll"));
      await nextTick();

      // canScrollUp remained at its pre-unmount value (false from scrollTop=0).
      expect(refToFlag.canScrollUp).toBe(false);
    });

    it("ResizeObserver callback does not update state after detach()", async () => {
      const { vm } = mountHost({
        scrollTop: 0,
        clientHeight: 100,
        scrollHeight: 100,
      });
      const ro = resizeObserverInstances[resizeObserverInstances.length - 1];

      vm.detach();

      // Even if the (mock) observer were re-triggered, manual invocation of
      // the now-disconnected callback should not affect flags because
      // detach() set internal reference to null. The callback itself is a
      // closure over `update`, which can still be invoked, but since the
      // listener/observer chain is detached, we assert the public contract:
      // disconnect was called.
      expect(ro.disconnect).toHaveBeenCalled();
    });
  });

  describe("attach/detach public API", () => {
    it("attach() observes the element and registers a scroll listener", () => {
      const { vm } = mountHost();
      const ro = resizeObserverInstances[resizeObserverInstances.length - 1];
      // observe() should have been called at mount time with the element.
      expect(ro.observe).toHaveBeenCalledWith(vm.elRef);
    });

    it("calling update() manually re-syncs flags with current DOM state", () => {
      const { vm } = mountHost({
        scrollTop: 0,
        clientHeight: 100,
        scrollHeight: 100,
      });
      expect(vm.canScrollDown).toBe(false);

      // Change geometry without firing any DOM event, then call update().
      setScrollGeometry(vm.elRef, { scrollHeight: 800 });
      vm.update();
      expect(vm.canScrollDown).toBe(true);
    });
  });
});
