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

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import fleet from "@/services/fleet";
import { queryClient } from "@/composables/query/queryClient";
import OForm from "@/lib/forms/Form/OForm.vue";
import FleetNewRolloutDialog from "./FleetNewRolloutDialog.vue";
import { apiFleet, apiRollout, NO_OVERRIDES } from "./fleet.fixtures";
import { requestOf, type RolloutForm } from "./FleetNewRolloutDialog.schema";

const { toastMock } = vi.hoisted(() => ({ toastMock: vi.fn() }));

vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: toastMock }));

vi.mock("@/aws-exports", async (importOriginal) => {
  const actual: any = await importOriginal();
  return { default: { ...actual.default, isEnterprise: "false", isCloud: "false" } };
});

vi.mock("@/services/fleet", () => ({
  default: {
    listConfigs: vi.fn(),
    listFleets: vi.fn(),
    listRollouts: vi.fn(),
    getSettings: vi.fn(),
    setDesired: vi.fn(),
    previewDesired: vi.fn(),
  },
}));

const config = (id: string, latest: number) => ({
  id,
  description: "",
  latest_version: latest,
  live_version: null,
  collectors: 0,
  fleets: [],
  updated_at: 1,
  updated_by: "ana@acme.io",
});

const fleetOf = (id: string, collectors: number, desired: [string, number] | null = null) =>
  apiFleet({
    id,
    name: `${id}-name`,
    state: {
      desired: desired ? { config: desired[0], version: desired[1] } : null,
      stable: null,
      rollout: null,
      collectors,
      online: collectors,
      at_desired: 0,
    },
    settings: id === "one" ? { ...NO_OVERRIDES, phase_timeout_secs: 600 } : NO_OVERRIDES,
  });

const ODialogStub = {
  name: "ODialog",
  props: ["open", "title", "formId", "primaryButtonLabel", "primaryButtonDisabled"],
  template: `<div v-if="open" data-test="fleet-new-rollout-dialog"><slot /></div>`,
};

function mountDialog(props: Record<string, unknown> = {}) {
  return mount(FleetNewRolloutDialog, {
    attachTo: document.body,
    props: { open: true, ...props },
    global: { plugins: [i18n, store], stubs: { ODialog: ODialogStub } },
  });
}

const org = () => store.state.selectedOrganization.identifier;
const form = (w: VueWrapper) => (w.findComponent(OForm).vm as any).form;

// The preview waits for a pause in typing before it asks the server.
const settlePreview = async () => {
  await flushPromises();
  await new Promise((r) => setTimeout(r, 350));
  await flushPromises();
};

// The real form submits asynchronously, so wait for the attempt to settle before asserting.
async function submit(w: VueWrapper) {
  const f = form(w);
  const attempts = f.state.submissionAttempts;
  await w.find("form").trigger("submit");
  await vi.waitFor(() => {
    expect(f.state.submissionAttempts).toBeGreaterThan(attempts);
    expect(f.state.isSubmitting).toBe(false);
  });
  await flushPromises();
}

const sent = () => vi.mocked(fleet.setDesired).mock.calls[0];

const base: RolloutForm = {
  fleet: "default",
  config: "edge",
  version: 2,
  start: "now",
  when: "",
  batching: "one",
  first: 1,
  initial: 1,
  multiplier: 3,
  max: 100,
  verify: true,
  autoRollback: true,
};

describe("requestOf", () => {
  it("sends only the batching fields of the chosen kind", () => {
    expect(requestOf(base)?.batching).toEqual({ kind: "one" });
    expect(requestOf({ ...base, batching: "canary", first: "3" })?.batching).toEqual({
      kind: "canary",
      first: 3,
    });
    expect(
      requestOf({ ...base, batching: "progressive", initial: "2", multiplier: "3", max: "50" })
        ?.batching,
    ).toEqual({ kind: "progressive", initial: 2, multiplier: 3, max: 50 });
  });

  it("is null while a count or the version is not valid yet", () => {
    expect(requestOf({ ...base, version: 0 })).toBeNull();
    expect(requestOf({ ...base, batching: "canary", first: "" })).toBeNull();
    expect(requestOf({ ...base, batching: "progressive", multiplier: "0" })).toBeNull();
  });

  it("carries a scheduled start as epoch milliseconds", () => {
    const when = "2030-01-02T03:04";
    expect(requestOf({ ...base, start: "at", when })?.start).toEqual({
      kind: "at",
      at: new Date(when).getTime(),
    });
  });
});

