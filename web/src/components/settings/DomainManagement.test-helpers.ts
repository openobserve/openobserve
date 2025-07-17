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

import { vi } from "vitest";

/**
 * Test helpers for DomainManagement component testing
 */

export const mockDomainData = {
  simple: {
    domains: [
      {
        domain: "example.com",
        allow_all_users: true,
        allowed_emails: [],
      },
    ],
  },
  complex: {
    domains: [
      {
        domain: "company.com",
        allow_all_users: false,
        allowed_emails: ["admin@company.com", "user1@company.com"],
      },
      {
        domain: "partner.org",
        allow_all_users: true,
        allowed_emails: [],
      },
      {
        domain: "client.net",
        allow_all_users: false,
        allowed_emails: ["contact@client.net"],
      },
    ],
  },
  empty: {
    domains: [],
  },
};

export const createMockStore = (overrides = {}) => ({
  state: {
    zoConfig: {
      meta_org: "test-meta-org",
    },
    selectedOrganization: {
      identifier: "test-meta-org",
    },
    ...overrides,
  },
});

export const createMockRouter = () => ({
  replace: vi.fn(),
  push: vi.fn(),
  go: vi.fn(),
});

export const waitForDOM = async (wrapper: any, selector: string, timeout = 1000) => {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const checkElement = () => {
      const element = wrapper.find(selector);
      if (element.exists()) {
        resolve(element);
      } else if (Date.now() - startTime > timeout) {
        reject(new Error(`Element ${selector} not found within ${timeout}ms`));
      } else {
        setTimeout(checkElement, 10);
      }
    };
    checkElement();
  });
};

export const createDomainManagementWrapper = (mount: any, component: any, options = {}) => {
  const defaultOptions = {
    attachTo: "#app",
    shallow: false,
    global: {
      plugins: [],
      stubs: {},
    },
    ...options,
  };

  return mount(component, defaultOptions);
};

export const mockNotifySuccess = () => ({
  type: "positive",
  timeout: 3000,
});

export const mockNotifyError = () => ({
  type: "negative",
  timeout: 3000,
});

export const domainValidationTestCases = [
  // Valid cases
  { input: "example.com", expected: true, description: "basic domain" },
  { input: "sub.example.com", expected: true, description: "subdomain" },
  { input: "my-company.org", expected: true, description: "domain with hyphen" },
  { input: "test123.co.uk", expected: true, description: "domain with numbers and country code" },
  
  // Invalid cases
  { input: "", expected: true, description: "empty string (considered valid for optional)" },
  { input: "invalid", expected: false, description: "single word" },
  { input: "spaces in domain.com", expected: false, description: "domain with spaces" },
  { input: ".example.com", expected: false, description: "starting with dot" },
  { input: "example..com", expected: false, description: "double dots" },
  { input: "example.com.", expected: true, description: "trailing dot (actually valid in DNS)" },
  { input: "-example.com", expected: false, description: "starting with hyphen" },
  { input: "example-.com", expected: false, description: "ending with hyphen before dot (invalid per RFC)" },
];

export const emailValidationTestCases = [
  // Valid cases
  { 
    email: "user@example.com", 
    domain: "example.com", 
    expected: true, 
    description: "valid email for domain" 
  },
  { 
    email: "admin@company.org", 
    domain: "company.org", 
    expected: true, 
    description: "valid email with different TLD" 
  },
  { 
    email: "test.user+tag@example.com", 
    domain: "example.com", 
    expected: true, 
    description: "email with plus sign and dots" 
  },
  
  // Invalid cases
  { 
    email: "", 
    domain: "example.com", 
    expected: false, 
    description: "empty email" 
  },
  { 
    email: "invalid-email", 
    domain: "example.com", 
    expected: false, 
    description: "invalid email format" 
  },
  { 
    email: "user@different.com", 
    domain: "example.com", 
    expected: false, 
    description: "email from different domain" 
  },
  { 
    email: "user@subdomain.example.com", 
    domain: "example.com", 
    expected: false, 
    description: "email from subdomain when parent domain expected" 
  },
];

export const apiErrorScenarios = [
  {
    name: "Network Error",
    error: new Error("Network request failed"),
    expectedMessage: "Network request failed",
  },
  {
    name: "API Error",
    error: { response: { data: { message: "API Error" } } },
    expectedMessage: "API Error",
  },
  {
    name: "Unauthorized",
    error: { response: { status: 401, statusText: "Unauthorized" } },
    expectedMessage: "Unauthorized",
  },
  {
    name: "Server Error",
    error: { response: { status: 500, statusText: "Internal Server Error" } },
    expectedMessage: "Internal Server Error",
  },
];
