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
import { mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h, nextTick, ref, type Ref } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { createStore } from "vuex";
import i18n from "@/locales";
import {
  isLockedFeatureDenial,
  isPageFeatureLocked,
  markLockedDenial,
  provideFeatureLock,
  useFeatureLock,
  useLockedDisabled,
  type FeatureLock,
} from "./useFeatureLock";
import FeatureLockBoundary from "@/components/common/FeatureLockBoundary.vue";
import FeatureLockBanner from "@/components/common/FeatureLockBanner.vue";
import OPageHeader from "@/lib/core/PageHeader/OPageHeader.vue";
import { toast, toastRecords, dismissAll } from "@/lib/feedback/Toast/useToast";
import {
  addLicenseDeniedError,
  useLicenseDeniedDialog,
} from "@/composables/useUnauthorizedErrorGrouper";

let wrapper: VueWrapper | undefined;

const mountWithLock = (feature: Ref<string | null> | null) => {
  let seen: FeatureLock | undefined;
  let disabled: Ref<boolean> | undefined;
  const Child = defineComponent({
    setup() {
      seen = useFeatureLock();
      disabled = useLockedDisabled(() => false);
      return () => null;
    },
  });
  const Parent = defineComponent({
    setup() {
      if (feature) provideFeatureLock(feature);
      return () => h(Child);
    },
  });
  wrapper = mount(Parent);
  return { lock: () => seen!, disabled: () => disabled!.value };
};

afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  dismissAll();
  useLicenseDeniedDialog().close();
});

describe("useFeatureLock", () => {
  it("is unlocked with no provider above", () => {
    const { lock, disabled } = mountWithLock(null);
    expect(lock().locked.value).toBe(false);
    expect(lock().feature.value).toBeNull();
    expect(disabled()).toBe(false);
    expect(isPageFeatureLocked()).toBe(false);
  });

  it("locks descendants while the provider names a feature, and follows it", async () => {
    const feature = ref<string | null>("workflows");
    const { lock, disabled } = mountWithLock(feature);
    expect(lock().locked.value).toBe(true);
    expect(lock().feature.value).toBe("workflows");
    expect(disabled()).toBe(true);
    expect(isPageFeatureLocked()).toBe(true);

    feature.value = null;
    await nextTick();
    expect(lock().locked.value).toBe(false);
    expect(disabled()).toBe(false);
    expect(isPageFeatureLocked()).toBe(false);
  });

  it("releases the page lock when the provider unmounts", () => {
    mountWithLock(ref("oncall"));
    expect(isPageFeatureLocked()).toBe(true);
    wrapper!.unmount();
    wrapper = undefined;
    expect(isPageFeatureLocked()).toBe(false);
  });

  it("matches a denial only when every missing key is the locked feature", () => {
    const feature = ref<string | null>("workflows");
    mountWithLock(feature);
    expect(isLockedFeatureDenial(["workflows"])).toBe(true);
    expect(isLockedFeatureDenial(["workflows", "oncall"])).toBe(false);
    expect(isLockedFeatureDenial([])).toBe(false);
    addLicenseDeniedError(["workflows"]);
    expect(useLicenseDeniedDialog().features.value).toBeNull();

    feature.value = null;
    expect(isLockedFeatureDenial(["workflows"])).toBe(false);
    addLicenseDeniedError(["workflows"]);
    expect(useLicenseDeniedDialog().features.value).toEqual(["workflows"]);
  });

  it("drops only error toasts that repeat a tagged denial's message", () => {
    mountWithLock(ref("workflows"));
    const error: any = { response: { data: { message: "Workflows is not licensed" } } };
    markLockedDenial(error);
    expect(error.licenseLocked).toBe(true);
    toast({ variant: "error", message: "Workflows is not licensed" as never });
    toast({ variant: "error", message: "Something else failed" as never });
    expect(toastRecords.map((r) => r.message)).toEqual(["Something else failed"]);
  });
});

