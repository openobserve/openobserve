import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import { installQuasar } from "../helpers/install-quasar-plugin";
import { createStore } from "vuex";
import MainLayout from "../../../layouts/MainLayout.vue";
import MenuLink from "../../../components/MenuLink.vue";
import i18n from "../../../locales";

installQuasar();
const store = createStore({
  state: {
    currentuser: {
      miniMode: false,
    },
    userInfo: {
      email: "",
      exp: 0,
    },
    selectedOrganization: "",
  },
  mutations: {
    setOrganizations: vi.fn(),
    setSelectedOrganization: vi.fn(),
  },
});
describe("MainLayout", async () => {
  it("should mount MainLayout view", async () => {
    const wrapper = mount(MainLayout, {
      shallow: false,
      components: {
        MenuLink,
      },
      global: {
        plugins: [i18n],
        provide: {
          store: store,
        },
      },
    });
    expect(wrapper).toBeTruthy();
  });
});
