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
import { afterEach, describe, expect, it, vi } from "vitest";

import { queryClient } from "@/composables/query/queryClient";
import { streamKeys } from "@/services/stream.querykeys";
import stream from "@/services/stream";

import { fakeVuex } from "../__tests__/fakeAssistant";
import PromptSuggestions from "./PromptSuggestions.vue";

const schemaChip = '[data-test="assistant-prompt-suggestion-mapStreamSchema"]';

function mountWith(rows: { name: string; is_internal?: boolean }[]) {
  vi.spyOn(stream, "nameList").mockResolvedValue({ data: { list: rows } } as never);
  queryClient.setQueryData(streamKeys.nameList("default", "logs"), rows);
  return mount(PromptSuggestions, { global: { plugins: [fakeVuex()] } });
}

afterEach(() => {
  queryClient.clear();
  vi.restoreAllMocks();
});

describe("PromptSuggestions", () => {
  it("names this org's own first log stream in the schema suggestion, skipping internal ones", async () => {
    const wrapper = mountWith([{ name: "_rumdata", is_internal: true }, { name: "checkout" }]);
    await flushPromises();
    expect(wrapper.get(schemaChip).text()).toBe("Map the schema of `checkout`");
    await wrapper.get(schemaChip).trigger("click");
    expect(wrapper.emitted("select")?.[0]).toEqual(["Map the schema of `checkout`"]);
  });

  it("leaves the schema suggestion out for an org with no log stream of its own", async () => {
    const wrapper = mountWith([{ name: "_rumdata", is_internal: true }]);
    await flushPromises();
    expect(wrapper.find(schemaChip).exists()).toBe(false);
    expect(wrapper.text()).not.toContain("default");
  });
});
