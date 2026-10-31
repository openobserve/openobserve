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
  compileLabelFilters,
  escapeRegexLiteral,
  filterGroupsOf,
  hasFilterGroups,
  MAX_FILTER_BRANCHES,
  type BooleanLabelMatch,
} from "./labelBoolean";

const m = (
  label: string,
  op: BooleanLabelMatch["op"],
  value: string,
  group?: number,
  negate?: boolean,
): BooleanLabelMatch => ({ label, op, value, group, negate });

const branches = (matchers: BooleanLabelMatch[]) => {
  const compiled = compileLabelFilters(matchers);
  if (!compiled.ok) throw new Error(`expected branches, got ${compiled.branchCount}`);
  return compiled.branches;
};

describe("compileLabelFilters", () => {
  it("keeps an ungrouped list as one branch, in its own order", () => {
    const list = [m("job", "=", "api"), m("code", "=~", "5..")];
    expect(branches(list)).toEqual([
      [
        { label: "job", op: "=", value: "api" },
        { label: "code", op: "=~", value: "5.." },
      ],
    ]);
    expect(branches([])).toEqual([[]]);
  });

  it("ANDs the base list into every OR group", () => {
    expect(branches([m("job", "=", "api"), m("a", "!=", "1", 1), m("b", "=~", "x.*", 2)])).toEqual([
      [
        { label: "job", op: "=", value: "api" },
        { label: "a", op: "!=", value: "1" },
      ],
      [
        { label: "job", op: "=", value: "api" },
        { label: "b", op: "=~", value: "x.*" },
      ],
    ]);
  });

  it("pushes NOT down to the matchers by De Morgan", () => {
    // NOT (env="prod" AND region=~"us-.*") is env!="prod" OR region!~"us-.*".
    expect(
      branches([
        m("job", "=", "api"),
        m("env", "=", "prod", 1, true),
        m("region", "=~", "us-.*", 1, true),
      ]),
    ).toEqual([
      [
        { label: "job", op: "=", value: "api" },
        { label: "env", op: "!=", value: "prod" },
      ],
      [
        { label: "job", op: "=", value: "api" },
        { label: "region", op: "!~", value: "us-.*" },
      ],
    ]);
    expect(branches([m("a", "!=", "1", 1, true), m("b", "!~", "x", 1, true)])).toEqual([
      [{ label: "a", op: "=", value: "1" }],
      [{ label: "b", op: "=~", value: "x" }],
    ]);
  });

  it("merges branches that differ only in one label's equality value", () => {
    expect(
      branches([m("job", "=", "api"), m("code", "=", "500", 1), m("code", "=", "503", 2)]),
    ).toEqual([
      [
        { label: "job", op: "=", value: "api" },
        { label: "code", op: "=~", value: "(?:500|503)" },
      ],
    ]);
  });

  it("escapes regex metacharacters in merged literal values", () => {
    expect(branches([m("path", "=", "/a.b", 1), m("path", "=", "x|(y)*", 2)])).toEqual([
      [{ label: "path", op: "=~", value: "(?:/a\\.b|x\\|\\(y\\)\\*)" }],
    ]);
  });

  it("does not merge across differing rest matchers, regex values or variables", () => {
    expect(branches([m("a", "=", "1", 1), m("a", "=", "2", 2), m("b", "=", "3", 2)])).toHaveLength(
      2,
    );
    expect(branches([m("a", "=~", "1", 1), m("a", "=~", "2", 2)])).toHaveLength(2);
    expect(branches([m("a", "=", "$var", 1), m("a", "=", "2", 2)])).toHaveLength(2);
  });

  it("drops duplicate branches and duplicate matchers", () => {
    expect(
      branches([m("a", "=", "1"), m("a", "=", "1", 1), m("b", "=", "2", 2), m("b", "=", "2", 3)]),
    ).toEqual([
      [{ label: "a", op: "=", value: "1" }],
      [
        { label: "a", op: "=", value: "1" },
        { label: "b", op: "=", value: "2" },
      ],
    ]);
  });

  it(`refuses more than ${MAX_FILTER_BRANCHES} branches`, () => {
    const negated = Array.from({ length: MAX_FILTER_BRANCHES + 1 }, (_, i) =>
      m(`l${i}`, "=", "x", 1, true),
    );
    expect(compileLabelFilters(negated)).toEqual({ ok: false, branchCount: 17 });
    expect(branches(negated.slice(0, MAX_FILTER_BRANCHES))).toHaveLength(MAX_FILTER_BRANCHES);
  });

  it("counts branches after merging, so many values of one label stay runnable", () => {
    const values = Array.from({ length: 20 }, (_, i) => m("code", "=", String(i), i + 1));
    expect(branches(values)).toHaveLength(1);
  });
});

describe("helpers", () => {
  it("escapes every RE2 metacharacter", () => {
    expect(escapeRegexLiteral("a.b*c+d?e^f$g|h(i)j[k]l{m}n\\")).toBe(
      "a\\.b\\*c\\+d\\?e\\^f\\$g\\|h\\(i\\)j\\[k\\]l\\{m\\}n\\\\",
    );
  });

  it("groups matchers in ascending group order", () => {
    const list = [m("c", "=", "1", 3), m("a", "=", "1"), m("b", "=", "1", 2, true)];
    expect(hasFilterGroups(list)).toBe(true);
    expect(hasFilterGroups([m("a", "=", "1")])).toBe(false);
    expect(filterGroupsOf(list).map(({ group, negate }) => [group, negate])).toEqual([
      [2, true],
      [3, false],
    ]);
  });
});
