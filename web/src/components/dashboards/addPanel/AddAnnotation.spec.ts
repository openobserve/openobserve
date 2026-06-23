// Copyright 2026 OpenObserve Inc.
//
// Licensed under the GNU Affero General Public License, Version 3.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     https://www.gnu.org/licenses/agpl-3.0.en.html
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import AddAnnotation from "./AddAnnotation.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import { annotationService } from "@/services/dashboard_annotations";

// Mock the annotation service
vi.mock("@/services/dashboard_annotations", () => ({
  annotationService: {
    create_timed_annotations: vi.fn(),
    update_timed_annotations: vi.fn(),
    delete_timed_annotations: vi.fn(),
  },
}));

const node = document.createElement("div");
node.setAttribute("id", "app");
document.body.appendChild(node);


// Stub ODialog so tests are deterministic (no Portal/Teleport)
// and so we can assert on the props the component forwards + emit
// the click events the component listens to.
const ODialogStub = {
  name: "ODialog",
  inheritAttrs: false,
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
    "primaryButtonVariant",
    "secondaryButtonVariant",
    "neutralButtonVariant",
    "primaryButtonDisabled",
    "secondaryButtonDisabled",
    "neutralButtonDisabled",
    "primaryButtonLoading",
    "secondaryButtonLoading",
    "neutralButtonLoading",
  ],
  emits: ["update:open", "click:primary", "click:secondary", "click:neutral"],
  template: `
    <div
      data-test="o-dialog-stub"
      :data-open="String(open)"
      :data-size="size"
      :data-title="title"
      :data-primary-label="primaryButtonLabel"
      :data-secondary-label="secondaryButtonLabel"
    >
      <span data-test="o-dialog-stub-title">{{ title }}</span>
      <slot name="header" />
      <slot />
      <slot name="footer" />
    </div>
  `,
};

function buildWrapper(propsOverride: Record<string, any> = {}) {
  return mount(AddAnnotation, {
    attachTo: "#app",
    props: {
      dashboardId: "dashboard1",
      panelsList: [
        { id: "panel1", title: "Panel 1", tabName: "Tab 1" },
        { id: "panel2", title: "Panel 2", tabName: "Tab 1" },
        { id: "panel3", title: "Panel 3", tabName: "Tab 2" },
      ],
      ...propsOverride,
    },
    global: {
      plugins: [i18n, router],
      provide: {
        store,
      },
      stubs: {
        ODialog: ODialogStub,
      },
    },
  });
}

const mockAnnotation = {
  annotation_id: "123",
  title: "Test Annotation",
  text: "Test Description",
  start_time: 1629936000000,
  end_time: 1629939600000,
  tags: [],
  panels: ["panel1"],
};

