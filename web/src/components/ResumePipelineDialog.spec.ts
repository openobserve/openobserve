import { mount } from "@vue/test-utils";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import ResumePipelineDialog from "@/components/ResumePipelineDialog.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

installQuasar();

vi.mock("@/utils/zincutils", () => ({
  convertUnixToQuasarFormat: vi.fn(() => "2023-01-01 10:00:00")
}));

describe("ResumePipelineDialog", () => {
  let wrapper: any = null;

  const defaultProps = {
    title: "Resume Pipeline",
    message: "Test message",
    lastPausedAt: 1672574400,
    shouldStartfromNow: false
  };

  beforeEach(() => {
    wrapper = mount(ResumePipelineDialog, {
      props: defaultProps,
      global: {
        plugins: [i18n],
        provide: {
          store,
        },
        stubs: {
          'q-dialog': true,
          'q-card': true,
          'q-card-section': true,
          'q-card-actions': true,
          'q-btn': true,
          'q-radio': true
        }
      },
    });
  });

  afterEach(() => {
    wrapper.unmount();
  });

  it("should mount ResumePipelineDialog component", () => {
    expect(wrapper).toBeTruthy();
  });

  it("should have correct props", () => {
    expect(wrapper.props('title')).toBe("Resume Pipeline");
    expect(wrapper.props('lastPausedAt')).toBe(1672574400);
    expect(wrapper.props('shouldStartfromNow')).toBe(false);
  });

  it("should render without errors", () => {
    expect(wrapper.exists()).toBe(true);
  });

  it("should expose necessary functions from setup", () => {
    expect(typeof wrapper.vm.onCancel).toBe("function");
    expect(typeof wrapper.vm.onConfirm).toBe("function");
    expect(wrapper.vm.store).toBeDefined();
  });

  it("should emit update:cancel when onCancel is called", () => {
    wrapper.vm.onCancel();
    expect(wrapper.emitted('update:cancel')).toBeTruthy();
    expect(wrapper.emitted('update:cancel').length).toBe(1);
  });

  it("should emit update:ok when onConfirm is called", () => {
    wrapper.vm.onConfirm();
    expect(wrapper.emitted('update:ok')).toBeTruthy();
    expect(wrapper.emitted('update:ok').length).toBe(1);
  });

  it("should initialize resumeFromStart with shouldStartfromNow prop value", () => {
    expect(wrapper.vm.resumeFromStart).toBe(false);
    
    // Test with different initial value
    const wrapperWithTrue = mount(ResumePipelineDialog, {
      props: {
        ...defaultProps,
        shouldStartfromNow: true
      },
      global: {
        plugins: [i18n],
        provide: { store },
        stubs: {
          'q-dialog': true,
          'q-card': true,
          'q-card-section': true,
          'q-card-actions': true,
          'q-btn': true,
          'q-radio': true
        }
      },
    });
    
    expect(wrapperWithTrue.vm.resumeFromStart).toBe(true);
    wrapperWithTrue.unmount();
  });

  it("should watch shouldStartfromNow prop and update resumeFromStart", async () => {
    expect(wrapper.vm.resumeFromStart).toBe(false);
    
    await wrapper.setProps({ shouldStartfromNow: true });
    expect(wrapper.vm.resumeFromStart).toBe(true);
    
    await wrapper.setProps({ shouldStartfromNow: false });
    expect(wrapper.vm.resumeFromStart).toBe(false);
  });

  it("should emit update:shouldStartfromNow when resumeFromStart changes", async () => {
    // Change the resumeFromStart value
    wrapper.vm.resumeFromStart = true;
    await wrapper.vm.$nextTick();
    
    expect(wrapper.emitted('update:shouldStartfromNow')).toBeTruthy();
    expect(wrapper.emitted('update:shouldStartfromNow')[0]).toEqual([true]);
    
    // Change it back
    wrapper.vm.resumeFromStart = false;
    await wrapper.vm.$nextTick();
    
    expect(wrapper.emitted('update:shouldStartfromNow').length).toBe(2);
    expect(wrapper.emitted('update:shouldStartfromNow')[1]).toEqual([false]);
  });

  it("should expose convertUnixToQuasarFormat function", () => {
    expect(typeof wrapper.vm.convertUnixToQuasarFormat).toBe("function");
  });
});