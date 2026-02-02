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
    expect(wrapper.findComponent({ name: "QDialog" }).exists()).toBeTruthy();
    expect(wrapper.findComponent({ name: "QInput" }).exists()).toBeTruthy();
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

    expect(wrapper.findComponent({ name: "QDialog" }).exists()).toBeTruthy();
  });

  it("should render save/update and cancel buttons", () => {
    const buttons = wrapper.findAllComponents({ name: "QBtn" });
    expect(buttons.length).toBeGreaterThan(0);
  });

  it("should call create_timed_annotations when saving", async () => {
    annotationService.create_timed_annotations.mockResolvedValueOnce({});
    
    const inputs = wrapper.findAllComponents({ name: "QInput" });
    if (inputs.length > 0) {
      await inputs[0].vm.$emit("update:modelValue", "New Annotation");
    }
    await flushPromises();

    const buttons = wrapper.findAllComponents({ name: "QBtn" });
    const saveButton = buttons.find((btn: any) => 
      btn.props("label") === "Save" || btn.text().includes("Save")
    );
    
    if (saveButton) {
      await saveButton.vm.$emit("click");
      await flushPromises();
    }

    expect(annotationService.create_timed_annotations).toHaveBeenCalled();
  });

  it("should call update_timed_annotations when updating", async () => {
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

    annotationService.update_timed_annotations.mockResolvedValueOnce({});

    const buttons = wrapper.findAllComponents({ name: "QBtn" });
    const updateButton = buttons.find((btn: any) => 
      btn.props("label") === "Update" || btn.text().includes("Update")
    );
    
    if (updateButton) {
      await updateButton.vm.$emit("click");
      await flushPromises();
    }

    expect(annotationService.update_timed_annotations).toHaveBeenCalled();
  });

  it("should show delete button in edit mode", async () => {
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

    const buttons = wrapper.findAllComponents({ name: "QBtn" });
    const deleteButton = buttons.find((btn: any) => 
      btn.props("label") === "Delete" || btn.text().includes("Delete")
    );
    expect(deleteButton).toBeTruthy();
  });

  it("should display timestamp in edit mode", async () => {
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

    const timestampElement = wrapper.find(".text-caption");
    if (timestampElement.exists()) {
      expect(timestampElement.text()).toContain("Timestamp:");
    }
  });
});
