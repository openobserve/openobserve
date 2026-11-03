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

import { describe, expect, it } from "vitest";
import {
  activeScopePredicate,
  entrypointPredicate,
  isTracesScope,
  scopePredicate,
  withScope,
} from "./tracesScope";

const ROOT = "(reference_parent_span_id IS NULL OR reference_parent_span_id = '')";
const KINDS = "CAST(span_kind AS VARCHAR) IN ('2','5')";

describe("scopePredicate", () => {
  it("adds nothing for All spans, with or without parent ids", () => {
    expect(scopePredicate("all", true)).toBe("");
    expect(scopePredicate("all", false)).toBe("");
  });

  it("tests for a missing parent for Root spans", () => {
    expect(scopePredicate("root", true)).toBe(ROOT);
  });

  it("adds nothing for Root spans on a stream without reference_parent_span_id", () => {
    expect(scopePredicate("root", false)).toBe("");
  });

  it("takes server and consumer spans plus any root for Entrypoint spans", () => {
    expect(scopePredicate("entrypoint", true)).toBe(`(${KINDS} OR ${ROOT})`);
  });

  it("uses the kind test alone for Entrypoint spans without reference_parent_span_id", () => {
    expect(scopePredicate("entrypoint", false)).toBe(`(${KINDS})`);
  });

  it("is the Services catalog request rule for Entrypoint spans", () => {
    expect(scopePredicate("entrypoint", true)).toBe(entrypointPredicate(true));
    expect(scopePredicate("entrypoint", false)).toBe(entrypointPredicate(false));
  });
});

describe("withScope", () => {
  it("leaves the filter as it is when there is no scope condition", () => {
    expect(withScope(" a = 1 ", "")).toBe(" a = 1 ");
    expect(withScope("", "")).toBe("");
  });

  it("is the scope condition alone for an empty filter", () => {
    expect(withScope("  ", ROOT)).toBe(ROOT);
  });

  it("brackets the filter so its OR cannot bind past the scope", () => {
    expect(withScope("a = 1 OR b = 2", ROOT)).toBe(`(a = 1 OR b = 2) AND ${ROOT}`);
  });
});

describe("activeScopePredicate", () => {
  const state = (meta: Record<string, unknown>, hasParentColumn = true) => ({
    meta: { searchMode: "spans", sqlMode: false, scope: "root", ...meta },
    data: { stream: { hasParentColumn } },
  });

  it("applies the scope in the Spans view with SQL mode off", () => {
    expect(activeScopePredicate(state({}))).toBe(ROOT);
  });

  it("applies no scope in SQL mode, where the typed WHERE decides", () => {
    expect(activeScopePredicate(state({ sqlMode: true }))).toBe("");
  });

  it("applies no scope in the Traces view", () => {
    expect(activeScopePredicate(state({ searchMode: "traces" }))).toBe("");
  });

  it("reads a missing or unknown scope as All spans", () => {
    expect(activeScopePredicate(state({ scope: undefined }))).toBe("");
    expect(activeScopePredicate(state({ scope: "nonsense" }))).toBe("");
  });

  it("reads the stream's parent column", () => {
    expect(activeScopePredicate(state({ scope: "entrypoint" }, false))).toBe(`(${KINDS})`);
  });
});

describe("isTracesScope", () => {
  it("accepts the three scopes only", () => {
    expect(["all", "root", "entrypoint"].every(isTracesScope)).toBe(true);
    expect(isTracesScope("ROOT")).toBe(false);
    expect(isTracesScope(undefined)).toBe(false);
  });
});
