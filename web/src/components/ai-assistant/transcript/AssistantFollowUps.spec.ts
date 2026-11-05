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
import { beforeEach, describe, expect, it, vi } from "vitest";

import { assistantTranscriptHostKey } from "@/composables/assistant/pure";

import AssistantFollowUps from "./AssistantFollowUps.vue";

const { stage } = vi.hoisted(() => ({ stage: vi.fn() }));
vi.mock("@/composables/assistant", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/composables/assistant")>()),
  useAssistantStore: () => ({ stage }),
}));

describe("AssistantFollowUps", () => {
  beforeEach(() => stage.mockClear());

  it("stages a follow-up and focuses the composer, never sends", async () => {
    const focusComposer = vi.fn();
    const wrapper = mount(AssistantFollowUps, {
      props: { sid: "s1", items: ["Show Redis errors by minute", "Which endpoints?"] },
      global: { provide: { [assistantTranscriptHostKey as symbol]: { focusComposer } } },
    });
    const rows = wrapper.findAll('[data-test="assistant-follow-up"]');
    expect(rows.map((row) => row.text())).toEqual([
      "Show Redis errors by minute",
      "Which endpoints?",
    ]);
    await rows[0].trigger("click");
    expect(stage).toHaveBeenCalledWith("s1", {
      text: "Show Redis errors by minute",
      mode: "replace",
    });
    expect(focusComposer).toHaveBeenCalled();
  });
});
