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

import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import { raw } from "@/types/i18n";

import DbmStateNote from "./DbmStateNote.vue";

const mountNote = (props: Record<string, unknown> = {}) =>
  mount(DbmStateNote, { props: { title: raw("No server match"), ...props } });

describe("DbmStateNote", () => {
  /** What happened, then what it means — in that order and in that weight. */
  it("reads as a headline over a quieter hint", () => {
    const wrapper = mountNote({ hint: raw("The server saw no counterpart.") });
    const spans = wrapper.findAll("span");

    expect(spans).toHaveLength(2);
    expect(spans[0].text()).toBe("No server match");
    expect(spans[0].classes()).toEqual(expect.arrayContaining(["text-text-secondary", "text-sm"]));
    expect(spans[1].text()).toBe("The server saw no counterpart.");
    expect(spans[1].classes()).toEqual(expect.arrayContaining(["text-text-muted", "text-xs"]));
  });

  /** Not every state has a second sentence, and none gets an empty line. */
  it("renders the headline alone when there is no hint", () => {
    const wrapper = mountNote();
    expect(wrapper.findAll("span")).toHaveLength(1);
    expect(wrapper.text()).toBe("No server match");
  });

  /**
   * MUTED, never error styling — at every site. Five of the six states this
   * covers are ordinary outcomes: the server legitimately sees statements no
   * instrumented client issued, and the database cannot EXPLAIN a `COMMIT`.
   * Colouring them as failures sends a reader to fix something that is not
   * broken, which is the misdiagnosis this component exists to prevent.
   */
  it("never styles a state as an error", () => {
    const html = mountNote({ hint: raw("hint") }).html();
    for (const banned of ["text-negative", "text-error", "text-status-error"]) {
      expect(html).not.toContain(banned);
    }
  });

  /**
   * `inline` tucks the note under a card's heading, which has already paid for
   * the top padding; `centered` fills a card that has no other content, so the
   * note carries the whole card's height itself.
   */
  it.each([
    ["inline", "flex flex-col gap-1 px-3 pb-3"],
    ["centered", "flex flex-col gap-1 p-6 text-center"],
  ])("places the note for placement=%s", (placement, expected) => {
    expect(mountNote({ placement }).attributes("class")).toBe(expected);
  });

  /** Under a heading is the common case, so it is what an unqualified note gets. */
  it("defaults to sitting under a card heading", () => {
    expect(mountNote().attributes("class")).toBe("flex flex-col gap-1 px-3 pb-3");
  });

  /** Each state is found by its own `data-test`, so it must reach the element. */
  it("passes the caller's data-test through", () => {
    expect(
      mountNote({ "data-test": "dbm-detail-server-metrics-unmatched" }).attributes("data-test"),
    ).toBe("dbm-detail-server-metrics-unmatched");
  });
});
