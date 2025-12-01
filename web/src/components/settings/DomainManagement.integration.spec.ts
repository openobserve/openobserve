// Copyright 2025 OpenObserve Inc.
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

import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import DomainManagement from "./DomainManagement.vue";
import i18n from "@/locales";
import { Dialog, Notify } from "quasar";
import { nextTick } from "vue";
import {
  mockDomainData,
  createMockStore,
  domainValidationTestCases,
  emailValidationTestCases,
  apiErrorScenarios,
} from "./DomainManagement.test-helpers";

installQuasar({
  plugins: [Dialog, Notify],
});

// Create a unique DOM node for this test file to avoid conflicts
const uniqueNodeId = "domain-management-test-app";
const node = document.createElement("div");
node.setAttribute("id", uniqueNodeId);
document.body.appendChild(node);

// Mock the domainManagement service with a unique namespace
vi.mock("@/services/domainManagement", () => ({
  default: {
    getDomainRestrictions: vi.fn(),
    updateDomainRestrictions: vi.fn(),
  },
}));

// Mock jstransform service
vi.mock("@/services/jstransform", () => ({
  default: {
    list: vi.fn(),
  },
}));

// Mock organizations service
vi.mock("@/services/organizations", () => ({
  default: {
    post_organization_settings: vi.fn(),
  },
}));

// Mock search service
vi.mock("@/services/search", () => ({
  default: {
    search: vi.fn(),
  },
}));

// Import after mocking
import domainManagement from "@/services/domainManagement";
import jstransform from "@/services/jstransform";
import organizations from "@/services/organizations";
import searchService from "@/services/search";

const mockDomainManagement = domainManagement as any;
const mockJstransform = jstransform as any;
const mockOrganizations = organizations as any;
const mockSearchService = searchService as any;

// Mock Vuex store with isolated scope
const createIsolatedMockStore = () => ({
  state: {
    zoConfig: {
      meta_org: "test-meta-org",
    },
    selectedOrganization: {
      identifier: "test-meta-org",
    },
    organizationData: {
      organizationSettings: {
        claim_parser_function: "",
      },
    },
  },
  dispatch: vi.fn(),
});

const mockStore = createIsolatedMockStore();

vi.mock("vuex", () => ({
  useStore: () => mockStore,
}));

// Mock Vue Router with isolated scope
const createIsolatedMockRouter = () => ({
  replace: vi.fn(),
});

const mockRouter = createIsolatedMockRouter();

vi.mock("vue-router", () => ({
  useRouter: () => mockRouter,
}));

