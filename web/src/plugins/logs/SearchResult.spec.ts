// Copyright 2023 OpenObserve Inc.
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

import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { Dialog, Notify } from "quasar";
import SearchResult from "@/plugins/logs/SearchResult.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import DetailTable from "@/plugins/logs/DetailTable.vue";

const node = document.createElement("div");
node.setAttribute("id", "app");
document.body.appendChild(node);

installQuasar({
  plugins: [Dialog, Notify],
});

describe("SearchResult Component", () => {
  let wrapper: any;

  beforeEach(async () => {
    // Mock store state
    store.state.zoConfig = {
      sql_mode: false,
      sql_mode_manual_trigger: false,
      version: '1.0.0',
      commit_hash: 'abc123',
      build_date: '2024-01-01',
      default_fts_keys: [],
      show_stream_stats_doc_num: true,
      data_retention_days: true,
      extended_data_retention_days: 30,
      user_defined_schemas_enabled: true,
      super_cluster_enabled: true,
      query_on_stream_selection: false,
      default_functions: []
    };

    wrapper = mount(SearchResult, {
      attachTo: document.body,
      global: {
        provide: { store },
        plugins: [i18n, router],
        stubs: {
          DetailTable: true,
          ChartRenderer: true,
          SanitizedHtmlRenderer: true,
          TenstackTable: true
        }
      },
      props: {
        expandedLogs: []
      }
    });

    await flushPromises();
  });

  afterEach(() => {
    wrapper.unmount();
    vi.clearAllMocks();
  });

  describe('Component Rendering', () => {
    it('should render the component', () => {
      expect(wrapper.exists()).toBe(true);
    });

    it('should render pagination when showPagination is true', async () => {
      wrapper.vm.searchObj.meta.resultGrid.showPagination = true;
      await wrapper.vm.$nextTick();
      expect(wrapper.find('[data-test="logs-search-result-pagination"]').exists()).toBe(true);
    });

    it('should render records per page selector when showPagination is true', async () => {
      wrapper.vm.searchObj.meta.resultGrid.showPagination = true;
      await wrapper.vm.$nextTick();
      expect(wrapper.find('[data-test="logs-search-result-records-per-page"]').exists()).toBe(true);
    });

    it('should show histogram loader when loading', async () => {
      wrapper.vm.searchObj.meta.showHistogram = true;
      wrapper.vm.searchObj.loadingHistogram = true;
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.histogramLoader).toBe(true);
    });

    it('should show no data message when histogram is empty', async () => {
      wrapper.vm.searchObj.meta.showHistogram = true;
      wrapper.vm.searchObj.loadingHistogram = false;
      wrapper.vm.searchObj.loading = false;
      wrapper.vm.plotChart = {};
      await wrapper.vm.$nextTick();
      expect(wrapper.find('h3').text()).toContain('No data found for histogram');
    });
  });

  describe('Pagination Navigation', () => {
    beforeEach(async () => {
      wrapper.vm.searchObj.meta.resultGrid.showPagination = true;
      wrapper.vm.searchObj.meta.resultGrid.rowsPerPage = 10;
      wrapper.vm.searchObj.data.resultGrid.currentPage = 2;
      await wrapper.vm.$nextTick();
    });

    it('should navigate to previous page', async () => {
      await wrapper.vm.getPageData('prev');
      expect(wrapper.vm.searchObj.data.resultGrid.currentPage).toBe(1);
      expect(wrapper.emitted()['update:scroll']).toBeTruthy();
    });

    it('should navigate to next page', async () => {
      wrapper.vm.searchObj.data.queryResults = { total: 30 };
      await wrapper.vm.getPageData('next');
      expect(wrapper.vm.searchObj.data.resultGrid.currentPage).toBe(3);
      expect(wrapper.emitted()['update:scroll']).toBeTruthy();
    });

    it('should handle invalid page number input', async () => {
      const notifySpy = vi.spyOn(wrapper.vm.$q, 'notify');
      wrapper.vm.searchObj.communicationMethod = 'http';
      wrapper.vm.searchObj.data.queryResults = {
        partitionDetail: { paginations: { length: 5 } }
      };
      wrapper.vm.pageNumberInput = 10;
      
      await wrapper.vm.getPageData('pageChange');
      
      expect(notifySpy).toHaveBeenCalledWith(expect.objectContaining({
        type: 'negative',
        message: expect.stringContaining('Page number is out of range')
      }));
    });
  });

  describe('Table Functionality', () => {

    it('should calculate table width correctly', () => {
      window.innerWidth = 1000;
      wrapper.vm.searchObj.config.splitterModel = 30;
      
      const width = wrapper.vm.getTableWidth;
      expect(width).toBe(1000 - 56 - (1000 - 56) * 0.3 - 5);
    });

    it('should scroll table to top', async () => {
      const scrollToSpy = vi.fn();
      wrapper.vm.searchTableRef = {
        parentRef: {
          scrollTo: scrollToSpy
        }
      };
      
      await wrapper.vm.scrollTableToTop(0);
      expect(scrollToSpy).toHaveBeenCalledWith({ top: 0 });
    });
  });

  describe('Computed Properties', () => {
    it('should compute toggleWrapFlag', () => {
      wrapper.vm.searchObj.meta.toggleSourceWrap = true;
      expect(wrapper.vm.toggleWrapFlag).toBe(true);
    });

    it('should compute findFTSFields', () => {
      const fields = [{ name: 'field1' }];
      wrapper.vm.searchObj.data.stream.selectedStreamFields = fields;
      expect(wrapper.vm.findFTSFields).toEqual(fields);
    });

    it('should compute updateTitle', () => {
      const title = 'Test Title';
      wrapper.vm.searchObj.data.histogram.chartParams.title = title;
      expect(wrapper.vm.updateTitle).toBe(title);
    });

    it('should compute resetPlotChart', () => {
      wrapper.vm.searchObj.meta.resetPlotChart = true;
      expect(wrapper.vm.resetPlotChart).toBe(true);
    });
  });

  describe('Watch Handlers', () => {

    it('should handle findFTSFields changes', async () => {
      const extractFTSFieldsSpy = vi.spyOn(wrapper.vm, 'extractFTSFields');
      wrapper.vm.searchObj.data.stream.selectedStreamFields = [{ name: 'field1' }];
      await wrapper.vm.$nextTick();
      expect(extractFTSFieldsSpy).toHaveBeenCalled();
    });

    it('should handle updateTitle changes', async () => {
      const title = 'New Title';
      wrapper.vm.searchObj.data.histogram.chartParams.title = title;
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.noOfRecordsTitle).toBe(title);
    });

    it('should handle resetPlotChart changes', async () => {
      wrapper.vm.searchObj.meta.resetPlotChart = true;
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.plotChart).toEqual({});
      expect(wrapper.vm.searchObj.meta.resetPlotChart).toBe(false);
    });
  });

  describe('Additional Error Handling', () => {

    it('should handle function error', async () => {
      wrapper.vm.searchObj.data.functionError = 'Function error';
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.searchObj.data.functionError).toBe('Function error');
    });
  });
});
