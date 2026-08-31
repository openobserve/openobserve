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

// Read-only config readout shown in the NDV while inspecting a run. Covered here is
// the DESTINATION branch, which resolves the node's stored destination NAME into the
// actual request — a bare name cannot explain a failed delivery.

import { mount, flushPromises } from "@vue/test-utils";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

// Mocked at the MODULE level, not stubbed at mount: importing the real editor pulls
// in the logs constants chain, which needs far more of the app than this spec does.
vi.mock("@/components/CodeQueryEditor.vue", () => ({
  default: { name: "CodeQueryEditor", template: "<div />" },
}));
vi.mock("@/services/workflows", () => ({ default: {} }));
vi.mock("@/services/jstransform", () => ({ default: { list: vi.fn().mockResolvedValue({}) } }));

const mockList = vi.fn();
vi.mock("@/services/alert_destination", () => ({
  default: { list: (...a: any[]) => mockList(...a) },
}));

import { workflowObj } from "@/plugins/workflows/useWorkflowCanvas";
import { resetWorkflowDestinations } from "@/plugins/workflows/useWorkflowDestinations";
import WorkflowConfigSummary from "./WorkflowConfigSummary.vue";

const CUSTOM = {
  name: "test",
  url: "https://api.example.com/hooks/o2",
  method: "post",
  destination_type_name: "custom",
  headers: { Authorization: "Bearer super-secret-token", "X-Env": "prod" },
  template: "alert_default",
  output_format: "json",
  skip_tls_verify: false,
};

const seedDestinationNode = (destination_id = "test") => {
  workflowObj.currentSelectedNodeData = {
    id: "d1",
    data: { node_type: "destination", destination_id },
  } as any;
};

function createWrapper() {
  return mount(WorkflowConfigSummary, {
    global: {
      plugins: [i18n, store],
      stubs: { WorkflowConfigHeader: { template: "<div />" } },
    },
  });
}

const card = (w: any) => w.find('[data-test="workflow-config-summary-destination"]');

