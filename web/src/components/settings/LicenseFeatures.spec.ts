import { describe, it, expect, afterEach } from "vitest";
import { mount, enableAutoUnmount, flushPromises } from "@vue/test-utils";
import { createStore } from "vuex";
import i18n from "@/locales";
import LicenseFeatures from "./LicenseFeatures.vue";

enableAutoUnmount(afterEach);

const definition = {
  features: {
    workflows: { display_name: "Workflows", gate: true },
    rbac: { display_name: "Role-Based Access Control", gate: true },
    logs: { display_name: "Logs", gate: false },
  },
};

const mountFeatures = (features: string[], states: Record<string, string> = {}) =>
  mount(LicenseFeatures, {
    props: { license: { features, feature_definition: definition } },
    global: {
      plugins: [i18n, createStore({ state: { zoConfig: { features: states } } })],
    },
  });

const find = (wrapper: ReturnType<typeof mountFeatures>, name: string) =>
  wrapper.find(`[data-test="settings-license-features-${name}"]`);

const items = (wrapper: ReturnType<typeof mountFeatures>, name: string) =>
  find(wrapper, name)
    .findAll("li")
    .map((li) => li.text());

describe("LicenseFeatures", () => {
  it("shows every gated feature as unlocked when the license lists only all", () => {
    const wrapper = mountFeatures(["all"]);

    expect(items(wrapper, "unlocked")).toEqual(["Role-Based Access Control", "Workflows"]);
    expect(find(wrapper, "unlocked").text()).not.toMatch(/\ball\b/);
    expect(find(wrapper, "missing").exists()).toBe(false);
    expect(find(wrapper, "request-access").exists()).toBe(false);
  });

  it("lists the features that are not in a license with named features", () => {
    const wrapper = mountFeatures(["workflows"]);

    expect(items(wrapper, "unlocked")).toEqual(["Workflows"]);
    expect(items(wrapper, "missing")).toEqual(["Role-Based Access Control"]);
  });

  it("shows search, tabs and the list box without any expand step", () => {
    const wrapper = mountFeatures(["workflows"]);

    expect(find(wrapper, "search").exists()).toBe(true);
    expect(find(wrapper, "filter").exists()).toBe(true);
    expect(find(wrapper, "expand").exists()).toBe(false);
    expect(find(wrapper, "collapse").exists()).toBe(false);
    expect(items(wrapper, "free")).toEqual(["Logs"]);
  });

  it("keeps the list in a fixed-height scroll box", () => {
    const box = find(mountFeatures(["workflows"]), "list");

    expect(box.exists()).toBe(true);
    expect(box.classes()).toEqual(expect.arrayContaining(["h-44", "overflow-auto"]));
  });

  it("shows only the selected tab's group, without group headings", async () => {
    const wrapper = mountFeatures(["workflows"]);
    expect(find(wrapper, "list").text()).toContain("Unlocked · 1");

    wrapper.findComponent({ name: "OToggleGroup" }).vm.$emit("update:modelValue", "missing");
    await flushPromises();

    expect(items(wrapper, "missing")).toEqual(["Role-Based Access Control"]);
    expect(find(wrapper, "unlocked").exists()).toBe(false);
    expect(find(wrapper, "free").exists()).toBe(false);
    expect(find(wrapper, "list").text()).not.toContain("Not in your license ·");
  });

  it("filters by search and shows the no-match state inside the box", async () => {
    const wrapper = mountFeatures(["workflows"]);
    const search = wrapper.findComponent({ name: "OSearchInput" });

    search.vm.$emit("update:modelValue", "role");
    await flushPromises();
    expect(items(wrapper, "missing")).toEqual(["Role-Based Access Control"]);
    expect(find(wrapper, "unlocked").exists()).toBe(false);

    search.vm.$emit("update:modelValue", "zzz");
    await flushPromises();
    expect(find(wrapper, "list").find('[data-test="settings-license-features-empty"]').text()).toBe(
      "No features match your search",
    );
  });

  it("emits request-access from the lead sentence button", async () => {
    const wrapper = mountFeatures(["workflows"]);

    await find(wrapper, "request-access").trigger("click");

    expect(wrapper.emitted("request-access")).toHaveLength(1);
  });

  it("keeps the list but drops the button with hideRequestAccess", async () => {
    const wrapper = mountFeatures(["workflows"]);

    await wrapper.setProps({ hideRequestAccess: true });

    expect(find(wrapper, "request-access").exists()).toBe(false);
    expect(items(wrapper, "missing")).toEqual(["Role-Based Access Control"]);
  });

  describe("a gated feature that is on without being listed", () => {
    const enabledRbac = { rbac: "enabled", workflows: "locked", logs: "enabled" };

    it("gets its own group after the free one, and the counts add up", () => {
      const wrapper = mountFeatures([], enabledRbac);
      const list = find(wrapper, "list");

      expect(items(wrapper, "free-not-included")).toEqual(["Role-Based Access Control"]);
      expect(items(wrapper, "missing")).toEqual(["Workflows"]);
      expect(list.text()).toContain("Free, not included in your license");
      expect(list.text()).not.toContain("Free, not included in your license ·");
      const groups = list.findAll('[data-test^="settings-license-features-"]');
      expect(groups.map((group) => group.attributes("data-test"))).toEqual([
        "settings-license-features-missing",
        "settings-license-features-free",
        "settings-license-features-free-not-included",
      ]);
      expect(find(wrapper, "summary").text()).toBe(
        "Your license unlocks 0 of 1 paid feature. 1 free feature is always included.",
      );
      expect(find(wrapper, "filter-all").text()).toBe("All 3");
      expect(find(wrapper, "filter-free-not-included").text()).toBe(
        "Free, not included in your license 1",
      );
    });

    it("drops Request Access when nothing else is missing", () => {
      const wrapper = mountFeatures(["workflows"], { rbac: "enabled", workflows: "enabled" });

      expect(find(wrapper, "missing").exists()).toBe(false);
      expect(items(wrapper, "free-not-included")).toEqual(["Role-Based Access Control"]);
      expect(find(wrapper, "request-access").exists()).toBe(false);
    });

    it("lists it as missing while the license reads evaluated_at 0", () => {
      const wrapper = mount(LicenseFeatures, {
        props: { license: { features: [], feature_definition: definition }, evaluatedAt: 0 },
        global: {
          plugins: [i18n, createStore({ state: { zoConfig: { features: enabledRbac } } })],
        },
      });

      expect(find(wrapper, "free-not-included").exists()).toBe(false);
      expect(items(wrapper, "missing")).toEqual(["Role-Based Access Control", "Workflows"]);
    });

    it("shows no group or tab when there is nothing in it", () => {
      const wrapper = mountFeatures(["workflows"], { rbac: "locked", workflows: "enabled" });

      expect(find(wrapper, "free-not-included").exists()).toBe(false);
      expect(find(wrapper, "filter-free-not-included").exists()).toBe(false);
      expect(items(wrapper, "missing")).toEqual(["Role-Based Access Control"]);
    });
  });
});
