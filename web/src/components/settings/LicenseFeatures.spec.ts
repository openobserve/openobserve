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

const mountFeatures = (features: string[]) =>
  mount(LicenseFeatures, {
    props: { license: { features, feature_definition: definition } },
    global: {
      plugins: [i18n, createStore({ state: { zoConfig: { features: {} } } })],
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
});
