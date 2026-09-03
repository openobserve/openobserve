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
//
// @vitest-environment jsdom
//
// Fullscreen belongs to the pane that holds Input AND Output, so the box only
// reports the intent and mirrors the state it is told about — it must not open
// anything of its own.

import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";

vi.mock("@/types/i18n", async (importOriginal) => {
  const actual: any = await importOriginal();
  return { ...actual, useI18nTyped: () => ({ t: (key: string) => key }) };
});

vi.mock("@/plugins/traces/LLMContentRenderer.vue", () => ({
  default: { name: "LLMContentRenderer", props: ["content"], template: `<div class="llm" />` },
}));

import ReviewContentBox from "./ReviewContentBox.vue";

function mountBox(props: Record<string, unknown> = {}) {
  return mount(ReviewContentBox, {
    props: {
      label: "Input",
      content: "hello",
      contentType: "input",
      instanceId: "item-1-input",
      ...props,
    } as any,
  });
}

describe("ReviewContentBox", () => {
  it("reports the fullscreen intent instead of opening its own overlay", async () => {
    const wrapper = mountBox();

    await wrapper.find('[data-test="ai-review-content-expand-input"]').trigger("click");

    expect(wrapper.emitted("toggle-fullscreen")).toHaveLength(1);
    expect(wrapper.html()).not.toContain('role="dialog"');
  });

  it("flips the control to exit when the pane it belongs to is fullscreen", () => {
    const normal = mountBox();
    expect(normal.find('[data-test="ai-review-content-expand-input"]').attributes("title")).toBe(
      "aiObservability.queues.workbench.enterFullscreen",
    );

    const expanded = mountBox({ fullscreen: true });
    expect(expanded.find('[data-test="ai-review-content-expand-input"]').attributes("title")).toBe(
      "aiObservability.queues.workbench.exitFullscreen",
    );
  });
});
