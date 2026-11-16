// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createStore } from "vuex";
import { defineComponent, h } from "vue";
import i18n from "@/locales";

vi.mock("@/aws-exports", () => ({ default: { isEnterprise: "true", isCloud: "false" } }));
vi.mock("@/utils/zincutils", () => ({ routeGuard: vi.fn() }));
vi.mock("vue-router", () => ({
  useRoute: () => ({ query: {} }),
  useRouter: () => ({ push: vi.fn() }),
}));

import { lockGatedRoutes, lockInPlace } from "./lockInPlace";
import { withFeatureGate } from "@/utils/enterpriseFeatures";

const Page = defineComponent({ render: () => h("div", { "data-test": "real-page" }) });

async function mountGated(rbacEnabled: boolean) {
  const route: any = lockInPlace("rbac", {
    path: "roles",
    name: "roles",
    meta: { titleKey: "iam.roles" },
    component: () => Promise.resolve({ default: Page }),
  });
  const Gated: any = await route.component();
  const store = createStore({ state: { zoConfig: { rbac_enabled: rbacEnabled } } });
  return mount(Gated, { global: { plugins: [store, i18n] } });
}

describe("lockInPlace", () => {
  it("renders the page when the feature is on", async () => {
    const wrapper = await mountGated(true);
    await flushPromises();
    expect(wrapper.find('[data-test="real-page"]').exists()).toBe(true);
  });

  it("renders the feature's own lock instead of the page when it is off", async () => {
    const wrapper = await mountGated(false);
    await flushPromises();
    expect(wrapper.find('[data-test="real-page"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="feature-lock-inline"]').exists()).toBe(true);
    expect(wrapper.text()).toContain("Roles");
  });

  it("names the cause, the setting and who changes it, with a docs link, when RBAC is off", async () => {
    const wrapper = await mountGated(false);
    await flushPromises();
    expect(wrapper.text()).toContain("O2_OPENFGA_ENABLED");
    expect(wrapper.text()).toContain("An admin turns it on");
    expect(wrapper.find('[data-test="feature-lock-inline-docs"]').exists()).toBe(true);
  });

  it("converts routes gated by withFeatureGate, children included, and keeps their own guard when allowed", () => {
    const guard = vi.fn();
    const routes = lockGatedRoutes([
      {
        path: "p",
        component: Page,
        children: [
          {
            path: "c",
            component: Page,
            meta: { titleKey: "iam.roles" },
            beforeEnter: withFeatureGate("rbac", guard),
          },
        ],
      },
    ]);
    const child = routes[0].children[0];
    expect(typeof child.component).toBe("function");

    child.beforeEnter({ query: {} }, {}, vi.fn());
    expect(guard).toHaveBeenCalledTimes(1);
  });
});