describe("FleetNewRolloutDialog", () => {
  let wrapper: VueWrapper;

  beforeEach(() => {
    vi.mocked(fleet.listConfigs).mockResolvedValue({
      data: { items: [config("edge", 2), config("other", 1), config("empty", 0)] },
    } as any);
    vi.mocked(fleet.listFleets).mockResolvedValue({
      data: {
        items: [fleetOf("default", 40, ["other", 1]), fleetOf("one", 1), fleetOf("void", 0)],
      },
    } as any);
    vi.mocked(fleet.listRollouts).mockResolvedValue({ data: { items: [] } } as any);
    vi.mocked(fleet.getSettings).mockResolvedValue({
      data: {
        restricted_components: [],
        target_collector_version: null,
        fleet_defaults: { ...NO_OVERRIDES, phase_timeout_secs: 1800 },
      },
    } as any);
    vi.mocked(fleet.previewDesired).mockResolvedValue({
      data: { phases: [3, 9, 27, 1], collapsed: false, eligible: 40 },
    } as any);
    vi.mocked(fleet.setDesired).mockResolvedValue({ data: apiRollout() } as any);
  });

  afterEach(() => {
    wrapper?.unmount();
    queryClient.clear();
    vi.clearAllMocks();
  });

  it("seeds the fixed fleet, its desired configuration and the newest other version", async () => {
    wrapper = mountDialog({ fleetId: "default" });
    await settlePreview();
    expect(form(wrapper).state.values).toMatchObject({
      fleet: "default",
      config: "other",
      version: 0,
      start: "now",
      batching: "one",
      verify: true,
      autoRollback: true,
    });
  });

  it("previews the server's plan for the current choices", async () => {
    wrapper = mountDialog({ fleetId: "default", config: "edge", toVersion: 2 });
    await settlePreview();
    form(wrapper).setFieldValue("batching", "progressive");
    form(wrapper).setFieldValue("initial", "3");
    await settlePreview();
    const [o, f, body] = vi.mocked(fleet.previewDesired).mock.calls.at(-1)!;
    expect([o, f]).toEqual([org(), "default"]);
    expect(body.batching).toEqual({ kind: "progressive", initial: 3, multiplier: 3, max: 100 });
    expect(wrapper.find('[data-test="fleet-new-rollout-dialog-plan"]').text()).toContain(
      "3 → 9 → 27 → remaining 1, 4 phases",
    );
  });

  it("says when the first batch collapses the plan to one batch", async () => {
    vi.mocked(fleet.previewDesired).mockResolvedValue({
      data: { phases: [40], collapsed: true, eligible: 40 },
    } as any);
    wrapper = mountDialog({ fleetId: "default", config: "edge", toVersion: 2 });
    await settlePreview();
    form(wrapper).setFieldValue("batching", "canary");
    form(wrapper).setFieldValue("first", "50");
    await settlePreview();
    expect(wrapper.find('[data-test="fleet-new-rollout-dialog-collapsed"]').exists()).toBe(true);
  });

  it("shows the phase timeout from the fleet's own setting, else the org default", async () => {
    wrapper = mountDialog({ fleetId: "one", config: "edge", toVersion: 2 });
    await settlePreview();
    expect(wrapper.find('[data-test="fleet-new-rollout-dialog-timeout"]').text()).toContain(
      "10 min",
    );
    wrapper.unmount();
    wrapper = mountDialog({ fleetId: "default", config: "edge", toVersion: 2 });
    await settlePreview();
    expect(wrapper.find('[data-test="fleet-new-rollout-dialog-timeout"]').text()).toContain(
      "30 min",
    );
  });

  it("sends start, batching, verify and auto-rollback as the contract body", async () => {
    wrapper = mountDialog({ fleetId: "default", config: "edge", toVersion: 2 });
    await settlePreview();
    form(wrapper).setFieldValue("batching", "canary");
    form(wrapper).setFieldValue("first", "5");
    form(wrapper).setFieldValue("autoRollback", false);
    await submit(wrapper);
    expect(sent()).toEqual([
      org(),
      "default",
      {
        config: "edge",
        version: 2,
        start: { kind: "now" },
        batching: { kind: "canary", first: 5 },
        verify: true,
        auto_rollback: false,
      },
    ]);
    expect(wrapper.emitted("update:open")?.at(-1)).toEqual([false]);
  });

  it("refuses a scheduled start in the past", async () => {
    wrapper = mountDialog({ fleetId: "default", config: "edge", toVersion: 2 });
    await settlePreview();
    form(wrapper).setFieldValue("start", "at");
    form(wrapper).setFieldValue("when", "2001-01-01T00:00");
    await submit(wrapper);
    expect(fleet.setDesired).not.toHaveBeenCalled();
  });

  it("refuses a progressive maximum below the initial batch", async () => {
    wrapper = mountDialog({ fleetId: "default", config: "edge", toVersion: 2 });
    await settlePreview();
    form(wrapper).setFieldValue("batching", "progressive");
    form(wrapper).setFieldValue("initial", "10");
    form(wrapper).setFieldValue("max", "5");
    await submit(wrapper);
    expect(fleet.setDesired).not.toHaveBeenCalled();
  });

  it("says an empty fleet gets the version at once", async () => {
    wrapper = mountDialog({ fleetId: "void", config: "edge", toVersion: 2 });
    await settlePreview();
    expect(wrapper.find('[data-test="fleet-new-rollout-dialog-plan"]').text()).toContain(
      "The fleet has no collectors, so the version is set at once",
    );
  });

  it("marks a version whose rollout halted or was rolled back", async () => {
    vi.mocked(fleet.listRollouts).mockResolvedValue({
      data: { items: [apiRollout({ config: "edge", to_version: 2, status: "rolled_back" })] },
    } as any);
    wrapper = mountDialog({ fleetId: "one" });
    await settlePreview();
    form(wrapper).setFieldValue("config", "edge");
    await flushPromises();
    const select = wrapper
      .findAllComponents({ name: "OSelect" })
      .find((c) => c.attributes("data-test") === "fleet-new-rollout-dialog-version")!;
    const labels = (select.props("options") as { label: string }[]).map((o) => o.label);
    expect(labels).toEqual(["v2 · failed before", "v1"]);
  });

  it("shows the server's reason when the change is refused", async () => {
    vi.mocked(fleet.setDesired).mockRejectedValue({
      response: { status: 403, data: { message: "no put on fleet one" } },
    });
    wrapper = mountDialog({ fleetId: "one", config: "edge", toVersion: 2 });
    await settlePreview();
    await submit(wrapper);
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "error", message: "no put on fleet one" }),
    );
  });

  it("shows the no-access state when the lists are forbidden", async () => {
    vi.mocked(fleet.listFleets).mockRejectedValue({ response: { status: 403 } });
    wrapper = mountDialog();
    await settlePreview();
    expect(wrapper.find('[data-test="fleet-new-rollout-dialog-forbidden"]').exists()).toBe(true);
  });
});
