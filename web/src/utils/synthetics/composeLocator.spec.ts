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
  canDefaultToAnd,
  composeLocator,
  decomposeLocator,
  isBareFilterEngine,
  isCompositeSelector,
  type CompositePart,
} from "./composeLocator";

const ROW = '[data-test="org-row"]';
const TEXT = 'internal:text="acme_prod"';

describe("composeLocator", () => {
  it("emits the right engine for each of the four relations", () => {
    const base = { value: ROW };
    expect(composeLocator({ parts: [base, { relation: "and", value: TEXT }] })).toBe(
      `${ROW} >> internal:and=${JSON.stringify(TEXT)}`,
    );
    expect(composeLocator({ parts: [base, { relation: "has", value: TEXT }] })).toBe(
      `${ROW} >> internal:has=${JSON.stringify(TEXT)}`,
    );
    expect(composeLocator({ parts: [base, { relation: "has_not", value: TEXT }] })).toBe(
      `${ROW} >> internal:has-not=${JSON.stringify(TEXT)}`,
    );
  });

  // `descendant` is `A >> B`, a plain chain. Quoting it would make Playwright
  // parse the whole selector as one opaque engine body.
  it("does not JSON-quote a descendant, which is a plain chain", () => {
    expect(
      composeLocator({ parts: [{ value: ROW }, { relation: "descendant", value: "span" }] }),
    ).toBe(`${ROW} >> span`);
  });

  it("escapes the inner selector for the three nested relations", () => {
    const built = composeLocator({
      parts: [{ value: ROW }, { relation: "and", value: '[data-org="acme"]' }],
    });
    expect(built).toContain('internal:and="[data-org=\\"acme\\"]"');
  });

  // Order inside the string is load-bearing: parts run left to right and `nth`
  // is itself a part. `A >> nth=4 ∧ B` takes A's fifth match and requires it to
  // be B; `A ∧ B >> nth=4` intersects to one element then asks for the fifth,
  // which matches nothing. The second shape must be unexpressible.
  it("re-emits the base part's nth BEFORE the first join", () => {
    const built = composeLocator({
      parts: [{ value: `${ROW} >> nth=1` }, { relation: "and", value: TEXT }],
      requirePosition: true,
    });
    expect(built).toBe(`${ROW} >> nth=1 >> internal:and=${JSON.stringify(TEXT)}`);
    expect(built.indexOf("nth=")).toBeLessThan(built.indexOf("internal:and="));
  });

  it("strips the base part's nth when the position is not required", () => {
    expect(
      composeLocator({
        parts: [{ value: `${ROW} >> nth=1` }, { relation: "and", value: TEXT }],
      }),
    ).toBe(`${ROW} >> internal:and=${JSON.stringify(TEXT)}`);
  });

  it("keeps an nth that is not on the base part out of the way", () => {
    // The index belongs to the inner selector, which is quoted whole.
    const built = composeLocator({
      parts: [{ value: ROW }, { relation: "and", value: `div >> nth=0` }],
    });
    expect(built).toBe(`${ROW} >> internal:and=${JSON.stringify("div >> nth=0")}`);
  });

  it("nests a three-way combination left to right", () => {
    expect(
      composeLocator({
        parts: [
          { value: ROW },
          { relation: "and", value: '[data-org="acme"]' },
          { relation: "has", value: TEXT },
        ],
      }),
    ).toBe(
      `${ROW} >> internal:and=${JSON.stringify('[data-org="acme"]')} >> internal:has=${JSON.stringify(TEXT)}`,
    );
  });

  it("returns an empty string for no parts", () => {
    expect(composeLocator({ parts: [] })).toBe("");
  });
});

