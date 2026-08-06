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

import { mount, flushPromises } from "@vue/test-utils";
import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import OrgStorageEditor from "./OrgStorageEditor.vue";
import i18n from "@/locales";
import { nextTick } from "vue";
import store from "@/test/unit/helpers/store";
import { makeOrgStorageEditorSchema } from "./OrgStorageEditor.schema";

const { mockCreate, mockUpdate, mockGet, mockToast } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockUpdate: vi.fn(),
  mockGet: vi.fn(),
  mockToast: vi.fn(() => vi.fn()),
}));

vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: mockToast,
}));

vi.mock("@/services/org_storage", () => ({
  default: {
    get: mockGet,
    create: mockCreate,
    update: mockUpdate,
  },
}));

vi.mock("@/aws-exports", () => ({
  default: { isCloud: "false", isEnterprise: "true" },
}));

vi.mock("@/utils/zincutils", async () => {
  const actual = await vi.importActual("@/utils/zincutils");
  return {
    ...actual,
    getImageURL: (path: string) => `/mock/${path}`,
  };
});

const mockStore = {
  ...store,
  dispatch: vi.fn(),
  state: {
    ...store.state,
    theme: "light",
    selectedOrganization: { identifier: "test-org-123" },
    zoConfig: { ...store.state.zoConfig },
  },
};

vi.mock("vuex", () => ({
  useStore: () => mockStore,
}));

// OStepper / OStep render their slots so both steps' content is available; the
// per-provider fields are still gated by selectedProvider (v-if). OForm /
// OFormInput are real so the provider-discriminated schema actually runs.
const createWrapper = (action: "add" | "edit" = "add") =>
  mount(OrgStorageEditor, {
    props: { action },
    global: {
      plugins: [i18n],
      provide: { store: mockStore },
      stubs: {
        OStepper: { template: "<div><slot /></div>" },
        OStep: { template: "<div><slot /></div>" },
        OPageHeader: { template: "<div><slot name='title' /></div>" },
        OIcon: { template: "<span />" },
        OButton: {
          template: `<button :data-test="$attrs['data-test']" :type="type" @click="$emit('click', $event)"><slot /></button>`,
          props: ["type", "variant", "disabled"],
          emits: ["click"],
        },
      },
    },
  });

const getForm = (wrapper: any) => wrapper.vm.storageForm.form;

const selectProvider = async (wrapper: any, provider: string) => {
  await wrapper.find(`[data-test="storage-settings-provider-card-${provider}"]`).trigger("click");
  await nextTick();
};

