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

import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import StartWithSelect from "./StartWithSelect.vue";
import type { ChoiceAvailability } from "./createStarter.types";

const stubs = {
  OSelect: { template: "<div><slot name='trigger' /><slot /><slot name='after-options' /></div>" },
  OSelectItem: {
    props: ["value", "label", "disabled"],
    template:
      "<div data-test='option' :data-value='value' :data-disabled='disabled'>{{ label }}<slot /></div>",
  },
};

const render = (modelValue: string, ai: ChoiceAvailability) =>
  mount(StartWithSelect, {
    props: {
      modelValue: modelValue as never,
      label: "New alert opens with" as never,
      choices: [
        { value: "ai", label: "Create with AI" as never, state: ai },
        { value: "library", label: "Library" as never, state: "on" },
        { value: "form", label: "The form" as never, state: "on" },
      ],
      lastNow: "library",
      opensNow: "library",
    },
    global: { stubs },
  });

const options = (w: ReturnType<typeof render>) =>
  w
    .findAll("[data-test=option]")
    .map((o) => [o.attributes("data-value"), o.attributes("data-disabled")]);

describe("StartWithSelect", () => {
  it.each([
    ["a stored AI pick while AI is off", "ai", "hidden", true, ["library", "form", "last"]],
    [
      "a stored AI pick while AI is locked",
      "ai",
      "locked",
      true,
      ["ai", "library", "form", "last"],
    ],
    ["a stored pick that is on", "library", "on", false, ["ai", "library", "form", "last"]],
  ] as const)("%s", (_name, value, ai, paused, listed) => {
    const w = render(value, ai);
    expect(w.find("s").exists()).toBe(paused);
    const reason = w.find("[data-test=create-starter-start-with-paused]");
    expect(reason.exists()).toBe(paused);
    if (paused) expect(reason.text()).toContain("Library");
    expect(options(w).map(([v]) => v)).toEqual(listed);
    if (ai !== "hidden") {
      expect(options(w).find(([v]) => v === "ai")?.[1]).toBe(String(ai === "locked"));
    }
  });

  it("names what Whatever I used last opens now", () => {
    expect(
      render("last", "on").find("[data-test=create-starter-start-with-last-now]").text(),
    ).toContain("Library");
  });
});