describe("AddAnnotation", () => {
  let wrapper: ReturnType<typeof buildWrapper>;

  beforeEach(async () => {
    store.state.selectedOrganization = { identifier: "test-org" };
    wrapper = buildWrapper();
    await flushPromises();
  });

  afterEach(() => {
    if (wrapper) wrapper.unmount();
    vi.clearAllMocks();
  });

  it("renders the ODialog wrapper", () => {
    expect(wrapper.find('[data-test="o-dialog-stub"]').exists()).toBe(true);
    expect(wrapper.findComponent({ name: "OInput" }).exists()).toBeTruthy();
  });

  it("uses the Add Annotation title when no annotation prop is provided", () => {
    const dialog = wrapper.findAllComponents(ODialogStub)[0];
    expect(dialog.props("title")).toBe("Add Annotation");
  });

  it("forwards persistent and size='lg' to the outer ODialog", () => {
    const dialog = wrapper.findAllComponents(ODialogStub)[0];
    // `persistent` is used as a boolean-shorthand attribute in the template,
    // so it's forwarded as an empty string by Vue.
    expect(dialog.props("persistent")).toBe("");
    expect(dialog.props("size")).toBe("lg");
  });

  it("opens the outer ODialog by default (isOpen=true)", () => {
    const dialog = wrapper.findAllComponents(ODialogStub)[0];
    expect(dialog.props("open")).toBe(true);
  });

  it("shows edit mode title when an annotation prop is provided", async () => {
    wrapper.unmount();
    wrapper = buildWrapper({ annotation: mockAnnotation });
    await flushPromises();

    const dialog = wrapper.findAllComponents(ODialogStub)[0];
    expect(dialog.props("title")).toBe("Edit Annotation");
  });

  it("renders save/update and cancel buttons", () => {
    const dialog = wrapper.findAllComponents(ODialogStub)[0];
    expect(dialog.props("primaryButtonLabel")).toBeTruthy();
    expect(dialog.props("secondaryButtonLabel")).toBe("Cancel");
  });

  it("renders a Save button (not Update) when not in edit mode", () => {
    const dialog = wrapper.findAllComponents(ODialogStub)[0];
    expect(dialog.props("primaryButtonLabel")).toBe("Save");
    expect(dialog.props("neutralButtonLabel")).toBeFalsy();
  });

  it("calls create_timed_annotations when submitting a valid new annotation", async () => {
    (annotationService.create_timed_annotations as any).mockResolvedValueOnce({});

    const inputs = wrapper.findAllComponents({ name: "OInput" });
    expect(inputs.length).toBeGreaterThan(0);
    await inputs[0].vm.$emit("update:modelValue", "New Annotation");
    await flushPromises();

    // Submit through the form (schema validates → @submit fires when valid).
    // Drive + AWAIT the form's own handleSubmit (runs the schema, awaits the
    // handler) — deterministic, unlike a fire-and-forget native submit event.
    await (wrapper.findComponent({ name: "OForm" }).vm as any).form.handleSubmit();
    await flushPromises();

    expect(annotationService.create_timed_annotations).toHaveBeenCalledTimes(1);
    expect(annotationService.create_timed_annotations).toHaveBeenCalledWith(
      "test-org",
      "dashboard1",
      expect.any(Array),
    );
  });

  it("does not call create_timed_annotations when the title is empty (schema blocks submit)", async () => {
    // Drive + AWAIT the form's own handleSubmit (runs the schema, awaits the
    // handler) — deterministic, unlike a fire-and-forget native submit event.
    await (wrapper.findComponent({ name: "OForm" }).vm as any).form.handleSubmit();
    await flushPromises();

    expect(annotationService.create_timed_annotations).not.toHaveBeenCalled();
  });

  it("calls update_timed_annotations when in edit mode and submitting", async () => {
    wrapper.unmount();
    wrapper = buildWrapper({ annotation: { ...mockAnnotation } });
    await flushPromises();

    (annotationService.update_timed_annotations as any).mockResolvedValueOnce({});

    // Title is pre-filled (edit mode) → schema passes → submit updates.
    // Drive + AWAIT the form's own handleSubmit (runs the schema, awaits the
    // handler) — deterministic, unlike a fire-and-forget native submit event.
    await (wrapper.findComponent({ name: "OForm" }).vm as any).form.handleSubmit();
    await flushPromises();

    expect(annotationService.update_timed_annotations).toHaveBeenCalledTimes(1);
    expect(annotationService.update_timed_annotations).toHaveBeenCalledWith(
      "test-org",
      "dashboard1",
      "123",
      expect.objectContaining({
        title: "Test Annotation",
        text: "Test Description",
      }),
    );
  });

  it("carries the form-owned text + panels (edit prefill) through the @submit payload", async () => {
    // text/panels are now OWNED by the form (OFormTextarea name='text',
    // OFormSelect name='panels'); edit-prefill seeds them via addAnnotationDefaults
    // and they must round-trip through the submit payload back into the update call.
    wrapper.unmount();
    wrapper = buildWrapper({ annotation: { ...mockAnnotation } });
    await flushPromises();

    (annotationService.update_timed_annotations as any).mockResolvedValueOnce({});

    await (wrapper.findComponent({ name: "OForm" }).vm as any).form.handleSubmit();
    await flushPromises();

    expect(annotationService.update_timed_annotations).toHaveBeenCalledWith(
      "test-org",
      "dashboard1",
      "123",
      expect.objectContaining({
        text: "Test Description",
        panels: ["panel1"],
      }),
    );
  });

  it("renders a Delete button in edit mode", async () => {
    wrapper.unmount();
    wrapper = buildWrapper({ annotation: mockAnnotation });
    await flushPromises();

    const dialog = wrapper.findAllComponents(ODialogStub)[0];
    expect(dialog.props("neutralButtonLabel")).toBe("Delete");
  });

  it("opens the nested delete-confirm ODialog when Delete is clicked", async () => {
    wrapper.unmount();
    wrapper = buildWrapper({ annotation: mockAnnotation });
    await flushPromises();

    // Before clicking Delete the inner confirm dialog is closed.
    let dialogs = wrapper.findAllComponents(ODialogStub);
    const innerDialogBefore = dialogs[1];
    expect(innerDialogBefore.props("open")).toBe(false);
    expect(innerDialogBefore.props("title")).toBe("Confirm Delete");
    expect(innerDialogBefore.props("primaryButtonLabel")).toBe("Delete");
    expect(innerDialogBefore.props("secondaryButtonLabel")).toBe("Cancel");
    expect(innerDialogBefore.props("primaryButtonVariant")).toBe("destructive");
    expect(innerDialogBefore.props("size")).toBe("xs");

    // Delete is now the ODialog built-in neutral button → emits click:neutral.
    await wrapper.findAllComponents(ODialogStub)[0].vm.$emit("click:neutral");
    await flushPromises();

    dialogs = wrapper.findAllComponents(ODialogStub);
    expect(dialogs[1].props("open")).toBe(true);
  });

  it("closes the delete-confirm ODialog when its secondary button is clicked", async () => {
    wrapper.unmount();
    wrapper = buildWrapper({ annotation: mockAnnotation });
    await flushPromises();

    // Open the confirm dialog first.
    // Delete is now the ODialog built-in neutral button → emits click:neutral.
    await wrapper.findAllComponents(ODialogStub)[0].vm.$emit("click:neutral");
    await flushPromises();

    const innerDialog = wrapper.findAllComponents(ODialogStub)[1];
    expect(innerDialog.props("open")).toBe(true);

    await innerDialog.vm.$emit("click:secondary");
    await flushPromises();

    const innerDialogAfter = wrapper.findAllComponents(ODialogStub)[1];
    expect(innerDialogAfter.props("open")).toBe(false);
  });

  it("calls delete_timed_annotations when the confirm dialog primary is clicked", async () => {
    wrapper.unmount();
    wrapper = buildWrapper({ annotation: mockAnnotation });
    await flushPromises();

    (annotationService.delete_timed_annotations as any).mockResolvedValueOnce({});

    // Open the confirm dialog.
    // Delete is now the ODialog built-in neutral button → emits click:neutral.
    await wrapper.findAllComponents(ODialogStub)[0].vm.$emit("click:neutral");
    await flushPromises();

    const innerDialog = wrapper.findAllComponents(ODialogStub)[1];
    await innerDialog.vm.$emit("click:primary");
    await flushPromises();

    expect(annotationService.delete_timed_annotations).toHaveBeenCalledTimes(1);
    expect(annotationService.delete_timed_annotations).toHaveBeenCalledWith(
      "test-org",
      "dashboard1",
      ["123"],
    );
  });

  it("emits close and closes the outer ODialog when Cancel is clicked", async () => {
    // Cancel is now the ODialog built-in secondary button → emits click:secondary.
    await wrapper.findAllComponents(ODialogStub)[0].vm.$emit("click:secondary");
    await flushPromises();

    expect(wrapper.emitted("close")).toBeTruthy();
    const dialog = wrapper.findAllComponents(ODialogStub)[0];
    expect(dialog.props("open")).toBe(false);
  });

  it("displays the timestamp in edit mode", async () => {
    wrapper.unmount();
    wrapper = buildWrapper({ annotation: mockAnnotation });
    await flushPromises();

    expect(wrapper.text()).toContain("Timestamp:");
  });

  // R3: the Save button is ALWAYS enabled — submit is gated by the Zod schema,
  // not by disabling the button. (Replaces the old `:disabled="!title"` tests.)
  it("keeps the Save button enabled even when the title is empty", () => {
    const dialog = wrapper.findAllComponents(ODialogStub)[0];
    expect(dialog.props("primaryButtonLabel")).toBeTruthy();
    expect(dialog.props("primaryButtonDisabled")).toBeFalsy();
  });

  it("keeps the Save button enabled after the title is filled in", async () => {
    const inputs = wrapper.findAllComponents({ name: "OInput" });
    await inputs[0].vm.$emit("update:modelValue", "Has a title now");
    await flushPromises();

    const dialog = wrapper.findAllComponents(ODialogStub)[0];
    expect(dialog.props("primaryButtonDisabled")).toBeFalsy();
  });

  it("shows an error notification and does not close when update_timed_annotations rejects", async () => {
    wrapper.unmount();
    wrapper = buildWrapper({ annotation: mockAnnotation });
    await flushPromises();

    (annotationService.update_timed_annotations as any).mockRejectedValueOnce(
      new Error("boom"),
    );

    // Drive + AWAIT the form's own handleSubmit (runs the schema, awaits the
    // handler) — deterministic, unlike a fire-and-forget native submit event.
    await (wrapper.findComponent({ name: "OForm" }).vm as any).form.handleSubmit();
    await flushPromises();

    // close event should NOT be emitted because the save short-circuited on error
    expect(wrapper.emitted("close")).toBeFalsy();
    const dialog = wrapper.findAllComponents(ODialogStub)[0];
    expect(dialog.props("open")).toBe(true);
  });

  it("shows an error notification and does not close when create_timed_annotations rejects", async () => {
    (annotationService.create_timed_annotations as any).mockRejectedValueOnce(
      new Error("boom"),
    );

    const inputs = wrapper.findAllComponents({ name: "OInput" });
    await inputs[0].vm.$emit("update:modelValue", "Title");
    await flushPromises();

    // Drive + AWAIT the form's own handleSubmit (runs the schema, awaits the
    // handler) — deterministic, unlike a fire-and-forget native submit event.
    await (wrapper.findComponent({ name: "OForm" }).vm as any).form.handleSubmit();
    await flushPromises();

    expect(wrapper.emitted("close")).toBeFalsy();
    const dialog = wrapper.findAllComponents(ODialogStub)[0];
    expect(dialog.props("open")).toBe(true);
  });
});
