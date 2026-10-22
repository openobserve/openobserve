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

import { afterEach, describe, expect, it } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import OFieldList from "./OFieldList.vue";

const FIELDS = [
  { name: "Pages", isGroup: true, groupName: "Pages" },
  { name: "/a" },
  { name: "/b" },
];

describe("OFieldList keyboard", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
  });

  const rows = () => wrapper.findAll(".o-field-list__row");

  it("leaves rows out of the tab order unless the list is a picker", () => {
    wrapper = mount(OFieldList, { props: { fields: FIELDS } });
    expect(rows()[0].attributes("tabindex")).toBeUndefined();
    rows()[0].element.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(wrapper.emitted("row-click")).toBeUndefined();
  });

  it("picks a focused row with Enter or Space", async () => {
    wrapper = mount(OFieldList, { props: { fields: FIELDS, keyboard: true } });
    expect(rows()[0].attributes("tabindex")).toBe("0");
    await rows()[0].trigger("keydown", { key: "Enter" });
    await rows()[1].trigger("keydown", { key: " " });
    const picked = wrapper.emitted("row-click")?.map((args) => (args[0] as { name: string }).name);
    expect(picked).toEqual(["/a", "/b"]);
  });

  it("moves focus between rows with the arrow keys", async () => {
    wrapper = mount(OFieldList, {
      props: { fields: FIELDS, keyboard: true },
      attachTo: document.body,
    });
    (rows()[0].element as HTMLElement).focus();
    await rows()[0].trigger("keydown", { key: "ArrowDown" });
    expect(document.activeElement).toBe(rows()[1].element);
    await rows()[1].trigger("keydown", { key: "ArrowUp" });
    expect(document.activeElement).toBe(rows()[0].element);
  });
});
