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

const mocks = vi.hoisted(() => ({
  loadAlertFile: vi.fn(),
  listDestinations: vi.fn(),
  createAlert: vi.fn(),
  getFoldersListByType: vi.fn(),
  validateCredentials: vi.fn(() => ({ isValid: true, errors: {} })),
  testDestination: vi.fn(),
  createDestination: vi.fn(),
  updateDestination: vi.fn(),
  fetchSystemTemplates: vi.fn(),
  toast: vi.fn(),
  resolveRoute: vi.fn(),
}));

// Every partial mock below spreads the REAL module and overrides only what the
// test drives. A hand-listed subset silently removes the other members, so an
// implementation that touches one dies at mount and reads as a component bug
// rather than as the missing test double it is.
vi.mock("vue-router", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("vue-router");
  return { ...actual, useRouter: () => ({ resolve: mocks.resolveRoute }) };
});

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

vi.mock("@/services/alert_destination", async () => {
  const actual = await vi.importActual<{ default: Record<string, unknown> }>(
    "@/services/alert_destination",
  );
  return { ...actual, default: { ...actual.default, list: mocks.listDestinations } };
});

vi.mock("@/services/alerts", async () => {
  const actual = await vi.importActual<{ default: Record<string, unknown> }>("@/services/alerts");
  return { ...actual, default: { ...actual.default, create_by_alert_id: mocks.createAlert } };
});

vi.mock("@/utils/commons", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@/utils/commons");
  return { ...actual, getFoldersListByType: mocks.getFoldersListByType };
});

// Safe to call the real factory: `fetchSystemTemplates` is only ever invoked
// from inside the other methods, never at construction, so nothing reaches the
// network just by building the composable.
vi.mock("@/composables/usePrebuiltDestinations", async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    "@/composables/usePrebuiltDestinations",
  );
  return {
    ...actual,
    usePrebuiltDestinations: () => ({
      ...(actual.usePrebuiltDestinations as () => Record<string, unknown>)(),
      fetchSystemTemplates: mocks.fetchSystemTemplates,
      validateCredentials: mocks.validateCredentials,
      testDestination: mocks.testDestination,
      createDestination: mocks.createDestination,
      updateDestination: mocks.updateDestination,
    }),
  };
});

vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: mocks.toast }));

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

const OSelectStub = {
  name: "OSelect",
  props: ["modelValue", "options", "label", "size", "placeholder", "errorMessage"],
  emits: ["update:modelValue"],
  template:
    '<select :data-test="$attrs[\'data-test\']" :data-value="modelValue" ' +
    ":data-options=\"(options || []).map((o) => o.value ?? o).join(',')\" " +
    "@change=\"$emit('update:modelValue', $event.target.value)\">" +
    '<option v-for="o in options || []" :key="o.value ?? o" :value="o.value ?? o" />' +
    "</select>",
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
    "@input=\"$emit('update:modelValue', $event.target.value)\" />",
};

const OCheckboxStub = {
  name: "OCheckbox",
  props: ["modelValue", "label", "size", "disabled"],
  emits: ["update:modelValue"],
  template:
    '<input type="checkbox" :data-test="$attrs[\'data-test\']" :checked="modelValue === true" ' +
    "@change=\"$emit('update:modelValue', $event.target.checked)\" />",
};

const SelectFolderStub = {
  name: "SelectFolderDropDown",
  props: ["activeFolderId", "type"],
  emits: ["folder-selected"],
  template: '<div data-test="folder-picker" :data-type="type" :data-active="activeFolderId" />',
};

const PrebuiltSelectorStub = {
  name: "PrebuiltDestinationSelector",
  props: ["modelValue"],
  emits: ["update:modelValue", "select"],
  template: '<div data-test="prebuilt-selector" :data-value="modelValue" />',
};

