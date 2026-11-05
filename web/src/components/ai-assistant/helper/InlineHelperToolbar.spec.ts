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

import { shallowMount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import AiEntryButton from "@/components/ai-assistant/entry/AiEntryButton.vue";
import { raw } from "@/types/i18n";

import InlineHelperToolbar from "./InlineHelperToolbar.vue";

const base = { label: null, dockOpen: false, blocked: null, status: raw("") };

function doorProps(props: Record<string, unknown>) {
  const wrapper = shallowMount(InlineHelperToolbar, { props: { ...base, ...props } });
  return wrapper.findComponent(AiEntryButton).props();
}

describe("InlineHelperToolbar", () => {
  it("names the door by what the editor holds: a function, or a query", () => {
    expect(String(doorProps({ hostId: "function" }).label)).toBe("Generate function");
    expect(String(doorProps({ hostId: "function" }).tooltip)).toBe(
      "Ask the assistant to write or change this function",
    );
    expect(String(doorProps({ hostId: "logs" }).label)).toBe("Generate query");
    expect(String(doorProps({ hostId: "alert_query" }).label)).toBe("Generate query");
  });

  it("drops the door's label below md only beside the editor, where the row is narrow", () => {
    expect(doorProps({ hostId: "logs", inline: true }).narrowIconOnly).toBe(true);
    expect(doorProps({ hostId: "logs" }).narrowIconOnly).toBe(false);
  });
});
