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
import { SELECT_ALL_VALUE } from "@/utils/dashboard/constants";
import i18n from "@/locales";
import type { TranslateFn } from "@/types/i18n";
import {
  getPanelDisplayTitle,
  getPanelTitleSuggestions,
  isPanelTitleLoading,
  resolvePanelTitle,
  toPanelFileName,
} from "@/utils/dashboard/panelTitle";

const vars = (...values: any[]) => ({ values });
const resolve = (title: string, data: any, context?: any) =>
  resolvePanelTitle(title, data, context, "All");

describe("resolvePanelTitle", () => {
  it("substitutes $var and ${var}", () => {
    const data = vars({ name: "cdu", value: "cdu-3" }, { name: "row", value: "C" });
    expect(resolve("GPU temperature — $cdu", data)).toBe("GPU temperature — cdu-3");
    expect(resolve("Inlet ${row}", data)).toBe("Inlet C");
    expect(resolve("Inlet {{ row }}", data)).toBe("Inlet C");
  });

  it("lets the longest known name win", () => {
    const data = vars({ name: "host", value: "a" }, { name: "host_group", value: "g1" });
    expect(resolve("$host_group / $host", data)).toBe("g1 / a");
  });

  it("joins multi-value variables with a comma and a space", () => {
    const data = vars({ name: "sw", value: ["leaf-07", "leaf-08", "leaf-09"] });
    expect(resolve("Port errors — $sw", data)).toBe("Port errors — leaf-07, leaf-08, leaf-09");
  });

  it("honours an explicit format modifier", () => {
    const data = vars({ name: "sw", value: ["a", "b"] });
    expect(resolve("${sw:pipe}", data)).toBe("a|b");
    expect(resolve("${sw:csv}", data)).toBe("a,b");
  });

  it("shows the All label instead of the select-all sentinel", () => {
    expect(resolve("Hosts: $h", vars({ name: "h", value: [SELECT_ALL_VALUE] }))).toBe("Hosts: All");
    expect(resolve("Hosts: $h", vars({ name: "h", value: SELECT_ALL_VALUE }))).toBe("Hosts: All");
    expect(resolve("${h:pipe}", vars({ name: "h", value: [SELECT_ALL_VALUE] }))).toBe("All");
    expect(resolve("$h", vars({ name: "h", value: [SELECT_ALL_VALUE] }))).not.toContain(
      SELECT_ALL_VALUE,
    );
  });

  it.each([null, undefined, "", []])("drops an empty value (%j) and its separator", (value) => {
    const data = vars({ name: "cdu", value });
    expect(resolve("GPU temperature — $cdu", data)).toBe("GPU temperature");
    expect(resolve("$cdu — GPU temperature", data)).toBe("GPU temperature");
    expect(resolve("GPU ($cdu)", data)).toBe("GPU");
    expect(resolve("A — $cdu — B", data)).toBe("A — B");
    expect(resolve("CPU: ${cdu}", data)).toBe("CPU");
  });

  it("never leaves a known empty variable as the literal $var", () => {
    expect(resolve("Errors $sw", vars({ name: "sw", value: null }))).toBe("Errors");
  });

  it("drops two empty values in a row", () => {
    const data = vars({ name: "a", value: "" }, { name: "b", value: [] });
    expect(resolve("$a, $b — Title", data)).toBe("Title");
  });

  it("leaves unknown names as typed", () => {
    const data = vars({ name: "cdu", value: "x" });
    expect(resolve("Cost $100 for $foo", data)).toBe("Cost $100 for $foo");
  });

  it("keeps the title when there are no variables", () => {
    expect(resolve("Plain $x", undefined)).toBe("Plain $x");
    expect(resolve("Plain", vars())).toBe("Plain");
    expect(resolvePanelTitle(undefined, vars(), undefined, "All")).toBe("");
  });

  it("inserts values as plain text, never as markup", () => {
    const payload = "<img src=x onerror=alert(1)>";
    expect(resolve("Panel $v", vars({ name: "v", value: payload }))).toBe(`Panel ${payload}`);
  });

  it("resolves a panel-scoped variable for its own panel only", () => {
    const data = vars(
      { name: "dc", scope: "global", value: "global-dc" },
      { name: "dc", scope: "tabs", tabId: "t1", value: "tab-dc" },
      { name: "dc", scope: "panels", panelId: "p1", value: "panel-dc" },
    );
    expect(resolve("$dc", data, { tabId: "t1", panelId: "p1" })).toBe("panel-dc");
    expect(resolve("$dc", data, { tabId: "t1", panelId: "p2" })).toBe("tab-dc");
    expect(resolve("$dc", data, { tabId: "t2", panelId: "p2" })).toBe("global-dc");
  });
});

