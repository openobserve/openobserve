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

import { mount, flushPromises } from "@vue/test-utils";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import store from "@/test/unit/helpers/store";
import i18n from "@/locales";
import ImportPipeline from "@/components/pipeline/ImportPipeline.vue";

vi.mock("@/services/product_analytics", () => ({ default: { track: vi.fn() } }));

vi.mock("@/services/pipelines", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: {
      createPipeline: vi.fn(),
      getPipelineStreams: vi.fn(),
      getPipelines: vi.fn(),
    },
  });
});

vi.mock("@/services/alert_destination", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), { default: { list: vi.fn() } });
});

vi.mock("@/services/jstransform", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: { list: vi.fn(), create: vi.fn(), update: vi.fn() },
  });
});

vi.mock("@/composables/useStreams", () => ({
  default: () => ({ getStreams: vi.fn() }),
}));

vi.mock("@/composables/usePipelines", () => ({
  default: () => ({ getPipelineDestinations: vi.fn().mockResolvedValue([]) }),
}));

vi.mock("@/utils/zincutils", () => ({
  getImageURL: vi.fn((path: string) => `mocked-url/${path}`),
  getUUID: vi.fn(() => "uuid"),
  useLocalOrganization: vi.fn(() => null),
  useLocalCurrentUser: vi.fn(() => null),
  useLocalUserInfo: vi.fn(() => null),
  useLocalTimezone: vi.fn(() => null),
}));

vi.mock("vue-router", () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
  useRoute: () => ({ query: {} }),
}));

import pipelinesService from "@/services/pipelines";
import destinationService from "@/services/alert_destination";
import jstransform from "@/services/jstransform";

const leaf = { column: "level", operator: "=", value: "error" };

const pipelineWith = (conditions: any) => ({
  name: "p",
  org: "default",
  stream_name: "logs-stream",
  stream_type: "logs",
  source: {
    stream_name: "logs-stream",
    stream_type: "logs",
    source_type: "realtime",
    org_id: "default",
  },
  nodes: [{ id: "c1", io_type: "default", data: { node_type: "condition", conditions } }],
  edges: [],
});

describe("ImportPipeline.vue - condition shapes the backend accepts", () => {
  let wrapper: any;

  const conditionErrors = () =>
    wrapper.vm.pipelineErrorsToDisplay
      .flat()
      .filter((e: any) => e?.field === "condition_format")
      .map((e: any) => e.message);

  const postedConditionNode = () =>
    (vi.mocked(pipelinesService.createPipeline).mock.calls[0]?.[0] as any)?.data.nodes[0].data;

  beforeEach(async () => {
    vi.clearAllMocks();
    if (!document.getElementById("o2-page-actions")) {
      const target = document.createElement("div");
      target.id = "o2-page-actions";
      document.body.appendChild(target);
    }
    store.state.selectedOrganization = { identifier: "default", label: "Default" } as any;
    vi.mocked(pipelinesService.getPipelines).mockResolvedValue({ data: { list: [] } } as any);
    vi.mocked(pipelinesService.getPipelineStreams).mockResolvedValue({
      data: { list: [] },
    } as any);
    vi.mocked(pipelinesService.createPipeline).mockResolvedValue({ data: {} } as any);
    vi.mocked(destinationService.list).mockResolvedValue({ data: [] } as any);
    vi.mocked(jstransform.list).mockResolvedValue({ data: { list: [] } } as any);
    wrapper = mount(ImportPipeline, {
      props: { destinations: [], templates: [], alerts: [] },
      global: {
        plugins: [i18n, store],
        stubs: {
          BaseImport: {
            name: "BaseImport",
            template: '<div data-test="base-import"><slot name="output-content" /></div>',
            data: () => ({ isImportingLocal: false }),
            methods: { updateJsonArray: vi.fn() },
          },
          QueryEditor: { name: "QueryEditor", template: "<div />" },
        },
      },
    });
    await flushPromises();
  });

  afterEach(() => {
    wrapper?.unmount();
    document.getElementById("o2-page-actions")?.remove();
  });

  it.each([
    ["a bare v1 condition", leaf],
    ["a v1 frontend group", { label: "and", items: [leaf, { label: "or", items: [leaf] }] }],
    ["a top-level not", { not: leaf }],
    ["a nested not", { and: [leaf, { not: { or: [leaf] } }] }],
  ])("accepts %s", async (_name, conditions) => {
    await wrapper.vm.validatePipelineInputs(pipelineWith(conditions), 1);
    expect(conditionErrors()).toEqual([]);
  });

  it.each([
    ["an unknown object", { foo: "bar" }, "pipeline.importErrors.conditionFormatUnrecognized"],
    ["a string", "abc", "pipeline.importErrors.conditionFormatUnrecognized"],
    [
      "a not over an invalid condition",
      { not: { foo: "bar" } },
      "pipeline.importErrors.v1ConditionInvalid",
    ],
    [
      "a frontend group with an invalid item",
      { label: "and", items: [{ column: "level" }] },
      "pipeline.importErrors.v1ConditionInvalid",
    ],
  ])("rejects %s", async (_name, conditions, key) => {
    await wrapper.vm.validatePipelineInputs(pipelineWith(conditions), 1);
    expect(conditionErrors()).toEqual([i18n.global.t(key, { index: 1, nodeIndex: 0 })]);
  });

  it("sends a bare condition as a one-item v2 group", async () => {
    expect(await wrapper.vm.createPipeline(pipelineWith({ ...leaf }), 1)).toBe(true);
    expect(postedConditionNode()).toEqual({
      node_type: "condition",
      version: 2,
      conditions: {
        filterType: "group",
        logicalOperator: "AND",
        groupId: "uuid",
        conditions: [
          {
            filterType: "condition",
            column: "level",
            operator: "=",
            value: "error",
            values: [],
            logicalOperator: "AND",
            id: "uuid",
          },
        ],
      },
    });
  });

  it.each([
    ["a top-level not", { not: { and: [leaf] } }],
    ["a nested not", { or: [leaf, { not: leaf }] }],
  ])("sends %s as the original v1 shape without a version", async (_name, conditions) => {
    const raw = JSON.parse(JSON.stringify(conditions));
    expect(await wrapper.vm.createPipeline(pipelineWith(conditions), 1)).toBe(true);
    expect(postedConditionNode()).toEqual({ node_type: "condition", conditions: raw });
  });

  it("backfills an empty value on unary leaves in a raw v1 not tree", async () => {
    const conditions = { and: [leaf, { not: { column: "a", operator: "is_null" } }] };
    expect(await wrapper.vm.createPipeline(pipelineWith(conditions), 1)).toBe(true);
    expect(postedConditionNode().conditions).toEqual({
      and: [leaf, { not: { column: "a", operator: "is_null", value: "" } }],
    });
  });
});
