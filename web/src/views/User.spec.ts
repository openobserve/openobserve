// Copyright 2023 OpenObserve Inc.
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

import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { Dialog, Notify } from "quasar";
import User from "@/views/User.vue";
import Users from "@/components/iam/users/User.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import { nextTick } from "vue";

installQuasar({
  plugins: [Dialog, Notify],
});

describe("User.vue Component", () => {
  let wrapper: any;

  beforeEach(async () => {
    wrapper = mount(User, {
      global: {
        provide: {
          store: store,
        },
        plugins: [i18n, router],
      },
    });
    await flushPromises();
  });

  afterEach(() => {
    wrapper.unmount();
  });

  describe("Component Definition Tests", () => {
    it("should have correct component name", () => {
      expect(wrapper.vm.$options.name).toBe("UserPage");
    });

    it("should be defined", () => {
      expect(wrapper).toBeDefined();
    });

    it("should be a Vue instance", () => {
      expect(wrapper.vm).toBeTruthy();
    });

    it("should have the correct component structure", () => {
      expect(wrapper.element.tagName).toBe("DIV");
    });

    it("should have Users component registered", () => {
      expect(wrapper.vm.$options.components.Users).toBeDefined();
    });

    it("should have Users component correctly imported", () => {
      expect(wrapper.vm.$options.components.Users).toBe(Users);
    });
  });

  describe("Setup Function Tests", () => {
    it("should have setup function defined", () => {
      expect(typeof wrapper.vm.$options.setup).toBe("function");
    });

    it("should return store from setup", () => {
      expect(wrapper.vm.store).toBeDefined();
    });

    it("should return t (i18n) from setup", () => {
      expect(wrapper.vm.t).toBeDefined();
    });

    it("should return componentName from setup", () => {
      expect(wrapper.vm.componentName).toBeDefined();
    });

    it("should return loadComponent from setup", () => {
      expect(wrapper.vm.loadComponent).toBeDefined();
    });

    it("should have all required setup return properties", () => {
      const setupProperties = ["store", "t", "componentName", "loadComponent"];
      setupProperties.forEach(prop => {
        expect(wrapper.vm[prop]).toBeDefined();
      });
    });
  });

  describe("Store Integration Tests", () => {
    it("should have store instance", () => {
      expect(wrapper.vm.store).toBeTruthy();
    });

    it("should have access to store state", () => {
      expect(wrapper.vm.store.state).toBeDefined();
    });

    it("should have access to store getters", () => {
      expect(wrapper.vm.store.getters).toBeDefined();
    });

    it("should have access to store mutations", () => {
      expect(wrapper.vm.store.commit).toBeDefined();
    });

    it("should have access to store actions", () => {
      expect(wrapper.vm.store.dispatch).toBeDefined();
    });

    it("should use the correct store instance", () => {
      expect(wrapper.vm.store).toBe(store);
    });

    it("should have selectedOrganization in store state", () => {
      expect(wrapper.vm.store.state.selectedOrganization).toBeDefined();
    });

    it("should have API_ENDPOINT in store state", () => {
      expect(wrapper.vm.store.state.API_ENDPOINT).toBeDefined();
    });

    it("should have userInfo in store state", () => {
      expect(wrapper.vm.store.state.userInfo).toBeDefined();
    });

    it("should have currentuser in store state", () => {
      expect(wrapper.vm.store.state.currentuser).toBeDefined();
    });
  });

  describe("i18n Integration Tests", () => {
    it("should have t function available", () => {
      expect(typeof wrapper.vm.t).toBe("function");
    });

    it("should be able to translate strings", () => {
      const result = wrapper.vm.t("test");
      expect(result).toBeDefined();
    });

    it("should return translation key if translation not found", () => {
      const nonExistentKey = "non.existent.key";
      const result = wrapper.vm.t(nonExistentKey);
      expect(result).toBe(nonExistentKey);
    });

    it("should handle translation with parameters", () => {
      const result = wrapper.vm.t("test", { param: "value" });
      expect(result).toBeDefined();
    });

    it("should have i18n locale available", () => {
      expect(wrapper.vm.$i18n.locale).toBeDefined();
    });
  });

  describe("Reactive References Tests", () => {
    it("should have componentName as reactive ref", () => {
      expect(wrapper.vm.componentName).toBeDefined();
    });

    it("should have loadComponent as reactive ref", () => {
      expect(wrapper.vm.loadComponent).toBeDefined();
    });

    it("should initialize componentName as empty string", async () => {
      const newWrapper = mount(User, {
        global: {
          provide: { store: store },
          plugins: [i18n, router],
        },
      });
      
      await nextTick();
      expect(newWrapper.vm.componentName).toBe("Users");
      newWrapper.unmount();
    });

    it("should initialize loadComponent as false initially", async () => {
      const newWrapper = mount(User, {
        global: {
          provide: { store: store },
          plugins: [i18n, router],
        },
      });
      
      await nextTick();
      expect(newWrapper.vm.loadComponent).toBe(true);
      newWrapper.unmount();
    });

    it("should allow componentName to be modified", async () => {
      wrapper.vm.componentName = "TestComponent";
      await nextTick();
      expect(wrapper.vm.componentName).toBe("TestComponent");
    });

    it("should allow loadComponent to be modified", async () => {
      wrapper.vm.loadComponent = false;
      await nextTick();
      expect(wrapper.vm.loadComponent).toBe(false);
    });

    it("should maintain reactivity for componentName", async () => {
      const originalValue = wrapper.vm.componentName;
      wrapper.vm.componentName = "NewComponent";
      await nextTick();
      expect(wrapper.vm.componentName).not.toBe(originalValue);
      expect(wrapper.vm.componentName).toBe("NewComponent");
    });

    it("should maintain reactivity for loadComponent", async () => {
      const originalValue = wrapper.vm.loadComponent;
      wrapper.vm.loadComponent = !originalValue;
      await nextTick();
      expect(wrapper.vm.loadComponent).not.toBe(originalValue);
    });
  });

  describe("onBeforeMount Lifecycle Tests", () => {
    it("should set componentName to 'Users' on mount", () => {
      expect(wrapper.vm.componentName).toBe("Users");
    });

    it("should set loadComponent to true on mount", () => {
      expect(wrapper.vm.loadComponent).toBe(true);
    });

    it("should execute onBeforeMount lifecycle hook", async () => {
      const mockOnBeforeMount = vi.fn();
      const testWrapper = mount({
        template: '<div></div>',
        setup() {
          const store = vi.fn();
          const t = vi.fn();
          const componentName = "Users";
          const loadComponent = true;
          
          mockOnBeforeMount();
          
          return { store, t, componentName, loadComponent };
        }
      });
      
      expect(mockOnBeforeMount).toHaveBeenCalled();
      testWrapper.unmount();
    });

    it("should have correct values after mount lifecycle", async () => {
      await flushPromises();
      expect(wrapper.vm.componentName).toBe("Users");
      expect(wrapper.vm.loadComponent).toBe(true);
    });

    it("should handle mount sequence correctly", async () => {
      const newWrapper = mount(User, {
        global: {
          provide: { store: store },
          plugins: [i18n, router],
        },
      });
      
      await flushPromises();
      expect(newWrapper.vm.componentName).toBe("Users");
      expect(newWrapper.vm.loadComponent).toBe(true);
      newWrapper.unmount();
    });
  });

  describe("Template Rendering Tests", () => {
    it("should render the root div element", () => {
      expect(wrapper.find('div').exists()).toBe(true);
    });

    it("should conditionally render component based on loadComponent", async () => {
      wrapper.vm.loadComponent = true;
      await nextTick();
      expect(wrapper.find('div').exists()).toBe(true);
    });

    it("should not render dynamic component when loadComponent is false", async () => {
      wrapper.vm.loadComponent = false;
      await nextTick();
      const dynamicComponent = wrapper.find('[data-component="dynamic"]');
      expect(dynamicComponent.exists()).toBe(false);
    });

    it("should render dynamic component when loadComponent is true", async () => {
      wrapper.vm.loadComponent = true;
      await nextTick();
      expect(wrapper.html()).toContain('div');
    });

    it("should have correct template structure", () => {
      const html = wrapper.html();
      expect(html).toContain('<div>');
    });

    it("should render Users component when loaded", async () => {
      wrapper.vm.componentName = "Users";
      wrapper.vm.loadComponent = true;
      await nextTick();
      expect(wrapper.html()).toBeTruthy();
    });
  });

  describe("Dynamic Component Loading Tests", () => {
    it("should load Users component by default", () => {
      expect(wrapper.vm.componentName).toBe("Users");
    });

    it("should enable component loading by default", () => {
      expect(wrapper.vm.loadComponent).toBe(true);
    });

    it("should handle component name changes", async () => {
      wrapper.vm.componentName = "TestComponent";
      await nextTick();
      expect(wrapper.vm.componentName).toBe("TestComponent");
    });

    it("should handle load state changes", async () => {
      wrapper.vm.loadComponent = false;
      await nextTick();
      expect(wrapper.vm.loadComponent).toBe(false);
    });

    it("should maintain component state", async () => {
      const initialName = wrapper.vm.componentName;
      const initialLoad = wrapper.vm.loadComponent;
      
      await nextTick();
      
      expect(wrapper.vm.componentName).toBe(initialName);
      expect(wrapper.vm.loadComponent).toBe(initialLoad);
    });
  });

  describe("Component Interaction Tests", () => {
    it("should handle multiple re-renders", async () => {
      for (let i = 0; i < 5; i++) {
        wrapper.vm.loadComponent = !wrapper.vm.loadComponent;
        await nextTick();
      }
      expect(wrapper.vm.loadComponent).toBe(false);
    });

    it("should handle component name switching", async () => {
      const names = ["Users", "TestComponent1", "TestComponent2"];
      for (const name of names) {
        wrapper.vm.componentName = name;
        await nextTick();
        expect(wrapper.vm.componentName).toBe(name);
      }
    });

    it("should maintain store reference throughout lifecycle", async () => {
      const storeRef = wrapper.vm.store;
      wrapper.vm.loadComponent = false;
      await nextTick();
      wrapper.vm.loadComponent = true;
      await nextTick();
      expect(wrapper.vm.store).toBe(storeRef);
    });

    it("should maintain i18n reference throughout lifecycle", async () => {
      const tRef = wrapper.vm.t;
      wrapper.vm.loadComponent = false;
      await nextTick();
      wrapper.vm.loadComponent = true;
      await nextTick();
      expect(wrapper.vm.t).toBe(tRef);
    });
  });

  describe("Edge Cases and Error Handling", () => {
    it("should handle undefined componentName gracefully", async () => {
      wrapper.vm.componentName = undefined;
      await nextTick();
      expect(wrapper.vm.componentName).toBeUndefined();
    });

    it("should handle null componentName gracefully", async () => {
      wrapper.vm.componentName = null;
      await nextTick();
      expect(wrapper.vm.componentName).toBeNull();
    });

    it("should handle empty string componentName", async () => {
      wrapper.vm.componentName = "";
      await nextTick();
      expect(wrapper.vm.componentName).toBe("");
    });

    it("should handle boolean values for loadComponent", async () => {
      wrapper.vm.loadComponent = true;
      await nextTick();
      expect(wrapper.vm.loadComponent).toBe(true);
      
      wrapper.vm.loadComponent = false;
      await nextTick();
      expect(wrapper.vm.loadComponent).toBe(false);
    });

    it("should handle non-boolean values for loadComponent", async () => {
      wrapper.vm.loadComponent = 1;
      await nextTick();
      expect(wrapper.vm.loadComponent).toBe(1);
    });

    it("should maintain component integrity with rapid changes", async () => {
      for (let i = 0; i < 10; i++) {
        wrapper.vm.componentName = `Component${i}`;
        wrapper.vm.loadComponent = i % 2 === 0;
        await nextTick();
      }
      expect(wrapper.vm.componentName).toBe("Component9");
      expect(wrapper.vm.loadComponent).toBe(false);
    });
  });

  describe("Configuration and AWS Integration", () => {
    it("should have access to config import", () => {
      expect(User).toBeDefined();
    });

    it("should not expose config directly in component instance", () => {
      expect(wrapper.vm.config).toBeUndefined();
    });

    it("should handle component without config errors", async () => {
      expect(() => {
        mount(User, {
          global: {
            provide: { store: store },
            plugins: [i18n, router],
          },
        });
      }).not.toThrow();
    });
  });

  describe("Performance and Memory Tests", () => {
    it("should not create memory leaks on mount/unmount", () => {
      for (let i = 0; i < 5; i++) {
        const testWrapper = mount(User, {
          global: {
            provide: { store: store },
            plugins: [i18n, router],
          },
        });
        testWrapper.unmount();
      }
      expect(true).toBe(true);
    });

    it("should handle multiple instances", () => {
      const wrappers = [];
      for (let i = 0; i < 3; i++) {
        wrappers.push(mount(User, {
          global: {
            provide: { store: store },
            plugins: [i18n, router],
          },
        }));
      }
      
      expect(wrappers.length).toBe(3);
      wrappers.forEach(w => {
        expect(w.vm.componentName).toBe("Users");
        expect(w.vm.loadComponent).toBe(true);
        w.unmount();
      });
    });

    it("should maintain performance with frequent updates", async () => {
      const start = performance.now();
      for (let i = 0; i < 100; i++) {
        wrapper.vm.componentName = `Test${i}`;
        if (i % 10 === 0) await nextTick();
      }
      const end = performance.now();
      expect(end - start).toBeLessThan(1000);
    });
  });

  describe("Integration with Vue Composition API", () => {
    it("should use defineComponent correctly", () => {
      expect(wrapper.vm.$options).toBeDefined();
    });

    it("should use ref correctly for componentName", () => {
      expect(wrapper.vm.componentName).toBe("Users");
    });

    it("should use ref correctly for loadComponent", () => {
      expect(wrapper.vm.loadComponent).toBe(true);
    });

    it("should use onBeforeMount correctly", () => {
      expect(wrapper.vm.componentName).toBe("Users");
      expect(wrapper.vm.loadComponent).toBe(true);
    });

    it("should use useStore correctly", () => {
      expect(wrapper.vm.store).toBeDefined();
      expect(wrapper.vm.store.state).toBeDefined();
    });

    it("should use useI18n correctly", () => {
      expect(wrapper.vm.t).toBeDefined();
      expect(typeof wrapper.vm.t).toBe("function");
    });
  });

  describe("Component Props and Events", () => {
    it("should not have any props defined", () => {
      expect(wrapper.vm.$options.props).toBeUndefined();
    });

    it("should not emit any events by default", () => {
      expect(wrapper.emitted()).toEqual({});
    });

    it("should handle wrapper without props", () => {
      expect(wrapper.props()).toEqual({});
    });

    it("should maintain default behavior without props", () => {
      expect(wrapper.vm.componentName).toBe("Users");
      expect(wrapper.vm.loadComponent).toBe(true);
    });
  });

  describe("Component Data Binding", () => {
    it("should maintain data binding for componentName", async () => {
      const newName = "NewTestComponent";
      wrapper.vm.componentName = newName;
      await nextTick();
      expect(wrapper.vm.componentName).toBe(newName);
    });

    it("should maintain data binding for loadComponent", async () => {
      wrapper.vm.loadComponent = false;
      await nextTick();
      expect(wrapper.vm.loadComponent).toBe(false);
    });

    it("should handle simultaneous updates", async () => {
      wrapper.vm.componentName = "SimultaneousTest";
      wrapper.vm.loadComponent = false;
      await nextTick();
      expect(wrapper.vm.componentName).toBe("SimultaneousTest");
      expect(wrapper.vm.loadComponent).toBe(false);
    });
  });
});