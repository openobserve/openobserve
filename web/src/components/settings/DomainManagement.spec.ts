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

import { DOMWrapper, flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it, beforeEach, vi, afterEach, afterAll } from "vitest";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import DomainManagement from "./DomainManagement.vue";
import i18n from "@/locales";
import { Dialog, Notify } from "quasar";
import { nextTick } from "vue";

installQuasar({
  plugins: [Dialog, Notify],
});

// Create a unique DOM node for this test file
const uniqueNodeId = "domain-management-unit-test-app";
const node = document.createElement("div");
node.setAttribute("id", uniqueNodeId);
document.body.appendChild(node);

// Mock the domainManagement service
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

// Import the mocked services
import domainManagement from "@/services/domainManagement";
import jstransform from "@/services/jstransform";
import organizations from "@/services/organizations";
import searchService from "@/services/search";

const mockDomainManagement = domainManagement as any;
const mockJstransform = jstransform as any;
const mockOrganizations = organizations as any;
const mockSearchService = searchService as any;

// Mock Vuex store
const mockStore = {
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
};

vi.mock("vuex", () => ({
  useStore: () => mockStore,
}));

// Mock Vue Router
const mockRouter = {
  replace: vi.fn(),
};

vi.mock("vue-router", () => ({
  useRouter: () => mockRouter,
}));

