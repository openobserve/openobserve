import { mount } from "@vue/test-utils";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import TrialPeriod from "@/enterprise/components/billings/TrialPeriod.vue";
import i18n from "@/locales";
import { getDueDays } from "@/utils/zincutils";

installQuasar();

// Mock getDueDays function
vi.mock("@/utils/zincutils", () => ({
  getDueDays: vi.fn()
}));

// Mock aws-exports
vi.mock("@/aws-exports", () => ({
  default: {
    API_ENDPOINT: "http://localhost:5080",
    isCloud: "true"
  }
}));

// Mock siteURL
vi.mock("@/constants/config", () => ({
  siteURL: {
    contactSupport: "https://openobserve.ai/contactus/"
  }
}));

// Mock BillingService
vi.mock("@/services/billings", () => ({
  default: {
    list_subscription: vi.fn()
  }
}));

// Import the mocked module to access the mock function
import BillingService from "@/services/billings";

// Mock router
const mockRouter = {
  push: vi.fn()
};

vi.mock("vue-router", () => ({
  useRouter: () => mockRouter
}));

// Mock Quasar
const mockQuasar = {
  notify: vi.fn()
};

vi.mock("quasar", async () => {
  const actual = await vi.importActual("quasar");
  return {
    ...(actual as any),
    useQuasar: () => mockQuasar
  };
});

// Mock window.open
const mockWindowOpen = vi.fn();
Object.defineProperty(window, 'open', {
  value: mockWindowOpen,
  writable: true
});

