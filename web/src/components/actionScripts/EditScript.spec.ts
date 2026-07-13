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
//
// Migrated to OForm + Zod (EditScript.schema.ts). The old manual-validation
// internals (nameError / typeError / cronFieldError / serviceAccountError /
// cronError refs, validateActionScriptData, validateFrequency) are gone — the
// schema gates the save. These tests therefore drive the REAL <OForm> and assert
// behavior (empty/invalid → save blocked; valid → service called), plus a test
// per restored dropped/conditional validation (name regex, codeZip-on-create,
// cron-when-scheduled-repeat).

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { nextTick } from "vue";
import EditScript from "@/components/actionScripts/EditScript.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import actions from "@/services/action_scripts";
import { toast } from "@/lib/feedback/Toast/useToast";

const node = document.createElement("div");
node.setAttribute("id", "app");
node.style.height = "1024px";
document.body.appendChild(node);

// Mock services
vi.mock("@/services/action_scripts", () => ({
  default: {
    create: vi
      .fn()
      .mockResolvedValue({ data: { code: 200, message: "Success" } }),
    update: vi
      .fn()
      .mockResolvedValue({ data: { code: 200, message: "Success" } }),
    get_by_id: vi.fn().mockResolvedValue({
      data: {
        id: "test-id",
        name: "Test Action",
        description: "Test Description",
        type: "scheduled",
        execution_details: "repeat",
        cron_expr: "0 0 * * *",
        service_account: "test@example.com",
        environment_variables: {},
        zip_file_name: "test.zip",
      },
    }),
  },
}));

vi.mock("@/services/service_accounts", () => ({
  default: {
    list: vi.fn().mockResolvedValue({
      data: {
        data: [
          { email: "service1@example.com" },
          { email: "service2@example.com" },
        ],
      },
    }),
  },
}));

// Keep the real Toast module (other exports stay intact) but replace `toast`
// with a spy that returns a dismiss fn — so we can assert the error toast on a
// failed save without rendering into the DOM.
vi.mock("@/lib/feedback/Toast/useToast", async (importActual) => {
  const actual =
    await importActual<typeof import("@/lib/feedback/Toast/useToast")>();
  return { ...actual, toast: vi.fn(() => () => {}) };
});

