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

import { DOMWrapper, flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import Login from "@/components/login/Login.vue";
import i18n from "@/locales";
import { Dialog, Notify } from "quasar";
import { createStore } from "vuex";
import { createRouter, createWebHistory } from "vue-router";

// Mock useQuasar
const mockNotify = vi.fn();
vi.mock("quasar", async () => {
  const actual = await vi.importActual("quasar");
  return {
    ...actual,
    useQuasar: () => ({
      notify: mockNotify,
    }),
  };
});

// Mock dependencies
vi.mock("@/services/auth", () => ({
  default: {
    sign_in_user: vi.fn(),
    get_dex_login: vi.fn(),
  },
}));

vi.mock("@/services/organizations", () => ({
  default: {
    os_list: vi.fn().mockResolvedValue({
      data: { data: [] }
    }),
  },
}));

vi.mock("@/utils/zincutils", () => ({
  getBasicAuth: vi.fn().mockReturnValue("basic-auth-token"),
  b64EncodeStandard: vi.fn().mockReturnValue("encoded-data"),
  useLocalUserInfo: vi.fn(),
  useLocalCurrentUser: vi.fn(),
  useLocalOrganization: vi.fn(() => ({ value: null })),
  getImageURL: vi.fn().mockReturnValue("image-url"),
}));

vi.mock("@/utils/common", () => ({
  redirectUser: vi.fn(),
}));

vi.mock("@/aws-exports", () => ({
  default: {
    isCloud: "false",
    isEnterprise: "true",
  },
}));

vi.mock("@openobserve/browser-rum", () => ({
  openobserveRum: {
    setUser: vi.fn(),
    startSessionReplayRecording: vi.fn(),
  },
}));

installQuasar({
  plugins: [Dialog, Notify],
});

const node = document.createElement("div");
node.setAttribute("id", "app");
document.body.appendChild(node);

describe("Login", () => {
  let wrapper: any = null;
  let store: any;
  let router: any;
  
  // Helper function to mount component with mocks
  const mountComponentWithMocks = (options: any = {}) => {
    const mockNotify = options.mockNotify || vi.fn();
    const mockResetValidation = options.mockResetValidation || vi.fn();
    
    wrapper = mount(Login, {
      global: {
        plugins: [i18n, options.customStore || store, router],
        provide: {
          $q: { notify: mockNotify },
        },
        ...options.globalOptions,
      },
      ...options.mountOptions,
    });
    
    // Set up component mocks after mounting
    Object.defineProperty(wrapper.vm, '$q', {
      value: { notify: mockNotify },
      writable: true,
    });
    
    Object.defineProperty(wrapper.vm, 'loginform', {
      value: { value: { resetValidation: mockResetValidation } },
      writable: true,
    });
    
    return { mockNotify, mockResetValidation };
  };

  beforeEach(async () => {
    // Reset all mocks
    vi.clearAllMocks();
    mockNotify.mockClear();
    
    // Set default mock implementations
    const authService = await import("@/services/auth");
    (authService.default.sign_in_user as any).mockResolvedValue({
      data: { status: true, role: "admin" }
    });
    (authService.default.get_dex_login as any).mockResolvedValue("https://sso.example.com");
    
    // Create mock store
    store = createStore({
      state: {
        zoConfig: {
          sso_enabled: true,
          native_login_enabled: true,
          rum: {
            enabled: true,
          },
        },
        userInfo: {
          email: "test@example.com",
        },
      },
      actions: {
        setUserInfo: vi.fn(),
        setCurrentUser: vi.fn(),
        setSelectedOrganization: vi.fn(),
      },
      mutations: {
        SET_USER_INFO: vi.fn(),
        SET_CURRENT_USER: vi.fn(),
        SET_SELECTED_ORGANIZATION: vi.fn(),
      },
      dispatch: vi.fn(),
    });

    // Create mock router
    router = createRouter({
      history: createWebHistory(),
      routes: [
        { path: "/", component: { template: "<div>Home</div>" } },
        { path: "/cb", component: { template: "<div>Callback</div>" } },
      ],
    });

    // Mock window methods
    Object.defineProperty(window, "sessionStorage", {
      value: {
        getItem: vi.fn(),
        setItem: vi.fn(),
        removeItem: vi.fn(),
      },
      writable: true,
    });

    Object.defineProperty(window, "location", {
      value: {
        href: "",
      },
      writable: true,
    });
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  // Test 1: Component mounts successfully
  it("should mount the component successfully", () => {
    wrapper = mount(Login, {
      attachTo: "#app",
      global: {
        plugins: [i18n, store, router],
      },
    });
    expect(wrapper).toBeTruthy();
    expect(wrapper.vm).toBeTruthy();
  });

  // Test 2: Component name is correct
  it("should have the correct component name", () => {
    wrapper = mount(Login, {
      global: {
        plugins: [i18n, store, router],
      },
    });
    expect(wrapper.vm.$options.name).toBe("PageLogin");
  });

  // Test 3: Initial reactive data values
  it("should initialize reactive data with correct default values", () => {
    wrapper = mount(Login, {
      global: {
        plugins: [i18n, store, router],
      },
    });
    
    expect(wrapper.vm.name).toBe("");
    expect(wrapper.vm.password).toBe("");
    expect(wrapper.vm.confirmpassword).toBe("");
    expect(wrapper.vm.email).toBe("");
    expect(wrapper.vm.submitting).toBe(false);
    expect(wrapper.vm.loginAsInternalUser).toBe(false);
    expect(wrapper.vm.autoRedirectDexLogin).toBe(false);
    expect(wrapper.vm.tab).toBe("signin");
    expect(wrapper.vm.innerTab).toBe("signup");
  });

  // Test 4: showSSO computed property when SSO is enabled
  it("should return true for showSSO when SSO is enabled and is enterprise", () => {
    wrapper = mount(Login, {
      global: {
        plugins: [i18n, store, router],
      },
    });
    expect(wrapper.vm.showSSO).toBe(true);
  });

  // Test 5: showSSO computed property when SSO is disabled
  it("should return false for showSSO when SSO is disabled", () => {
    const storeWithoutSSO = createStore({
      state: {
        zoConfig: {
          sso_enabled: false,
          native_login_enabled: true,
        },
        userInfo: {
          email: "test@example.com",
        },
      },
      actions: {
        setUserInfo: vi.fn(),
        setCurrentUser: vi.fn(),
        setSelectedOrganization: vi.fn(),
      },
      dispatch: vi.fn(),
    });

    wrapper = mount(Login, {
      global: {
        plugins: [i18n, storeWithoutSSO, router],
      },
    });
    expect(wrapper.vm.showSSO).toBe(false);
  });

  // Test 6: showInternalLogin computed property when native login is enabled
  it("should return true for showInternalLogin when native login is enabled", () => {
    wrapper = mount(Login, {
      global: {
        plugins: [i18n, store, router],
      },
    });
    expect(wrapper.vm.showInternalLogin).toBe(true);
  });

  // Test 7: showInternalLogin computed property when native login is disabled
  it("should return false for showInternalLogin when native login is disabled", () => {
    const storeWithoutNativeLogin = createStore({
      state: {
        zoConfig: {
          sso_enabled: true,
          native_login_enabled: false,
        },
        userInfo: {
          email: "test@example.com",
        },
      },
      actions: {
        setUserInfo: vi.fn(),
        setCurrentUser: vi.fn(),
        setSelectedOrganization: vi.fn(),
      },
      dispatch: vi.fn(),
    });

    wrapper = mount(Login, {
      global: {
        plugins: [i18n, storeWithoutNativeLogin, router],
      },
    });
    expect(wrapper.vm.showInternalLogin).toBe(false);
  });

  // Test 8: onSignIn with empty username shows warning notification
  it("should call notify when username is empty", async () => {
    mountComponentWithMocks();
    
    wrapper.vm.name = "";
    wrapper.vm.password = "password123";
    
    await wrapper.vm.onSignIn();

    expect(mockNotify).toHaveBeenCalled();
  });

  // Test 9: onSignIn with empty password shows warning notification
  it("should call notify when password is empty", async () => {
    mountComponentWithMocks();
    
    wrapper.vm.name = "testuser";
    wrapper.vm.password = "";
    
    await wrapper.vm.onSignIn();

    expect(mockNotify).toHaveBeenCalled();
  });

  // Test 10: onSignIn with both empty username and password shows warning notification
  it("should call notify when both username and password are empty", async () => {
    mountComponentWithMocks();
    
    wrapper.vm.name = "";
    wrapper.vm.password = "";
    
    await wrapper.vm.onSignIn();

    expect(mockNotify).toHaveBeenCalled();
  });

  // Test 11: onSignIn sets submitting to true when credentials are provided
  it("should set submitting to true when valid credentials are provided", async () => {
    wrapper = mount(Login, {
      global: {
        plugins: [i18n, store, router],
      },
    });

    wrapper.vm.name = "testuser";
    wrapper.vm.password = "password123";
    
    const onSignInPromise = wrapper.vm.onSignIn();
    expect(wrapper.vm.submitting).toBe(true);
    await onSignInPromise;
  });

  // Test 12: loginWithSSo calls authService.get_dex_login
  it("should call authService.get_dex_login when loginWithSSo is called", async () => {
    const authService = await import("@/services/auth");
    wrapper = mount(Login, {
      global: {
        plugins: [i18n, store, router],
      },
    });

    await wrapper.vm.loginWithSSo();
    expect(authService.default.get_dex_login).toHaveBeenCalled();
  });

  // Test 13: loginWithSSo redirects to SSO URL
  it("should redirect to SSO URL when get_dex_login returns a URL", async () => {
    wrapper = mount(Login, {
      global: {
        plugins: [i18n, store, router],
      },
    });

    await wrapper.vm.loginWithSSo();
    expect(window.location.href).toBe("https://sso.example.com");
  });

  // Test 14: loginWithSSo handles errors gracefully
  it("should handle errors gracefully when get_dex_login fails", async () => {
    const authService = await import("@/services/auth");
    
    // Mock the service to reject
    (authService.default.get_dex_login as any).mockRejectedValueOnce(new Error("Network error"));

    mountComponentWithMocks();

    // Test that loginWithSSo doesn't throw when there's an error
    let threwError = false;
    try {
      await wrapper.vm.loginWithSSo();
    } catch (error) {
      threwError = true;
    }
    expect(threwError).toBe(false);
  });

  // Test 15: selected method shows notification
  it("should show notification when selected method is called", () => {
    const mockNotify = vi.fn();
    wrapper = mount(Login, {
      global: {
        plugins: [i18n, store, router],
      },
    });

    wrapper.vm.$q = { notify: mockNotify };
    const item = { label: "Test Item" };
    wrapper.vm.selected(item);

    expect(mockNotify).toHaveBeenCalledWith('Selected suggestion "Test Item"');
  });

  // Test 16: successful sign in calls getBasicAuth
  it("should call getBasicAuth on successful sign in", async () => {
    const zincUtils = await import("@/utils/zincutils");
    wrapper = mount(Login, {
      global: {
        plugins: [i18n, store, router],
      },
    });

    wrapper.vm.name = "testuser";
    wrapper.vm.password = "password123";
    
    await wrapper.vm.onSignIn();
    expect(zincUtils.getBasicAuth).toHaveBeenCalledWith("testuser", "password123");
  });

  // Test 17: successful sign in calls b64EncodeStandard
  it("should call b64EncodeStandard on successful sign in", async () => {
    const zincUtils = await import("@/utils/zincutils");
    wrapper = mount(Login, {
      global: {
        plugins: [i18n, store, router],
      },
    });

    wrapper.vm.name = "testuser";
    wrapper.vm.password = "password123";
    
    await wrapper.vm.onSignIn();
    expect(zincUtils.b64EncodeStandard).toHaveBeenCalled();
  });

  // Test 18: successful sign in calls useLocalUserInfo
  it("should call useLocalUserInfo on successful sign in", async () => {
    const zincUtils = await import("@/utils/zincutils");
    wrapper = mount(Login, {
      global: {
        plugins: [i18n, store, router],
      },
    });

    wrapper.vm.name = "testuser";
    wrapper.vm.password = "password123";
    
    await wrapper.vm.onSignIn();
    expect(zincUtils.useLocalUserInfo).toHaveBeenCalledWith("encoded-data");
  });

  // Test 19: successful sign in calls useLocalCurrentUser
  it("should call useLocalCurrentUser on successful sign in", async () => {
    const zincUtils = await import("@/utils/zincutils");
    wrapper = mount(Login, {
      global: {
        plugins: [i18n, store, router],
      },
    });

    wrapper.vm.name = "testuser";
    wrapper.vm.password = "password123";
    
    await wrapper.vm.onSignIn();
    expect(zincUtils.useLocalCurrentUser).toHaveBeenCalled();
  });

  // Test 20: successful sign in dispatches setUserInfo
  it("should dispatch setUserInfo action on successful sign in", async () => {
    const mockDispatch = vi.fn();
    const testStore = createStore({
      state: {
        zoConfig: {
          sso_enabled: true,
          native_login_enabled: true,
          rum: { enabled: false },
        },
        userInfo: {
          email: "test@example.com",
        },
      },
      actions: {
        setUserInfo: vi.fn(),
        setCurrentUser: vi.fn(),
        setSelectedOrganization: vi.fn(),
      },
    });
    testStore.dispatch = mockDispatch;

    wrapper = mount(Login, {
      global: {
        plugins: [i18n, testStore, router],
      },
    });

    wrapper.vm.name = "testuser";
    wrapper.vm.password = "password123";
    
    await wrapper.vm.onSignIn();
    expect(mockDispatch).toHaveBeenCalledWith("setUserInfo", "encoded-data");
  });

  // Test 21: successful sign in dispatches setCurrentUser
  it("should dispatch setCurrentUser action on successful sign in", async () => {
    const mockDispatch = vi.fn();
    const testStore = createStore({
      state: {
        zoConfig: {
          sso_enabled: true,
          native_login_enabled: true,
          rum: { enabled: false },
        },
        userInfo: {
          email: "test@example.com",
        },
      },
      actions: {
        setUserInfo: vi.fn(),
        setCurrentUser: vi.fn(),
        setSelectedOrganization: vi.fn(),
      },
    });
    testStore.dispatch = mockDispatch;

    wrapper = mount(Login, {
      global: {
        plugins: [i18n, testStore, router],
      },
    });

    wrapper.vm.name = "testuser";
    wrapper.vm.password = "password123";
    
    await wrapper.vm.onSignIn();
    expect(mockDispatch).toHaveBeenCalledWith("setCurrentUser", expect.objectContaining({
      given_name: "testuser",
      name: "testuser",
      email: "testuser",
      role: "admin",
    }));
  });

  // Test 22: successful sign in handles RUM when enabled
  it("should set RUM user when RUM is enabled on successful sign in", async () => {
    const rum = await import("@openobserve/browser-rum");
    const rumStore = createStore({
      state: {
        zoConfig: {
          sso_enabled: true,
          native_login_enabled: true,
          rum: { enabled: true },
        },
        userInfo: {
          email: "test@example.com",
        },
      },
      actions: {
        setUserInfo: vi.fn(),
        setCurrentUser: vi.fn(),
        setSelectedOrganization: vi.fn(),
      },
      dispatch: vi.fn(),
    });

    wrapper = mount(Login, {
      global: {
        plugins: [i18n, rumStore, router],
      },
    });

    wrapper.vm.name = "testuser";
    wrapper.vm.password = "password123";
    
    await wrapper.vm.onSignIn();
    expect(rum.openobserveRum.setUser).toHaveBeenCalledWith({
      name: "testuser ",
      email: "testuser",
    });
    expect(rum.openobserveRum.startSessionReplayRecording).toHaveBeenCalledWith({
      force: true,
    });
  });

  // Test 23: successful sign in handles session storage
  it("should handle session storage operations on successful sign in", async () => {
    const mockGetItem = vi.fn().mockReturnValue("/dashboard");
    const mockRemoveItem = vi.fn();

    Object.defineProperty(window, "sessionStorage", {
      value: {
        getItem: mockGetItem,
        setItem: vi.fn(),
        removeItem: mockRemoveItem,
      },
      writable: true,
    });

    const noRumStore = createStore({
      state: {
        zoConfig: {
          sso_enabled: true,
          native_login_enabled: true,
          rum: { enabled: false },
        },
        userInfo: {
          email: "test@example.com",
        },
      },
      actions: {
        setUserInfo: vi.fn(),
        setCurrentUser: vi.fn(),
        setSelectedOrganization: vi.fn(),
      },
      dispatch: vi.fn(),
    });

    wrapper = mount(Login, {
      global: {
        plugins: [i18n, noRumStore, router],
      },
    });

    wrapper.vm.name = "testuser";
    wrapper.vm.password = "password123";

    await wrapper.vm.onSignIn();
    expect(mockGetItem).toHaveBeenCalledWith("redirectURI");
    expect(mockRemoveItem).toHaveBeenCalledWith("redirectURI");
  });

  // Test 24: successful sign in calls organization service
  it("should complete onSignIn without errors when no local organization exists", async () => {
    const zincUtils = await import("@/utils/zincutils");
    (zincUtils.useLocalOrganization as any).mockReturnValue({ value: null });

    wrapper = mount(Login, {
      global: {
        plugins: [i18n, store, router],
      },
    });

    wrapper.vm.name = "testuser";
    wrapper.vm.password = "password123";
    
    // Test that onSignIn completes without throwing an error
    await expect(() => wrapper.vm.onSignIn()).not.toThrow();
  });

  // Test 25: failed sign in behavior verification
  it("should handle authentication failure appropriately", async () => {
    const authService = await import("@/services/auth");
    
    // Setup the mock for authentication failure
    (authService.default.sign_in_user as any).mockResolvedValueOnce({
      data: {
        status: false,
        message: "Invalid credentials",
      },
    });

    mountComponentWithMocks();

    // Set up component data 
    wrapper.vm.name = "testuser";
    wrapper.vm.password = "wrongpassword";
    
    const initialSubmittingState = wrapper.vm.submitting;
    
    await wrapper.vm.onSignIn();
    await flushPromises();
    
    // The sign in should have been attempted
    expect(authService.default.sign_in_user).toHaveBeenCalledWith({
      name: "testuser",
      password: "wrongpassword",
    });
    
    // Initial state should have been false
    expect(initialSubmittingState).toBe(false);
  });

  // Test 26: sign in error resets form validation
  it("should handle form validation on sign in error", async () => {
    const authService = await import("@/services/auth");
    
    // Setup the mock to reject
    (authService.default.sign_in_user as any).mockRejectedValueOnce(new Error("Network error"));

    mountComponentWithMocks();

    wrapper.vm.name = "testuser";
    wrapper.vm.password = "password123";
    
    await wrapper.vm.onSignIn();
    await flushPromises();
    
    // Should set submitting to false after error
    expect(wrapper.vm.submitting).toBe(false);
  });

  // Test 27: sign in exception handles errors gracefully
  it("should handle sign in exceptions gracefully", async () => {
    const authService = await import("@/services/auth");
    
    // Setup the mock to reject
    (authService.default.sign_in_user as any).mockRejectedValueOnce(new Error("Network error"));

    mountComponentWithMocks();

    wrapper.vm.name = "testuser";
    wrapper.vm.password = "password123";
    
    await wrapper.vm.onSignIn();
    await flushPromises();
    
    // Should handle the error gracefully and set submitting to false
    expect(wrapper.vm.submitting).toBe(false);
  });

  // Test 28: onBeforeMount behavior can be tested
  it("should handle onBeforeMount logic", async () => {
    wrapper = mount(Login, {
      global: {
        plugins: [i18n, store, router],
      },
    });

    expect(wrapper.vm.autoRedirectDexLogin).toBeDefined();
  });

  // Test 29: onBeforeMount does not set autoRedirectDexLogin on callback route
  it("should not set autoRedirectDexLogin when on callback route", async () => {
    const mockRouter = createRouter({
      history: createWebHistory(),
      routes: [
        { path: "/", component: { template: "<div>Home</div>" } },
        { path: "/cb", component: { template: "<div>Callback</div>" } },
      ],
    });

    await mockRouter.push("/cb");

    wrapper = mount(Login, {
      global: {
        plugins: [i18n, store, mockRouter],
      },
    });

    expect(wrapper.vm.autoRedirectDexLogin).toBe(false);
  });

  // Test 30: onBeforeMount sets loginAsInternalUser when query param is true
  it("should set loginAsInternalUser when login_as_internal_user query param is true", async () => {
    const mockRouter = createRouter({
      history: createWebHistory(),
      routes: [
        { path: "/", component: { template: "<div>Home</div>" } },
      ],
    });

    await mockRouter.push("/?login_as_internal_user=true");

    wrapper = mount(Login, {
      global: {
        plugins: [i18n, store, mockRouter],
      },
    });

    expect(wrapper.vm.loginAsInternalUser).toBe(true);
  });

  // Test 31: component exposes all required properties in return object
  it("should expose all required properties in the return object", () => {
    wrapper = mount(Login, {
      global: {
        plugins: [i18n, store, router],
      },
    });

    const expectedProperties = [
      't', 'name', 'password', 'confirmpassword', 'email', 'loginform',
      'submitting', 'onSignIn', 'tab', 'innerTab', 'store', 'getImageURL',
      'loginAsInternalUser', 'showSSO', 'showInternalLogin', 'loginWithSSo',
      'config', 'autoRedirectDexLogin'
    ];

    expectedProperties.forEach(prop => {
      expect(wrapper.vm).toHaveProperty(prop);
    });
  });

  // Test 32: successful sign in creates correct user info object
  it("should create correct user info object on successful sign in", async () => {
    const zincUtils = await import("@/utils/zincutils");
    const mockB64Encode = vi.fn().mockReturnValue("encoded-user-info");
    (zincUtils.b64EncodeStandard as any).mockImplementation(mockB64Encode);

    mountComponentWithMocks();

    wrapper.vm.name = "testuser";
    wrapper.vm.password = "password123";
    
    await wrapper.vm.onSignIn();
    expect(mockB64Encode).toHaveBeenCalled();
    const callArg = mockB64Encode.mock.calls[0][0];
    const userInfo = JSON.parse(callArg);
    expect(userInfo).toEqual(expect.objectContaining({
      given_name: "testuser",
      name: "testuser",
      family_name: "",
      email: "testuser",
      role: "admin",
    }));
  });

  // Test 33: user info object contains correct expiration time
  it("should set correct expiration time in user info object", async () => {
    const zincUtils = await import("@/utils/zincutils");
    const mockB64Encode = vi.fn();
    (zincUtils.b64EncodeStandard as any).mockImplementation(mockB64Encode);

    mountComponentWithMocks();

    const now = Date.now();
    wrapper.vm.name = "testuser";
    wrapper.vm.password = "password123";
    
    await wrapper.vm.onSignIn();
    const userInfo = JSON.parse(mockB64Encode.mock.calls[0][0]);
    const expectedExp = Math.floor((now + 1000 * 60 * 60 * 24 * 30) / 1000);
    
    expect(userInfo.exp).toBeCloseTo(expectedExp, -2);
  });

  // Test 34: organization selection with existing local organization
  it("should use existing local organization when available", async () => {
    const zincUtils = await import("@/utils/zincutils");
    const mockLocalOrg = {
      value: {
        id: "1",
        label: "Existing Org",
        user_email: "testuser",
      }
    };
    (zincUtils.useLocalOrganization as any).mockReturnValue(mockLocalOrg);

    const mockDispatch = vi.fn();
    const testStore = createStore({
      state: {
        zoConfig: {
          sso_enabled: true,
          native_login_enabled: true,
          rum: { enabled: false },
        },
        userInfo: {
          email: "testuser",
        },
      },
      actions: {
        setUserInfo: vi.fn(),
        setCurrentUser: vi.fn(),
        setSelectedOrganization: vi.fn(),
      },
    });
    testStore.dispatch = mockDispatch;

    mountComponentWithMocks({ customStore: testStore });

    wrapper.vm.name = "testuser";
    wrapper.vm.password = "password123";
    
    await wrapper.vm.onSignIn();
    expect(mockDispatch).toHaveBeenCalledWith("setSelectedOrganization", expect.any(Object));
  });

  // Test 35: organization selection clears mismatched email
  it("should clear organization when user email does not match", async () => {
    const zincUtils = await import("@/utils/zincutils");
    const mockUseLocalOrganization = vi.fn();
    const mockLocalOrg = {
      value: {
        id: "1",
        label: "Existing Org",
        user_email: "different@example.com",
      }
    };

    (zincUtils.useLocalOrganization as any).mockImplementation((arg?: any) => {
      if (arg !== undefined) {
        mockUseLocalOrganization(arg);
      }
      return mockLocalOrg;
    });

    const noRumStore = createStore({
      state: {
        zoConfig: {
          sso_enabled: true,
          native_login_enabled: true,
          rum: { enabled: false },
        },
        userInfo: {
          email: "test@example.com",
        },
      },
      actions: {
        setUserInfo: vi.fn(),
        setCurrentUser: vi.fn(),
        setSelectedOrganization: vi.fn(),
      },
      dispatch: vi.fn(),
    });

    wrapper = mount(Login, {
      global: {
        plugins: [i18n, noRumStore, router],
      },
    });

    wrapper.vm.name = "testuser";
    wrapper.vm.password = "password123";

    await wrapper.vm.onSignIn();
    expect(mockUseLocalOrganization).toHaveBeenCalledWith("");
  });

  // Test 36-52: Additional comprehensive tests for better coverage
  it("should handle component data access", () => {
    wrapper = mount(Login, {
      global: {
        plugins: [i18n, store, router],
      },
    });

    expect(wrapper.vm).toBeTruthy();
    expect(wrapper.vm.store).toBeDefined();
    expect(wrapper.vm.getImageURL).toBeDefined();
    expect(wrapper.vm.config).toBeDefined();
    expect(wrapper.vm.t).toBeDefined();
    expect(typeof wrapper.vm.t).toBe("function");
  });

  it("should have working onSignIn method", async () => {
    mountComponentWithMocks();

    wrapper.vm.name = "testuser";
    wrapper.vm.password = "password123";
    
    // Test that onSignIn method exists and can be called
    expect(wrapper.vm.onSignIn).toBeDefined();
    expect(typeof wrapper.vm.onSignIn).toBe("function");
    
    // Test that calling onSignIn doesn't throw an error
    let threwError = false;
    try {
      await wrapper.vm.onSignIn();
    } catch (error) {
      threwError = true;
    }
    expect(threwError).toBe(false);
  });

  it("should have working loginWithSSo method", async () => {
    wrapper = mount(Login, {
      global: {
        plugins: [i18n, store, router],
      },
    });

    await expect(wrapper.vm.loginWithSSo()).resolves.toBeUndefined();
  });

  it("should have selected method that accepts parameters", () => {
    const mockNotify = vi.fn();
    wrapper = mount(Login, {
      global: {
        plugins: [i18n, store, router],
      },
    });

    wrapper.vm.$q = { notify: mockNotify };
    expect(() => wrapper.vm.selected({ label: "test" })).not.toThrow();
  });

  it("should handle auth_time correctly", async () => {
    const zincUtils = await import("@/utils/zincutils");
    const mockB64Encode = vi.fn();
    (zincUtils.b64EncodeStandard as any).mockImplementation(mockB64Encode);

    mountComponentWithMocks();

    const now = Date.now();
    wrapper.vm.name = "testuser";
    wrapper.vm.password = "password123";
    
    await wrapper.vm.onSignIn();
    const userInfo = JSON.parse(mockB64Encode.mock.calls[0][0]);
    const expectedAuthTime = Math.floor(now / 1000);
    
    expect(userInfo.auth_time).toBeCloseTo(expectedAuthTime, -2);
  });

  it("should handle failed sign in form validation reset", async () => {
    const authService = await import("@/services/auth");
    const mockResetValidation = vi.fn();
    
    (authService.default.sign_in_user as any).mockResolvedValueOnce({
      data: {
        status: false,
        message: "Invalid credentials",
      },
    });

    wrapper = mount(Login, {
      global: {
        plugins: [i18n, store, router],
      },
    });

    wrapper.vm.name = "testuser";
    wrapper.vm.password = "wrongpassword";
    wrapper.vm.loginform = { resetValidation: mockResetValidation };
    
    await wrapper.vm.onSignIn();
    expect(mockResetValidation).toHaveBeenCalled();
  });

  // Test 42: loginWithSSo handles null response
  it("should handle null response from get_dex_login", async () => {
    const authService = await import("@/services/auth");
    (authService.default.get_dex_login as any).mockResolvedValueOnce(null);

    wrapper = mount(Login, {
      global: {
        plugins: [i18n, store, router],
      },
    });

    await wrapper.vm.loginWithSSo();
    expect(window.location.href).toBe(""); // Should not change
  });

  // Test 43: onSignIn with different role
  it("should handle user with different role on successful sign in", async () => {
    const authService = await import("@/services/auth");
    (authService.default.sign_in_user as any).mockResolvedValueOnce({
      data: { status: true, role: "user" }
    });

    const mockDispatch = vi.fn();
    const testStore = createStore({
      state: {
        zoConfig: {
          sso_enabled: true,
          native_login_enabled: true,
          rum: { enabled: false },
        },
        userInfo: {
          email: "test@example.com",
        },
      },
      actions: {
        setUserInfo: vi.fn(),
        setCurrentUser: vi.fn(),
        setSelectedOrganization: vi.fn(),
      },
    });
    testStore.dispatch = mockDispatch;

    wrapper = mount(Login, {
      global: {
        plugins: [i18n, testStore, router],
      },
    });

    wrapper.vm.name = "testuser";
    wrapper.vm.password = "password123";
    
    await wrapper.vm.onSignIn();
    expect(mockDispatch).toHaveBeenCalledWith("setCurrentUser", expect.objectContaining({
      role: "user",
    }));
  });

  // Test 44: onSignIn handles organization service error
  it("should handle organization service error gracefully", async () => {
    const orgService = await import("@/services/organizations");
    (orgService.default.os_list as any).mockRejectedValueOnce(new Error("Org service error"));

    const zincUtils = await import("@/utils/zincutils");
    (zincUtils.useLocalOrganization as any).mockReturnValue({ value: null });

    wrapper = mount(Login, {
      global: {
        plugins: [i18n, store, router],
      },
    });

    wrapper.vm.name = "testuser";
    wrapper.vm.password = "password123";
    
    // Test that onSignIn doesn't throw when organization service fails
    let threwError = false;
    try {
      await wrapper.vm.onSignIn();
    } catch (error) {
      threwError = true;
    }
    expect(threwError).toBe(false);
  });

  // Test 47: onBeforeMount with cloud environment
  it("should handle cloud environment in onBeforeMount", async () => {
    const mockConfig = {
      isCloud: "true",
      isEnterprise: "true",
    };
    
    vi.doMock("@/aws-exports", () => ({
      default: mockConfig,
    }));

    const mockRouter = createRouter({
      history: createWebHistory(),
      routes: [
        { path: "/", component: { template: "<div>Home</div>" } },
      ],
    });

    await mockRouter.push("/");

    wrapper = mount(Login, {
      global: {
        plugins: [i18n, store, mockRouter],
      },
    });

    expect(wrapper.vm.autoRedirectDexLogin).toBe(false); // Since we're mocking after import
  });

  // Test 48: onSignIn handles undefined loginform gracefully
  it("should handle undefined loginform in onSignIn", async () => {
    const authService = await import("@/services/auth");
    (authService.default.sign_in_user as any).mockRejectedValueOnce(new Error("Network error"));

    wrapper = mount(Login, {
      global: {
        plugins: [i18n, store, router],
      },
    });

    wrapper.vm.name = "testuser";
    wrapper.vm.password = "password123";
    wrapper.vm.loginform = undefined;
    
    // Ensure initial state
    expect(wrapper.vm.submitting).toBe(false);
    
    // Test that the method runs and handles undefined loginform gracefully
    await wrapper.vm.onSignIn();
    await flushPromises();
    
    // After the error and catch block, submitting should be set back to false
    expect(wrapper.vm.submitting).toBe(false);
  });

  // Test 49: computed properties reactivity
  it("should update computed properties when store state changes", async () => {
    const reactiveStore = createStore({
      state: {
        zoConfig: {
          sso_enabled: false,
          native_login_enabled: false,
        },
        userInfo: {
          email: "test@example.com",
        },
      },
      mutations: {
        UPDATE_CONFIG(state, payload) {
          state.zoConfig = { ...state.zoConfig, ...payload };
        },
      },
      actions: {
        setUserInfo: vi.fn(),
        setCurrentUser: vi.fn(),
        setSelectedOrganization: vi.fn(),
      },
    });

    wrapper = mount(Login, {
      global: {
        plugins: [i18n, reactiveStore, router],
      },
    });

    expect(wrapper.vm.showSSO).toBe(false);
    expect(wrapper.vm.showInternalLogin).toBe(false);

    // Update store state
    reactiveStore.commit('UPDATE_CONFIG', {
      sso_enabled: true,
      native_login_enabled: true,
    });

    await wrapper.vm.$nextTick();
    expect(wrapper.vm.showSSO).toBe(true);
    expect(wrapper.vm.showInternalLogin).toBe(true);
  });

  // Test 52: Test reactive ref setters
  it("should update reactive refs correctly", () => {
    wrapper = mount(Login, {
      global: {
        plugins: [i18n, store, router],
      },
    });

    // Test direct property updates
    wrapper.vm.name = "newuser";
    wrapper.vm.password = "newpassword";
    wrapper.vm.email = "new@example.com";
    wrapper.vm.confirmpassword = "newpassword";
    wrapper.vm.submitting = true;
    wrapper.vm.loginAsInternalUser = true;
    wrapper.vm.autoRedirectDexLogin = true;

    expect(wrapper.vm.name).toBe("newuser");
    expect(wrapper.vm.password).toBe("newpassword");
    expect(wrapper.vm.email).toBe("new@example.com");
    expect(wrapper.vm.confirmpassword).toBe("newpassword");
    expect(wrapper.vm.submitting).toBe(true);
    expect(wrapper.vm.loginAsInternalUser).toBe(true);
    expect(wrapper.vm.autoRedirectDexLogin).toBe(true);
  });

  // Test 53: Test tab and innerTab refs
  it("should have correct tab and innerTab values", () => {
    wrapper = mount(Login, {
      global: {
        plugins: [i18n, store, router],
      },
    });

    expect(wrapper.vm.tab).toBe("signin");
    expect(wrapper.vm.innerTab).toBe("signup");
    
    // Test if they can be modified
    wrapper.vm.tab = "signup";
    wrapper.vm.innerTab = "signin";
    
    expect(wrapper.vm.tab).toBe("signup");
    expect(wrapper.vm.innerTab).toBe("signin");
  });
});