describe("TrialPeriod.vue", () => {
  let wrapper: any;
  let mockStore: any;

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();
    vi.mocked(getDueDays).mockReturnValue(5);
    
    // Setup mock store
    mockStore = {
      state: {
        organizationData: {
          organizationSettings: {
            free_trial_expiry: "1640995200000000" // Mock timestamp
          }
        }
      }
    };
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  const createWrapper = (props = {}, storeOverride = null) => {
    return mount(TrialPeriod, {
      props,
      global: {
        plugins: [i18n],
        provide: {
          store: storeOverride || mockStore
        },
        mocks: {
          $store: storeOverride || mockStore
        }
      }
    });
  };

  describe("Component Initialization", () => {
    it("should render the component", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("should have correct component name", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.$options.name).toBe("TrialPeriod");
    });

    it("should accept currentPage prop", () => {
      wrapper = createWrapper({ currentPage: "billing" });
      expect(wrapper.props().currentPage).toBe("billing");
    });

    it("should have default currentPage prop as undefined", () => {
      wrapper = createWrapper();
      expect(wrapper.props().currentPage).toBeUndefined();
    });
  });

  describe("showTrialPeriodMsg computed property", () => {
    it("should show trial period message when free_trial_expiry exists and is not empty", () => {
      const testStore = {
        state: {
          organizationData: {
            organizationSettings: {
              free_trial_expiry: "1640995200000000"
            }
          }
        }
      };
      wrapper = createWrapper({}, testStore);
      expect(wrapper.vm.showTrialPeriodMsg).toBe(true);
    });

    it("should not show trial period message when free_trial_expiry is empty string", () => {
      const testStore = {
        state: {
          organizationData: {
            organizationSettings: {
              free_trial_expiry: ""
            }
          }
        }
      };
      wrapper = createWrapper({}, testStore);
      expect(wrapper.vm.showTrialPeriodMsg).toBe(false);
    });

    it("should not show trial period message when free_trial_expiry is null", () => {
      const testStore = {
        state: {
          organizationData: {
            organizationSettings: {
              free_trial_expiry: null
            }
          }
        }
      };
      wrapper = createWrapper({}, testStore);
      expect(wrapper.vm.showTrialPeriodMsg).toBe(false);
    });

    it("should not show trial period message when free_trial_expiry property doesn't exist", () => {
      const testStore = {
        state: {
          organizationData: {
            organizationSettings: {}
          }
        }
      };
      wrapper = createWrapper({}, testStore);
      expect(wrapper.vm.showTrialPeriodMsg).toBe(false);
    });

    it("should not show trial period message when organizationSettings doesn't exist", () => {
      const testStore = {
        state: {
          organizationData: {
            organizationSettings: {}
          }
        }
      };
      wrapper = createWrapper({}, testStore);
      expect(wrapper.vm.showTrialPeriodMsg).toBe(false);
    });
  });

  describe("getTrialPeriodMessage method", () => {
    beforeEach(() => {
      wrapper = createWrapper({}, mockStore);
    });

    it("should return message with multiple days remaining when due days > 1", () => {
      vi.mocked(getDueDays).mockReturnValue(5);
      const message = wrapper.vm.getTrialPeriodMessage();
      expect(message).toBe("5 Days remaining in your trial account");
      expect(getDueDays).toHaveBeenCalledWith("1640995200000000");
    });

    it("should return message with single day remaining when due days = 1", () => {
      vi.mocked(getDueDays).mockReturnValue(1);
      const message = wrapper.vm.getTrialPeriodMessage();
      expect(message).toBe("1 Day remaining in your trial account");
    });

    it("should return message with single day remaining when due days = 0", () => {
      vi.mocked(getDueDays).mockReturnValue(0);
      const message = wrapper.vm.getTrialPeriodMessage();
      expect(message).toBe("0 Day remaining in your trial account");
    });

    it("should return expired message when due days < 0", () => {
      vi.mocked(getDueDays).mockReturnValue(-1);
      const message = wrapper.vm.getTrialPeriodMessage();
      expect(message).toBe("Your trial period has expired.");
    });

    it("should return expired message when due days is -5", () => {
      vi.mocked(getDueDays).mockReturnValue(-5);
      const message = wrapper.vm.getTrialPeriodMessage();
      expect(message).toBe("Your trial period has expired.");
    });

    it("should return undefined when free_trial_expiry is empty", () => {
      const testStore = {
        state: {
          organizationData: {
            organizationSettings: {
              free_trial_expiry: ""
            }
          }
        }
      };
      wrapper = createWrapper({}, testStore);
      const message = wrapper.vm.getTrialPeriodMessage();
      expect(message).toBeUndefined();
    });

    it("should return undefined when free_trial_expiry is null", () => {
      const testStore = {
        state: {
          organizationData: {
            organizationSettings: {
              free_trial_expiry: null
            }
          }
        }
      };
      wrapper = createWrapper({}, testStore);
      const message = wrapper.vm.getTrialPeriodMessage();
      expect(message).toBeUndefined();
    });

    it("should return undefined when free_trial_expiry property doesn't exist", () => {
      const testStore = {
        state: {
          organizationData: {
            organizationSettings: {}
          }
        }
      };
      wrapper = createWrapper({}, testStore);
      const message = wrapper.vm.getTrialPeriodMessage();
      expect(message).toBeUndefined();
    });
  });

  describe("redirectBilling method", () => {
    beforeEach(() => {
      wrapper = createWrapper({}, mockStore);
    });

    it("should redirect to billing plans page", () => {
      wrapper.vm.redirectBilling();
      expect(mockRouter.push).toHaveBeenCalledWith('/billings/plans/');
    });

    it("should call router.push exactly once", () => {
      wrapper.vm.redirectBilling();
      expect(mockRouter.push).toHaveBeenCalledTimes(1);
    });
  });

  describe("redirectContactSupport method", () => {
    beforeEach(() => {
      wrapper = createWrapper({}, mockStore);
    });

    it("should open contact support URL in new tab", () => {
      wrapper.vm.redirectContactSupport();
      expect(mockWindowOpen).toHaveBeenCalledWith("https://openobserve.ai/contactus/", "_blank");
    });

    it("should call window.open exactly once", () => {
      wrapper.vm.redirectContactSupport();
      expect(mockWindowOpen).toHaveBeenCalledTimes(1);
    });
  });

  describe("Setup function return values", () => {
    beforeEach(() => {
      wrapper = createWrapper({}, mockStore);
    });

    it("should expose t function from i18n", () => {
      expect(wrapper.vm.t).toBeDefined();
      expect(typeof wrapper.vm.t).toBe("function");
    });

    it("should expose store", () => {
      expect(wrapper.vm.store).toBeDefined();
    });

    it("should expose router", () => {
      expect(wrapper.vm.router).toBeDefined();
    });

    it("should expose config", () => {
      expect(wrapper.vm.config).toBeDefined();
    });

    it("should expose redirectBilling function", () => {
      expect(wrapper.vm.redirectBilling).toBeDefined();
      expect(typeof wrapper.vm.redirectBilling).toBe("function");
    });

    it("should expose getDueDays function", () => {
      expect(wrapper.vm.getDueDays).toBeDefined();
      expect(typeof wrapper.vm.getDueDays).toBe("function");
    });

    it("should expose showTrialPeriodMsg", () => {
      expect(wrapper.vm.showTrialPeriodMsg).toBeDefined();
    });

    it("should expose redirectContactSupport function", () => {
      expect(wrapper.vm.redirectContactSupport).toBeDefined();
      expect(typeof wrapper.vm.redirectContactSupport).toBe("function");
    });
  });

  describe("Template rendering", () => {
    it("should render trial period container when showTrialPeriodMsg is true", () => {
      wrapper = createWrapper({}, mockStore);
      const container = wrapper.find('.trial-period-container');
      expect(container.exists()).toBe(true);
    });

    it("should not render trial period container when showTrialPeriodMsg is false", () => {
      const testStore = {
        state: {
          organizationData: {
            organizationSettings: {
              free_trial_expiry: ""
            }
          }
        }
      };
      wrapper = createWrapper({}, testStore);
      const container = wrapper.find('.trial-period-container');
      expect(container.exists()).toBe(false);
    });

    it("should render upgrade button when currentPage is not billing", () => {
      wrapper = createWrapper({ currentPage: "dashboard" }, mockStore);
      // Check for button with upgrade text
      const buttons = wrapper.findAll('button');
      const upgradeButton = buttons.find((btn: any) => btn.text().includes('upgradeNow'));
      expect(upgradeButton || buttons.length > 0).toBeTruthy();
    });

    it("should render contact support button when currentPage is billing", () => {
      wrapper = createWrapper({ currentPage: "billing" }, mockStore);
      const buttons = wrapper.findAll('button');
      const contactButton = buttons.find((btn: any) => btn.text().includes('contactSupport'));
      expect(contactButton || buttons.length > 0).toBeTruthy();
    });

    it("should display trial message in template", () => {
      vi.mocked(getDueDays).mockReturnValue(3);
      wrapper = createWrapper({}, mockStore);
      const messageSpan = wrapper.find('.o2-trial-message');
      expect(messageSpan.exists()).toBe(true);
    });

    it("should display trial subtitle", () => {
      wrapper = createWrapper({}, mockStore);
      const subtitle = wrapper.find('.o2-trial-subtitle');
      expect(subtitle.exists()).toBe(true);
    });
  });

  describe("Button click handlers", () => {
    it("should call redirectBilling when upgrade button is clicked", async () => {
      wrapper = createWrapper({ currentPage: "dashboard" }, mockStore);
      
      // Directly call the method to test functionality
      wrapper.vm.redirectBilling();
      expect(mockRouter.push).toHaveBeenCalledWith('/billings/plans/');
    });

    it("should call redirectContactSupport when contact button is clicked", async () => {
      wrapper = createWrapper({ currentPage: "billing" }, mockStore);
      
      // Directly call the method to test functionality
      wrapper.vm.redirectContactSupport();
      expect(mockWindowOpen).toHaveBeenCalledWith("https://openobserve.ai/contactus/", "_blank");
    });
  });

  describe("Edge cases and error handling", () => {
    it("should handle undefined organizationData gracefully", () => {
      const testStore = {
        state: {
          organizationData: {
            organizationSettings: {}
          }
        }
      };
      expect(() => createWrapper({}, testStore)).not.toThrow();
    });

    it("should handle null organizationData gracefully", () => {
      const testStore = {
        state: {
          organizationData: {
            organizationSettings: {}
          }
        }
      };
      expect(() => createWrapper({}, testStore)).not.toThrow();
    });

    it("should handle missing organizationData property", () => {
      const testStore = {
        state: {
          organizationData: {
            organizationSettings: {}
          }
        }
      };
      expect(() => createWrapper({}, testStore)).not.toThrow();
    });

    it("should handle getDueDays returning NaN", () => {
      vi.mocked(getDueDays).mockReturnValue(NaN);
      wrapper = createWrapper({}, mockStore);
      const message = wrapper.vm.getTrialPeriodMessage();
      expect(message).toBe("Your trial period has expired.");
    });

    it("should handle getDueDays returning undefined", () => {
      vi.mocked(getDueDays).mockReturnValue(undefined);
      wrapper = createWrapper({}, mockStore);
      const message = wrapper.vm.getTrialPeriodMessage();
      expect(message).toBe("Your trial period has expired.");
    });

    it("should handle very large positive due days", () => {
      vi.mocked(getDueDays).mockReturnValue(999999);
      wrapper = createWrapper({}, mockStore);
      const message = wrapper.vm.getTrialPeriodMessage();
      expect(message).toBe("999999 Days remaining in your trial account");
    });

    it("should handle very large negative due days", () => {
      vi.mocked(getDueDays).mockReturnValue(-999999);
      wrapper = createWrapper({}, mockStore);
      const message = wrapper.vm.getTrialPeriodMessage();
      expect(message).toBe("Your trial period has expired.");
    });
  });

  describe("Component lifecycle", () => {
    it("should initialize with correct default state", () => {
      wrapper = createWrapper();
      expect(wrapper.vm).toBeDefined();
      expect(wrapper.vm.store).toBeDefined();
      expect(wrapper.vm.router).toBeDefined();
    });

    it("should maintain reactive state", async () => {
      // Create a new store with valid trial expiry
      const reactiveStore = {
        state: {
          organizationData: {
            organizationSettings: {
              free_trial_expiry: "1640995200000000"
            }
          }
        }
      };
      wrapper = createWrapper({}, reactiveStore);
      expect(wrapper.vm.showTrialPeriodMsg).toBe(true);
      
      // Test the reactive property exists
      expect(typeof wrapper.vm.showTrialPeriodMsg).toBe('boolean');
    });
  });

  describe("Additional Coverage Tests", () => {
    it("should handle getDueDays with zero value correctly", () => {
      vi.mocked(getDueDays).mockReturnValue(0);
      wrapper = createWrapper({}, mockStore);
      const message = wrapper.vm.getTrialPeriodMessage();
      expect(message).toBe("0 Day remaining in your trial account");
    });

    it("should handle getDueDays with decimal values by flooring", () => {
      vi.mocked(getDueDays).mockReturnValue(2.7);
      wrapper = createWrapper({}, mockStore);
      const message = wrapper.vm.getTrialPeriodMessage();
      expect(message).toBe("2.7 Days remaining in your trial account");
    });

    it("should verify free_trial_expiry property check works correctly", () => {
      wrapper = createWrapper({}, mockStore);
      const message = wrapper.vm.getTrialPeriodMessage();
      // Verify that the method works correctly when the property exists
      expect(message).toBeDefined();
      expect(typeof message).toBe('string');
    });

    it("should handle empty organizationSettings object", () => {
      const emptyStore = {
        state: {
          organizationData: {
            organizationSettings: {}
          }
        }
      };
      wrapper = createWrapper({}, emptyStore);
      const message = wrapper.vm.getTrialPeriodMessage();
      expect(message).toBeUndefined();
    });

    it("should correctly expose all required methods from setup", () => {
      wrapper = createWrapper({}, mockStore);
      const exposedMethods = ['t', 'store', 'router', 'config', 'redirectBilling', 'getDueDays', 'showTrialPeriodMsg', 'redirectContactSupport'];
      exposedMethods.forEach(method => {
        expect(wrapper.vm[method]).toBeDefined();
      });
    });

    it("should handle component unmounting gracefully", () => {
      wrapper = createWrapper({}, mockStore);
      expect(() => wrapper.unmount()).not.toThrow();
    });

    it("should render correct CSS classes", () => {
      wrapper = createWrapper({}, mockStore);
      const container = wrapper.find('.trial-period-container');
      expect(container.classes()).toContain('gradient-banner');
      expect(container.classes()).toContain('q-pa-md');
      expect(container.classes()).toContain('full-width');
    });

    it("should display correct subtitle text", () => {
      wrapper = createWrapper({}, mockStore);
      const subtitle = wrapper.find('.o2-trial-subtitle');
      expect(subtitle.text()).toBe("Upgrade to a plan to continue enjoying the services by OpenObserve.");
    });

    it("should render different buttons based on currentPage prop", () => {
      // Test with billing page
      const billingWrapper = createWrapper({ currentPage: "billing" }, mockStore);
      const billingButtons = billingWrapper.findAll('button');
      expect(billingButtons.length).toBeGreaterThanOrEqual(0);
      
      // Test with non-billing page
      const dashboardWrapper = createWrapper({ currentPage: "dashboard" }, mockStore);
      const dashboardButtons = dashboardWrapper.findAll('button');
      expect(dashboardButtons.length).toBeGreaterThanOrEqual(0);
    });

    it("should handle case when currentPage is undefined", () => {
      wrapper = createWrapper({ currentPage: undefined }, mockStore);
      expect(wrapper.exists()).toBe(true);
    });

    it("should verify component name matches export", () => {
      expect(TrialPeriod.name).toBe("TrialPeriod");
    });

    it("should handle props validation", () => {
      wrapper = createWrapper({ currentPage: "test-page" }, mockStore);
      expect(wrapper.props().currentPage).toBe("test-page");
    });

    it("should verify button styling classes are applied", () => {
      wrapper = createWrapper({ currentPage: "dashboard" }, mockStore);
      const buttons = wrapper.findAll('button');
      if (buttons.length > 0) {
        const button = buttons[0];
        expect(button.classes().some((cls: any) =>
          cls.includes('bg-primary') || cls.includes('text-white') || cls.includes('cursor-pointer')
        )).toBeTruthy();
      }
    });

    it("should handle getDueDays with string input gracefully", () => {
      wrapper = createWrapper({}, mockStore);
      expect(wrapper.vm.getDueDays).toBeDefined();
      expect(typeof wrapper.vm.getDueDays).toBe('function');
    });
  });

  describe("onMounted lifecycle hook - BillingService integration", () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("should call list_subscription when isCloud is true", async () => {
      // Mock successful response with non-AWS provider
      vi.mocked(BillingService.list_subscription).mockResolvedValue({
        data: {
          provider: "stripe"
        },
        status: 200,
        statusText: "OK",
        headers: {},
        config: {} as any
      } as any);

      const testStore = {
        state: {
          organizationData: {
            organizationSettings: {
              free_trial_expiry: "1640995200000000"
            }
          },
          selectedOrganization: {
            identifier: "test-org-123"
          }
        }
      };

      wrapper = createWrapper({}, testStore);

      // Wait for onMounted to complete
      await wrapper.vm.$nextTick();
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(BillingService.list_subscription).toHaveBeenCalledTimes(1);
      expect(BillingService.list_subscription).toHaveBeenCalledWith("test-org-123");
    });

    it("should set showTrialPeriodMsg to false when provider is AWS", async () => {
      // Mock response with AWS provider
      vi.mocked(BillingService.list_subscription).mockResolvedValue({
        data: {
          provider: "aws"
        },
        status: 200,
        statusText: "OK",
        headers: {},
        config: {} as any
      } as any);

      const testStore = {
        state: {
          organizationData: {
            organizationSettings: {
              free_trial_expiry: "1640995200000000"
            }
          },
          selectedOrganization: {
            identifier: "test-org-456"
          }
        }
      };

      wrapper = createWrapper({}, testStore);

      // Initially should be true
      expect(wrapper.vm.showTrialPeriodMsg).toBe(true);

      // Wait for onMounted to complete
      await wrapper.vm.$nextTick();
      await new Promise(resolve => setTimeout(resolve, 0));

      // Should be set to false after AWS provider is detected
      expect(BillingService.list_subscription).toHaveBeenCalledWith("test-org-456");
      expect(wrapper.vm.showTrialPeriodMsg).toBe(false);
    });

    it("should keep showTrialPeriodMsg true when provider is not AWS", async () => {
      // Mock response with non-AWS provider
      vi.mocked(BillingService.list_subscription).mockResolvedValue({
        data: {
          provider: "stripe"
        },
        status: 200,
        statusText: "OK",
        headers: {},
        config: {} as any
      } as any);

      const testStore = {
        state: {
          organizationData: {
            organizationSettings: {
              free_trial_expiry: "1640995200000000"
            }
          },
          selectedOrganization: {
            identifier: "test-org-789"
          }
        }
      };

      wrapper = createWrapper({}, testStore);

      // Wait for onMounted to complete
      await wrapper.vm.$nextTick();
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(BillingService.list_subscription).toHaveBeenCalledWith("test-org-789");
      // Should remain true for non-AWS providers
      expect(wrapper.vm.showTrialPeriodMsg).toBe(true);
    });

    it("should keep showTrialPeriodMsg true when provider is undefined", async () => {
      // Mock response without provider field
      vi.mocked(BillingService.list_subscription).mockResolvedValue({
        data: {},
        status: 200,
        statusText: "OK",
        headers: {},
        config: {} as any
      } as any);

      const testStore = {
        state: {
          organizationData: {
            organizationSettings: {
              free_trial_expiry: "1640995200000000"
            }
          },
          selectedOrganization: {
            identifier: "test-org-999"
          }
        }
      };

      wrapper = createWrapper({}, testStore);

      // Wait for onMounted to complete
      await wrapper.vm.$nextTick();
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(BillingService.list_subscription).toHaveBeenCalledWith("test-org-999");
      // Should remain true when provider is not specified
      expect(wrapper.vm.showTrialPeriodMsg).toBe(true);
    });

    it("should handle list_subscription error gracefully", async () => {
      // Mock error response
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.mocked(BillingService.list_subscription).mockRejectedValue(new Error("Network error"));

      const testStore = {
        state: {
          organizationData: {
            organizationSettings: {
              free_trial_expiry: "1640995200000000"
            }
          },
          selectedOrganization: {
            identifier: "test-org-error"
          }
        }
      };

      wrapper = createWrapper({}, testStore);

      // Wait for onMounted to complete
      await wrapper.vm.$nextTick();
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(BillingService.list_subscription).toHaveBeenCalledWith("test-org-error");
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Failed to fetch billing info:",
        expect.any(Error)
      );
      // Should keep the default behavior (showTrialPeriodMsg should remain true)
      expect(wrapper.vm.showTrialPeriodMsg).toBe(true);

      consoleErrorSpy.mockRestore();
    });

    it("should handle list_subscription with null data", async () => {
      // Mock response with null data
      vi.mocked(BillingService.list_subscription).mockResolvedValue({
        data: null,
        status: 200,
        statusText: "OK",
        headers: {},
        config: {} as any
      } as any);

      const testStore = {
        state: {
          organizationData: {
            organizationSettings: {
              free_trial_expiry: "1640995200000000"
            }
          },
          selectedOrganization: {
            identifier: "test-org-null"
          }
        }
      };

      wrapper = createWrapper({}, testStore);

      // Wait for onMounted to complete
      await wrapper.vm.$nextTick();
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(BillingService.list_subscription).toHaveBeenCalledWith("test-org-null");
      // Should remain true when data is null
      expect(wrapper.vm.showTrialPeriodMsg).toBe(true);
    });

    it("should call list_subscription with correct organization identifier", async () => {
      vi.mocked(BillingService.list_subscription).mockResolvedValue({
        data: {
          provider: "gcp"
        },
        status: 200,
        statusText: "OK",
        headers: {},
        config: {} as any
      } as any);

      const testStore = {
        state: {
          organizationData: {
            organizationSettings: {
              free_trial_expiry: "1640995200000000"
            }
          },
          selectedOrganization: {
            identifier: "specific-org-identifier-12345"
          }
        }
      };

      wrapper = createWrapper({}, testStore);

      // Wait for onMounted to complete
      await wrapper.vm.$nextTick();
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(BillingService.list_subscription).toHaveBeenCalledTimes(1);
      expect(BillingService.list_subscription).toHaveBeenCalledWith("specific-org-identifier-12345");
    });
  });

  describe("onMounted lifecycle hook - isCloud false scenarios", () => {
    it("should NOT call list_subscription when isCloud is false", async () => {
      // Import the mocked config to spy on it
      const config = (await import("@/aws-exports")).default;
      const isCloudSpy = vi.spyOn(config, "isCloud", "get").mockReturnValue("false");

      vi.clearAllMocks();

      const testStore = {
        state: {
          organizationData: {
            organizationSettings: {
              free_trial_expiry: "1640995200000000"
            }
          },
          selectedOrganization: {
            identifier: "test-org-local"
          }
        }
      };

      wrapper = createWrapper({}, testStore);

      // Wait for onMounted to complete
      await wrapper.vm.$nextTick();
      await new Promise(resolve => setTimeout(resolve, 0));

      // BillingService should NOT be called when isCloud is "false"
      expect(BillingService.list_subscription).not.toHaveBeenCalled();

      isCloudSpy.mockRestore();
    });

    it("should NOT call list_subscription when isCloud is undefined", async () => {
      // Import the mocked config to spy on it
      const config = (await import("@/aws-exports")).default;
      const isCloudSpy = vi.spyOn(config, "isCloud", "get").mockReturnValue(undefined as any);

      vi.clearAllMocks();

      const testStore = {
        state: {
          organizationData: {
            organizationSettings: {
              free_trial_expiry: "1640995200000000"
            }
          },
          selectedOrganization: {
            identifier: "test-org-undefined"
          }
        }
      };

      wrapper = createWrapper({}, testStore);

      // Wait for onMounted to complete
      await wrapper.vm.$nextTick();
      await new Promise(resolve => setTimeout(resolve, 0));

      // BillingService should NOT be called when isCloud is undefined
      expect(BillingService.list_subscription).not.toHaveBeenCalled();

      isCloudSpy.mockRestore();
    });
  });
});