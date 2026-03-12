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

import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import ChunkedContent from "./ChunkedContent.vue";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";

installQuasar();

const {
  mockInitializeChunk,
  mockGetVisibleContent,
  mockLoadNextChunk,
  mockHasMoreChunks,
  mockGetChunkInfo,
  mockNeedsChunking,
} = vi.hoisted(() => ({
  mockInitializeChunk: vi.fn(),
  mockGetVisibleContent: vi.fn(() => "visible content"),
  mockLoadNextChunk: vi.fn(),
  mockHasMoreChunks: vi.fn(() => false),
  mockGetChunkInfo: vi.fn(() => ({
    loadedSizeKB: 50,
    totalSizeKB: 200,
    currentChunk: 1,
    totalChunks: 4,
  })),
  mockNeedsChunking: vi.fn(() => false),
}));

vi.mock("@/composables/useChunkedContent", () => ({
  useChunkedContent: () => ({
    initializeChunk: mockInitializeChunk,
    getVisibleContent: mockGetVisibleContent,
    loadNextChunk: mockLoadNextChunk,
    hasMoreChunks: mockHasMoreChunks,
    getChunkInfo: mockGetChunkInfo,
    needsChunking: mockNeedsChunking,
  }),
}));

vi.mock("@/components/logs/LogsHighLighting.vue", () => ({
  default: {
    name: "LogsHighLighting",
    template: "<span class='logs-stub'>stub</span>",
    props: ["data", "showBraces", "queryString", "simpleMode"],
  },
}));

