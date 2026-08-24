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

/**
 * "If I change org on query details and the query doesn't exist, it shows me a
 * blank page."
 *
 * The org switch re-pushes this route with a new `org_identifier` and no other
 * query params, so the page keeps rendering while the fingerprint that gave it
 * a subject is gone. `load()` refuses to fetch without one, so nothing ever
 * arrived and nothing ever explained why — header chrome over empty panels.
 *
 * Two halves are pinned here: the STATE machine that tells the four cases
 * apart (a unit, because that is where the decision lives), and the page's
 * WIRING of it — that a not-found page renders the empty state and, crucially,
 * suppresses the panels it would otherwise paint blank.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import messages from "@/locales/languages/en-US.json";
import { dbmQueryDetailPresence } from "@/utils/dbm/queryDetailPresence";

const here = dirname(fileURLToPath(import.meta.url));
const page = readFileSync(join(here, "QueryDetailPage.vue"), "utf8");
const template = page.slice(0, page.indexOf("<script setup"));

/** The defaults of a page that has just been handed a fingerprint. */
const state = (over: Partial<Parameters<typeof dbmQueryDetailPresence>[0]> = {}) =>
  dbmQueryDetailPresence({
    fingerprint: "abc123",
    loading: false,
    settled: true,
    hasClientRow: false,
    hasServerRow: false,
    ...over,
  });

/** The page's own gate, mirrored: only `missing` blanks the body. */
const hasQuery = (p: ReturnType<typeof dbmQueryDetailPresence>): boolean => p !== "missing";

describe("the page knows when it has no query to be about", () => {
  /**
   * THE reported case. The org switch drops the fingerprint, so there is no
   * read to wait for — reporting `loading` here spins forever, which is the
   * blank page wearing a spinner.
   */
  it("calls a fingerprint-less page missing, not loading", () => {
    expect(state({ fingerprint: "", loading: true, settled: false })).toBe("missing");
  });

  /** The other half of the switch: a fingerprint the NEW org has never run. */
  it("calls an answered, unmatched fingerprint notFound", () => {
    expect(state()).toBe("notFound");
  });

  /**
   * Not-found may only be claimed once a read has ANSWERED. Before that the
   * two are indistinguishable, and an empty state that flashed over a query
   * about to arrive is its own bug.
   */
  it("waits for the read rather than claiming the query is absent", () => {
    expect(state({ loading: true })).toBe("loading");
    expect(state({ settled: false })).toBe("loading");
  });

  /**
   * Either vantage answering is enough. A fleet with no traced traffic is
   * served entirely by the database's own row, and calling that not-found
   * would hide a page that works.
   */
  it("is present when either vantage has the row", () => {
    expect(state({ hasClientRow: true })).toBe("present");
    expect(state({ hasServerRow: true })).toBe("present");
    // Even mid-flight: something is already paintable.
    expect(state({ hasServerRow: true, loading: true, settled: false })).toBe("present");
  });
});

