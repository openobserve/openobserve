import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { installQuasar } from '@/test/unit/helpers/install-quasar-plugin';
import { Dialog, Notify } from 'quasar';
import O2AIContextAddBtn from './O2AIContextAddBtn.vue';
import { getImageURL } from '@/utils/zincutils';
import store from '@/test/unit/helpers/store';

// Mock the getImageURL function
vi.mock('@/utils/zincutils', () => ({
  getImageURL: vi.fn((path) => path)
}));

// Mock aws-exports config
vi.mock('@/aws-exports', () => ({
  default: {
    isEnterprise: 'true'
  }
}));

// Create a div for mounting
const node = document.createElement('div');
node.setAttribute('id', 'app');
document.body.appendChild(node);

// Install Quasar
installQuasar({
  plugins: [Dialog, Notify],
});

describe('O2AIContextAddBtn', () => {
  let wrapper;

  beforeEach(async () => {
    // Create a fresh store before each test
    store.state.theme = 'light';
    store.state.zoConfig = {
      ai_enabled: true
    };

    // Mount component with Quasar
    wrapper = mount(O2AIContextAddBtn, {
      attachTo: document.body,
      global: {
        plugins: [],
        provide: { store },
        stubs: {
          'q-btn': false // Don't stub q-btn to test actual Quasar button
        }
      },
      props: {
        class: '',
        size: 'xs',
        style: '',
        imageHeight: '20px',
        imageWidth: '20px'
      }
    });

    await flushPromises();
  });

  afterEach(() => {
    wrapper.unmount();
  });

  it('renders when enterprise and AI are enabled', () => {
    expect(wrapper.find('[data-test="o2-ai-context-add-btn"]').exists()).toBe(true);
  });

  it('does not render when AI is disabled', async () => {
    store.state.zoConfig.ai_enabled = false;
    await wrapper.vm.$nextTick();
    expect(wrapper.find('[data-test="o2-ai-context-add-btn"]').exists()).toBe(false);
  });

  it('emits sendToAiChat event when clicked', async () => {
    const button = wrapper.find('[data-test="o2-ai-context-add-btn"]');
    await button.trigger('click');
    expect(wrapper.emitted('sendToAiChat')).toBeTruthy();
    expect(wrapper.emitted('sendToAiChat')).toHaveLength(1);
  });

  it('applies custom class when provided', async () => {
    await wrapper.setProps({ class: 'custom-class' });
    expect(wrapper.find('[data-test="o2-ai-context-add-btn"]').classes()).toContain('custom-class');
  });


  it('applies custom style when provided', async () => {
    await wrapper.setProps({ style: 'margin: 10px' });
    const button = wrapper.find('[data-test="o2-ai-context-add-btn"]');
    expect(button.attributes('style')).toContain('margin: 10px');
  });

  it('applies custom image dimensions when provided', async () => {
    await wrapper.setProps({
      imageHeight: '30px',
      imageWidth: '30px'
    });
    const img = wrapper.find('img');
    expect(img.attributes('height')).toBe('30px');
    expect(img.attributes('width')).toBe('30px');
  });

  it('uses correct icon based on theme', async () => {
    // Test light theme
    expect(getImageURL).toHaveBeenCalledWith('images/common/ai_icon.svg');

    // Test dark theme
    store.state.theme = 'dark';
    await wrapper.vm.$nextTick();
    expect(getImageURL).toHaveBeenCalledWith('images/common/ai_icon_dark.svg');
  });

  it('has correct button attributes', () => {
    const button = wrapper.find('[data-test="o2-ai-context-add-btn"]');
    expect(button.attributes('borderless')).toBe('true');
    expect(button.attributes('flat')).toBe(undefined);
    expect(button.attributes('style')).toContain('border-radius: 100%');
  });
});