describe("FeatureLockBanner", () => {
  const mountBanner = async (withLicensePage: boolean, feature = "workflows") => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: "/", component: { template: "<div />" } },
        ...(withLicensePage
          ? [{ path: "/license", name: "license", component: { template: "<div />" } }]
          : []),
      ],
    });
    await router.push("/");
    const store = createStore({ state: () => ({ selectedOrganization: { identifier: "acme" } }) });
    wrapper = mount(FeatureLockBanner, {
      props: { feature },
      global: { plugins: [i18n, router, store] },
    });
    return router;
  };

  it("names the missing feature by its label, not its key", async () => {
    await mountBanner(true);
    expect(wrapper!.text()).toContain("This feature is locked. It needs the Workflows feature");
    expect(wrapper!.get('[data-test="feature-lock-banner-feature"]').element.tagName).toBe(
      "STRONG",
    );
    wrapper!.unmount();
    await mountBanner(true, "ai_assistant");
    expect(wrapper!.get('[data-test="feature-lock-banner-feature"]').text()).toBe("AI Assistant");
  });

  it("says a generic sentence for a key it has no label for, naming nothing", async () => {
    await mountBanner(true, "some_new_feature");
    expect(wrapper!.get('[data-test="feature-lock-banner-generic"]').text()).toBe(
      "This page needs a feature that is not in your license.",
    );
    expect(wrapper!.find('[data-test="feature-lock-banner-feature"]').exists()).toBe(false);
    expect(wrapper!.text()).not.toContain("This feature feature");
  });

  it("offers only Contact sales, even where a license page exists", async () => {
    await mountBanner(true);
    expect(wrapper!.find('[data-test="feature-lock-banner-view-license"]').exists()).toBe(false);
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    await wrapper!.get('[data-test="feature-lock-banner-contact-sales"]').trigger("click");
    expect(open).toHaveBeenCalledWith(expect.any(String), "_blank", "noopener");
    open.mockRestore();
  });
});

describe("OPageHeader on a locked page", () => {
  it("puts a labelled lock right after the title text", async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: "/", component: { template: "<div />" } }],
    });
    await router.push("/");
    const Locked = defineComponent({
      setup() {
        provideFeatureLock(ref("downtimes"));
        return () => h(OPageHeader, { title: "Downtimes", subtitle: "Muted alerts" } as never);
      },
    });
    wrapper = mount(Locked, { global: { plugins: [i18n, router] } });
    const lock = wrapper.get('[data-test="app-page-header-locked"]');
    expect(lock.attributes("aria-label")).toBe("Locked: needs downtimes");
    expect(lock.element.previousElementSibling?.tagName).toBe("H1");
  });
});

describe("FeatureLockBoundary", () => {
  const mountBoundary = (feature: string | null, onClick: () => void) => {
    wrapper = mount(FeatureLockBoundary, {
      props: { feature },
      slots: { default: () => h("button", { "data-test": "raw", onClick }, "Go") },
    });
    return wrapper;
  };

  it("swallows clicks on controls that are not O2 primitives while locked", async () => {
    let clicks = 0;
    const boundary = mountBoundary("workflows", () => clicks++);
    expect(boundary.classes()).toContain("feature-locked-content");
    await boundary.get('[data-test="raw"]').trigger("click");
    expect(clicks).toBe(0);
  });

  it("blocks drops but lets pointerdown, right-click and read-only keys through", () => {
    const boundary = mountBoundary("workflows", () => {});
    const raw = boundary.get('[data-test="raw"]').element;
    const fire = (event: Event) => {
      raw.dispatchEvent(event);
      return event.defaultPrevented;
    };
    const key = (init: KeyboardEventInit, target: Element = raw) => {
      const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
      target.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(fire(new Event("drop", { bubbles: true, cancelable: true }))).toBe(true);
    expect(fire(new Event("dragover", { bubbles: true, cancelable: true }))).toBe(true);
    expect(fire(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }))).toBe(false);
    let reached = false;
    raw.addEventListener("pointerdown", () => (reached = true));
    raw.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(reached).toBe(true);
    expect(key({ key: "Enter" })).toBe(true);
    expect(key({ key: "c", ctrlKey: true })).toBe(false);
    expect(key({ key: "s", metaKey: true })).toBe(true);
    expect(key({ key: " " }, boundary.element)).toBe(false);
    expect(key({ key: " " })).toBe(true);
  });

  it("is a plain wrapper when nothing is locked", async () => {
    let clicks = 0;
    const boundary = mountBoundary(null, () => clicks++);
    expect(boundary.classes()).not.toContain("feature-locked-content");
    await boundary.get('[data-test="raw"]').trigger("click");
    expect(clicks).toBe(1);
  });
});
