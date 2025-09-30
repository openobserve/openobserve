import { flushPromises, mount } from "@vue/test-utils";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Dialog, Notify } from "quasar";
import useDnD from '@/plugins/pipelines/useDnD';
import { installQuasar } from "@/test/unit/helpers";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import i18n from "@/locales";
import AssociateFunction from "./AssociateFunction.vue";

installQuasar({
  plugins: [Dialog, Notify],
});

const mockAddNode = vi.fn();
vi.mock('@/plugins/pipelines/useDnD', () => ({
  default: vi.fn(),
  useDnD: () => ({
    addNode: mockAddNode,
    pipelineObj: {
      isEditNode: false,
      currentSelectedNodeData: null,
      userClickedNode: {},
      userSelectedNode: {},
    },
    deletePipelineNode: vi.fn()
  })
}));

describe("AssociateFunction Component", () => {
  let wrapper;
  let mockPipelineObj;
  let mockStore;

  beforeEach(async () => {
    // Setup mock store
    mockStore = {
      state: {
        theme: 'light',
        selectedOrganization: {
          identifier: "test-org"
        },
        userInfo: {
          email: "test@example.com"
        }
      }
    };

    // Setup mock pipeline object
    mockPipelineObj = {
      currentSelectedNodeData: {
        data: {},
        type: 'function'
      },
      userSelectedNode: {},
      isEditNode: false,
      functions: {
        function1: {
          function: 'console.log("test function 1");',
          name: 'function1'
        },
        function2: {
          function: 'console.log("test function 2");',
          name: 'function2'
        },
        function3: {
          function: 'console.log("test function 3");',
          name: 'function3'
        }
      }
    };

    // Mock useDnD composable
    vi.mocked(useDnD).mockImplementation(() => ({
      pipelineObj: mockPipelineObj,
      addNode: mockAddNode,
      deletePipelineNode: vi.fn()
    }));

    // Mount component
    wrapper = mount(AssociateFunction, {
      global: {
        plugins: [i18n],
        provide: {
          store: mockStore,
        },
        stubs: {
          AddFunction: true,
          ConfirmDialog: true,
        }
      },
      props: {
        functions: ["function1", "function2", "function3"],
        associatedFunctions: ["function4"]
      }
    });

    const notifyMock = vi.fn();
    wrapper.vm.$q.notify = notifyMock;

    await flushPromises();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("Component Initialization", () => {
    it("mounts successfully", () => {
      expect(wrapper.exists()).toBe(true);
    });

    it("initializes with default values", () => {
      expect(wrapper.vm.createNewFunction).toBe(false);
      expect(wrapper.vm.afterFlattening).toBe(true);
      expect(wrapper.vm.loading).toBe(false);
    });

    it("initializes with provided functions", () => {
      expect(wrapper.vm.filteredFunctions).toEqual(["function1", "function2", "function3"]);
    });
  });

  describe("Function Selection", () => {
    it("filters functions based on search value", async () => {
      const mockUpdate = vi.fn();
      wrapper.vm.filterFunctions("function1", mockUpdate);
      
      expect(mockUpdate).toHaveBeenCalled();
      const updateFn = mockUpdate.mock.calls[0][0];
      updateFn();
      expect(wrapper.vm.filteredFunctions).toContain("function1");
    });

    it("prevents selecting already associated function", async () => {
      wrapper.vm.selectedFunction = "function4";
      await wrapper.vm.saveFunction();
      
      expect(wrapper.vm.functionExists).toBe(true);
      expect(mockAddNode).not.toHaveBeenCalled();
    });
  });

  describe("Create New Function Mode", () => {
    it("toggles create new function mode", async () => {
      await wrapper.find('[data-test="create-function-toggle"]').trigger('click');
      expect(wrapper.vm.createNewFunction).toBe(true);
    });

    it("shows create function form when in create mode", async () => {
      wrapper.vm.createNewFunction = true;
      await wrapper.vm.$nextTick();
      
      expect(wrapper.find('.pipeline-add-function').exists()).toBe(true);
    });

    it("prevents saving when function name is empty in create mode", async () => {
      wrapper.vm.createNewFunction = true;
      await wrapper.vm.$nextTick();
      
      // Mock the addFunctionRef properly
      wrapper.vm.addFunctionRef = {
        formData: {
          name: "",
          function: ""
        }
      };

      await wrapper.vm.saveFunction();
      
      expect(wrapper.vm.$q.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "Function Name is required",
          color: "negative"
        })
      );
    });

    it("handles valid function creation", async () => {
      wrapper.vm.createNewFunction = true;
      await wrapper.vm.$nextTick();
      
      wrapper.vm.addFunctionRef = {
        formData: {
          name: "newFunction",
          function: "console.log('test')"
        }
      };

      await wrapper.vm.saveFunction();
      expect(wrapper.vm.$q.notify).not.toHaveBeenCalled();
    });
  });

  describe("Dialog Handling", () => {
    it("opens cancel dialog with changes", async () => {
      wrapper.vm.selectedFunction = "function1";
      await wrapper.vm.openCancelDialog();
      
      expect(wrapper.vm.dialog.show).toBe(true);
      expect(wrapper.vm.dialog.title).toBe("Discard Changes");
      expect(wrapper.vm.dialog.message).toBe("Are you sure you want to cancel changes?");
    });


    it("opens delete dialog with correct content", async () => {
      await wrapper.vm.openDeleteDialog();
      
      expect(wrapper.vm.dialog.show).toBe(true);
      expect(wrapper.vm.dialog.title).toBe("Delete Node");
      expect(wrapper.vm.dialog.message).toBe("Are you sure you want to delete function association?");
    });

    it("handles dialog confirmation", async () => {
      await wrapper.vm.openDeleteDialog();
      await wrapper.vm.dialog.okCallback();
      
      expect(wrapper.emitted()["cancel:hideform"]).toBeTruthy();
    });
  });

  describe("Edit Mode", () => {
    beforeEach(async () => {
      mockPipelineObj.isEditNode = true;
      mockPipelineObj.currentSelectedNodeData = {
        data: {
          name: "function1",
          after_flatten: false
        }
      };
      mockPipelineObj.functions = {
        function1: {
          function: 'console.log("test function 1");',
          name: 'function1'
        },
        function2: {
          function: 'console.log("test function 2");',
          name: 'function2'
        },
        function3: {
          function: 'console.log("test function 3");',
          name: 'function3'
        }
      };

      // Mock useDnD composable for edit mode
      vi.mocked(useDnD).mockImplementation(() => ({
        pipelineObj: mockPipelineObj,
        addNode: mockAddNode,
        deletePipelineNode: vi.fn()
      }));

      // Mount component with edit mode props
      wrapper = mount(AssociateFunction, {
        global: {
          plugins: [i18n],
          provide: {
            store: mockStore,
          },
          stubs: {
            AddFunction: true,
            ConfirmDialog: true
          }
        },
        props: {
          functions: ["function1", "function2", "function3"],
          associatedFunctions: ["function4"]
        }
      });

      const notifyMock = vi.fn();
      wrapper.vm.$q.notify = notifyMock;

      await flushPromises();
      await wrapper.vm.$nextTick();
    });

    it("loads existing function data in edit mode", () => {
      expect(wrapper.vm.selectedFunction).toBe("function1");
      expect(wrapper.vm.afterFlattening).toBe(false);
    });

    it("disables function selection in edit mode", async () => {
      // Set isUpdating to true to trigger readonly and disable
      wrapper.vm.isUpdating = true;
      await wrapper.vm.$nextTick();

      // Find the select input wrapper
      const selectInput = wrapper.find('[data-test="associate-function-select-function-input"]');
      expect(selectInput.exists()).toBe(true);

      // Find the q-select element
      const select = selectInput.find('.q-select');
      expect(select.exists()).toBe(true);


      // Verify the component is actually disabled
      const inputElement = select.find('input');
      expect(inputElement.exists()).toBe(true);
      expect(inputElement.attributes().disabled).toBe('');
    });

    it("shows delete button in edit mode", () => {
      const deleteButton = wrapper.find('[data-test="associate-function-delete-btn"]');
      expect(deleteButton.exists()).toBe(true);
    });
  });

  describe("After Flattening Toggle", () => {
    it("toggles after flattening option", async () => {
      const toggle = wrapper.find('[data-test="associate-function-after-flattening-toggle"]');
      await toggle.trigger('click');
      expect(wrapper.vm.afterFlattening).toBe(false);
    });

    it("saves function with after flattening option", async () => {
      wrapper.vm.selectedFunction = "function1";
      wrapper.vm.afterFlattening = false;
      
      await wrapper.vm.saveFunction();
      
      expect(mockAddNode).toHaveBeenCalledWith({
        name: "function1",
        after_flatten: false
      });
    });
  });

  describe("Function List Management", () => {
    it("sorts functions alphabetically", async () => {
      wrapper = mount(AssociateFunction, {
        global: {
          plugins: [i18n],
          provide: { store: mockStore },
          stubs: {
            AddFunction: true,
            ConfirmDialog: true,
          }
        },
        props: {
          functions: ["zFunction", "aFunction", "mFunction"],
          associatedFunctions: []
        }
      });

      await flushPromises();
      expect(wrapper.vm.filteredFunctions).toEqual(["aFunction", "mFunction", "zFunction"]);
    });

    it("filters functions case-insensitively", async () => {
      const mockUpdate = vi.fn();
      wrapper.vm.filterFunctions("FUNCTION1", mockUpdate);
      
      expect(mockUpdate).toHaveBeenCalled();
      const updateFn = mockUpdate.mock.calls[0][0];
      updateFn();
      expect(wrapper.vm.filteredFunctions).toContain("function1");
    });
  });

  describe("Component Style", () => {
    it("applies correct style based on create function mode", async () => {
      expect(wrapper.vm.computedStyleForFunction).toEqual({ width: "100%", height: "100%" });
      
      wrapper.vm.createNewFunction = true;
      await wrapper.vm.$nextTick();
      
      expect(wrapper.vm.computedStyleForFunction).toEqual({ width: "100%" });
    });
  });

  describe("Loading State", () => {
    it("shows spinner when loading", async () => {
      wrapper.vm.loading = true;
      await wrapper.vm.$nextTick();
      
      const spinner = wrapper.find('.q-spinner');
      expect(spinner.exists()).toBe(true);
    });

    it("hides form content when loading", async () => {
      wrapper.vm.loading = true;
      await wrapper.vm.$nextTick();
      
      const formContent = wrapper.find('.stream-routing-container');
      // Check if v-else is working correctly
      expect(formContent.exists()).toBe(false);
      
      // Also verify that when not loading, the form is visible
      wrapper.vm.loading = false;
      await wrapper.vm.$nextTick();
      const visibleForm = wrapper.find('.stream-routing-container');
      expect(visibleForm.exists()).toBe(true);
    });
  });
});