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

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
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
import Fluentd from "@/components/ingestion/logs/Fluentd.vue";

installQuasar();
mockZincUtils();
mockCopyContent();
mockExternalDependencies();

describe("Fluentd", () => {
  let wrapper: any;

  beforeEach(() => {
    wrapper = createTestWrapper(Fluentd, defaultTestProps);
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

  it("should display Fluentd configuration content", () => {
    const copyContent = wrapper.findComponent({ name: 'CopyContent' });
    const content = copyContent.props('content');
    expect(content).toContain('<source>');
    expect(content).toContain('@type forward');
    expect(content).toContain('<match **>');
    expect(content).toContain('test_org');
    expect(content).toContain('[EMAIL]');
    expect(content).toContain('[PASSCODE]');
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
    
    wrapper = createTestWrapper(Fluentd, customProps, customStoreState);
    
    const copyContent = wrapper.findComponent({ name: 'CopyContent' });
    expect(copyContent.props('content')).toContain('custom_org');
  });

  it("should handle missing props gracefully", () => {
    wrapper = createTestWrapper(Fluentd, {});
    expect(wrapper.exists()).toBe(true);
  });

  it("should handle empty store state", () => {
    wrapper = createTestWrapper(Fluentd, defaultTestProps, {});
    expect(wrapper.exists()).toBe(true);
  });
});
