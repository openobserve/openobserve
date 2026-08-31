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

import OTag from "@/lib/core/Badge/OTag.vue";
import i18n from "@/locales";
import { raw } from "@/types/i18n";

import DbmQueryCell from "./DbmQueryCell.vue";

const mountCell = (props: Record<string, unknown> = {}, slot?: string) =>
  mount(DbmQueryCell, {
    props: { text: raw("SELECT * FROM orders"), ...props },
    slots: slot ? { default: slot } : {},
    global: { plugins: [i18n] },
  });

describe("DbmQueryCell", () => {
  /**
   * The statement TRUNCATES rather than wrapping: a three-line SQL row would
   * push the numbers beside it out of alignment and destroy the column scan.
   * The whole statement stays reachable through the title attribute.
   */
  it("truncates the statement and keeps the full text in the title", () => {
    const line = mountCell({ titleAttr: "SELECT * FROM orders WHERE id = $1" }).get("span");

    expect(line.classes()).toEqual(
      expect.arrayContaining(["text-text-code", "min-w-0", "truncate", "font-mono", "text-xs"]),
    );
    expect(line.attributes("title")).toBe("SELECT * FROM orders WHERE id = $1");
    expect(line.text()).toBe("SELECT * FROM orders");
  });

  /** A row whose statement never arrived states that, rather than showing a blank cell. */
  it("states an absent statement as an em dash", () => {
    expect(
      mountCell({ text: raw("") })
        .get("span")
        .text(),
    ).toBe("—");
  });

  /**
   * The engine tag is optional: the slowest-calls list can hold a call whose
   * system never arrived, and an empty tag there reads as a system named "".
   */
  it("shows the engine tag only when there is an engine", () => {
    expect(mountCell({ dbSystem: "postgresql" }).findComponent(OTag).props("value")).toBe(
      "postgresql",
    );
    expect(mountCell().findComponent(OTag).exists()).toBe(false);
  });

  /**
   * Each fact is preceded by a middot. The separator belongs to the item, so a
   * missing instance cannot leave a dangling "·" that reads as lost data.
   */
  it("separates the facts it has, and drops the ones it does not", () => {
    const wrapper = mountCell({
      metaItems: [
        { key: "instance", label: raw("orders-primary") },
        { key: "namespace", label: raw("") },
      ],
    });

    expect(wrapper.text()).toContain("orders-primary");
    expect(wrapper.text().match(/·/g)).toHaveLength(1);
  });

  /**
   * One fact is not neutral: an over-long transaction age is warning-toned in
   * place. Without a per-item class that cell would need its own component.
   */
  it("lets a single fact carry its own tone", () => {
    const wrapper = mountCell({
      metaItems: [{ key: "txnAge", label: raw("open 42m"), class: "text-status-warning-text" }],
    });

    expect(wrapper.get(".text-status-warning-text").text()).toBe("open 42m");
  });

  /** Pages that add their own chips after the facts append them through the slot. */
  it("appends the page's own chips after the facts", () => {
    expect(mountCell({}, '<span data-test="chip" />').find('[data-test="chip"]').exists()).toBe(
      true,
    );
  });
});
