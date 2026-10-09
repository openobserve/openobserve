// Copyright 2026 OpenObserve Inc.
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

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import searchService from "@/services/search";
import shortURLService from "@/services/short_url";
import { toast } from "@/lib/feedback/Toast/useToast";
import { searchState } from "@/composables/useLogs/searchState";
import { readLogsSignature, resetLogsAutoRunForTests } from "@/composables/useLogs/logsAutoRun";
import {
  lineLinkPopover,
  resetLineLinkForTests,
  useLogLineLink,
} from "@/composables/useLogs/useLogLineLink";
import { decodeColumns, resetLogsUrlForTests } from "@/composables/useLogs/useLogsUrl";
import { fingerprintRecord, parsePermalinkQuery } from "@/utils/logs/logPermalink";

vi.mock("vue-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("vue-router")>()),
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    currentRoute: { value: { name: "logs", query: {}, path: "/logs" } },
  }),
}));
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: vi.fn() }));

const TS = 1_700_000_000_000_777;
const row = { _timestamp: TS, level: "error", message: "payment declined" };

let api: ReturnType<typeof useLogLineLink>;
const Host = defineComponent({
  setup() {
    api = useLogLineLink();
    return () => h("div");
  },
});

const clipboard = { write: vi.fn(), writeText: vi.fn() };
class FakeClipboardItem {
  constructor(public items: Record<string, Promise<Blob>>) {}
}

const writtenUrl = async () => {
  const item = clipboard.write.mock.calls[0][0][0] as FakeClipboardItem;
  const blob = await item.items["text/plain"];
  return new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.readAsText(blob);
  });
};

const linkOf = (url: string) =>
  Object.fromEntries(new URL(url).searchParams.entries()) as Record<string, string>;

