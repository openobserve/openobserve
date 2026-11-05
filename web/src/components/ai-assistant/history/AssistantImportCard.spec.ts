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
import { describe, expect, it, vi } from "vitest";

import type { ImportView } from "@/composables/assistant";

import AssistantImportCard from "./AssistantImportCard.vue";

vi.mock("@/components/ai-assistant/gate/AssistantAskAdminPopover.vue", () => ({
  default: {
    name: "AskAdminStub",
    template: '<button data-test="ask-admin">Ask an admin</button>',
  },
}));

const setup = (view: Partial<ImportView>) =>
  mount(AssistantImportCard, {
    props: { view: { state: "offer", count: 12, done: 0, failed: [], ...view }, org: "default" },
  });

const ids = (wrapper: ReturnType<typeof setup>) =>
  wrapper.findAll("button[data-test]").map((el) => el.attributes("data-test"));

describe("AssistantImportCard", () => {
  it("offers the move with Not now and Don't ask again", async () => {
    const wrapper = setup({});
    expect(wrapper.text()).toContain(
      "You have 12 chats saved in this browser. Move them to your account so they appear on every device?",
    );
    expect(ids(wrapper)).toEqual([
      "assistant-local-import-move",
      "assistant-local-import-not-now",
      "assistant-local-import-never",
    ]);
    await wrapper.get('[data-test="assistant-local-import-move"]').trigger("click");
    await wrapper.get('[data-test="assistant-local-import-not-now"]').trigger("click");
    expect(wrapper.emitted("move")).toHaveLength(1);
    expect(wrapper.emitted("dismiss")).toEqual([["not_now"]]);
  });

  it("shows progress while moving and no actions", () => {
    const wrapper = setup({ state: "moving", done: 4 });
    expect(wrapper.text()).toContain("Moving 4 of 12…");
    expect(wrapper.find('[data-test="assistant-local-import-progress"]').exists()).toBe(true);
    expect(ids(wrapper)).toEqual([]);
  });

  it("lists what failed with Retry and Download each, keeping them in the browser", async () => {
    const wrapper = setup({
      state: "partial",
      failed: [{ sid: "s3", id: 3, title: "Chat 3" }],
    });
    expect(wrapper.text()).toContain("1 chat couldn't be moved");
    expect(wrapper.get('[data-test="assistant-local-import-failed"]').text()).toContain("Chat 3");
    await wrapper.get('[data-test="assistant-local-import-download-one"]').trigger("click");
    expect(wrapper.emitted("download")).toEqual([["s3"]]);
  });

  it("shows the failed list when an offer turns partial in place", async () => {
    const wrapper = setup({});
    await wrapper.setProps({
      view: {
        state: "partial",
        count: 12,
        done: 11,
        failed: [{ sid: "s3", id: 3, title: "Chat 3" }],
      },
    });
    expect(wrapper.get('[data-test="assistant-local-import-failed"]').text()).toContain("Chat 3");
  });

  it("offers Download all and Dismiss without the server's import", async () => {
    const wrapper = setup({ state: "unavailable", count: 3 });
    expect(ids(wrapper)).toEqual([
      "assistant-local-import-download-all",
      "assistant-local-import-dismiss",
    ]);
    await wrapper.get('[data-test="assistant-local-import-dismiss"]').trigger("click");
    expect(wrapper.emitted("dismiss")).toEqual([["never"]]);
  });

  it("asks an admin on 403 and retries offline", () => {
    expect(setup({ state: "forbidden" }).find('[data-test="ask-admin"]').exists()).toBe(true);
    const offline = setup({ state: "offline" });
    expect(offline.text()).toContain("You're offline.");
    expect(ids(offline)).toEqual(["assistant-local-import-retry"]);
  });
});
