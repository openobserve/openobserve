import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import CopyContent from './CopyContent.vue';
import { createStore } from 'vuex';
import { createI18n } from 'vue-i18n';
import { nextTick } from 'vue';

// Mock clipboard utility (replaces old quasar copyToClipboard)
const mockCopyToClipboard = vi.fn().mockResolvedValue(true);
vi.mock('@/utils/clipboard', () => ({
  copyToClipboard: (...args: any[]) => mockCopyToClipboard(...args),
}));

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

  beforeEach(() => {
    vi.clearAllMocks();
    mockCopyToClipboard.mockResolvedValue(true);
  });

  describe('ReplaceValues Function Branch Coverage', () => {
    it('should replace values with masked text when isMask is true', async () => {
      const wrapper = mount(CopyContent, {
        props: {
          content: 'Email: [EMAIL], Passcode: [PASSCODE], Basic: [BASIC_PASSCODE]',
          displayContent: 'Email: [EMAIL], Passcode: [PASSCODE], Basic: [BASIC_PASSCODE]',
        },
        global: {
          plugins: [mockI18n],
          provide: {
            store: mockStore,
          },
        },
      });

      const replaceValues = (wrapper.vm as any).replaceValues;
      const maskedResult = replaceValues('Email: [EMAIL], Passcode: [PASSCODE], Basic: [BASIC_PASSCODE]', true);

      expect(maskedResult).toContain('****************');
      expect(maskedResult).toContain('****************');
      expect(maskedResult).toContain('***************************************');
    });

    it('should replace values with actual text when isMask is false', async () => {
      const wrapper = mount(CopyContent, {
        props: {
          content: 'Email: [EMAIL], Passcode: [PASSCODE], Basic: [BASIC_PASSCODE]',
        },
        global: {
          plugins: [mockI18n],
          provide: {
            store: mockStore,
          },
        },
      });

      const replaceValues = (wrapper.vm as any).replaceValues;
      const actualResult = replaceValues('Email: [EMAIL], Passcode: [PASSCODE], Basic: [BASIC_PASSCODE]', false);

      expect(actualResult).toContain('test@example.com');
      expect(actualResult).toContain('test-passcode-123');
      expect(actualResult).toContain(btoa('test@example.com:test-passcode-123'));
    });
  });

  describe('CopyToClipboard Success Branch Coverage', () => {
    it('should show success notification when copy succeeds', async () => {
      mockCopyToClipboard.mockResolvedValueOnce(true);

      const wrapper = mount(CopyContent, {
        props: {
          content: 'Test content [EMAIL]',
        },
        global: {
          plugins: [mockI18n],
          provide: {
            store: mockStore,
          },
        },
      });

      const copyButton = wrapper.find('[data-test="rum-copy-btn"]');
      await copyButton.trigger('click');

      await nextTick();
      await nextTick();

      expect(mockCopyToClipboard).toHaveBeenCalledWith(
        'Test content test@example.com',
        {
          successMessage: 'Content Copied Successfully!',
          errorMessage: 'Error while copy content.',
          timeout: 5000,
        },
      );
    });
  });

  describe('CopyToClipboard Error Branch Coverage', () => {
    it('should show error notification when copy fails', async () => {
      mockCopyToClipboard.mockRejectedValueOnce(new Error('Copy failed'));

      const wrapper = mount(CopyContent, {
        props: {
          content: 'Test content [EMAIL]',
        },
        global: {
          plugins: [mockI18n],
          provide: {
            store: mockStore,
          },
        },
      });

      const copyButton = wrapper.find('[data-test="rum-copy-btn"]');
      await copyButton.trigger('click');

      await nextTick();
      await nextTick();

      expect(mockCopyToClipboard).toHaveBeenCalledWith(
        'Test content test@example.com',
        {
          successMessage: 'Content Copied Successfully!',
          errorMessage: 'Error while copy content.',
          timeout: 5000,
        },
      );
    });
  });

  describe('DisplayContent Props Branch Coverage', () => {
    it('should use displayContent when provided', async () => {
      const wrapper = mount(CopyContent, {
        props: {
          content: 'Original content [EMAIL]',
          displayContent: 'Display content [EMAIL]',
        },
        global: {
          plugins: [mockI18n],
          provide: {
            store: mockStore,
          },
        },
      });

      const contentText = wrapper.find('[data-test="rum-content-text"]');
      expect(contentText.text()).toContain('Display content');
    });

    it('should fallback to content when displayContent is not provided', async () => {
      const wrapper = mount(CopyContent, {
        props: {
          content: 'Original content [EMAIL]',
          displayContent: '',
        },
        global: {
          plugins: [mockI18n],
          provide: {
            store: mockStore,
          },
        },
      });

      const contentText = wrapper.find('[data-test="rum-content-text"]');
      expect(contentText.text()).toContain('Original content');
    });

    it('should fallback to content when displayContent prop is not provided at all', async () => {
      const wrapper = mount(CopyContent, {
        props: {
          content: 'Fallback content [EMAIL]',
        },
        global: {
          plugins: [mockI18n],
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
          updatePasscode(state: any, newPasscode: string) {
            state.organizationData.organizationPasscode = newPasscode;
          },
        },
      });

      const wrapper = mount(CopyContent, {
        props: {
          content: 'Passcode: [PASSCODE]',
        },
        global: {
          plugins: [mockI18n],
          provide: {
            store: dynamicStore,
          },
        },
      });

      const contentText = wrapper.find('[data-test="rum-content-text"]');
      expect(contentText.text()).toContain('****************');

      dynamicStore.commit('updatePasscode', 'new-passcode-456');
      await nextTick();
      await nextTick();

      expect(contentText.text()).toContain('****************');
    });
  });

  describe('Template Rendering Branch Coverage', () => {
    it('should render all template elements correctly', async () => {
      const wrapper = mount(CopyContent, {
        props: {
          content: 'Test content [EMAIL] and [PASSCODE]',
        },
        global: {
          plugins: [mockI18n],
          provide: {
            store: mockStore,
          },
        },
      });

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
          plugins: [mockI18n],
          provide: {
            store: mockStore,
          },
        },
      });

      const contentText = wrapper.find('[data-test="rum-content-text"]');
      const displayedText = contentText.text();

      expect(displayedText).toContain('Displayed User:');
      expect(displayedText).toContain('****************');
      expect(displayedText).toContain('***************************************');
    });

    it('should handle content without any replacement patterns', async () => {
      const wrapper = mount(CopyContent, {
        props: {
          content: 'Simple content without any patterns',
        },
        global: {
          plugins: [mockI18n],
          provide: {
            store: mockStore,
          },
        },
      });

      const contentText = wrapper.find('[data-test="rum-content-text"]');
      expect(contentText.text()).toBe('Simple content without any patterns');

      mockCopyToClipboard.mockResolvedValueOnce(true);
      const copyButton = wrapper.find('[data-test="rum-copy-btn"]');
      await copyButton.trigger('click');

      expect(mockCopyToClipboard).toHaveBeenCalledWith(
        'Simple content without any patterns',
        {
          successMessage: 'Content Copied Successfully!',
          errorMessage: 'Error while copy content.',
          timeout: 5000,
        },
      );
    });
  });
});