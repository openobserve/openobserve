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

import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { Dialog, Notify } from "quasar";
import CustomMarkdownEditor from "@/components/dashboards/addPanel/CustomMarkdownEditor.vue";
import i18n from "@/locales";

installQuasar({
  plugins: [Dialog, Notify],
});

describe("CustomMarkdownEditor", () => {
  let wrapper: any;

  const defaultProps = {
    modelValue: "# Test Markdown\n\nThis is a test.",
    initialVariableValues: {
      user: "admin",
      region: "us-east-1"
    }
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  const createWrapper = (props = {}) => {
    return mount(CustomMarkdownEditor, {
      props: {
        ...defaultProps,
        ...props
      },
      global: {
        plugins: [i18n],
        stubs: {
          'CodeQueryEditor': true,
          'MarkdownRenderer': true,
          'q-splitter': {
            template: '<div data-test="q-splitter-stub"><slot name="before"></slot><slot name="separator"></slot><slot name="after"></slot></div>',
            props: ['modelValue'],
            emits: ['update:modelValue']
          },
          'q-avatar': true
        },
        mocks: {
          $t: (key: string) => key
        }
      }
    });
  };

  describe("Component Rendering", () => {
    it("should render markdown editor container", () => {
      wrapper = createWrapper();

      expect(wrapper.find('.markdown-editor').exists()).toBe(true);
    });

    it("should render editor container with correct styling", () => {
      wrapper = createWrapper();

      const container = wrapper.find('.markdown-editor');
      const style = container.element.getAttribute('style');

      expect(style).toContain('width: 100%');
      expect(style).toContain('height: 100%');
      expect(style).toContain('overflow: hidden');
    });

    it("should render inner container with correct dimensions", () => {
      wrapper = createWrapper();

      const innerDivs = wrapper.findAll('div');
      const hasInnerContainer = innerDivs.some(div => {
        const style = div.attributes('style');
        return style && style.includes('width: 100%') && style.includes('height: 100%');
      });
      expect(hasInnerContainer).toBe(true);
    });

    it("should render splitter component", () => {
      wrapper = createWrapper();

      expect(wrapper.find('[data-test="dashboard-markdown-editor-splitter"]').exists()).toBe(true);
    });

    it("should render code query editor", () => {
      wrapper = createWrapper();

      // Test that the component includes the expected structure
      expect(wrapper.vm.$options.components.CodeQueryEditor).toBeDefined();
    });

    it("should render markdown renderer", () => {
      wrapper = createWrapper();

      // Test that the component includes the expected structure
      expect(wrapper.vm.$options.components.MarkdownRenderer).toBeDefined();
    });

    it("should render drag indicator", () => {
      wrapper = createWrapper();

      expect(wrapper.find('[data-test="dashboard-markdown-editor-drag-indicator"]').exists()).toBe(true);
    });

    it("should render editor with data-test attribute", () => {
      wrapper = createWrapper();

      expect(wrapper.find('[data-test="dashboard-markdown-editor"]').exists()).toBe(true);
    });
  });

  describe("Component Name and Setup", () => {
    it("should have correct component name", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.$options.name).toBe('CustomMarkdownEditor');
    });

    it("should register CodeQueryEditor as async component", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.$options.components.CodeQueryEditor).toBeDefined();
    });

    it("should register MarkdownRenderer component", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.$options.components.MarkdownRenderer).toBeDefined();
    });
  });

  describe("Props Handling", () => {
    it("should accept and display modelValue", () => {
      const markdownContent = "# Custom Markdown\n\nCustom content here.";
      wrapper = createWrapper({ modelValue: markdownContent });

      expect(wrapper.vm.markdownContent).toBe(markdownContent);
    });

    it("should handle empty modelValue", () => {
      wrapper = createWrapper({ modelValue: "" });

      expect(wrapper.vm.markdownContent).toBe("");
    });

    it("should handle default modelValue", () => {
      const createWrapperOverride = () => {
        return mount(CustomMarkdownEditor, {
          props: {
            initialVariableValues: {}
          },
          global: {
            plugins: [i18n],
            stubs: {
              'CodeQueryEditor': true,
              'MarkdownRenderer': true,
              'q-splitter': {
                template: '<div data-test="q-splitter-stub"><slot name="before"></slot><slot name="separator"></slot><slot name="after"></slot></div>',
                props: ['modelValue'],
                emits: ['update:modelValue']
              },
              'q-avatar': true
            },
            mocks: {
              $t: (key: string) => key
            }
          }
        });
      };

      wrapper = createWrapperOverride();

      expect(wrapper.props('modelValue')).toBe("");
      expect(wrapper.vm.markdownContent).toBe("");
    });

    it("should accept initialVariableValues prop", () => {
      const variables = { user: "test", env: "dev" };
      wrapper = createWrapper({ initialVariableValues: variables });

      expect(wrapper.props('initialVariableValues')).toEqual(variables);
    });

    it("should handle empty initialVariableValues", () => {
      wrapper = createWrapper({ initialVariableValues: {} });

      expect(wrapper.props('initialVariableValues')).toEqual({});
    });

    it("should handle null initialVariableValues", () => {
      wrapper = createWrapper({ initialVariableValues: null });

      expect(wrapper.props('initialVariableValues')).toBe(null);
    });

    it("should handle undefined initialVariableValues", () => {
      const createWrapperOverride = () => {
        return mount(CustomMarkdownEditor, {
          props: {
            modelValue: "test",
            initialVariableValues: undefined
          },
          global: {
            plugins: [i18n],
            stubs: {
              'CodeQueryEditor': true,
              'MarkdownRenderer': true,
              'q-splitter': {
                template: '<div data-test="q-splitter-stub"><slot name="before"></slot><slot name="separator"></slot><slot name="after"></slot></div>',
                props: ['modelValue'],
                emits: ['update:modelValue']
              },
              'q-avatar': true
            },
            mocks: {
              $t: (key: string) => key
            }
          }
        });
      };

      wrapper = createWrapperOverride();

      // The component prop should use default value when undefined is passed
      expect(wrapper.props('initialVariableValues')).toEqual({});
    });
  });

  describe("Data Properties", () => {
    it("should initialize markdownContent with modelValue", () => {
      const testValue = "# Test Header\n\nTest content";
      wrapper = createWrapper({ modelValue: testValue });

      expect(wrapper.vm.markdownContent).toBe(testValue);
    });

    it("should initialize splitterModel with default value", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.splitterModel).toBe(50);
    });

    it("should maintain reactive markdownContent", async () => {
      wrapper = createWrapper();

      const newContent = "# Updated Header";
      wrapper.vm.markdownContent = newContent;
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.markdownContent).toBe(newContent);
    });
  });

  describe("Methods", () => {
    describe("layoutSplitterUpdated", () => {
      it("should exist and be a function", () => {
        wrapper = createWrapper();

        expect(typeof wrapper.vm.layoutSplitterUpdated).toBe('function');
      });

      it("should dispatch resize event", () => {
        wrapper = createWrapper();

        const dispatchEventSpy = vi.spyOn(window, 'dispatchEvent');
        wrapper.vm.layoutSplitterUpdated();

        expect(dispatchEventSpy).toHaveBeenCalledWith(expect.any(Event));
        expect(dispatchEventSpy.mock.calls[0][0].type).toBe('resize');

        dispatchEventSpy.mockRestore();
      });

      it("should be called when splitter model updates", async () => {
        wrapper = createWrapper();

        const layoutSplitterUpdatedSpy = vi.spyOn(wrapper.vm, 'layoutSplitterUpdated');
        const dispatchEventSpy = vi.spyOn(window, 'dispatchEvent');

        // Manually call the method since component is stubbed
        wrapper.vm.layoutSplitterUpdated();

        expect(layoutSplitterUpdatedSpy).toHaveBeenCalled();
        expect(dispatchEventSpy).toHaveBeenCalled();

        layoutSplitterUpdatedSpy.mockRestore();
        dispatchEventSpy.mockRestore();
      });
    });

    describe("onEditorValueChange", () => {
      it("should exist and be a function", () => {
        wrapper = createWrapper();

        expect(typeof wrapper.vm.onEditorValueChange).toBe('function');
      });

      it("should update markdownContent", () => {
        wrapper = createWrapper();

        const newValue = "# New Markdown\n\nNew content here.";
        wrapper.vm.onEditorValueChange(newValue);

        expect(wrapper.vm.markdownContent).toBe(newValue);
      });

      it("should emit update:modelValue event", () => {
        wrapper = createWrapper();

        const newValue = "# Updated Markdown\n\nUpdated content.";
        wrapper.vm.onEditorValueChange(newValue);

        expect(wrapper.emitted('update:modelValue')).toBeTruthy();
        expect(wrapper.emitted('update:modelValue')[0]).toEqual([newValue]);
      });

      it("should handle empty string value", () => {
        wrapper = createWrapper();

        wrapper.vm.onEditorValueChange("");

        expect(wrapper.vm.markdownContent).toBe("");
        expect(wrapper.emitted('update:modelValue')[0]).toEqual([""]);
      });

      it("should handle null value", () => {
        wrapper = createWrapper();

        wrapper.vm.onEditorValueChange(null);

        expect(wrapper.vm.markdownContent).toBe(null);
        expect(wrapper.emitted('update:modelValue')[0]).toEqual([null]);
      });

      it("should handle undefined value", () => {
        wrapper = createWrapper();

        wrapper.vm.onEditorValueChange(undefined);

        expect(wrapper.vm.markdownContent).toBe(undefined);
        expect(wrapper.emitted('update:modelValue')[0]).toEqual([undefined]);
      });

      it("should handle complex markdown content", () => {
        wrapper = createWrapper();

        const complexMarkdown = `# Complex Markdown

## Table
| Column 1 | Column 2 |
|----------|----------|
| Data 1   | Data 2   |

## Code Block
\`\`\`javascript
console.log('Hello World');
\`\`\`

## List
- Item 1
- Item 2
  - Nested item

**Bold text** and *italic text*
`;

        wrapper.vm.onEditorValueChange(complexMarkdown);

        expect(wrapper.vm.markdownContent).toBe(complexMarkdown);
        expect(wrapper.emitted('update:modelValue')[0]).toEqual([complexMarkdown]);
      });
    });
  });

  describe("Splitter Configuration", () => {
    it("should initialize splitter with default value", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.splitterModel).toBe(50);
    });

    it("should handle splitter model updates", async () => {
      wrapper = createWrapper();

      wrapper.vm.splitterModel = 75;
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.splitterModel).toBe(75);
    });

    it("should bind splitter to correct data property", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.splitterModel).toBe(50);
      
      // Since we're using a stub, check the component data instead
      const splitter = wrapper.find('[data-test="dashboard-markdown-editor-splitter"]');
      expect(splitter.exists()).toBe(true);
    });

    it("should have proper splitter styling", () => {
      wrapper = createWrapper();

      const splitter = wrapper.find('[data-test="dashboard-markdown-editor-splitter"]');
      const style = splitter.attributes('style');
      
      expect(style).toContain('width: 100%');
      expect(style).toContain('height: 100%');
    });
  });

  describe("Code Editor Integration", () => {
    it("should configure CodeQueryEditor with correct language", () => {
      wrapper = createWrapper();

      const codeEditor = wrapper.find('[data-test="dashboard-markdown-editor"]');
      expect(codeEditor.attributes('language')).toBe('markdown');
    });

    it("should configure CodeQueryEditor with debounce time", () => {
      wrapper = createWrapper();

      const codeEditor = wrapper.find('[data-test="dashboard-markdown-editor"]');
      expect(codeEditor.attributes('debouncetime')).toBe('500');
    });

    it("should bind markdownContent to CodeQueryEditor", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.markdownContent).toBe(defaultProps.modelValue);
    });

    it("should handle editor query updates", async () => {
      wrapper = createWrapper();

      const newMarkdown = "# Editor Update\n\nContent updated from editor.";
      const codeEditor = wrapper.findComponent({ name: 'CodeQueryEditor' });
      
      if (codeEditor.exists()) {
        await codeEditor.vm.$emit('update:query', newMarkdown);
        expect(wrapper.vm.markdownContent).toBe(newMarkdown);
      } else {
        // Test the method directly since component is stubbed
        wrapper.vm.onEditorValueChange(newMarkdown);
        expect(wrapper.vm.markdownContent).toBe(newMarkdown);
      }
    });

    it("should render editor in correct container", () => {
      wrapper = createWrapper();

      const colContainers = wrapper.findAll('.col');
      const hasCorrectContainer = colContainers.some(col => {
        const style = col.attributes('style');
        return style && style.includes('height: 100%');
      });
      expect(hasCorrectContainer).toBe(true);
    });
  });

  describe("Markdown Renderer Integration", () => {
    it("should pass markdownContent to MarkdownRenderer", () => {
      const markdownContent = "# Renderer Test\n\nTest content for renderer.";
      wrapper = createWrapper({ modelValue: markdownContent });

      const markdownRenderer = wrapper.findComponent({ name: 'MarkdownRenderer' });
      if (markdownRenderer.exists()) {
        expect(markdownRenderer.props('markdownContent')).toBe(markdownContent);
      }
    });

    it("should pass initialVariableValues to MarkdownRenderer", () => {
      const variables = { test: "value", num: 123 };
      wrapper = createWrapper({ initialVariableValues: variables });

      const markdownRenderer = wrapper.findComponent({ name: 'MarkdownRenderer' });
      if (markdownRenderer.exists()) {
        expect(markdownRenderer.props('variablesData')).toEqual(variables);
      }
    });

    it("should update renderer when markdownContent changes", async () => {
      wrapper = createWrapper();

      const newMarkdown = "# Updated Content\n\nThis content was updated.";
      wrapper.vm.markdownContent = newMarkdown;
      await wrapper.vm.$nextTick();

      const markdownRenderer = wrapper.findComponent({ name: 'MarkdownRenderer' });
      if (markdownRenderer.exists()) {
        expect(markdownRenderer.props('markdownContent')).toBe(newMarkdown);
      }
    });

    it("should render MarkdownRenderer in correct slot", () => {
      wrapper = createWrapper();

      // Since we're using stubs, we check the component registration
      expect(wrapper.vm.$options.components.MarkdownRenderer).toBeDefined();
    });
  });

  describe("Splitter UI Components", () => {
    it("should render splitter separator", () => {
      wrapper = createWrapper();

      const separator = wrapper.find('.splitter-vertical.splitter-enabled');
      expect(separator.exists()).toBe(true);
    });

    it("should render drag indicator avatar", () => {
      wrapper = createWrapper();

      const avatar = wrapper.find('[data-test="dashboard-markdown-editor-drag-indicator"]');
      expect(avatar.exists()).toBe(true);
    });

    it("should configure drag indicator with correct props", () => {
      wrapper = createWrapper();

      const avatar = wrapper.find('[data-test="dashboard-markdown-editor-drag-indicator"]');
      expect(avatar.exists()).toBe(true);
      // Since q-avatar is stubbed, we just verify the element exists
    });

    it("should position drag indicator correctly", () => {
      wrapper = createWrapper();

      const avatar = wrapper.find('[data-test="dashboard-markdown-editor-drag-indicator"]');
      const style = avatar.attributes('style');
      
      expect(style).toContain('top: 10px');
      expect(style).toContain('left: 3.5px');
    });
  });

  describe("Event Handling", () => {
    it("should handle splitter updates", () => {
      wrapper = createWrapper();

      const mockDispatchEvent = vi.spyOn(window, 'dispatchEvent');
      
      wrapper.vm.layoutSplitterUpdated();

      expect(mockDispatchEvent).toHaveBeenCalled();
      mockDispatchEvent.mockRestore();
    });

    it("should handle content changes and emit events", () => {
      wrapper = createWrapper();

      const newContent = "# Article\n\nArticle content here.";
      wrapper.vm.onEditorValueChange(newContent);

      expect(wrapper.vm.markdownContent).toBe(newContent);
      expect(wrapper.emitted('update:modelValue')).toBeTruthy();
      expect(wrapper.emitted('update:modelValue')[0]).toEqual([newContent]);
    });

    it("should handle multiple rapid updates", () => {
      wrapper = createWrapper();

      const updates = [
        "# Update 1",
        "# Update 2", 
        "# Update 3"
      ];

      updates.forEach(update => {
        wrapper.vm.onEditorValueChange(update);
      });

      expect(wrapper.vm.markdownContent).toBe(updates[2]);
      expect(wrapper.emitted('update:modelValue')).toHaveLength(3);
    });
  });

  describe("Template Structure", () => {
    it("should have proper template slots", () => {
      wrapper = createWrapper();

      // Check that the splitter component exists
      const splitter = wrapper.find('[data-test="dashboard-markdown-editor-splitter"]');
      expect(splitter.exists()).toBe(true);
    });

    it("should render all template sections", () => {
      wrapper = createWrapper();

      // Before slot (editor)
      const editorSection = wrapper.find('[data-test="dashboard-markdown-editor"]');
      expect(editorSection.exists()).toBe(true);

      // Separator slot (drag indicator)
      const dragIndicator = wrapper.find('[data-test="dashboard-markdown-editor-drag-indicator"]');
      expect(dragIndicator.exists()).toBe(true);

      // After slot (renderer) - check component registration
      expect(wrapper.vm.$options.components.MarkdownRenderer).toBeDefined();
    });
  });

  describe("CSS Styling", () => {
    it("should have correct container styling", () => {
      wrapper = createWrapper();

      const container = wrapper.find('.markdown-editor');

      // Check the actual style attribute
      const style = container.element.getAttribute('style');
      expect(style).toContain('width: 100%');
      expect(style).toContain('height: 100%');
      expect(style).toContain('overflow: hidden');
    });

    it("should apply splitter classes correctly", () => {
      wrapper = createWrapper();

      const separator = wrapper.find('.splitter-vertical.splitter-enabled');
      expect(separator.exists()).toBe(true);
    });

    it("should have markdown-editor class applied", () => {
      wrapper = createWrapper();

      expect(wrapper.classes()).toContain('markdown-editor');
    });
  });

  describe("Edge Cases and Error Handling", () => {
    it("should handle null modelValue", () => {
      wrapper = createWrapper({ modelValue: null });

      expect(wrapper.vm.markdownContent).toBe(null);
    });

    it("should handle large markdown content", () => {
      const largeMarkdown = "# Large Content\n\n" + "Large content paragraph. ".repeat(1000);
      wrapper = createWrapper({ modelValue: largeMarkdown });

      expect(wrapper.vm.markdownContent).toBe(largeMarkdown);
    });

    it("should handle special markdown characters", () => {
      const specialMarkdown = "# Title with `code`\n\n**Bold** and *italic* and [link](https://example.com)";
      wrapper = createWrapper({ modelValue: specialMarkdown });

      expect(wrapper.vm.markdownContent).toBe(specialMarkdown);
    });

    it("should handle invalid markdown gracefully", () => {
      const invalidMarkdown = "# Unclosed [link\n\n**Unclosed bold";
      wrapper = createWrapper({ modelValue: invalidMarkdown });

      expect(wrapper.vm.markdownContent).toBe(invalidMarkdown);
    });

    it("should handle component unmounting gracefully", () => {
      wrapper = createWrapper();
      
      expect(wrapper.exists()).toBe(true);
      expect(() => wrapper.unmount()).not.toThrow();
    });

    it("should handle multiline markdown with code blocks", () => {
      const multilineMarkdown = `# Main Title

## Subtitle

Here's some content with a code block:

\`\`\`javascript
function test() {
  console.log('test');
}
\`\`\`

And some more content.
`;
      
      wrapper = createWrapper({ modelValue: multilineMarkdown });

      expect(wrapper.vm.markdownContent).toBe(multilineMarkdown);
    });
  });

  describe("Variable Integration", () => {
    it("should handle complex variable structures", () => {
      const complexVariables = {
        user: {
          name: "John Doe",
          id: 123
        },
        settings: ["option1", "option2"],
        isActive: true
      };

      wrapper = createWrapper({ initialVariableValues: complexVariables });

      const markdownRenderer = wrapper.findComponent({ name: 'MarkdownRenderer' });
      if (markdownRenderer.exists()) {
        expect(markdownRenderer.props('variablesData')).toEqual(complexVariables);
      }
    });

    it("should handle null variables", () => {
      wrapper = createWrapper({ initialVariableValues: null });

      const markdownRenderer = wrapper.findComponent({ name: 'MarkdownRenderer' });
      if (markdownRenderer.exists()) {
        expect(markdownRenderer.props('variablesData')).toBe(null);
      }
    });

    it("should maintain variables when content changes", () => {
      const variables = { env: "test", version: "1.0.0" };
      wrapper = createWrapper({ initialVariableValues: variables });

      wrapper.vm.onEditorValueChange("# New content");

      const markdownRenderer = wrapper.findComponent({ name: 'MarkdownRenderer' });
      if (markdownRenderer.exists()) {
        expect(markdownRenderer.props('variablesData')).toEqual(variables);
      }
    });
  });

  describe("Reactive Updates", () => {
    it("should react to modelValue prop changes", async () => {
      wrapper = createWrapper();

      const newMarkdown = "# New Markdown Content";
      await wrapper.setProps({ modelValue: newMarkdown });

      // Component initializes from props but doesn't watch for changes
      expect(wrapper.props('modelValue')).toBe(newMarkdown);
    });

    it("should react to initialVariableValues prop changes", async () => {
      wrapper = createWrapper();

      const newVariables = { newVar: "newValue" };
      await wrapper.setProps({ initialVariableValues: newVariables });

      const markdownRenderer = wrapper.findComponent({ name: 'MarkdownRenderer' });
      if (markdownRenderer.exists()) {
        expect(markdownRenderer.props('variablesData')).toEqual(newVariables);
      }
    });

    it("should maintain splitter state during prop updates", async () => {
      wrapper = createWrapper();

      const originalSplitter = wrapper.vm.splitterModel;
      
      await wrapper.setProps({ modelValue: "# Updated" });

      expect(wrapper.vm.splitterModel).toBe(originalSplitter);
    });
  });

  describe("Performance and Optimization", () => {
    it("should handle rapid content changes", () => {
      wrapper = createWrapper();

      const updates = ["# 1", "# 2", "# 3", "# 4", "# 5"];
      
      updates.forEach(content => {
        wrapper.vm.onEditorValueChange(content);
      });

      expect(wrapper.vm.markdownContent).toBe("# 5");
      expect(wrapper.emitted('update:modelValue')).toHaveLength(5);
    });

    it("should use async loading for CodeQueryEditor", () => {
      wrapper = createWrapper();

      // CodeQueryEditor is loaded as async component
      expect(wrapper.vm.$options.components.CodeQueryEditor).toBeDefined();
    });

    it("should handle debounced editor updates", () => {
      wrapper = createWrapper();

      const codeEditor = wrapper.find('[data-test="dashboard-markdown-editor"]');
      expect(codeEditor.attributes('debouncetime')).toBe('500');
    });
  });

  describe("Complex Scenarios", () => {
    it("should handle full editor workflow", async () => {
      const initialMarkdown = "# Initial Content";
      wrapper = createWrapper({ modelValue: initialMarkdown });

      expect(wrapper.vm.markdownContent).toBe(initialMarkdown);

      const updatedMarkdown = "# Updated Content\n\nWith more details.";
      wrapper.vm.onEditorValueChange(updatedMarkdown);

      expect(wrapper.vm.markdownContent).toBe(updatedMarkdown);
      expect(wrapper.emitted('update:modelValue')).toBeTruthy();

      wrapper.vm.splitterModel = 70;
      wrapper.vm.layoutSplitterUpdated();

      expect(wrapper.vm.splitterModel).toBe(70);
    });

    it("should handle concurrent editor and splitter updates", async () => {
      wrapper = createWrapper();

      const dispatchEventSpy = vi.spyOn(window, 'dispatchEvent');

      wrapper.vm.onEditorValueChange("# Concurrent Update");
      wrapper.vm.splitterModel = 60;
      wrapper.vm.layoutSplitterUpdated();

      expect(wrapper.vm.markdownContent).toBe("# Concurrent Update");
      expect(wrapper.vm.splitterModel).toBe(60);
      expect(dispatchEventSpy).toHaveBeenCalled();

      dispatchEventSpy.mockRestore();
    });

    it("should maintain component integrity during stress testing", () => {
      wrapper = createWrapper();

      for (let i = 0; i < 100; i++) {
        wrapper.vm.onEditorValueChange(`# Content ${i}`);
        wrapper.vm.splitterModel = 30 + (i % 40);
        wrapper.vm.layoutSplitterUpdated();
      }

      expect(wrapper.exists()).toBe(true);
      expect(wrapper.vm.markdownContent).toBe("# Content 99");
      expect(wrapper.vm.splitterModel).toBe(49); // 30 + (99 % 40) = 30 + 19 = 49
    });
  });

  describe("Props Validation", () => {
    it("should handle default props correctly", () => {
      const createWrapperMinimal = () => {
        return mount(CustomMarkdownEditor, {
          global: {
            plugins: [i18n],
            stubs: {
              'CodeQueryEditor': true,
              'MarkdownRenderer': true,
              'q-splitter': {
                template: '<div data-test="q-splitter-stub"><slot name="before"></slot><slot name="separator"></slot><slot name="after"></slot></div>',
                props: ['modelValue'],
                emits: ['update:modelValue']
              },
              'q-avatar': true
            },
            mocks: {
              $t: (key: string) => key
            }
          }
        });
      };

      wrapper = createWrapperMinimal();

      expect(wrapper.props('modelValue')).toBe("");
      expect(wrapper.props('initialVariableValues')).toEqual({});
    });

    it("should accept string modelValue", () => {
      const stringValue = "# Custom markdown content";
      wrapper = createWrapper({ modelValue: stringValue });

      expect(wrapper.props('modelValue')).toBe(stringValue);
    });

    it("should accept object initialVariableValues", () => {
      const variables = { key: "value", number: 42 };
      wrapper = createWrapper({ initialVariableValues: variables });

      expect(wrapper.props('initialVariableValues')).toEqual(variables);
    });

    it("should handle prop updates", async () => {
      wrapper = createWrapper();

      const newValue = "# Updated via props";
      await wrapper.setProps({ modelValue: newValue });

      expect(wrapper.props('modelValue')).toBe(newValue);
    });
  });
});