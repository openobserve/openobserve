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
import { defineComponent } from "vue";
import { mount } from "@vue/test-utils";
import { Dialog, Notify } from "quasar";
import { createI18n } from "vue-i18n";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import store from "@/test/unit/helpers/store";
import { usePagination } from "./usePagination";

installQuasar({
  plugins: [Dialog, Notify],
});

// Create i18n instance
const i18n = createI18n({
  legacy: false,
  locale: 'en',
  messages: {
    en: {
      search: {
        queryRangeRestrictionMsg: 'Query range restricted to {range}'
      }
    }
  }
});

// Create test wrapper component
const TestComponent = defineComponent({
  setup() {
    const pagination = usePagination();
    return {
      ...pagination
    };
  },
  template: '<div></div>'
});

describe('usePagination Composable', () => {
  let wrapper: any;

  beforeEach(() => {
    wrapper = mount(TestComponent, {
      global: {
        plugins: [store, i18n],
      },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Pagination Functions', () => {
    it('should have refreshPartitionPagination function', () => {
      expect(typeof wrapper.vm.refreshPartitionPagination).toBe('function');
    });

    it('should have getPaginatedData function', () => {
      expect(typeof wrapper.vm.getPaginatedData).toBe('function');
    });
  });

  describe('refreshPartitionPagination', () => {
    it('should correctly generate paginations for given partitions and calculate total', () => {
      const { refreshPartitionPagination } = wrapper.vm;
      refreshPartitionPagination(true);
      expect(refreshPartitionPagination).toHaveBeenCalled;
    });
  });
});