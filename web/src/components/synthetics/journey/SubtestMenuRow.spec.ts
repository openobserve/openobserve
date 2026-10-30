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
import { mount } from "@vue/test-utils";
import { raw } from "@/types/i18n";
import SubtestMenuRow from "./SubtestMenuRow.vue";

const TITLE = '[data-test="synthetics-subtest-row-title"]';
const SUBTITLE = '[data-test="synthetics-subtest-row-subtitle"]';

function mountRow(props: Record<string, unknown> = {}) {
  return mount(SubtestMenuRow, {
    props: { title: raw("Login"), ...props },
    attrs: { "data-test": "row", "aria-label": 'Add "Login" as a subtest' },
  });
}

describe("SubtestMenuRow", () => {
  it("shows the title and subtitle, and emits select on click", async () => {
    const w = mountRow({ subtitle: raw("13 steps") });

    expect(w.get(TITLE).text()).toBe("Login");
    expect(w.get(SUBTITLE).text()).toBe("13 steps");
    await w.get("button").trigger("click");
    expect(w.emitted("select")).toHaveLength(1);
  });

  it("omits the subtitle line when there is none", () => {
    expect(mountRow().find(SUBTITLE).exists()).toBe(false);
  });

  it("passes data-test and aria-label through to the button", () => {
    const button = mountRow().get("button");

    expect(button.attributes("data-test")).toBe("row");
    expect(button.attributes("aria-label")).toBe('Add "Login" as a subtest');
  });

  it("colours its text while enabled and leaves a disabled row to the button's muted look", () => {
    const enabled = mountRow({ subtitle: raw("13 steps") });
    expect(enabled.get(TITLE).classes()).toContain("text-text-body");
    expect(enabled.get(SUBTITLE).classes()).toContain("text-text-secondary");

    const disabled = mountRow({ subtitle: raw("Can't be nested"), disabled: true });
    expect(disabled.get("button").attributes("disabled")).toBeDefined();
    expect(
      disabled
        .get(TITLE)
        .classes()
        .filter((c) => c.startsWith("text-text-")),
    ).toEqual([]);
    expect(
      disabled
        .get(SUBTITLE)
        .classes()
        .filter((c) => c.startsWith("text-text-")),
    ).toEqual([]);
  });

  it("marks itself busy while loading", () => {
    expect(mountRow({ loading: true }).get("button").attributes("aria-busy")).toBe("true");
  });
});