describe("isPanelTitleLoading", () => {
  it("is true only while a referenced query variable loads", () => {
    const data = vars(
      { name: "cdu", type: "query_values", value: null, isLoading: true },
      { name: "row", type: "query_values", value: "C", isVariableLoadingPending: false },
    );
    expect(isPanelTitleLoading("GPU $cdu", data)).toBe(true);
    expect(isPanelTitleLoading("Inlet $row", data)).toBe(false);
    expect(isPanelTitleLoading("No vars", data)).toBe(false);
  });

  it("keeps the raw template while loading", () => {
    const data = vars({ name: "cdu", type: "query_values", value: null, isLoading: true });
    expect(getPanelDisplayTitle("GPU — $cdu", data, undefined, "All")).toBe("GPU — $cdu");
    data.values[0].isLoading = false;
    data.values[0].value = "cdu-1";
    expect(getPanelDisplayTitle("GPU — $cdu", data, undefined, "All")).toBe("GPU — cdu-1");
  });
});

describe("toPanelFileName", () => {
  it("keeps a short title as it is", () => {
    expect(toPanelFileName("GPU temperature — cdu-2")).toBe("GPU temperature — cdu-2");
  });

  it("cuts a long title at a word boundary within 100 characters, without an ellipsis", () => {
    const hosts = Array.from({ length: 10 }, (_, i) => `gpu-node-${i}.dc1.example.com`);
    const name = toPanelFileName(`GPU power — ${hosts.join(", ")}`)!;
    expect(name.length).toBeLessThanOrEqual(100);
    expect(name.startsWith("GPU power — gpu-node-0.dc1.example.com, ")).toBe(true);
    expect(name).not.toMatch(/[…,\s]$/);
    expect(`GPU power — ${hosts.join(", ")}`.startsWith(name)).toBe(true);
  });

  it("hard-cuts a long title that has no spaces", () => {
    expect(toPanelFileName("x".repeat(250))).toBe("x".repeat(100));
  });

  it("replaces filesystem-unsafe characters", () => {
    expect(toPanelFileName('a/b\\c:d*e?f"g<h>i|j')).toBe("a b c d e f g h i j");
    expect(toPanelFileName("tab\there")).toBe("tab here");
  });

  it("returns undefined for an empty title so the caller's default name applies", () => {
    expect(toPanelFileName("")).toBeUndefined();
    expect(toPanelFileName(" | ")).toBeUndefined();
    expect(toPanelFileName(undefined)).toBeUndefined();
  });
});

describe("getPanelTitleSuggestions", () => {
  const t = i18n.global.t as unknown as TranslateFn;
  const suggest = (variables: any[], context = { tabId: "t1", panelId: "p1" }) =>
    getPanelTitleSuggestions(variables, context, t);

  it("offers a single-value variable once, labelled by its type", () => {
    expect(
      suggest([
        { name: "cdu", type: "query_values", multiSelect: false },
        { name: "env", type: "constant" },
        { name: "q", type: "textbox" },
        { name: "pick", type: "custom" },
      ]),
    ).toEqual([
      { name: "cdu", description: "Query values" },
      { name: "env", description: "Constant" },
      { name: "q", description: "Text box" },
      { name: "pick", description: "Custom" },
    ]);
  });

  it("adds every list format the resolver supports for a multi-select variable", () => {
    expect(suggest([{ name: "rack", type: "query_values", multiSelect: true }])).toEqual([
      { name: "rack", description: "Query values · a, b" },
      { name: "rack:csv", description: "Commas: a,b" },
      { name: "rack:pipe", description: "Pipes: a|b" },
      { name: "rack:doublequote", description: 'Double quotes: "a","b"' },
      { name: "rack:singlequote", description: "Single quotes: 'a','b'" },
    ]);
  });

  it("skips ad hoc filters, duplicates, and variables scoped to another tab or panel", () => {
    const names = suggest([
      { name: "adhoc", type: "dynamic_filters" },
      { name: "a", type: "constant", scope: "global" },
      { name: "a", type: "constant", scope: "global" },
      { name: "here", type: "constant", scope: "tabs", tabs: ["t1"] },
      { name: "elsewhere", type: "constant", scope: "tabs", tabs: ["t2"] },
      { name: "mine", type: "constant", scope: "panels", panels: ["p1"] },
      { name: "theirs", type: "constant", scope: "panels", panels: ["p2"] },
    ]).map((s) => s.name);

    expect(names).toEqual(["a", "here", "mine"]);
  });

  it("returns nothing without variables", () => {
    expect(suggest(undefined as any)).toEqual([]);
  });
});
