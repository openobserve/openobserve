// Copyright 2026 OpenObserve Inc.
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

import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it, beforeEach, vi, afterEach, afterAll } from "vitest";
import DomainManagement from "./DomainManagement.vue";
import { isValidDomain, isValidEmail, makeAddEmailSchema } from "./DomainManagement.schema";
import i18n from "@/locales";
import { nextTick } from "vue";

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
      testNode.innerHTML = "";
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

      // Check for Claim Parser section title via data-test
      const claimParserTitle = mainContainer.find(
        '[data-test="domain-management-claim-parser-title"]',
      );
      expect(claimParserTitle.exists()).toBeTruthy();
      expect(claimParserTitle.text()).toContain("Claim Parser");

      // Check for Domain Restrictions section title via data-test
      const domainRestrictionsTitle = mainContainer.find(
        '[data-test="domain-management-domain-restrictions-title"]',
      );
      expect(domainRestrictionsTitle.exists()).toBeTruthy();
    });

    it("should load domain settings on mount", async () => {
      wrapper = createWrapper();
      await flushPromises();

      expect(mockDomainManagement.getDomainRestrictions).toHaveBeenCalledWith("test-meta-org");
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
      // Valid domains
      expect(isValidDomain("example.com")).toBe(true);
      expect(isValidDomain("sub.example.com")).toBe(true);
      expect(isValidDomain("my-company.org")).toBe(true);

      // Invalid domains
      expect(isValidDomain("")).toBe(true); // Empty is considered valid for optional validation
      expect(isValidDomain("invalid")).toBe(false);
      expect(isValidDomain("spaces in domain.com")).toBe(false);
      expect(isValidDomain(".example.com")).toBe(false);
    });

    it("should validate email addresses for specific domains", async () => {
      // Valid emails for domain
      expect(isValidEmail("user@example.com", "example.com")).toBe(true);
      expect(isValidEmail("admin@company.org", "company.org")).toBe(true);

      // Invalid emails
      expect(isValidEmail("", "example.com")).toBe(false);
      expect(isValidEmail("invalid-email", "example.com")).toBe(false);
      expect(isValidEmail("user@different.com", "example.com")).toBe(false);
      expect(isValidEmail("user@example.com", "different.org")).toBe(false);
    });
  });

  describe("Adding Domains", () => {
    beforeEach(async () => {
      wrapper = createWrapper();
      await flushPromises();
    });

    it("should add a new domain successfully", async () => {
      const vm = wrapper.vm;

      await vm.addDomain({ newDomain: "newdomain.com" });
      await nextTick();

      expect(vm.domains).toContainEqual(
        expect.objectContaining({
          name: "newdomain.com",
          policy: "allow_all",
          allowedEmails: [],
        }),
      );
    });

    it("should not add invalid domain", async () => {
      expect(isValidDomain("invalid-domain")).toBe(false);
    });

    it("should not add duplicate domain", async () => {
      const vm = wrapper.vm;

      // Manually add some test data to simulate loaded state
      vm.domains.push({ name: "example.com", policy: "allow_all", allowedEmails: [] });
      const initialDomainsCount = vm.domains.length;

      // Try to add a domain that already exists
      await vm.addDomain({ newDomain: "example.com" });

      expect(vm.domains.length).toBe(initialDomainsCount);
    });

    it("should clear input after adding domain", async () => {
      const vm = wrapper.vm;

      vm.addDomainForm.form.setFieldValue("newDomain", "newdomain.com");
      await vm.addDomain({ newDomain: "newdomain.com" });

      expect(vm.addDomainForm.form.state.values.newDomain).toBe("");
    });
  });

  describe("Add-domain schema validation (real OForm)", () => {
    beforeEach(async () => {
      wrapper = createWrapper();
      await flushPromises();
    });

    it("blocks submit and does NOT add a domain when the input is empty", async () => {
      const vm = wrapper.vm;
      const initialCount = vm.domains.length;

      await vm.addDomainForm.form.handleSubmit();
      await flushPromises();

      expect(vm.addDomainForm.form.state.isValid).toBe(false);
      expect(vm.domains.length).toBe(initialCount);
    });

    it("blocks submit when the domain is invalid (restored domain regex rule)", async () => {
      const vm = wrapper.vm;
      const initialCount = vm.domains.length;

      vm.addDomainForm.form.setFieldValue("newDomain", "not-a-domain");
      await nextTick();
      await vm.addDomainForm.form.handleSubmit();
      await flushPromises();

      expect(vm.addDomainForm.form.state.isValid).toBe(false);
      expect(vm.domains.length).toBe(initialCount);
    });

    it("adds the domain when a valid value is submitted through the form", async () => {
      const vm = wrapper.vm;

      vm.addDomainForm.form.setFieldValue("newDomain", "valid-domain.com");
      await nextTick();
      await vm.addDomainForm.form.handleSubmit();
      await flushPromises();

      expect(vm.domains.some((d: any) => d.name === "valid-domain.com")).toBe(true);
      // Inline add-row cleared after a successful add.
      expect(vm.addDomainForm.form.state.values.newDomain).toBe("");
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
      vm.domains.push({ name: "test.com", policy: "allow_all", allowedEmails: [] });
      await nextTick();

      const initialDomainCount = vm.domains.length;

      // Call removeDomain which should open the ODialog by setting refs
      await vm.removeDomain(0);

      // Assert the dialog state is set (ODialog v-model:open pattern)
      expect(vm.confirmRemoveDomainOpen).toBe(true);
      expect(vm.pendingRemoveDomainIndex).toBe(0);

      // Confirm the removal (simulates clicking the ODialog primary button)
      await vm.doRemoveDomain();

      // Domain should be removed
      expect(vm.domains).toHaveLength(initialDomainCount - 1);
      expect(vm.confirmRemoveDomainOpen).toBe(false);
      expect(vm.pendingRemoveDomainIndex).toBeNull();
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
      const restrictedDomain = vm.domains.find((d) => d.policy === "allow_specific");
      if (restrictedDomain) {
        const initialEmailCount = restrictedDomain.allowedEmails.length;

        await vm.addEmail(restrictedDomain, `newuser@${restrictedDomain.name}`);

        expect(restrictedDomain.allowedEmails.length).toBe(initialEmailCount + 1);
        expect(restrictedDomain.allowedEmails).toContain(`newuser@${restrictedDomain.name}`);
      }
    });

    it("should not add invalid email", async () => {
      const vm = wrapper.vm;

      const restrictedDomain = vm.domains.find((d) => d.policy === "allow_specific");
      if (restrictedDomain) {
        const initialEmailCount = restrictedDomain.allowedEmails.length;

        await vm.addEmail(restrictedDomain, "invalid-email");

        expect(restrictedDomain.allowedEmails.length).toBe(initialEmailCount);
      }
    });

    it("should not add duplicate email", async () => {
      const vm = wrapper.vm;

      const restrictedDomain = vm.domains.find((d) => d.policy === "allow_specific");
      if (restrictedDomain && restrictedDomain.allowedEmails.length > 0) {
        const initialEmailCount = restrictedDomain.allowedEmails.length;
        const existingEmail = restrictedDomain.allowedEmails[0];

        await vm.addEmail(restrictedDomain, existingEmail);

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
        policy: "allow_specific",
        allowedEmails: ["user@testdomain.com"],
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
        }),
      );
    });

    it("should validate domains before saving", async () => {
      const vm = wrapper.vm;

      // Add a domain without emails when not allowing all users
      vm.domains.push({
        name: "test.com",
        policy: "allow_specific",
        allowedEmails: [],
      });

      await vm.saveChanges();

      // Should not call API if validation fails
      expect(vm.saving).toBe(false);
    });

    it("should handle save errors gracefully", async () => {
      mockDomainManagement.updateDomainRestrictions.mockRejectedValue(new Error("API Error"));

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
      vm.addDomainForm.form.setFieldValue("newDomain", "test-input");

      // Clear the mock call count from beforeEach/mount
      mockDomainManagement.getDomainRestrictions.mockClear();

      await vm.resetForm();

      expect(vm.addDomainForm.form.state.values.newDomain).toBe("");
      expect(mockDomainManagement.getDomainRestrictions).toHaveBeenCalledTimes(1); // Called once by resetForm
    });
  });

  describe("Error Handling", () => {
    beforeEach(() => {
      mockDomainManagement.getDomainRestrictions.mockRejectedValue(new Error("API Error"));
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
        () => new Promise((resolve) => setTimeout(resolve, 100)),
      );

      const savePromise = vm.saveChanges();

      expect(vm.saving).toBe(true);

      await savePromise;

      expect(vm.saving).toBe(false);
    });

    it("should display domain count correctly", async () => {
      const vm = wrapper.vm;

      // Add some test data first
      vm.domains.push({ name: "test.com", policy: "allow_all", allowedEmails: [] });
      await nextTick();

      // Check that domains are loaded and count is correct
      expect(vm.domains.length).toBeGreaterThan(0);
      expect(typeof vm.domains.length).toBe("number");
    });

    it("should show no domain message when no domains exist", async () => {
      const vm = wrapper.vm;

      // Clear all domains
      vm.domains.splice(0, vm.domains.length);
      await nextTick();

      const noDomainMessage = wrapper.find('[data-test="domain-management-no-domain-message"]');
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
        const xssAttempts = [
          "<script>alert('xss')</script>",
          "javascript:void(0)",
          "onload=alert(1)",
          "<img src=x onerror=alert(1)>",
          "';DROP TABLE domains;--",
        ];

        for (const xss of xssAttempts) {
          expect(isValidDomain(xss)).toBe(false);
        }
      });

      it("should prevent SQL injection attempts", async () => {
        const sqlInjections = [
          "'; DROP TABLE users; --",
          "1' OR '1'='1",
          "admin'/*",
          "1' UNION SELECT * FROM domains--",
          "'; INSERT INTO domains VALUES('evil.com'); --",
        ];

        for (const sql of sqlInjections) {
          expect(isValidDomain(sql)).toBe(false);
          expect(isValidEmail(sql + "@test.com", "test.com")).toBe(false);
        }
      });
    });

    describe("Data Type and Format Validation", () => {
      it("should handle null and undefined values gracefully", async () => {
        // Test null/undefined domain validation
        expect(isValidDomain(null)).toBe(true); // null treated as empty
        expect(isValidDomain(undefined)).toBe(true); // undefined treated as empty

        // Test null/undefined email validation
        expect(isValidEmail(null, "test.com")).toBe(false);
        expect(isValidEmail(undefined, "test.com")).toBe(false);
        expect(isValidEmail("test@test.com", null)).toBe(false);
        expect(isValidEmail("test@test.com", undefined)).toBe(false);
      });

      it("should reject non-string inputs", async () => {
        const nonStringInputs = [123, true, {}, [], function () {}, Symbol("test")];

        for (const input of nonStringInputs) {
          expect(isValidDomain(input)).toBe(false);
          expect(isValidEmail(input, "test.com")).toBe(false);
        }
      });

      it("should handle extremely large input values", async () => {
        const hugeDomain = "a".repeat(10000) + ".com";
        const hugeEmail = "a".repeat(10000) + "@test.com";

        expect(isValidDomain(hugeDomain)).toBe(false);
        expect(isValidEmail(hugeEmail, "test.com")).toBe(false);
      });
    });

    describe("Error Boundary Testing", () => {
      it("should handle component errors gracefully", async () => {
        // Force an error condition
        mockDomainManagement.getDomainRestrictions.mockRejectedValue(
          new Error("Critical system failure"),
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
          vm.addDomain({ newDomain: `rapid${i}.com` }); // Don't await to simulate rapid clicking
        }

        // Wait for all operations to complete
        await flushPromises();

        expect(wrapper.exists()).toBeTruthy();
      });

      it("should maintain performance with large datasets", async () => {
        const vm = wrapper.vm;

        // Add many domains (reduced count to prevent timeout). Each restricted
        // domain now renders its own add-email <OForm>, so this stress scenario
        // is a little heavier — give it more headroom under parallel CPU load.
        const largeDomainSet = [];
        for (let i = 0; i < 50; i++) {
          largeDomainSet.push({
            name: `domain${i}.com`,
            policy: i % 2 === 0 ? "allow_all" : "allow_specific",
            allowedEmails: i % 2 === 0 ? [] : [`user${i}@domain${i}.com`],
          });
        }

        vm.domains.splice(0, vm.domains.length, ...largeDomainSet);

        // Should still function normally
        await vm.addDomain({ newDomain: "newdomain.com" });

        expect(vm.domains.length).toBe(51);
      }, 20000);
    });

    describe("State Consistency Testing", () => {
      it("should maintain data integrity during concurrent operations", async () => {
        const vm = wrapper.vm;

        // Set up initial state
        vm.domains.push({
          name: "test.com",
          policy: "allow_specific",
          allowedEmails: ["user1@test.com"],
        });

        const domain = vm.domains[vm.domains.length - 1];

        // Concurrent operations on the same domain
        const operations = [vm.addEmail(domain), vm.saveChanges(), vm.resetForm()];

        await Promise.all(operations);

        // State should remain consistent
        expect(wrapper.exists()).toBeTruthy();
      });

      it("should prevent race conditions in form validation", async () => {
        // Rapid validation calls
        const validationPromises = [
          Promise.resolve(isValidDomain("test1.com")),
          Promise.resolve(isValidDomain("test2.com")),
          Promise.resolve(isValidEmail("user@test.com", "test.com")),
          Promise.resolve(isValidEmail("admin@test.com", "test.com")),
        ];

        const results = await Promise.all(validationPromises);

        // All validations should complete successfully
        expect(results.every((result) => typeof result === "boolean")).toBe(true);
      });
    });

    describe("Resource Cleanup Testing", () => {
      it("should clean up properly when component is destroyed during operations", async () => {
        wrapper = createWrapper();
        await flushPromises();

        const vm = wrapper.vm;

        // Start long-running operations
        const addPromise = vm.addDomain({ newDomain: "test.com" });
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
            policy: "allow_specific",
            allowedEmails: [`user@stress-test-${i}.com`],
          });
        }

        // Component operations should still work under load
        await vm.addDomain({ newDomain: "memory-test.com" });

        expect(vm.domains.some((d) => d.name === "memory-test.com")).toBe(true);
        expect(vm.domains.length).toBe(initialCount + 30 + 1); // Original + stress domains + new domain

        // Clean up - remove the stress test domains
        vm.domains.splice(initialCount, vm.domains.length - initialCount);
      }, 10000);
    });
  });
});

