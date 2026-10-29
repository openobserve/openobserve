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
  isPageLocked,
  markLicenseDenial,
  provideFeatureLock,
  useFeatureLock,
  useLicenseLock,
  useLicenseLocks,
  useLockedDisabled,
  type FeatureLock,
} from "./useFeatureLock";
import FeatureLockBoundary from "@/components/common/FeatureLockBoundary.vue";
import FeatureLockExempt from "@/components/common/FeatureLockExempt.vue";
import FeatureLockBanner from "@/components/common/FeatureLockBanner.vue";
import OPageHeader from "@/lib/core/PageHeader/OPageHeader.vue";
import { toast, toastRecords, dismissAll } from "@/lib/feedback/Toast/useToast";
import {
  addLicenseDeniedError,
  useLicenseDenials,
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
  useLicenseDenials().dismiss();
});

describe("useFeatureLock", () => {
  it("is unlocked with no provider above", () => {
    const { lock, disabled } = mountWithLock(null);
    expect(lock().locked.value).toBe(false);
    expect(lock().feature.value).toBeNull();
    expect(disabled()).toBe(false);
    expect(isPageLocked()).toBe(false);
  });

  it("locks descendants while the provider names a feature, and follows it", async () => {
    const feature = ref<string | null>("workflows");
    const { lock, disabled } = mountWithLock(feature);
    expect(lock().locked.value).toBe(true);
    expect(lock().feature.value).toBe("workflows");
    expect(disabled()).toBe(true);
    expect(isPageLocked()).toBe(true);

    feature.value = null;
    await nextTick();
    expect(lock().locked.value).toBe(false);
    expect(disabled()).toBe(false);
    expect(isPageLocked()).toBe(false);
  });

  it("releases the page lock when the provider unmounts", () => {
    mountWithLock(ref("oncall"));
    expect(isPageLocked()).toBe(true);
    wrapper!.unmount();
    wrapper = undefined;
    expect(isPageLocked()).toBe(false);
  });

  it("ignores every denial while the page is locked, and records them once it is free", () => {
    const feature = ref<string | null>("workflows");
    mountWithLock(feature);
    addLicenseDeniedError(["workflows"]);
    addLicenseDeniedError(["alerts"]);
    addLicenseDeniedError([]);
    expect(useLicenseDenials().features.value).toBeNull();

    feature.value = null;
    addLicenseDeniedError(["workflows"]);
    expect(useLicenseDenials().features.value).toEqual(["workflows"]);
  });

  it("drops error toasts just after a denial, then only those repeating its message", () => {
    // Fake time far in the past, so the marked denial cannot reach later tests run on real time.
    vi.useFakeTimers({ now: 0 });
    markLicenseDenial({ response: { data: { message: "Workflows is not licensed" } } });
    toast({ variant: "error", message: "Request failed with status code 403" as never });
    toast({ variant: "success", message: "Saved" as never });
    toast({ variant: "info", message: "Heads up" as never });
    expect(toastRecords.map((r) => r.message)).toEqual(["Saved", "Heads up"]);

    vi.advanceTimersByTime(2000);
    toast({ variant: "error", message: "Workflows is not licensed" as never });
    toast({ variant: "error", message: "Something else failed" as never });
    expect(toastRecords.map((r) => r.message)).toEqual([
      "Saved",
      "Heads up",
      "Something else failed",
    ]);
    vi.useRealTimers();
  });

  it("shows an error toast on a locked page when no denial preceded it", () => {
    mountWithLock(ref("workflows"));
    toast({ variant: "error", message: "A new version is available, refresh" as never });
    expect(toastRecords.map((r) => r.message)).toEqual(["A new version is available, refresh"]);
  });
});