describe("useLogLineLink (4c C3, C4, C6)", () => {
  const { searchObj } = searchState();
  let wrapper: any;

  const markRun = () => {
    searchObj.meta.executed = {
      generation: 1,
      signature: readLogsSignature(searchObj),
      req: { query: { sql: 'select * from "app"', from: 0, size: 50 } },
      complete: true,
    } as any;
  };

  beforeEach(() => {
    resetLogsAutoRunForTests(store as any);
    resetLineLinkForTests();
    resetLogsUrlForTests();
    store.state.zoConfig = { ...store.state.zoConfig, timestamp_column: "_timestamp", web_url: "" };
    searchObj.meta.logsVisualizeToggle = "logs";
    searchObj.meta.sqlMode = false;
    searchObj.meta.showTransformEditor = false;
    searchObj.meta.editorDirty = false;
    searchObj.meta.pendingExecution = null;
    searchObj.data.tempFunctionContent = "";
    searchObj.data.query = "";
    searchObj.data.stream.streamType = "logs";
    searchObj.data.stream.selectedStream = ["app"];
    searchObj.data.stream.selectedStreamFields = [{ name: "message", streams: ["app"] }];
    searchObj.data.streamResults = { list: [{ name: "app", schema: [{}, {}, {}] }] } as any;
    searchObj.data.datetime = { type: "absolute", startTime: TS - 10, endTime: TS + 10 } as any;
    clipboard.write.mockReset().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...globalThis.navigator, clipboard });
    vi.stubGlobal("ClipboardItem", FakeClipboardItem);
    vi.spyOn(searchService, "search").mockResolvedValue({
      status: 200,
      data: { hits: [row, { ...row, message: "other" }], is_partial: false },
    } as any);
    vi.spyOn(shortURLService, "create").mockResolvedValue({
      status: 200,
      data: { short_url: "https://o2.example/short/abc" },
    } as any);
    wrapper = mount(Host, { global: { provide: { store }, plugins: [i18n] } });
    markRun();
  });

  afterEach(() => {
    wrapper?.unmount();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.mocked(toast).mockClear();
  });

  describe("lineLinkState", () => {
    it("is hidden in Visualize and Patterns", () => {
      searchObj.meta.logsVisualizeToggle = "visualize";
      expect(api.lineLinkState(row)).toEqual({ kind: "hidden" });
      searchObj.meta.logsVisualizeToggle = "patterns";
      expect(api.lineLinkState(row)).toEqual({ kind: "hidden" });
    });

    it("G1 comes first: never run or stale results disable it with the run-first reason", () => {
      searchObj.meta.executed = null;
      expect(api.lineLinkState(row)).toEqual({
        kind: "disabled",
        reason: "Run the query first: this action saves or shares what you ran",
      });
      markRun();
      searchObj.data.stream.selectedStream = ["web"];
      expect(api.lineLinkState(row).kind).toBe("disabled");
    });

    it("an active function disables it with the function reason (J-C7)", () => {
      searchObj.meta.showTransformEditor = true;
      searchObj.data.tempFunctionContent = ".a = 1";
      markRun();
      (searchObj.meta.executed as any).req.query.query_fn = "LmEgPSAx";
      expect(api.lineLinkState(row)).toEqual({
        kind: "disabled",
        reason: "Turn off the function to link a single line",
      });
    });

    it("SQL aliasing onto the timestamp disables it with the timestamp reason (J-C7)", () => {
      searchObj.meta.sqlMode = true;
      searchObj.data.query = "SELECT _timestamp + 1 AS _timestamp, message FROM app";
      markRun();
      expect(api.lineLinkState(row)).toEqual({
        kind: "disabled",
        reason: "This query rewrites the timestamp",
      });
    });

    it("is enabled for a plain row of a run query", () => {
      expect(api.lineLinkState(row)).toEqual({ kind: "enabled" });
    });
  });

  describe("copyLineLink", () => {
    it("resolves the line, writes an exact link in the click's own gesture, and confirms (J-C1)", async () => {
      store.state.zoConfig.web_url = "https://o2.example";
      const done = api.copyLineLink(row, "menu");
      expect(clipboard.write).toHaveBeenCalledTimes(1);
      await done;
      const [options, searchType, , useCache] = vi.mocked(searchService.search).mock
        .calls[0] as any[];
      expect(searchType).toBe("other");
      expect(useCache).toBe(false);
      expect(options.query.query).toMatchObject({ start_time: TS, end_time: TS + 1, size: 5000 });
      const longUrl = vi.mocked(shortURLService.create).mock.calls[0][1];
      const query = linkOf(longUrl);
      expect(query.log_stream).toBe("app");
      expect(query.log_ts).toBe(String(TS));
      expect(query.log_fp).toBe(fingerprintRecord(row));
      expect(query.refresh).toBe("0");
      expect(query.page).toBeUndefined();
      expect(parsePermalinkQuery(query).kind).toBe("valid");
      expect(await writtenUrl()).toBe("https://o2.example/short/abc");
      expect(toast).toHaveBeenCalledWith({
        variant: "success",
        message: "Link to log line copied",
      });
    });

    it("keeps the sharer's exact window, widened only to hold the line (C3)", async () => {
      searchObj.data.datetime = { type: "absolute", startTime: TS - 5, endTime: TS + 1 } as any;
      markRun();
      await api.copyLineLink(row, "drawer");
      const query = linkOf(await writtenUrl());
      expect([Number(query.from), Number(query.to)]).toEqual([TS - 5, TS + 1]);
    });

    it("a row without _o2_id links by fingerprint and the URL names no log_id (no 'undefined')", async () => {
      await api.copyLineLink(row, "drawer");
      const url = await writtenUrl();
      expect(url).not.toContain("undefined");
      expect(Object.keys(linkOf(url)).filter((key) => key.startsWith("log_"))).toEqual([
        "log_stream",
        "log_ts",
        "log_fp",
      ]);
    });

    it("copies the long URL when web_url is not set (no shortening)", async () => {
      await api.copyLineLink(row, "drawer");
      expect(shortURLService.create).not.toHaveBeenCalled();
      expect(linkOf(await writtenUrl()).log_fp).toBe(fingerprintRecord(row));
    });

    it("an _o2_id row links by id", async () => {
      const withId = { ...row, _o2_id: "7311" };
      vi.mocked(searchService.search).mockResolvedValue({
        status: 200,
        data: { hits: [withId], is_partial: false },
      } as any);
      await api.copyLineLink(withId, "drawer");
      const sql = (vi.mocked(searchService.search).mock.calls[0][0] as any).query.query.sql;
      expect(sql).toBe("SELECT * FROM app WHERE _o2_id = '7311'");
      expect(linkOf(await writtenUrl()).log_id).toBe("7311");
    });

    it("two identical-identity candidates give a timestamp link and say so (AC-C1.1)", async () => {
      vi.mocked(searchService.search).mockResolvedValue({
        status: 200,
        data: { hits: [row, { ...row, extra: "x" }], is_partial: false },
      } as any);
      await api.copyLineLink(row, "drawer");
      const query = linkOf(await writtenUrl());
      expect(query.log_fp).toBeUndefined();
      expect(query.log_ts).toBe(String(TS));
      expect(toast).toHaveBeenCalledWith({
        variant: "warning",
        message: "Copied a link to the timestamp; this line could not be uniquely identified.",
      });
    });

    it("a wide stream without _o2_id skips the resolve and copies a timestamp link (J-C23)", async () => {
      searchObj.data.streamResults = {
        list: [{ name: "app", schema: Array.from({ length: 501 }, () => ({})) }],
      } as any;
      await api.copyLineLink(row, "drawer");
      expect(searchService.search).not.toHaveBeenCalled();
      expect(linkOf(await writtenUrl()).log_fp).toBeUndefined();
      expect(toast).toHaveBeenCalledWith({
        variant: "warning",
        message: "This stream is too wide to link one line exactly; copied a link to the timestamp",
      });
    });

    it("a failed lookup still copies a timestamp link and says the lookup failed (L-25)", async () => {
      vi.mocked(searchService.search).mockRejectedValue({ response: { status: 500 } });
      await api.copyLineLink(row, "drawer");
      expect(linkOf(await writtenUrl()).log_fp).toBeUndefined();
      expect(toast).toHaveBeenCalledWith({
        variant: "warning",
        message: "Could not look up this line; copied a link to the timestamp",
      });
    });

    it("a failed /short copies the full link and says so, never a silent no-op (L-25)", async () => {
      store.state.zoConfig.web_url = "https://o2.example";
      vi.mocked(shortURLService.create).mockRejectedValue(new Error("403"));
      await api.copyLineLink(row, "drawer");
      expect(linkOf(await writtenUrl()).log_fp).toBe(fingerprintRecord(row));
      expect(toast).toHaveBeenCalledWith({
        variant: "warning",
        message: "Could not shorten the link; copied the full link instead",
      });
    });

    it("without ClipboardItem the URL opens in the popover for a second gesture (AC-C1.3)", async () => {
      vi.stubGlobal("ClipboardItem", undefined);
      await api.copyLineLink(row, "drawer");
      expect(clipboard.write).not.toHaveBeenCalled();
      expect(lineLinkPopover.value?.source).toBe("drawer");
      expect(linkOf(lineLinkPopover.value!.url).log_fp).toBe(fingerprintRecord(row));
    });

    describe("a scope switch while the copy is pending (F1)", () => {
      const original = store.state.selectedOrganization;
      const switchTo = (identifier: string, streams: string[]) => {
        store.state.selectedOrganization = { ...original, identifier };
        searchObj.data.stream.selectedStream = streams;
      };
      const deferred = () => {
        let settle!: (value: unknown) => void;
        const promise = new Promise((resolve) => (settle = resolve));
        return { promise, settle };
      };

      beforeEach(() => {
        store.state.zoConfig.web_url = "https://o2.example";
        switchTo("org-a", ["app"]);
        markRun();
        clipboard.write.mockImplementation(async ([item]: FakeClipboardItem[]) => {
          await item.items["text/plain"];
        });
      });

      afterEach(() => {
        store.state.selectedOrganization = original;
      });

      it("org A to org B during the lookup aborts: nothing copied, nothing shortened, and it says so", async () => {
        const lookup = deferred();
        vi.mocked(searchService.search).mockReturnValue(lookup.promise as any);
        const done = api.copyLineLink(row, "menu");
        switchTo("org-b", ["other"]);
        lookup.settle({ status: 200, data: { hits: [row], is_partial: false } });
        await done;
        expect(vi.mocked(searchService.search).mock.calls[0][0]).toMatchObject({
          org_identifier: "org-a",
        });
        expect(shortURLService.create).not.toHaveBeenCalled();
        expect(lineLinkPopover.value).toBeNull();
        expect(toast).toHaveBeenCalledTimes(1);
        expect(toast).toHaveBeenCalledWith({
          variant: "error",
          message:
            "The organization or stream changed while the link was being made; nothing was copied",
        });
      });

      it("a switch during shortening aborts too; the short link was asked for in org A", async () => {
        const short = deferred();
        vi.mocked(shortURLService.create).mockReturnValue(short.promise as any);
        const done = api.copyLineLink(row, "menu");
        await vi.waitFor(() => expect(shortURLService.create).toHaveBeenCalledTimes(1));
        switchTo("org-b", ["other"]);
        short.settle({ status: 200, data: { short_url: "https://o2.example/short/abc" } });
        await done;
        const [org, longUrl] = vi.mocked(shortURLService.create).mock.calls[0];
        expect(org).toBe("org-a");
        expect(linkOf(longUrl)).toMatchObject({ org_identifier: "org-a", stream: "app" });
        expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: "error" }));
      });

      it("view state changed during the lookup is not read: the link names the click-time view", async () => {
        searchObj.data.stream.selectedFields = ["level"];
        const lookup = deferred();
        vi.mocked(searchService.search).mockReturnValue(lookup.promise as any);
        const done = api.copyLineLink(row, "menu");
        searchObj.data.stream.selectedFields = ["message"];
        store.state.zoConfig.web_url = "";
        lookup.settle({ status: 200, data: { hits: [row], is_partial: false } });
        await done;
        const [org, longUrl] = vi.mocked(shortURLService.create).mock.calls[0];
        expect(org).toBe("org-a");
        expect(decodeColumns(linkOf(longUrl).columns)).toEqual(["level"]);
        expect(await writtenUrl()).toBe("https://o2.example/short/abc");
      });
    });

    it("does nothing for a disabled row", async () => {
      searchObj.meta.executed = null;
      await api.copyLineLink(row, "drawer");
      expect(clipboard.write).not.toHaveBeenCalled();
      expect(searchService.search).not.toHaveBeenCalled();
    });
  });
});
