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

import { mount } from "@vue/test-utils";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import store from "@/test/unit/helpers/store";
import QueryList from "@/components/queries/QueryList.vue";
import { timestampToTimezoneDate, durationFormatter } from "@/utils/zincutils";
import { getUnitValue } from "@/utils/dashboard/convertDataIntoUnitValue";
import { createI18n } from "vue-i18n";

installQuasar();

const i18n = createI18n({
  locale: "en-us",
  allowComposition: true,
  messages: {
    "en-us": {
      queries: {
        queryList: "Query List"
      }
    }
  }
});

// Mock utility functions
vi.mock("@/utils/zincutils", () => ({
  timestampToTimezoneDate: vi.fn(),
  durationFormatter: vi.fn(),
}));

vi.mock("@/utils/dashboard/convertDataIntoUnitValue", () => ({
  getUnitValue: vi.fn(),
}));

describe("QueryList", () => {
  let wrapper: any = null;
  
  const mockQueryData = [
    {
      trace_id: "test-trace-123",
      status: "success",
      user_id: "user-123",
      org_id: "org-123",
      stream_type: "logs",
      sql: "SELECT * FROM logs",
      start_time: 1640995200000000, // Jan 1, 2022 in microseconds
      end_time: 1640995260000000,   // Jan 1, 2022 + 1 minute in microseconds
      created_at: 1640995100000000,  // Jan 1, 2022 - 100 seconds in microseconds
      records: 1000,
      files: 5,
      original_size: 1048576, // 1MB in bytes
      compressed_size: 524288, // 512KB in bytes
      search_type: "dashboards",
      query_source: "MyDashboard"
    },
    {
      trace_id: "test-trace-456",
      status: "error",
      user_id: "user-456",
      org_id: "org-456",
      stream_type: "traces",
      sql: "SELECT count(*) FROM traces",
      start_time: 1640995300000000,
      end_time: 1640995400000000,
      created_at: 1640995250000000,
      records: 500,
      files: 2,
      original_size: undefined,
      compressed_size: undefined,
      search_type: "alerts",
      query_source: "MyAlert"
    }
  ];

  const mockProps = {
    schemaData: {},
    metaData: {
      queries: mockQueryData
    }
  };

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Setup mock returns
    (timestampToTimezoneDate as any).mockReturnValue("2022-01-01 00:00:00");
    (durationFormatter as any).mockReturnValue("5 minutes");
    (getUnitValue as any).mockReturnValue({ value: "1.0", unit: "MB" });
    
    wrapper = mount(QueryList, {
      props: mockProps,
      global: {
        plugins: [store, i18n]
      }
    });
  });

  afterEach(() => {
    wrapper.unmount();
  });

  it("should mount QueryList component", () => {
    expect(wrapper).toBeTruthy();
    expect(wrapper.vm).toBeTruthy();
  });

  it("should have correct component name", () => {
    expect(wrapper.vm.$options.name).toBe("QueryList");
  });

  it("should initialize queryData from props metaData", () => {
    expect(wrapper.vm.queryData).toEqual(mockQueryData);
  });

  it("should initialize queryData as empty array when metaData is undefined", () => {
    const wrapperNoData = mount(QueryList, {
      props: { schemaData: {} },
      global: {
        plugins: [store, i18n]
      }
    });
    expect(wrapperNoData.vm.queryData).toEqual([]);
    wrapperNoData.unmount();
  });

  it("should initialize pagination with rowsPerPage 0", () => {
    expect(wrapper.vm.pagination.rowsPerPage).toBe(0);
  });

  it("should expose t function for translations", () => {
    expect(typeof wrapper.vm.t).toBe("function");
  });

  it("should expose getRows function", () => {
    expect(typeof wrapper.vm.getRows).toBe("function");
  });



  describe("getRows function", () => {
    beforeEach(() => {
      (timestampToTimezoneDate as any).mockReturnValue("2022-01-01 12:00:00");
      (durationFormatter as any).mockReturnValueOnce("10 minutes").mockReturnValueOnce("1 minute");
      (getUnitValue as any)
        .mockReturnValueOnce({ value: "1.0", unit: "MB" })
        .mockReturnValueOnce({ value: "512", unit: "KB" });
    });

    it("should format query data correctly into rows", () => {
      const query = mockQueryData[0];
      const rows = wrapper.vm.getRows(query);

      expect(rows).toHaveLength(16);
      expect(rows[0]).toEqual(["Trace ID", "test-trace-123"]);
      expect(rows[1]).toEqual(["Status", "success"]);
      expect(rows[2]).toEqual(["User ID", "user-123"]);
      expect(rows[3]).toEqual(["Org ID", "org-123"]);
      expect(rows[4]).toEqual(["Stream Type", "logs"]);
      expect(rows[5]).toEqual(["Search Type", "dashboards"]);
      expect(rows[6]).toEqual(["Query Source", "MyDashboard"]);
      expect(rows[7]).toEqual(["SQL", "SELECT * FROM logs"]);
    });

    it("should format start time correctly", () => {
      const query = mockQueryData[0];
      wrapper.vm.getRows(query);

      expect(timestampToTimezoneDate).toHaveBeenCalledWith(
        1640995200000, // microseconds divided by 1000 = milliseconds
        store.state.timezone,
        "yyyy-MM-dd HH:mm:ss"
      );
    });

    it("should format end time correctly", () => {
      const query = mockQueryData[0];
      wrapper.vm.getRows(query);

      expect(timestampToTimezoneDate).toHaveBeenCalledWith(
        1640995260000, // microseconds divided by 1000 = milliseconds
        store.state.timezone,
        "yyyy-MM-dd HH:mm:ss"
      );
    });

    it("should include timezone in time entries", () => {
      const query = mockQueryData[0];
      const rows = wrapper.vm.getRows(query);

      expect(rows[8][1]).toContain("UTC");
      expect(rows[8][1]).toContain("1640995200000000");
      expect(rows[9][1]).toContain("UTC");
      expect(rows[9][1]).toContain("1640995260000000");
    });

    it("should calculate execution duration", () => {
      const query = mockQueryData[0];
      const rows = wrapper.vm.getRows(query);

      expect(rows[10]).toEqual(["Exec. Duration", "10 minutes"]);
    });

    it("should calculate query range", () => {
      const query = mockQueryData[0];
      const rows = wrapper.vm.getRows(query);

      expect(rows[11]).toEqual(["Query Range", "1 minute"]);
    });

    it("should include scan records", () => {
      const query = mockQueryData[0];
      const rows = wrapper.vm.getRows(query);

      expect(rows[12]).toEqual(["Scan Records", 1000]);
    });

    it("should include files count", () => {
      const query = mockQueryData[0];
      const rows = wrapper.vm.getRows(query);

      expect(rows[13]).toEqual(["Files", 5]);
    });

    it("should format original size with unit value", () => {
      const query = mockQueryData[0];
      const rows = wrapper.vm.getRows(query);

      expect(getUnitValue).toHaveBeenCalledWith(1048576, "megabytes", "", 2);
      expect(rows[14]).toEqual(["Original Size", "1.0 MB"]);
    });

    it("should format compressed size with unit value", () => {
      const query = mockQueryData[0];
      const rows = wrapper.vm.getRows(query);

      expect(getUnitValue).toHaveBeenCalledWith(524288, "megabytes", "", 2);
      expect(rows[15]).toEqual(["Compressed Size", "512 KB"]);
    });

    it("should handle undefined original_size", () => {
      (getUnitValue as any).mockReturnValue({ value: "", unit: "" });
      const query = mockQueryData[1]; // has undefined original_size
      const rows = wrapper.vm.getRows(query);

      expect(rows[14]).toEqual(["Original Size", ""]);
    });

    it("should handle undefined compressed_size", () => {
      (getUnitValue as any).mockReturnValue({ value: "", unit: "" });
      const query = mockQueryData[1]; // has undefined compressed_size
      const rows = wrapper.vm.getRows(query);

      expect(rows[15]).toEqual(["Compressed Size", ""]);
    });

    it("should handle size formatting logic correctly", () => {
      // Test that the component properly formats sizes when getUnitValue provides values
      const query = mockQueryData[0];
      const rows = wrapper.vm.getRows(query);
      
      // Check that the Original Size row exists and has content
      expect(rows[14][0]).toBe("Original Size");
      expect(typeof rows[14][1]).toBe("string");
      
      // Check that the Compressed Size row exists and has content  
      expect(rows[15][0]).toBe("Compressed Size");
      expect(typeof rows[15][1]).toBe("string");
    });

    it("should properly structure all row data", () => {
      const query = mockQueryData[0];
      const rows = wrapper.vm.getRows(query);
      
      // Verify all rows have the expected structure [label, value]
      rows.forEach(row => {
        expect(Array.isArray(row)).toBe(true);
        expect(row.length).toBe(2);
        expect(typeof row[0]).toBe("string"); // Label should be string
      });
    });
  });

  it("should handle empty query object", () => {
    const emptyQuery = {};
    const rows = wrapper.vm.getRows(emptyQuery);

    expect(rows).toHaveLength(16);
    expect(rows[0]).toEqual(["Trace ID", undefined]);
    expect(rows[1]).toEqual(["Status", undefined]);
  });

  it("should handle null query object", () => {
    const rows = wrapper.vm.getRows(null);

    expect(rows).toHaveLength(16);
    expect(rows[0]).toEqual(["Trace ID", undefined]);
  });

  it("should use store timezone for formatting", () => {
    const query = mockQueryData[0];
    wrapper.vm.getRows(query);

    expect(timestampToTimezoneDate).toHaveBeenCalledWith(
      expect.any(Number),
      store.state.timezone,
      "yyyy-MM-dd HH:mm:ss"
    );
  });

  it("should call getUnitValue with correct parameters for original size", () => {
    const query = mockQueryData[0];
    wrapper.vm.getRows(query);

    expect(getUnitValue).toHaveBeenCalledWith(
      query.original_size,
      "megabytes",
      "",
      2
    );
  });

  it("should call getUnitValue with correct parameters for compressed size", () => {
    const query = mockQueryData[0];
    wrapper.vm.getRows(query);

    expect(getUnitValue).toHaveBeenCalledWith(
      query.compressed_size,
      "megabytes",
      "",
      2
    );
  });
});