describe("FeatureLockBanner", () => {
  const mountBanner = async (withLicensePage: boolean, feature: string | null = "workflows") => {
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
    const store = createStore({
      state: () => ({
        selectedOrganization: { identifier: "acme" },
        zoConfig: { feature_names: { workflows: "Workflows", ai_assistant: "AI Assistant" } },
      }),
    });
    wrapper = mount(FeatureLockBanner, {
      props: { feature },
      global: { plugins: [i18n, router, store] },
    });
    return router;
  };

  it("names the missing feature by its display name, not its key", async () => {
    await mountBanner(true);
    expect(wrapper!.text()).toContain("This feature is locked. It needs the Workflows feature");
    expect(wrapper!.get('[data-test="feature-lock-banner-feature"]').element.tagName).toBe(
      "STRONG",
    );
    wrapper!.unmount();
    await mountBanner(true, "ai_assistant");
    expect(wrapper!.get('[data-test="feature-lock-banner-feature"]').text()).toBe("AI Assistant");
  });

  it("says a generic sentence for a key with no display name, naming nothing", async () => {
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

  it("renders nothing with no page lock and no denial", async () => {
    await mountBanner(true, null);
    expect(wrapper!.find('[data-test="feature-lock-banner"]').exists()).toBe(false);
  });

  it("names on-the-fly denials by display name, dismissibly, when no page is locked", async () => {
    await mountBanner(true, null);
    addLicenseDeniedError(["ai_assistant", "new_key"]);
    await nextTick();
    expect(wrapper!.get('[data-test="feature-lock-banner-denied"]').text()).toBe(
      "Your license does not include: AI Assistant, new_key. Ask your administrator to update the license.",
    );
    expect(wrapper!.find('[data-test="feature-lock-banner-contact-sales"]').exists()).toBe(true);
    await wrapper!.get('[data-test="feature-lock-banner-dismiss"]').trigger("click");
    expect(useLicenseDenials().features.value).toBeNull();
    expect(wrapper!.find('[data-test="feature-lock-banner"]').exists()).toBe(false);
  });

  it("says a generic sentence for a denial that named no feature", async () => {
    await mountBanner(true, null);
    addLicenseDeniedError([]);
    await nextTick();
    expect(wrapper!.get('[data-test="feature-lock-banner-denied"]').text()).toBe(
      "Your license does not include this feature. Ask your administrator to update the license.",
    );
  });

  it("shows only the page sentence on a locked page, undismissable, whatever was denied", async () => {
    await mountBanner(true);
    addLicenseDeniedError(["workflows", "ai_assistant"]);
    await nextTick();
    expect(wrapper!.get('[data-test="feature-lock-banner-feature"]').text()).toBe("Workflows");
    expect(wrapper!.find('[data-test="feature-lock-banner-denied"]').exists()).toBe(false);
    expect(wrapper!.find('[data-test="feature-lock-banner-dismiss"]').exists()).toBe(false);
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
        provideFeatureLock(ref("alerts"));
        return () => h(OPageHeader, { title: "Downtimes", subtitle: "Muted alerts" } as never);
      },
    });
    wrapper = mount(Locked, { global: { plugins: [i18n, router] } });
    const lock = wrapper.get('[data-test="app-page-header-locked"]');
    expect(lock.attributes("aria-label")).toBe("Locked: needs alerts");
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

  it("leaves navigation inside FeatureLockExempt live while the page stays locked", async () => {
    let clicks = 0;
    let seen: FeatureLock | undefined;
    const Probe = defineComponent({
      setup() {
        seen = useFeatureLock();
        return () => h("button", { "data-test": "nav", onClick: () => clicks++ }, "Users");
      },
    });
    wrapper = mount(FeatureLockBoundary, {
      props: { feature: "rbac" },
      slots: { default: () => h(FeatureLockExempt, () => h(Probe)) },
    });
    expect(seen!.locked.value).toBe(false);
    await wrapper.get('[data-test="nav"]').trigger("click");
    const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    wrapper.get('[data-test="nav"]').element.dispatchEvent(enter);
    expect(clicks).toBe(1);
    expect(enter.defaultPrevented).toBe(false);
    expect(isPageLocked()).toBe(true);
  });

  it("is a plain wrapper when nothing is locked", async () => {
    let clicks = 0;
    const boundary = mountBoundary(null, () => clicks++);
    expect(boundary.classes()).not.toContain("feature-locked-content");
    await boundary.get('[data-test="raw"]').trigger("click");
    expect(clicks).toBe(1);
  });
});

describe("useLicenseLock", () => {
  const licenseLockOf = (key: string, zoConfig: Record<string, unknown>) => {
    let result: ReturnType<typeof useLicenseLock> | undefined;
    const Probe = defineComponent({
      setup() {
        result = useLicenseLock(key);
        return () => null;
      },
    });
    const store = createStore({ state: () => ({ zoConfig }) });
    wrapper = mount(Probe, { global: { plugins: [i18n, store] } });
    return result!;
  };

  it("is locked when the license marks the feature locked, with the display name in the reason", () => {
    const { locked, lockedReason } = licenseLockOf("dashboards", {
      features: { dashboards: "locked" },
      feature_names: { dashboards: "Dashboards Pro" },
    });
    expect(locked.value).toBe(true);
    expect(lockedReason.value).toContain("Dashboards Pro");
  });

  it("falls back to the key in the reason when the display name is missing", () => {
    const { lockedReason } = licenseLockOf("reports", { features: { reports: "locked" } });
    expect(lockedReason.value).toContain("reports");
  });

  it("is not locked when the feature is enabled", () => {
    const { locked } = licenseLockOf("dashboards", { features: { dashboards: "enabled" } });
    expect(locked.value).toBe(false);
  });

  it("is not locked when the feature is hidden: hiding is the caller's own state", () => {
    const { locked } = licenseLockOf("dashboards", { features: { dashboards: "hidden" } });
    expect(locked.value).toBe(false);
  });

  it("is not locked when the backend sends no key for the feature", () => {
    expect(licenseLockOf("dashboards", { features: {} }).locked.value).toBe(false);
    wrapper?.unmount();
    expect(licenseLockOf("dashboards", {}).locked.value).toBe(false);
  });
});

describe("useLicenseLocks", () => {
  const licenseLocksOf = (zoConfig: Record<string, unknown>) => {
    let result: ReturnType<typeof useLicenseLocks> | undefined;
    const Probe = defineComponent({
      setup() {
        result = useLicenseLocks();
        return () => null;
      },
    });
    const store = createStore({ state: () => ({ zoConfig }) });
    wrapper = mount(Probe, { global: { plugins: [i18n, store] } });
    return result!;
  };

  it("locks only the runtime keys the license marks locked", () => {
    const { isLocked } = licenseLocksOf({
      features: { logs: "locked", metrics: "enabled", traces: "hidden" },
    });
    expect(isLocked("logs")).toBe(true);
    expect(isLocked("metrics")).toBe(false);
    expect(isLocked("traces")).toBe(false);
  });

  it("never locks a null key, the key of a stream type the license does not cover", () => {
    const { isLocked } = licenseLocksOf({ features: { logs: "locked" } });
    expect(isLocked(null)).toBe(false);
    expect(isLocked(undefined)).toBe(false);
  });

  it("names the feature in the reason", () => {
    const { lockedReason } = licenseLocksOf({
      features: { traces: "locked" },
      feature_names: { traces: "Traces" },
    });
    expect(lockedReason("traces")).toContain("Traces");
  });
});
