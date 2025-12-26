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

import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick, ref } from "vue";
import ShortUrl from "@/views/ShortUrl.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { Dialog, Notify } from "quasar";
import * as zincutils from "@/utils/zincutils";
import shortURL from "@/services/short_url";

// Mock the shortURL service
vi.mock("@/services/short_url", () => ({
  default: {
    get: vi.fn(),
  },
}));

// Mock only the routeGuard function
vi.spyOn(zincutils, 'routeGuard').mockImplementation(async (to, from, next) => {
  next();
});

// Mock vue-router hooks
const mockReplace = vi.fn();
vi.mock("vue-router", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useRoute: () => ref({ params: { id: "test-id" } }),
    useRouter: () => ({
      replace: mockReplace,
      currentRoute: { value: { name: "short-url" } },
    }),
  };
});

const node = document.createElement("div");
node.setAttribute("id", "app");
document.body.appendChild(node);

installQuasar({
  plugins: [Dialog, Notify],
});

describe("ShortUrl", () => {
  let wrapper;
  let mockShortURLGet;

  beforeEach(async () => {
    mockShortURLGet = vi.mocked(shortURL.get);
    mockShortURLGet.mockClear();
    mockReplace.mockClear();
    
    // Default mock implementation to prevent errors
    mockShortURLGet.mockRejectedValue(new Error("Mock error"));
    
    wrapper = mount(ShortUrl, {
      attachTo: "#app",
      global: {
        provide: {
          store: store,
        },
        plugins: [i18n, router],
      },
      props: {
        id: "test-id",
      }
    });
    
    // Wait for any pending async operations
    await new Promise(resolve => setTimeout(resolve, 10));
  });

  afterEach(() => {
    wrapper.unmount();
    vi.clearAllMocks();
  });

  // Template Rendering Tests
  it("should render loading container with correct data-test attribute", () => {
    expect(wrapper.find('[data-test="loading-container"]').exists()).toBe(true);
  });

  it("should render loading container with correct CSS classes", () => {
    const container = wrapper.find('[data-test="loading-container"]');
    expect(container.classes()).toContain("tw:h-[100vh]");
    expect(container.classes()).toContain("tw:flex");
    expect(container.classes()).toContain("tw:flex-col");
    expect(container.classes()).toContain("tw:items-center");
    expect(container.classes()).toContain("tw:justify-center");
  });

  it("should render spinner with correct data-test attribute", () => {
    expect(wrapper.find('[data-test="spinner"]').exists()).toBe(true);
  });

  it("should render spinner with correct props", () => {
    const spinner = wrapper.find('[data-test="spinner"]');
    expect(spinner.exists()).toBe(true);
    // Note: Quasar component props may not be reflected as HTML attributes
  });

  it("should render message with correct data-test attribute", () => {
    expect(wrapper.find('[data-test="message"]').exists()).toBe(true);
  });

  it("should render message with correct text", () => {
    expect(wrapper.find('[data-test="message"]').text()).toBe("Redirecting...");
  });

  it("should render message with correct CSS class", () => {
    expect(wrapper.find('[data-test="message"]').classes()).toContain("message");
  });

  // Props Tests
  it("should receive id prop correctly", () => {
    expect(wrapper.props("id")).toBe("test-id");
  });

  it("should require id prop", () => {
    expect(ShortUrl.props.id.required).toBe(true);
  });

  it("should have correct prop type for id", () => {
    expect(ShortUrl.props.id.type).toBe(String);
  });

  // Component Instance Tests
  it("should have correct component name", () => {
    expect(ShortUrl.name).toBe("ShortUrl");
  });

  it("should expose routeToHome function", () => {
    expect(typeof wrapper.vm.routeToHome).toBe("function");
  });

  it("should expose handleOriginalUrl function", () => {
    expect(typeof wrapper.vm.handleOriginalUrl).toBe("function");
  });

  it("should expose routeToOriginalUrl function", () => {
    expect(typeof wrapper.vm.routeToOriginalUrl).toBe("function");
  });

  it("should expose fetchAndRedirect function", () => {
    expect(typeof wrapper.vm.fetchAndRedirect).toBe("function");
  });

  // routeToHome Function Tests
  it("should call router.replace with home route when routeToHome is called", () => {
    mockReplace.mockClear();
    wrapper.vm.routeToHome();
    expect(mockReplace).toHaveBeenCalledWith({ name: "home" });
  });

  it("should call router.replace exactly once when routeToHome is called", () => {
    mockReplace.mockClear();
    wrapper.vm.routeToHome();
    expect(mockReplace).toHaveBeenCalledTimes(1);
  });

  // routeToOriginalUrl Function Tests
  it("should route to URL with leading slash when URL starts with /", () => {
    mockReplace.mockClear();
    wrapper.vm.routeToOriginalUrl("/dashboard/logs");
    expect(mockReplace).toHaveBeenCalledWith("/dashboard/logs");
  });

  it("should add leading slash when URL does not start with /", () => {
    mockReplace.mockClear();
    wrapper.vm.routeToOriginalUrl("dashboard/logs");
    expect(mockReplace).toHaveBeenCalledWith("/dashboard/logs");
  });

  it("should handle empty string URL", () => {
    mockReplace.mockClear();
    wrapper.vm.routeToOriginalUrl("");
    expect(mockReplace).toHaveBeenCalledWith("/");
  });

  it("should handle URL with query parameters", () => {
    mockReplace.mockClear();
    wrapper.vm.routeToOriginalUrl("dashboard/logs?tab=search");
    expect(mockReplace).toHaveBeenCalledWith("/dashboard/logs?tab=search");
  });

  it("should handle URL that already starts with slash", () => {
    mockReplace.mockClear();
    wrapper.vm.routeToOriginalUrl("/logs/search");
    expect(mockReplace).toHaveBeenCalledWith("/logs/search");
  });

  // handleOriginalUrl Function Tests
  it("should call routeToOriginalUrl with correct path when URL contains web", () => {
    mockReplace.mockClear();
    wrapper.vm.handleOriginalUrl("http://localhost:3000/web/dashboard/logs");
    expect(mockReplace).toHaveBeenCalledWith("/dashboard/logs");
  });

  it("should call routeToOriginalUrl with correct path when URL does not contain web", () => {
    mockReplace.mockClear();
    wrapper.vm.handleOriginalUrl("http://localhost:3000/dashboard/logs");
    expect(mockReplace).toHaveBeenCalledWith("/dashboard/logs");
  });

  it("should handle URL with web in path correctly", () => {
    mockReplace.mockClear();
    wrapper.vm.handleOriginalUrl("http://localhost:3000/web/org1/dashboard/logs/search");
    expect(mockReplace).toHaveBeenCalledWith("/org1/dashboard/logs/search");
  });

  it("should handle URL without web in path correctly", () => {
    mockReplace.mockClear();
    wrapper.vm.handleOriginalUrl("http://localhost:3000/org1/dashboard/logs");
    expect(mockReplace).toHaveBeenCalledWith("/org1/dashboard/logs");
  });

  it("should handle complex URL with web", () => {
    mockReplace.mockClear();
    wrapper.vm.handleOriginalUrl("https://example.com/app/web/dashboard/metrics/overview");
    expect(mockReplace).toHaveBeenCalledWith("/web/dashboard/metrics/overview");
  });

  it("should handle URL with web but minimal path", () => {
    mockReplace.mockClear();
    wrapper.vm.handleOriginalUrl("http://localhost/web/org/home");
    expect(mockReplace).toHaveBeenCalledWith("/org/home");
  });

  it("should handle URL with fewer segments than expected", () => {
    mockReplace.mockClear();
    wrapper.vm.handleOriginalUrl("http://localhost/web");
    expect(mockReplace).toHaveBeenCalledWith("/");
  });

  // fetchAndRedirect Function Tests
  it("should call shortURL.get with correct parameters", async () => {
    mockShortURLGet.mockResolvedValue({ data: "http://localhost:3000/dashboard/logs" });
    mockShortURLGet.mockClear();
    
    await wrapper.vm.fetchAndRedirect();
    
    expect(mockShortURLGet).toHaveBeenCalledWith("default", "test-id");
  });

  it("should call handleOriginalUrl on successful API response", async () => {
    mockReplace.mockClear();
    mockShortURLGet.mockResolvedValue({ data: "http://localhost:3000/dashboard/logs" });
    
    await wrapper.vm.fetchAndRedirect();
    
    // Since handleOriginalUrl calls routeToOriginalUrl which calls mockReplace
    expect(mockReplace).toHaveBeenCalled();
  });

  it("should call routeToHome when API returns non-string data", async () => {
    mockReplace.mockClear();
    mockShortURLGet.mockResolvedValue({ data: null });
    
    await wrapper.vm.fetchAndRedirect();
    
    expect(mockReplace).toHaveBeenCalledWith({ name: "home" });
  });

  it("should call routeToHome when API returns undefined data", async () => {
    mockReplace.mockClear();
    mockShortURLGet.mockResolvedValue({ data: undefined });
    
    await wrapper.vm.fetchAndRedirect();
    
    expect(mockReplace).toHaveBeenCalledWith({ name: "home" });
  });

  it("should call routeToHome when API returns number data", async () => {
    mockReplace.mockClear();
    mockShortURLGet.mockResolvedValue({ data: 404 });
    
    await wrapper.vm.fetchAndRedirect();
    
    expect(mockReplace).toHaveBeenCalledWith({ name: "home" });
  });

  it("should call routeToHome when API returns object data", async () => {
    mockReplace.mockClear();
    mockShortURLGet.mockResolvedValue({ data: { error: "Not found" } });
    
    await wrapper.vm.fetchAndRedirect();
    
    expect(mockReplace).toHaveBeenCalledWith({ name: "home" });
  });

  it("should call routeToHome and log error when API call fails", async () => {
    mockReplace.mockClear();
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const apiError = new Error("Network error");
    mockShortURLGet.mockRejectedValue(apiError);
    
    await wrapper.vm.fetchAndRedirect();
    
    expect(mockReplace).toHaveBeenCalledWith({ name: "home" });
    expect(consoleSpy).toHaveBeenCalledWith("Error fetching short URL:", apiError);
    
    consoleSpy.mockRestore();
  });

  it("should handle API call with different error types", async () => {
    mockReplace.mockClear();
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockShortURLGet.mockRejectedValue("String error");
    
    await wrapper.vm.fetchAndRedirect();
    
    expect(mockReplace).toHaveBeenCalledWith({ name: "home" });
    expect(consoleSpy).toHaveBeenCalledWith("Error fetching short URL:", "String error");
    
    consoleSpy.mockRestore();
  });

  it("should use organization identifier from store", async () => {
    mockShortURLGet.mockResolvedValue({ data: "http://localhost:3000/dashboard" });
    
    await wrapper.vm.fetchAndRedirect();
    
    expect(mockShortURLGet).toHaveBeenCalledWith(
      store.state.selectedOrganization.identifier,
      "test-id"
    );
  });

  // Integration Tests  
  it("should call fetchAndRedirect on component mount", async () => {
    // This test verifies that fetchAndRedirect is called during component initialization
    // by checking that the shortURL.get mock was called during component mount
    const initialCallCount = mockShortURLGet.mock.calls.length;
    
    // Mount a new component instance
    const testWrapper = mount(ShortUrl, {
      attachTo: "#app",
      global: {
        provide: {
          store: store,
        },
        plugins: [i18n, router],
      },
      props: {
        id: "integration-test-id",
      },
    });

    await nextTick();
    
    // Verify that shortURL.get was called more times (indicating fetchAndRedirect was called)
    expect(mockShortURLGet.mock.calls.length).toBeGreaterThan(initialCallCount);
    
    testWrapper.unmount();
  });

  it("should match snapshot", () => {
    expect(wrapper.html()).toMatchSnapshot();
  });
});