describe("OrgStorageEditor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreate.mockResolvedValue({ data: {} });
    mockUpdate.mockResolvedValue({ data: {} });
    mockGet.mockResolvedValue({ data: { provider: null, data: {} } });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("mounts and shows the provider cards in add mode", () => {
    const wrapper = createWrapper("add");
    expect(wrapper.exists()).toBe(true);
    expect(
      wrapper.find('[data-test="storage-settings-provider-card-AwsCredentials"]').exists(),
    ).toBe(true);
    expect(wrapper.find('[data-test="storage-settings-provider-card-AwsRoleArn"]').exists()).toBe(
      true,
    );
  });

  it("renders the AWS credential fields after selecting the provider", async () => {
    const wrapper = createWrapper("add");
    await selectProvider(wrapper, "AwsCredentials");

    expect(wrapper.find('[data-test="storage-settings-bucket-name-input"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="storage-settings-access-key-input"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="storage-settings-secret-key-input"]').exists()).toBe(true);
  });

  it("bridges the selected provider into the form", async () => {
    const wrapper = createWrapper("add");
    await selectProvider(wrapper, "AwsCredentials");
    expect(getForm(wrapper).state.values.selectedProvider).toBe("AwsCredentials");
  });

  describe("Provider-discriminated validation (real OForm)", () => {
    it("blocks submit and does NOT call create when AWS required fields are empty", async () => {
      const wrapper = createWrapper("add");
      await selectProvider(wrapper, "AwsCredentials");

      await getForm(wrapper).handleSubmit();
      await flushPromises();

      expect(getForm(wrapper).state.isValid).toBe(false);
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it("creates the AWS config with the correct payload when valid", async () => {
      const wrapper = createWrapper("add");
      await selectProvider(wrapper, "AwsCredentials");

      const form = getForm(wrapper);
      form.setFieldValue("bucket_name", "my-bucket");
      form.setFieldValue("region", "us-east-1");
      form.setFieldValue("access_key", "AKIA123");
      form.setFieldValue("secret_key", "secret123");
      await nextTick();

      await form.handleSubmit();
      await flushPromises();

      expect(mockCreate).toHaveBeenCalledWith("test-org-123", {
        provider: "AwsCredentials",
        data: {
          bucket_name: "my-bucket",
          server_url: "",
          region: "us-east-1",
          access_key: "AKIA123",
          secret_key: "secret123",
        },
      });
    });

    it("blocks submit when AwsRoleArn is missing role_arn / external_id (restored per-provider rules)", async () => {
      const wrapper = createWrapper("add");
      await selectProvider(wrapper, "AwsRoleArn");

      const form = getForm(wrapper);
      form.setFieldValue("bucket_name", "role-bucket");
      form.setFieldValue("region", "us-east-1");
      // role_arn + external_id intentionally left empty
      await nextTick();

      await form.handleSubmit();
      await flushPromises();

      expect(form.state.isValid).toBe(false);
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it("creates the AwsRoleArn config when all required fields are present", async () => {
      const wrapper = createWrapper("add");
      await selectProvider(wrapper, "AwsRoleArn");

      const form = getForm(wrapper);
      form.setFieldValue("bucket_name", "role-bucket");
      form.setFieldValue("region", "us-east-1");
      form.setFieldValue("role_arn", "arn:aws:iam::123:role/x");
      form.setFieldValue("external_id", "ext-123");
      await nextTick();

      await form.handleSubmit();
      await flushPromises();

      expect(mockCreate).toHaveBeenCalledWith("test-org-123", {
        provider: "AwsRoleArn",
        data: {
          bucket_name: "role-bucket",
          region: "us-east-1",
          role_arn: "arn:aws:iam::123:role/x",
          external_id: "ext-123",
        },
      });
    });
  });

  describe("Azure provider validation (real OForm)", () => {
    it("blocks submit and does NOT call create when Azure required fields are empty", async () => {
      const wrapper = createWrapper("add");
      await selectProvider(wrapper, "AzureCredentials");

      await getForm(wrapper).handleSubmit();
      await flushPromises();

      expect(getForm(wrapper).state.isValid).toBe(false);
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it("creates the Azure config with the correct payload when valid", async () => {
      const wrapper = createWrapper("add");
      await selectProvider(wrapper, "AzureCredentials");

      const form = getForm(wrapper);
      form.setFieldValue("storage_account", "myaccount");
      form.setFieldValue("bucket_name", "az-bucket");
      form.setFieldValue("secret_key", "az-secret");
      await nextTick();

      await form.handleSubmit();
      await flushPromises();

      expect(mockCreate).toHaveBeenCalledWith("test-org-123", {
        provider: "AzureCredentials",
        data: {
          bucket_name: "az-bucket",
          server_url: "",
          storage_account: "myaccount",
          secret_key: "az-secret",
        },
      });
    });
  });

  describe("Provider switch reset (④c dependent-field side-effect)", () => {
    it("clears the previous provider's credentials when the provider changes", async () => {
      const wrapper = createWrapper("add");
      await selectProvider(wrapper, "AwsCredentials");

      const form = getForm(wrapper);
      form.setFieldValue("bucket_name", "aws-bucket");
      form.setFieldValue("access_key", "AKIA-should-clear");
      form.setFieldValue("secret_key", "secret-should-clear");
      await nextTick();
      // sanity: the credentials are set before the provider switch
      expect(form.state.values.access_key).toBe("AKIA-should-clear");

      // Switching the provider fires the create-mode watch → form.reset(blank),
      // wiping the previous provider's credentials (the rulebook's ④c side-effect).
      await selectProvider(wrapper, "AwsRoleArn");
      await flushPromises();

      const values = getForm(wrapper).state.values;
      expect(values.selectedProvider).toBe("AwsRoleArn");
      expect(values.access_key).toBe("");
      expect(values.secret_key).toBe("");
      expect(values.bucket_name).toBe("");
    });
  });

  describe("GCP provider validation (schema-level — card not in the grid)", () => {
    // GCP is intentionally not offered as a provider card (providerDefinitions
    // comments it out), so it can't be exercised through the UI — but the
    // superRefine branch still exists, so it is covered directly here.
    const schema = makeOrgStorageEditorSchema((k: string) => k);

    it("requires bucket_name and access_key for GcpCredentials", () => {
      const res = schema.safeParse({ selectedProvider: "GcpCredentials" });
      expect(res.success).toBe(false);
      const paths = res.success ? [] : res.error.issues.map((iss: any) => iss.path.join("."));
      expect(paths).toContain("bucket_name");
      expect(paths).toContain("access_key");
    });

    it("passes for GcpCredentials when bucket_name and access_key are present", () => {
      const res = schema.safeParse({
        selectedProvider: "GcpCredentials",
        bucket_name: "gcp-bucket",
        access_key: "gcp-key",
      });
      expect(res.success).toBe(true);
    });
  });

  describe("Edit mode", () => {
    it("prefills non-credential fields and calls update on submit", async () => {
      mockGet.mockResolvedValue({
        data: {
          provider: "AwsCredentials",
          data: {
            bucket_name: "existing-bucket",
            region: "eu-west-1",
            server_url: "",
          },
        },
      });

      const wrapper = createWrapper("edit");
      await flushPromises();
      await nextTick();

      const form = getForm(wrapper);
      // Non-credential fields prefilled from the loaded config
      expect(form.state.values.bucket_name).toBe("existing-bucket");
      expect(form.state.values.region).toBe("eu-west-1");

      // Credentials must be entered fresh
      form.setFieldValue("access_key", "new-key");
      form.setFieldValue("secret_key", "new-secret");
      await nextTick();

      await form.handleSubmit();
      await flushPromises();

      expect(mockUpdate).toHaveBeenCalledWith("test-org-123", {
        provider: "AwsCredentials",
        data: {
          bucket_name: "existing-bucket",
          server_url: "",
          region: "eu-west-1",
          access_key: "new-key",
          secret_key: "new-secret",
        },
      });
    });
  });
});
