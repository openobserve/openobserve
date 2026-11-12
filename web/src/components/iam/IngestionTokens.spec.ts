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
import ConfirmDialogProvider from "@/components/ConfirmDialogProvider.vue";
import { useConfirmDialog } from "@/composables/useConfirmDialog";

vi.mock("@/services/product_analytics", () => ({ default: { track: vi.fn() } }));
vi.mock("@/services/organizations", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: {
      list_org_ingestion_tokens: vi.fn(() => Promise.resolve({ data: { data: [] } })),
      create_org_ingestion_token: vi.fn(),
      enable_disable_org_ingestion_token: vi.fn(),
    },
  });
});

const { mockToast } = vi.hoisted(() => ({ mockToast: vi.fn() }));
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: mockToast }));
vi.mock("@/utils/clipboard", () => ({ copyToClipboard: vi.fn() }));

import organizationsService from "@/services/organizations";
import analytics from "@/services/product_analytics";
import { queryClient } from "@/composables/query/queryClient";

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
        splunk_token: false,
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
        { name: "my-token", description: "for ingestion", splunk_token: false },
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
        { name: "only-name", description: "", splunk_token: false },
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

    it("carries the Splunk token back for the reveal dialog", async () => {
      vi.spyOn(store, "dispatch").mockResolvedValue(undefined as any);
      vi.mocked(organizationsService.create_org_ingestion_token).mockResolvedValue({
        data: { data: { token: "tok_abc", splunk_token: "7b3d9f2c-4a11-4e55-9c8b-2f6a01c34d90" } },
      } as any);

      await getNameInput(wrapper).setValue("my-token");
      await submitForm(wrapper);

      expect(wrapper.vm.revealedToken).toEqual({
        name: "my-token",
        token: "tok_abc",
        splunk_token: "7b3d9f2c-4a11-4e55-9c8b-2f6a01c34d90",
      });
    });

    it("points the HEC URL at the server root, never under a base URI", () => {
      expect(wrapper.vm.hecUrl).toBe(`${window.location.origin}/services/collector`);
      expect(wrapper.vm.hecUrl).toContain("/services/collector");
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

describe("IngestionTokens — revoke Splunk HEC token confirm", () => {
  it("names the token in bold in the real provider with a destructive button", async () => {
    vi.mocked(organizationsService.list_org_ingestion_tokens).mockResolvedValue({
      data: { data: [] },
    } as any);
    const wrapper = mountComp();
    const ProviderDialogStub = {
      name: "ODialog",
      props: ["open", "title", "primaryButtonVariant"],
      template: `<div data-test-stub="provider-dialog"><slot /></div>`,
    };
    const provider = mount(ConfirmDialogProvider, {
      global: { plugins: [i18n], stubs: { ODialog: ProviderDialogStub } },
    });
    await flushPromises();

    const pending = (wrapper.vm as any).setSplunkToken("edge-forwarder", false);
    await flushPromises();
    const name = provider.find('[data-test="confirm-dialog-provider-name"]');
    expect(name.text()).toBe("edge-forwarder");
    expect(name.classes()).toContain("font-semibold");
    expect(provider.findComponent(ProviderDialogStub).props("primaryButtonVariant")).toBe(
      "destructive",
    );

    useConfirmDialog().handleCancel();
    await pending;
    provider.unmount();
    wrapper.unmount();
  });
});

describe("IngestionTokens — analytics", () => {
  it("tracks disabling a token once the server accepts it", async () => {
    vi.mocked(organizationsService.enable_disable_org_ingestion_token).mockResolvedValue({
      data: {},
    } as any);
    const wrapper = mountComp();
    await flushPromises();

    await (wrapper.vm as any).toggleEnabled("edge-forwarder", false);

    expect(analytics.track).toHaveBeenCalledWith("ingestion_token_disabled");
  });
});

// Renders each row's name, credential and action cells, so the per-row templates are exercised.
const OTableRowsStub = {
  name: "OTable",
  props: ["data"],
  template: `<div><div v-for="row in data" :key="row.name" :data-test="'row-' + row.name"><slot name="cell-name" :row="row" /><slot name="cell-token" :row="row" /><slot name="cell-actions" :row="row" /></div></div>`,
};

function mountRows(rows: Record<string, unknown>[]) {
  vi.mocked(organizationsService.list_org_ingestion_tokens).mockResolvedValue({
    data: { data: rows },
  } as any);
  return mount(IngestionTokens, {
    global: {
      plugins: [store, i18n],
      stubs: {
        ODialog: ODialogStub,
        OTable: OTableRowsStub,
        OSearchInput: true,
        OTooltip: true,
        OEmptyState: true,
        OButton: true,
        OIcon: true,
      },
    },
  });
}

describe("IngestionTokens — system tokens", () => {
  const USER = {
    name: "ci-collector",
    token: "o2oi_ci",
    enabled: true,
    created_by: "admin@demo-org",
  };
  const SYSTEM = {
    name: "_o2_alert_calibration",
    token: "o2oi_sys",
    enabled: true,
    created_by: "system",
  };
  const LEGACY = {
    name: "_o2_old",
    token: "o2oi_old",
    enabled: true,
    created_by: "admin@demo-org",
  };

  const rowOf = (wrapper: ReturnType<typeof mountRows>, name: string) =>
    wrapper.find(`[data-test="row-${name}"]`);
  const tagOf = (wrapper: ReturnType<typeof mountRows>, name: string) =>
    rowOf(wrapper, name).find(`[data-test="ingestion-token-${name}-system"]`);
  const hasButton = (wrapper: ReturnType<typeof mountRows>, name: string, kind: string) =>
    rowOf(wrapper, name).find(`[data-test="ingestion-token-${name}-${kind}"]`).exists();

  // earlier suites leave a dispatch spy on the shared store, which would swallow setOrgTokens
  beforeEach(() => {
    vi.restoreAllMocks();
    queryClient.clear();
  });

  afterEach(() => {
    store.state.organizationData.orgTokens = [];
  });

  it("a system token shows the System tag, no credential and no Splunk action, and keeps its toggle", async () => {
    const wrapper = mountRows([USER, SYSTEM, LEGACY]);
    await flushPromises();
    expect(tagOf(wrapper, SYSTEM.name).text()).toBe("System");
    expect(rowOf(wrapper, SYSTEM.name).text()).not.toContain("Basic ");
    expect(hasButton(wrapper, SYSTEM.name, "splunk")).toBe(false);
    expect(hasButton(wrapper, SYSTEM.name, "toggle")).toBe(true);
    wrapper.unmount();
  });

  it("a user-made _o2_ token gets no System tag, no credential and no Splunk action, and keeps its toggle", async () => {
    const wrapper = mountRows([USER, SYSTEM, LEGACY]);
    await flushPromises();
    expect(tagOf(wrapper, LEGACY.name).exists()).toBe(false);
    expect(rowOf(wrapper, LEGACY.name).text()).not.toContain("Basic ");
    expect(hasButton(wrapper, LEGACY.name, "splunk")).toBe(false);
    expect(hasButton(wrapper, LEGACY.name, "toggle")).toBe(true);
    wrapper.unmount();
  });

  it("renders a user token next to system tokens exactly as it does alone", async () => {
    const alone = mountRows([USER]);
    await flushPromises();
    const aloneHtml = rowOf(alone, USER.name).html();
    alone.unmount();

    const mixed = mountRows([USER, SYSTEM, LEGACY]);
    await flushPromises();
    expect(rowOf(mixed, USER.name).html()).toBe(aloneHtml);
    mixed.unmount();
  });

  it("shows no System tag for an org with no system token", async () => {
    const wrapper = mountRows([USER]);
    await flushPromises();
    expect(wrapper.findAll('[data-test$="-system"]')).toHaveLength(0);
    expect(rowOf(wrapper, USER.name).element.firstElementChild?.outerHTML).toBe(
      '<span class="font-medium">ci-collector</span>',
    );
    expect(rowOf(wrapper, USER.name).text()).toContain("Basic ");
    expect(hasButton(wrapper, USER.name, "splunk")).toBe(true);
    expect(hasButton(wrapper, USER.name, "toggle")).toBe(true);
    wrapper.unmount();
  });

  it("leaves twelve ordinary tokens, the server-made default among them, unchanged", async () => {
    const rows = [
      { name: "default", token: "o2oi_def", enabled: true, created_by: "system" },
      ...Array.from({ length: 11 }, (_, i) => ({ ...USER, name: `collector-${i}` })),
    ];
    const wrapper = mountRows(rows);
    await flushPromises();
    expect(wrapper.findAll('[data-test$="-system"]')).toHaveLength(0);
    for (const row of rows) {
      expect(rowOf(wrapper, row.name).text()).toContain("Basic ");
      expect(hasButton(wrapper, row.name, "splunk")).toBe(true);
      expect(hasButton(wrapper, row.name, "toggle")).toBe(true);
    }
    wrapper.unmount();
  });

  it("publishes no _o2_ token to the snippet picker after a token is disabled", async () => {
    vi.mocked(organizationsService.enable_disable_org_ingestion_token).mockResolvedValue({
      data: {},
    } as any);
    const wrapper = mountRows([USER, SYSTEM, LEGACY]);
    await flushPromises();
    await (wrapper.vm as any).toggleEnabled(USER.name, false);
    await flushPromises();
    const names = (store.state.organizationData.orgTokens as { name: string }[]).map((t) => t.name);
    expect(names).toEqual([USER.name]);
    wrapper.unmount();
  });

  it("publishes no _o2_ token to the snippet picker after a token is created", async () => {
    vi.mocked(organizationsService.create_org_ingestion_token).mockResolvedValue({
      data: { data: { token: "o2oi_new" } },
    } as any);
    const wrapper = mountRows([USER, SYSTEM, LEGACY]);
    await flushPromises();
    await (wrapper.vm as any).createToken({ name: "new-one", description: "" });
    await flushPromises();
    const names = (store.state.organizationData.orgTokens as { name: string }[]).map((t) => t.name);
    expect(names).toEqual([USER.name]);
    wrapper.unmount();
  });
});
