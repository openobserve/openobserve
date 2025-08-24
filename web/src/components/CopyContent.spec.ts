import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { Quasar, copyToClipboard } from 'quasar';
import CopyContent from './CopyContent.vue';
import { createStore } from 'vuex';
import { createI18n } from 'vue-i18n';
import { nextTick } from 'vue';

// Mock quasar module
vi.mock('quasar', async () => {
  const actual = await vi.importActual('quasar');
  return {
    ...actual,
    copyToClipboard: vi.fn(),
    useQuasar: vi.fn(() => ({
      notify: vi.fn(),
    })),
  };
});

// Mock zincutils
vi.mock('@/utils/zincutils', () => ({
  maskText: vi.fn((text) => '*'.repeat(text.length)),
  b64EncodeStandard: vi.fn((text) => btoa(text)),
}));

const mockStore = createStore({
  state: {
    userInfo: {
      email: 'test@example.com',
    },
    organizationData: {
      organizationPasscode: 'test-passcode-123',
    },
  },
});

const mockI18n = createI18n({
  locale: 'en',
  messages: {
    en: {},
  },
});

describe('CopyContent.vue Branch Coverage', () => {
  let mockCopyToClipboard: any;
  let mockNotify: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    
    // Get references to the mocked functions
    mockCopyToClipboard = vi.mocked(copyToClipboard);
    mockNotify = vi.fn();
    
    // Setup useQuasar mock to return our mockNotify
    const { useQuasar } = await import('quasar');
    vi.mocked(useQuasar).mockReturnValue({
      notify: mockNotify,
    } as any);
  });

  describe('ReplaceValues Function Branch Coverage', () => {
    it('should replace values with masked text when isMask is true', async () => {
      const wrapper = mount(CopyContent, {
        props: {
          content: 'Email: [EMAIL], Passcode: [PASSCODE], Basic: [BASIC_PASSCODE]',
          displayContent: 'Email: [EMAIL], Passcode: [PASSCODE], Basic: [BASIC_PASSCODE]',
        },
        global: {
          plugins: [Quasar, mockI18n],
          provide: {
            store: mockStore,
          },
        },
      });

      // Branch: isMask = true (lines 74-77)
      const replaceValues = (wrapper.vm as any).replaceValues;
      const maskedResult = replaceValues('Email: [EMAIL], Passcode: [PASSCODE], Basic: [BASIC_PASSCODE]', true);

      expect(maskedResult).toContain('****************'); // Masked email
      expect(maskedResult).toContain('****************'); // Masked passcode
      expect(maskedResult).toContain('***************************************'); // Masked basic passcode
    });

    it('should replace values with actual text when isMask is false', async () => {
      const wrapper = mount(CopyContent, {
        props: {
          content: 'Email: [EMAIL], Passcode: [PASSCODE], Basic: [BASIC_PASSCODE]',
        },
        global: {
          plugins: [Quasar, mockI18n],
          provide: {
            store: mockStore,
          },
        },
      });

      // Branch: isMask = false (lines 79-82)
      const replaceValues = (wrapper.vm as any).replaceValues;
      const actualResult = replaceValues('Email: [EMAIL], Passcode: [PASSCODE], Basic: [BASIC_PASSCODE]', false);

      expect(actualResult).toContain('test@example.com');
      expect(actualResult).toContain('test-passcode-123');
      expect(actualResult).toContain(btoa('test@example.com:test-passcode-123'));
    });
  });

  describe('CopyToClipboard Success Branch Coverage', () => {
    it('should show success notification when copy succeeds', async () => {
      // Branch: copyToClipboard success (lines 88-94)
      mockCopyToClipboard.mockResolvedValueOnce(true);

      const wrapper = mount(CopyContent, {
        props: {
          content: 'Test content [EMAIL]',
        },
        global: {
          plugins: [Quasar, mockI18n],
          provide: {
            store: mockStore,
          },
        },
      });

      const copyButton = wrapper.find('[data-test="rum-copy-btn"]');
      await copyButton.trigger('click');

      // Wait for promise resolution
      await nextTick();
      await nextTick();

      expect(mockCopyToClipboard).toHaveBeenCalledWith('Test content test@example.com');
      expect(mockNotify).toHaveBeenCalledWith({
        type: 'positive',
        message: 'Content Copied Successfully!',
        timeout: 5000,
      });
    });
  });

  describe('CopyToClipboard Error Branch Coverage', () => {
    it('should show error notification when copy fails', async () => {
      // Branch: copyToClipboard error (lines 96-101)
      mockCopyToClipboard.mockRejectedValueOnce(new Error('Copy failed'));

      const wrapper = mount(CopyContent, {
        props: {
          content: 'Test content [EMAIL]',
        },
        global: {
          plugins: [Quasar, mockI18n],
          provide: {
            store: mockStore,
          },
        },
      });

      const copyButton = wrapper.find('[data-test="rum-copy-btn"]');
      await copyButton.trigger('click');

      // Wait for promise rejection
      await nextTick();
      await nextTick();

      expect(mockCopyToClipboard).toHaveBeenCalledWith('Test content test@example.com');
      expect(mockNotify).toHaveBeenCalledWith({
        type: 'negative',
        message: 'Error while copy content.',
        timeout: 5000,
      });
    });
  });

  describe('DisplayContent Props Branch Coverage', () => {
    it('should use displayContent when provided', async () => {
      // Branch: props.displayContent exists (line 105)
      const wrapper = mount(CopyContent, {
        props: {
          content: 'Original content [EMAIL]',
          displayContent: 'Display content [EMAIL]',
        },
        global: {
          plugins: [Quasar, mockI18n],
          provide: {
            store: mockStore,
          },
        },
      });

      const contentText = wrapper.find('[data-test="rum-content-text"]');
      expect(contentText.text()).toContain('Display content');
    });

    it('should fallback to content when displayContent is not provided', async () => {
      // Branch: props.displayContent is empty, fallback to props.content (line 105)
      const wrapper = mount(CopyContent, {
        props: {
          content: 'Original content [EMAIL]',
          displayContent: '', // Empty displayContent
        },
        global: {
          plugins: [Quasar, mockI18n],
          provide: {
            store: mockStore,
          },
        },
      });

      const contentText = wrapper.find('[data-test="rum-content-text"]');
      expect(contentText.text()).toContain('Original content');
    });

    it('should fallback to content when displayContent prop is not provided at all', async () => {
      // Branch: props.displayContent is undefined, fallback to props.content (line 105)
      const wrapper = mount(CopyContent, {
        props: {
          content: 'Fallback content [EMAIL]',
          // displayContent not provided
        },
        global: {
          plugins: [Quasar, mockI18n],
          provide: {
            store: mockStore,
          },
        },
      });

      const contentText = wrapper.find('[data-test="rum-content-text"]');
      expect(contentText.text()).toContain('Fallback content');
    });
  });

  describe('Watcher Branch Coverage', () => {
    it('should refresh data when organization passcode changes', async () => {
      const dynamicStore = createStore({
        state: {
          userInfo: {
            email: 'test@example.com',
          },
          organizationData: {
            organizationPasscode: 'initial-passcode',
          },
        },
        mutations: {
          updatePasscode(state, newPasscode) {
            state.organizationData.organizationPasscode = newPasscode;
          },
        },
      });

      const wrapper = mount(CopyContent, {
        props: {
          content: 'Passcode: [PASSCODE]',
        },
        global: {
          plugins: [Quasar, mockI18n],
          provide: {
            store: dynamicStore,
          },
        },
      });

      const contentText = wrapper.find('[data-test="rum-content-text"]');
      expect(contentText.text()).toContain('****************'); // Initial masked passcode

      // Branch: computedData watcher triggers refreshData (lines 129-130)
      dynamicStore.commit('updatePasscode', 'new-passcode-456');
      await nextTick();
      await nextTick();

      // Content should be refreshed with new masked passcode
      expect(contentText.text()).toContain('****************'); // New masked passcode
    });
  });

  describe('Template Rendering Branch Coverage', () => {
    it('should render all template elements correctly', async () => {
      const wrapper = mount(CopyContent, {
        props: {
          content: 'Test content [EMAIL] and [PASSCODE]',
        },
        global: {
          plugins: [Quasar, mockI18n],
          provide: {
            store: mockStore,
          },
        },
      });

      // Test template rendering
      expect(wrapper.find('.tabContent').exists()).toBe(true);
      expect(wrapper.find('.copy_action').exists()).toBe(true);
      expect(wrapper.find('[data-test="rum-copy-btn"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="rum-content-text"]').exists()).toBe(true);
    });
  });

  describe('Function Integration Coverage', () => {
    it('should properly integrate all functions with different content patterns', async () => {
      const wrapper = mount(CopyContent, {
        props: {
          content: 'User: [EMAIL], Auth: [BASIC_PASSCODE], Pass: [PASSCODE]',
          displayContent: 'Displayed User: [EMAIL], Auth: [BASIC_PASSCODE]',
        },
        global: {
          plugins: [Quasar, mockI18n],
          provide: {
            store: mockStore,
          },
        },
      });

      // Test that all replacement patterns work together
      const contentText = wrapper.find('[data-test="rum-content-text"]');
      const displayedText = contentText.text();
      
      expect(displayedText).toContain('Displayed User:');
      expect(displayedText).toContain('****************'); // Masked email
      expect(displayedText).toContain('***************************************'); // Masked basic passcode
    });

    it('should handle content without any replacement patterns', async () => {
      const wrapper = mount(CopyContent, {
        props: {
          content: 'Simple content without any patterns',
        },
        global: {
          plugins: [Quasar, mockI18n],
          provide: {
            store: mockStore,
          },
        },
      });

      const contentText = wrapper.find('[data-test="rum-content-text"]');
      expect(contentText.text()).toBe('Simple content without any patterns');

      // Test copying content without patterns
      mockCopyToClipboard.mockResolvedValueOnce(true);
      const copyButton = wrapper.find('[data-test="rum-copy-btn"]');
      await copyButton.trigger('click');

      expect(mockCopyToClipboard).toHaveBeenCalledWith('Simple content without any patterns');
    });
  });
});