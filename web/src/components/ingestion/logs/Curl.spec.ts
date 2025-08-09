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

import { beforeEach, describe, expect, it, afterEach, vi } from "vitest";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import {
  createTestWrapper,
  defaultTestProps,
  mockZincUtils,
  mockCopyContent,
  mockExternalDependencies,
  cleanupTest,
  commonAssertions,
  type TestProps
} from "@/test/unit/helpers/ingestionTestUtils";
import Curl from "@/components/ingestion/logs/Curl.vue";

installQuasar();
mockZincUtils();
mockCopyContent();
mockExternalDependencies();

describe("Curl", () => {
  let wrapper: any;

  beforeEach(() => {
    wrapper = createTestWrapper(Curl, defaultTestProps);
  });

  afterEach(() => {
    cleanupTest(wrapper);
  });

  it("should mount successfully", () => {
    expect(wrapper.exists()).toBe(true);
  });

  it("should render CopyContent component", () => {
    const copyContent = wrapper.findComponent({ name: 'CopyContent' });
    expect(copyContent.exists()).toBe(true);
  });

  it("should display curl command content", () => {
    const copyContent = wrapper.findComponent({ name: 'CopyContent' });
    const content = copyContent.props('content');
    expect(content).toContain('curl');
    expect(content).toContain('test_org');
    expect(content).toContain('[EMAIL]:[PASSCODE]');
  });

  it("should handle props correctly", () => {
    expect(wrapper.vm.currOrgIdentifier).toBe(defaultTestProps.currOrgIdentifier);
    expect(wrapper.vm.currUserEmail).toBe(defaultTestProps.currUserEmail);
  });

  it("should generate content with organization identifier", () => {
    const copyContent = wrapper.findComponent({ name: 'CopyContent' });
    expect(copyContent.props('content')).toContain('test_org');
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
    
    wrapper = createTestWrapper(Curl, customProps, customStoreState);
    
    const copyContent = wrapper.findComponent({ name: 'CopyContent' });
    // The Curl component directly uses store.state.selectedOrganization.identifier
    expect(copyContent.props('content')).toContain('custom_org');
  });

  it("should handle missing props gracefully", () => {
    wrapper = createTestWrapper(Curl, {});
    expect(wrapper.exists()).toBe(true);
  });

  it("should handle empty store state", () => {
    wrapper = createTestWrapper(Curl, defaultTestProps, {});
    expect(wrapper.exists()).toBe(true);
  });
});