describe("WorkflowConfigSummary — destination", () => {
  beforeEach(() => {
    resetWorkflowDestinations();
    workflowObj.currentSelectedNodeData = null;
    mockList.mockResolvedValue({ data: [CUSTOM] });
  });
  afterEach(() => vi.clearAllMocks());

  // ── Lookup ────────────────────────────────────────────────────────────────
  // There is no usable single-record endpoint: get_by_name omits `module` and 404s
  // on a pipeline destination. The list call is the only one that resolves them.

  it("resolves the destination through the pipeline-module list endpoint", async () => {
    seedDestinationNode();
    createWrapper();
    await flushPromises();
    expect(mockList).toHaveBeenCalledWith(expect.objectContaining({ module: "pipeline" }));
  });

  it("fetches once and reuses the cache across nodes", async () => {
    seedDestinationNode();
    createWrapper();
    await flushPromises();
    seedDestinationNode("test");
    createWrapper();
    await flushPromises();
    expect(mockList).toHaveBeenCalledTimes(1);
  });

  it("does not fetch for a placeholder node with no destination", async () => {
    seedDestinationNode("");
    const wrapper = createWrapper();
    await flushPromises();
    expect(mockList).not.toHaveBeenCalled();
    expect(card(wrapper).exists()).toBe(false);
    expect(wrapper.text()).toContain("No Configuration");
  });

  // ── The request ───────────────────────────────────────────────────────────

  it("renders the method and full URL — what a 404 is actually about", async () => {
    seedDestinationNode();
    const wrapper = createWrapper();
    await flushPromises();
    const url = wrapper.find('[data-test="workflow-config-summary-destination-url"]');
    expect(url.text()).toBe("https://api.example.com/hooks/o2");
    expect(card(wrapper).text()).toContain("POST"); // normalized to upper case
  });

  it("defaults the method to POST when the record has none", async () => {
    mockList.mockResolvedValue({ data: [{ ...CUSTOM, method: undefined }] });
    seedDestinationNode();
    const wrapper = createWrapper();
    await flushPromises();
    expect(card(wrapper).text()).toContain("POST");
  });

  it("lists header NAMES and never their values", async () => {
    seedDestinationNode();
    const wrapper = createWrapper();
    await flushPromises();
    const text = card(wrapper).text();
    expect(text).toContain("Authorization");
    expect(text).toContain("X-Env");
    expect(text).not.toContain("super-secret-token");
  });

  it("shows template and output format", async () => {
    seedDestinationNode();
    const wrapper = createWrapper();
    await flushPromises();
    const text = card(wrapper).text();
    expect(text).toContain("alert_default");
    expect(text).toContain("JSON");
  });

  it("accepts a template supplied as an object", async () => {
    mockList.mockResolvedValue({ data: [{ ...CUSTOM, template: { name: "obj_template" } }] });
    seedDestinationNode();
    const wrapper = createWrapper();
    await flushPromises();
    expect(card(wrapper).text()).toContain("obj_template");
  });

  // TLS is reported only as an exception — "verification on" is the norm and would
  // just be noise in the readout.
  it("omits the TLS row when verification is on", async () => {
    seedDestinationNode();
    const wrapper = createWrapper();
    await flushPromises();
    expect(card(wrapper).text()).not.toContain("TLS Verification");
  });

  it("shows the TLS row when verification is skipped", async () => {
    mockList.mockResolvedValue({ data: [{ ...CUSTOM, skip_tls_verify: true }] });
    seedDestinationNode();
    const wrapper = createWrapper();
    await flushPromises();
    const text = card(wrapper).text();
    expect(text).toContain("TLS Verification");
    expect(text).toContain("Disabled");
  });

  // ── Unsupported type ──────────────────────────────────────────────────────

  it("flags a destination whose type is not custom", async () => {
    mockList.mockResolvedValue({ data: [{ ...CUSTOM, destination_type_name: "splunk" }] });
    seedDestinationNode();
    const wrapper = createWrapper();
    await flushPromises();
    expect(
      wrapper.find('[data-test="workflow-config-summary-destination-unsupported"]').exists(),
    ).toBe(true);
  });

  it("does not flag a custom destination", async () => {
    seedDestinationNode();
    const wrapper = createWrapper();
    await flushPromises();
    expect(
      wrapper.find('[data-test="workflow-config-summary-destination-unsupported"]').exists(),
    ).toBe(false);
  });

  // ── Missing vs unknown ────────────────────────────────────────────────────
  // These two must not be conflated: claiming "no longer exists" because the lookup
  // itself failed is exactly the false report this panel is meant to prevent.

  it("reports a destination that is genuinely absent, keeping the name visible", async () => {
    mockList.mockResolvedValue({ data: [] });
    seedDestinationNode("deleted-one");
    const wrapper = createWrapper();
    await flushPromises();
    expect(wrapper.find('[data-test="workflow-config-summary-destination-missing"]').exists()).toBe(
      true,
    );
    expect(card(wrapper).text()).toContain("deleted-one");
  });

  it("does NOT claim the destination is gone when the lookup failed", async () => {
    mockList.mockRejectedValue({ response: { status: 500 } });
    seedDestinationNode();
    const wrapper = createWrapper();
    await flushPromises();
    expect(wrapper.find('[data-test="workflow-config-summary-destination-missing"]').exists()).toBe(
      false,
    );
    expect(card(wrapper).text()).toContain("test"); // name still shown
  });

  it("does not flag an unsupported type while the record is unknown", async () => {
    mockList.mockRejectedValue(new Error("boom"));
    seedDestinationNode();
    const wrapper = createWrapper();
    await flushPromises();
    expect(
      wrapper.find('[data-test="workflow-config-summary-destination-unsupported"]').exists(),
    ).toBe(false);
  });
});
