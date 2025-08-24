import { describe, it, expect, vi, afterEach } from 'vitest';
import { mount, VueWrapper } from '@vue/test-utils';
import SanitizedHtmlRenderer from '@/components/SanitizedHtmlRenderer.vue';
import { Quasar } from 'quasar';

// Mock DOMPurify
vi.mock('dompurify', () => {
  const mockSanitize = vi.fn();
  return {
    default: {
      sanitize: mockSanitize
    }
  };
});

import DOMPurify from 'dompurify';
const mockSanitize = DOMPurify.sanitize as any;

describe('SanitizedHtmlRenderer.vue', () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
    vi.clearAllMocks();
  });

  const createWrapper = (props = {}) => {
    const defaultProps = {
      htmlContent: '<p>Test content</p>'
    };

    return mount(SanitizedHtmlRenderer, {
      props: { ...defaultProps, ...props },
      global: {
        plugins: [Quasar]
      }
    });
  };

  describe('Component Rendering', () => {
    it('renders the component correctly', () => {
      mockSanitize.mockReturnValue('<p>Test content</p>');
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it('has correct component name', () => {
      mockSanitize.mockReturnValue('<p>Test content</p>');
      wrapper = createWrapper();
      expect(wrapper.vm.$options.name).toBe('SanitizedHtmlRenderer');
    });

    it('renders div element with data-test attribute', () => {
      mockSanitize.mockReturnValue('<p>Test content</p>');
      wrapper = createWrapper();
      
      const div = wrapper.find('div[data-test="sanitized-html-renderer"]');
      expect(div.exists()).toBe(true);
    });

    it('displays sanitized HTML content', () => {
      mockSanitize.mockReturnValue('<p>Sanitized content</p>');
      wrapper = createWrapper({ htmlContent: '<p>Test content</p>' });
      
      expect(wrapper.html()).toContain('<p>Sanitized content</p>');
    });
  });

  describe('Props Handling', () => {
    it('accepts htmlContent prop', () => {
      mockSanitize.mockReturnValue('<p>Custom content</p>');
      wrapper = createWrapper({ htmlContent: '<p>Custom content</p>' });
      
      expect(wrapper.props('htmlContent')).toBe('<p>Custom content</p>');
    });

    it('uses default empty string when no htmlContent provided', () => {
      mockSanitize.mockReturnValue('');
      wrapper = createWrapper({ htmlContent: undefined });
      
      expect(wrapper.props('htmlContent')).toBe('');
    });

    it('handles empty string htmlContent', () => {
      mockSanitize.mockReturnValue('');
      wrapper = createWrapper({ htmlContent: '' });
      
      expect(wrapper.props('htmlContent')).toBe('');
    });

    it('handles null htmlContent', () => {
      mockSanitize.mockReturnValue('');
      wrapper = createWrapper({ htmlContent: null });
      
      expect(wrapper.props('htmlContent')).toBeNull();
    });
  });

  describe('DOMPurify Integration', () => {
    it('calls DOMPurify.sanitize with htmlContent', () => {
      mockSanitize.mockReturnValue('<p>Sanitized</p>');
      wrapper = createWrapper({ htmlContent: '<script>alert("xss")</script><p>Content</p>' });
      
      expect(mockSanitize).toHaveBeenCalledWith('<script>alert("xss")</script><p>Content</p>');
    });

    it('uses sanitized content for rendering', () => {
      mockSanitize.mockReturnValue('<p>Safe content</p>');
      wrapper = createWrapper({ htmlContent: '<script>alert("xss")</script><p>Unsafe content</p>' });
      
      expect(wrapper.html()).toContain('<p>Safe content</p>');
      expect(wrapper.html()).not.toContain('<script>');
    });

    it('exposes DOMPurify in component instance', () => {
      mockSanitize.mockReturnValue('<p>Test</p>');
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      
      expect(vm.DOMPurify).toBeDefined();
      expect(typeof vm.DOMPurify.sanitize).toBe('function');
    });

    it('handles DOMPurify returning empty result', () => {
      mockSanitize.mockReturnValue('');
      wrapper = createWrapper({ htmlContent: '<script>malicious</script>' });
      
      expect(wrapper.html()).not.toContain('<script>');
    });
  });

  describe('Security Features', () => {
    it('sanitizes potentially dangerous HTML', () => {
      mockSanitize.mockReturnValue('<p>Safe content</p>');
      wrapper = createWrapper({ htmlContent: '<script>alert("xss")</script><p>Content</p>' });
      
      expect(mockSanitize).toHaveBeenCalledWith('<script>alert("xss")</script><p>Content</p>');
      expect(wrapper.html()).toContain('<p>Safe content</p>');
    });

    it('processes HTML with event handlers', () => {
      mockSanitize.mockReturnValue('<p>Clean content</p>');
      wrapper = createWrapper({ htmlContent: '<p onclick="alert(1)">Dangerous content</p>' });
      
      expect(mockSanitize).toHaveBeenCalledWith('<p onclick="alert(1)">Dangerous content</p>');
    });

    it('handles iframe and object tags', () => {
      mockSanitize.mockReturnValue('<p>Safe alternative</p>');
      wrapper = createWrapper({ htmlContent: '<iframe src="javascript:alert(1)"></iframe>' });
      
      expect(mockSanitize).toHaveBeenCalledWith('<iframe src="javascript:alert(1)"></iframe>');
    });

    it('processes style tags with potential CSS injection', () => {
      mockSanitize.mockReturnValue('<p>Cleaned content</p>');
      wrapper = createWrapper({ htmlContent: '<style>body { background: url("javascript:alert(1)"); }</style>' });
      
      expect(mockSanitize).toHaveBeenCalledWith('<style>body { background: url("javascript:alert(1)"); }</style>');
    });
  });

  describe('HTML Content Varieties', () => {
    it('handles simple text content', () => {
      mockSanitize.mockReturnValue('Simple text');
      wrapper = createWrapper({ htmlContent: 'Simple text' });
      
      expect(mockSanitize).toHaveBeenCalledWith('Simple text');
      expect(wrapper.text()).toContain('Simple text');
    });

    it('handles complex nested HTML', () => {
      const complexHtml = '<div><p>Paragraph</p><ul><li>Item 1</li><li>Item 2</li></ul></div>';
      mockSanitize.mockReturnValue(complexHtml);
      wrapper = createWrapper({ htmlContent: complexHtml });
      
      expect(mockSanitize).toHaveBeenCalledWith(complexHtml);
    });

    it('handles HTML with attributes', () => {
      mockSanitize.mockReturnValue('<p class="safe">Content</p>');
      wrapper = createWrapper({ htmlContent: '<p class="test" data-id="123">Content</p>' });
      
      expect(mockSanitize).toHaveBeenCalledWith('<p class="test" data-id="123">Content</p>');
    });

    it('handles malformed HTML', () => {
      mockSanitize.mockReturnValue('<p>Fixed content</p>');
      wrapper = createWrapper({ htmlContent: '<p>Unclosed paragraph<div>Nested incorrectly' });
      
      expect(mockSanitize).toHaveBeenCalledWith('<p>Unclosed paragraph<div>Nested incorrectly');
    });
  });

  describe('Component Structure', () => {
    it('uses v-html directive correctly', () => {
      mockSanitize.mockReturnValue('<strong>Bold text</strong>');
      wrapper = createWrapper({ htmlContent: '<strong>Bold text</strong>' });
      
      expect(wrapper.html()).toContain('<strong>Bold text</strong>');
    });

    it('maintains single root element structure', () => {
      mockSanitize.mockReturnValue('<p>Content</p>');
      wrapper = createWrapper();
      
      expect(wrapper.element.tagName).toBe('DIV');
      expect(wrapper.element.getAttribute('data-test')).toBe('sanitized-html-renderer');
    });

    it('has proper component setup structure', () => {
      mockSanitize.mockReturnValue('<p>Test</p>');
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      
      expect(vm.DOMPurify).toBeDefined();
    });
  });

  describe('Vue 3 Integration', () => {
    it('uses defineComponent correctly', () => {
      mockSanitize.mockReturnValue('<p>Test</p>');
      wrapper = createWrapper();
      
      expect(wrapper.vm).toBeTruthy();
    });

    it('uses setup function correctly', () => {
      mockSanitize.mockReturnValue('<p>Test</p>');
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      
      expect(vm.DOMPurify).toBeDefined();
    });

    it('defines props correctly', () => {
      mockSanitize.mockReturnValue('<p>Test</p>');
      wrapper = createWrapper({ htmlContent: 'test content' });
      
      expect(wrapper.props()).toHaveProperty('htmlContent');
      expect(wrapper.props('htmlContent')).toBe('test content');
    });
  });

  describe('Reactivity', () => {
    it('updates when htmlContent prop changes', async () => {
      mockSanitize.mockReturnValueOnce('<p>Initial</p>');
      wrapper = createWrapper({ htmlContent: '<p>Initial content</p>' });
      
      expect(wrapper.html()).toContain('<p>Initial</p>');
      
      mockSanitize.mockReturnValueOnce('<p>Updated</p>');
      await wrapper.setProps({ htmlContent: '<p>Updated content</p>' });
      
      expect(mockSanitize).toHaveBeenCalledWith('<p>Updated content</p>');
    });

    it('re-sanitizes on content change', async () => {
      mockSanitize.mockReturnValueOnce('<p>First</p>');
      wrapper = createWrapper({ htmlContent: '<p>First content</p>' });
      
      mockSanitize.mockReturnValueOnce('<p>Second</p>');
      await wrapper.setProps({ htmlContent: '<p>Second content</p>' });
      
      expect(mockSanitize).toHaveBeenCalledTimes(2);
      expect(mockSanitize).toHaveBeenLastCalledWith('<p>Second content</p>');
    });
  });

  describe('Edge Cases', () => {
    it('handles very long HTML content', () => {
      const longContent = '<p>' + 'Very long content '.repeat(1000) + '</p>';
      mockSanitize.mockReturnValue(longContent);
      wrapper = createWrapper({ htmlContent: longContent });
      
      expect(mockSanitize).toHaveBeenCalledWith(longContent);
    });

    it('handles HTML with unicode characters', () => {
      mockSanitize.mockReturnValue('<p>Unicode: 🚀 ñ ü</p>');
      wrapper = createWrapper({ htmlContent: '<p>Unicode: 🚀 ñ ü</p>' });
      
      expect(mockSanitize).toHaveBeenCalledWith('<p>Unicode: 🚀 ñ ü</p>');
    });

    it('handles HTML with special characters', () => {
      mockSanitize.mockReturnValue('<p>&lt;script&gt; &amp; &quot;</p>');
      wrapper = createWrapper({ htmlContent: '<p><script> & "</p>' });
      
      expect(mockSanitize).toHaveBeenCalledWith('<p><script> & "</p>');
    });

    it('handles whitespace-only content', () => {
      mockSanitize.mockReturnValue('   ');
      wrapper = createWrapper({ htmlContent: '   ' });
      
      expect(mockSanitize).toHaveBeenCalledWith('   ');
    });
  });

  describe('Component Lifecycle', () => {
    it('mounts without errors', () => {
      mockSanitize.mockReturnValue('<p>Test</p>');
      
      expect(() => {
        wrapper = createWrapper();
      }).not.toThrow();
    });

    it('unmounts cleanly', () => {
      mockSanitize.mockReturnValue('<p>Test</p>');
      wrapper = createWrapper();
      
      expect(() => {
        wrapper.unmount();
      }).not.toThrow();
    });

    it('initializes DOMPurify on setup', () => {
      mockSanitize.mockReturnValue('<p>Test</p>');
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      
      expect(vm.DOMPurify).toBeDefined();
      expect(vm.DOMPurify.sanitize).toBe(mockSanitize);
    });
  });

  describe('Performance Considerations', () => {
    it('calls sanitize only when needed', () => {
      mockSanitize.mockReturnValue('<p>Content</p>');
      wrapper = createWrapper({ htmlContent: '<p>Test content</p>' });
      
      // Should be called during rendering
      expect(mockSanitize).toHaveBeenCalledTimes(1);
    });

    it('is a lightweight component', () => {
      mockSanitize.mockReturnValue('<p>Test</p>');
      wrapper = createWrapper();
      
      // Should only have the DOMPurify dependency
      const vm = wrapper.vm as any;
      const setupKeys = Object.keys(vm).filter(key => !key.startsWith('$'));
      expect(setupKeys).toContain('DOMPurify');
    });
  });
});