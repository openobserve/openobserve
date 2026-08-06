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

// Which language a saved transform is written in.
//
// The field name is a trap: the LIST response returns camelCase `transType`
// (see the /functions list payload), while the request body / `IFunction`
// interface use snake_case `trans_type`. Reading only `trans_type` off a listed
// function silently yields `undefined`, so `trans_type !== 1` matches EVERY
// function and `trans_type === 1` matches NONE — which is exactly how JS
// functions leaked into the pipeline picker and the workflow picker came up
// empty. Both spellings are accepted here so call sites can't get it wrong.
//
// The value may also arrive as a number (1) or a string ("1") depending on
// whether it came straight off the API or through a form, hence the Number().
//
//   isJsFunction({ transType: 1 })    // true   (list response)
//   isJsFunction({ trans_type: 1 })   // true   (request/interface shape)
//   isJsFunction({ transType: "1" })  // true   (form-stringified)
//   isJsFunction({ transType: 0 })    // false  (VRL)
//   isJsFunction({})                  // false  (absent → VRL)
export const isJsFunction = (func: any): boolean =>
  Number(func?.transType ?? func?.trans_type ?? 0) === 1;

/** Inverse of {@link isJsFunction} — VRL is the default when unset. */
export const isVrlFunction = (func: any): boolean => !isJsFunction(func);
