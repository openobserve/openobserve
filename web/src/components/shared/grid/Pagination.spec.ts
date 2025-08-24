import { mount } from "@vue/test-utils";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import Pagination from "@/components/shared/grid/Pagination.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import { createRouter, createWebHistory } from "vue-router";

installQuasar();

vi.mock("@/utils/zincutils", () => ({
  getImageURL: vi.fn((path) => `/mocked/${path}`)
}));

const mockRouter = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", component: { template: "<div>Home</div>" } },
    { path: "/logs", name: "logs", component: { template: "<div>Logs</div>" } }
  ]
});

describe("Pagination", () => {
  let wrapper: any = null;

  const mockScope = {
    pagination: { page: 1, rowsPerPage: 10 },
    pagesNumber: 5,
    isFirstPage: false,
    isLastPage: false,
    firstRowIndex: 1,
    lastRowIndex: 10,
    computedRowsNumber: 50,
    prevPage: vi.fn(),
    nextPage: vi.fn(),
  };

  beforeEach(() => {
    store.state.searchCollapsibleSection = 20;
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  const createWrapper = (props = {}) => {
    return mount(Pagination, {
      props: {
        scope: mockScope,
        position: "bottom",
        maxRecordToReturn: 1000,
        perPageOptions: [10, 20, 50, 100],
        ...props
      },
      global: {
        plugins: [i18n, mockRouter],
        provide: {
          store,
        },
        stubs: {
          'q-input': {
            template: '<input @blur="$emit(\'blur\', $event)" />',
          },
          'q-select': {
            template: '<select @update:modelValue="$emit(\'update:modelValue\', $event)"><option value="10">10</option><option value="20">20</option></select>',
          },
          'q-btn': {
            template: '<button @click="$emit(\'click\')"><slot /></button>'
          },
          'q-btn-group': {
            template: '<div class="q-btn-group"><slot /></div>'
          },
          'q-separator': {
            template: '<div class="q-separator"></div>'
          }
        }
      },
    });
  };

  it("should mount Pagination component", () => {
    wrapper = createWrapper();
    expect(wrapper).toBeTruthy();
  });

  it("should have correct props", () => {
    wrapper = createWrapper({ maxRecordToReturn: 2000 });
    expect(wrapper.props('scope')).toBeDefined();
    expect(wrapper.props('maxRecordToReturn')).toBe(2000);
    expect(wrapper.props('position')).toBe("bottom");
  });

  it("should render without errors", () => {
    wrapper = createWrapper();
    expect(wrapper.exists()).toBe(true);
  });

  it("should expose necessary functions from setup", () => {
    wrapper = createWrapper();
    expect(typeof wrapper.vm.t).toBe("function");
    expect(wrapper.vm.store).toBeDefined();
    expect(wrapper.vm.router).toBeDefined();
    expect(typeof wrapper.vm.toggleSidePanel).toBe("function");
    expect(typeof wrapper.vm.changePagination).toBe("function");
    expect(typeof wrapper.vm.changeMaxRecordToReturn).toBe("function");
    expect(wrapper.vm.getImageURL).toBeDefined();
  });
});