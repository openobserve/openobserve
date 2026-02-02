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
import MarkdownRenderer from "./MarkdownRenderer.vue";

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

vi.mock("marked", () => ({
  marked: vi.fn((content) => {
    // Simple mock implementation to convert basic markdown
    if (!content || typeof content !== 'string') return content;
    
    return content
      .replace(/^# (.*$)/gim, '<h1>$1</h1>')
      .replace(/^## (.*$)/gim, '<h2>$1</h2>')
      .replace(/^### (.*$)/gim, '<h3>$1</h3>')
      .replace(/\*\*(.*)\*\*/gim, '<strong>$1</strong>')
      .replace(/\*(.*)\*/gim, '<em>$1</em>')
      .replace(/^\* (.*$)/gim, '<li>$1</li>')
      .replace(/\[([^\]]*)\]\(([^\)]*)\)/gim, '<a href="$2">$1</a>');
  }),
}));

describe("MarkdownRenderer", () => {
  let wrapper: VueWrapper<any>;

  const createWrapper = (props = {}) => {
    return mount(MarkdownRenderer, {
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
      expect(wrapper.find('[data-test="markdown-renderer"]').exists()).toBe(true);
    });

    it("should have correct component name", () => {
      wrapper = createWrapper();
      
      expect(wrapper.vm.$options.name).toBe("MarkdownRenderer");
    });

    it("should initialize with default prop values", () => {
      wrapper = createWrapper();
      
      expect(wrapper.props('markdownContent')).toBe("");
      expect(wrapper.props('variablesData')).toEqual({});
    });

    it("should accept custom prop values", () => {
      const customProps = {
        markdownContent: "# Test Heading\n\nTest paragraph",
        variablesData: { title: "Test Title" }
      };
      
      wrapper = createWrapper(customProps);
      
      expect(wrapper.props('markdownContent')).toBe("# Test Heading\n\nTest paragraph");
      expect(wrapper.props('variablesData')).toEqual({ title: "Test Title" });
    });
  });

  describe("Markdown Content Rendering", () => {
    it("should render empty content by default", () => {
      wrapper = createWrapper();
      
      const rendererElement = wrapper.find('[data-test="markdown-renderer"]');
      expect(rendererElement.exists()).toBe(true);
      expect(rendererElement.text()).toBe("");
    });

    it("should render markdown content as HTML", () => {
      wrapper = createWrapper({
        markdownContent: "# Test Heading\n\n**Bold text** and *italic text*"
      });
      
      const rendererElement = wrapper.find('[data-test="markdown-renderer"]');
      expect(rendererElement.html()).toContain("<h1>Test Heading</h1>");
      expect(rendererElement.html()).toContain("<strong>Bold text</strong>");
      expect(rendererElement.html()).toContain("<em>italic text</em>");
    });

    it("should update content when markdownContent prop changes", async () => {
      wrapper = createWrapper({
        markdownContent: "# Initial heading"
      });
      
      expect(wrapper.find('[data-test="markdown-renderer"]').html()).toContain("Initial heading");
      
      await wrapper.setProps({ markdownContent: "# Updated heading" });
      
      expect(wrapper.find('[data-test="markdown-renderer"]').html()).toContain("Updated heading");
    });

    it("should handle complex markdown structures", () => {
      const complexMarkdown = `
# Main Title
## Subtitle
### Sub-subtitle

**Bold text** and *italic text*

* List item 1
* List item 2

[Link text](https://example.com)
      `;
      
      wrapper = createWrapper({ markdownContent: complexMarkdown });
      
      const rendererElement = wrapper.find('[data-test="markdown-renderer"]');
      expect(rendererElement.html()).toContain('<h1>Main Title</h1>');
      expect(rendererElement.html()).toContain('<h2>Subtitle</h2>');
      expect(rendererElement.html()).toContain('<h3>Sub-subtitle</h3>');
      expect(rendererElement.html()).toContain('<strong>Bold text</strong>');
      expect(rendererElement.html()).toContain('<em>italic text</em>');
      expect(rendererElement.html()).toContain('<li>List item 1</li>');
      expect(rendererElement.html()).toContain('<a href="https://example.com">Link text</a>');
    });

    it("should handle empty or null markdown content", () => {
      wrapper = createWrapper({ markdownContent: null });
      
      const rendererElement = wrapper.find('[data-test="markdown-renderer"]');
      expect(rendererElement.exists()).toBe(true);
      expect(rendererElement.text()).toBe("");
    });

    it("should process plain text without markdown", () => {
      wrapper = createWrapper({
        markdownContent: "This is plain text without any markdown."
      });
      
      const rendererElement = wrapper.find('[data-test="markdown-renderer"]');
      expect(rendererElement.html()).toContain("This is plain text without any markdown.");
    });
  });

  describe("Variable Processing", () => {
    it("should process variables in markdown content", async () => {
      const { processVariableContent } = await import("@/utils/dashboard/variables/variablesUtils");

      wrapper = createWrapper({
        markdownContent: "# {{title}}\n\nWelcome {{userName}}!",
        variablesData: { title: "Dashboard", userName: "John" }
      });

      expect(processVariableContent).toHaveBeenCalledWith(
        "# {{title}}\n\nWelcome {{userName}}!",
        { title: "Dashboard", userName: "John" },
        { panelId: undefined, tabId: undefined }
      );
    });

    it("should handle variables with no substitution data", () => {
      wrapper = createWrapper({
        markdownContent: "# Hello {{name}}",
        variablesData: {}
      });
      
      const rendererElement = wrapper.find('[data-test="markdown-renderer"]');
      expect(rendererElement.html()).toContain("Hello {{name}}");
    });

    it("should update processed content when variables change", async () => {
      wrapper = createWrapper({
        markdownContent: "# {{title}}",
        variablesData: { title: "Original" }
      });
      
      const rendererElement = wrapper.find('[data-test="markdown-renderer"]');
      expect(rendererElement.html()).toContain("Original");
      
      await wrapper.setProps({ variablesData: { title: "Updated" } });
      
      expect(rendererElement.html()).toContain("Updated");
    });

    it("should handle markdown syntax in variables", () => {
      wrapper = createWrapper({
        markdownContent: "{{content}}",
        variablesData: { content: "**Bold** and *italic*" }
      });
      
      const rendererElement = wrapper.find('[data-test="markdown-renderer"]');
      expect(rendererElement.html()).toContain("<strong>Bold</strong>");
      expect(rendererElement.html()).toContain("<em>italic</em>");
    });

    it("should handle complex variable structures", () => {
      wrapper = createWrapper({
        markdownContent: "# {{user.name}}\n\nEmail: {{user.email}}\n\nCount: {{count}}",
        variablesData: {
          user: { name: "John", email: "john@test.com" },
          count: 42
        }
      });
      
      // Variable processing is handled by the mocked function
      expect(wrapper.find('[data-test="markdown-renderer"]').exists()).toBe(true);
    });

    it("should handle undefined variables data", () => {
      wrapper = createWrapper({
        markdownContent: "# {{title}}",
        variablesData: undefined
      });
      
      const rendererElement = wrapper.find('[data-test="markdown-renderer"]');
      expect(rendererElement.exists()).toBe(true);
    });
  });

  describe("Theme Support", () => {
    it("should apply light theme classes by default", () => {
      wrapper = createWrapper();
      
      const rendererElement = wrapper.find('[data-test="markdown-renderer"]');
      expect(rendererElement.classes()).toContain('tw:prose');
      expect(rendererElement.classes()).toContain('tw:prose-sm');
      expect(rendererElement.classes()).toContain('tw:max-w-none');
      expect(rendererElement.classes()).not.toContain('tw:prose-invert');
    });

    it("should apply dark theme classes when theme is dark", () => {
      // Create wrapper with dark theme store from the start
      wrapper = mount(MarkdownRenderer, {
        global: {
          plugins: [Quasar],
          mocks: {
            store: {
              state: { theme: "dark" }
            }
          }
        }
      });
      
      const rendererElement = wrapper.find('[data-test="markdown-renderer"]');
      expect(rendererElement.classes()).toContain('tw:prose');
      expect(rendererElement.classes()).toContain('tw:prose-invert');
    });

    it("should toggle theme classes when theme changes", async () => {
      // Test light theme first
      wrapper = createWrapper();
      
      let rendererElement = wrapper.find('[data-test="markdown-renderer"]');
      expect(rendererElement.classes()).not.toContain('tw:prose-invert');
      
      // Unmount and recreate with dark theme to test the toggle effect
      wrapper.unmount();
      
      wrapper = mount(MarkdownRenderer, {
        global: {
          plugins: [Quasar],
          mocks: {
            store: {
              state: { theme: "dark" }
            }
          }
        }
      });
      
      rendererElement = wrapper.find('[data-test="markdown-renderer"]');
      expect(rendererElement.classes()).toContain('tw:prose-invert');
    });

    it("should maintain theme classes with content updates", async () => {
      wrapper = mount(MarkdownRenderer, {
        props: {
          markdownContent: "# Initial content"
        },
        global: {
          plugins: [Quasar],
          mocks: {
            store: {
              state: { theme: "dark" }
            }
          }
        }
      });
      
      await wrapper.setProps({ markdownContent: "# Updated content" });
      
      const rendererElement = wrapper.find('[data-test="markdown-renderer"]');
      expect(rendererElement.classes()).toContain('tw:prose-invert');
      expect(rendererElement.html()).toContain("Updated content");
    });
  });

  describe("Marked Integration", () => {
    it("should use marked library to convert markdown", async () => {
      const { marked } = await import("marked");
      
      wrapper = createWrapper({
        markdownContent: "# Heading\n\n**Bold text**"
      });
      
      expect(marked).toHaveBeenCalled();
    });

    it("should handle marked conversion on every render", async () => {
      const { marked } = await import("marked");
      
      wrapper = createWrapper({
        markdownContent: "# Initial"
      });
      
      const initialCallCount = marked.mock.calls.length;
      
      await wrapper.setProps({ markdownContent: "# Updated" });
      
      expect(marked.mock.calls.length).toBeGreaterThan(initialCallCount);
    });

    it("should handle marked conversion of processed variables", () => {
      wrapper = createWrapper({
        markdownContent: "# {{title}}\n\n{{content}}",
        variablesData: { 
          title: "Variable Title",
          content: "**Variable bold text**"
        }
      });
      
      const rendererElement = wrapper.find('[data-test="markdown-renderer"]');
      expect(rendererElement.exists()).toBe(true);
    });
  });

  describe("DOMPurify Integration", () => {
    it("should sanitize converted HTML using DOMPurify", async () => {
      const DOMPurify = (await import("dompurify")).default;
      
      wrapper = createWrapper({
        markdownContent: "# Safe Heading\n\n[Link](javascript:alert('xss'))"
      });
      
      expect(DOMPurify.sanitize).toHaveBeenCalled();
    });

    it("should sanitize content on every render", async () => {
      const DOMPurify = (await import("dompurify")).default;
      
      wrapper = createWrapper({
        markdownContent: "# Initial"
      });
      
      const initialCallCount = DOMPurify.sanitize.mock.calls.length;
      
      await wrapper.setProps({ markdownContent: "# Updated" });
      
      expect(DOMPurify.sanitize.mock.calls.length).toBeGreaterThan(initialCallCount);
    });

    it("should handle DOMPurify sanitization of processed markdown", () => {
      wrapper = createWrapper({
        markdownContent: "{{content}}",
        variablesData: { content: "# Title\n\n[Safe link](http://example.com)" }
      });
      
      const rendererElement = wrapper.find('[data-test="markdown-renderer"]');
      expect(rendererElement.exists()).toBe(true);
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
      expect(container.attributes('style')).toContain('padding: 1%');
    });

    it("should maintain responsive design classes", () => {
      wrapper = createWrapper();
      
      const rendererElement = wrapper.find('[data-test="markdown-renderer"]');
      expect(rendererElement.classes()).toContain('tw:prose');
      expect(rendererElement.classes()).toContain('tw:prose-sm');
      expect(rendererElement.classes()).toContain('tw:max-w-none');
    });

    it("should handle overflow content properly", () => {
      const longContent = "# Long heading\n\n".repeat(100) + "Long content paragraph.".repeat(100);
      
      wrapper = createWrapper({ markdownContent: longContent });
      
      const container = wrapper.find('.scroll');
      expect(container.attributes('style')).toContain('overflow: auto');
    });
  });

  describe("Props Validation and Edge Cases", () => {
    it("should handle string markdownContent prop", () => {
      wrapper = createWrapper({
        markdownContent: "# String content"
      });
      
      expect(wrapper.props('markdownContent')).toBe("# String content");
    });

    it("should handle empty string markdownContent", () => {
      wrapper = createWrapper({
        markdownContent: ""
      });
      
      const rendererElement = wrapper.find('[data-test="markdown-renderer"]');
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
        markdownContent: "# Initial",
        variablesData: { value: "initial" }
      });
      
      for (let i = 0; i < 5; i++) {
        await wrapper.setProps({
          markdownContent: `# Content ${i}`,
          variablesData: { value: `value${i}` }
        });
      }
      
      expect(wrapper.find('[data-test="markdown-renderer"]').html()).toContain("Content 4");
    });

    it("should handle markdown with special characters", () => {
      const specialMarkdown = "# Title with & < > characters\n\n**Bold & italic**";
      
      wrapper = createWrapper({ markdownContent: specialMarkdown });
      
      expect(wrapper.exists()).toBe(true);
    });
  });

  describe("Component Lifecycle", () => {
    it("should initialize computed properties correctly", () => {
      wrapper = createWrapper({
        markdownContent: "# {{test}}",
        variablesData: { test: "value" }
      });
      
      expect(wrapper.vm.processedContent).toBeDefined();
      expect(wrapper.vm.DOMPurify).toBeDefined();
      expect(wrapper.vm.marked).toBeDefined();
      expect(wrapper.vm.store).toBeDefined();
    });

    it("should handle component unmounting cleanly", () => {
      wrapper = createWrapper();
      
      expect(() => wrapper.unmount()).not.toThrow();
    });

    it("should maintain reactivity for computed properties", async () => {
      wrapper = createWrapper({
        markdownContent: "# {{title}}",
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
    it("should handle malformed markdown gracefully", () => {
      const malformedMarkdown = "# Unclosed **bold and *italic";
      
      expect(() => {
        wrapper = createWrapper({ markdownContent: malformedMarkdown });
      }).not.toThrow();
      
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle null or undefined props gracefully", () => {
      expect(() => {
        wrapper = createWrapper({
          markdownContent: null,
          variablesData: null
        });
      }).not.toThrow();
      
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle very large markdown content", () => {
      const largeContent = "# Large heading\n\nLarge content paragraph.".repeat(1000);
      
      expect(() => {
        wrapper = createWrapper({ markdownContent: largeContent });
      }).not.toThrow();
      
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle mixed markdown and HTML", () => {
      const mixedContent = "# Markdown Title\n\n<div>HTML content</div>\n\n**Bold markdown**";
      
      wrapper = createWrapper({ markdownContent: mixedContent });
      
      expect(wrapper.exists()).toBe(true);
      const rendererElement = wrapper.find('[data-test="markdown-renderer"]');
      expect(rendererElement.html()).toContain("<h1>Markdown Title</h1>");
      expect(rendererElement.html()).toContain("<strong>Bold markdown</strong>");
    });

    it("should handle markdown with code blocks", () => {
      const markdownWithCode = "# Title\n\n```javascript\nconst x = 5;\n```\n\nNormal text.";
      
      wrapper = createWrapper({ markdownContent: markdownWithCode });
      
      expect(wrapper.exists()).toBe(true);
    });
  });
});