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

import { describe, expect, it, afterEach, vi } from "vitest";
import { mount } from "@vue/test-utils";
import i18n from "@/locales";

import PatternSelectionBar from "@/plugins/logs/patterns/PatternSelectionBar.vue";
import { ALERT_PREFILL_VERSION, type AlertPrefill } from "@/ts/interfaces/alertPrefill";

const CreateAlertActionStub = {
  name: "CreateAlertAction",
  props: ["source", "build", "disabledReason", "variant"],
  template: `<button class="create-alert-stub">create</button>`,
};

const stubs = {
  CreateAlertAction: CreateAlertActionStub,
  // `emits` declared so the stub does not ALSO attach a native click listener,
  // which would make every click fire the parent handler twice.
  OButton: {
    name: "OButton",
    emits: ["click"],
    template: `<button @click="$emit('click')"><slot /></button>`,
  },
};

const prefill = (): AlertPrefill => ({
  version: ALERT_PREFILL_VERSION,
  source: "patterns",
  sourceLabel: "k8s_logs",
  streamType: "logs",
  streamName: "k8s_logs",
  queryType: "sql",
  sql: "SELECT count(*) AS cnt FROM 'k8s_logs'",
  warnings: [],
});

const mountBar = (props: Record<string, unknown> = {}) =>
  mount(PatternSelectionBar, {
    props: { includedCount: 1, excludedCount: 0, build: vi.fn(prefill), ...props },
    global: { plugins: [i18n], stubs },
  });

let wrapper: ReturnType<typeof mount> | null = null;

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

describe("PatternSelectionBar", () => {
  it("stays hidden while nothing is selected", () => {
    wrapper = mountBar({ includedCount: 0, excludedCount: 0 });
    expect(wrapper.find('[data-test="pattern-selection-bar"]').exists()).toBe(false);
  });

  it("appears once something is selected", () => {
    wrapper = mountBar();
    expect(wrapper.find('[data-test="pattern-selection-bar"]').exists()).toBe(true);
  });

  it("appears for an exclude-only selection", () => {
    wrapper = mountBar({ includedCount: 0, excludedCount: 2 });
    expect(wrapper.find('[data-test="pattern-selection-bar"]').exists()).toBe(true);
  });

  it("summarises both counts", () => {
    wrapper = mountBar({ includedCount: 3, excludedCount: 2 });
    const summary = wrapper.find('[data-test="pattern-selection-summary"]').text();
    expect(summary).toContain("3");
    expect(summary).toContain("2");
  });

  it("emits clear when the clear button is pressed", async () => {
    wrapper = mountBar();
    await wrapper.find('[data-test="pattern-selection-clear"]').trigger("click");
    expect(wrapper.emitted("clear")).toHaveLength(1);
  });

  it("delegates alert creation to the shared action, under the patterns source", () => {
    wrapper = mountBar();
    const action = wrapper.findComponent(CreateAlertActionStub);
    expect(action.props("source")).toBe("patterns");
    expect(action.props("variant")).toBe("button");
  });

  it("passes the disabled reason through rather than hiding the action", () => {
    wrapper = mountBar({ disabledReason: "Select at least one pattern" });
    expect(wrapper.findComponent(CreateAlertActionStub).props("disabledReason")).toBe(
      "Select at least one pattern",
    );
  });

  it("does not build a prefill just to render", () => {
    const build = vi.fn(prefill);
    wrapper = mountBar({ build });
    expect(build).not.toHaveBeenCalled();
  });
});
