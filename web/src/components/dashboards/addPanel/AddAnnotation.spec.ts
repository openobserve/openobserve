// Copyright 2023 OpenObserve Inc.
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

describe("AddAnnotation", () => {
  let wrapper: any;
  const mockPanelsList = [
    { id: "panel1", title: "Panel 1", tabName: "Tab 1" },
    { id: "panel2", title: "Panel 2", tabName: "Tab 1" },
    { id: "panel3", title: "Panel 3", tabName: "Tab 2" },
  ];

  const defaultProps = {
    dashboardId: "dashboard1",
    panelsList: mockPanelsList,
  };

  beforeEach(async () => {
    // Set up store state
    store.state.selectedOrganization = { identifier: "test-org" };
    
    wrapper = mount(AddAnnotation, {
      attachTo: "#app",
      props: defaultProps,
      global: {
        plugins: [i18n, router],
        provide: {
          store,
        },
      },
    });
    await flushPromises();
  });

  afterEach(() => {
    wrapper.unmount();
    vi.clearAllMocks();
  });

  it("should render add annotation dialog", () => {
    expect(wrapper.find(".text-h6").text()).toBe("Add Annotation");
    expect(wrapper.find("input[label='Title *']").exists()).toBeTruthy();
    expect(wrapper.find("textarea").exists()).toBeTruthy();
  });

  it("should show edit mode when annotation prop is provided", async () => {
    const mockAnnotation = {
      annotation_id: "123",
      title: "Test Annotation",
      text: "Test Description",
      start_time: 1629936000000,
      end_time: 1629939600000,
      tags: [],
      panels: ["panel1"],
    };

    wrapper = mount(AddAnnotation, {
      attachTo: "#app",
      props: {
        ...defaultProps,
        annotation: mockAnnotation,
      },
      global: {
        plugins: [i18n, router],
        provide: {
          store,
        },
      },
    });
    await flushPromises();

    expect(wrapper.find(".text-h6").text()).toBe("Edit Annotation");
    expect(wrapper.vm.annotationData.title).toBe("Test Annotation");
    expect(wrapper.vm.annotationData.text).toBe("Test Description");
  });

  it("should disable save button when title is empty", async () => {
    const saveButton = wrapper.find("button:contains('Save')");
    expect(saveButton.attributes("disabled")).toBeTruthy();

    await wrapper.find("input[label='Title *']").setValue("Test Title");
    expect(saveButton.attributes("disabled")).toBeFalsy();
  });

  it("should call create_timed_annotations when saving new annotation", async () => {
    const annotationData = {
      title: "New Annotation",
      text: "Description",
      panels: ["panel1"],
    };

    await wrapper.find("input[label='Title *']").setValue(annotationData.title);
    await wrapper.find("textarea").setValue(annotationData.text);
    await wrapper.vm.selectedPanels = ["panel1"];

    annotationService.create_timed_annotations.mockResolvedValueOnce({});

    await wrapper.find("button:contains('Save')").trigger("click");
    await flushPromises();

    expect(annotationService.create_timed_annotations).toHaveBeenCalledWith(
      "test-org",
      "dashboard1",
      [expect.objectContaining(annotationData)]
    );
  });

  it("should call update_timed_annotations when updating existing annotation", async () => {
    const mockAnnotation = {
      annotation_id: "123",
      title: "Test Annotation",
      text: "Test Description",
      start_time: 1629936000000,
      end_time: 1629939600000,
      tags: [],
      panels: ["panel1"],
    };

    wrapper = mount(AddAnnotation, {
      attachTo: "#app",
      props: {
        ...defaultProps,
        annotation: mockAnnotation,
      },
      global: {
        plugins: [i18n, router],
        provide: {
          store,
        },
      },
    });
    await flushPromises();

    const updatedAnnotation = {
      ...mockAnnotation,
      title: "Updated Title",
    };

    await wrapper.find("input[label='Title *']").setValue(updatedAnnotation.title);
    annotationService.update_timed_annotations.mockResolvedValueOnce({});

    await wrapper.find("button:contains('Update')").trigger("click");
    await flushPromises();

    expect(annotationService.update_timed_annotations).toHaveBeenCalledWith(
      "test-org",
      "dashboard1",
      mockAnnotation.annotation_id,
      expect.objectContaining({
        title: updatedAnnotation.title,
      })
    );
  });

  it("should show delete confirmation dialog when delete button is clicked", async () => {
    const mockAnnotation = {
      annotation_id: "123",
      title: "Test Annotation",
      text: "Test Description",
      start_time: 1629936000000,
      end_time: 1629939600000,
      tags: [],
      panels: ["panel1"],
    };

    wrapper = mount(AddAnnotation, {
      attachTo: "#app",
      props: {
        ...defaultProps,
        annotation: mockAnnotation,
      },
      global: {
        plugins: [i18n, router],
        provide: {
          store,
        },
      },
    });
    await flushPromises();

    expect(wrapper.vm.showDeleteConfirm).toBe(false);
    await wrapper.find("button:contains('Delete')").trigger("click");
    expect(wrapper.vm.showDeleteConfirm).toBe(true);
  });

  it("should display correct timestamp format", () => {
    const mockAnnotation = {
      annotation_id: "123",
      title: "Test Annotation",
      text: "Test Description",
      start_time: 1629936000000, // 2021-08-26 00:00:00
      end_time: 1629939600000, // 2021-08-26 01:00:00
      tags: [],
      panels: ["panel1"],
    };

    wrapper = mount(AddAnnotation, {
      attachTo: "#app",
      props: {
        ...defaultProps,
        annotation: mockAnnotation,
      },
      global: {
        plugins: [i18n, router],
        provide: {
          store,
        },
      },
    });

    const timestampText = wrapper.find(".text-caption").text();
    expect(timestampText).toContain("Timestamp:");
    expect(timestampText).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/);
  });
});