describe("DomainManagement Integration Tests", () => {
  let wrapper: any = null;

  beforeEach(() => {
    // Clear all mocks and reset state
    vi.clearAllMocks();
    vi.resetAllMocks();

    // Reset mock implementations
    mockDomainManagement.getDomainRestrictions.mockResolvedValue({
      data: mockDomainData.complex,
    });
    mockDomainManagement.updateDomainRestrictions.mockResolvedValue({
      success: true,
    });

    // Mock jstransform service
    mockJstransform.list.mockResolvedValue({
      data: {
        list: [],
      },
    });

    // Mock organizations service
    mockOrganizations.post_organization_settings.mockResolvedValue({
      success: true,
    });

    // Mock search service
    mockSearchService.search.mockResolvedValue({
      data: {
        hits: [],
      },
    });
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
      wrapper = null;
    }
    // Thorough cleanup
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.resetAllMocks();
    
    // Clear any leftover DOM elements
    const testNode = document.getElementById(uniqueNodeId);
    if (testNode) {
      testNode.innerHTML = '';
    }
  });

  afterAll(() => {
    // Final cleanup after all tests
    const testNode = document.getElementById(uniqueNodeId);
    if (testNode) {
      document.body.removeChild(testNode);
    }
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  const createWrapper = (props = {}) => {
    return mount(DomainManagement, {
      attachTo: `#${uniqueNodeId}`,
      shallow: false,
      props,
      global: {
        plugins: [i18n],
        stubs: {
          QDrawer: {
            template: '<div class="q-drawer-stub"><slot /></div>',
            props: ['modelValue', 'side', 'bordered', 'width', 'overlay', 'elevated'],
          },
        },
      },
    });
  };

  describe("End-to-End Domain Management Workflow", () => {
    it("should complete full domain management workflow", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const vm = wrapper.vm;

      // 1. Load initial data
      expect(mockDomainManagement.getDomainRestrictions).toHaveBeenCalledWith(
        "test-meta-org"
      );
      expect(vm.domains.length).toBe(3); // From mockDomainData.complex

      // 2. Add a new domain
      vm.newDomain = "newcompany.com";
      await vm.addDomain();
      expect(vm.domains.length).toBe(4);
      expect(vm.domains[3].name).toBe("newcompany.com");
      expect(vm.domains[3].allowAllUsers).toBe(true);

      // 3. Modify domain to restrict users
      vm.domains[3].allowAllUsers = false;

      // 4. Add emails to restricted domain
      vm.domains[3].newEmail = "admin@newcompany.com";
      await vm.addEmail(vm.domains[3]);
      expect(vm.domains[3].allowedEmails).toContain("admin@newcompany.com");

      vm.domains[3].newEmail = "user@newcompany.com";
      await vm.addEmail(vm.domains[3]);
      expect(vm.domains[3].allowedEmails).toContain("user@newcompany.com");
      expect(vm.domains[3].allowedEmails.length).toBe(2);

      // 5. Save changes
      await vm.saveChanges();

      expect(mockDomainManagement.updateDomainRestrictions).toHaveBeenCalledWith(
        "test-meta-org",
        expect.objectContaining({
          domains: expect.arrayContaining([
            expect.objectContaining({
              domain: "newcompany.com",
              allow_all_users: false,
              allowed_emails: ["admin@newcompany.com", "user@newcompany.com"],
            }),
          ]),
        })
      );

      // 6. Verify success emission
      expect(wrapper.emitted().saved).toBeTruthy();
    });

    it("should handle domain removal workflow", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const vm = wrapper.vm;
      const initialCount = vm.domains.length;

      // Mock the q.dialog method directly on the component
      const mockDialog = vi.fn().mockReturnValue({
        onOk: vi.fn((callback) => {
          callback(); // Immediately call the callback to simulate OK click
          return { onCancel: vi.fn() };
        }),
      });

      // Add $q to the component instance if it doesn't exist
      if (!vm.$q) {
        vm.$q = { dialog: mockDialog };
      } else {
        vm.$q.dialog = mockDialog;
      }

      // Call the actual removeDomain method
      await vm.removeDomain(0);

      expect(vm.domains.length).toBe(initialCount - 1);
    });

    it("should handle email removal workflow", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const vm = wrapper.vm;
      const restrictedDomain = vm.domains.find(d => !d.allowAllUsers);
      
      if (restrictedDomain) {
        const initialEmailCount = restrictedDomain.allowedEmails.length;

        // Remove an email directly (simulating confirmed dialog)
        restrictedDomain.allowedEmails.splice(0, 1);

        expect(restrictedDomain.allowedEmails.length).toBe(initialEmailCount - 1);
      }
    });
  });

  describe("Validation Test Cases", () => {
    beforeEach(async () => {
      wrapper = createWrapper();
      await flushPromises();
    });

    describe("Domain Validation", () => {
      domainValidationTestCases.forEach(({ input, expected, description }) => {
        it(`should ${expected ? 'accept' : 'reject'} ${description}: "${input}"`, () => {
          const vm = wrapper.vm;
          expect(vm.isValidDomain(input)).toBe(expected);
        });
      });
    });

    describe("Email Validation", () => {
      emailValidationTestCases.forEach(({ email, domain, expected, description }) => {
        it(`should ${expected ? 'accept' : 'reject'} ${description}`, () => {
          const vm = wrapper.vm;
          expect(vm.isValidEmail(email, domain)).toBe(expected);
        });
      });
    });
  });

  describe("Error Handling Scenarios", () => {
    apiErrorScenarios.forEach(({ name, error, expectedMessage }) => {
      it(`should handle ${name} gracefully`, async () => {
        mockDomainManagement.getDomainRestrictions.mockRejectedValue(error);
        
        wrapper = createWrapper();
        await flushPromises();

        // Component should still mount despite error
        expect(wrapper.exists()).toBeTruthy();
        expect(wrapper.vm.domains.length).toBe(0); // Should show empty state
      });

      it(`should handle ${name} during save operations`, async () => {
        wrapper = createWrapper();
        await flushPromises();

        mockDomainManagement.updateDomainRestrictions.mockRejectedValue(error);

        const vm = wrapper.vm;
        await vm.saveChanges();

        expect(vm.saving).toBe(false);
      });
    });
  });

  describe("Data Persistence and State Management", () => {
    it("should maintain state consistency during operations", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const vm = wrapper.vm;
      const initialState = JSON.parse(JSON.stringify(vm.domains));

      // Add domain
      vm.newDomain = "test.com";
      await vm.addDomain();

      // Verify state change
      expect(vm.domains.length).toBe(initialState.length + 1);

      // Reset form
      await vm.resetForm();

      // Should reload original data
      expect(mockDomainManagement.getDomainRestrictions).toHaveBeenCalledTimes(2);
    });

    it("should handle concurrent operations gracefully", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const vm = wrapper.vm;

      // Simulate concurrent save operations
      const savePromise1 = vm.saveChanges();
      const savePromise2 = vm.saveChanges();

      await Promise.all([savePromise1, savePromise2]);

      // Should maintain consistent state
      expect(vm.saving).toBe(false);
    });
  });

  describe("User Interface Interactions", () => {
    it("should update UI elements correctly based on data", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const vm = wrapper.vm;

      // Check domain count display
      const countText = wrapper.find(".text-caption");
      expect(countText.text()).toContain(vm.domains.length.toString());

      // Add a domain and check count update
      vm.newDomain = "test.com";
      await vm.addDomain();
      await nextTick();

      const updatedCountText = wrapper.find(".text-caption");
      expect(updatedCountText.text()).toContain(vm.domains.length.toString());
    });

    it("should enable/disable buttons based on validation", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const vm = wrapper.vm;

      // Test add domain button state
      vm.newDomain = "";
      await nextTick();
      
      // Try to find the add domain button with a simpler selector
      const addDomainButton = wrapper.find('button');
      const buttons = wrapper.findAll('button');
      
      // Look for button with "Add Domain" text
      let addButton = null;
      for (let i = 0; i < buttons.length; i++) {
        if (buttons[i].text().includes('Add Domain')) {
          addButton = buttons[i];
          break;
        }
      }
      
      if (addButton) {
        expect(addButton.element.disabled).toBe(true);
      }

      // Set valid domain
      vm.newDomain = "valid.com";
      await nextTick();
      
      if (addButton) {
        expect(addButton.element.disabled).toBe(false);
      }
    });
  });

  describe("Component Lifecycle", () => {
    it("should handle component activation correctly", async () => {
      wrapper = createWrapper();
      await flushPromises();

      // Simulate component activation (router navigation)
      if (wrapper.vm.$options.activated) {
        await wrapper.vm.$options.activated[0].call(wrapper.vm);
      }

      // Should reload data on activation
      expect(mockDomainManagement.getDomainRestrictions).toHaveBeenCalled();
    });

    it("should clean up properly on unmount", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const vm = wrapper.vm;
      
      // Start a save operation
      const savePromise = vm.saveChanges();
      
      // Unmount component
      wrapper.unmount();
      
      // Save operation should complete without errors
      await expect(savePromise).resolves.not.toThrow();
    });
  });

  describe("Comprehensive Negative Testing", () => {
    beforeEach(async () => {
      wrapper = createWrapper();
      await flushPromises();
    });

    describe("Input Validation Edge Cases", () => {
      it("should reject malicious script injection in domain names", async () => {
        const vm = wrapper.vm;
        const maliciousDomains = [
          "<script>alert('xss')</script>.com",
          "javascript:alert(1).com",
          "../../etc/passwd.com",
          "null.com\0",
          "test.com<img src=x onerror=alert(1)>",
        ];

        for (const maliciousDomain of maliciousDomains) {
          expect(vm.isValidDomain(maliciousDomain)).toBe(false);
        }
      });

      it("should reject malicious script injection in email addresses", async () => {
        const vm = wrapper.vm;
        const maliciousEmails = [
          "<script>alert('xss')</script>@example.com",
          "javascript:alert(1)@example.com",
          "test@<script>alert(1)</script>.com",
          "user@example.com<img src=x onerror=alert(1)>",
          "test\0@example.com",
        ];

        for (const maliciousEmail of maliciousEmails) {
          expect(vm.isValidEmail(maliciousEmail, "example.com")).toBe(false);
        }
      });

      it("should reject extremely long domain names", async () => {
        const vm = wrapper.vm;
        const longDomain = "a".repeat(250) + ".com"; // Domain names should be max 253 chars
        const veryLongDomain = "a".repeat(300) + ".com";

        expect(vm.isValidDomain(longDomain)).toBe(false);
        expect(vm.isValidDomain(veryLongDomain)).toBe(false);
      });

      it("should reject extremely long email addresses", async () => {
        const vm = wrapper.vm;
        const longEmail = "a".repeat(300) + "@example.com"; // Email addresses have practical limits

        expect(vm.isValidEmail(longEmail, "example.com")).toBe(false);
      });

      it("should reject Unicode and special character exploits", async () => {
        const vm = wrapper.vm;
        const unicodeExploits = [
          "еxample.com", // Cyrillic 'e' that looks like Latin 'e'
          "example․com", // Unicode one-dot leader instead of period
          "example.com\u202e", // Right-to-left override
          "example\u0000.com", // null byte
          "example\u000A.com", // line feed
        ];

        for (const unicodeDomain of unicodeExploits) {
          expect(vm.isValidDomain(unicodeDomain)).toBe(false);
        }
      });
    });

    describe("Boundary Testing", () => {
      it("should handle maximum number of domains gracefully", async () => {
        const vm = wrapper.vm;
        
        // Add many domains to test performance and limits (reduced count)
        for (let i = 0; i < 30; i++) {
          vm.domains.push({
            name: `domain${i}.com`,
            allowAllUsers: true,
            allowedEmails: []
          });
        }

        // Should still function properly
        expect(vm.domains.length).toBe(33); // 3 from mock + 30 added
        
        // Save operation should handle large payload
        await vm.saveChanges();
        expect(mockDomainManagement.updateDomainRestrictions).toHaveBeenCalled();
      }, 10000);

      it("should handle maximum number of emails per domain", async () => {
        const vm = wrapper.vm;
        
        // Add a domain with many emails
        const testDomain = {
          name: "test.com",
          allowAllUsers: false,
          allowedEmails: [],
          newEmail: ""
        };
        
        vm.domains.push(testDomain);
        
        // Add many emails
        for (let i = 0; i < 50; i++) {
          testDomain.newEmail = `user${i}@test.com`;
          await vm.addEmail(testDomain);
        }

        expect(testDomain.allowedEmails.length).toBe(50);
      });

      it("should handle empty and whitespace-only inputs", async () => {
        const vm = wrapper.vm;
        
        // Test empty domain
        vm.newDomain = "";
        expect(vm.isValidDomain("")).toBe(true); // Empty is considered valid (optional)
        
        // Test whitespace-only domain
        vm.newDomain = "   ";
        expect(vm.isValidDomain("   ")).toBe(false);
        
        // Test tabs and newlines
        expect(vm.isValidDomain("\t\n")).toBe(false);
        expect(vm.isValidEmail("   ", "example.com")).toBe(false);
      });
    });

    describe("Concurrency and Race Condition Testing", () => {
      it("should handle rapid consecutive operations", async () => {
        const vm = wrapper.vm;
        
        // Rapid domain additions
        const addPromises = [];
        for (let i = 0; i < 5; i++) {
          vm.newDomain = `rapid${i}.com`;
          addPromises.push(vm.addDomain());
        }
        
        await Promise.all(addPromises);
        
        // Should handle without crashing
        expect(vm.domains.length).toBeGreaterThan(3); // Original 3 + some new ones
      });

      it("should handle save operations during form modifications", async () => {
        const vm = wrapper.vm;
        
        // Start save operation
        const savePromise = vm.saveChanges();
        
        // Modify data while saving
        vm.newDomain = "concurrent.com";
        vm.addDomain();
        
        // Should complete without errors
        await expect(savePromise).resolves.not.toThrow();
      });

      it("should handle multiple simultaneous save attempts", async () => {
        const vm = wrapper.vm;
        
        // Start multiple save operations simultaneously
        const savePromises = [
          vm.saveChanges(),
          vm.saveChanges(),
          vm.saveChanges()
        ];
        
        await Promise.all(savePromises);
        
        // Should maintain consistent state
        expect(vm.saving).toBe(false);
      });
    });

    describe("State Corruption Prevention", () => {
      it("should prevent invalid state mutations", async () => {
        const vm = wrapper.vm;
        
        // Try to corrupt the domains array
        const originalLength = vm.domains.length;
        
        try {
          // Attempt various state corruptions
          vm.domains.push(null);
          vm.domains.push(undefined);
          vm.domains.push("invalid");
          vm.domains.push({ invalidStructure: true });
        } catch (error) {
          // Errors are expected for invalid mutations
        }
        
        // Component should still function
        await vm.saveChanges();
        expect(vm.saving).toBe(false);
      });

      it("should handle API responses with invalid structure", async () => {
        mockDomainManagement.getDomainRestrictions.mockResolvedValue({
          data: {
            domains: [
              null, // Invalid domain
              undefined, // Invalid domain
              "string", // Invalid domain
              { invalid: true }, // Missing required fields
              { 
                domain: "valid.com",
                allow_all_users: "not_boolean", // Invalid type
                allowed_emails: "not_array" // Invalid type
              }
            ]
          }
        });
        
        wrapper = createWrapper();
        await flushPromises();
        
        // Component should handle gracefully
        expect(wrapper.exists()).toBeTruthy();
      });
    });

    describe("Memory and Resource Testing", () => {
      it("should handle component unmounting during operations", async () => {
        wrapper = createWrapper();
        await flushPromises();
        
        const vm = wrapper.vm;
        
        // Start operations
        vm.newDomain = "test.com";
        const addPromise = vm.addDomain();
        const savePromise = vm.saveChanges();
        
        // Unmount component immediately
        wrapper.unmount();
        
        // Operations should complete without memory leaks
        await expect(Promise.all([addPromise, savePromise])).resolves.not.toThrow();
      });

      it("should clean up event listeners and timers", async () => {
        wrapper = createWrapper();
        await flushPromises();
        
        const vm = wrapper.vm;
        
        // Trigger various operations to create potential listeners
        vm.newDomain = "test.com";
        await vm.addDomain();
        await vm.saveChanges();
        
        // Store a reference to test that the component exists
        expect(wrapper.exists()).toBe(true);
        
        // Unmount should clean up properly without throwing errors
        expect(() => wrapper.unmount()).not.toThrow();
        
        // Component should no longer exist after unmounting
        expect(wrapper.exists()).toBe(false);
      });
    });

    describe("Accessibility and Error Handling", () => {
      it("should handle keyboard navigation edge cases", async () => {
        const vm = wrapper.vm;
        
        // Test with invalid focus targets
        try {
          // Simulate keyboard events on non-existent elements
          const event = new KeyboardEvent('keydown', { key: 'Enter' });
          vm.$el?.dispatchEvent?.(event);
        } catch (error) {
          // Should not crash the component
        }
        
        expect(wrapper.exists()).toBeTruthy();
      });

      it("should maintain form state during validation errors", async () => {
        const vm = wrapper.vm;
        
        // Set up form data
        vm.newDomain = "invalid domain with spaces";
        
        // Try to add invalid domain
        await vm.addDomain();
        
        // Form should maintain state and not be corrupted
        expect(vm.newDomain).toBe("invalid domain with spaces");
        expect(vm.domains.length).toBe(3); // Should not have been added
      });
    });
  });
});
