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

// Guards the field-name trap that made JS functions leak into the pipeline
// picker and left the workflow picker empty: the list API returns camelCase
// `transType`, while the request body / IFunction use snake_case `trans_type`.

import { describe, it, expect } from "vitest";
import { isJsFunction, isVrlFunction } from "./functionLanguage";

describe("isJsFunction", () => {
  it("reads the camelCase transType the LIST API actually returns", () => {
    expect(isJsFunction({ name: "js_fn", transType: 1 })).toBe(true);
    expect(isJsFunction({ name: "vrl_fn", transType: 0 })).toBe(false);
  });

  it("also reads the snake_case trans_type (request body / IFunction shape)", () => {
    expect(isJsFunction({ trans_type: 1 })).toBe(true);
    expect(isJsFunction({ trans_type: 0 })).toBe(false);
  });

  it("accepts a stringified value (form state stringifies transType)", () => {
    expect(isJsFunction({ transType: "1" })).toBe(true);
    expect(isJsFunction({ transType: "0" })).toBe(false);
  });

  it("treats an absent/!null value as VRL (the default)", () => {
    expect(isJsFunction({})).toBe(false);
    expect(isJsFunction({ transType: undefined })).toBe(false);
    expect(isJsFunction({ transType: null })).toBe(false);
    expect(isJsFunction(null)).toBe(false);
    expect(isJsFunction(undefined)).toBe(false);
  });

  it("prefers transType when both spellings are present", () => {
    expect(isJsFunction({ transType: 1, trans_type: 0 })).toBe(true);
    expect(isJsFunction({ transType: 0, trans_type: 1 })).toBe(false);
  });

  it("does not treat other numbers as JS", () => {
    expect(isJsFunction({ transType: 2 })).toBe(false);
  });
});

describe("isVrlFunction", () => {
  it("is the inverse of isJsFunction", () => {
    expect(isVrlFunction({ transType: 0 })).toBe(true);
    expect(isVrlFunction({ transType: 1 })).toBe(false);
    expect(isVrlFunction({})).toBe(true);
  });
});
