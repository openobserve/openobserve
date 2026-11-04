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

import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";

import OnCallConditionRows from "@/components/oncall/OnCallConditionRows.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import i18n from "@/locales";

const PREFIX = "rows";

function render() {
  return mount(OnCallConditionRows, {
    attachTo: document.body,
    props: {
      testPrefix: PREFIX,
      modelValue: { service: "checkout" },
      catalogue: { present: ["service"], values: { service: { checkout: 2, "risk-api": 1 } } },
    },
    global: { plugins: [i18n] },
  });
}

let wrapper: ReturnType<typeof render> | undefined;

afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  document.body.innerHTML = "";
});

const searchInput = () =>
  document.body.querySelector<HTMLInputElement>(`[data-test="${PREFIX}-value-0-search"] input`) ??
  document.body.querySelector<HTMLInputElement>(`input[data-test="${PREFIX}-value-0-search"]`);

async function typeAndEnter(w: NonNullable<typeof wrapper>, term: string) {
  await w.find(`[data-test="${PREFIX}-value-0-trigger"]`).trigger("click");
  await flushPromises();
  const input = searchInput()!;
  input.value = term;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await flushPromises();
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  await flushPromises();
}

const lastEmitted = (w: NonNullable<typeof wrapper>) =>
  w.emitted("update:modelValue")?.at(-1)?.[0] as Record<string, string> | undefined;

describe("OnCallConditionRows value picker", () => {
  it("creates a typed value once, then closes the list and clears the search", async () => {
    wrapper = render();
    await typeAndEnter(wrapper, "pt-new");

    expect(lastEmitted(wrapper)).toEqual({ service: "pt-new" });
    expect(searchInput()).toBeNull();

    await wrapper.find(`[data-test="${PREFIX}-value-0-trigger"]`).trigger("click");
    await flushPromises();
    expect(searchInput()!.value).toBe("");
    const select = wrapper
      .findAllComponents(OSelect)
      .find((c) => c.attributes("data-test") === `${PREFIX}-value-0`)!;
    const values = (select.props("options") as { value: string }[]).map((o) => o.value);
    expect(values.filter((value) => value === "pt-new")).toHaveLength(1);
  });

  it("selects the existing option on an exact typed match instead of creating it", async () => {
    wrapper = render();
    await typeAndEnter(wrapper, "risk-api");

    expect(lastEmitted(wrapper)).toEqual({ service: "risk-api" });
    expect(searchInput()).toBeNull();
  });
});
