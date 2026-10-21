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

import AssistantHistoryFooter, {
  type AssistantHistoryFooterProps,
} from "./AssistantHistoryFooter.vue";

const setup = (props: Partial<AssistantHistoryFooterProps> = {}) =>
  mount(AssistantHistoryFooter, {
    props: { mode: "server", hasRows: true, hasMore: false, ...props },
  });

describe("AssistantHistoryFooter", () => {
  it("offers Delete all chats, never Download all, in server mode", async () => {
    const wrapper = setup({ retentionDays: 90 });
    expect(wrapper.find('[data-test="assistant-history-download-all"]').exists()).toBe(false);
    const clear = wrapper.get('[data-test="assistant-history-clear-all"]');
    expect(clear.text()).toBe("Delete all chats");
    expect(clear.classes()).toContain("text-status-error-text");
    await clear.trigger("click");
    expect(wrapper.emitted("clear-all")).toHaveLength(1);
  });

  it("states the retention only at the end of the list", () => {
    expect(
      setup({ retentionDays: 90 }).get('[data-test="assistant-history-retention"]').text(),
    ).toBe("Chats are kept for 90 days");
    expect(setup().get('[data-test="assistant-history-retention"]').text()).toBe(
      "Chats are kept until you delete them",
    );
    expect(
      setup({ hasMore: true }).find('[data-test="assistant-history-retention"]').exists(),
    ).toBe(false);
  });

  it("offers Download all in local mode and nothing when the list is empty or read-only", async () => {
    const local = setup({ mode: "local" });
    await local.get('[data-test="assistant-history-download-all"]').trigger("click");
    expect(local.emitted("download-all")).toHaveLength(1);
    expect(local.find('[data-test="assistant-history-retention"]').exists()).toBe(false);
    const empty = setup({ hasRows: false });
    expect(empty.find('[data-test="assistant-history-clear-all"]').exists()).toBe(false);
    const readonly = setup({ readonly: true });
    expect(readonly.find('[data-test="assistant-history-clear-all"]').exists()).toBe(false);
  });
});
