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

import { flushPromises } from "@vue/test-utils";
import { vi } from "vitest";
import { defineComponent, h } from "vue";

// Host specs load the assistant's parts as async modules, so each stub is an ES module with a default.
const esModule = <T>(component: T) => ({ __esModule: true, default: component });

export const aiEntryButtonStub = esModule(
  defineComponent({
    name: "AiEntryButton",
    props: ["pressed", "dataTest", "dockHost", "build", "appearance", "handoff", "label"],
    emits: ["closed"],
    setup:
      (props, { emit }) =>
      () =>
        h(
          "button",
          {
            "data-test": props.dataTest,
            "data-appearance": props.appearance,
            "data-dock-host": props.dockHost ?? "",
            "aria-pressed": String(!!props.pressed),
            onClick: () => (props.handoff ? props.handoff() : emit("closed")),
          },
          String(props.label ?? ""),
        ),
  }),
);

export const assistantDockStub = esModule(
  defineComponent({
    name: "AssistantDock",
    props: ["host", "anchorAbove"],
    setup: (props) => () =>
      h("div", { "data-test": "assistant-dock-stub", "data-host": props.host.id }),
  }),
);

export const aiLabelStub = esModule(
  defineComponent({
    name: "AiLabel",
    props: ["state"],
    emits: ["revert", "ask-again"],
    setup:
      (props, { emit }) =>
      () =>
        h("div", { "data-test": "ai-label-editor", "data-status": props.state.status }, [
          h("button", {
            "data-test": "ai-label-revert",
            onClick: () => emit("revert", "original"),
          }),
        ]),
  }),
);

export const diffBlockStub = esModule(
  defineComponent({
    name: "AssistantDiffBlock",
    props: ["proposal"],
    setup: (props) => () =>
      h("div", { "data-test": "assistant-diff-block", "data-proposal-id": props.proposal.id }, [
        h("button", {
          "data-test": "assistant-diff-accept",
          onClick: () => props.proposal.accept(),
        }),
        h("button", {
          "data-test": "assistant-diff-reject",
          onClick: () => props.proposal.reject(),
        }),
      ]),
  }),
);

/** Lets the async assistant parts resolve and render. */
export async function settleAsyncParts(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await vi.dynamicImportSettled();
    await flushPromises();
  }
}
