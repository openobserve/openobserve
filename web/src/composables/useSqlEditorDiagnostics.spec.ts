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

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { nextTick, ref } from "vue";
import type { SqlErrorRange } from "@/utils/query/sqlDiagnostics";

const validateSql = vi.fn();
vi.mock("@/utils/query/sqlDiagnostics", () => ({
  validateSql: (...args: unknown[]) => validateSql(...args),
}));

import { useSqlEditorDiagnostics } from "./useSqlEditorDiagnostics";

const SERVER_RANGE: SqlErrorRange = {
  startLine: 1,
  endLine: 1,
  column: 1,
  endColumn: 5,
  error: "`body` is text, not a condition.",
};

function setup(text = "body and contains('a', 'b')") {
  const markers = ref<SqlErrorRange[]>([]);
  const editorText = ref(text);
  const editor = {
    addErrorDiagnostics: (ranges: SqlErrorRange[]) => {
      markers.value = ranges;
    },
    getValue: () => editorText.value,
  };
  const externalErrors = ref<SqlErrorRange[]>([]);
  const diag = useSqlEditorDiagnostics({
    queryEditorRef: ref(editor),
    sqlMode: ref(false),
    query: editorText,
    streamName: ref("default"),
    externalErrors,
  });
  return { diag, markers, editorText, externalErrors };
}

describe("useSqlEditorDiagnostics — markers from a run", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    validateSql.mockReset();
    validateSql.mockResolvedValue(null);
  });
  afterEach(() => vi.useRealTimers());

  it("keep a server marker when the editor gains focus, as Fix the query does", async () => {
    const { diag, markers, externalErrors } = setup();
    externalErrors.value = [SERVER_RANGE];
    await nextTick();
    diag.onFocus();
    await nextTick();
    expect(markers.value).toEqual([SERVER_RANGE]);
    expect(externalErrors.value).toEqual([SERVER_RANGE]);
  });

  it("keep a server marker through a blur with no edit", async () => {
    const { diag, markers, externalErrors } = setup();
    externalErrors.value = [SERVER_RANGE];
    await nextTick();
    diag.onFocus();
    await diag.onBlur();
    await nextTick();
    expect(markers.value).toEqual([SERVER_RANGE]);
  });

  it("clear a server marker on the first edit", async () => {
    const { diag, markers, externalErrors, editorText } = setup();
    externalErrors.value = [SERVER_RANGE];
    await nextTick();
    diag.onFocus();
    editorText.value = "body = 'x'";
    diag.onQueryChange();
    vi.advanceTimersByTime(500);
    await nextTick();
    expect(markers.value).toEqual([]);
    expect(externalErrors.value).toEqual([]);
  });

  it("keep a server marker that arrives while the typing debounce is still pending", async () => {
    const { diag, markers, externalErrors } = setup();
    diag.onQueryChange();
    externalErrors.value = [SERVER_RANGE];
    await nextTick();
    vi.advanceTimersByTime(500);
    await nextTick();
    expect(markers.value).toEqual([SERVER_RANGE]);
  });

  it("still clear markers from blur validation when the editor gains focus", async () => {
    const blurRange = { ...SERVER_RANGE, error: "Missing operator" };
    validateSql.mockResolvedValue(blurRange);
    const { diag, markers } = setup("level 'x'");
    await diag.onBlur();
    await nextTick();
    expect(markers.value).toEqual([blurRange]);
    diag.onFocus();
    await nextTick();
    expect(markers.value).toEqual([]);
  });

  it("keep a server marker that equals an earlier blur marker when the editor gains focus", async () => {
    validateSql.mockResolvedValue(SERVER_RANGE);
    const { diag, markers, externalErrors } = setup("level =");
    await diag.onBlur();
    await nextTick();
    diag.onFocus();
    await nextTick();
    externalErrors.value = [{ ...SERVER_RANGE }];
    await nextTick();
    diag.onFocus();
    await nextTick();
    expect(markers.value).toEqual([SERVER_RANGE]);
  });
});
