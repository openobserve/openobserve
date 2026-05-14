import { mount } from "@vue/test-utils";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import ResumePipelineDialog from "@/components/ResumePipelineDialog.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

installQuasar();

vi.mock("@/utils/zincutils", () => ({
  convertUnixToQuasarFormat: vi.fn(() => "2023-01-01 10:00:00"),
}));

const ODialogStub = {
  name: "ODialog",
  template:
    '<div class="o-dialog-stub" :data-open="open"><slot name="header" /><slot /><slot name="footer" /></div>',
  props: [
    "open",
    "size",
    "title",
    "subTitle",
    "persistent",
    "showClose",
    "width",
    "primaryButtonLabel",
    "secondaryButtonLabel",
    "neutralButtonLabel",
    "primaryVariant",
    "secondaryVariant",
    "neutralVariant",
    "primaryDisabled",
    "secondaryDisabled",
    "neutralDisabled",
    "primaryLoading",
    "secondaryLoading",
    "neutralLoading",
  ],
  emits: ["update:open", "click:primary", "click:secondary", "click:neutral"],
};

const buildWrapper = (overrideProps: Record<string, any> = {}) =>
  mount(ResumePipelineDialog, {
    props: {
      title: "Resume Pipeline",
      message: "Test message",
      lastPausedAt: 1672574400,
      shouldStartfromNow: false,
      modelValue: true,
      ...overrideProps,
    },
    global: {
      plugins: [i18n],
      provide: { store },
      stubs: {
        ODialog: ODialogStub,
        "q-radio": {
          template:
            '<div class="q-radio-stub" @click="$emit(\'update:modelValue\', val)"><slot /></div>',
          props: ["modelValue", "val"],
          emits: ["update:modelValue"],
        },
      },
    },
  });

describe("ResumePipelineDialog", () => {
  let wrapper: any = null;

  beforeEach(() => {
    wrapper = buildWrapper();
  });

  afterEach(() => {
    wrapper?.unmount();
  });

  it("should mount ResumePipelineDialog component", () => {
    expect(wrapper).toBeTruthy();
    expect(wrapper.exists()).toBe(true);
  });

  it("should have correct props", () => {
    expect(wrapper.props("title")).toBe("Resume Pipeline");
    expect(wrapper.props("lastPausedAt")).toBe(1672574400);
    expect(wrapper.props("shouldStartfromNow")).toBe(false);
    expect(wrapper.props("modelValue")).toBe(true);
  });

  it("should render ODialog with computed props", () => {
    const dialog = wrapper.findComponent(ODialogStub);
    expect(dialog.exists()).toBe(true);
    expect(dialog.props("size")).toBe("sm");
    expect(dialog.props("title")).toBe("Resume Pipeline Ingestion");
    expect(dialog.props("subTitle")).toBe("Last paused: 2023-01-01 10:00:00");
    expect(dialog.props("primaryButtonLabel")).toBeTruthy();
    expect(dialog.props("secondaryButtonLabel")).toBeTruthy();
    expect(dialog.props("open")).toBe(true);
  });

  it("should pass undefined subTitle when lastPausedAt is missing", () => {
    const localWrapper = buildWrapper({ lastPausedAt: undefined });
    const dialog = localWrapper.findComponent(ODialogStub);
    expect(dialog.props("subTitle")).toBeUndefined();
    localWrapper.unmount();
  });

  it("should expose necessary functions from setup", () => {
    expect(typeof wrapper.vm.onCancel).toBe("function");
    expect(typeof wrapper.vm.onConfirm).toBe("function");
    expect(typeof wrapper.vm.convertUnixToQuasarFormat).toBe("function");
  });

  it("should emit update:cancel and update:modelValue=false when onCancel is called", () => {
    wrapper.vm.onCancel();
    expect(wrapper.emitted("update:cancel")).toBeTruthy();
    expect(wrapper.emitted("update:cancel").length).toBe(1);
    expect(wrapper.emitted("update:modelValue")).toBeTruthy();
    expect(wrapper.emitted("update:modelValue").at(-1)).toEqual([false]);
  });

  it("should emit update:ok and update:modelValue=false when onConfirm is called", () => {
    wrapper.vm.onConfirm();
    expect(wrapper.emitted("update:ok")).toBeTruthy();
    expect(wrapper.emitted("update:ok").length).toBe(1);
    expect(wrapper.emitted("update:modelValue")).toBeTruthy();
    expect(wrapper.emitted("update:modelValue").at(-1)).toEqual([false]);
  });

  it("should call onCancel when ODialog emits click:secondary", async () => {
    const dialog = wrapper.findComponent(ODialogStub);
    await dialog.vm.$emit("click:secondary");
    expect(wrapper.emitted("update:cancel")).toBeTruthy();
    expect(wrapper.emitted("update:modelValue").at(-1)).toEqual([false]);
  });

  it("should call onConfirm when ODialog emits click:primary", async () => {
    const dialog = wrapper.findComponent(ODialogStub);
    await dialog.vm.$emit("click:primary");
    expect(wrapper.emitted("update:ok")).toBeTruthy();
    expect(wrapper.emitted("update:modelValue").at(-1)).toEqual([false]);
  });

  it("should propagate update:open from ODialog to update:modelValue", async () => {
    const dialog = wrapper.findComponent(ODialogStub);
    await dialog.vm.$emit("update:open", false);
    expect(wrapper.emitted("update:modelValue")).toBeTruthy();
    expect(wrapper.emitted("update:modelValue").at(-1)).toEqual([false]);
  });

  it("should initialize resumeFromStart with shouldStartfromNow prop value", () => {
    expect(wrapper.vm.resumeFromStart).toBe(false);

    const wrapperWithTrue = buildWrapper({ shouldStartfromNow: true });
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
    wrapper.vm.resumeFromStart = true;
    await wrapper.vm.$nextTick();

    expect(wrapper.emitted("update:shouldStartfromNow")).toBeTruthy();
    expect(wrapper.emitted("update:shouldStartfromNow")[0]).toEqual([true]);

    wrapper.vm.resumeFromStart = false;
    await wrapper.vm.$nextTick();

    expect(wrapper.emitted("update:shouldStartfromNow").length).toBe(2);
    expect(wrapper.emitted("update:shouldStartfromNow")[1]).toEqual([false]);
  });

  it("should default modelValue to false when not provided", () => {
    const localWrapper = mount(ResumePipelineDialog, {
      props: {
        title: "Resume Pipeline",
        lastPausedAt: 1672574400,
        shouldStartfromNow: false,
      },
      global: {
        plugins: [i18n],
        provide: { store },
        stubs: { ODialog: ODialogStub, "q-radio": true },
      },
    });
    const dialog = localWrapper.findComponent(ODialogStub);
    expect(dialog.props("open")).toBe(false);
    localWrapper.unmount();
  });
});
