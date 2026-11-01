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

import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import { queryClient } from "@/composables/query/queryClient";
import { trackAssistant } from "@/services/assistantAnalytics";
import { alertKeys } from "@/services/alerts.querykeys";
import { dashboardKeys } from "@/services/dashboards.querykeys";
import { pipelineKeys } from "@/services/pipelines.querykeys";
import { streamKeys } from "@/services/stream.querykeys";

import AssistantAddContextMenu from "./AssistantAddContextMenu.vue";

vi.mock("@/services/assistantAnalytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/assistantAnalytics")>()),
  trackAssistant: vi.fn(),
}));

enableAutoUnmount(afterEach);

const ORG = "acme";

function seed(): void {
  queryClient.clear();
  queryClient.setQueryData(streamKeys.nameList(ORG, "logs"), [{ name: "checkout" }]);
  queryClient.setQueryData(streamKeys.nameList(ORG, "metrics"), []);
  queryClient.setQueryData(streamKeys.nameList(ORG, "traces"), []);
  queryClient.setQueryData(alertKeys.list(ORG, "default", undefined, undefined), []);
  queryClient.setQueryData(pipelineKeys.list(ORG), []);
  queryClient.setQueryData(dashboardKeys.byFolder(ORG, "default"), []);
}

async function openMenu() {
  seed();
  const wrapper = mount(AssistantAddContextMenu, { props: { org: ORG }, attachTo: document.body });
  await wrapper.get('[data-test="assistant-add-context"]').trigger("click");
  await flushPromises();
  const search = () =>
    document.body.querySelector<HTMLInputElement>(
      '[data-test="assistant-add-context-search"] input',
    )!;
  return { wrapper, search };
}

describe("AssistantAddContextMenu", () => {
  it("is one Add context button that opens with the search focused and counts the look", async () => {
    const { wrapper, search } = await openMenu();
    expect(wrapper.get('[data-test="assistant-add-context"]').attributes("aria-label")).toBe(
      "Add context",
    );
    expect(document.activeElement).toBe(search());
    expect(search().getAttribute("aria-controls")).toMatch(/^assistant-add-context-/);
    expect(trackAssistant).toHaveBeenCalledWith("ai_context_inspected", { target: "add_context" });
  });

  it("filters from the search and picks the active row with Enter, closing the menu", async () => {
    const { wrapper, search } = await openMenu();
    search().value = "check";
    search().dispatchEvent(new Event("input"));
    await flushPromises();
    search().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await flushPromises();
    expect(wrapper.emitted("select")?.[0]?.[0]).toMatchObject({ kind: "stream" });
    expect(wrapper.vm.isOpen()).toBe(false);
  });

  it("hands the Image row to the composer's file picker", async () => {
    const { wrapper } = await openMenu();
    document.body.querySelector<HTMLElement>('[data-test="assistant-mention-image"]')!.click();
    await flushPromises();
    expect(wrapper.emitted("image")).toHaveLength(1);
    expect(wrapper.emitted("select")).toBeUndefined();
  });

  it("says why there is no mic while dictation is off", async () => {
    await openMenu();
    expect(
      document.body.querySelector('[data-test="assistant-composer-hint-voice"]')?.textContent,
    ).toContain("Voice dictation is off in this browser.");
  });
});
