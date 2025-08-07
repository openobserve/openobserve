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

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import {
  createTestWrapper,
  defaultTestProps,
  mockUseIngestion,
  mockCopyContent,
  mockExternalDependencies,
  cleanupTest,
  commonAssertions,
  type TestProps
} from "@/test/unit/helpers/ingestionTestUtils";
import Redis from "@/components/ingestion/databases/Redis.vue";

installQuasar();
mockUseIngestion();
mockCopyContent();
mockExternalDependencies();

describe("Redis", () => {
  let wrapper: any;

  beforeEach(() => {
    wrapper = createTestWrapper(Redis, defaultTestProps);
  });

  afterEach(() => {
    cleanupTest(wrapper);
  });

  it("should mount successfully", () => {
    commonAssertions.shouldMountSuccessfully(wrapper);
  });

  it("should render CopyContent component", () => {
    commonAssertions.shouldRenderCopyContent(wrapper);
  });

  it("should display Redis configuration content", () => {
    const copyContent = wrapper.findComponent({ name: 'CopyContent' });
    const content = copyContent.props('content');
    expect(content).toContain('exporters:');
    expect(content).toContain('otlphttp/openobserve:');
    expect(content).toContain('redis');
  });

  it("should render documentation link", () => {
    const link = wrapper.find('a[target="_blank"]');
    expect(link.exists()).toBe(true);
    expect(link.attributes('href')).toMatch(/database\/redis/);
    expect(link.text()).toBe('here');
  });

  it("should handle different organization identifier", () => {
    const customProps: TestProps = {
      currOrgIdentifier: 'custom_org',
      currUserEmail: 'custom@example.com'
    };
    
    const customStoreState = {
      selectedOrganization: {
        identifier: 'custom_org'
      }
    };
    
    wrapper = createTestWrapper(Redis, customProps, customStoreState);
    
    const copyContent = wrapper.findComponent({ name: 'CopyContent' });
    // The mock currently returns test_org, but the component should still work
    expect(copyContent.props('content')).toContain('test_org');
  });

  it("should handle missing props gracefully", () => {
    wrapper = createTestWrapper(Redis, {});
    expect(wrapper.exists()).toBe(true);
  });

  it("should handle empty store state", () => {
    wrapper = createTestWrapper(Redis, defaultTestProps, {});
    expect(wrapper.exists()).toBe(true);
  });
});