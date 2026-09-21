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
import type { BrowserStep } from "@/types/synthetics";
import { buildV2Steps } from "./buildV2Steps";
import { expandJourney, placeholdersIn } from "./expandJourney";

// Byte-identical twin of `COMPOSITION_CONTRACT` in `src/config/src/meta/synthetics_composition.rs`.
const COMPOSITION_CONTRACT = `{
  "child": [
    { "id": "c1", "action": "navigate", "name": "Open login", "url": "https://{{HOST}}/login" },
    { "id": "c2", "action": "fill", "name": "Email", "value": "{{ USER }}", "locator": { "candidates": [{ "kind": "css", "value": "#email" }] } },
    { "id": "c3", "action": "select", "name": "Region", "value": "{{REGION}}", "locator": { "candidates": [{ "kind": "css", "value": "#region" }] } },
    { "id": "c4", "action": "press", "name": "Submit key", "key": "{{KEY}}", "locator": { "candidates": [{ "kind": "css", "value": "#password" }] } },
    { "id": "c5", "action": "click", "locator": { "candidates": [{ "kind": "css", "value": "#go" }] } },
    { "id": "c6", "action": "hover", "name": "Menu", "locator": { "candidates": [{ "kind": "css", "value": "#menu" }] } },
    { "id": "c7", "action": "check", "name": "Remember", "locator": { "candidates": [{ "kind": "css", "value": "#remember" }] } },
    { "id": "c8", "action": "uncheck", "name": "Newsletter", "locator": { "candidates": [{ "kind": "css", "value": "#news" }] } },
    { "id": "c9", "action": "upload", "name": "Avatar", "files": ["/tmp/{{FILE}}.png"], "locator": { "candidates": [{ "kind": "css", "value": "#avatar" }] } },
    { "id": "c10", "action": "assert", "name": "{{IGNORED}} banner", "locator": { "candidates": [{ "kind": "css", "value": "#banner" }] }, "assertion": { "kind": "element_visible" } }
  ],
  "parent": [
    { "id": "p1", "action": "navigate", "name": "Home", "url": "https://app.test/" },
    { "id": "p2", "action": "subtest", "name": "Log in (shared)", "subtest": { "id": "login-test" } },
    { "id": "p3", "action": "subtest", "subtest": { "id": "login-test" } },
    { "id": "p4", "action": "click", "name": "Logs", "locator": { "candidates": [{ "kind": "css", "value": "#logs" }] } }
  ],
  "placeholders": ["HOST", "KEY", "REGION", "USER"],
  "expanded": [
    ["p1", "Home"],
    ["p2_c1", "Log in (shared) › Open login"],
    ["p2_c2", "Log in (shared) › Email"],
    ["p2_c3", "Log in (shared) › Region"],
    ["p2_c4", "Log in (shared) › Submit key"],
    ["p2_c5", "Log in (shared) › step"],
    ["p2_c6", "Log in (shared) › Menu"],
    ["p2_c7", "Log in (shared) › Remember"],
    ["p2_c8", "Log in (shared) › Newsletter"],
    ["p2_c9", "Log in (shared) › Avatar"],
    ["p2_c10", "Log in (shared) › {{IGNORED}} banner"],
    ["p3_c1", "Login › Open login"],
    ["p3_c2", "Login › Email"],
    ["p3_c3", "Login › Region"],
    ["p3_c4", "Login › Submit key"],
    ["p3_c5", "Login › step"],
    ["p3_c6", "Login › Menu"],
    ["p3_c7", "Login › Remember"],
    ["p3_c8", "Login › Newsletter"],
    ["p3_c9", "Login › Avatar"],
    ["p3_c10", "Login › {{IGNORED}} banner"],
    ["p4", "Logs"]
  ]
}`;

const contract = JSON.parse(COMPOSITION_CONTRACT) as {
  child: unknown[];
  parent: unknown[];
  placeholders: string[];
  expanded: [string, string][];
};

const css = (value: string) => ({ candidates: [{ kind: "css" as const, value }] });

function childSteps(): BrowserStep[] {
  return [
    { id: "c1", action: "navigate", name: "Open login", value: "https://{{HOST}}/login" },
    { id: "c2", action: "type", name: "Email", value: "{{ USER }}", locator: css("#email") },
    { id: "c3", action: "select", name: "Region", value: "{{REGION}}", locator: css("#region") },
    { id: "c4", action: "press", name: "Submit key", value: "{{KEY}}", locator: css("#password") },
    { id: "c5", action: "click", locator: css("#go") },
    { id: "c6", action: "hover", name: "Menu", locator: css("#menu") },
    { id: "c7", action: "check", name: "Remember", locator: css("#remember") },
    { id: "c8", action: "uncheck", name: "Newsletter", locator: css("#news") },
    {
      id: "c9",
      action: "upload",
      name: "Avatar",
      value: "/tmp/{{FILE}}.png",
      locator: css("#avatar"),
    },
    {
      id: "c10",
      action: "assert",
      name: "{{IGNORED}} banner",
      value: "{{UNSTORED}}",
      locator: css("#banner"),
      assertion: { kind: "element_visible" },
    },
  ];
}

function parentSteps(): BrowserStep[] {
  return [
    { id: "p1", action: "navigate", name: "Home", value: "https://app.test/" },
    {
      id: "p2",
      action: "subtest",
      name: "Log in (shared)",
      subtest: { id: "login-test", name: "Login" },
    },
    { id: "p3", action: "subtest", subtest: { id: "login-test" } },
    { id: "p4", action: "click", name: "Logs", locator: css("#logs") },
  ];
}

describe("the composition contract shared with the Rust expander", () => {
  it("builds the wire steps the Rust twin reads", () => {
    expect(buildV2Steps(childSteps())).toEqual(contract.child);
    expect(buildV2Steps(parentSteps())).toEqual(contract.parent);
  });

  it("finds the placeholders the server finds in the stored steps", () => {
    expect([...placeholdersIn(childSteps())].sort()).toEqual(contract.placeholders);
  });

  it("composes the ids and names the server expander composes", () => {
    const children = new Map([
      ["login-test", { id: "login-test", name: "Login", steps: childSteps() }],
    ]);
    const { steps } = expandJourney(parentSteps(), children);
    expect(steps.map((s) => [s.id, s.name])).toEqual(contract.expanded);
  });
});
