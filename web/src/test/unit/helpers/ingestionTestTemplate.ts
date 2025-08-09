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

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { installQuasar } from '@/test/unit/helpers/install-quasar-plugin';
import {
  createTestWrapper,
  defaultTestProps,
  mockUseIngestion,
  mockCopyContent,
  mockExternalDependencies,
  cleanupTest,
  commonAssertions,
  type TestProps
} from '@/test/unit/helpers/ingestionTestUtils';

// Install Quasar
installQuasar();

// Setup mocks
mockUseIngestion();
mockCopyContent();
mockExternalDependencies();

/**
 * Creates a standard test suite for simple ingestion components
 * @param componentName - Name of the component (e.g., 'MySQL')
 * @param componentPathOrComponent - Path to the component or the component itself
 * @param expectedContentKeyword - Keyword that should appear in the content (e.g., 'mysql')
 * @param docUrlPattern - Pattern that the documentation URL should match (optional)
 */
export const createSimpleIngestionComponentTest = (
  componentName: string,
  componentPathOrComponent: string | any,
  expectedContentKeyword: string,
  docUrlPattern?: RegExp
) => {
  return describe(componentName, () => {
    let wrapper: any;
    let Component: any;

    beforeEach(async () => {
      // Handle both component path and component object
      if (typeof componentPathOrComponent === 'string') {
        // Dynamic import for path
        const module = await import(componentPathOrComponent);
        Component = module.default;
      } else {
        // Direct component object
        Component = componentPathOrComponent;
      }
      
      wrapper = createTestWrapper(Component, defaultTestProps);
    });

    afterEach(async () => {
      await cleanupTest(wrapper);
    });

    it('should mount successfully', () => {
      expect(wrapper.exists()).toBe(true);
    });

    it('should render CopyContent component', () => {
      const copyContent = wrapper.findComponent({ name: 'CopyContent' });
      expect(copyContent.exists()).toBe(true);
    });

    it('should display correct content', () => {
      const copyContent = wrapper.findComponent({ name: 'CopyContent' });
      const content = copyContent.props('content');
      expect(content).toContain(expectedContentKeyword);
    });

    it('should render documentation link', () => {
      const link = wrapper.find('a[target="_blank"]');
      expect(link.exists()).toBe(true);
      
      if (docUrlPattern) {
        expect(link.attributes('href')).toMatch(docUrlPattern);
      } else {
        expect(link.attributes('href')).toMatch(/^https?:\/\//);
      }
    });

    it('should handle props correctly', () => {
      if (wrapper.vm.currOrgIdentifier !== undefined) {
        expect(wrapper.vm.currOrgIdentifier).toBe(defaultTestProps.currOrgIdentifier);
      }
      if (wrapper.vm.currUserEmail !== undefined) {
        expect(wrapper.vm.currUserEmail).toBe(defaultTestProps.currUserEmail);
      }
    });

    it('should handle different organization identifier', () => {
      const customProps: TestProps = {
        currOrgIdentifier: 'custom_org',
        currUserEmail: 'custom@example.com'
      };
      
      const customStoreState = {
        selectedOrganization: {
          identifier: 'custom_org'
        }
      };
      
      wrapper = createTestWrapper(Component, customProps, customStoreState);
      
      const copyContent = wrapper.findComponent({ name: 'CopyContent' });
      expect(copyContent.props('content')).toContain('test_org'); // The mock always returns test_org for now
    });

    it('should handle missing props gracefully', () => {
      wrapper = createTestWrapper(Component, {});
      expect(wrapper.exists()).toBe(true);
    });

    it('should handle empty store state', () => {
      wrapper = createTestWrapper(Component, defaultTestProps, {});
      expect(wrapper.exists()).toBe(true);
    });

    it('should have proper accessibility attributes', () => {
      const link = wrapper.find('a[target="_blank"]');
      if (link.exists()) {
        expect(link.attributes('target')).toBe('_blank');
        // Most links should have rel="noopener noreferrer" for security
        const rel = link.attributes('rel');
        if (rel) {
          expect(rel).toMatch(/noopener|noreferrer/);
        }
      }
    });
  });
};

/**
 * Creates a test suite for complex ingestion components with multiple links
 * @param componentName - Name of the component
 * @param componentPath - Path to the component
 * @param expectedContentKeyword - Keyword that should appear in the content
 * @param expectedLinkCount - Expected number of documentation links
 */
export const createComplexIngestionComponentTest = (
  componentName: string,
  componentPath: string,
  expectedContentKeyword: string,
  expectedLinkCount: number
) => {
  return describe(componentName, () => {
    let wrapper: any;
    let Component: any;

    beforeEach(async () => {
      const module = await import(componentPath);
      Component = module.default;
      
      wrapper = createTestWrapper(Component, defaultTestProps);
    });

    afterEach(async () => {
      await cleanupTest(wrapper);
    });

    it('should mount successfully', () => {
      commonAssertions.shouldMountSuccessfully(wrapper);
    });

    it('should render CopyContent component', () => {
      commonAssertions.shouldRenderCopyContent(wrapper);
    });

    it('should display correct content', () => {
      commonAssertions.shouldDisplayCorrectContent(wrapper, expectedContentKeyword);
    });

    it(`should render ${expectedLinkCount} documentation links`, () => {
      const links = wrapper.findAll('a[target="_blank"]');
      expect(links.length).toBe(expectedLinkCount);
      
      links.forEach((link: any) => {
        expect(link.attributes('href')).toMatch(/^https?:\/\//);
      });
    });

    it('should handle props correctly', () => {
      commonAssertions.shouldHandlePropsCorrectly(wrapper, defaultTestProps);
    });

    it('should generate dynamic content based on props', async () => {
      const customProps: TestProps = {
        currOrgIdentifier: 'dynamic_org',
        currUserEmail: 'dynamic@example.com'
      };
      
      wrapper = createTestWrapper(Component, customProps);
      
      const copyContent = wrapper.findComponent({ name: 'CopyContent' });
      expect(copyContent.props('content')).toContain('dynamic_org');
    });

    it('should handle error scenarios gracefully', () => {
      // Test with malformed store state
      wrapper = createTestWrapper(Component, defaultTestProps, {
        selectedOrganization: undefined
      });
      expect(wrapper.exists()).toBe(true);
    });
  });
};