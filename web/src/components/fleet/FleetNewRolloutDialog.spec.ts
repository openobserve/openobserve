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
import { fleetKeys } from "@/services/fleet.querykeys";
import OForm from "@/lib/forms/Form/OForm.vue";
import FleetNewRolloutDialog from "./FleetNewRolloutDialog.vue";

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
    setDesired: vi.fn(),
  },
}));

const config = (id: string, latest: number) => ({
  id,
  description: "",
  template: false,
  latest_version: latest,
  live_version: null,
  collectors: 0,
  fleets: [],
  updated_at: 1,
  updated_by: "ana@acme.io",
});

const apiFleet = (
  id: string,
  collectors: number | null,
  desired: [string, number] | null = null,
) => ({
  id,
  name: `${id}-name`,
  state:
    collectors === null
      ? null
      : {
          desired: desired ? { config: desired[0], version: desired[1] } : null,
          stable: null,
          revision: null,
          collectors,
          online: collectors,
          at_desired: 0,
        },
});

const apiRollout = (config: string, version: number, status: string, failed = false) => ({
  id: `${config}-${version}-${status}`,
  kind: "config",
  config,
  from_version: null,
  to_version: version,
  fleet: { id: "one", name: "one" },
  strategy: "immediate",
  status,
  total: 1,
  attempted: 1,
  accepted: failed ? 0 : 1,
  failed: failed ? 1 : 0,
  assigned: 1,
  started_at: 1,
  scheduled_for: null,
  started_by: "ana@acme.io",
  auto_rollback: true,
  phases: [],
  gates: [],
  failure: failed
    ? { kind: "rejection", gate: "rejected", observed: "1", threshold: "0", message: null }
    : null,
  events: [],
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

const field = (w: VueWrapper, name: string) =>
  w
    .findAllComponents({ name: "OSelect" })
    .find((c) => c.attributes("data-test") === `fleet-new-rollout-dialog-${name}`)!;

const GATES_HINT = "Health checks need more collectors in the fleet than the initial batch";

const org = () => store.state.selectedOrganization.identifier;

const control = (w: VueWrapper, id: string) =>
  w.find(
    `[data-test="fleet-new-rollout-dialog-${id}-field"], [data-test="fleet-new-rollout-dialog-${id}-btn"]`,
  );

const switchBtn = (w: VueWrapper, id: string) =>
  w.find(`[data-test="fleet-new-rollout-dialog-${id}-btn"]`);

async function pickStrategy(w: VueWrapper, strategy: string) {
  w.findComponent({ name: "OToggleGroup" }).vm.$emit("update:modelValue", strategy);
  await flushPromises();
}

async function pickFleet(w: VueWrapper, id: string) {
  field(w, "fleet").vm.$emit("update:modelValue", id);
  await flushPromises();
}

const pad = (n: number) => String(n).padStart(2, "0");
const localDateTime = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

// The real form submits asynchronously, so wait for the attempt to settle before asserting.
async function submit(w: VueWrapper) {
  const f = (w.findComponent(OForm).vm as any).form;
  const attempts = f.state.submissionAttempts;
  await w.find("form").trigger("submit");
  await vi.waitFor(() => {
    expect(f.state.submissionAttempts).toBeGreaterThan(attempts);
    expect(f.state.isSubmitting).toBe(false);
  });
  await flushPromises();
}

const sent = () => vi.mocked(fleet.setDesired).mock.calls[0];

describe("FleetNewRolloutDialog", () => {
  let wrapper: VueWrapper;

  beforeEach(() => {
    vi.mocked(fleet.listConfigs).mockResolvedValue({
      data: { items: [config("edge", 2), config("other", 1), config("empty", 0)] },
    } as any);
    vi.mocked(fleet.listFleets).mockResolvedValue({
      data: {
        items: [
          apiFleet("default", 3, ["other", 1]),
          apiFleet("one", 1),
          apiFleet("void", 0),
          apiFleet("hidden", null),
        ],
      },
    } as any);
    vi.mocked(fleet.setDesired).mockResolvedValue({ data: { id: "r1" } } as any);
    vi.mocked(fleet.listRollouts).mockResolvedValue({ data: { items: [] } } as any);
  });

  afterEach(() => {
    wrapper?.unmount();
    queryClient.clear();
    vi.clearAllMocks();
  });

  it("retries a halted revision with its own strategy, batch, gates and auto-revert", async () => {
    const retryOf = {
      fleetId: "default",
      config: "edge",
      toVersion: 1,
      strategy: "canary",
      phases: [{ size: 1 }, { size: 2 }],
      gates: [{ id: "heartbeat" }],
      autoRollback: false,
    };
    wrapper = mountDialog({ retryOf });
    await flushPromises();
    expect(field(wrapper, "fleet").props("disabled")).toBe(true);
    expect(field(wrapper, "config").props("disabled")).toBe(true);
    await submit(wrapper);
    expect(sent()).toEqual([
      org(),
      "default",
      {
        config: "edge",
        version: 1,
        strategy: "canary",
        batch: { initial: 1 },
        gates: true,
        auto_rollback: false,
      },
    ]);
  });

  describe("default version", () => {
    const versionField = (w: VueWrapper) => field(w, "version");
    const version = (w: VueWrapper) => (w.findComponent(OForm).vm as any).form.state.values.version;

    beforeEach(() => {
      vi.mocked(fleet.listConfigs).mockResolvedValue({
        data: { items: [config("edge", 4)] },
      } as any);
      vi.mocked(fleet.listFleets).mockResolvedValue({
        data: { items: [apiFleet("one", 1, ["edge", 3])] },
      } as any);
    });

    it("skips versions that failed before and the fleet's desired one", async () => {
      vi.mocked(fleet.listRollouts).mockResolvedValue({
        data: {
          items: [apiRollout("edge", 4, "halted", true), apiRollout("edge", 2, "completed")],
        },
      } as any);
      wrapper = mountDialog({ fleetId: "one", config: "edge" });
      await flushPromises();
      expect(version(wrapper)).toBe(2);
    });

    it("counts a rollout that halted and was then reverted automatically as failed", async () => {
      vi.mocked(fleet.listRollouts).mockResolvedValue({
        data: {
          items: [apiRollout("edge", 4, "superseded", true), apiRollout("edge", 2, "halted", true)],
        },
      } as any);
      wrapper = mountDialog({ fleetId: "one", config: "edge" });
      await flushPromises();
      expect(version(wrapper)).toBe(1);
    });

    it("keeps failed versions selectable but labels them", async () => {
      vi.mocked(fleet.listRollouts).mockResolvedValue({
        data: { items: [apiRollout("edge", 4, "halted", true)] },
      } as any);
      wrapper = mountDialog({ fleetId: "one", config: "edge" });
      await flushPromises();
      expect(versionField(wrapper).props("options")).toEqual([
        { label: "v4 · failed before", value: 4 },
        { label: "v3", value: 3 },
        { label: "v2", value: 2 },
        { label: "v1", value: 1 },
      ]);
    });

    it("preselects nothing when every candidate failed, and asks for a version", async () => {
      vi.mocked(fleet.listRollouts).mockResolvedValue({
        data: {
          items: [1, 2, 4].map((v) => apiRollout("edge", v, "halted", true)),
        },
      } as any);
      wrapper = mountDialog({ fleetId: "one", config: "edge" });
      await flushPromises();
      expect(version(wrapper)).toBe(0);
      await submit(wrapper);
      expect(fleet.setDesired).not.toHaveBeenCalled();
      expect(wrapper.text()).toContain("Pick a version");
    });

    it("recomputes the default when another fleet is picked", async () => {
      vi.mocked(fleet.listFleets).mockResolvedValue({
        data: { items: [apiFleet("default", 1, ["edge", 4]), apiFleet("one", 1)] },
      } as any);
      wrapper = mountDialog({ config: "edge" });
      await flushPromises();
      expect(version(wrapper)).toBe(3);
      await pickFleet(wrapper, "one");
      expect(version(wrapper)).toBe(4);
      await pickFleet(wrapper, "default");
      expect(version(wrapper)).toBe(3);
    });

    it("keeps a given version when another fleet is picked", async () => {
      vi.mocked(fleet.listFleets).mockResolvedValue({
        data: { items: [apiFleet("default", 1, ["edge", 4]), apiFleet("one", 1)] },
      } as any);
      wrapper = mountDialog({ config: "edge", toVersion: 4 });
      await flushPromises();
      await pickFleet(wrapper, "one");
      expect(version(wrapper)).toBe(4);
    });

    it("waits for a refetch of cached rollouts before choosing the default", async () => {
      queryClient.setQueryData(fleetKeys.rollouts(org()), [apiRollout("edge", 4, "completed")], {
        updatedAt: 1,
      });
      let resolve!: (v: unknown) => void;
      vi.mocked(fleet.listRollouts).mockReturnValue(new Promise((r) => (resolve = r)) as any);
      wrapper = mountDialog({ fleetId: "one", config: "edge" });
      await flushPromises();
      expect(fleet.listRollouts).toHaveBeenCalled();
      expect(wrapper.find('[data-test="fleet-new-rollout-dialog-loading"]').exists()).toBe(true);
      expect(wrapper.findComponent(OForm).exists()).toBe(false);
      expect(wrapper.findComponent(ODialogStub).props("primaryButtonDisabled")).toBe(true);
      resolve({ data: { items: [apiRollout("edge", 4, "halted", true)] } });
      await flushPromises();
      expect(version(wrapper)).toBe(2);
    });

    it("re-reads even a fresh cache on opening, so a version that just failed is skipped", async () => {
      queryClient.setQueryData(fleetKeys.rollouts(org()), [apiRollout("edge", 4, "completed")]);
      vi.mocked(fleet.listRollouts).mockResolvedValue({
        data: { items: [apiRollout("edge", 4, "halted", true)] },
      } as any);
      wrapper = mountDialog({ fleetId: "one", config: "edge" });
      await flushPromises();
      expect(fleet.listRollouts).toHaveBeenCalledTimes(1);
      expect(version(wrapper)).toBe(2);
    });

    it("preselects no version when the rollouts cannot be read, but keeps a given one", async () => {
      vi.mocked(fleet.listRollouts).mockRejectedValue(new Error("boom"));
      wrapper = mountDialog({ fleetId: "one", config: "edge" });
      await flushPromises();
      expect(version(wrapper)).toBe(0);
      expect(versionField(wrapper).props("options")[0]).toEqual({ label: "v4", value: 4 });
      wrapper.unmount();
      queryClient.clear();
      wrapper = mountDialog({ fleetId: "one", config: "edge", toVersion: 4 });
      await flushPromises();
      expect(version(wrapper)).toBe(4);
    });

    it("keeps an explicitly chosen version even if it failed", async () => {
      vi.mocked(fleet.listRollouts).mockResolvedValue({
        data: { items: [apiRollout("edge", 4, "halted", true)] },
      } as any);
      wrapper = mountDialog({ fleetId: "one", config: "edge", toVersion: 4 });
      await flushPromises();
      expect(version(wrapper)).toBe(4);
    });
  });

  it.each([
    [{ response: { status: 403 } }, "fleet-new-rollout-dialog-forbidden"],
    [{ response: { status: 500 } }, "fleet-new-rollout-dialog-error"],
  ])("shows why the lists cannot load (%j) instead of the form", async (err, shown) => {
    vi.mocked(fleet.listConfigs).mockRejectedValue(err);
    wrapper = mountDialog();
    await flushPromises();
    expect(wrapper.find(`[data-test="${shown}"]`).exists()).toBe(true);
    expect(wrapper.findComponent(OForm).exists()).toBe(false);
    expect(wrapper.findComponent(ODialogStub).props("primaryButtonDisabled")).toBe(true);
  });

  it("disables Change version when a list read turns 403 after the form was seeded", async () => {
    wrapper = mountDialog({ config: "edge" });
    await flushPromises();
    expect(wrapper.findComponent(ODialogStub).props("primaryButtonDisabled")).toBe(false);
    vi.mocked(fleet.listConfigs).mockRejectedValue({ response: { status: 403 } });
    await queryClient.refetchQueries({ type: "active" });
    await flushPromises();
    expect(wrapper.findComponent(ODialogStub).props("primaryButtonDisabled")).toBe(true);
  });

  it("seeds the form once a failed list read is retried", async () => {
    vi.mocked(fleet.listConfigs).mockRejectedValueOnce({ response: { status: 500 } });
    wrapper = mountDialog({ config: "edge" });
    await flushPromises();
    wrapper.findComponent('[data-test="fleet-new-rollout-dialog-error"]').vm.$emit("action");
    await flushPromises();
    expect(wrapper.findComponent(OForm).exists()).toBe(true);
    expect(field(wrapper, "config").props("modelValue")).toBe("edge");
    expect(wrapper.findComponent(ODialogStub).props("primaryButtonDisabled")).toBe(false);
  });

  it("is titled Change version", async () => {
    wrapper = mountDialog();
    await flushPromises();
    expect(wrapper.findComponent(ODialogStub).props("title")).toBe("Change version");
  });

  it("offers only configurations with a published version", async () => {
    wrapper = mountDialog();
    await flushPromises();
    expect((field(wrapper, "config").props("options") as any[]).map((o) => o.value)).toEqual([
      "edge",
      "other",
    ]);
  });

  it("offers the fleets the user can read and fixes the one it was opened with", async () => {
    wrapper = mountDialog({ fleetId: "one" });
    await flushPromises();
    expect((field(wrapper, "fleet").props("options") as any[]).map((o) => o.value)).toEqual([
      "default",
      "one",
      "void",
    ]);
    expect(field(wrapper, "fleet").props("modelValue")).toBe("one");
    expect(field(wrapper, "fleet").props("disabled")).toBe(true);
  });

  it("lets the fleet be picked when it was opened without one, starting from default", async () => {
    wrapper = mountDialog({ config: "edge" });
    await flushPromises();
    expect(field(wrapper, "fleet").props("modelValue")).toBe("default");
    expect(field(wrapper, "fleet").props("disabled")).toBeFalsy();
  });

  it("starts from the first readable fleet when default is not listed", async () => {
    vi.mocked(fleet.listFleets).mockResolvedValue({
      data: { items: [apiFleet("one", 1), apiFleet("void", 0)] },
    } as any);
    wrapper = mountDialog({ config: "edge" });
    await flushPromises();
    expect(field(wrapper, "fleet").props("modelValue")).toBe("one");
  });

  it("defaults to the fleet's desired configuration, but not to the version it already runs", async () => {
    wrapper = mountDialog({ fleetId: "default" });
    await flushPromises();
    expect(field(wrapper, "config").props("modelValue")).toBe("other");
    expect(field(wrapper, "version").props("modelValue")).toBe(0);
    wrapper.unmount();
    queryClient.clear();
    vi.mocked(fleet.listConfigs).mockResolvedValue({
      data: { items: [config("edge", 2), config("other", 2)] },
    } as any);
    wrapper = mountDialog({ fleetId: "default" });
    await flushPromises();
    expect(field(wrapper, "version").props("modelValue")).toBe(2);
  });

  it("defaults to the configuration and version it was opened with", async () => {
    wrapper = mountDialog({ config: "edge", toVersion: 1 });
    await flushPromises();
    expect(field(wrapper, "config").props("modelValue")).toBe("edge");
    expect(field(wrapper, "version").props("modelValue")).toBe(1);
  });

  it.each([
    ["immediate", ["auto-rollback"]],
    ["canary", ["initial", "gates", "auto-rollback"]],
    ["progressive", ["initial", "multiplier", "max", "gates", "auto-rollback"]],
    ["scheduled", ["when", "auto-rollback"]],
  ])("shows only the %s strategy's inputs", async (strategy, shown) => {
    wrapper = mountDialog({ config: "edge" });
    await flushPromises();
    await pickStrategy(wrapper, strategy);
    for (const id of ["initial", "multiplier", "max", "when", "gates", "auto-rollback"]) {
      expect(control(wrapper, id).exists(), id).toBe(shown.includes(id));
    }
  });

  it("offers the four strategies and labels the primary button Change version for each", async () => {
    wrapper = mountDialog({ config: "edge" });
    await flushPromises();
    const items = wrapper.findAllComponents({ name: "OToggleGroupItem" });
    expect(items.map((i) => i.text())).toEqual(["Immediate", "Canary", "Progressive", "Scheduled"]);
    expect(wrapper.findComponent(ODialogStub).props("primaryButtonLabel")).toBe("Change version");
    await pickStrategy(wrapper, "scheduled");
    expect(wrapper.findComponent(ODialogStub).props("primaryButtonLabel")).toBe("Change version");
  });

  it("puts an immediate desired version on the fleet", async () => {
    wrapper = mountDialog({ config: "edge" });
    await flushPromises();
    await submit(wrapper);
    expect(fleet.setDesired).toHaveBeenCalledWith(org(), "default", {
      config: "edge",
      version: 2,
      strategy: "immediate",
      auto_rollback: true,
    });
    expect(wrapper.emitted("update:open")?.at(-1)).toEqual([false]);
    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ variant: "success" }));
  });

  it("puts a canary with only the initial batch, health checks and automatic revert", async () => {
    wrapper = mountDialog({ config: "edge" });
    await flushPromises();
    await pickStrategy(wrapper, "canary");
    await submit(wrapper);
    expect(sent()).toEqual([
      org(),
      "default",
      {
        config: "edge",
        version: 2,
        strategy: "canary",
        batch: { initial: 1 },
        gates: true,
        auto_rollback: true,
      },
    ]);
  });

  it("puts a progressive rollout with all three batch sizes as numbers", async () => {
    wrapper = mountDialog({ config: "edge" });
    await flushPromises();
    await pickStrategy(wrapper, "progressive");
    await control(wrapper, "initial").setValue("1");
    await control(wrapper, "multiplier").setValue("2");
    await control(wrapper, "max").setValue("4");
    await submit(wrapper);
    expect(sent()[2]).toEqual({
      config: "edge",
      version: 2,
      strategy: "progressive",
      batch: { initial: 1, multiplier: 2, max: 4 },
      gates: true,
      auto_rollback: true,
    });
  });

  it("puts a scheduled rollout's start time in epoch milliseconds, with no batch or gates", async () => {
    wrapper = mountDialog({ config: "edge" });
    await flushPromises();
    await pickStrategy(wrapper, "scheduled");
    const when = localDateTime(Date.now() + 2 * 3600_000);
    await control(wrapper, "when").setValue(when);
    await submit(wrapper);
    expect(sent()[2]).toEqual({
      config: "edge",
      version: 2,
      strategy: "scheduled",
      scheduled_for: new Date(when).getTime(),
      auto_rollback: true,
    });
  });

  it("refuses a start time in the past", async () => {
    wrapper = mountDialog({ config: "edge" });
    await flushPromises();
    await pickStrategy(wrapper, "scheduled");
    await control(wrapper, "when").setValue(localDateTime(Date.now() - 3600_000));
    await submit(wrapper);
    expect(fleet.setDesired).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain("Pick a time in the future");
  });

  it("refuses a max batch below the initial batch", async () => {
    wrapper = mountDialog({ config: "edge" });
    await flushPromises();
    await pickStrategy(wrapper, "progressive");
    await control(wrapper, "initial").setValue("3");
    await control(wrapper, "max").setValue("2");
    await submit(wrapper);
    expect(fleet.setDesired).not.toHaveBeenCalled();
  });

  it("sends automatic revert off once it is switched off", async () => {
    wrapper = mountDialog({ config: "edge" });
    await flushPromises();
    expect(switchBtn(wrapper, "auto-rollback").attributes("aria-checked")).toBe("true");
    await switchBtn(wrapper, "auto-rollback").trigger("click");
    await submit(wrapper);
    expect(sent()[2]).toMatchObject({ auto_rollback: false });
  });

  it("names the strategy toggle group by its Strategy label", async () => {
    wrapper = mountDialog({ config: "edge" });
    await flushPromises();
    const group = wrapper.find('[data-test="fleet-new-rollout-dialog-strategy"]');
    expect(group.attributes("role")).toBe("group");
    const name = document.getElementById(group.attributes("aria-labelledby")!)?.textContent;
    expect(name?.trim()).toBe("Strategy");
  });

  it("plans with the fleet's member count: health checks need more members than the initial batch", async () => {
    wrapper = mountDialog({ config: "edge" });
    await flushPromises();
    await pickStrategy(wrapper, "canary");
    expect(switchBtn(wrapper, "gates").attributes("aria-checked")).toBe("true");
    await control(wrapper, "initial").setValue("3");
    await flushPromises();
    expect(switchBtn(wrapper, "gates").attributes("aria-checked")).toBe("false");
    expect(switchBtn(wrapper, "gates").attributes("disabled")).toBeDefined();
    expect(wrapper.text()).toContain(GATES_HINT);
    await control(wrapper, "initial").setValue("1");
    await flushPromises();
    expect(switchBtn(wrapper, "gates").attributes("aria-checked")).toBe("true");
    await pickFleet(wrapper, "one");
    expect(switchBtn(wrapper, "gates").attributes("aria-checked")).toBe("false");
    expect(switchBtn(wrapper, "gates").attributes("disabled")).toBeDefined();
  });

  it("keeps health checks off when they come back available after the operator turned them off", async () => {
    wrapper = mountDialog({ config: "edge" });
    await flushPromises();
    await pickStrategy(wrapper, "canary");
    await switchBtn(wrapper, "gates").trigger("click");
    await flushPromises();
    await control(wrapper, "initial").setValue("3");
    await flushPromises();
    await control(wrapper, "initial").setValue("1");
    await flushPromises();
    expect(switchBtn(wrapper, "gates").attributes("aria-checked")).toBe("false");
    await submit(wrapper);
    expect(sent()[2]).toMatchObject({ gates: false });
  });

  it("disables scheduling and health checks for an empty fleet", async () => {
    wrapper = mountDialog({ config: "edge", fleetId: "void" });
    await flushPromises();
    const scheduled = wrapper
      .findAllComponents({ name: "OToggleGroupItem" })
      .find((i) => i.text() === "Scheduled")!;
    expect(scheduled.props("disabled")).toBe(true);
    await pickStrategy(wrapper, "canary");
    expect(switchBtn(wrapper, "gates").attributes("disabled")).toBeDefined();
    expect(switchBtn(wrapper, "gates").attributes("aria-checked")).toBe("false");
    await submit(wrapper);
    expect(sent()[1]).toBe("void");
    expect(sent()[2]).toMatchObject({ strategy: "canary", gates: false });
  });

  it("falls back to immediate when the fleet picked is empty while scheduled was chosen", async () => {
    wrapper = mountDialog({ config: "edge" });
    await flushPromises();
    await pickStrategy(wrapper, "scheduled");
    await pickFleet(wrapper, "void");
    await submit(wrapper);
    expect(sent()[2]).toMatchObject({ strategy: "immediate" });
  });

  it("refuses to put without a fleet", async () => {
    vi.mocked(fleet.listFleets).mockResolvedValue({ data: { items: [] } } as any);
    wrapper = mountDialog({ config: "edge" });
    await flushPromises();
    await pickFleet(wrapper, "");
    await submit(wrapper);
    expect(fleet.setDesired).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain("Pick a fleet");
  });

  it("toasts the server's message on a 403 and stays open", async () => {
    vi.mocked(fleet.setDesired).mockRejectedValueOnce({
      response: { status: 403, data: { code: 403, message: "Unauthorized Access" } },
    });
    wrapper = mountDialog({ config: "edge" });
    await flushPromises();
    await submit(wrapper);
    expect(toastMock).toHaveBeenCalledWith({ variant: "error", message: "Unauthorized Access" });
    expect(wrapper.emitted("update:open")).toBeUndefined();
  });
});
