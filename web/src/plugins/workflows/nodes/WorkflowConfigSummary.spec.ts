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

  // The backend omits `destination_type_name` when it was never set, so an untyped
  // pipeline destination is one the workflow runs fine — badging it "unsupported"
  // would contradict the server, which accepts any pipeline-module destination.
  it("does not flag an untyped destination", async () => {
    const { destination_type_name: _t, ...untyped } = CUSTOM;
    mockList.mockResolvedValue({ data: [untyped] });
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

// ── Branch ──────────────────────────────────────────────────────────────────
// A Branch's config IS its routing table. Without it the pane fell through to the
// trigger catch-all and rendered another node's title ("Alert Trigger").

const seedBranchNode = (cases: any[], else_handle = "else") => {
  workflowObj.currentSelectedNodeData = {
    id: "b1",
    data: { node_type: "branch", cases, else_handle },
  } as any;
};

const branchCard = (w: any) => w.find('[data-test="workflow-config-summary-branch"]');

describe("WorkflowConfigSummary — branch", () => {
  beforeEach(() => {
    resetWorkflowDestinations();
    workflowObj.currentSelectedNodeData = null;
    mockList.mockResolvedValue({ data: [] });
  });
  afterEach(() => vi.clearAllMocks());

  // The reported bug: a Branch rendered the literal text "Alert Trigger" — the
  // trigger catch-all's title, not this node's config.
  it("never renders the trigger title for a branch", async () => {
    seedBranchNode([
      {
        handle: "case-0",
        label: "Severe",
        conditions: { conditions: { and: [{ column: "n", operator: ">=", value: "1000" }] } },
      },
    ]);
    const wrapper = createWrapper();
    await flushPromises();
    expect(wrapper.text()).not.toContain("Alert Trigger");
    expect(wrapper.find('[data-test="workflow-config-summary-trigger"]').exists()).toBe(false);
  });

  it("lists every authored path label with its rule, plus the fallback", async () => {
    seedBranchNode([
      {
        handle: "case-0",
        label: "Severe (>=1000)",
        conditions: {
          conditions: { and: [{ column: "meta_alert_count", operator: ">=", value: "1000" }] },
        },
      },
      {
        handle: "case-1",
        label: "Moderate (>=200)",
        conditions: {
          conditions: { and: [{ column: "meta_alert_count", operator: ">=", value: "200" }] },
        },
      },
    ]);
    const wrapper = createWrapper();
    await flushPromises();
    const text = branchCard(wrapper).text();
    expect(text).toContain("Severe (>=1000)");
    expect(text).toContain("meta_alert_count >= '1000'");
    expect(text).toContain("Moderate (>=200)");
    expect(text).toContain("meta_alert_count >= '200'");
    expect(text).toContain("Everything Else");
  });

  // Handles are stable ids, not array positions: a deleted middle path leaves
  // case-0/case-2 behind. Numbering an unlabelled path off its handle would call
  // the SECOND surviving path "Path 3".
  it("numbers an unlabelled path by position among survivors, not by its handle", async () => {
    seedBranchNode([
      {
        handle: "case-0",
        conditions: { conditions: { and: [{ column: "a", operator: "=", value: "1" }] } },
      },
      {
        handle: "case-2",
        conditions: { conditions: { and: [{ column: "b", operator: "=", value: "2" }] } },
      },
    ]);
    const wrapper = createWrapper();
    await flushPromises();
    const text = branchCard(wrapper).text();
    expect(text).toContain("Path 1");
    expect(text).toContain("Path 2");
    expect(text).not.toContain("Path 3");
  });

  // First match wins, so the listed order is the evaluation order and must follow
  // the stored array, never the handle ids.
  it("keeps paths in stored evaluation order", async () => {
    seedBranchNode([
      {
        handle: "case-2",
        label: "Checked First",
        conditions: { conditions: { and: [{ column: "a", operator: "=", value: "1" }] } },
      },
      {
        handle: "case-0",
        label: "Checked Second",
        conditions: { conditions: { and: [{ column: "b", operator: "=", value: "2" }] } },
      },
    ]);
    const wrapper = createWrapper();
    await flushPromises();
    const text = branchCard(wrapper).text();
    expect(text.indexOf("Checked First")).toBeLessThan(text.indexOf("Checked Second"));
  });

  // A path whose rule was never finished still routes (its handle and edges are
  // live), so it must be listed — silently dropping it hides a real arm.
  it("lists a path whose rule is empty rather than dropping it", async () => {
    seedBranchNode([{ handle: "case-0", label: "Unfinished", conditions: { conditions: null } }]);
    const wrapper = createWrapper();
    await flushPromises();
    expect(branchCard(wrapper).text()).toContain("Unfinished");
  });

  it("falls back to the no-config notice for a branch with no paths", async () => {
    seedBranchNode([]);
    const wrapper = createWrapper();
    await flushPromises();
    expect(wrapper.text()).toContain("No Configuration");
  });
});

// ── Condition ───────────────────────────────────────────────────────────────
// The node persists { version, conditions }; the readout must unwrap that before
// previewing, or a fully configured rule reads as "No Configuration".

describe("WorkflowConfigSummary — condition", () => {
  beforeEach(() => {
    resetWorkflowDestinations();
    workflowObj.currentSelectedNodeData = null;
    mockList.mockResolvedValue({ data: [] });
  });
  afterEach(() => vi.clearAllMocks());

  it("previews a rule stored in the persisted { version, conditions } wrapper", async () => {
    workflowObj.currentSelectedNodeData = {
      id: "c1",
      data: {
        node_type: "condition",
        conditions: {
          version: 2,
          conditions: { and: [{ column: "severity", operator: ">=", value: "5" }] },
        },
      },
    } as any;
    const wrapper = createWrapper();
    await flushPromises();
    const text = wrapper.find('[data-test="workflow-config-summary-condition"]').text();
    expect(text).toContain("severity >= '5'");
  });

  it("still previews a rule stored unwrapped", async () => {
    workflowObj.currentSelectedNodeData = {
      id: "c2",
      data: {
        node_type: "condition",
        conditions: { and: [{ column: "env", operator: "=", value: "prod" }] },
      },
    } as any;
    const wrapper = createWrapper();
    await flushPromises();
    expect(wrapper.find('[data-test="workflow-config-summary-condition"]').text()).toContain(
      "env = 'prod'",
    );
  });

  it("shows the no-config notice for an unconfigured condition", async () => {
    workflowObj.currentSelectedNodeData = {
      id: "c3",
      data: { node_type: "condition", conditions: { version: 2, conditions: null } },
    } as any;
    const wrapper = createWrapper();
    await flushPromises();
    expect(wrapper.text()).toContain("No Configuration");
  });
});

// ── Trigger and unknown types ───────────────────────────────────────────────
// The trigger arm was the template's CATCH-ALL, so every type without an arm of
// its own rendered the trigger's title and claimed to be a node it is not.

describe("WorkflowConfigSummary — trigger and unknown types", () => {
  beforeEach(() => {
    resetWorkflowDestinations();
    workflowObj.currentSelectedNodeData = null;
    mockList.mockResolvedValue({ data: [] });
  });
  afterEach(() => vi.clearAllMocks());

  it("shows the trigger kind for an actual trigger node", async () => {
    workflowObj.currentSelectedNodeData = {
      id: "t1",
      data: { node_type: "workflow_trigger", trigger_kind: "alert_fired" },
    } as any;
    const wrapper = createWrapper();
    await flushPromises();
    expect(wrapper.find('[data-test="workflow-config-summary-trigger"]').text()).toBe(
      "Alert Trigger",
    );
  });

  it("never attributes the trigger title to a node of another type", async () => {
    workflowObj.currentSelectedNodeData = { id: "u1", data: { node_type: "future_type" } } as any;
    const wrapper = createWrapper();
    await flushPromises();
    expect(wrapper.text()).not.toContain("Alert Trigger");
    expect(wrapper.text()).toContain("No Configuration");
  });
});