const stubs = {
  ODialog: ODialogStub,
  OSelect: OSelectStub,
  OInput: OInputStub,
  OCheckbox: OCheckboxStub,
  SelectFolderDropDown: SelectFolderStub,
  PrebuiltDestinationSelector: PrebuiltSelectorStub,
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
      entries: entries(),
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

/** Walk Destination → Alerts → Folder → Tune → Install with the defaults. */
const advanceToInstall = async (wrapper: any) => {
  await wrapper.find('[data-test="alert-library-install-destination"]').setValue("ops-slack");
  await flushPromises();
  await click(wrapper, "alert-library-install-next");
  await click(wrapper, "alert-library-install-next");
  await click(wrapper, "alert-library-install-next");
  await click(wrapper, "alert-library-install-next");
};

/** Same walk, but installing all three — the batch cases. */
const advanceAllToInstall = async (wrapper: any) => {
  await wrapper.find('[data-test="alert-library-install-destination"]').setValue("ops-slack");
  await flushPromises();
  await click(wrapper, "alert-library-install-next");
  await click(wrapper, "alert-library-install-select-all");
  await click(wrapper, "alert-library-install-next");
  await click(wrapper, "alert-library-install-next");
  await click(wrapper, "alert-library-install-next");
};

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

let windowOpen: ReturnType<typeof vi.spyOn>;

describe("LibraryInstallDialog", () => {
  beforeEach(() => {
    // Reset OUR mocks only. `clearAllMocks` cannot drain an unconsumed `…Once`
    // queue (a leaked one-shot rejection then fails an unrelated test three
    // tests later), but `vi.resetAllMocks()` is too wide: setupTests.ts installs
    // URL.createObjectURL, clipboard.writeText, queryCommandSupported and
    // IntersectionObserver#takeRecords as module-scope mocks, and a global reset
    // strips their implementations for the rest of the file.
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.listDestinations.mockResolvedValue({
      data: [{ name: "ops-slack" }, { name: "oncall-pagerduty" }],
    });
    mocks.loadAlertFile.mockImplementation((e: AlertLibraryEntry) =>
      Promise.resolve(libraryFile(e.name)),
    );
    mocks.createAlert.mockResolvedValue({ data: {} });
    mocks.getFoldersListByType.mockResolvedValue([]);
    mocks.validateCredentials.mockReturnValue({ isValid: true, errors: {} });
    mocks.createDestination.mockResolvedValue(undefined);
    mocks.testDestination.mockResolvedValue({ success: true });
    mocks.resolveRoute.mockReturnValue({ href: "/web/alerts/destinations?action=add" });
    windowOpen = vi.spyOn(window, "open").mockReturnValue(null);
  });

  afterEach(() => {
    windowOpen.mockRestore();
  });

  describe("destination step", () => {
    it("offers the destinations this org actually has", async () => {
      const wrapper = await mountDialog();
      expect(mocks.listDestinations).toHaveBeenCalledWith(
        expect.objectContaining({ org_identifier: "default", module: "alert" }),
      );
      // Membership, not order: sorting or grouping the picker is a display
      // choice, and pinning the API's order forbids it for no reason.
      const options = wrapper
        .find('[data-test="alert-library-install-destination"]')
        .attributes("data-options")
        ?.split(",");
      expect(options).toHaveLength(2);
      expect(options).toEqual(expect.arrayContaining(["ops-slack", "oncall-pagerduty"]));
    });

    it("will not advance until a destination is chosen", async () => {
      const wrapper = await mountDialog();
      expect(
        wrapper.find('[data-test="alert-library-install-next"]').attributes("disabled"),
      ).toBeDefined();

      await wrapper.find('[data-test="alert-library-install-destination"]').setValue("ops-slack");
      expect(
        wrapper.find('[data-test="alert-library-install-next"]').attributes("disabled"),
      ).toBeUndefined();
    });

    it("does not mistake a failed request for an org with no destinations", async () => {
      // A transient GET failure says nothing about how many destinations exist.
      // Forcing create mode on it TRAPS the user: the way back out is hidden
      // exactly when the list is empty, and Back is hidden on step 1 — so an
      // org with fifty destinations could only create a duplicate or quit.
      mocks.listDestinations.mockRejectedValue({ response: { status: 500 } });
      const wrapper = await mountDialog();

      expect(wrapper.find('[data-test="alert-library-install-destinations-failed"]').exists()).toBe(
        true,
      );
      expect(wrapper.find('[data-test="alert-library-install-destination"]').exists()).toBe(true);
      // NOT the empty-org state: the list is unknown, not known to be empty.
      expect(wrapper.find('[data-test="alert-library-install-destinations-empty"]').exists()).toBe(
        false,
      );
      // And a way forward either way.
      expect(wrapper.find('[data-test="alert-library-install-destinations-retry"]').exists()).toBe(
        true,
      );
      expect(wrapper.find('[data-test="alert-library-install-open-destinations"]').exists()).toBe(
        true,
      );
    });

    it("says so plainly when the org genuinely has no destinations", async () => {
      // A legitimate first-run condition, not an error — and no longer
      // something this dialog can fix, so it has to point somewhere real.
      mocks.listDestinations.mockResolvedValue({ data: [] });
      const wrapper = await mountDialog();

      expect(wrapper.find('[data-test="alert-library-install-destinations-empty"]').exists()).toBe(
        true,
      );
      expect(wrapper.find('[data-test="alert-library-install-destinations-failed"]').exists()).toBe(
        false,
      );
      expect(wrapper.find('[data-test="alert-library-install-open-destinations"]').exists()).toBe(
        true,
      );
      // Nothing to pick, so nothing to advance with.
      expect(
        wrapper.find('[data-test="alert-library-install-next"]').attributes("disabled"),
      ).toBeDefined();
    });

    it("routes to the Destinations page for every type, not just a custom one", async () => {
      const wrapper = await mountDialog();
      await click(wrapper, "alert-library-install-open-destinations");

      expect(mocks.resolveRoute).toHaveBeenCalledWith(
        expect.objectContaining({ name: "alertDestinations" }),
      );
      expect(windowOpen).toHaveBeenCalledWith(
        "/web/alerts/destinations?action=add",
        "_blank",
        expect.stringContaining("noopener"),
      );
    });

    it("offers a retry that recovers the list", async () => {
      mocks.listDestinations.mockRejectedValue({ response: { status: 500 } });
      const wrapper = await mountDialog();

      mocks.listDestinations.mockResolvedValue({ data: [{ name: "ops-slack" }] });
      await click(wrapper, "alert-library-install-destinations-retry");

      expect(wrapper.find('[data-test="alert-library-install-destinations-failed"]').exists()).toBe(
        false,
      );
      expect(
        wrapper.find('[data-test="alert-library-install-destination"]').attributes("data-options"),
      ).toBe("ops-slack");
    });
  });

  describe("alerts step", () => {
    it("arrives with the drawer's alert already chosen and the rest offered", async () => {
      const wrapper = await mountDialog();
      await wrapper.find('[data-test="alert-library-install-destination"]').setValue("ops-slack");
      await click(wrapper, "alert-library-install-next");

      const checked = (id: string) =>
        (
          wrapper.find(`[data-test="alert-library-install-alert-${id}"]`)
            .element as HTMLInputElement
        ).checked;
      expect(checked("k8s/pod-oom-killed")).toBe(true);
      expect(checked("k8s/node-disk-pressure")).toBe(false);
      expect(checked("k8s/cert-expiring")).toBe(false);
    });

    it("cannot continue with nothing selected", async () => {
      const wrapper = await mountDialog();
      await wrapper.find('[data-test="alert-library-install-destination"]').setValue("ops-slack");
      await click(wrapper, "alert-library-install-next");

      await wrapper
        .find('[data-test="alert-library-install-alert-k8s/pod-oom-killed"]')
        .setValue(false);
      await flushPromises();
      expect(
        wrapper.find('[data-test="alert-library-install-next"]').attributes("disabled"),
      ).toBeDefined();
    });

    it("survives an empty candidate list without offering a dead Next", async () => {
      const wrapper = await mountDialog({ entries: [], seed: null });
      await wrapper.find('[data-test="alert-library-install-destination"]').setValue("ops-slack");
      await click(wrapper, "alert-library-install-next");

      expect(wrapper.find('[data-test="alert-library-install-alerts-step"]').exists()).toBe(true);
      expect(
        wrapper.find('[data-test="alert-library-install-next"]').attributes("disabled"),
      ).toBeDefined();
    });

    it("offers the seeded alert even when the gallery filter excludes it", async () => {
      // Real: `entries` is the gallery's FILTERED view, and the user may have
      // narrowed it after opening the drawer. Dropping the seed would silently
      // install nothing, or install the wrong alert.
      const wrapper = await mountDialog({
        entries: [secondEntry(), thirdEntry()],
        seed: { entry: seedEntry(), file: libraryFile("pod-oom-killed") },
      });
      await wrapper.find('[data-test="alert-library-install-destination"]').setValue("ops-slack");
      await click(wrapper, "alert-library-install-next");

      const seedRow = wrapper.find('[data-test="alert-library-install-alert-k8s/pod-oom-killed"]');
      expect(seedRow.exists()).toBe(true);
      expect((seedRow.element as HTMLInputElement).checked).toBe(true);

      await click(wrapper, "alert-library-install-next");
      await click(wrapper, "alert-library-install-next");
      await click(wrapper, "alert-library-install-next");
      await click(wrapper, "alert-library-install-run");

      expect(mocks.createAlert).toHaveBeenCalledTimes(1);
      expect(mocks.createAlert.mock.calls[0][1].name).toBe("pod-oom-killed");
    });

    it("goes back to the destination step without losing the choice", async () => {
      const wrapper = await mountDialog();
      await wrapper.find('[data-test="alert-library-install-destination"]').setValue("ops-slack");
      await click(wrapper, "alert-library-install-next");
      await click(wrapper, "alert-library-install-back");

      expect(wrapper.find('[data-test="alert-library-install-destination-step"]').exists()).toBe(
        true,
      );
      expect(
        wrapper.find('[data-test="alert-library-install-destination"]').attributes("data-value"),
      ).toBe("ops-slack");
    });

    it("selects and clears every offered alert in one click", async () => {
      const wrapper = await mountDialog();
      await wrapper.find('[data-test="alert-library-install-destination"]').setValue("ops-slack");
      await click(wrapper, "alert-library-install-next");

      // Read the numbers as data, not as prose. `toContain("3")` was worse than
      // useless — "0 of 3 selected" contains "3" — but exact text couples the
      // test to the copy AND to source formatting, since VTU's `text()` trims
      // the ends without collapsing interior whitespace, so a Prettier rewrap
      // of the template would fail a correct component.
      const count = () => wrapper.find('[data-test="alert-library-install-count"]');

      await click(wrapper, "alert-library-install-select-all");
      expect(count().attributes("data-selected")).toBe("3");
      expect(count().attributes("data-total")).toBe("3");

      await click(wrapper, "alert-library-install-clear");
      expect(count().attributes("data-selected")).toBe("0");
      expect(count().attributes("data-total")).toBe("3");
    });
  });

  describe("folder step", () => {
    it("refreshes the alert folder list on reaching the step, not before", async () => {
      const wrapper = await mountDialog();
      await wrapper.find('[data-test="alert-library-install-destination"]').setValue("ops-slack");
      await click(wrapper, "alert-library-install-next");

      // WHEN is the whole claim: SelectFolderDropDown refreshes itself only on
      // `onActivated`, which a dialog never fires. Asserting only that it was
      // called eventually would pass on a fetch at mount, which is the bug.
      expect(mocks.getFoldersListByType).not.toHaveBeenCalled();

      await click(wrapper, "alert-library-install-next");
      expect(mocks.getFoldersListByType).toHaveBeenCalledWith(expect.anything(), "alerts");
      expect(wrapper.find('[data-test="folder-picker"]').attributes("data-type")).toBe("alerts");
    });

    it("installs into the folder the picker reports", async () => {
      const wrapper = await mountDialog();
      await wrapper.find('[data-test="alert-library-install-destination"]').setValue("ops-slack");
      await click(wrapper, "alert-library-install-next");
      await click(wrapper, "alert-library-install-next");

      wrapper
        .findComponent({ name: "SelectFolderDropDown" })
        .vm.$emit("folder-selected", { label: "Kubernetes", value: "folder-42" });
      await flushPromises();
      await click(wrapper, "alert-library-install-next");
      await click(wrapper, "alert-library-install-next");
      await click(wrapper, "alert-library-install-run");

      expect(mocks.createAlert).toHaveBeenCalledWith("default", expect.anything(), "folder-42");
    });

    it("still lets the batch install when the folder list cannot be read", async () => {
      // As plausible as the destination 403 already covered. "default" always
      // exists, so a failed refresh must degrade to it rather than trap the run.
      mocks.getFoldersListByType.mockRejectedValue({ response: { status: 403 } });

      const wrapper = await mountDialog();
      await wrapper.find('[data-test="alert-library-install-destination"]').setValue("ops-slack");
      await click(wrapper, "alert-library-install-next");
      await click(wrapper, "alert-library-install-next");

      expect(wrapper.find('[data-test="alert-library-install-folder-step"]').exists()).toBe(true);
      await click(wrapper, "alert-library-install-next");
      await click(wrapper, "alert-library-install-next");
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
      // Wizard-supplied: the chosen destination, the folder, and the store
      // identity/timezone. `owner: undefined` serialises away silently, so
      // nothing else in either spec would notice these were never read.
      expect(payload.destinations).toEqual(["ops-slack"]);
      expect(payload.folder_id).toBe("default");
      expect(mocks.createAlert.mock.calls[0][2]).toBe("default");
      expect(payload.owner).toBe("example@gmail.com");
      expect(payload.last_edited_by).toBe("example@gmail.com");
      expect(payload.trigger_condition.timezone).toBe("UTC");
      // A builder-owned transform, as the one signal it really ran.
      expect("id" in payload).toBe(false);
    });

    it("builds each alert from its own entry, not from the seed's", async () => {
      const wrapper = await mountDialog();
      await advanceAllToInstall(wrapper);
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

    it("fetches the file for an alert the drawer never opened, and only those", async () => {
      const wrapper = await mountDialog();
      await advanceAllToInstall(wrapper);
      await click(wrapper, "alert-library-install-run");

      expect(mocks.loadAlertFile).toHaveBeenCalledTimes(2);
      expect(mocks.loadAlertFile.mock.calls.map((call) => call[0].id)).toEqual([
        "k8s/node-disk-pressure",
        "k8s/cert-expiring",
      ]);
      expect(mocks.createAlert).toHaveBeenCalledTimes(3);
    });

    it("applies the bulk-tuned pair to every alert in the batch", async () => {
      const wrapper = await mountDialog();
      await wrapper.find('[data-test="alert-library-install-destination"]').setValue("ops-slack");
      await click(wrapper, "alert-library-install-next");
      await click(wrapper, "alert-library-install-select-all");
      await click(wrapper, "alert-library-install-next");
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
        await wrapper.find('[data-test="alert-library-install-destination"]').setValue("ops-slack");
        await click(wrapper, "alert-library-install-next");
        await click(wrapper, "alert-library-install-next");
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
      await wrapper.find('[data-test="alert-library-install-destination"]').setValue("ops-slack");
      await click(wrapper, "alert-library-install-next");
      await click(wrapper, "alert-library-install-next");
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

      const wrapper = await mountDialog();
      await advanceAllToInstall(wrapper);
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

      const wrapper = await mountDialog();
      await advanceAllToInstall(wrapper);
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

      const wrapper = await mountDialog();
      await advanceAllToInstall(wrapper);
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

      const wrapper = await mountDialog();
      await advanceAllToInstall(wrapper);
      await click(wrapper, "alert-library-install-run");

      // Times(1) matters: `toHaveBeenCalledWith` scans EVERY call, so an
      // implementation firing both a success and an error toast every run would
      // satisfy this assertion and its success-side twin simultaneously.
      expect(mocks.toast).toHaveBeenCalledTimes(1);
      expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ variant: "error" }));
    });

    it("reports a file that could not be fetched as that alert's failure only", async () => {
      mocks.loadAlertFile.mockRejectedValue(new Error("network down"));

      const wrapper = await mountDialog();
      await advanceAllToInstall(wrapper);
      await click(wrapper, "alert-library-install-run");

      // The seeded alert still installs; the two that needed a fetch do not.
      expect(mocks.createAlert).toHaveBeenCalledTimes(1);
      expect(mocks.createAlert.mock.calls[0][1].name).toBe("pod-oom-killed");
      expect(statusOf(wrapper, "k8s/pod-oom-killed")).toBe("installed");
      expect(statusOf(wrapper, "k8s/node-disk-pressure")).toBe("failed");
      expect(statusOf(wrapper, "k8s/cert-expiring")).toBe("failed");
    });

    it("retries only what failed, and keeps the successes reported", async () => {
      mocks.createAlert
        .mockResolvedValueOnce({ data: {} })
        .mockRejectedValueOnce({ response: { data: { message: "boom" } } })
        .mockResolvedValueOnce({ data: {} });

      const wrapper = await mountDialog();
      await advanceAllToInstall(wrapper);
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

      const wrapper = await mountDialog();
      await advanceAllToInstall(wrapper);
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

      const wrapper = await mountDialog();
      await advanceAllToInstall(wrapper);
      await click(wrapper, "alert-library-install-run");

      const installed = wrapper.emitted("installed");
      expect(installed).toHaveLength(1);
      expect(installed?.[0]?.[0]).toEqual({
        entryIds: ["k8s/pod-oom-killed", "k8s/cert-expiring"],
      });
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
    const wrapper = await mountDialog({ entries: [seedEntry(), seedEntry(), secondEntry()] });
    await wrapper.find('[data-test="alert-library-install-destination"]').setValue("ops-slack");
    await click(wrapper, "alert-library-install-next");
    await click(wrapper, "alert-library-install-select-all");

    expect(wrapper.find('[data-test="alert-library-install-count"]').attributes("data-total")).toBe(
      "2",
    );

    await click(wrapper, "alert-library-install-next");
    await click(wrapper, "alert-library-install-next");
    await click(wrapper, "alert-library-install-next");
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

    const wrapper = await mountDialog();
    await wrapper.find('[data-test="alert-library-install-destination"]').setValue("ops-slack");
    await click(wrapper, "alert-library-install-next");
    await click(wrapper, "alert-library-install-select-all");
    await click(wrapper, "alert-library-install-next");
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

    const wrapper = await mountDialog();
    await advanceAllToInstall(wrapper);
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
    await wrapper.find('[data-test="alert-library-install-destination"]').setValue("ops-slack");
    await click(wrapper, "alert-library-install-next");
    expect(wrapper.find('[data-test="alert-library-install-alerts-step"]').exists()).toBe(true);

    await wrapper.setProps({ open: false });
    await wrapper.setProps({ open: true });
    await flushPromises();

    expect(wrapper.find('[data-test="alert-library-install-destination-step"]').exists()).toBe(
      true,
    );
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

  it("reseeds the selection from the alert the drawer handed over", async () => {
    const wrapper = await mountDialog();
    await wrapper.setProps({ open: false });
    await wrapper.setProps({ seed: { entry: thirdEntry(), file: libraryFile("cert-expiring") } });
    await wrapper.setProps({ open: true });
    await flushPromises();

    await wrapper.find('[data-test="alert-library-install-destination"]').setValue("ops-slack");
    await click(wrapper, "alert-library-install-next");
    expect(
      (
        wrapper.find('[data-test="alert-library-install-alert-k8s/cert-expiring"]')
          .element as HTMLInputElement
      ).checked,
    ).toBe(true);
    expect(
      (
        wrapper.find('[data-test="alert-library-install-alert-k8s/pod-oom-killed"]')
          .element as HTMLInputElement
      ).checked,
    ).toBe(false);
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

    it("gives every alert checkbox an accessible name", async () => {
      // OCheckbox names itself from `label` alone. Without it a screen-reader
      // user hears "checkbox, unchecked" once per alert with no way to tell
      // which one they are about to install.
      const checkboxStubs = { ...realStubs } as Record<string, unknown>;
      checkboxStubs.ODialog = ODialogStub;
      delete checkboxStubs.OCheckbox;

      wrapper = mount(LibraryInstallDialog, {
        props: {
          open: true,
          entries: entries(),
          seed: { entry: seedEntry(), file: libraryFile("pod-oom-killed") },
        },
        global: { plugins: [i18n, store], stubs: checkboxStubs },
      });
      await flushPromises();

      const select = wrapper.find('[data-test="alert-library-install-destination"]');
      await select.setValue("ops-slack");
      await click(wrapper, "alert-library-install-next");

      const row = wrapper.find('[data-test="alert-library-install-alert-k8s/pod-oom-killed"]');
      expect(row.exists()).toBe(true);
      expect(row.text()).toContain("Pod OOM Killed");
      expect(row.find('[role="checkbox"]').exists()).toBe(true);
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
          entries: entries(),
          seed: { entry: seedEntry(), file: libraryFile("pod-oom-killed") },
        },
        global: { plugins: [i18n, store], stubs: realStubs },
        attachTo: document.body,
      });
      await flushPromises();

      expect(inBody("o-dialog-close-btn")).not.toBeNull();

      const select = inBody("alert-library-install-destination") as HTMLSelectElement;
      select.value = "ops-slack";
      select.dispatchEvent(new Event("change"));
      await flushPromises();

      await clickInBody("alert-library-install-next");
      await clickInBody("alert-library-install-next");
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

  it("loads no destinations while closed", async () => {
    await mountDialog({ open: false });
    expect(mocks.listDestinations).not.toHaveBeenCalled();
    expect(mocks.loadAlertFile).not.toHaveBeenCalled();
    expect(mocks.getFoldersListByType).not.toHaveBeenCalled();
  });
});