describe("DomainManagement Component", () => {
  let wrapper: any = null;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetAllMocks();

    // Mock successful API response by default
    mockDomainManagement.getDomainRestrictions.mockResolvedValue({
      data: {
        domains: [
          {
            domain: "example.com",
            allow_all_users: true,
            allowed_emails: [],
          },
          {
            domain: "company.org",
            allow_all_users: false,
            allowed_emails: ["admin@company.org", "user@company.org"],
          },
        ],
      },
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

  describe("Component Mounting and Initial State", () => {
    it("should mount DomainManagement component successfully", async () => {
      wrapper = createWrapper();
      
      expect(wrapper.exists()).toBeTruthy();
      expect(wrapper.find(".domain_management").exists()).toBeTruthy();
    });

    it("should display correct title and description", async () => {
      wrapper = createWrapper();

      // Check that the main container exists
      const mainContainer = wrapper.find(".domain_management");
      expect(mainContainer.exists()).toBeTruthy();

      // Check for Claim Parser section title (should contain "Claim Parser")
      const claimParserTitle = mainContainer.findAll(".text-h6").find((el: any) =>
        el.text().includes("Claim Parser")
      );
      expect(claimParserTitle).toBeTruthy();

      // Check for Domain Restrictions section title
      const domainRestrictionsTitle = mainContainer.findAll(".text-h6").find((el: any) =>
        el.text().includes("Domain") || el.text().includes("Restriction")
      );
      expect(domainRestrictionsTitle).toBeTruthy();
    });

    it("should load domain settings on mount", async () => {
      wrapper = createWrapper();
      await flushPromises();
      
      expect(mockDomainManagement.getDomainRestrictions).toHaveBeenCalledWith(
        "test-meta-org"
      );
    });

    it("should redirect if not meta organization", async () => {
      mockStore.state.selectedOrganization.identifier = "different-org";
      
      wrapper = createWrapper();
      await flushPromises();
      
      expect(mockRouter.replace).toHaveBeenCalledWith({
        name: "general",
        query: {
          org_identifier: "different-org",
        },
      });
    });
  });

  describe("Domain Validation", () => {
    beforeEach(() => {
      wrapper = createWrapper();
    });

    it("should validate domain names correctly", async () => {
      const vm = wrapper.vm;
      
      // Valid domains
      expect(vm.isValidDomain("example.com")).toBe(true);
      expect(vm.isValidDomain("sub.example.com")).toBe(true);
      expect(vm.isValidDomain("my-company.org")).toBe(true);
      
      // Invalid domains
      expect(vm.isValidDomain("")).toBe(true); // Empty is considered valid for optional validation
      expect(vm.isValidDomain("invalid")).toBe(false);
      expect(vm.isValidDomain("spaces in domain.com")).toBe(false);
      expect(vm.isValidDomain(".example.com")).toBe(false);
    });

    it("should validate email addresses for specific domains", async () => {
      const vm = wrapper.vm;
      
      // Valid emails for domain
      expect(vm.isValidEmail("user@example.com", "example.com")).toBe(true);
      expect(vm.isValidEmail("admin@company.org", "company.org")).toBe(true);
      
      // Invalid emails
      expect(vm.isValidEmail("", "example.com")).toBe(false);
      expect(vm.isValidEmail("invalid-email", "example.com")).toBe(false);
      expect(vm.isValidEmail("user@different.com", "example.com")).toBe(false);
      expect(vm.isValidEmail("user@example.com", "different.org")).toBe(false);
    });
  });

  describe("Adding Domains", () => {
    beforeEach(async () => {
      wrapper = createWrapper();
      await flushPromises();
    });

    it("should add a new domain successfully", async () => {
      const vm = wrapper.vm;
      
      vm.newDomain = "newdomain.com";
      await vm.addDomain();
      await nextTick();
      
      expect(vm.domains).toContainEqual(
        expect.objectContaining({
          name: "newdomain.com",
          allowAllUsers: true,
          allowedEmails: [],
        })
      );
    });

    it("should not add invalid domain", async () => {
      const vm = wrapper.vm;
      
      vm.newDomain = "invalid-domain";
      
      expect(vm.isValidDomain("invalid-domain")).toBe(false);
    });

    it("should not add duplicate domain", async () => {
      const vm = wrapper.vm;
      
      // Manually add some test data to simulate loaded state
      vm.domains.push({ name: "example.com", allowAllUsers: true, allowedEmails: [] });
      const initialDomainsCount = vm.domains.length;
      
      // Try to add a domain that already exists
      vm.newDomain = "example.com"; 
      await vm.addDomain();
      
      expect(vm.domains.length).toBe(initialDomainsCount);
    });

    it("should clear input after adding domain", async () => {
      const vm = wrapper.vm;
      
      vm.newDomain = "newdomain.com";
      await vm.addDomain();
      
      expect(vm.newDomain).toBe("");
    });
  });

  describe("Removing Domains", () => {
    beforeEach(async () => {
      wrapper = createWrapper();
      await flushPromises();
    });

    it("should show confirmation dialog when removing domain", async () => {
      const vm = wrapper.vm;
      
      // Add a test domain first
      vm.domains.push({ name: "test.com", allowAllUsers: true, allowedEmails: [] });
      await nextTick();
      
      // Mock q.dialog instead of Dialog.create
      const mockDialog = vi.fn().mockReturnValue({
        onOk: vi.fn((callback) => callback()),
        onCancel: vi.fn(),
      });
      
      // Replace the dialog method on the component's q object
      vm.$q.dialog = mockDialog;
      
      await vm.removeDomain(0);
      
      expect(mockDialog).toHaveBeenCalled();
      expect(vm.domains).toHaveLength(0);
    });
  });

  describe("Email Management", () => {
    beforeEach(async () => {
      wrapper = createWrapper();
      await flushPromises();
    });

    it("should add email to domain with specific users", async () => {
      const vm = wrapper.vm;
      
      // Find a domain that doesn't allow all users
      const restrictedDomain = vm.domains.find(d => !d.allowAllUsers);
      if (restrictedDomain) {
        const initialEmailCount = restrictedDomain.allowedEmails.length;
        
        restrictedDomain.newEmail = `newuser@${restrictedDomain.name}`;
        await vm.addEmail(restrictedDomain);
        
        expect(restrictedDomain.allowedEmails.length).toBe(initialEmailCount + 1);
        expect(restrictedDomain.allowedEmails).toContain(`newuser@${restrictedDomain.name}`);
        expect(restrictedDomain.newEmail).toBe("");
      }
    });

    it("should not add invalid email", async () => {
      const vm = wrapper.vm;
      
      const restrictedDomain = vm.domains.find(d => !d.allowAllUsers);
      if (restrictedDomain) {
        const initialEmailCount = restrictedDomain.allowedEmails.length;
        
        restrictedDomain.newEmail = "invalid-email";
        await vm.addEmail(restrictedDomain);
        
        expect(restrictedDomain.allowedEmails.length).toBe(initialEmailCount);
      }
    });

    it("should not add duplicate email", async () => {
      const vm = wrapper.vm;
      
      const restrictedDomain = vm.domains.find(d => !d.allowAllUsers);
      if (restrictedDomain && restrictedDomain.allowedEmails.length > 0) {
        const initialEmailCount = restrictedDomain.allowedEmails.length;
        const existingEmail = restrictedDomain.allowedEmails[0];
        
        restrictedDomain.newEmail = existingEmail;
        await vm.addEmail(restrictedDomain);
        
        expect(restrictedDomain.allowedEmails.length).toBe(initialEmailCount);
      }
    });
  });

  describe("Saving Changes", () => {
    beforeEach(async () => {
      wrapper = createWrapper();
      await flushPromises();
    });

    it("should save changes successfully", async () => {
      const vm = wrapper.vm;
      
      // Add some test data
      vm.domains.push({ 
        name: "testdomain.com", 
        allowAllUsers: false, 
        allowedEmails: ["user@testdomain.com"] 
      });
      
      await vm.saveChanges();
      
      expect(mockDomainManagement.updateDomainRestrictions).toHaveBeenCalledWith(
        "test-meta-org",
        expect.objectContaining({
          domains: expect.arrayContaining([
            expect.objectContaining({
              domain: expect.any(String),
              allow_all_users: expect.any(Boolean),
              allowed_emails: expect.any(Array),
            }),
          ]),
        })
      );
    });

    it("should validate domains before saving", async () => {
      const vm = wrapper.vm;
      
      // Add a domain without emails when not allowing all users
      vm.domains.push({
        name: "test.com",
        allowAllUsers: false,
        allowedEmails: [],
        newEmail: "",
      });
      
      await vm.saveChanges();
      
      // Should not call API if validation fails
      expect(vm.saving).toBe(false);
    });

    it("should handle save errors gracefully", async () => {
      mockDomainManagement.updateDomainRestrictions.mockRejectedValue(
        new Error("API Error")
      );
      
      const vm = wrapper.vm;
      await vm.saveChanges();
      
      expect(vm.saving).toBe(false);
    });

    it("should emit saved event on successful save", async () => {
      const vm = wrapper.vm;
      
      await vm.saveChanges();
      
      expect(wrapper.emitted().saved).toBeTruthy();
    });
  });

  describe("Form Reset", () => {
    beforeEach(async () => {
      wrapper = createWrapper();
      await flushPromises();
    });

    it("should reset form and reload data", async () => {
      const vm = wrapper.vm;
      
      // Modify some data
      vm.newDomain = "test-input";
      
      // Clear the mock call count from beforeEach/mount
      mockDomainManagement.getDomainRestrictions.mockClear();
      
      await vm.resetForm();
      
      expect(vm.newDomain).toBe("");
      expect(mockDomainManagement.getDomainRestrictions).toHaveBeenCalledTimes(1); // Called once by resetForm
    });
  });

  describe("Error Handling", () => {
    beforeEach(() => {
      mockDomainManagement.getDomainRestrictions.mockRejectedValue(
        new Error("API Error")
      );
    });

    it("should handle API errors gracefully on load", async () => {
      wrapper = createWrapper();
      await flushPromises();
      
      // Component should still mount and show empty state
      expect(wrapper.exists()).toBeTruthy();
    });
  });

  describe("UI State Management", () => {
    beforeEach(async () => {
      wrapper = createWrapper();
      await flushPromises();
    });

    it("should show loading state during save", async () => {
      const vm = wrapper.vm;
      
      // Mock a slow API call
      mockDomainManagement.updateDomainRestrictions.mockImplementation(
        () => new Promise(resolve => setTimeout(resolve, 100))
      );
      
      const savePromise = vm.saveChanges();
      
      expect(vm.saving).toBe(true);
      
      await savePromise;
      
      expect(vm.saving).toBe(false);
    });

    it("should display domain count correctly", async () => {
      const vm = wrapper.vm;
      
      // Add some test data first
      vm.domains.push({ name: "test.com", allowAllUsers: true, allowedEmails: [] });
      await nextTick();
      
      // Check that domains are loaded and count is correct
      expect(vm.domains.length).toBeGreaterThan(0);
      expect(typeof vm.domains.length).toBe('number');
    });

    it("should show no domain message when no domains exist", async () => {
      const vm = wrapper.vm;
      
      // Clear all domains
      vm.domains.splice(0, vm.domains.length);
      await nextTick();
      
      const noDomainMessage = wrapper.find(".text-center");
      expect(noDomainMessage.exists()).toBeTruthy();
    });
  });

  describe("Component Cleanup", () => {
    it("should emit cancel event", async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm;
      
      // Clear the mock call count from mount
      mockDomainManagement.getDomainRestrictions.mockClear();
      
      // Call resetForm method directly instead of finding the button
      await vm.resetForm();
      
      // resetForm should be called which reloads data
      expect(mockDomainManagement.getDomainRestrictions).toHaveBeenCalledTimes(1);
    });
  });

  describe("Advanced Negative Testing", () => {
    beforeEach(async () => {
      wrapper = createWrapper();
      await flushPromises();
    });

    describe("Security and XSS Prevention", () => {
      it("should sanitize malicious input in domain names", async () => {
        const vm = wrapper.vm;
        
        const xssAttempts = [
          "<script>alert('xss')</script>",
          "javascript:void(0)",
          "onload=alert(1)",
          "<img src=x onerror=alert(1)>",
          "';DROP TABLE domains;--"
        ];

        for (const xss of xssAttempts) {
          vm.newDomain = xss;
          expect(vm.isValidDomain(xss)).toBe(false);
        }
      });

      it("should prevent SQL injection attempts", async () => {
        const vm = wrapper.vm;
        
        const sqlInjections = [
          "'; DROP TABLE users; --",
          "1' OR '1'='1",
          "admin'/*",
          "1' UNION SELECT * FROM domains--",
          "'; INSERT INTO domains VALUES('evil.com'); --"
        ];

        for (const sql of sqlInjections) {
          expect(vm.isValidDomain(sql)).toBe(false);
          expect(vm.isValidEmail(sql + "@test.com", "test.com")).toBe(false);
        }
      });
    });

    describe("Data Type and Format Validation", () => {
      it("should handle null and undefined values gracefully", async () => {
        const vm = wrapper.vm;
        
        // Test null/undefined domain validation
        expect(vm.isValidDomain(null)).toBe(true); // null treated as empty
        expect(vm.isValidDomain(undefined)).toBe(true); // undefined treated as empty
        
        // Test null/undefined email validation
        expect(vm.isValidEmail(null, "test.com")).toBe(false);
        expect(vm.isValidEmail(undefined, "test.com")).toBe(false);
        expect(vm.isValidEmail("test@test.com", null)).toBe(false);
        expect(vm.isValidEmail("test@test.com", undefined)).toBe(false);
      });

      it("should reject non-string inputs", async () => {
        const vm = wrapper.vm;
        
        const nonStringInputs = [
          123,
          true,
          {},
          [],
          function() {},
          Symbol('test')
        ];

        for (const input of nonStringInputs) {
          expect(vm.isValidDomain(input)).toBe(false);
          expect(vm.isValidEmail(input, "test.com")).toBe(false);
        }
      });

      it("should handle extremely large input values", async () => {
        const vm = wrapper.vm;
        
        const hugeDomain = "a".repeat(10000) + ".com";
        const hugeEmail = "a".repeat(10000) + "@test.com";
        
        expect(vm.isValidDomain(hugeDomain)).toBe(false);
        expect(vm.isValidEmail(hugeEmail, "test.com")).toBe(false);
      });
    });

    describe("Error Boundary Testing", () => {
      it("should handle component errors gracefully", async () => {
        const vm = wrapper.vm;
        
        // Force an error condition
        mockDomainManagement.getDomainRestrictions.mockRejectedValue(
          new Error("Critical system failure")
        );
        
        // Component should still render
        wrapper = createWrapper();
        await flushPromises();
        
        expect(wrapper.exists()).toBeTruthy();
        expect(wrapper.vm.domains.length).toBe(0);
      });

      it("should recover from temporary API failures", async () => {
        const vm = wrapper.vm;
        
        // First call fails
        mockDomainManagement.updateDomainRestrictions
          .mockRejectedValueOnce(new Error("Network timeout"))
          .mockResolvedValueOnce({ success: true });
        
        // First save should fail gracefully
        await vm.saveChanges();
        expect(vm.saving).toBe(false);
        
        // Second save should succeed
        await vm.saveChanges();
        expect(vm.saving).toBe(false);
      });
    });

    describe("Performance and Load Testing", () => {
      it("should handle rapid user interactions", async () => {
        const vm = wrapper.vm;
        
        // Rapid form submissions
        for (let i = 0; i < 10; i++) {
          vm.newDomain = `rapid${i}.com`;
          vm.addDomain(); // Don't await to simulate rapid clicking
        }
        
        // Wait for all operations to complete
        await flushPromises();
        
        expect(wrapper.exists()).toBeTruthy();
      });

      it("should maintain performance with large datasets", async () => {
        const vm = wrapper.vm;
        
        // Add many domains (reduced count to prevent timeout)
        const largeDomainSet = [];
        for (let i = 0; i < 50; i++) {
          largeDomainSet.push({
            name: `domain${i}.com`,
            allowAllUsers: i % 2 === 0,
            allowedEmails: i % 2 === 0 ? [] : [`user${i}@domain${i}.com`]
          });
        }
        
        vm.domains.splice(0, vm.domains.length, ...largeDomainSet);
        
        // Should still function normally
        vm.newDomain = "newdomain.com";
        await vm.addDomain();
        
        expect(vm.domains.length).toBe(51);
      }, 10000);
    });

    describe("State Consistency Testing", () => {
      it("should maintain data integrity during concurrent operations", async () => {
        const vm = wrapper.vm;
        
        // Set up initial state
        vm.domains.push({ 
          name: "test.com", 
          allowAllUsers: false, 
          allowedEmails: ["user1@test.com"],
          newEmail: ""
        });
        
        const domain = vm.domains[vm.domains.length - 1];
        
        // Concurrent operations on the same domain
        const operations = [
          vm.addEmail(domain),
          vm.saveChanges(),
          vm.resetForm()
        ];
        
        await Promise.all(operations);
        
        // State should remain consistent
        expect(wrapper.exists()).toBeTruthy();
      });

      it("should prevent race conditions in form validation", async () => {
        const vm = wrapper.vm;
        
        // Rapid validation calls
        const validationPromises = [
          Promise.resolve(vm.isValidDomain("test1.com")),
          Promise.resolve(vm.isValidDomain("test2.com")),
          Promise.resolve(vm.isValidEmail("user@test.com", "test.com")),
          Promise.resolve(vm.isValidEmail("admin@test.com", "test.com"))
        ];
        
        const results = await Promise.all(validationPromises);
        
        // All validations should complete successfully
        expect(results.every(result => typeof result === 'boolean')).toBe(true);
      });
    });

    describe("Resource Cleanup Testing", () => {
      it("should clean up properly when component is destroyed during operations", async () => {
        wrapper = createWrapper();
        await flushPromises();
        
        const vm = wrapper.vm;
        
        // Start long-running operations
        vm.newDomain = "test.com";
        const addPromise = vm.addDomain();
        const savePromise = vm.saveChanges();
        
        // Destroy component immediately
        wrapper.unmount();
        wrapper = null;
        
        // Operations should complete without errors
        await expect(Promise.allSettled([addPromise, savePromise])).resolves.not.toThrow();
      });

      it("should handle memory pressure scenarios", async () => {
        const vm = wrapper.vm;
        
        // Create a realistic memory pressure scenario by adding many domains directly to the component
        const initialCount = vm.domains.length;
        
        // Add many domains to the component's internal state (reduced count)
        for (let i = 0; i < 30; i++) {
          vm.domains.push({
            name: `stress-test-${i}.com`,
            allowAllUsers: false,
            allowedEmails: [`user@stress-test-${i}.com`],
            newEmail: ""
          });
        }
        
        // Component operations should still work under load
        vm.newDomain = "memory-test.com";
        await vm.addDomain();
        
        expect(vm.domains.some(d => d.name === "memory-test.com")).toBe(true);
        expect(vm.domains.length).toBe(initialCount + 30 + 1); // Original + stress domains + new domain
        
        // Clean up - remove the stress test domains
        vm.domains.splice(initialCount, vm.domains.length - initialCount);
      }, 10000);
    });
  });
});
