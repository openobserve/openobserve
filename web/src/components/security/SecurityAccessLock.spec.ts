// Copyright 2026 OpenObserve Inc.

import { afterEach, describe, expect, it, vi } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import { viewDenial } from "@/composables/useAccessStore";
import { raw } from "@/types/i18n";
import SecurityAccessLock from "./SecurityAccessLock.vue";

let wrapper: VueWrapper | null = null;
const role = store.state.currentuser?.role;

const mountLock = (userRole: string, denial = viewDenial("security", "update")) => {
  store.state.currentuser = { ...store.state.currentuser, role: userRole };
  wrapper = mount(SecurityAccessLock, {
    props: { denials: [denial] },
    global: { plugins: [store, i18n, router] },
  });
  return wrapper;
};

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  store.state.currentuser = { ...store.state.currentuser, role };
});

describe("SecurityAccessLock", () => {
  it("offers an admin the preset that lifts the denial", async () => {
    const push = vi.spyOn(router, "push").mockResolvedValue(undefined);
    const lock = mountLock("admin");
    expect(lock.find('[data-test="security-access-lock-ask-admin"]').exists()).toBe(false);
    const link = lock.findAll("button").find((b) => b.text().includes("SOC Analyst"));
    expect(link?.text()).toContain("Start a role from SOC Analyst");
    await link!.trigger("click");
    expect(push).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "roles",
        query: expect.objectContaining({ startFrom: "soc_analyst" }),
      }),
    );
    push.mockRestore();
  });

  it("tells anyone else which preset to ask an admin for", () => {
    const lock = mountLock("editor", viewDenial("streams", "list"));
    expect(lock.find('[data-test="security-access-lock-ask-admin"]').text()).toBe(
      "Ask an admin for the Security Viewer preset.",
    );
    expect(lock.text()).not.toContain("Start a role from");
  });

  it("shows the server's reason under the lock, and nothing when there is none", () => {
    store.state.currentuser = { ...store.state.currentuser, role: "editor" };
    wrapper = mount(SecurityAccessLock, {
      props: {
        denials: [viewDenial("streams", "list")],
        reason: raw("No read permission on streams: windows_security"),
      },
      global: { plugins: [store, i18n, router] },
    });
    expect(wrapper.find('[data-test="security-access-lock-reason"]').text()).toBe(
      "No read permission on streams: windows_security",
    );
    wrapper.unmount();
    wrapper = mountLock("editor", viewDenial("streams", "list"));
    expect(wrapper.find('[data-test="security-access-lock-reason"]').exists()).toBe(false);
  });
});
