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
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { Dialog, Notify } from "quasar";
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

installQuasar({
  plugins: [Dialog, Notify],
});

// Stub ODialog so tests are deterministic (no Portal/Teleport)
// and so we can assert on the props the component forwards + emit
// the click events the component listens to.
const ODialogStub = {
  name: "ODialog",
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
    expect(wrapper.findComponent({ name: "QInput" }).exists()).toBeTruthy();
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
    const buttons = wrapper.findAllComponents({ name: "OButton" });
    expect(buttons.length).toBeGreaterThan(0);
  });

  it("renders a Save button (not Update) when not in edit mode", () => {
    const oButtons = wrapper.findAllComponents({ name: "OButton" });
    const labels = oButtons.map((b: any) => b.text());
    expect(labels).toContain("Save");
    expect(labels).not.toContain("Update");
    expect(labels).not.toContain("Delete");
  });

  it("calls create_timed_annotations when saving a new annotation", async () => {
    (annotationService.create_timed_annotations as any).mockResolvedValueOnce({});

    const inputs = wrapper.findAllComponents({ name: "QInput" });
    expect(inputs.length).toBeGreaterThan(0);
    await inputs[0].vm.$emit("update:modelValue", "New Annotation");
    await flushPromises();

    const oButtons = wrapper.findAllComponents({ name: "OButton" });
    const saveButton = oButtons.find((btn: any) => btn.text().includes("Save"));
    expect(saveButton).toBeTruthy();

    await saveButton!.trigger("click");
    await flushPromises();

    expect(annotationService.create_timed_annotations).toHaveBeenCalledTimes(1);
    expect(annotationService.create_timed_annotations).toHaveBeenCalledWith(
      "test-org",
      "dashboard1",
      expect.any(Array),
    );
  });

  it("does not call create_timed_annotations when the title is empty", async () => {
    const oButtons = wrapper.findAllComponents({ name: "OButton" });
    const saveButton = oButtons.find((btn: any) => btn.text().includes("Save"));
    expect(saveButton).toBeTruthy();

    await saveButton!.trigger("click");
    await flushPromises();

    expect(annotationService.create_timed_annotations).not.toHaveBeenCalled();
  });

  it("calls update_timed_annotations when in edit mode and clicking Update", async () => {
    wrapper.unmount();
    wrapper = buildWrapper({ annotation: { ...mockAnnotation } });
    await flushPromises();

    (annotationService.update_timed_annotations as any).mockResolvedValueOnce({});

    const oButtons = wrapper.findAllComponents({ name: "OButton" });
    const updateButton = oButtons.find((btn: any) =>
      btn.text().includes("Update"),
    );
    expect(updateButton).toBeTruthy();

    await updateButton!.trigger("click");
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

  it("renders a Delete button in edit mode", async () => {
    wrapper.unmount();
    wrapper = buildWrapper({ annotation: mockAnnotation });
    await flushPromises();

    const oButtons = wrapper.findAllComponents({ name: "OButton" });
    const deleteButton = oButtons.find((btn: any) =>
      btn.text().includes("Delete"),
    );
    expect(deleteButton).toBeTruthy();
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

    const oButtons = wrapper.findAllComponents({ name: "OButton" });
    const deleteButton = oButtons.find((btn: any) =>
      btn.text().includes("Delete"),
    );
    await deleteButton!.trigger("click");
    await flushPromises();

    dialogs = wrapper.findAllComponents(ODialogStub);
    expect(dialogs[1].props("open")).toBe(true);
  });

  it("closes the delete-confirm ODialog when its secondary button is clicked", async () => {
    wrapper.unmount();
    wrapper = buildWrapper({ annotation: mockAnnotation });
    await flushPromises();

    // Open the confirm dialog first.
    const oButtons = wrapper.findAllComponents({ name: "OButton" });
    const deleteButton = oButtons.find((btn: any) =>
      btn.text().includes("Delete"),
    );
    await deleteButton!.trigger("click");
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
    const oButtons = wrapper.findAllComponents({ name: "OButton" });
    const deleteButton = oButtons.find((btn: any) =>
      btn.text().includes("Delete"),
    );
    await deleteButton!.trigger("click");
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
    const oButtons = wrapper.findAllComponents({ name: "OButton" });
    const cancelButton = oButtons.find((btn: any) =>
      btn.text().includes("Cancel"),
    );
    expect(cancelButton).toBeTruthy();

    await cancelButton!.trigger("click");
    await flushPromises();

    expect(wrapper.emitted("close")).toBeTruthy();
    const dialog = wrapper.findAllComponents(ODialogStub)[0];
    expect(dialog.props("open")).toBe(false);
  });

  it("displays the timestamp in edit mode", async () => {
    wrapper.unmount();
    wrapper = buildWrapper({ annotation: mockAnnotation });
    await flushPromises();

    const timestampElement = wrapper.find(".text-caption");
    expect(timestampElement.exists()).toBe(true);
    expect(timestampElement.text()).toContain("Timestamp:");
  });

  it("disables the primary save button when the title is empty", () => {
    const oButtons = wrapper.findAllComponents({ name: "OButton" });
    const saveButton = oButtons.find((btn: any) => btn.text().includes("Save"));
    expect(saveButton).toBeTruthy();
    expect(saveButton!.props("disabled")).toBe(true);
  });

  it("enables the primary save button once the title is filled in", async () => {
    const inputs = wrapper.findAllComponents({ name: "QInput" });
    await inputs[0].vm.$emit("update:modelValue", "Has a title now");
    await flushPromises();

    const oButtons = wrapper.findAllComponents({ name: "OButton" });
    const saveButton = oButtons.find((btn: any) => btn.text().includes("Save"));
    expect(saveButton!.props("disabled")).toBe(false);
  });

  it("shows an error notification and does not close when update_timed_annotations rejects", async () => {
    wrapper.unmount();
    wrapper = buildWrapper({ annotation: mockAnnotation });
    await flushPromises();

    (annotationService.update_timed_annotations as any).mockRejectedValueOnce(
      new Error("boom"),
    );

    const oButtons = wrapper.findAllComponents({ name: "OButton" });
    const updateButton = oButtons.find((btn: any) =>
      btn.text().includes("Update"),
    );
    await updateButton!.trigger("click");
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

    const inputs = wrapper.findAllComponents({ name: "QInput" });
    await inputs[0].vm.$emit("update:modelValue", "Title");
    await flushPromises();

    const oButtons = wrapper.findAllComponents({ name: "OButton" });
    const saveButton = oButtons.find((btn: any) => btn.text().includes("Save"));
    await saveButton!.trigger("click");
    await flushPromises();

    expect(wrapper.emitted("close")).toBeFalsy();
    const dialog = wrapper.findAllComponents(ODialogStub)[0];
    expect(dialog.props("open")).toBe(true);
  });
});
