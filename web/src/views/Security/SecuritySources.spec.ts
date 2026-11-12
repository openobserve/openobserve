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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { ref, shallowRef } from "vue";
import store from "@/test/unit/helpers/store";
import { withQueryClient } from "@/test/unit/helpers/queryClient";
import analytics from "@/services/product_analytics";
import {
  authorOnly,
  grantAll,
  readOnly,
  sourceRow,
  triageOnly,
} from "./__fixtures__/securityFixtures";

const sources = vi.hoisted(() => ({
  include: vi.fn(),
  exclude: vi.fn(),
  load: vi.fn(),
  migrateIncludes: vi.fn(),
}));
const api = vi.hoisted(() => ({ attach: vi.fn(), detach: vi.fn(), plan: vi.fn() }));

const rowsRef = shallowRef<unknown[]>([]);
const noticesRef = ref<unknown[]>([]);

vi.mock("@/composables/security/useSecurityAccess", async () => {
  const f = await import("./__fixtures__/securityFixtures");
  return {
    useSecurityAccess: f.mockSecurityAccess,
    loadSecurityAccess: async () => ({ read: true, ...f.accessGrants }),
    isSecurityGated: () => false,
  };
});

vi.mock("@/composables/security/useSecuritySources", () => ({
  useSecuritySources: () => ({
    rows: rowsRef,
    notices: noticesRef,
    loading: ref(false),
    ...sources,
  }),
}));

vi.mock("@/services/product_analytics", () => ({ default: { track: vi.fn() } }));

vi.mock("@/services/securitySources.queries", () => ({
  attachPackMutation: () => ({ mutationFn: (vars: unknown) => api.attach(vars) }),
  attachPlanMutation: () => ({ mutationFn: (stream: string) => api.plan(stream) }),
  detachPackMutation: () => ({ mutationFn: (stream: string) => api.detach(stream) }),
}));

import SecuritySources from "./SecuritySources.vue";

const pack = (id: string) => ({ id, version: 2, label: id });

const setRows = () => {
  rowsRef.value = [
    {
      ...sourceRow("aws_cloudtrail"),
      state: "mapped",
      reason: "pack",
      source_type: "aws_cloudtrail",
      offered_pack: pack("aws_cloudtrail"),
      detach_pack: pack("aws_cloudtrail"),
      setting: { pack_id: "aws_cloudtrail", pack_version: 2 },
    },
    { ...sourceRow("okta_auth"), reason: "manual", offered_pack: pack("entity") },
    {
      ...sourceRow("linux_auth"),
      state: "not_mapped",
      reason: null,
      suggested: true,
      source_type: "linux_auth",
      verdict: {
        decision: "suggested",
        source_id: "linux_auth",
        label: "Linux authentication (sshd, sudo)",
        confidence: 0.6,
      },
      offered_pack: pack("entity"),
    },
    {
      ...sourceRow("security_app_logs"),
      state: "excluded",
      reason: null,
      included: false,
      source_type: "linux_auth",
      updated_by: "alice@acme.io",
      updated_at: 1_794_034_387_000_000,
      last_change: {
        at: 1_794_034_387_000_000,
        by: "alice@acme.io",
        summary: "included: classifier -> excluded",
      },
      offered_pack: pack("entity"),
    },
  ];
  noticesRef.value = [];
};

const entityPlan = {
  pack_id: "entity",
  pack_version: 2,
  pack_label: "Entity (user, IP, host)",
  ocsf_classes: [0],
  function_name: "ocsf_entity_v2_linux_auth",
  function_action: "create",
  pipeline_action: "extend",
  pipeline_id: "p1",
  pipeline_name: "linux-enrich",
  feeds: ["geoip"],
};

const confirmButton = () =>
  document.querySelector<HTMLButtonElement>('[data-test="security-sources-attach-confirm"]');

let wrapper: VueWrapper | null = null;

const mountView = async () => {
  wrapper = mount(SecuritySources, {
    global: { provide: { store }, plugins: [store, withQueryClient()] },
  });
  await flushPromises();
  return wrapper;
};

const rowOf = (w: VueWrapper, name: string) =>
  w.findAll("tr").find((tr) => tr.text().includes(name))!;