describe("ChunkedContent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasMoreChunks.mockReturnValue(false);
    mockNeedsChunking.mockReturnValue(false);
    mockGetVisibleContent.mockReturnValue("visible content");
    mockGetChunkInfo.mockReturnValue({
      loadedSizeKB: 50,
      totalSizeKB: 200,
      currentChunk: 1,
      totalChunks: 4,
    });
  });

  describe("Component Rendering", () => {
    it("should render the component", async () => {
      const wrapper = mount(ChunkedContent, {
        props: { data: "small content", fieldKey: "field1" },
      });

      expect(wrapper.exists()).toBe(true);
      await flushPromises();
    });

    it("should render the chunked-content container", async () => {
      const wrapper = mount(ChunkedContent, {
        props: { data: "test", fieldKey: "key1" },
      });

      await flushPromises();
      expect(wrapper.find(".chunked-content").exists()).toBe(true);
    });

    it("should render LogsHighLighting stub", async () => {
      const wrapper = mount(ChunkedContent, {
        props: { data: "test", fieldKey: "key1" },
      });

      await flushPromises();
      expect(wrapper.find(".logs-stub").exists()).toBe(true);
    });

    it("should not show load more button when shouldShowLoadMore is false", async () => {
      mockHasMoreChunks.mockReturnValue(false);

      const wrapper = mount(ChunkedContent, {
        props: { data: "short content", fieldKey: "key1" },
      });

      await flushPromises();
      expect(wrapper.find('[data-test="load-more-btn-key1"]').exists()).toBe(false);
    });

    it("should show load more button when hasMoreChunks returns true", async () => {
      mockHasMoreChunks.mockReturnValue(true);
      mockNeedsChunking.mockReturnValue(true);

      const wrapper = mount(ChunkedContent, {
        props: { data: "large content", fieldKey: "key1" },
      });

      await flushPromises();
      expect(wrapper.find('[data-test="load-more-btn-key1"]').exists()).toBe(true);
    });

    it("should show chunk info text when load more is visible", async () => {
      mockHasMoreChunks.mockReturnValue(true);
      mockNeedsChunking.mockReturnValue(true);

      const wrapper = mount(ChunkedContent, {
        props: { data: "large content", fieldKey: "key1" },
      });

      await flushPromises();
      expect(wrapper.text()).toContain("Showing chunk 1 of 4");
    });

    it("should display loaded size info in button label", async () => {
      mockHasMoreChunks.mockReturnValue(true);
      mockNeedsChunking.mockReturnValue(true);
      mockGetChunkInfo.mockReturnValue({
        loadedSizeKB: 100,
        totalSizeKB: 500,
        currentChunk: 2,
        totalChunks: 5,
      });

      const wrapper = mount(ChunkedContent, {
        props: { data: "large content", fieldKey: "myField" },
      });

      await flushPromises();
      expect(wrapper.text()).toContain("100KB / 500KB");
    });
  });

  describe("Props", () => {
    it("should have default props values", async () => {
      const wrapper = mount(ChunkedContent, {
        props: { data: "test", fieldKey: "field1" },
      });

      await flushPromises();
      expect(wrapper.props("queryString")).toBe("");
      expect(wrapper.props("simpleMode")).toBe(false);
      expect(wrapper.props("chunkSizeKB")).toBe(50);
    });

    it("should accept custom chunkSizeKB", async () => {
      const wrapper = mount(ChunkedContent, {
        props: { data: "test", fieldKey: "field1", chunkSizeKB: 100 },
      });

      await flushPromises();
      expect(wrapper.props("chunkSizeKB")).toBe(100);
    });

    it("should pass queryString prop to LogsHighLighting", async () => {
      const wrapper = mount(ChunkedContent, {
        props: { data: "test", fieldKey: "field1", queryString: "match_all('error')" },
      });

      await flushPromises();
      expect(wrapper.props("queryString")).toBe("match_all('error')");
    });

    it("should pass simpleMode prop", async () => {
      const wrapper = mount(ChunkedContent, {
        props: { data: "test", fieldKey: "field1", simpleMode: true },
      });

      await flushPromises();
      expect(wrapper.props("simpleMode")).toBe(true);
    });
  });

  describe("contentString computed", () => {
    it("should return empty string for null data", async () => {
      const wrapper = mount(ChunkedContent, {
        props: { data: null, fieldKey: "key1" },
      });

      await flushPromises();
      const vm = wrapper.vm as any;
      expect(vm.contentString).toBe("");
    });

    it("should return empty string for undefined data", async () => {
      const wrapper = mount(ChunkedContent, {
        props: { data: undefined, fieldKey: "key1" },
      });

      await flushPromises();
      const vm = wrapper.vm as any;
      expect(vm.contentString).toBe("");
    });

    it("should return string data as-is", async () => {
      const wrapper = mount(ChunkedContent, {
        props: { data: "hello world", fieldKey: "key1" },
      });

      await flushPromises();
      const vm = wrapper.vm as any;
      expect(vm.contentString).toBe("hello world");
    });

    it("should JSON.stringify object data", async () => {
      const obj = { name: "test", value: 42 };
      const wrapper = mount(ChunkedContent, {
        props: { data: obj, fieldKey: "key1" },
      });

      await flushPromises();
      const vm = wrapper.vm as any;
      expect(vm.contentString).toBe(JSON.stringify(obj));
    });

    it("should convert number to string", async () => {
      const wrapper = mount(ChunkedContent, {
        props: { data: 12345, fieldKey: "key1" },
      });

      await flushPromises();
      const vm = wrapper.vm as any;
      expect(vm.contentString).toBe("12345");
    });

    it("should convert boolean to string", async () => {
      const wrapper = mount(ChunkedContent, {
        props: { data: true, fieldKey: "key1" },
      });

      await flushPromises();
      const vm = wrapper.vm as any;
      expect(vm.contentString).toBe("true");
    });
  });

  describe("chunkSizeBytes computed", () => {
    it("should convert KB to bytes (default 50KB = 51200 bytes)", async () => {
      const wrapper = mount(ChunkedContent, {
        props: { data: "test", fieldKey: "key1" },
      });

      await flushPromises();
      const vm = wrapper.vm as any;
      expect(vm.chunkSizeBytes).toBe(50 * 1024);
    });

    it("should use custom chunkSizeKB", async () => {
      const wrapper = mount(ChunkedContent, {
        props: { data: "test", fieldKey: "key1", chunkSizeKB: 100 },
      });

      await flushPromises();
      const vm = wrapper.vm as any;
      expect(vm.chunkSizeBytes).toBe(100 * 1024);
    });
  });

  describe("Lifecycle - onMounted", () => {
    it("should call needsChunking on mount", async () => {
      mount(ChunkedContent, {
        props: { data: "test content", fieldKey: "key1" },
      });

      await flushPromises();
      expect(mockNeedsChunking).toHaveBeenCalled();
    });

    it("should call initializeChunk on mount when chunking is needed", async () => {
      mockNeedsChunking.mockReturnValue(true);
      const largeContent = "x".repeat(1000);

      mount(ChunkedContent, {
        props: { data: largeContent, fieldKey: "key1" },
      });

      await flushPromises();
      expect(mockInitializeChunk).toHaveBeenCalledWith("key1", largeContent, 50 * 1024);
    });

    it("should not call initializeChunk when chunking is not needed", async () => {
      mockNeedsChunking.mockReturnValue(false);

      mount(ChunkedContent, {
        props: { data: "short content", fieldKey: "key1" },
      });

      await flushPromises();
      expect(mockInitializeChunk).not.toHaveBeenCalled();
    });
  });

  describe("Watch - data changes", () => {
    it("should call initializeChunk when data prop changes and chunking is needed", async () => {
      mockNeedsChunking.mockReturnValue(false);
      const wrapper = mount(ChunkedContent, {
        props: { data: "initial", fieldKey: "key1" },
      });

      await flushPromises();
      mockNeedsChunking.mockReturnValue(true);

      const largeData = "y".repeat(2000);
      await wrapper.setProps({ data: largeData });
      await flushPromises();

      expect(mockInitializeChunk).toHaveBeenCalledWith("key1", largeData, 50 * 1024);
    });
  });

  describe("handleLoadMore", () => {
    it("should call loadNextChunk with fieldKey when load more button is clicked", async () => {
      mockHasMoreChunks.mockReturnValue(true);
      mockNeedsChunking.mockReturnValue(true);

      const wrapper = mount(ChunkedContent, {
        props: { data: "large content", fieldKey: "myField" },
      });

      await flushPromises();

      const loadMoreBtn = wrapper.find('[data-test="load-more-btn-myField"]');
      await loadMoreBtn.trigger("click");

      expect(mockLoadNextChunk).toHaveBeenCalledWith("myField");
    });
  });

  describe("visibleContent computed", () => {
    it("should return original data when chunking is not needed", async () => {
      mockNeedsChunking.mockReturnValue(false);
      const data = "short string";

      const wrapper = mount(ChunkedContent, {
        props: { data, fieldKey: "key1" },
      });

      await flushPromises();
      const vm = wrapper.vm as any;
      expect(vm.visibleContent).toBe(data);
    });

    it("should return getVisibleContent result when chunking is needed", async () => {
      mockNeedsChunking.mockReturnValue(true);
      mockGetVisibleContent.mockReturnValue("first chunk of content...");

      const wrapper = mount(ChunkedContent, {
        props: { data: "very long content", fieldKey: "key1" },
      });

      await flushPromises();
      const vm = wrapper.vm as any;
      expect(vm.visibleContent).toBe("first chunk of content...");
    });
  });

  describe("shouldShowLoadMore computed", () => {
    it("should return true when hasMoreChunks returns true", async () => {
      mockHasMoreChunks.mockReturnValue(true);

      const wrapper = mount(ChunkedContent, {
        props: { data: "content", fieldKey: "key1" },
      });

      await flushPromises();
      const vm = wrapper.vm as any;
      expect(vm.shouldShowLoadMore).toBe(true);
    });

    it("should return false when hasMoreChunks returns false", async () => {
      mockHasMoreChunks.mockReturnValue(false);

      const wrapper = mount(ChunkedContent, {
        props: { data: "content", fieldKey: "key1" },
      });

      await flushPromises();
      const vm = wrapper.vm as any;
      expect(vm.shouldShowLoadMore).toBe(false);
    });
  });

  describe("chunkInfo computed", () => {
    it("should return chunk info from getChunkInfo", async () => {
      const mockInfo = {
        loadedSizeKB: 75,
        totalSizeKB: 300,
        currentChunk: 2,
        totalChunks: 6,
      };
      mockGetChunkInfo.mockReturnValue(mockInfo);

      const wrapper = mount(ChunkedContent, {
        props: { data: "content", fieldKey: "key1" },
      });

      await flushPromises();
      const vm = wrapper.vm as any;
      expect(vm.chunkInfo).toEqual(mockInfo);
    });

    it("should call getChunkInfo with the fieldKey", async () => {
      const wrapper = mount(ChunkedContent, {
        props: { data: "content", fieldKey: "special-field-key" },
      });

      await flushPromises();
      // Access the computed to trigger getChunkInfo call
      // (chunkInfo is lazy – it only runs when accessed)
      const vm = wrapper.vm as any;
      const _info = vm.chunkInfo;
      expect(mockGetChunkInfo).toHaveBeenCalledWith("special-field-key");
    });
  });
});
