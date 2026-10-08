// Copyright 2026 OpenObserve Inc.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import { createMemoryHistory, createRouter, type RouteLocationRaw } from "vue-router";
import { createStore } from "vuex";

vi.mock("@/aws-exports", () => ({ default: { isCloud: "true", isEnterprise: "false" } }));

import config from "@/aws-exports";
import { useTrialPaywall } from "./useTrialPaywall";

const DAY_MS = 24 * 60 * 60 * 1000;
const EXPIRED_MICROS = (Date.now() - 30 * DAY_MS) * 1000;
const Page = { template: "<div />" };
const guarded = (to: unknown, from: unknown, next: () => void) => next();

const buildRouter = () =>
  createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", name: "home", component: Page },
      { path: "/logs", name: "logs", component: Page, beforeEnter: guarded },
      { path: "/dashboards", name: "dashboards", component: Page, beforeEnter: guarded },
      { path: "/alerts", name: "alerts", component: Page, beforeEnter: guarded },
      { path: "/streams", name: "logstreams", component: Page, beforeEnter: guarded },
      { path: "/iam", name: "iam", component: Page, beforeEnter: guarded },
      { path: "/users", name: "users", component: Page, beforeEnter: guarded },
      { path: "/organizations", name: "organizations", component: Page, beforeEnter: guarded },
      { path: "/invitations", name: "invitations", component: Page, beforeEnter: guarded },
      {
        path: "/settings",
        name: "settings",
        component: Page,
        beforeEnter: guarded,
        children: [{ path: "general", name: "general", component: Page }],
      },
      { path: "/billings/plans", name: "plans", component: Page },
      { path: "/traces", name: "traces", component: Page },
      {
        path: "/infra/databases",
        component: Page,
        beforeEnter: guarded,
        children: [{ path: "", name: "dbmDatabases", component: Page }],
      },
    ],
  });

const buildStore = (expiry: unknown) =>
  createStore({
    state: { organizationData: { organizationSettings: { free_trial_expiry: expiry } } },
  });

const mountWith = (expiry: unknown, probe: RouteLocationRaw = "/logs") => {
  let api: ReturnType<typeof useTrialPaywall> | null = null;
  const Host = defineComponent({
    setup() {
      api = useTrialPaywall();
      return () => h("span", { "data-test": "probe" }, String(api!.isPaywalled(probe)));
    },
  });
  const wrapper = mount(Host, { global: { plugins: [buildRouter(), buildStore(expiry)] } });
  return { wrapper, isPaywalled: api!.isPaywalled };
};

describe("useTrialPaywall", () => {
  beforeEach(() => {
    (config as any).isCloud = "true";
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each(["/logs", "/dashboards", "/alerts", "/streams"])(
    "mutes %s for an expired Cloud org",
    (path) => {
      const { isPaywalled } = mountWith(EXPIRED_MICROS);
      expect(isPaywalled(path)).toBe(true);
    },
  );

  it("mutes a child whose parent record carries the guard", () => {
    const { isPaywalled } = mountWith(EXPIRED_MICROS);
    expect(isPaywalled("/infra/databases")).toBe(true);
  });

  it("resolves a named location the same way as its path", () => {
    const { isPaywalled } = mountWith(EXPIRED_MICROS);
    expect(isPaywalled({ name: "logs" })).toBe(true);
    expect(isPaywalled({ path: "/logs", query: { org_identifier: "x" } })).toBe(true);
  });

  it.each(["/iam", "/users", "/organizations", "/invitations", "/settings", "/settings/general"])(
    "never mutes the allowed path %s",
    (path) => {
      const { isPaywalled } = mountWith(EXPIRED_MICROS);
      expect(isPaywalled(path)).toBe(false);
    },
  );

  it("never mutes a destination without a route guard (home, plans, traces)", () => {
    const { isPaywalled } = mountWith(EXPIRED_MICROS);
    expect(isPaywalled("/")).toBe(false);
    expect(isPaywalled("/billings/plans")).toBe(false);
    expect(isPaywalled("/traces")).toBe(false);
  });

  it("returns false for an unknown path or a location that cannot resolve", () => {
    const { isPaywalled } = mountWith(EXPIRED_MICROS);
    expect(isPaywalled("/nope")).toBe(false);
    expect(isPaywalled({ name: "missing" })).toBe(false);
  });

  it.each([
    ["no trial tracked", ""],
    ["null expiry", null],
    ["a future expiry", (Date.now() + 14 * DAY_MS) * 1000],
  ])("mutes nothing with %s", (_label, expiry) => {
    const { isPaywalled } = mountWith(expiry);
    expect(isPaywalled("/logs")).toBe(false);
  });

  it("mutes nothing when mounted without a store, as lib/core specs do", () => {
    let api: ReturnType<typeof useTrialPaywall> | null = null;
    const Host = defineComponent({
      setup() {
        api = useTrialPaywall();
        return () => h("span");
      },
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const wrapper = mount(Host, { global: { plugins: [buildRouter()] } });
    expect(api!.isPaywalled("/logs")).toBe(false);
    wrapper.unmount();
    warn.mockRestore();
  });

  it("mutes nothing outside Cloud even when expired", () => {
    (config as any).isCloud = "false";
    const { isPaywalled } = mountWith(EXPIRED_MICROS);
    expect(isPaywalled("/logs")).toBe(false);
  });

  // the render re-evaluates as time passes, not only when the store changes.
  it("re-evaluates when the trial lapses while the page stays open", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-07T12:00:00Z"));
    const expiry = (Date.now() + 36 * 60 * 60 * 1000) * 1000;
    const { wrapper } = mountWith(expiry);
    expect(wrapper.get('[data-test="probe"]').text()).toBe("false");

    vi.setSystemTime(new Date("2026-10-09T12:00:00Z"));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(wrapper.get('[data-test="probe"]').text()).toBe("true");
  });
});
