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

import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import type { AlertLibraryEntry, AlertLibraryFile } from "@/types/alertLibrary";
import analytics from "@/services/product_analytics";
import config from "@/aws-exports";
import { queryClient } from "@/composables/query/queryClient";
import { alertKeys } from "@/services/alerts.querykeys";
import { anomalyKeys } from "@/services/anomaly_detection.querykeys";

const mocks = vi.hoisted(() => ({
  loadAlertFile: vi.fn(),
  createAlert: vi.fn(),
  createAnomaly: vi.fn(),
  getFoldersListByType: vi.fn(),
  toast: vi.fn(),
}));

// Every partial mock below spreads the REAL module and overrides only what the
// test drives. A hand-listed subset silently removes the other members, so an
// implementation that touches one dies at mount and reads as a component bug
// rather than as the missing test double it is.
vi.mock("@/composables/alerts/useAlertLibrary", async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    "@/composables/alerts/useAlertLibrary",
  );
  return {
    ...actual,
    useAlertLibrary: () => ({
      ...(actual.useAlertLibrary as () => Record<string, unknown>)(),
      loadAlertFile: mocks.loadAlertFile,
    }),
  };
});

vi.mock("@/services/alerts", async () => {
  const actual = await vi.importActual<{ default: Record<string, unknown> }>("@/services/alerts");
  return { ...actual, default: { ...actual.default, create_by_alert_id: mocks.createAlert } };
});

vi.mock("@/services/anomaly_detection", async () => {
  const actual = await vi.importActual<{ default: Record<string, unknown> }>(
    "@/services/anomaly_detection",
  );
  return { ...actual, default: { ...actual.default, create: mocks.createAnomaly } };
});

vi.mock("@/utils/commons", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@/utils/commons");
  return { ...actual, getFoldersListByType: mocks.getFoldersListByType };
});

vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: mocks.toast }));
vi.mock("@/services/product_analytics", () => ({ default: { track: vi.fn() } }));

import LibraryInstallDialog from "./LibraryInstallDialog.vue";

// ── stubs ──────────────────────────────────────────────────────────────────
// ODialog teleports its panel out of the wrapper, so the real one hides every
// assertion below it.
const ODialogStub = {
  name: "ODialog",
  props: ["open", "title", "subTitle", "size", "persistent"],
  emits: ["update:open"],
  template: '<div data-test="o-dialog"><slot /><slot name="footer" /></div>',
};

const OInputStub = {
  name: "OInput",
  props: [
    "modelValue",
    "label",
    "helpText",
    "suffix",
    "type",
    "size",
    "error",
    "errorMessage",
    "required",
  ],
  emits: ["update:modelValue"],
  template:
    '<input :data-test="$attrs[\'data-test\']" :value="modelValue" :data-error="errorMessage" ' +
    ':data-label="label" ' +
    "@input=\"$emit('update:modelValue', $event.target.value)\" />",
};

const OCheckboxStub = {
  name: "OCheckbox",
  props: ["modelValue", "label", "size", "disabled", "ariaLabel"],
  emits: ["update:modelValue"],
  template:
    '<input type="checkbox" :data-test="$attrs[\'data-test\']" :data-label="label" ' +
    ':checked="modelValue === true" ' +
    "@change=\"$emit('update:modelValue', $event.target.checked)\" />",
};

const SelectFolderStub = {
  name: "SelectFolderDropDown",
  props: ["activeFolderId", "type"],
  emits: ["folder-selected"],
  template: '<div data-test="folder-picker" :data-type="type" :data-active="activeFolderId" />',
};

const stubs = {
  ODialog: ODialogStub,
  OInput: OInputStub,
  OCheckbox: OCheckboxStub,
  SelectFolderDropDown: SelectFolderStub,
};

// ── fixtures ───────────────────────────────────────────────────────────────

const entry = (over: Partial<AlertLibraryEntry> = {}): AlertLibraryEntry => ({
  id: "k8s/pod-oom-killed",
  name: "pod-oom-killed",
  pack: "k8s",
  category: "pod",
  title: "Pod OOM Killed",
  severity: "critical",
  description: "A container was terminated by the OOM killer.",
  stream: "kube_pod_metrics",
  stream_type: "metrics",
  query_type: "promql",
  required_streams: ["kube_pod_metrics"],
  path: "packs/k8s/alerts/pod/pod-oom-killed.json",
  content_hash: "hash-1",
  ...over,
});

// Factories, not shared objects: the dialog is handed these as props and a test
// that mutated one would silently poison every test after it.
const seedEntry = () => entry();
const secondEntry = () =>
  entry({
    id: "k8s/node-disk-pressure",
    name: "node-disk-pressure",
    title: "Node Disk Pressure",
    severity: "warning",
    content_hash: "hash-2",
  });
const thirdEntry = () =>
  entry({
    id: "k8s/cert-expiring",
    name: "cert-expiring",
    title: "Certificate Expiring",
    severity: "info",
    content_hash: "hash-3",
  });

const libraryFile = (name: string): AlertLibraryFile => ({
  id: "exported-id",
  name,
  stream_type: "metrics",
  stream_name: "kube_pod_metrics",
  destinations: ["k8s_alert"],
  query_condition: { type: "promql", promql: "up", promql_condition: { operator: ">", value: 0 } },
  trigger_condition: { period: 5, operator: ">=", threshold: 1, frequency: 5, silence: 30 },
});

const entries = () => [seedEntry(), secondEntry(), thirdEntry()];

const mountDialog = async (props: Record<string, unknown> = {}) => {
  const wrapper = mount(LibraryInstallDialog, {
    props: {
      open: true,
      preselect: [],
      seed: { entry: seedEntry(), file: libraryFile("pod-oom-killed") },
      ...props,
    },
    global: { plugins: [i18n, store], stubs },
  });
  await flushPromises();
  return wrapper;
};

const click = async (wrapper: any, test: string) => {
  await wrapper.find(`[data-test="${test}"]`).trigger("click");
  await flushPromises();
};

/** The gallery's three-alert selection, with no drawer seed — the batch cases. */
const mountBatch = (props: Record<string, unknown> = {}) =>
  mountDialog({ seed: null, preselect: entries(), ...props });

/** Walk Folder → Tune → Add with the defaults; an anomaly-only batch has no Tune. */
const advanceToInstall = async (wrapper: any) => {
  for (let guard = 0; guard < 3; guard += 1) {
    if (wrapper.find('[data-test="alert-library-install-run"]').exists()) return;
    await click(wrapper, "alert-library-install-next");
  }
};

/** Step titles as the stepper shows them, in order. */
const stepTitles = (wrapper: any): string[] =>
  wrapper.findAllComponents({ name: "OStep" }).map((step: any) => String(step.props("title")));

