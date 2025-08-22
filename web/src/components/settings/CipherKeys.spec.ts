// Copyright 2025 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { mount, DOMWrapper } from "@vue/test-utils";
import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import CipherKeys from "./CipherKeys.vue";
import i18n from "@/locales";
import { Dialog, Notify } from "quasar";
import { nextTick } from "vue";

installQuasar({
  plugins: [Dialog, Notify],
});

// Mock external services and components
vi.mock("@/services/cipher_keys", () => ({
  default: {
    list: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock("@/services/segment_analytics", () => ({
  default: {
    track: vi.fn(),
  },
}));

vi.mock("@/utils/zincutils", () => ({
  convertToTitleCase: vi.fn((str) => str),
}));

vi.mock("@/aws-exports", () => ({
  default: {},
}));

// Mock components
vi.mock("@/components/cipherkeys/AddCipherKey.vue", () => ({
  name: "AddCipherKey",
  template: "<div data-test='add-cipher-key'></div>",
  emits: ["cancel:hideform"],
}));

vi.mock("@/components/shared/grid/Pagination.vue", () => ({
  name: "QTablePagination",
  template: "<div data-test='q-table-pagination'></div>",
  props: ["scope", "pageTitle", "resultTotal", "perPageOptions", "position"],
  emits: ["update:changeRecordPerPage"],
}));

vi.mock("@/components/shared/grid/NoData.vue", () => ({
  name: "NoData",
  template: "<div data-test='no-data'>No Data Available</div>",
}));

vi.mock("@/components/ConfirmDialog.vue", () => ({
  name: "ConfirmDialog",
  template: `<div data-test='confirm-dialog' v-if='modelValue'>
    <div data-test='confirm-title'>{{ title }}</div>
    <div data-test='confirm-message'>{{ message }}</div>
    <button data-test='confirm-ok' @click='$emit("update:ok")'>OK</button>
    <button data-test='confirm-cancel' @click='$emit("update:cancel")'>Cancel</button>
  </div>`,
  props: ["title", "message", "modelValue"],
  emits: ["update:ok", "update:cancel", "update:modelValue"],
}));

// Import mocked service
import CipherKeysService from "@/services/cipher_keys";
const mockCipherKeysService = CipherKeysService as any;

// Mock Vuex store
const mockStore = {
  state: {
    theme: "light",
    selectedOrganization: {
      identifier: "test-org",
    },
  },
};

// Mock Vue Router
const mockRouter = {
  currentRoute: {
    value: {
      query: {},
    },
  },
  push: vi.fn(),
};

// Mock Quasar notify
const mockNotify = vi.fn();

const createWrapper = (props = {}, options = {}) => {
  return mount(CipherKeys, {
    props: {
      ...props,
    },
    global: {
      plugins: [i18n],
      mocks: {
        $store: mockStore,
        $router: mockRouter,
        $q: {
          notify: mockNotify,
        },
      },
      provide: {
        store: mockStore,
      },
      stubs: {
        QPage: {
          template: "<div data-test-stub='q-page'><slot></slot></div>",
        },
        QTable: {
          template: `<div data-test-stub='q-table'>
            <slot name='top' :scope='mockScope'></slot>
            <slot name='header' :props='{ cols: mockCols }'></slot>
            <div v-for='row in rows' :key='row.id'>
              <slot name='body-cell-actions' :props='{ row }'></slot>
            </div>
            <slot name='no-data'></slot>
            <slot name='bottom' :scope='mockScope'></slot>
          </div>`,
          props: ["rows", "columns", "pagination", "filter", "filterMethod"],
          data() {
            return {
              mockScope: { pagination: { page: 1, rowsPerPage: 20 } },
              mockCols: [
                { name: "name", label: "Name" },
                { name: "actions", label: "Actions" },
              ],
            };
          },
          methods: {
            setPagination: vi.fn(),
          },
        },
        QBtn: {
          template: `<button 
            data-test-stub='q-btn' 
            :data-test='$attrs["data-test"]'
            @click='$emit("click", $event)'
            :disabled='disable'
          >
            <slot></slot>
            {{ label }}
          </button>`,
          props: ["label", "disable", "icon", "color", "class", "padding"],
          emits: ["click"],
        },
        QInput: {
          template: `<input 
            data-test-stub='q-input' 
            :value='modelValue'
            @input='$emit("update:modelValue", $event.target.value)'
            :placeholder='placeholder'
          />`,
          props: ["modelValue", "placeholder", "filled", "dense", "clearable"],
          emits: ["update:modelValue"],
        },
        QIcon: {
          template: "<span data-test-stub='q-icon'></span>",
          props: ["name"],
        },
        QTh: {
          template: "<th data-test-stub='q-th'><slot></slot></th>",
          props: ["props", "class", "style"],
        },
        QTr: {
          template: "<tr data-test-stub='q-tr'><slot></slot></tr>",
          props: ["props"],
        },
        QTd: {
          template: "<td data-test-stub='q-td'><slot></slot></td>",
          props: ["props"],
        },
        AddCipherKey: {
          template: "<div data-test-stub='add-cipher-key'></div>",
          emits: ["cancel:hideform"],
        },
        QTablePagination: {
          template: "<div data-test-stub='q-table-pagination'></div>",
          props: ["scope", "pageTitle", "resultTotal", "perPageOptions", "position"],
          emits: ["update:changeRecordPerPage"],
        },
        NoData: {
          template: "<div data-test-stub='no-data'>No Data Available</div>",
        },
        ConfirmDialog: {
          template: `<div data-test-stub='confirm-dialog' v-if='modelValue'>
            <button data-test='confirm-ok' @click='$emit("update:ok")'>OK</button>
            <button data-test='confirm-cancel' @click='$emit("update:cancel")'>Cancel</button>
          </div>`,
          props: ["title", "message", "modelValue"],
          emits: ["update:ok", "update:cancel", "update:modelValue"],
        },
      },
    },
    attachTo: document.body,
    ...options,
  });
};

describe("CipherKeys", () => {
  const mockCipherKeysData = {
    data: {
      keys: [
        {
          name: "test-key-1",
          key: {
            store: { type: "env" },
            mechanism: { type: "aes" },
          },
        },
        {
          name: "test-key-2",
          key: {
            store: { type: "file" },
            mechanism: { type: "rsa" },
          },
        },
      ],
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockStore.state.theme = "light";
    mockRouter.currentRoute.value.query = {};
    mockCipherKeysService.list.mockResolvedValue(mockCipherKeysData);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("Component mounting", () => {
    it("should mount successfully", () => {
      const wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("should render cipher keys list title", () => {
      const wrapper = createWrapper();
      const title = wrapper.find('[data-test="cipher-keys-list-title"]');
      expect(title.exists()).toBe(true);
    });

    it("should fetch cipher keys data on mount", async () => {
      createWrapper();
      await nextTick();
      expect(mockCipherKeysService.list).toHaveBeenCalledWith("test-org");
    });
  });

  describe("Data loading", () => {
    it("should populate table data after successful fetch", async () => {
      const wrapper = createWrapper();
      await nextTick();
      await new Promise(resolve => setTimeout(resolve, 0));
      
      expect(wrapper.vm.tabledata).toHaveLength(2);
      expect(wrapper.vm.tabledata[0]).toEqual({
        "#": 1,
        name: "test-key-1",
        store_type: "env",
        mechanism_type: "aes",
      });
      expect(wrapper.vm.resultTotal).toBe(2);
    });

    it("should handle fetch error gracefully", async () => {
      mockCipherKeysService.list.mockRejectedValue({
        status: 500,
        response: { data: { message: "Server error" } },
      });

      createWrapper();
      await nextTick();
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(mockNotify).toHaveBeenCalledWith({
        type: "negative",
        message: "Server error",
        timeout: 5000,
      });
    });

    it("should not show error notification for 403 status", async () => {
      mockCipherKeysService.list.mockRejectedValue({
        status: 403,
        response: { data: { message: "Forbidden" } },
      });

      createWrapper();
      await nextTick();
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(mockNotify).not.toHaveBeenCalled();
    });
  });

  describe("Search functionality", () => {
    it("should filter table data based on search query", async () => {
      const wrapper = createWrapper();
      await nextTick();

      const searchInput = wrapper.find('input[data-test-stub="q-input"]');
      await searchInput.setValue("test-key-1");

      const filtered = wrapper.vm.filterData(wrapper.vm.tabledata, "test-key-1");
      expect(filtered).toHaveLength(1);
      expect(filtered[0].name).toBe("test-key-1");
    });

    it("should return empty results for non-matching search", async () => {
      const wrapper = createWrapper();
      await nextTick();

      const filtered = wrapper.vm.filterData(wrapper.vm.tabledata, "nonexistent");
      expect(filtered).toHaveLength(0);
    });

    it("should perform case-insensitive search", async () => {
      const wrapper = createWrapper();
      await nextTick();

      const filtered = wrapper.vm.filterData(wrapper.vm.tabledata, "TEST-KEY-1");
      expect(filtered).toHaveLength(1);
      expect(filtered[0].name).toBe("test-key-1");
    });
  });

  describe("Add cipher key functionality", () => {
    it("should show add cipher key dialog when add button is clicked", async () => {
      const wrapper = createWrapper();
      const addButton = wrapper.find('button:contains("Add")');
      
      await addButton.trigger("click");
      
      expect(mockRouter.push).toHaveBeenCalledWith({
        query: {
          action: "add",
          org_identifier: "test-org",
        },
      });
    });

    it("should show AddCipherKey component when showAddDialog is true", async () => {
      mockRouter.currentRoute.value.query = { action: "add" };
      const wrapper = createWrapper();
      await nextTick();

      expect(wrapper.vm.showAddDialog).toBe(true);
      const addComponent = wrapper.find('[data-test-stub="add-cipher-key"]');
      expect(addComponent.exists()).toBe(true);
    });

    it("should hide add dialog when cancel event is emitted", async () => {
      const wrapper = createWrapper();
      await wrapper.setData({ showAddDialog: true });
      
      const addComponent = wrapper.findComponent({ name: "AddCipherKey" });
      await addComponent.vm.$emit("cancel:hideform");
      await nextTick();

      expect(mockRouter.push).toHaveBeenCalledWith({
        name: "cipherKeys",
        query: {
          org_identifier: "test-org",
        },
      });
    });
  });

  describe("Edit cipher key functionality", () => {
    it("should navigate to edit route when edit button is clicked", async () => {
      const wrapper = createWrapper();
      await nextTick();
      
      const testRow = { name: "test-key-1" };
      await wrapper.vm.editCipherKey(testRow);

      expect(mockRouter.push).toHaveBeenCalledWith({
        query: {
          action: "edit",
          org_identifier: "test-org",
          name: "test-key-1",
        },
      });
    });

    it("should show AddCipherKey component in edit mode", async () => {
      mockRouter.currentRoute.value.query = { action: "edit", name: "test-key-1" };
      const wrapper = createWrapper();
      await nextTick();

      expect(wrapper.vm.showAddDialog).toBe(true);
      const addComponent = wrapper.find('[data-test-stub="add-cipher-key"]');
      expect(addComponent.exists()).toBe(true);
    });
  });

  describe("Delete cipher key functionality", () => {
    it("should show confirmation dialog when delete button is clicked", async () => {
      const wrapper = createWrapper();
      const testRow = { name: "test-key-1" };
      
      await wrapper.vm.confirmDeleteCipherKey(testRow);
      await nextTick();

      expect(wrapper.vm.confirmDelete.visible).toBe(true);
      expect(wrapper.vm.confirmDelete.data).toEqual(testRow);
    });

    it("should hide confirmation dialog when cancel is clicked", async () => {
      const wrapper = createWrapper();
      await wrapper.setData({
        confirmDelete: { visible: true, data: { name: "test-key-1" } }
      });
      
      await wrapper.vm.cancelDeleteCipherKey();
      
      expect(wrapper.vm.confirmDelete.visible).toBe(false);
      expect(wrapper.vm.confirmDelete.data).toBe(null);
    });

    it("should delete cipher key when confirmed", async () => {
      mockCipherKeysService.delete.mockResolvedValue({});
      const wrapper = createWrapper();
      
      await wrapper.setData({
        confirmDelete: { visible: true, data: { name: "test-key-1" } }
      });

      await wrapper.vm.deleteCipherKey();

      expect(mockCipherKeysService.delete).toHaveBeenCalledWith(
        "test-org",
        "test-key-1"
      );
      expect(mockNotify).toHaveBeenCalledWith({
        type: "positive",
        message: "Cipher Key deleted successfully",
        timeout: 2000,
      });
    });

    it("should handle delete error with 409 status", async () => {
      mockCipherKeysService.delete.mockRejectedValue({
        response: {
          data: { code: 409, message: "Key is in use" },
        },
      });

      const wrapper = createWrapper();
      await wrapper.setData({
        confirmDelete: { visible: true, data: { name: "test-key-1" } }
      });

      await wrapper.vm.deleteCipherKey();

      expect(mockNotify).toHaveBeenCalledWith({
        type: "negative",
        message: "Key is in use",
        timeout: 2000,
      });
    });

    it("should handle general delete error", async () => {
      mockCipherKeysService.delete.mockRejectedValue({
        status: 500,
        response: {
          data: { message: "Server error" },
        },
      });

      const wrapper = createWrapper();
      await wrapper.setData({
        confirmDelete: { visible: true, data: { name: "test-key-1" } }
      });

      await wrapper.vm.deleteCipherKey();

      expect(mockNotify).toHaveBeenCalledWith({
        type: "negative",
        message: "Server error",
        timeout: 2000,
      });
    });

    it("should not show delete error for 403 status", async () => {
      mockCipherKeysService.delete.mockRejectedValue({
        status: 403,
        response: {
          data: { message: "Forbidden" },
        },
      });

      const wrapper = createWrapper();
      await wrapper.setData({
        confirmDelete: { visible: true, data: { name: "test-key-1" } }
      });

      await wrapper.vm.deleteCipherKey();

      expect(mockNotify).toHaveBeenCalledTimes(1); // Only the loading notification
    });
  });

  describe("Pagination functionality", () => {
    it("should change pagination when perPage value changes", async () => {
      const wrapper = createWrapper();
      await nextTick();

      const mockQTable = {
        setPagination: vi.fn(),
      };
      wrapper.vm.qTable = mockQTable;

      await wrapper.vm.changePagination({ label: "50", value: 50 });

      expect(wrapper.vm.selectedPerPage).toBe(50);
      expect(wrapper.vm.pagination.rowsPerPage).toBe(50);
      expect(mockQTable.setPagination).toHaveBeenCalledWith(wrapper.vm.pagination);
    });

    it("should have correct perPage options", () => {
      const wrapper = createWrapper();
      
      expect(wrapper.vm.perPageOptions).toEqual([
        { label: "20", value: 20 },
        { label: "50", value: 50 },
        { label: "100", value: 100 },
        { label: "250", value: 250 },
        { label: "500", value: 500 },
      ]);
    });
  });

  describe("Table columns", () => {
    it("should have correct table columns configuration", () => {
      const wrapper = createWrapper();
      
      const expectedColumns = [
        {
          name: "#",
          label: "#",
          field: "#",
          align: "left",
          style: "width: 67px",
        },
        {
          name: "name",
          field: "name",
          label: expect.any(String), // t("cipherKey.name")
          align: "left",
          sortable: true,
        },
        {
          name: "store_type",
          field: "store_type",
          label: expect.any(String), // t("cipherKey.storeType")
          align: "left",
          sortable: true,
          style: "width: 150px",
        },
        {
          name: "mechanism_type",
          field: "mechanism_type",
          label: expect.any(String), // t("cipherKey.mechanismType")
          align: "left",
          sortable: true,
          style: "width: 150px",
        },
        {
          name: "actions",
          field: "actions",
          label: expect.any(String), // t("cipherKey.actions")
          align: "left",
          sortable: false,
          classes: "actions-column"
        },
      ];

      expect(wrapper.vm.columns).toHaveLength(5);
      expectedColumns.forEach((col, index) => {
        expect(wrapper.vm.columns[index]).toMatchObject(col);
      });
    });
  });

  describe("Theme support", () => {
    it("should apply light theme classes", () => {
      mockStore.state.theme = "light";
      const wrapper = createWrapper();
      
      const header = wrapper.find(".tw-flex.tw-justify-between.tw-items-center");
      expect(header.classes()).toContain("o2-table-header-light");
    });

    it("should apply dark theme classes", () => {
      mockStore.state.theme = "dark";
      const wrapper = createWrapper();
      
      const header = wrapper.find(".tw-flex.tw-justify-between.tw-items-center");
      expect(header.classes()).toContain("o2-table-header-dark");
    });
  });

  describe("Router query handling", () => {
    it("should show add dialog when query action is add", async () => {
      mockRouter.currentRoute.value.query = { action: "add" };
      const wrapper = createWrapper();
      await nextTick();

      expect(wrapper.vm.showAddDialog).toBe(true);
    });

    it("should show add dialog when query action is edit", async () => {
      mockRouter.currentRoute.value.query = { action: "edit" };
      const wrapper = createWrapper();
      await nextTick();

      expect(wrapper.vm.showAddDialog).toBe(true);
    });

    it("should not show add dialog for other query actions", async () => {
      mockRouter.currentRoute.value.query = { action: "view" };
      const wrapper = createWrapper();
      await nextTick();

      expect(wrapper.vm.showAddDialog).toBe(false);
    });
  });

  describe("Accessibility", () => {
    it("should have proper data-test attributes for interactive elements", () => {
      const wrapper = createWrapper();
      
      expect(wrapper.find('[data-test="cipher-keys-list-title"]').exists()).toBe(true);
    });

    it("should render action buttons with proper data-test attributes", async () => {
      const wrapper = createWrapper();
      await nextTick();
      
      // These would be rendered in the actual table slots
      const testRow = { name: "test-key-1" };
      const editTestAttr = `cipherkey-list-${testRow.name}-update`;
      const deleteTestAttr = `cipherkey-list-${testRow.name}-delete`;
      
      expect(editTestAttr).toBe("cipherkey-list-test-key-1-update");
      expect(deleteTestAttr).toBe("cipherkey-list-test-key-1-delete");
    });
  });

  describe("Edge cases", () => {
    it("should handle empty cipher keys list", async () => {
      mockCipherKeysService.list.mockResolvedValue({ data: { keys: [] } });
      
      const wrapper = createWrapper();
      await nextTick();
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(wrapper.vm.tabledata).toHaveLength(0);
      expect(wrapper.vm.resultTotal).toBe(0);
    });

    it("should handle deletion when no data is selected", async () => {
      const wrapper = createWrapper();
      await wrapper.setData({
        confirmDelete: { visible: true, data: null }
      });

      await wrapper.vm.deleteCipherKey();

      expect(mockCipherKeysService.delete).not.toHaveBeenCalled();
    });

    it("should handle data with missing properties gracefully", async () => {
      const incompleteData = {
        data: {
          keys: [
            {
              name: "incomplete-key",
              key: {
                store: { type: "env" },
                // missing mechanism
              },
            },
          ],
        },
      };
      
      mockCipherKeysService.list.mockResolvedValue(incompleteData);
      
      const wrapper = createWrapper();
      await nextTick();
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(wrapper.vm.tabledata).toHaveLength(1);
      expect(wrapper.vm.tabledata[0].mechanism_type).toBeUndefined();
    });
  });
});