beforeEach(() => {
  grantAll();
  setRows();
  sources.load.mockResolvedValue(undefined);
  sources.migrateIncludes.mockResolvedValue(undefined);
  api.attach.mockResolvedValue({
    setting: { source_type: "linux_auth", pack_id: "entity" },
    pipeline_id: "p",
    pipeline_created: true,
  });
  api.detach.mockResolvedValue({ setting: null, skipped: null });
  api.plan.mockResolvedValue({ plan: entityPlan, dry_run: true });
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  vi.clearAllMocks();
});

describe("SecuritySources", () => {
  it("lists the server's rows with their mapping state", async () => {
    const w = await mountView();
    const table = w.find('[data-test="security-sources-table"]');
    expect(table.text()).toContain("aws_cloudtrail");
    expect(table.text()).toContain("okta_auth");
    expect(rowOf(w, "aws_cloudtrail").text()).toContain("Mapped aws_cloudtrail@2");
    expect(rowOf(w, "okta_auth").text()).toContain("Included (not mapped)");
    expect(rowOf(w, "linux_auth").text()).toContain("Suggested: Linux authentication (sshd, sudo)");
    expect(rowOf(w, "linux_auth").text()).toContain("(60%)");
    expect(rowOf(w, "security_app_logs").text()).toContain("Excluded by alice@acme.io on");
    expect(sources.load).toHaveBeenCalledWith("default");
  });

  it("shows the server's consistency notices", async () => {
    noticesRef.value = [{ code: "pipeline_disabled", stream: "aws_cloudtrail" }];
    const w = await mountView();
    expect(w.find('[data-test="security-sources-notices"]').text()).toContain(
      "aws_cloudtrail: the pipeline is disabled",
    );
  });

  it("includes a suggested stream when Include is clicked", async () => {
    const w = await mountView();
    await rowOf(w, "linux_auth").find('[data-test="security-sources-include"]').trigger("click");
    expect(sources.include).toHaveBeenCalledWith("linux_auth");
    await flushPromises();
    expect(analytics.track).toHaveBeenCalledWith("security_source_inclusion_changed", {
      included: true,
      view: "sources",
    });
  });

  it("previews the plan, attaches only on confirm, and reports it", async () => {
    const w = await mountView();
    await rowOf(w, "linux_auth").find('[data-test="security-sources-attach"]').trigger("click");
    await flushPromises();
    expect(api.plan).toHaveBeenCalledWith("linux_auth");
    expect(api.attach).not.toHaveBeenCalled();
    const text = document.body.textContent ?? "";
    expect(text).toContain("ocsf_entity_v2_linux_auth");
    expect(text).toContain("Base Event (0)");
    expect(text).toContain("linux-enrich");
    expect(text).toContain("geoip");
    confirmButton()!.click();
    await flushPromises();
    expect(api.attach).toHaveBeenCalledWith({
      stream: "linux_auth",
      packId: "entity",
      packVersion: 2,
    });
    expect(w.find('[data-test="security-sources-notices"]').text()).toContain("Attached entity@2.");
    expect(analytics.track).toHaveBeenCalledWith("security_source_pack_attached", {
      source_type: "linux_auth",
      kind: "entity",
      pipeline_created: true,
    });
  });

  it("records no attach when the attach is refused", async () => {
    api.attach.mockRejectedValue({ response: { status: 500, data: { message: "boom" } } });
    const w = await mountView();
    await rowOf(w, "linux_auth").find('[data-test="security-sources-attach"]').trigger("click");
    await flushPromises();
    confirmButton()!.click();
    await flushPromises();
    expect(w.find('[data-test="security-sources-notices"]').text()).toContain("boom");
    expect(analytics.track).not.toHaveBeenCalled();
  });

  it("writes nothing when the preview is cancelled", async () => {
    const w = await mountView();
    await rowOf(w, "linux_auth").find('[data-test="security-sources-attach"]').trigger("click");
    await flushPromises();
    const cancel = [...document.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "Cancel",
    );
    cancel!.click();
    await flushPromises();
    expect(api.attach).not.toHaveBeenCalled();
    expect(confirmButton()).toBeNull();
  });

  it("shows each pre-attach block the server refused with", async () => {
    api.plan.mockRejectedValue({
      response: {
        status: 409,
        data: {
          code: "blocked",
          message: "blocked",
          blocks: [{ code: "schema_missing_columns", columns: ["o2_ocsf_pack"] }],
        },
      },
    });
    const w = await mountView();
    await rowOf(w, "linux_auth").find('[data-test="security-sources-attach"]').trigger("click");
    await flushPromises();
    expect(w.find('[data-test="security-sources-notices"]').text()).toContain("o2_ocsf_pack");
  });

  it("shows the server's message for a refused attach", async () => {
    api.plan.mockRejectedValue({
      response: {
        status: 403,
        data: {
          code: "permission_denied",
          message: "You need permission to edit functions and pipelines for this stream.",
        },
      },
    });
    const w = await mountView();
    await rowOf(w, "linux_auth").find('[data-test="security-sources-attach"]').trigger("click");
    await flushPromises();
    expect(w.find('[data-test="security-sources-notices"]').text()).toContain(
      "You need permission to edit functions and pipelines",
    );
  });

  it("asks the server to detach a mapped stream", async () => {
    const w = await mountView();
    await rowOf(w, "aws_cloudtrail").find('[data-test="security-sources-detach"]').trigger("click");
    await flushPromises();
    expect(api.detach).toHaveBeenCalledWith("aws_cloudtrail");
    expect(w.find('[data-test="security-sources-notices"]').text()).toContain("Pack detached.");
    expect(analytics.track).toHaveBeenCalledWith("security_source_pack_detached", {
      source_type: "aws_cloudtrail",
      pipeline_skipped: false,
    });
  });

  it("says when detach left a pipeline that no longer belongs to the stream", async () => {
    api.detach.mockResolvedValue({
      setting: null,
      skipped: { pipeline_id: "p9", reason: "other_stream" },
    });
    const w = await mountView();
    await rowOf(w, "aws_cloudtrail").find('[data-test="security-sources-detach"]').trigger("click");
    await flushPromises();
    const text = w.find('[data-test="security-sources-notices"]').text();
    expect(text).toContain("p9");
    expect(text).toContain("it now reads another stream");
  });

  it("hides attach, detach and include controls without triage access", async () => {
    readOnly();
    const w = await mountView();
    expect(w.text()).toContain("aws_cloudtrail");
    expect(w.find('[data-test="security-sources-attach"]').exists()).toBe(false);
    expect(w.find('[data-test="security-sources-detach"]').exists()).toBe(false);
    expect(w.find('[data-test="security-sources-include"]').exists()).toBe(false);
    expect(w.find('[data-test="security-sources-exclude"]').exists()).toBe(false);
  });

  it("lets a triage-only analyst include but not attach, detach or exclude", async () => {
    triageOnly();
    const w = await mountView();
    expect(w.find('[data-test="security-sources-attach"]').exists()).toBe(false);
    expect(rowOf(w, "linux_auth").find('[data-test="security-sources-include"]').exists()).toBe(
      true,
    );
    expect(w.find('[data-test="security-sources-detach"]').exists()).toBe(false);
    expect(w.find('[data-test="security-sources-exclude"]').exists()).toBe(false);
  });

  it("lets a detection engineer attach a pack without detaching or excluding", async () => {
    authorOnly();
    const w = await mountView();
    await rowOf(w, "linux_auth").find('[data-test="security-sources-attach"]').trigger("click");
    await flushPromises();
    confirmButton()!.click();
    await flushPromises();
    expect(api.attach).toHaveBeenCalledWith(expect.objectContaining({ stream: "linux_auth" }));
    expect(w.find('[data-test="security-sources-detach"]').exists()).toBe(false);
    expect(w.find('[data-test="security-sources-exclude"]').exists()).toBe(false);
  });

  it("lets an admin detach and exclude a source", async () => {
    const w = await mountView();
    expect(rowOf(w, "aws_cloudtrail").find('[data-test="security-sources-detach"]').exists()).toBe(
      true,
    );
    expect(rowOf(w, "okta_auth").find('[data-test="security-sources-exclude"]').exists()).toBe(
      true,
    );
  });
});