/** Per-alert outcome as the results list reports it. */
const statusOf = (wrapper: any, id: string) =>
  wrapper.find(`[data-test="alert-library-install-result-${id}"]`).attributes("data-status");

/**
 * Release held creates until the batch runs dry.
 *
 * A sequential run only ever has ONE create in flight, so the next promise does
 * not exist until the current one settles. `forEach` caches `length` and would
 * release just the first, leaving the batch wedged — an assertion that the run
 * finished would then be satisfiable only by a parallel implementation.
 */
const drain = async (releases: Array<(value: unknown) => void>) => {
  for (let index = 0; index < releases.length; index += 1) {
    releases[index]({ data: {} });
    await flushPromises();
  }
};

/** The payload posted for one alert, found by name rather than by call order. */
const payloadFor = (name: string) =>
  mocks.createAlert.mock.calls.find((call) => call[1].name === name)?.[1] as Record<string, any>;

describe("LibraryInstallDialog", () => {
  beforeEach(() => {
    // Reset OUR mocks only. `clearAllMocks` cannot drain an unconsumed `…Once`
    // queue (a leaked one-shot rejection then fails an unrelated test three
    // tests later), but `vi.resetAllMocks()` is too wide: setupTests.ts installs
    // URL.createObjectURL, clipboard.writeText, queryCommandSupported and
    // IntersectionObserver#takeRecords as module-scope mocks, and a global reset
    // strips their implementations for the rest of the file.
    Object.values(mocks).forEach((mock) => mock.mockReset());
    vi.mocked(analytics.track).mockClear();
    mocks.loadAlertFile.mockImplementation((e: AlertLibraryEntry) =>
      Promise.resolve(libraryFile(e.name)),
    );
    mocks.createAlert.mockResolvedValue({ data: {} });
    mocks.getFoldersListByType.mockResolvedValue([]);
  });

  describe("steps", () => {
    it("asks only Folder, Tune and Add for a batch with a threshold alert", async () => {
      const wrapper = await mountDialog();
      expect(stepTitles(wrapper)).toEqual(["Folder", "Tune", "Add"]);
      expect(wrapper.find('[data-test="alert-library-install-folder-step"]').exists()).toBe(true);
    });

    it("never asks for a destination", async () => {
      const wrapper = await mountDialog();
      expect(wrapper.text()).not.toContain("Destination");
      expect(wrapper.find('[data-test="alert-library-install-destination"]').exists()).toBe(false);
      await advanceToInstall(wrapper);
      expect(wrapper.find('[data-test="alert-library-install-summary"]').text()).not.toContain(
        "Destination",
      );
    });

    it("offers no per-alert checklist — the page already chose the alerts", async () => {
      const wrapper = await mountBatch();
      expect(wrapper.find('[data-test^="alert-library-install-alert-"]').exists()).toBe(false);
      await advanceToInstall(wrapper);
      expect(wrapper.find('[data-test="alert-library-install-run"]').text()).toContain("3");
    });

    it("installs every alert passed in, with no destination", async () => {
      const wrapper = await mountBatch();
      await advanceToInstall(wrapper);
      await click(wrapper, "alert-library-install-run");

      expect(mocks.createAlert.mock.calls.map((call) => call[1].name)).toEqual([
        "pod-oom-killed",
        "node-disk-pressure",
        "cert-expiring",
      ]);
      for (const call of mocks.createAlert.mock.calls) expect(call[1].destinations).toEqual([]);
    });

    it("installs the drawer's single alert, whatever else the gallery had selected", async () => {
      const wrapper = await mountDialog({ preselect: [secondEntry(), thirdEntry()] });
      await advanceToInstall(wrapper);
      await click(wrapper, "alert-library-install-run");

      expect(mocks.createAlert).toHaveBeenCalledTimes(1);
      expect(mocks.createAlert.mock.calls[0][1].name).toBe("pod-oom-killed");
    });

    it("offers no run for an empty batch", async () => {
      const wrapper = await mountDialog({ seed: null, preselect: [] });
      await advanceToInstall(wrapper);
      expect(
        wrapper.find('[data-test="alert-library-install-run"]').attributes("disabled"),
      ).toBeDefined();
    });

    it("goes back from Add to Tune to Folder", async () => {
      const wrapper = await mountDialog();
      await advanceToInstall(wrapper);
      await click(wrapper, "alert-library-install-back");
      expect(wrapper.find('[data-test="alert-library-install-tune-step"]').exists()).toBe(true);
      await click(wrapper, "alert-library-install-back");
      expect(wrapper.find('[data-test="alert-library-install-folder-step"]').exists()).toBe(true);
    });
  });

  describe("folder step", () => {
    it("refreshes the alert folder list when the dialog opens, since Folder is the first step", async () => {
      // SelectFolderDropDown refreshes itself only on `onActivated`, which a dialog never fires.
      await mountDialog({ open: false });
      expect(mocks.getFoldersListByType).not.toHaveBeenCalled();

      const wrapper = await mountDialog();
      expect(mocks.getFoldersListByType).toHaveBeenCalledWith(expect.anything(), "alerts");
      expect(wrapper.find('[data-test="folder-picker"]').attributes("data-type")).toBe("alerts");
    });

    it("installs into the folder the picker reports", async () => {
      const wrapper = await mountDialog();
      wrapper
        .findComponent({ name: "SelectFolderDropDown" })
        .vm.$emit("folder-selected", { label: "Kubernetes", value: "folder-42" });
      await flushPromises();
      await advanceToInstall(wrapper);
      await click(wrapper, "alert-library-install-run");

      expect(mocks.createAlert).toHaveBeenCalledWith("default", expect.anything(), "folder-42");
    });

    it("still lets the batch install when the folder list cannot be read", async () => {
      // "default" always exists, so a failed refresh must degrade to it rather than trap the run.
      mocks.getFoldersListByType.mockRejectedValue({ response: { status: 403 } });

      const wrapper = await mountDialog();
      expect(wrapper.find('[data-test="alert-library-install-folder-step"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="folder-picker"]').exists()).toBe(true);
      await advanceToInstall(wrapper);
      await click(wrapper, "alert-library-install-run");

      expect(mocks.createAlert).toHaveBeenCalledWith("default", expect.anything(), "default");
    });
  });

  describe("install", () => {
    // What the payload CONTAINS is `libraryInstall.spec.ts`'s job and is pinned
    // there field by field. These two only cover what that spec cannot see: that
    // the builder is wired in at all, fed the inputs only the wizard knows, and
    // called once per alert with that alert's own identity.

    it("feeds the builder the inputs only the wizard knows, and posts what it returns", async () => {
      const wrapper = await mountDialog();
      await advanceToInstall(wrapper);
      await click(wrapper, "alert-library-install-run");

      const payload = mocks.createAlert.mock.calls[0][1] as Record<string, any>;
      // Wizard-supplied: the folder and the store identity/timezone. `owner:
      // undefined` serialises away silently, so nothing else in either spec
      // would notice these were never read. Destinations are always cleared.
      expect(payload.destinations).toEqual([]);
      expect(payload.folder_id).toBe("default");
      expect(mocks.createAlert.mock.calls[0][2]).toBe("default");
      expect(payload.owner).toBe("example@gmail.com");
      expect(payload.last_edited_by).toBe("example@gmail.com");
      expect(payload.trigger_condition.timezone).toBe("UTC");
      // A builder-owned transform, as the one signal it really ran.
      expect("id" in payload).toBe(false);
    });

    it("builds each alert from its own entry, not from the seed's", async () => {
      const wrapper = await mountBatch();
      await advanceToInstall(wrapper);
      await click(wrapper, "alert-library-install-run");

      expect(payloadFor("pod-oom-killed").context_attributes).toMatchObject({
        library_id: "k8s/pod-oom-killed",
        library_hash: "hash-1",
      });
      expect(payloadFor("cert-expiring").context_attributes).toMatchObject({
        library_id: "k8s/cert-expiring",
        library_hash: "hash-3",
      });
      // Severity differs per entry, so a copied entry shows up here too.
      expect(payloadFor("pod-oom-killed").priority).toBe(1);
      expect(payloadFor("cert-expiring").priority).toBe(4);
    });

    it("uses the file the drawer already tuned rather than fetching it again", async () => {
      const tuned = libraryFile("pod-oom-killed");
      (tuned.trigger_condition as Record<string, unknown>).silence = 45;
      const wrapper = await mountDialog({ seed: { entry: seedEntry(), file: tuned } });
      await advanceToInstall(wrapper);
      await click(wrapper, "alert-library-install-run");

      expect(mocks.loadAlertFile).not.toHaveBeenCalled();
      const payload = mocks.createAlert.mock.calls[0][1] as Record<string, any>;
      expect(payload.trigger_condition.silence).toBe(45);
    });

    it("fetches the file of every alert in a gallery batch, which no drawer opened", async () => {
      const wrapper = await mountBatch();
      await advanceToInstall(wrapper);
      await click(wrapper, "alert-library-install-run");

      expect(mocks.loadAlertFile.mock.calls.map((call) => call[0].id)).toEqual([
        "k8s/pod-oom-killed",
        "k8s/node-disk-pressure",
        "k8s/cert-expiring",
      ]);
      expect(mocks.createAlert).toHaveBeenCalledTimes(3);
    });

    it("applies the bulk-tuned pair to every alert in the batch", async () => {
      const wrapper = await mountBatch();
      await click(wrapper, "alert-library-install-next");

      await wrapper.find('[data-test="alert-library-install-tune-toggle"]').setValue(true);
      await flushPromises();
      await wrapper.find('[data-test="alert-library-install-tune-frequency"]').setValue("15");
      await wrapper.find('[data-test="alert-library-install-tune-silence"]').setValue("60");
      await flushPromises();

      await click(wrapper, "alert-library-install-next");
      await click(wrapper, "alert-library-install-run");

      // Every alert, not just the seeded one — that is what "bulk" means here.
      for (const name of ["pod-oom-killed", "node-disk-pressure", "cert-expiring"]) {
        expect(payloadFor(name).trigger_condition.frequency).toBe(15);
        expect(payloadFor(name).trigger_condition.silence).toBe(60);
      }
      // And nothing else was touched: thresholds stay per-alert.
      expect(payloadFor("pod-oom-killed").trigger_condition.threshold).toBe(1);
      expect(payloadFor("pod-oom-killed").trigger_condition.period).toBe(5);
    });

    it.each([
      // [typed, frequency, silence] — floors are libraryTunables' own
      // (frequency >= 1, silence >= 0); the wizard must reuse coerceTunable
      // rather than inventing clamping, so these match the drawer exactly.
      // Two rows, not four: "" and "soon" are the same NaN path, "-5" and "0"
      // the same below-minimum path, so the extra rows buy no new coverage.
      ["a cleared field", "", 1, 0],
      ["zero", "0", 1, 0],
    ])(
      "will not let %s become an alert that can never fire",
      async (_label, typed, frequency, silence) => {
        // `Number("")` is 0, which silently turns "run every N minutes" into an
        // evaluation that never comes round. The drawer already solved this.
        const wrapper = await mountDialog();
        await click(wrapper, "alert-library-install-next");

        await wrapper.find('[data-test="alert-library-install-tune-toggle"]').setValue(true);
        await flushPromises();
        await wrapper.find('[data-test="alert-library-install-tune-frequency"]').setValue(typed);
        await wrapper.find('[data-test="alert-library-install-tune-silence"]').setValue(typed);
        await flushPromises();

        await click(wrapper, "alert-library-install-next");
        await click(wrapper, "alert-library-install-run");

        const trigger = mocks.createAlert.mock.calls[0][1].trigger_condition;
        expect(trigger.frequency).toBe(frequency);
        expect(trigger.silence).toBe(silence);
      },
    );

    it("keeps a silence of zero, which means 'never suppress'", async () => {
      const wrapper = await mountDialog();
      await click(wrapper, "alert-library-install-next");

      await wrapper.find('[data-test="alert-library-install-tune-toggle"]').setValue(true);
      await flushPromises();
      await wrapper.find('[data-test="alert-library-install-tune-silence"]').setValue("0");
      await flushPromises();
      await click(wrapper, "alert-library-install-next");
      await click(wrapper, "alert-library-install-run");

      expect(mocks.createAlert.mock.calls[0][1].trigger_condition.silence).toBe(0);
    });

    it("leaves the library defaults alone when the batch was not tuned", async () => {
      const wrapper = await mountDialog();
      await advanceToInstall(wrapper);
      await click(wrapper, "alert-library-install-run");

      const payload = mocks.createAlert.mock.calls[0][1] as Record<string, any>;
      expect(payload.trigger_condition.frequency).toBe(5);
      expect(payload.trigger_condition.silence).toBe(30);
    });

    it("installs SEQUENTIALLY, reporting each alert as it goes", async () => {
      // Every other test in this file passes against `Promise.all(...)`, so the
      // ordering requirement needs its own probe: hold each create open and
      // check that the next one has not started. Holding them open is also the
      // only moment the in-flight states are observable, so the `pending` and
      // `running` half of the status contract is pinned here too — otherwise
      // nothing specifies that a 20-alert batch shows any progress at all.
      const releases: Array<(value: unknown) => void> = [];
      mocks.createAlert.mockImplementation(() => new Promise((resolve) => releases.push(resolve)));

      const wrapper = await mountBatch();
      await advanceToInstall(wrapper);
      await click(wrapper, "alert-library-install-run");

      expect(mocks.createAlert).toHaveBeenCalledTimes(1);
      expect(statusOf(wrapper, "k8s/pod-oom-killed")).toBe("running");
      expect(statusOf(wrapper, "k8s/node-disk-pressure")).toBe("pending");
      expect(statusOf(wrapper, "k8s/cert-expiring")).toBe("pending");

      releases[0]({ data: {} });
      await flushPromises();

      expect(mocks.createAlert).toHaveBeenCalledTimes(2);
      expect(statusOf(wrapper, "k8s/pod-oom-killed")).toBe("installed");
      expect(statusOf(wrapper, "k8s/node-disk-pressure")).toBe("running");
      expect(statusOf(wrapper, "k8s/cert-expiring")).toBe("pending");

      releases[1]({ data: {} });
      await flushPromises();

      expect(mocks.createAlert).toHaveBeenCalledTimes(3);
      releases[2]({ data: {} });
      await flushPromises();

      expect(statusOf(wrapper, "k8s/cert-expiring")).toBe("installed");
    });

    it("cannot be run twice — a second click must not double-post the batch", async () => {
      // The worst outcome this wizard has. Cancel was guarded; the trigger was
      // not, and an impatient double-click on a slow batch creates every alert
      // twice, each failing or duplicating on the retry.
      const releases: Array<(value: unknown) => void> = [];
      mocks.createAlert.mockImplementation(() => new Promise((resolve) => releases.push(resolve)));

      const wrapper = await mountBatch();
      await advanceToInstall(wrapper);
      await click(wrapper, "alert-library-install-run");
      expect(mocks.createAlert).toHaveBeenCalledTimes(1);

      // However the implementation blocks it — disabled, hidden, or an internal
      // guard — the requirement is only that no extra create escapes.
      const run = wrapper.find('[data-test="alert-library-install-run"]');
      if (run.exists()) {
        await run.trigger("click");
        await flushPromises();
      }
      expect(mocks.createAlert).toHaveBeenCalledTimes(1);

      await drain(releases);
      expect(mocks.createAlert).toHaveBeenCalledTimes(3);
    });

    it("keeps going after a failure — item N must not abort N+1", async () => {
      mocks.createAlert
        .mockResolvedValueOnce({ data: {} })
        .mockRejectedValueOnce({ response: { data: { message: "alert name already exists" } } })
        .mockResolvedValueOnce({ data: {} });

      const wrapper = await mountBatch();
      await advanceToInstall(wrapper);
      await click(wrapper, "alert-library-install-run");

      // The third create is the whole point: it only happens if the second
      // rejection did not escape the loop.
      expect(mocks.createAlert).toHaveBeenCalledTimes(3);
      expect(mocks.createAlert.mock.calls.map((call) => call[1].name)).toEqual([
        "pod-oom-killed",
        "node-disk-pressure",
        "cert-expiring",
      ]);
      expect(statusOf(wrapper, "k8s/pod-oom-killed")).toBe("installed");
      expect(statusOf(wrapper, "k8s/node-disk-pressure")).toBe("failed");
      expect(statusOf(wrapper, "k8s/cert-expiring")).toBe("installed");
      expect(
        wrapper.find('[data-test="alert-library-install-error-k8s/node-disk-pressure"]').text(),
      ).toContain("alert name already exists");
    });

    it("tells the user the batch was not fully installed", async () => {
      mocks.createAlert
        .mockResolvedValueOnce({ data: {} })
        .mockRejectedValueOnce({ response: { data: { message: "boom" } } })
        .mockResolvedValueOnce({ data: {} });

      const wrapper = await mountBatch();
      await advanceToInstall(wrapper);
      await click(wrapper, "alert-library-install-run");

      // Times(1) matters: `toHaveBeenCalledWith` scans EVERY call, so an
      // implementation firing both a success and an error toast every run would
      // satisfy this assertion and its success-side twin simultaneously.
      expect(mocks.toast).toHaveBeenCalledTimes(1);
      expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ variant: "error" }));
    });

    it("reports a file that could not be fetched as that alert's failure only", async () => {
      mocks.loadAlertFile.mockImplementation((e: AlertLibraryEntry) =>
        e.name === "node-disk-pressure"
          ? Promise.reject(new Error("network down"))
          : Promise.resolve(libraryFile(e.name)),
      );

      const wrapper = await mountBatch();
      await advanceToInstall(wrapper);
      await click(wrapper, "alert-library-install-run");

      expect(mocks.createAlert.mock.calls.map((call) => call[1].name)).toEqual([
        "pod-oom-killed",
        "cert-expiring",
      ]);
      expect(statusOf(wrapper, "k8s/pod-oom-killed")).toBe("installed");
      expect(statusOf(wrapper, "k8s/node-disk-pressure")).toBe("failed");
      expect(statusOf(wrapper, "k8s/cert-expiring")).toBe("installed");
    });

    it("retries only what failed, and keeps the successes reported", async () => {
      mocks.createAlert
        .mockResolvedValueOnce({ data: {} })
        .mockRejectedValueOnce({ response: { data: { message: "boom" } } })
        .mockResolvedValueOnce({ data: {} });

      const wrapper = await mountBatch();
      await advanceToInstall(wrapper);
      await click(wrapper, "alert-library-install-run");

      mocks.createAlert.mockClear();
      mocks.createAlert.mockResolvedValue({ data: {} });
      await click(wrapper, "alert-library-install-retry");

      expect(mocks.createAlert).toHaveBeenCalledTimes(1);
      expect(mocks.createAlert.mock.calls[0][1].name).toBe("node-disk-pressure");
      expect(wrapper.find('[data-test="alert-library-install-retry"]').exists()).toBe(false);
      // A retry must not reset the rows it did not touch.
      expect(statusOf(wrapper, "k8s/pod-oom-killed")).toBe("installed");
      expect(statusOf(wrapper, "k8s/node-disk-pressure")).toBe("installed");
      expect(statusOf(wrapper, "k8s/cert-expiring")).toBe("installed");
    });

    it("cannot be retried twice either", async () => {
      mocks.createAlert
        .mockResolvedValueOnce({ data: {} })
        .mockRejectedValueOnce({ response: { data: { message: "boom" } } })
        .mockResolvedValueOnce({ data: {} });

      const wrapper = await mountBatch();
      await advanceToInstall(wrapper);
      await click(wrapper, "alert-library-install-run");

      const releases: Array<(value: unknown) => void> = [];
      mocks.createAlert.mockClear();
      mocks.createAlert.mockImplementation(() => new Promise((resolve) => releases.push(resolve)));

      await click(wrapper, "alert-library-install-retry");
      expect(mocks.createAlert).toHaveBeenCalledTimes(1);

      const retry = wrapper.find('[data-test="alert-library-install-retry"]');
      if (retry.exists()) {
        await retry.trigger("click");
        await flushPromises();
      }
      expect(mocks.createAlert).toHaveBeenCalledTimes(1);

      await drain(releases);
    });

    it("announces which library entries it installed, for Phase 5 to mark", async () => {
      // Library ENTRY ids, not alert ids — the gallery keys its tiles by these.
      // Failures are excluded; nothing was created for those.
      mocks.createAlert
        .mockResolvedValueOnce({ data: {} })
        .mockRejectedValueOnce({ response: { data: { message: "boom" } } })
        .mockResolvedValueOnce({ data: {} });

      const wrapper = await mountBatch();
      await advanceToInstall(wrapper);
      await click(wrapper, "alert-library-install-run");

      const installed = wrapper.emitted("installed");
      expect(installed).toHaveLength(1);
      expect(installed?.[0]?.[0]).toEqual({
        entryIds: ["k8s/pod-oom-killed", "k8s/cert-expiring"],
      });
    });

    it("tracks library_alert_installed with the number this run installed", async () => {
      mocks.createAlert
        .mockResolvedValueOnce({ data: {} })
        .mockRejectedValueOnce({ response: { data: { message: "boom" } } })
        .mockResolvedValueOnce({ data: {} });

      const wrapper = await mountBatch();
      await advanceToInstall(wrapper);
      await click(wrapper, "alert-library-install-run");

      expect(analytics.track).toHaveBeenCalledTimes(1);
      expect(analytics.track).toHaveBeenCalledWith("library_alert_installed", {
        count: 2,
        anomaly_count: 0,
      });
    });

    it("does not track library_alert_installed when every install fails", async () => {
      mocks.createAlert.mockRejectedValue({ response: { data: { message: "boom" } } });

      const wrapper = await mountBatch();
      await advanceToInstall(wrapper);
      await click(wrapper, "alert-library-install-run");

      expect(analytics.track).not.toHaveBeenCalled();
    });

    it("reports a clean batch and offers nothing to retry", async () => {
      const wrapper = await mountDialog();
      await advanceToInstall(wrapper);
      await click(wrapper, "alert-library-install-run");

      expect(mocks.toast).toHaveBeenCalledTimes(1);
      expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ variant: "success" }));
      expect(wrapper.find('[data-test="alert-library-install-retry"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="alert-library-install-done"]').exists()).toBe(true);
    });

    it("closes on done", async () => {
      const wrapper = await mountDialog();
      await advanceToInstall(wrapper);
      await click(wrapper, "alert-library-install-run");
      await click(wrapper, "alert-library-install-done");

      expect(wrapper.emitted("update:open")?.at(-1)).toEqual([false]);
    });

    it("cannot be cancelled while creates are in flight", async () => {
      // Half-finished batches are the reason: closing mid-run would leave some
      // alerts created and no report of which.
      let release: (value: unknown) => void = () => {};
      mocks.createAlert.mockReturnValue(
        new Promise((resolve) => {
          release = resolve;
        }),
      );

      const wrapper = await mountDialog();
      await advanceToInstall(wrapper);
      await click(wrapper, "alert-library-install-run");

      // Escape and backdrop dismissal go through ODialog, not the footer, so
      // guarding Cancel alone leaves the same half-finished-batch hole open.
      expect(wrapper.findComponent({ name: "ODialog" }).props("persistent")).toBe(true);

      // Hiding Cancel during the run is a perfectly good way to make a run
      // non-cancellable, and VTU throws on `trigger` against an empty wrapper —
      // so clicking unconditionally would REJECT that correct implementation.
      // What is actually required is that no close escapes, however achieved.
      const cancel = wrapper.find('[data-test="alert-library-install-cancel"]');
      if (cancel.exists()) {
        await cancel.trigger("click");
        await flushPromises();
      }
      expect(wrapper.emitted("update:open")).toBeUndefined();

      release({ data: {} });
      await flushPromises();
      await click(wrapper, "alert-library-install-done");
      expect(wrapper.emitted("update:open")?.at(-1)).toEqual([false]);
    });
  });

  it("installs a repeated manifest id exactly once", async () => {
    // The manifest is fetched content; a duplicated entry would otherwise be
    // walked twice and create the alert twice.
    const wrapper = await mountBatch({ preselect: [seedEntry(), seedEntry(), secondEntry()] });
    await advanceToInstall(wrapper);
    expect(wrapper.find('[data-test="alert-library-install-run"]').text()).toContain("2");
    await click(wrapper, "alert-library-install-run");

    expect(mocks.createAlert).toHaveBeenCalledTimes(2);
    expect(
      mocks.createAlert.mock.calls.filter((call) => call[1].name === "pod-oom-killed"),
    ).toHaveLength(1);
  });

  it("fails the one alert whose conditions cannot be read, and says why", async () => {
    // The builder refuses rather than installing an empty filter group. The
    // loop must surface that as a normal per-alert failure.
    mocks.loadAlertFile.mockImplementation((entry: AlertLibraryEntry) => {
      const file = libraryFile(entry.name);
      if (entry.name === "node-disk-pressure") {
        file.query_condition = { type: "sql", sql: "select 1", conditions: { version: 1 } };
      }
      return Promise.resolve(file);
    });

    const wrapper = await mountBatch();
    await click(wrapper, "alert-library-install-next");
    await click(wrapper, "alert-library-install-next");
    await click(wrapper, "alert-library-install-run");

    expect(statusOf(wrapper, "k8s/node-disk-pressure")).toBe("failed");
    expect(statusOf(wrapper, "k8s/pod-oom-killed")).toBe("installed");
    expect(statusOf(wrapper, "k8s/cert-expiring")).toBe("installed");
    // Translated copy — not a raw TypeError from inside a converter, and not
    // the bare error CODE the builder throws with.
    const message = wrapper
      .find('[data-test="alert-library-install-error-k8s/node-disk-pressure"]')
      .text();
    expect(message).not.toContain("is not a function");
    expect(message).not.toContain("unreadable_conditions");
    expect(message).toContain("cannot read");
  });

  it("announces only what the retry created, not what it announced before", async () => {
    mocks.createAlert
      .mockResolvedValueOnce({ data: {} })
      .mockRejectedValueOnce({ response: { data: { message: "boom" } } })
      .mockResolvedValueOnce({ data: {} });

    const wrapper = await mountBatch();
    await advanceToInstall(wrapper);
    await click(wrapper, "alert-library-install-run");

    mocks.createAlert.mockResolvedValue({ data: {} });
    await click(wrapper, "alert-library-install-retry");

    const installed = wrapper.emitted("installed");
    expect(installed).toHaveLength(2);
    // A consumer adding these up must not count the first pass twice.
    expect(installed?.[1]?.[0]).toEqual({ entryIds: ["k8s/node-disk-pressure"] });
  });

  it("starts from the first step again when reopened", async () => {
    const wrapper = await mountDialog();
    await click(wrapper, "alert-library-install-next");
    expect(wrapper.find('[data-test="alert-library-install-tune-step"]').exists()).toBe(true);

    await wrapper.setProps({ open: false });
    await wrapper.setProps({ open: true });
    await flushPromises();

    expect(wrapper.find('[data-test="alert-library-install-folder-step"]').exists()).toBe(true);
  });

  it("forgets the previous run when reopened", async () => {
    const wrapper = await mountDialog();
    await advanceToInstall(wrapper);
    await click(wrapper, "alert-library-install-run");
    expect(wrapper.findAll('[data-test^="alert-library-install-result-"]')).toHaveLength(1);

    await wrapper.setProps({ open: false });
    await wrapper.setProps({ open: true });
    await flushPromises();

    expect(wrapper.findAll('[data-test^="alert-library-install-result-"]')).toHaveLength(0);
  });

  it("installs the alert the drawer handed over on the latest open", async () => {
    const wrapper = await mountDialog();
    await wrapper.setProps({ open: false });
    await wrapper.setProps({ seed: { entry: thirdEntry(), file: libraryFile("cert-expiring") } });
    await wrapper.setProps({ open: true });
    await flushPromises();

    await advanceToInstall(wrapper);
    await click(wrapper, "alert-library-install-run");
    expect(mocks.createAlert.mock.calls.map((call) => call[1].name)).toEqual(["cert-expiring"]);
  });

  // The stub above renders the panel inline and has no close button, which makes
  // this whole class of bug invisible. ODialog's own X is NOT gated by
  // `persistent` (only Escape and interact-outside are) and it self-closes via
  // its internal open state, so refusing its `update:open` would leave the panel
  // gone, the parent still holding `open`, and the run unreachable.
  describe("against the real ODialog", () => {
    const realStubs = { ...stubs } as Record<string, unknown>;
    delete realStubs.ODialog;

    const inBody = (test: string) =>
      document.body.querySelector(`[data-test="${test}"]`) as HTMLElement | null;

    const clickInBody = async (test: string) => {
      inBody(test)?.click();
      await flushPromises();
    };

    let wrapper: ReturnType<typeof mount> | null = null;

    afterEach(() => {
      wrapper?.unmount();
      wrapper = null;
      document.body.innerHTML = "";
    });

    it("takes the close button away while creates are in flight", async () => {
      let release: (value: unknown) => void = () => {};
      mocks.createAlert.mockReturnValue(
        new Promise((resolve) => {
          release = resolve;
        }),
      );

      wrapper = mount(LibraryInstallDialog, {
        props: {
          open: true,
          preselect: [],
          seed: { entry: seedEntry(), file: libraryFile("pod-oom-killed") },
        },
        global: { plugins: [i18n, store], stubs: realStubs },
        attachTo: document.body,
      });
      await flushPromises();

      expect(inBody("o-dialog-close-btn")).not.toBeNull();

      await clickInBody("alert-library-install-next");
      await clickInBody("alert-library-install-next");
      await clickInBody("alert-library-install-run");

      // Mid-run: no way to dismiss the panel and strand the batch.
      expect(inBody("o-dialog-close-btn")).toBeNull();

      release({ data: {} });
      await flushPromises();

      // Back once the run is over, so the results are dismissable.
      expect(inBody("o-dialog-close-btn")).not.toBeNull();
    });
  });

  it("loads nothing while closed", async () => {
    await mountDialog({ open: false });
    expect(mocks.loadAlertFile).not.toHaveBeenCalled();
    expect(mocks.getFoldersListByType).not.toHaveBeenCalled();
  });
  describe("the tune step's hint", () => {
    const hintOf = async () => {
      const wrapper = await mountDialog();
      await click(wrapper, "alert-library-install-next");
      return wrapper.get('[data-test="alert-library-install-tune-hint"]').text();
    };

    it("names the two settings it is talking about", async () => {
      // "Only these two are safe to set" pointed at nothing: the fields it means
      // are hidden until the toggle below it is ticked.
      const hint = await hintOf();
      expect(hint).toContain(i18n.global.t("alert_library.install.frequency"));
      expect(hint).toContain(i18n.global.t("alert_library.install.silence"));
    });

    it("takes those names from the field labels, so they cannot drift apart", async () => {
      const wrapper = await mountDialog();
      await click(wrapper, "alert-library-install-next");
      await wrapper.find('[data-test="alert-library-install-tune-toggle"]').setValue(true);
      await flushPromises();

      const hint = wrapper.get('[data-test="alert-library-install-tune-hint"]').text();
      for (const test of ["tune-frequency", "tune-silence"]) {
        const label = wrapper
          .get(`[data-test="alert-library-install-${test}"]`)
          .attributes("data-label");
        expect(label).toBeTruthy();
        expect(hint).toContain(label);
      }
    });
  });

  // ── preselection from the gallery ─────────────────────────────────────────
  describe("preselect", () => {
    const offView = () =>
      entry({
        id: "kafka/consumer-lag",
        name: "consumer-lag",
        pack: "kafka",
        title: "Consumer Lag Growing",
        content_hash: "hash-9",
      });

    it("installs exactly the alerts the gallery handed over", async () => {
      const wrapper = await mountDialog({ seed: null, preselect: [seedEntry(), thirdEntry()] });
      await advanceToInstall(wrapper);
      await click(wrapper, "alert-library-install-run");

      expect(mocks.createAlert.mock.calls.map((call) => call[1].name)).toEqual([
        "pod-oom-killed",
        "cert-expiring",
      ]);
    });

    it("creates an alert the gallery's current filters hide", async () => {
      // The batch outlives the filters: it was frozen when the user pressed Add.
      mocks.loadAlertFile.mockResolvedValue(libraryFile("consumer-lag"));
      const wrapper = await mountDialog({ seed: null, preselect: [offView()] });
      await advanceToInstall(wrapper);
      await click(wrapper, "alert-library-install-run");

      expect(statusOf(wrapper, "kafka/consumer-lag")).toBe("installed");
    });

    it("tells the gallery nothing until an alert is actually added", async () => {
      const wrapper = await mountDialog({ seed: null, preselect: [seedEntry(), secondEntry()] });
      await advanceToInstall(wrapper);

      expect(Object.keys(wrapper.emitted())).not.toContain("installed");
      expect(Object.keys(wrapper.emitted())).not.toContain("update:preselect");
    });
  });

  // ── large batches ─────────────────────────────────────────────────────────
  describe("large batch confirmation", () => {
    const many = (count: number) =>
      Array.from({ length: count }, (_unused, index) =>
        entry({
          id: `k8s/bulk-${index}`,
          name: `bulk-${index}`,
          title: `Bulk Alert ${index}`,
          content_hash: `hash-bulk-${index}`,
        }),
      );

    const runButton = (wrapper: any) => wrapper.find('[data-test="alert-library-install-run"]');

    it("asks before a run big enough to reshape the org's alerting", async () => {
      // The catalog is ~1,242 alerts and select-all-in-view is one click, so
      // the largest batches must be deliberate rather than merely reachable.
      const wrapper = await mountDialog({ seed: null, preselect: many(51) });
      await advanceToInstall(wrapper);

      const confirm = wrapper.find('[data-test="alert-library-install-confirm-large"]');
      expect(confirm.exists()).toBe(true);
      // Unticked by default, or the disabled run button is the only guard and
      // the acknowledgement is one nobody made.
      expect((confirm.element as HTMLInputElement).checked).toBe(false);
      expect(runButton(wrapper).attributes("disabled")).toBeDefined();

      await confirm.setValue(true);
      await flushPromises();
      expect(runButton(wrapper).attributes("disabled")).toBeUndefined();
    });

    it("stays out of the way for an ordinary batch", async () => {
      const wrapper = await mountDialog({ seed: null, preselect: many(50) });
      await advanceToInstall(wrapper);

      expect(wrapper.find('[data-test="alert-library-install-confirm-large"]').exists()).toBe(
        false,
      );
      expect(runButton(wrapper).attributes("disabled")).toBeUndefined();
    });

    it("drops the acknowledgement when the batch changes under it", async () => {
      const wrapper = await mountDialog({ seed: null, preselect: many(51) });
      await advanceToInstall(wrapper);
      await wrapper.find('[data-test="alert-library-install-confirm-large"]').setValue(true);
      await flushPromises();
      expect(runButton(wrapper).attributes("disabled")).toBeUndefined();

      await wrapper.setProps({ preselect: many(52) });
      await flushPromises();

      const confirm = wrapper.get('[data-test="alert-library-install-confirm-large"]');
      expect((confirm.element as HTMLInputElement).checked).toBe(false);
      expect(runButton(wrapper).attributes("disabled")).toBeDefined();
    });

    it("states the count and folder it is asking about, and that none notify yet", async () => {
      const wrapper = await mountDialog({ seed: null, preselect: many(51) });
      await advanceToInstall(wrapper);

      const label = wrapper
        .find('[data-test="alert-library-install-confirm-large"]')
        .attributes("data-label");
      expect(label).toContain("51");
      expect(label).toContain("default");
      expect(label).toContain("none of which notify");
    });

    it("drops the acknowledgement when the folder changes under it", async () => {
      const wrapper = await mountDialog({ seed: null, preselect: many(51) });
      await advanceToInstall(wrapper);
      await wrapper.find('[data-test="alert-library-install-confirm-large"]').setValue(true);
      await flushPromises();

      await click(wrapper, "alert-library-install-back");
      await click(wrapper, "alert-library-install-back");
      wrapper
        .findComponent({ name: "SelectFolderDropDown" })
        .vm.$emit("folder-selected", { value: "prod", label: "Production" });
      await flushPromises();
      await click(wrapper, "alert-library-install-next");
      await click(wrapper, "alert-library-install-next");

      const confirm = wrapper.get('[data-test="alert-library-install-confirm-large"]');
      expect((confirm.element as HTMLInputElement).checked).toBe(false);
      expect(runButton(wrapper).attributes("disabled")).toBeDefined();
    });

    it("forgets the acknowledgement when the dialog is reopened", async () => {
      const wrapper = await mountDialog({ seed: null, preselect: many(51) });
      await advanceToInstall(wrapper);
      await wrapper.find('[data-test="alert-library-install-confirm-large"]').setValue(true);
      await flushPromises();

      await wrapper.setProps({ open: false });
      await wrapper.setProps({ open: true });
      await flushPromises();
      await advanceToInstall(wrapper);

      const confirm = wrapper.find('[data-test="alert-library-install-confirm-large"]');
      expect((confirm.element as HTMLInputElement).checked).toBe(false);
      expect(runButton(wrapper).attributes("disabled")).toBeDefined();
    });

    it("counts every alert in a large batch — the count is not capped", async () => {
      const wrapper = await mountDialog({ seed: null, preselect: many(100) });
      await advanceToInstall(wrapper);

      expect(runButton(wrapper).text()).toContain("100");
    });
  });

  describe("anomaly alerts", () => {
    const anomalyEntry = () =>
      entry({
        id: "apm/traces_server_error_ratio_anomaly",
        name: "traces_server_error_ratio_anomaly",
        pack: "apm",
        category: "traces",
        title: "Server error ratio is unusually high",
        severity: "warning",
        stream: "default",
        stream_type: "traces",
        query_type: "sql",
        required_streams: ["default"],
        content_hash: "hash-a",
        alert_type: "anomaly_detection",
      });

    const anomalyFile = (): AlertLibraryFile => ({
      name: "traces_server_error_ratio_anomaly",
      title: "Server error ratio is unusually high",
      severity: "warning",
      source: { project: "openobserve" },
      alert_type: "anomaly_detection",
      stream_type: "traces",
      stream_name: "default",
      enabled: true,
      anomaly_config: {
        query_mode: "filters",
        filters: [{ field: "span_kind", operator: "=", value: "2" }],
        detection_function: "p95",
        detection_function_field: "duration",
        histogram_interval: "5m",
        schedule_interval: "5m",
        detection_window_seconds: 900,
        training_window_days: 28,
        retrain_interval_days: 7,
        alert_direction: "above",
        alert_window_buckets: 3,
        alert_window_fire_pct: 60,
        alert_window_recover_pct: 34,
      },
    });

    const original = { isEnterprise: config.isEnterprise, zoConfig: store.state.zoConfig };

    const setAccess = (isEnterprise: string, enabled: boolean) => {
      (config as { isEnterprise: string }).isEnterprise = isEnterprise;
      store.state.zoConfig = {
        ...original.zoConfig,
        build_type: "enterprise",
        anomaly_detection_enabled: enabled,
      } as typeof original.zoConfig;
    };

    const anomalyPayload = () => mocks.createAnomaly.mock.calls[0]?.[1] as Record<string, any>;

    beforeEach(() => {
      setAccess("true", true);
      mocks.createAnomaly.mockResolvedValue({ data: {} });
      mocks.loadAlertFile.mockImplementation((e: AlertLibraryEntry) =>
        Promise.resolve(e.alert_type === "anomaly_detection" ? anomalyFile() : libraryFile(e.name)),
      );
    });

    afterEach(() => {
      (config as { isEnterprise: string }).isEnterprise = original.isEnterprise;
      store.state.zoConfig = original.zoConfig;
    });

    it("sends each kind of a mixed batch through its own create", async () => {
      const wrapper = await mountDialog({
        seed: null,
        preselect: [seedEntry(), anomalyEntry()],
      });
      await advanceToInstall(wrapper);
      await click(wrapper, "alert-library-install-run");

      expect(mocks.createAlert).toHaveBeenCalledTimes(1);
      expect(payloadFor("pod-oom-killed").alert_type).toBeUndefined();
      expect(mocks.createAnomaly).toHaveBeenCalledTimes(1);
      expect(mocks.createAnomaly.mock.calls[0][2]).toBe("default");
      expect(anomalyPayload()).toMatchObject({
        alert_type: "anomaly_detection",
        enabled: true,
        destinations: [],
        folder_id: "default",
        priority: 3,
      });
      expect(anomalyPayload().anomaly_config).toEqual(anomalyFile().anomaly_config);
      expect(anomalyPayload()).not.toHaveProperty("trigger_condition");
      expect(anomalyPayload()).not.toHaveProperty("title");
      expect(statusOf(wrapper, "apm/traces_server_error_ratio_anomaly")).toBe("installed");
      expect(analytics.track).toHaveBeenCalledWith("library_alert_installed", {
        count: 2,
        anomaly_count: 1,
      });
    });

    it("refreshes the Alerts list as well as the anomaly lists after an anomaly create", async () => {
      const invalidate = vi.spyOn(queryClient, "invalidateQueries");
      const wrapper = await mountDialog({
        seed: { entry: anomalyEntry(), file: anomalyFile() },
      });
      await advanceToInstall(wrapper);
      await click(wrapper, "alert-library-install-run");

      expect(invalidate).toHaveBeenCalledWith({ queryKey: anomalyKeys.all("default") });
      expect(invalidate).toHaveBeenCalledWith({ queryKey: alertKeys.all("default") });
      invalidate.mockRestore();
    });

    it("drops anomaly alerts from the batch when the feature turns off mid-dialog", async () => {
      const wrapper = await mountDialog({
        seed: null,
        preselect: [seedEntry(), anomalyEntry()],
      });
      const runLabel = () => wrapper.find('[data-test="alert-library-install-run"]').text();
      await advanceToInstall(wrapper);
      expect(runLabel()).toContain("2");

      setAccess("true", false);
      await flushPromises();
      expect(runLabel()).toContain("1");

      await click(wrapper, "alert-library-install-run");
      expect(mocks.createAnomaly).not.toHaveBeenCalled();
      expect(mocks.createAlert).toHaveBeenCalledTimes(1);
    });

    it("disables Run when the feature turns off under an anomaly-only batch", async () => {
      const wrapper = await mountDialog({
        seed: { entry: anomalyEntry(), file: anomalyFile() },
      });
      await advanceToInstall(wrapper);

      setAccess("true", false);
      await flushPromises();

      const run = wrapper.find('[data-test="alert-library-install-run"]');
      expect(run.attributes("disabled")).toBeDefined();
      await run.trigger("click");
      await flushPromises();
      expect(mocks.createAnomaly).not.toHaveBeenCalled();
    });

    it("says the Tune step applies to threshold alerts only in a mixed batch", async () => {
      const wrapper = await mountDialog({
        seed: null,
        preselect: [seedEntry(), anomalyEntry()],
      });
      await click(wrapper, "alert-library-install-next");

      expect(wrapper.find('[data-test="alert-library-install-tune-threshold-only"]').exists()).toBe(
        true,
      );
    });

    it("skips the Tune step for an anomaly-only batch, both ways", async () => {
      const wrapper = await mountDialog({
        seed: { entry: anomalyEntry(), file: anomalyFile() },
      });
      expect(wrapper.find('[data-test="alert-library-install-tune-step"]').exists()).toBe(false);
      expect(stepTitles(wrapper)).toEqual(["Folder", "Add"]);

      await click(wrapper, "alert-library-install-next");
      expect(wrapper.find('[data-test="alert-library-install-run"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="alert-library-install-summary"]').text()).not.toContain(
        "Tune",
      );

      await click(wrapper, "alert-library-install-back");
      expect(wrapper.find('[data-test="alert-library-install-folder-step"]').exists()).toBe(true);
      await click(wrapper, "alert-library-install-next");
      expect(wrapper.find('[data-test="alert-library-install-run"]').exists()).toBe(true);
    });

    it("notes after the run that anomaly alerts wait for training", async () => {
      const wrapper = await mountDialog({
        seed: { entry: anomalyEntry(), file: anomalyFile() },
      });
      expect(wrapper.find('[data-test="alert-library-install-anomaly-note"]').exists()).toBe(false);
      await advanceToInstall(wrapper);
      await click(wrapper, "alert-library-install-run");

      expect(wrapper.find('[data-test="alert-library-install-anomaly-note"]').exists()).toBe(true);
    });

    it("offers no anomaly alert when the build is not entitled", async () => {
      setAccess("false", true);
      const wrapper = await mountDialog({
        seed: null,
        preselect: [seedEntry(), anomalyEntry()],
      });
      await advanceToInstall(wrapper);
      await click(wrapper, "alert-library-install-run");

      expect(mocks.createAnomaly).not.toHaveBeenCalled();
      expect(mocks.createAlert).toHaveBeenCalledTimes(1);
      expect(
        wrapper
          .find('[data-test="alert-library-install-result-apm/traces_server_error_ratio_anomaly"]')
          .exists(),
      ).toBe(false);
    });

    it("refuses to send a file declaring an anomaly alert when the feature is off", async () => {
      setAccess("true", false);
      mocks.loadAlertFile.mockResolvedValue(anomalyFile());
      const wrapper = await mountDialog({ seed: null, preselect: [secondEntry()] });
      await advanceToInstall(wrapper);
      await click(wrapper, "alert-library-install-run");

      expect(mocks.createAnomaly).not.toHaveBeenCalled();
      expect(mocks.createAlert).not.toHaveBeenCalled();
      expect(statusOf(wrapper, "k8s/node-disk-pressure")).toBe("failed");
      expect(
        wrapper.find('[data-test="alert-library-install-error-k8s/node-disk-pressure"]').text(),
      ).toContain("Enterprise");
    });
  });
});
