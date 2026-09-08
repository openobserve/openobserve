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

// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";

const list = vi.fn();
vi.mock("@/services/llm-experiments.service", () => ({
  default: { list: (...a: any[]) => list(...a) },
}));

import ExperimentComparePickerDialog from "./ExperimentComparePickerDialog.vue";

const stubs = {
  ODialog: { props: ["open"], template: '<section v-if="open"><slot /></section>' },
  OForm: { template: "<form><slot /></form>" },
  OFormSelect: {
    props: ["options", "loading"],
    template:
      '<select v-bind="$attrs" :data-options="options.map((o) => o.value).join(\',\')"></select>',
  },
};

function mountDialog(props: Record<string, unknown> = {}) {
  return mount(ExperimentComparePickerDialog, {
    props: {
      open: true,
      orgId: "acme",
      experimentId: "current",
      datasetId: "dataset-a",
      ...props,
    },
    global: { stubs },
  });
}

beforeEach(() => {
  list.mockReset();
  list.mockResolvedValue([
    { id: "current", name: "this run", datasetId: "dataset-a" },
    { id: "peer", name: "older run", datasetId: "dataset-a" },
    { id: "elsewhere", name: "other dataset", datasetId: "dataset-b" },
  ]);
});

describe("ExperimentComparePickerDialog", () => {
  it("offers only same-dataset runs, never the one being viewed", async () => {
    const wrapper = mountDialog();
    await flushPromises();

    // The server refuses a cross-dataset compare, and a run cannot be its own
    // baseline — so neither is offered.
    expect(
      wrapper.get('[data-test="ai-experiment-compare-picker-select"]').attributes("data-options"),
    ).toBe("peer");
  });

  it("says so when the dataset has no other run to compare against", async () => {
    list.mockResolvedValue([{ id: "current", name: "this run", datasetId: "dataset-a" }]);
    const wrapper = mountDialog();
    await flushPromises();

    expect(wrapper.find('[data-test="ai-experiment-compare-picker-empty"]').exists()).toBe(true);
  });

  it("refuses to submit without a baseline", async () => {
    const wrapper = mountDialog();
    await flushPromises();

    await (wrapper.vm as any).form.handleSubmit();
    await flushPromises();

    expect(wrapper.emitted("compare")).toBeUndefined();
  });

  it("hands the chosen baseline back and closes", async () => {
    const wrapper = mountDialog();
    await flushPromises();

    const form = (wrapper.vm as any).form;
    form.setFieldValue("baselineId", "peer");
    await form.handleSubmit();
    await flushPromises();

    expect(wrapper.emitted("compare")?.[0]).toEqual(["peer"]);
    expect(wrapper.emitted("update:open")?.at(-1)).toEqual([false]);
  });
});
