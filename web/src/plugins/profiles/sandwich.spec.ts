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
import { calleesOf, callersOf, type CallNode } from "./sandwich";

// total ─ main ─ a ─ F(self 2) ─ x(3)
//              │        └ F(self 1, recursive)
//              └ b ─ F(self 4) ─ y(5)
const tree: CallNode = {
  name: "total",
  self: 0,
  total: 20,
  children: [
    {
      name: "main",
      self: 0,
      total: 20,
      children: [
        {
          name: "a",
          self: 0,
          total: 6,
          children: [
            {
              name: "F",
              self: 2,
              total: 6,
              children: [
                { name: "x", self: 3, total: 3 },
                { name: "F", self: 1, total: 1 },
              ],
            },
          ],
        },
        {
          name: "b",
          self: 5,
          total: 14,
          children: [
            { name: "F", self: 4, total: 9, children: [{ name: "y", self: 5, total: 5 }] },
          ],
        },
      ],
    },
  ],
};

describe("calleesOf", () => {
  it("merges every outermost call into one tree, the recursive call kept inside", () => {
    expect(calleesOf(tree, "F")).toEqual({
      name: "F",
      self: 6,
      total: 15,
      children: [
        { name: "y", self: 5, total: 5 },
        { name: "x", self: 3, total: 3 },
        { name: "F", self: 1, total: 1 },
      ],
    });
  });

  it("returns null for a function that is not in the tree", () => {
    expect(calleesOf(tree, "missing")).toBeNull();
    expect(calleesOf(null, "F")).toBeNull();
  });
});

describe("callersOf", () => {
  it("inverts the paths into the function and leaves out the synthetic root", () => {
    expect(callersOf(tree, "F")).toEqual({
      name: "F",
      self: 0,
      total: 15,
      children: [
        {
          name: "b",
          self: 0,
          total: 9,
          children: [{ name: "main", self: 9, total: 9 }],
        },
        {
          name: "a",
          self: 0,
          total: 6,
          children: [{ name: "main", self: 6, total: 6 }],
        },
      ],
    });
  });

  it("keeps the samples on the function itself when nothing calls it", () => {
    expect(callersOf(tree, "main")).toEqual({ name: "main", self: 20, total: 20 });
  });
});