describe("EditScript", () => {
  let wrapper: any;

  // Set a form-owned field on the REAL OForm (the single source of truth).
  const setField = (w: any, name: string, value: unknown) =>
    w.vm.form.setFieldValue(name, value);

  // Drive the form's own submit so the schema runs + the handler is awaited
  // deterministically (a fire-and-forget native submit would not be).
  const submit = async (w: any) => {
    await w.vm.form.handleSubmit();
    await flushPromises();
  };

  beforeEach(async () => {
    // The action_scripts service is a module mock; its vi.fn() call history is
    // NOT reset by restoreAllMocks(), so clear the call counts we assert on.
    (actions.create as any).mockClear();
    (actions.update as any).mockClear();
    // Reset the toast spy each test and re-assert its dismiss-fn implementation
    // (restoreAllMocks in afterEach can strip it).
    (toast as any).mockClear();
    (toast as any).mockImplementation(() => () => {});

    vi.spyOn(router, "currentRoute", "get").mockReturnValue({
      value: {
        query: {
          org_identifier: "default",
        },
        name: "actionScripts",
      },
    } as any);

    wrapper = mount(EditScript, {
      attachTo: "#app",
      props: {},
      global: {
        plugins: [i18n, router],
        provide: { store },
        stubs: {
          ConfirmDialog: {
            template: '<div data-test="confirm-dialog">Confirm Dialog</div>',
            props: ["title", "message"],
            emits: ["update:ok", "update:cancel"],
          },
        },
      },
    });

    await flushPromises();
  });

  afterEach(() => {
    if (wrapper) wrapper.unmount();
    vi.clearAllTimers();
    vi.restoreAllMocks();
  });

  it("should mount EditScript component", () => {
    expect(wrapper.exists()).toBe(true);
    expect(
      wrapper.find('[data-test="add-action-script-section"]').exists(),
    ).toBe(true);
  });

  describe("Header section", () => {
    it("should display back button", () => {
      expect(
        wrapper.find('[data-test="add-action-script-back-btn"]').exists(),
      ).toBe(true);
    });

    it("should navigate back when back button is clicked", async () => {
      const routerBackSpy = vi.spyOn(router, "back");
      await wrapper
        .find('[data-test="add-action-script-back-btn"]')
        .trigger("click");
      expect(routerBackSpy).toHaveBeenCalled();
    });

    it("should display correct title for add mode", () => {
      const title = wrapper.find('[data-test="add-action-script-title"]');
      expect(title.exists()).toBe(true);
      expect(title.text()).toContain("New");
    });

    it("should display correct title for edit mode", async () => {
      wrapper.vm.isEditingActionScript = true;
      await nextTick();
      const title = wrapper.find('[data-test="add-action-script-title"]');
      expect(title.text()).toContain("Update");
    });
  });

  describe("Form fields (OForm* wiring + data-tests preserved)", () => {
    it("renders the name OForm input", () => {
      expect(
        wrapper.find('[data-test="add-action-script-name-input"]').exists(),
      ).toBe(true);
    });

    it("renders the description OForm input", () => {
      expect(
        wrapper
          .find('[data-test="add-action-script-description-input"]')
          .exists(),
      ).toBe(true);
    });

    it("renders the type OForm select", () => {
      expect(
        wrapper.find('[data-test="add-action-script-type-select"]').exists(),
      ).toBe(true);
    });

    it("seeds the form from default values (blank create form)", () => {
      const values = wrapper.vm.form.state.values;
      expect(values.name).toBe("");
      expect(values.type).toBe("scheduled");
      expect(values.timezone).toBe("UTC");
      expect(values.frequencyType).toBe("once");
    });

    it("does not show field errors before the first submit (R3)", () => {
      expect(
        wrapper
          .find('[data-test="add-action-script-name-input-error"]')
          .exists(),
      ).toBe(false);
    });
  });

  describe("Schema validation (real OForm)", () => {
    it("blocks submit and does NOT call the service when required fields are empty", async () => {
      await submit(wrapper);

      expect(wrapper.vm.form.state.isValid).toBe(false);
      expect(actions.create).not.toHaveBeenCalled();
    });

    it("submits and calls the service when the schema passes", async () => {
      vi.spyOn(router, "replace").mockResolvedValue(undefined as any);
      (actions.create as any).mockResolvedValue({ data: { code: 200 } });

      // create + scheduled/once → cron not required; codeZip required on create.
      setField(wrapper, "name", "valid_action");
      setField(wrapper, "service_account", "service1@example.com");
      setField(wrapper, "codeZip", new File(["code"], "script.zip"));
      await nextTick();

      await submit(wrapper);

      expect(wrapper.vm.form.state.isValid).toBe(true);
      expect(actions.create).toHaveBeenCalledTimes(1);
    });

    it("rejects a name with invalid resource characters", async () => {
      setField(wrapper, "name", "bad name?");
      setField(wrapper, "service_account", "service1@example.com");
      setField(wrapper, "codeZip", new File(["code"], "script.zip"));
      await nextTick();

      await submit(wrapper);

      expect(wrapper.vm.form.state.isValid).toBe(false);
      expect(actions.create).not.toHaveBeenCalled();
    });

    it("requires codeZip on create (restored dropped validation)", async () => {
      setField(wrapper, "name", "valid_action");
      setField(wrapper, "service_account", "service1@example.com");
      // No codeZip → must be blocked on create.
      await nextTick();

      await submit(wrapper);

      expect(wrapper.vm.form.state.isValid).toBe(false);
      expect(actions.create).not.toHaveBeenCalled();
    });

    it("does NOT block a NEVER-TOUCHED blank cron on create (main's latent gap, preserved)", async () => {
      vi.spyOn(router, "replace").mockResolvedValue(undefined as any);
      (actions.create as any).mockResolvedValue({ data: { code: 200 } });

      // Repeat schedule, but the user never touches the cron field. On main the
      // inline @update handler never fired and the submit-path gate keys off
      // execution_details, which stays "" on create — so a blank cron saved. We
      // preserve that exactly: cron is left untouched here.
      wrapper.vm.frequency.type = "repeat";
      await nextTick();

      setField(wrapper, "name", "valid_action");
      setField(wrapper, "service_account", "service1@example.com");
      setField(wrapper, "codeZip", new File(["code"], "script.zip"));
      await nextTick();

      await submit(wrapper);

      expect(wrapper.vm.form.state.isValid).toBe(true);
      expect(actions.create).toHaveBeenCalledTimes(1);
    });

    it("blocks an invalid cron on create ONCE the field is edited (restored inline handler)", async () => {
      wrapper.vm.frequency.type = "repeat";
      await nextTick();

      setField(wrapper, "name", "valid_action");
      setField(wrapper, "service_account", "service1@example.com");
      setField(wrapper, "codeZip", new File(["code"], "script.zip"));
      // Editing the cron field flips the sticky "edited" flag → cron now validates,
      // exactly like main's inline @update handler once the user typed.
      setField(wrapper, "cron", "not a cron");
      await nextTick();

      await submit(wrapper);

      expect(wrapper.vm.form.state.isValid).toBe(false);
      expect(actions.create).not.toHaveBeenCalled();
    });

    it("accepts a valid cron when scheduled + repeat", async () => {
      vi.spyOn(router, "replace").mockResolvedValue(undefined as any);
      (actions.create as any).mockResolvedValue({ data: { code: 200 } });

      wrapper.vm.frequency.type = "repeat";
      await nextTick();

      setField(wrapper, "name", "valid_action");
      setField(wrapper, "service_account", "service1@example.com");
      setField(wrapper, "codeZip", new File(["code"], "script.zip"));
      setField(wrapper, "cron", "0 0 * * *");
      await nextTick();

      await submit(wrapper);

      expect(wrapper.vm.form.state.isValid).toBe(true);
      expect(actions.create).toHaveBeenCalledTimes(1);
    });

    it("jumps to step 3 and surfaces the server error when the save service errors", async () => {
      vi.spyOn(router, "replace").mockResolvedValue(undefined as any);
      (actions.create as any).mockRejectedValueOnce({
        response: { status: 500, data: { message: "fail" } },
      });

      setField(wrapper, "name", "valid_action");
      setField(wrapper, "service_account", "service1@example.com");
      setField(wrapper, "codeZip", new File(["code"], "script.zip"));
      await nextTick();

      await submit(wrapper);

      // The schema passed (valid form) — it was the API that rejected — so we
      // stay on the form, land on step 3, and surface the server's message.
      expect(wrapper.vm.step).toBe(3);
      expect(wrapper.vm.form.state.isValid).toBe(true);
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "error", message: "fail" }),
      );
    });
  });

  describe("Payload parity (exact object handed to actions.create)", () => {
    it("builds the exact FormData payload — keys + value types — on create", async () => {
      vi.spyOn(router, "replace").mockResolvedValue(undefined as any);
      const file = new File(["code"], "script.zip");
      setField(wrapper, "name", "valid_action");
      setField(wrapper, "description", "my description");
      setField(wrapper, "service_account", "service1@example.com");
      setField(wrapper, "codeZip", file);
      await nextTick();

      await submit(wrapper);

      expect(actions.create).toHaveBeenCalledTimes(1);
      const [org, actionId, payload] = (actions.create as any).mock.calls[0];
      expect(org).toBe("default");
      expect(actionId).toBe(""); // no route id on create
      expect(payload).toBeInstanceOf(FormData);

      // EXACT set of keys — none added (no schema-helper leak), none dropped/renamed.
      expect([...payload.keys()].sort()).toEqual(
        [
          "description",
          "environment_variables",
          "execution_details",
          "file",
          "filename",
          "name",
          "owner",
          "service_account",
        ].sort(),
      );

      // Values + types.
      expect(payload.get("name")).toBe("valid_action");
      expect(typeof payload.get("name")).toBe("string");
      expect(payload.get("description")).toBe("my description");
      expect(payload.get("execution_details")).toBe("once"); // scheduled + once
      expect(payload.get("service_account")).toBe("service1@example.com");
      expect(payload.get("environment_variables")).toBe("{}"); // empty map → "{}"
      expect(payload.get("owner")).toBe("example@gmail.com");
      expect(payload.get("filename")).toBe("script.zip");
      expect(payload.get("file")).toBeInstanceOf(File); // codeZip is a File, not a string

      // Conditional key absent on a non-repeat schedule.
      expect(payload.has("cron_expr")).toBe(false);
      // No edit-only `id` key on create.
      expect(payload.has("id")).toBe(false);
    });

    it("adds cron_expr (string) only when scheduled + repeat", async () => {
      vi.spyOn(router, "replace").mockResolvedValue(undefined as any);
      wrapper.vm.frequency.type = "repeat";
      await nextTick();

      setField(wrapper, "name", "valid_action");
      setField(wrapper, "service_account", "service1@example.com");
      setField(wrapper, "codeZip", new File(["code"], "script.zip"));
      setField(wrapper, "cron", "0 0 * * *");
      await nextTick();

      await submit(wrapper);

      const payload = (actions.create as any).mock.calls[0][2];
      expect(payload.get("execution_details")).toBe("repeat");
      expect(payload.get("cron_expr")).toBe("0 0 * * *");
      expect(typeof payload.get("cron_expr")).toBe("string");
    });

    it("trims surrounding whitespace from the saved name (v-model.trim parity)", async () => {
      vi.spyOn(router, "replace").mockResolvedValue(undefined as any);
      setField(wrapper, "name", "  valid_action  ");
      setField(wrapper, "service_account", "service1@example.com");
      setField(wrapper, "codeZip", new File(["code"], "script.zip"));
      await nextTick();

      await submit(wrapper);

      const payload = (actions.create as any).mock.calls[0][2];
      expect(payload.get("name")).toBe("valid_action");
    });
  });

  describe("Step navigation", () => {
    it("displays the first step", () => {
      expect(
        wrapper.find('[data-test="add-action-script-step-1"]').exists(),
      ).toBe(true);
    });

    it("displays the file input in step 1", () => {
      expect(
        wrapper.find('[data-test="add-action-script-file-input"]').exists(),
      ).toBe(true);
    });

    it("advances to the next step on Continue", async () => {
      // Continue now gates on the step's own field: step 1's codeZip is required
      // on create, so a valid file must be present before the stepper advances.
      setField(wrapper, "codeZip", new File(["code"], "script.zip"));
      await nextTick();
      await wrapper
        .find('[data-test="add-action-script-step1-continue-btn"]')
        .trigger("click");
      // goToStep() awaits the form's async validator (TanStack onDynamicAsync),
      // which settles on a macrotask. A single flushPromises() can resolve before
      // that timer fires under a loaded event loop, so poll until it advances.
      await vi.waitFor(() => expect(wrapper.vm.step).toBe(2));
    });

    it("reactively hides the Schedule step when type switches to 'service' (Rule ③)", async () => {
      // Create-mode default is 'scheduled' → the Schedule step (step 2) shows.
      expect(
        wrapper.find('[data-test="add-action-script-step-2"]').exists(),
      ).toBe(true);

      // Switch the form-owned `type` to a real-time action. formType is read via
      // form.useStore (owner pattern), so the OStep v-if must update reactively.
      wrapper.vm.form.setFieldValue("type", "service");
      await nextTick();
      await flushPromises();
      expect(
        wrapper.find('[data-test="add-action-script-step-2"]').exists(),
      ).toBe(false);

      // Back to scheduled re-reveals it.
      wrapper.vm.form.setFieldValue("type", "scheduled");
      await nextTick();
      await flushPromises();
      expect(
        wrapper.find('[data-test="add-action-script-step-2"]').exists(),
      ).toBe(true);
    });
  });

  describe("Service account selection", () => {
    beforeEach(async () => {
      wrapper.vm.step = 3;
      await nextTick();
    });

    it("displays step 3 + the service account OForm select", () => {
      expect(
        wrapper.find('[data-test="add-action-script-step-3"]').exists(),
      ).toBe(true);
      expect(
        wrapper
          .find('[data-test="add-action-script-service-account-select"]')
          .exists(),
      ).toBe(true);
    });

    it("advances to step 4 on Continue", async () => {
      // Continue gates on service_account (required); seed it before advancing.
      // goToStep() is async (awaits schema validation), so flush after the click.
      setField(wrapper, "service_account", "service1@example.com");
      await nextTick();
      await wrapper
        .find('[data-test="add-action-script-step3-continue-btn"]')
        .trigger("click");
      // goToStep() awaits the form's async validator (TanStack onDynamicAsync),
      // which settles on a macrotask. A single flushPromises() can resolve before
      // that timer fires under a loaded event loop, so poll until it advances.
      await vi.waitFor(() => expect(wrapper.vm.step).toBe(4));
    });
  });

  describe("Environmental variables", () => {
    beforeEach(async () => {
      wrapper.vm.step = 4;
      await nextTick();
    });

    it("displays step 4 + at least one env-variable row", () => {
      expect(
        wrapper.find('[data-test="add-action-script-step-4"]').exists(),
      ).toBe(true);
      expect(
        wrapper.findAll('[data-test="add-action-script-env-variable"]').length,
      ).toBeGreaterThan(0);
    });

    it("adds a new env variable via addApiHeader", () => {
      const before = wrapper.vm.environmentalVariables.length;
      wrapper.vm.addApiHeader("MY_KEY", "my_value");
      const last =
        wrapper.vm.environmentalVariables[
          wrapper.vm.environmentalVariables.length - 1
        ];
      expect(wrapper.vm.environmentalVariables.length).toBe(before + 1);
      expect(last.key).toBe("MY_KEY");
      expect(last.value).toBe("my_value");
    });

    it("deletes an env variable via deleteApiHeader", async () => {
      wrapper.vm.environmentalVariables = [
        { key: "DELETE_TEST", value: "v", uuid: "u1" },
        { key: "KEEP_TEST", value: "k", uuid: "u2" },
      ];
      wrapper.vm.deleteApiHeader({ key: "DELETE_TEST", value: "v", uuid: "u1" });
      await nextTick();
      const keys = wrapper.vm.environmentalVariables.map((v: any) => v.key);
      expect(keys).toContain("KEEP_TEST");
      expect(keys).not.toContain("DELETE_TEST");
    });

    it("re-adds an empty row when the last env variable is deleted", () => {
      wrapper.vm.environmentalVariables = [
        { key: "ONLY", value: "v", uuid: "only" },
      ];
      wrapper.vm.deleteApiHeader({ key: "ONLY", value: "v", uuid: "only" });
      expect(wrapper.vm.environmentalVariables.length).toBe(1);
      expect(wrapper.vm.environmentalVariables[0].key).toBe("");
    });
  });

  describe("File handling", () => {
    it("clears fileNameToShow on editFileToUpload", () => {
      wrapper.vm.formData.fileNameToShow = "existing.zip";
      wrapper.vm.editFileToUpload();
      expect(wrapper.vm.formData.fileNameToShow).toBe("");
    });

    it("restores fileNameToShow on cancelUploadingNewFile", () => {
      wrapper.vm.originalActionScriptData = JSON.stringify({
        zip_file_name: "original.zip",
      });
      wrapper.vm.formData.fileNameToShow = "";
      wrapper.vm.cancelUploadingNewFile();
      expect(wrapper.vm.formData.fileNameToShow).toBe("original.zip");
    });

    it("shows the edit-file button in edit mode with an existing file", async () => {
      wrapper.vm.isEditingActionScript = true;
      wrapper.vm.formData.fileNameToShow = "existing.zip";
      await nextTick();
      expect(
        wrapper.find('[data-test="add-action-script-edit-file-btn"]').exists(),
      ).toBe(true);
    });
  });

  describe("getCronError (cron validation moved into the schema)", () => {
    it("returns empty for a valid cron expression", () => {
      expect(wrapper.vm.getCronError("0 12 * * *")).toBe("");
    });

    it("returns an error for an invalid cron expression", () => {
      expect(wrapper.vm.getCronError("not a cron")).toContain(
        "Invalid cron expression",
      );
    });

    it("returns an error for an empty cron string", () => {
      expect(wrapper.vm.getCronError("")).toContain("Invalid cron expression");
    });

    it("returns an error when a valid cron's interval is below the minimum", () => {
      // "* * * * *" is a syntactically valid every-minute (60s) cron. Force the
      // configured minimum above that so the interval branch (not the parse
      // branch) fires.
      const original = store.state.zoConfig.min_auto_refresh_interval;
      store.state.zoConfig.min_auto_refresh_interval = 3600;
      try {
        expect(wrapper.vm.getCronError("* * * * *")).toContain(
          "Frequency should be greater than",
        );
      } finally {
        store.state.zoConfig.min_auto_refresh_interval = original;
      }
    });
  });

  describe("openCancelDialog", () => {
    it("navigates directly when nothing changed", () => {
      const routerReplaceSpy = vi
        .spyOn(router, "replace")
        .mockResolvedValue(undefined as any);
      wrapper.vm.originalActionScriptData = JSON.stringify(wrapper.vm.formData);
      wrapper.vm.openCancelDialog();
      expect(wrapper.vm.dialog.show).toBe(false);
      expect(routerReplaceSpy).toHaveBeenCalled();
    });

    it("shows the discard dialog when there are changes", () => {
      wrapper.vm.originalActionScriptData = JSON.stringify({ name: "Original" });
      wrapper.vm.formData.name = "Changed";
      wrapper.vm.openCancelDialog();
      expect(wrapper.vm.dialog.show).toBe(true);
      expect(wrapper.vm.dialog.title).toBe("Discard Changes");
    });

    it("shows the discard dialog after a real form-field edit (regression guard)", async () => {
      // Editing a form-owned field is what a user actually does — it updates the
      // TanStack form, NOT `formData`. The dirty-check must still detect it and
      // warn before discarding (previously it silently navigated away).
      wrapper.vm.form.setFieldValue("name", "user_typed_this");
      await nextTick();
      wrapper.vm.openCancelDialog();
      expect(wrapper.vm.dialog.show).toBe(true);
      expect(wrapper.vm.dialog.title).toBe("Discard Changes");
    });
  });

  describe("setupEditingActionScript", () => {
    it("sets type to 'service' for service execution details", async () => {
      await wrapper.vm.setupEditingActionScript({
        id: "s",
        name: "Service Action",
        description: "",
        type: "service",
        execution_details: "service",
        cron_expr: "",
        service_account: "svc@example.com",
        environment_variables: {},
        zip_file_name: "service.zip",
        timezone: "UTC",
      });
      expect(wrapper.vm.formData.type).toBe("service");
    });

    it("sets frequency 'repeat' + cron for a repeat schedule", async () => {
      await wrapper.vm.setupEditingActionScript({
        id: "r",
        name: "Repeat Action",
        description: "",
        type: "scheduled",
        execution_details: "repeat",
        cron_expr: "0 12 * * *",
        service_account: "svc@example.com",
        environment_variables: {},
        zip_file_name: "repeat.zip",
        timezone: "UTC",
      });
      expect(wrapper.vm.frequency.type).toBe("repeat");
      expect(wrapper.vm.frequency.cron).toBe("0 12 * * *");
    });

    it("populates env variables from environment_variables", async () => {
      await wrapper.vm.setupEditingActionScript({
        id: "e",
        name: "Env Action",
        description: "",
        type: "scheduled",
        execution_details: "once",
        cron_expr: "",
        service_account: "svc@example.com",
        environment_variables: { DB_HOST: "localhost", DB_PORT: "5432" },
        zip_file_name: "env.zip",
        timezone: "UTC",
      });
      const keys = wrapper.vm.environmentalVariables.map((v: any) => v.key);
      expect(keys).toContain("DB_HOST");
      expect(keys).toContain("DB_PORT");
    });

    it("defaults timezone to UTC when missing", async () => {
      await wrapper.vm.setupEditingActionScript({
        id: "tz",
        name: "TZ Action",
        description: "",
        type: "scheduled",
        execution_details: "once",
        cron_expr: "",
        service_account: "svc@example.com",
        environment_variables: {},
        zip_file_name: "tz.zip",
      });
      expect(wrapper.vm.formData.timezone).toBe("UTC");
    });
  });

  describe("Edit mode", () => {
    it("detects edit mode + re-seeds the form from the loaded record", async () => {
      vi.spyOn(router, "currentRoute", "get").mockReturnValue({
        value: {
          query: { id: "test-action-id", org_identifier: "default" },
          name: "actionScripts",
        },
      } as any);

      const editWrapper = mount(EditScript, {
        attachTo: "#app",
        props: {},
        global: {
          plugins: [i18n, router],
          provide: { store },
          stubs: {
            ConfirmDialog: {
              template: '<div data-test="confirm-dialog">Confirm Dialog</div>',
              props: ["title", "message"],
              emits: ["update:ok", "update:cancel"],
            },
          },
        },
      });

      await flushPromises();

      expect(editWrapper.vm.isEditingActionScript).toBe(true);
      // Async record arrives → form is reset to the loaded values.
      expect(editWrapper.vm.form.state.values.name).toBe("Test Action");
      editWrapper.unmount();
    });

    it("is not in edit mode without a route id", () => {
      expect(wrapper.vm.isEditingActionScript).toBe(false);
    });
  });

  describe("Component lifecycle + helpers", () => {
    it("initializes with default form data", () => {
      expect(wrapper.vm.formData.name).toBe("");
      expect(wrapper.vm.formData.type).toBe("scheduled");
      expect(wrapper.vm.step).toBe(1);
    });

    it("loads service accounts on mount", () => {
      expect(wrapper.vm.filteredServiceAccounts).toBeDefined();
    });

    it("filterColumns returns all options for an empty query", () => {
      const update = (fn: Function) => fn();
      expect(
        wrapper.vm.filterColumns(["a", "b", "c"], "", update),
      ).toHaveLength(3);
    });

    it("filterColumns filters case-insensitively", () => {
      const update = (fn: Function) => fn();
      const res = wrapper.vm.filterColumns(
        ["Apple", "APPLICATION", "banana"],
        "app",
        update,
      );
      expect(res).toHaveLength(2);
    });

    it("isRequiredKey / isRequiredValue validate presence", () => {
      expect(wrapper.vm.isRequiredKey("k")).toBe(true);
      expect(wrapper.vm.isRequiredKey("")).toBe("Key is required");
      expect(wrapper.vm.isRequiredValue("v")).toBe(true);
      expect(wrapper.vm.isRequiredValue("   ")).toBe("Value is required");
    });
  });
});
