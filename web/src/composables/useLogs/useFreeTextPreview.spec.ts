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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { effectScope, nextTick, reactive } from "vue";
import { useFreeTextPreview } from "./useFreeTextPreview";
import {
  resetFreeTextSchemasForTests,
  type FreeTextSearchObj,
  type FreeTextDecorations,
} from "./freeTextSearch";
import searchService from "@/services/search";
import streamService from "@/services/stream";
import { gt } from "@/types/i18n";

const config = { default_fts_keys: ["body"] };
const makeSearchObj = () =>
  reactive<
    FreeTextSearchObj & {
      data: { freeTextDecorations: FreeTextDecorations | null };
    }
  >({
    meta: { sqlMode: false },
    data: {
      query: "timeout",
      freeTextDecorations: null,
      stream: {
        selectedStream: ["app"],
        selectedStreamFields: [{ name: "body" }, { name: "level" }],
      },
      streamResults: {
        list: [
          {
            name: "app",
            schema: [
              { name: "body", type: "Utf8" },
              { name: "level", type: "Utf8" },
            ],
            settings: {},
          },
        ],
      },
    },
  });

beforeEach(() => {
  vi.useFakeTimers();
  resetFreeTextSchemasForTests();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useFreeTextPreview (AC-BW.8)", () => {
  it("debounces the editor preview, clears mixes immediately and restores text without requests or query mutation", async () => {
    const search = vi.spyOn(searchService, "search");
    const schema = vi.spyOn(streamService, "schema");
    const obj = makeSearchObj();
    const editor = { text: "timeout" };
    const scope = effectScope();
    const update = scope.run(() =>
      useFreeTextPreview(
        obj,
        () => config,
        () => editor.text,
        gt,
      ),
    )!;
    expect(obj.data.freeTextDecorations).toBeNull();
    vi.advanceTimersByTime(150);
    expect(obj.data.freeTextDecorations?.hover).toContain("match_all('timeout')");
    expect(obj.data.freeTextDecorations?.hover).toContain("all words, any order");

    editor.text = "error";
    update();
    vi.advanceTimersByTime(149);
    expect(obj.data.freeTextDecorations?.hover).toContain("match_all('timeout')");
    vi.advanceTimersByTime(1);
    expect(obj.data.freeTextDecorations?.ranges).toEqual([{ start: 0, end: 5 }]);
    expect(obj.data.freeTextDecorations?.hover).toContain("match_all('error')");

    editor.text = "timeout AND level='x'";
    update();
    expect(obj.data.freeTextDecorations).toBeNull();
    editor.text = "timeout";
    update();
    vi.advanceTimersByTime(150);
    expect(obj.data.freeTextDecorations?.ranges).toEqual([{ start: 0, end: 7 }]);
    expect(obj.data.query).toBe("timeout");
    expect(editor.text).toBe("timeout");
    expect(search).not.toHaveBeenCalled();
    expect(schema).not.toHaveBeenCalled();

    obj.meta.sqlMode = true;
    await nextTick();
    expect(obj.data.freeTextDecorations).toBeNull();
    scope.stop();
  });

  it("keeps editor offsets after a trimmed query emission and previews external query changes", async () => {
    const obj = makeSearchObj();
    obj.data.query = "";
    const editor = { text: "  timeout  " };
    const scope = effectScope();
    const update = scope.run(() =>
      useFreeTextPreview(
        obj,
        () => config,
        () => editor.text,
        gt,
      ),
    )!;
    update();
    vi.advanceTimersByTime(150);
    expect(obj.data.freeTextDecorations?.ranges).toEqual([{ start: 2, end: 9 }]);
    obj.data.query = "timeout";
    await nextTick();
    vi.advanceTimersByTime(150);
    expect(obj.data.freeTextDecorations?.ranges).toEqual([{ start: 2, end: 9 }]);
    expect(editor.text).toBe("  timeout  ");
    obj.data.query = "error";
    await nextTick();
    vi.advanceTimersByTime(150);
    expect(obj.data.freeTextDecorations?.hover).toContain("match_all('error')");
    expect(obj.data.query).toBe("error");
    expect(editor.text).toBe("  timeout  ");
    scope.stop();
  });

  it("cancels stale edits and pending timers on disposal", () => {
    const obj = makeSearchObj();
    let text = "timeout";
    const scope = effectScope();
    const update = scope.run(() =>
      useFreeTextPreview(
        obj,
        () => config,
        () => text,
        gt,
      ),
    )!;
    text = "error";
    update();
    text = "level='x'";
    update();
    vi.advanceTimersByTime(150);
    expect(obj.data.freeTextDecorations).toBeNull();
    text = "timeout";
    update();
    scope.stop();
    vi.advanceTimersByTime(150);
    expect(obj.data.freeTextDecorations).toBeNull();
  });

  it("refreshes programmatic query and cached schema changes without mutating the query", async () => {
    const obj = makeSearchObj();
    const scope = effectScope();
    scope.run(() =>
      useFreeTextPreview(
        obj,
        () => config,
        () => obj.data.query,
        gt,
      ),
    );
    vi.advanceTimersByTime(150);
    obj.data.query = "-debug";
    await nextTick();
    vi.advanceTimersByTime(150);
    expect(obj.data.freeTextDecorations?.hover).toContain("NOT match_all('debug')");
    expect(obj.data.query).toBe("-debug");
    obj.data.streamResults!.list![0].schema!.push({ name: "debug", type: "Boolean" });
    await nextTick();
    expect(obj.data.freeTextDecorations).toBeNull();
    scope.stop();
  });
});