describe("decomposeLocator", () => {
  function roundTrip(parts: CompositePart[]) {
    return decomposeLocator(composeLocator({ parts }));
  }

  it("round-trips a two-part combination, relation included", () => {
    const parts: CompositePart[] = [{ value: ROW }, { relation: "and", value: TEXT }];
    expect(roundTrip(parts)).toEqual(parts);
  });

  it("round-trips a three-way combination", () => {
    const parts: CompositePart[] = [
      { value: ROW },
      { relation: "and", value: '[data-org="acme"]' },
      { relation: "has", value: TEXT },
    ];
    expect(roundTrip(parts)).toEqual(parts);
  });

  // "The delete button in the row containing acme_prod" — has, then descendant.
  // A single flat relation on the candidate could not express this, which is
  // why the relation lives on each join.
  it("round-trips mixed relations", () => {
    const parts: CompositePart[] = [
      { value: ROW },
      { relation: "has", value: TEXT },
      { relation: "descendant", value: 'button[aria-label="Delete"]' },
    ];
    expect(roundTrip(parts)).toEqual(parts);
  });

  it("round-trips has_not", () => {
    const parts: CompositePart[] = [{ value: ROW }, { relation: "has_not", value: TEXT }];
    expect(roundTrip(parts)).toEqual(parts);
  });

  it("keeps a multi-token base together", () => {
    const parts: CompositePart[] = [
      { value: "div.list >> internal:role=row" },
      { relation: "and", value: TEXT },
    ];
    expect(roundTrip(parts)).toEqual(parts);
  });

  it("returns [] for a value nothing combined", () => {
    expect(decomposeLocator(ROW)).toEqual([]);
    expect(decomposeLocator("")).toEqual([]);
    // A plain recorded chain is not a combination — nobody chose a relation.
    expect(decomposeLocator("div >> internal:has-text=/^acme$/")).toEqual([]);
    expect(isCompositeSelector(ROW)).toBe(false);
    expect(
      isCompositeSelector(
        composeLocator({ parts: [{ value: ROW }, { relation: "and", value: TEXT }] }),
      ),
    ).toBe(true);
  });

  it("is not fooled by a >> inside a quoted engine body", () => {
    const inner = "div >> internal:has-text=/^acme$/";
    const parts = decomposeLocator(`${ROW} >> internal:and=${JSON.stringify(inner)}`);
    expect(parts).toEqual([{ value: ROW }, { relation: "and", value: inner }]);
  });

  it("returns [] rather than half a result when the body is not parseable", () => {
    expect(decomposeLocator(`${ROW} >> internal:and="unterminated`)).toEqual([]);
  });
});

// The defect the Task 0 spike caught, and the reason the relation is stored
// rather than assumed. `and` intersects RESULT SETS and runs the inner selector
// against the document root, so a bare filter engine on the right filters the
// document, matches nothing, and the intersection is empty — with no error.
describe("isBareFilterEngine", () => {
  it("flags every filter engine", () => {
    expect(isBareFilterEngine('internal:has-text="acme"')).toBe(true);
    expect(isBareFilterEngine('internal:has-not-text="acme"')).toBe(true);
    expect(isBareFilterEngine('internal:has="span"')).toBe(true);
    expect(isBareFilterEngine('internal:has-not="span"')).toBe(true);
  });

  it("leaves search engines and chains alone", () => {
    expect(isBareFilterEngine(TEXT)).toBe(false);
    expect(isBareFilterEngine(ROW)).toBe(false);
    expect(isBareFilterEngine('internal:role=button[name="Go"i]')).toBe(false);
    // A filter reached THROUGH a search engine is fine — the search engine
    // supplies the elements the filter then keeps or drops.
    expect(isBareFilterEngine("div >> internal:has-text=/^acme$/")).toBe(false);
  });
});

describe("canDefaultToAnd", () => {
  const recorded = [ROW, TEXT];

  // Playwright verifies each candidate against the target before storing it, so
  // every recorded candidate resolves to the same element by construction, and
  // intersecting two such sets gives that element.
  it("is true when every part came from the recording", () => {
    expect(canDefaultToAnd([{ value: ROW }, { value: TEXT }], recorded)).toBe(true);
  });

  it("is false as soon as an author-written locator joins in", () => {
    expect(canDefaultToAnd([{ value: ROW }, { value: "#hand-written" }], recorded)).toBe(false);
  });

  it("is false for no parts at all", () => {
    expect(canDefaultToAnd([], recorded)).toBe(false);
  });
});
