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
// IngestionTokens' "Create Token" dialog is migrated to OForm + Zod
// (IngestionTokens.schema.ts). Options-API form, so the schema + defaults are
// returned from setup(). These tests mount the REAL <OForm> (table/page chrome
// stubbed) and assert behavior: the schema gates the submit (name required +
// max 256), and a valid submit calls the service once.

import { mount, flushPromises } from "@vue/test-utils";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import IngestionTokens from "@/components/iam/IngestionTokens.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

vi.mock("@/services/organizations", () => ({
  default: {
    list_org_ingestion_tokens: vi.fn(() => Promise.resolve({ data: { data: [] } })),
    create_org_ingestion_token: vi.fn(),
    enable_disable_org_ingestion_token: vi.fn(),
  },
}));

const { mockToast } = vi.hoisted(() => ({ mockToast: vi.fn() }));
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: mockToast }));
vi.mock("@/utils/clipboard", () => ({ copyToClipboard: vi.fn() }));

import organizationsService from "@/services/organizations";

// ODialog stub: renders the default slot so the REAL OForm mounts; exposes the
// form-id (the footer Save submits via it in the app).
const ODialogStub = {
  name: "ODialog",
  props: [
    "open",
    "title",
    "persistent",
    "size",
    "primaryButtonLabel",
    "secondaryButtonLabel",
    "formId",
  ],
  emits: ["update:open", "click:primary", "click:secondary"],
  template: `<div data-test-stub="o-dialog" :data-form-id="formId"><slot /></div>`,
  inheritAttrs: false,
};

function mountComp() {
  return mount(IngestionTokens, {
    global: {
      plugins: [store, i18n],
      stubs: {
        ODialog: ODialogStub,
        OTable: true,
        OPageHeader: true,
        OSearchInput: true,
        OTooltip: true,
        OEmptyState: true,
        OButton: true,
        OIcon: true,
      },
    },
  });
}

const getForm = (w: any) => w.findComponent({ name: "OForm" });
const getNameInput = (w: any) => w.find('[data-test="ingestion-token-name-input"] input');
const getDescInput = (w: any) => w.find('[data-test="ingestion-token-description-input"] input');
const submitForm = async (w: any) => {
  await getForm(w).vm.form.handleSubmit();
  await flushPromises();
};

describe("IngestionTokens — Create Token form", () => {
  let wrapper: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(organizationsService.list_org_ingestion_tokens).mockResolvedValue({
      data: { data: [] },
    } as any);
    wrapper = mountComp();
    await flushPromises();
  });

  afterEach(() => {
    try {
      wrapper?.unmount();
    } catch {
      // teleported components can throw during unmount in jsdom
    }
  });

  describe("rendering & wiring", () => {
    it("renders the create form wired to the dialog via form-id", () => {
      expect(getForm(wrapper).exists()).toBe(true);
      expect(getNameInput(wrapper).exists()).toBe(true);
      expect(getDescInput(wrapper).exists()).toBe(true);
      expect(wrapper.find('[data-test-stub="o-dialog"]').attributes("data-form-id")).toBe(
        "create-token-form",
      );
    });

    it("returns the schema from setup() (Options-API wiring)", () => {
      expect(getForm(wrapper).props("schema")).toBeDefined();
    });

    it("seeds blank default-values", () => {
      expect(getForm(wrapper).props("defaultValues")).toEqual({
        name: "",
        description: "",
      });
    });

    it("keeps the name input's maxlength", () => {
      expect(getNameInput(wrapper).attributes("maxlength")).toBe("256");
    });
  });

  describe("schema validation (real OForm)", () => {
    it("blocks submit and does NOT call create when name is empty", async () => {
      await submitForm(wrapper);

      expect(getForm(wrapper).vm.form.state.isValid).toBe(false);
      expect(organizationsService.create_org_ingestion_token).not.toHaveBeenCalled();
      expect(wrapper.text()).toContain("Name is required");
    });

    it("blocks submit when the name exceeds 256 characters (restored max rule)", async () => {
      getForm(wrapper).vm.form.setFieldValue("name", "a".repeat(257));
      await submitForm(wrapper);

      expect(getForm(wrapper).vm.form.state.isValid).toBe(false);
      expect(organizationsService.create_org_ingestion_token).not.toHaveBeenCalled();
    });

    it("submits and calls create once with the trimmed name + description", async () => {
      vi.spyOn(store, "dispatch").mockResolvedValue(undefined as any);
      vi.mocked(organizationsService.create_org_ingestion_token).mockResolvedValue({
        data: { data: { token: "tok_123" } },
      } as any);

      await getNameInput(wrapper).setValue("  my-token  ");
      await getDescInput(wrapper).setValue("for ingestion");
      await submitForm(wrapper);

      expect(getForm(wrapper).vm.form.state.isValid).toBe(true);
      expect(organizationsService.create_org_ingestion_token).toHaveBeenCalledTimes(1);
      expect(organizationsService.create_org_ingestion_token).toHaveBeenCalledWith(
        store.state.selectedOrganization.identifier,
        { name: "my-token", description: "for ingestion" },
      );
    });

    it("allows an empty description (optional)", async () => {
      vi.spyOn(store, "dispatch").mockResolvedValue(undefined as any);
      vi.mocked(organizationsService.create_org_ingestion_token).mockResolvedValue({
        data: { data: { token: "tok_123" } },
      } as any);

      await getNameInput(wrapper).setValue("only-name");
      await submitForm(wrapper);

      expect(organizationsService.create_org_ingestion_token).toHaveBeenCalledWith(
        store.state.selectedOrganization.identifier,
        { name: "only-name", description: "" },
      );
    });
  });

  describe("creation behavior", () => {
    it("reveals the new token and shows a success toast on success", async () => {
      vi.spyOn(store, "dispatch").mockResolvedValue(undefined as any);
      vi.mocked(organizationsService.create_org_ingestion_token).mockResolvedValue({
        data: { data: { token: "tok_abc" } },
      } as any);

      await getNameInput(wrapper).setValue("my-token");
      await submitForm(wrapper);

      expect(wrapper.vm.revealedToken).toEqual({ name: "my-token", token: "tok_abc" });
      expect(wrapper.vm.showCreateForm).toBe(false);
      expect(wrapper.vm.showRevealedDialog).toBe(true);
      expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ variant: "success" }));
    });

    it("shows an error toast and keeps the dialog open on failure", async () => {
      vi.mocked(organizationsService.create_org_ingestion_token).mockRejectedValue({
        response: { data: { message: "boom" } },
      });

      await getNameInput(wrapper).setValue("my-token");
      await submitForm(wrapper);

      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "error", message: "boom" }),
      );
      expect(wrapper.vm.showRevealedDialog).toBe(false);
    });
  });
});