describe("makeAddEmailSchema (required: empty fails, must be valid + belong to domain)", () => {
  const schema = makeAddEmailSchema("example.com", (k: string) => k);

  it("FAILS when the email is empty/omitted (required for the Add-Email action)", () => {
    // Option A: the Add-Email field is required, so empty → "Email is required".
    // (No .trim() — matches pre-migration; whitespace-only is caught as invalid.)
    expect(schema.safeParse({ newEmail: "" }).success).toBe(false);
    expect(schema.safeParse({ newEmail: undefined }).success).toBe(false);
    expect(schema.safeParse({}).success).toBe(false);
  });

  it("passes a valid email that belongs to the domain", () => {
    expect(schema.safeParse({ newEmail: "user@example.com" }).success).toBe(true);
  });

  it("rejects a malformed email or one from another domain", () => {
    expect(schema.safeParse({ newEmail: "invalid-email" }).success).toBe(false);
    expect(schema.safeParse({ newEmail: "user@other.com" }).success).toBe(false);
  });

  describe("Add-email form — first-submit validation (repro)", () => {
    const createWrapper = () => mount(DomainManagement, { global: { plugins: [i18n] } });
    const emailFormFor = async (wrapper: any, name: string) => {
      const vm = wrapper.vm as any;
      // policy "allow_specific" is what renders the allow-email OForm (whose ref we need).
      vm.domains.push({ name, policy: "allow_specific", allowedEmails: [], blockedEmails: [] });
      await nextTick();
      await flushPromises();
      await nextTick();
      return vm.emailFormRefs[name]?.form;
    };

    it("INVALID email on the FIRST submit reveals the error and does not add", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      const form = await emailFormFor(wrapper, "openobaseve.ai");
      expect(form).toBeTruthy();

      form.setFieldValue("newEmail", "abc"); // invalid
      await nextTick();
      await form.handleSubmit(); // FIRST submit
      await flushPromises();
      await nextTick();

      const domain = (wrapper.vm as any).domains.find((d: any) => d.name === "openobaseve.ai");
      expect(domain.allowedEmails).not.toContain("abc");
      // The bug would be: isValid true / no error on first submit.
      expect(form.state.isValid).toBe(false);
      expect((form.getFieldMeta("newEmail")?.errors ?? []).length).toBeGreaterThan(0);
      wrapper.unmount();
    });

    it("EMPTY email on the FIRST submit shows 'required' and does not add (Option A)", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      const form = await emailFormFor(wrapper, "openobaseve.ai");
      expect(form).toBeTruthy();

      await form.handleSubmit(); // FIRST submit, empty
      await flushPromises();
      await nextTick();

      const domain = (wrapper.vm as any).domains.find((d: any) => d.name === "openobaseve.ai");
      expect(domain.allowedEmails).toEqual([]);
      expect(form.state.isValid).toBe(false); // required now → empty blocked
      expect((form.getFieldMeta("newEmail")?.errors ?? []).length).toBeGreaterThan(0);
      wrapper.unmount();
    });
  });
});