describe("the page renders that state instead of a blank body", () => {
  it("renders an empty state for the not-found case", () => {
    expect(
      template,
      "a query this org does not have must SAY so, not paint empty panels",
    ).toContain('data-test="dbm-detail-not-found"');
  });

  /**
   * The empty state is worth nothing if the blank panels render underneath it.
   * The identity block and the tab strip are what made the page look broken,
   * so both must be gated on actually having a query.
   */
  it("suppresses the identity block and the tabs when there is no query", () => {
    const gated = (dataTest: string): string => {
      const index = template.indexOf(`data-test="${dataTest}"`);
      expect(index, `the template must render ${dataTest}`).toBeGreaterThan(-1);
      // The opening tag this marker belongs to.
      const open = template.lastIndexOf("<", index);
      return template.slice(open, index);
    };
    for (const marker of ["dbm-detail-identity", "dbm-detail-tabs"]) {
      // The POLARITY is the assertion, not the mere mention: `v-if="!hasQuery"`
      // on the identity block would satisfy a bare `toContain("hasQuery")`
      // while rendering the panels in exactly the case they must not.
      expect(gated(marker), `${marker} must not paint when the query is absent`).toMatch(
        /v-if="hasQuery"/,
      );
    }

    // And the empty state is gated the other way, or the two would both paint.
    const emptyIndex = template.indexOf('data-test="dbm-detail-not-found"');
    const emptyTag = template.slice(template.lastIndexOf("<", emptyIndex), emptyIndex);
    expect(emptyTag, "the empty state must paint only when there is no query").toMatch(
      /v-if="!hasQuery"/,
    );
  });

  /**
   * The way out. A reader stranded on a query their new org does not have
   * needs the list, and the back affordance in the header is easy to miss on a
   * page that is otherwise empty.
   */
  it("offers a route back to the queries list", () => {
    const start = template.indexOf('data-test="dbm-detail-not-found"');
    const block = template.slice(template.lastIndexOf("<", start), template.indexOf(">", start));
    // A LABELLED affordance wired to a handler. `toContain("action")` would be
    // satisfied by `action-icon` alone — a decorated button that does nothing.
    expect(block, "the empty state needs a labelled way out").toMatch(/:action-label="/);
    expect(block, "and that action must be wired to a handler").toMatch(/@action="/);
  });
});

/**
 * REGRESSION. The first cut of this gate blanked the body for `notFound` too,
 * and took the tab strip with it — so a detail page opened with a `?system=`
 * that disagreed with the engine that ran the statement lost the plans and
 * counters it still had, and every route to them.
 *
 * `notFound` means the SCOPED row lookup missed, not that the page has nothing:
 * `loadQueryInsights` is keyed on the fingerprint alone.
 */
describe("a named query that missed its scope keeps the page", () => {
  it("only `missing` blanks the body", () => {
    expect(hasQuery("missing"), "no fingerprint means no subject — blank it").toBe(false);
    expect(
      hasQuery("notFound"),
      "REGRESSION: a named query that missed its scope must keep its content",
    ).toBe(true);
    expect(hasQuery("loading")).toBe(true);
    expect(hasQuery("present")).toBe(true);
  });

  it("keeps the tab strip up when the scoped lookup missed", () => {
    // The strip is gated on `hasQuery`, so this holds only while `notFound`
    // stays truthy there — the exact thing the first cut got wrong.
    const index = template.indexOf('data-test="dbm-detail-tabs"');
    expect(index, "the template must render the tab strip").toBeGreaterThan(-1);
    const open = template.slice(template.lastIndexOf("<", index), index);
    expect(open, "the strip must not be gated on anything stricter").toMatch(/v-if="hasQuery"/);
    expect(hasQuery("notFound")).toBe(true);
  });

  it("says so inline instead of replacing the page", () => {
    expect(template, "a scope miss needs a note the reader can act on").toContain(
      'data-test="dbm-detail-scope-missed"',
    );
    const noteAt = template.indexOf('data-test="dbm-detail-scope-missed"');
    const noteTag = template.slice(template.lastIndexOf("<", noteAt), noteAt);
    expect(noteTag, "the note belongs to the scope-miss state").toMatch(/v-if="scopeMissedQuery"/);
    // And the hero empty state must NOT also fire, or both would paint.
    const heroAt = template.indexOf('data-test="dbm-detail-not-found"');
    const heroTag = template.slice(template.lastIndexOf("<", heroAt), heroAt);
    expect(heroTag, "the hero state is for a missing subject only").toMatch(/v-if="!hasQuery"/);
  });

  it("has copy telling the reader the scope is what to change", () => {
    const copy = messages.dbm.detail.notFound as Record<string, string>;
    expect(copy.scopeHint, "the scope-miss note needs a hint").toBeTruthy();
  });
});

describe("the copy explains the organization, not a broken page", () => {
  const copy = messages.dbm.detail.notFound as Record<string, string>;

  it("has a title and a description", () => {
    expect(copy.title, "the not-found state needs a title").toBeTruthy();
    expect(copy.description).toBeTruthy();
    expect(copy.action).toBeTruthy();
  });

  /**
   * The sentence has to name the reason a reader actually hit this — they
   * changed organization — or it reads as an outage.
   */
  it("names the organization as the reason", () => {
    expect(`${copy.title} ${copy.description}`.toLowerCase()).toContain("organization");
  });
});
