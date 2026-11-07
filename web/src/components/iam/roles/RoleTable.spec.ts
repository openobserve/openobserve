import { describe, it, expect } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import RoleTable from "@/components/iam/roles/RoleTable.vue";

const mountTable = (data: any[]) =>
  mount(RoleTable, {
    props: { data, loading: false },
    global: { plugins: [i18n, store, router] },
    attachTo: document.body,
  });

describe("RoleTable member count columns", () => {
  it("opens the Users tab when the users count is clicked", async () => {
    const wrapper = mountTable([{ role_name: "ops", user_count: 3, service_account_count: 2 }]);
    await flushPromises();
    await wrapper.find('[data-test="iam-roles-ops-users-link"]').trigger("click");
    expect(wrapper.emitted("edit")?.[0]).toEqual([
      expect.objectContaining({ role_name: "ops" }),
      "users",
    ]);
    wrapper.unmount();
  });

  it("opens the Service Accounts tab when the service accounts count is clicked", async () => {
    const wrapper = mountTable([{ role_name: "ops", user_count: 3, service_account_count: 2 }]);
    await flushPromises();
    const link = wrapper.find('[data-test="iam-roles-ops-service-accounts-link"]');
    expect(link.text()).toBe("2");
    await link.trigger("click");
    expect(wrapper.emitted("edit")?.[0]).toEqual([
      expect.objectContaining({ role_name: "ops" }),
      "serviceAccounts",
    ]);
    wrapper.unmount();
  });

  it("renders a zero count with the muted variant and a non-zero count with the primary one", async () => {
    const wrapper = mountTable([{ role_name: "bots", user_count: 0, service_account_count: 2 }]);
    await flushPromises();
    const variant = (id: string) =>
      wrapper.find(`[data-test="iam-roles-bots-${id}-link"]`).attributes("data-o2-variant");
    expect(variant("users")).toBe("ghost-muted");
    expect(variant("service-accounts")).toBe("ghost-primary");
    wrapper.unmount();
  });

  it("labels each count button with its role and column", async () => {
    const wrapper = mountTable([{ role_name: "ops", user_count: 3, service_account_count: 2 }]);
    await flushPromises();
    expect(wrapper.find('[data-test="iam-roles-ops-users-link"]').attributes("aria-label")).toBe(
      "ops: 3 Users",
    );
    wrapper.unmount();
  });

  it("hides the service accounts column when counts are unavailable", async () => {
    const wrapper = mountTable([{ role_name: "ops", user_count: 3, service_account_count: null }]);
    await flushPromises();
    expect(wrapper.find('[data-test="iam-roles-ops-service-accounts-link"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="iam-roles-ops-users-link"]').exists()).toBe(true);
    wrapper.unmount();
  });
});
