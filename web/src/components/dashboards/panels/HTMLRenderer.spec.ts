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

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import { Quasar } from "quasar";
import HTMLRenderer from "./HTMLRenderer.vue";

// Mock external dependencies
vi.mock("vuex", () => ({
  useStore: () => ({
    state: {
      theme: "light",
    },
  }),
}));

vi.mock("@/utils/dashboard/variables/variablesUtils", () => ({
  processVariableContent: vi.fn((content, variables, context) => {
    // Simple mock implementation that replaces {{variable}} patterns
    if (!content || typeof content !== 'string') return content;

    let processedContent = content;
    for (const [key, value] of Object.entries(variables || {})) {
      const regex = new RegExp(`{{\\s*${key}\\s*}}`, 'g');
      processedContent = processedContent.replace(regex, String(value));
    }
    return processedContent;
  }),
}));

vi.mock("dompurify", () => ({
  default: {
    sanitize: vi.fn((content) => content), // Pass through for testing
  },
}));

describe("HTMLRenderer", () => {
  let wrapper: VueWrapper<any>;

  const createWrapper = (props = {}) => {
    return mount(HTMLRenderer, {
      props,
      global: {
        plugins: [Quasar],
      },
    });
  };

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  describe("Component Initialization", () => {
    it("should render correctly with default props", () => {
      wrapper = createWrapper();
      
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.find('[data-test="html-renderer"]').exists()).toBe(true);
    });

    it("should have correct component name", () => {
      wrapper = createWrapper();
      
      expect(wrapper.vm.$options.name).toBe("HTMLRenderer");
    });

    it("should initialize with default prop values", () => {
      wrapper = createWrapper();
      
      expect(wrapper.props('htmlContent')).toBe("");
      expect(wrapper.props('variablesData')).toEqual({});
    });

    it("should accept custom prop values", () => {
      const customProps = {
        htmlContent: "<h1>Test Content</h1>",
        variablesData: { title: "Test Title" }
      };
      
      wrapper = createWrapper(customProps);
      
      expect(wrapper.props('htmlContent')).toBe("<h1>Test Content</h1>");
      expect(wrapper.props('variablesData')).toEqual({ title: "Test Title" });
    });
  });

  describe("HTML Content Rendering", () => {
    it("should render empty content by default", () => {
      wrapper = createWrapper();
      
      const rendererElement = wrapper.find('[data-test="html-renderer"]');
      expect(rendererElement.exists()).toBe(true);
      expect(rendererElement.text()).toBe("");
    });

    it("should render provided HTML content", () => {
      wrapper = createWrapper({
        htmlContent: "<h1>Test Heading</h1><p>Test paragraph</p>"
      });
      
      const rendererElement = wrapper.find('[data-test="html-renderer"]');
      expect(rendererElement.html()).toContain("<h1>Test Heading</h1>");
      expect(rendererElement.html()).toContain("<p>Test paragraph</p>");
    });

    it("should update content when htmlContent prop changes", async () => {
      wrapper = createWrapper({
        htmlContent: "<p>Initial content</p>"
      });
      
      expect(wrapper.find('[data-test="html-renderer"]').html()).toContain("Initial content");
      
      await wrapper.setProps({ htmlContent: "<p>Updated content</p>" });
      
      expect(wrapper.find('[data-test="html-renderer"]').html()).toContain("Updated content");
    });

    it("should handle complex HTML structures", () => {
      const complexHtml = `
        <div class="container">
          <h1>Title</h1>
          <ul>
            <li>Item 1</li>
            <li>Item 2</li>
          </ul>
          <img src="test.jpg" alt="Test Image" />
        </div>
      `;
      
      wrapper = createWrapper({ htmlContent: complexHtml });
      
      const rendererElement = wrapper.find('[data-test="html-renderer"]');
      expect(rendererElement.html()).toContain('class="container"');
      expect(rendererElement.html()).toContain("<h1>Title</h1>");
      expect(rendererElement.html()).toContain("<ul>");
      expect(rendererElement.html()).toContain('<img src="test.jpg"');
    });

    it("should handle empty or null HTML content", () => {
      wrapper = createWrapper({ htmlContent: null });
      
      const rendererElement = wrapper.find('[data-test="html-renderer"]');
      expect(rendererElement.exists()).toBe(true);
      expect(rendererElement.text()).toBe("");
    });
  });

  describe("Variable Processing", () => {
    it("should process variables in HTML content", async () => {
      const { processVariableContent } = await import("@/utils/dashboard/variables/variablesUtils");

      wrapper = createWrapper({
        htmlContent: "<h1>{{title}}</h1><p>Welcome {{userName}}</p>",
        variablesData: { title: "Dashboard", userName: "John" }
      });

      expect(processVariableContent).toHaveBeenCalledWith(
        "<h1>{{title}}</h1><p>Welcome {{userName}}</p>",
        { title: "Dashboard", userName: "John" },
        { panelId: undefined, tabId: undefined }
      );
    });

    it("should handle variables with no substitution data", () => {
      wrapper = createWrapper({
        htmlContent: "<p>Hello {{name}}</p>",
        variablesData: {}
      });
      
      const rendererElement = wrapper.find('[data-test="html-renderer"]');
      expect(rendererElement.html()).toContain("Hello {{name}}");
    });

    it("should update processed content when variables change", async () => {
      wrapper = createWrapper({
        htmlContent: "<h1>{{title}}</h1>",
        variablesData: { title: "Original" }
      });
      
      const rendererElement = wrapper.find('[data-test="html-renderer"]');
      expect(rendererElement.html()).toContain("Original");
      
      await wrapper.setProps({ variablesData: { title: "Updated" } });
      
      expect(rendererElement.html()).toContain("Updated");
    });

    it("should handle complex variable structures", () => {
      wrapper = createWrapper({
        htmlContent: "<div>{{user.name}} - {{user.email}} - {{count}}</div>",
        variablesData: {
          user: { name: "John", email: "john@test.com" },
          count: 42
        }
      });
      
      // Variable processing is handled by the mocked function
      expect(wrapper.find('[data-test="html-renderer"]').exists()).toBe(true);
    });

    it("should handle undefined variables data", () => {
      wrapper = createWrapper({
        htmlContent: "<p>{{title}}</p>",
        variablesData: undefined
      });
      
      const rendererElement = wrapper.find('[data-test="html-renderer"]');
      expect(rendererElement.exists()).toBe(true);
    });
  });

  describe("Theme Support", () => {
    it("should apply light theme classes by default", () => {
      wrapper = createWrapper();
      
      const rendererElement = wrapper.find('[data-test="html-renderer"]');
      expect(rendererElement.classes()).toContain('tw:prose');
      expect(rendererElement.classes()).toContain('tw:prose-sm');
      expect(rendererElement.classes()).toContain('tw:max-w-none');
      expect(rendererElement.classes()).not.toContain('tw:prose-invert');
    });

    it("should apply dark theme classes when theme is dark", () => {
      // Create wrapper with dark theme store from the start
      wrapper = mount(HTMLRenderer, {
        global: {
          plugins: [Quasar],
          mocks: {
            store: {
              state: { theme: "dark" }
            }
          }
        }
      });
      
      const rendererElement = wrapper.find('[data-test="html-renderer"]');
      expect(rendererElement.classes()).toContain('tw:prose');
      expect(rendererElement.classes()).toContain('tw:prose-invert');
    });

    it("should toggle theme classes when theme changes", async () => {
      // Test light theme first
      wrapper = createWrapper();
      
      let rendererElement = wrapper.find('[data-test="html-renderer"]');
      expect(rendererElement.classes()).not.toContain('tw:prose-invert');
      
      // Unmount and recreate with dark theme to test the toggle effect
      wrapper.unmount();
      
      wrapper = mount(HTMLRenderer, {
        global: {
          plugins: [Quasar],
          mocks: {
            store: {
              state: { theme: "dark" }
            }
          }
        }
      });
      
      rendererElement = wrapper.find('[data-test="html-renderer"]');
      expect(rendererElement.classes()).toContain('tw:prose-invert');
    });

    it("should maintain theme classes with content updates", async () => {
      wrapper = createWrapper({
        htmlContent: "<p>Initial content</p>"
      });
      
      wrapper.vm.store.state.theme = "dark";
      await wrapper.vm.$nextTick();
      
      await wrapper.setProps({ htmlContent: "<p>Updated content</p>" });
      
      const rendererElement = wrapper.find('[data-test="html-renderer"]');
      expect(rendererElement.classes()).toContain('tw:prose-invert');
      expect(rendererElement.html()).toContain("Updated content");
    });
  });

  describe("DOMPurify Integration", () => {
    it("should sanitize HTML content using DOMPurify", async () => {
      const DOMPurify = (await import("dompurify")).default;
      
      wrapper = createWrapper({
        htmlContent: "<script>alert('xss')</script><p>Safe content</p>"
      });
      
      expect(DOMPurify.sanitize).toHaveBeenCalled();
    });

    it("should sanitize content on every render", async () => {
      const DOMPurify = (await import("dompurify")).default;
      
      wrapper = createWrapper({
        htmlContent: "<p>Initial</p>"
      });
      
      const initialCallCount = DOMPurify.sanitize.mock.calls.length;
      
      await wrapper.setProps({ htmlContent: "<p>Updated</p>" });
      
      expect(DOMPurify.sanitize.mock.calls.length).toBeGreaterThan(initialCallCount);
    });

    it("should handle DOMPurify sanitization of processed variables", async () => {
      wrapper = createWrapper({
        htmlContent: "<p>{{content}}</p>",
        variablesData: { content: "<script>alert('test')</script>Safe text" }
      });
      
      const DOMPurify = (await import("dompurify")).default;
      expect(DOMPurify.sanitize).toHaveBeenCalled();
    });
  });

  describe("Layout and Styling", () => {
    it("should have correct container styling", () => {
      wrapper = createWrapper();
      
      const container = wrapper.find('.scroll');
      expect(container.exists()).toBe(true);
      expect(container.attributes('style')).toContain('width: 100%');
      expect(container.attributes('style')).toContain('height: 100%');
      expect(container.attributes('style')).toContain('overflow: auto');
    });

    it("should maintain responsive design classes", () => {
      wrapper = createWrapper();
      
      const rendererElement = wrapper.find('[data-test="html-renderer"]');
      expect(rendererElement.classes()).toContain('tw:prose');
      expect(rendererElement.classes()).toContain('tw:prose-sm');
      expect(rendererElement.classes()).toContain('tw:max-w-none');
    });

    it("should handle overflow content properly", () => {
      const longContent = "<p>".repeat(100) + "Long content</p>".repeat(100);
      
      wrapper = createWrapper({ htmlContent: longContent });
      
      const container = wrapper.find('.scroll');
      expect(container.attributes('style')).toContain('overflow: auto');
    });
  });

  describe("Props Validation and Edge Cases", () => {
    it("should handle string htmlContent prop", () => {
      wrapper = createWrapper({
        htmlContent: "<p>String content</p>"
      });
      
      expect(wrapper.props('htmlContent')).toBe("<p>String content</p>");
    });

    it("should handle empty string htmlContent", () => {
      wrapper = createWrapper({
        htmlContent: ""
      });
      
      const rendererElement = wrapper.find('[data-test="html-renderer"]');
      expect(rendererElement.text()).toBe("");
    });

    it("should handle object variablesData prop", () => {
      const variablesData = {
        title: "Test",
        count: 123,
        nested: { value: "deep" }
      };
      
      wrapper = createWrapper({ variablesData });
      
      expect(wrapper.props('variablesData')).toEqual(variablesData);
    });

    it("should handle empty variablesData object", () => {
      wrapper = createWrapper({
        variablesData: {}
      });
      
      expect(wrapper.props('variablesData')).toEqual({});
    });

    it("should handle rapid prop changes", async () => {
      wrapper = createWrapper({
        htmlContent: "<p>Initial</p>",
        variablesData: { value: "initial" }
      });
      
      for (let i = 0; i < 5; i++) {
        await wrapper.setProps({
          htmlContent: `<p>Content ${i}</p>`,
          variablesData: { value: `value${i}` }
        });
      }
      
      expect(wrapper.find('[data-test="html-renderer"]').html()).toContain("Content 4");
    });
  });

  describe("Component Lifecycle", () => {
    it("should initialize computed properties correctly", () => {
      wrapper = createWrapper({
        htmlContent: "<p>{{test}}</p>",
        variablesData: { test: "value" }
      });
      
      expect(wrapper.vm.processedContent).toBeDefined();
      expect(wrapper.vm.DOMPurify).toBeDefined();
      expect(wrapper.vm.store).toBeDefined();
    });

    it("should handle component unmounting cleanly", () => {
      wrapper = createWrapper();
      
      expect(() => wrapper.unmount()).not.toThrow();
    });

    it("should maintain reactivity for computed properties", async () => {
      wrapper = createWrapper({
        htmlContent: "<p>{{title}}</p>",
        variablesData: { title: "Initial" }
      });
      
      const initialProcessed = wrapper.vm.processedContent;
      
      await wrapper.setProps({
        variablesData: { title: "Updated" }
      });
      
      expect(wrapper.vm.processedContent).not.toBe(initialProcessed);
    });
  });

  describe("Error Handling", () => {
    it("should handle malformed HTML gracefully", () => {
      const malformedHtml = "<div><p>Unclosed tags<div><span>";
      
      expect(() => {
        wrapper = createWrapper({ htmlContent: malformedHtml });
      }).not.toThrow();
      
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle null or undefined props gracefully", () => {
      expect(() => {
        wrapper = createWrapper({
          htmlContent: null,
          variablesData: null
        });
      }).not.toThrow();
      
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle very large content", () => {
      const largeContent = "<p>Large content</p>".repeat(1000);
      
      expect(() => {
        wrapper = createWrapper({ htmlContent: largeContent });
      }).not.toThrow();
      
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle special characters in content", () => {
      const specialContent = "<p>Special characters: &amp; &lt; &gt;</p>";
      
      wrapper = createWrapper({ htmlContent: specialContent });
      
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.find('[data-test="html-renderer"]').exists()).toBe(true);
    });
  });
});