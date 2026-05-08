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

import { mount } from "@vue/test-utils";
import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import OrgStorageSettings from "./OrgStorageSettings.vue";
import i18n from "@/locales";
import { Dialog, Notify } from "quasar";
import { nextTick } from "vue";
import store from "@/test/unit/helpers/store";

installQuasar({
  plugins: [Dialog, Notify],
});

const { mockGetStorage, mockNotify, mockRouterPush } = vi.hoisted(() => ({
  mockGetStorage: vi.fn(),
  mockNotify: vi.fn(() => vi.fn()),
  mockRouterPush: vi.fn(),
}));

vi.mock("quasar", async () => {
  const actual = await vi.importActual("quasar");
  return {
    ...actual,
    useQuasar: () => ({
      notify: mockNotify,
    }),
  };
});

vi.mock("@/services/org_storage", () => ({
  default: {
    get: mockGetStorage,
    create: vi.fn(),
    update: vi.fn(),
    enable: vi.fn(),
  },
}));

vi.mock("vue-router", () => ({
  useRouter: () => ({
    push: mockRouterPush,
  }),
  useRoute: () => ({
    query: {},
  }),
}));

const mockStore = {
  ...store,
  dispatch: vi.fn(),
  state: {
    ...store.state,
    selectedOrganization: {
      identifier: "test-org-123",
      label: "Test Organization",
      id: 123,
    },
    theme: "light",
    zoConfig: {
      ...store.state.zoConfig,
      org_storage_enabled: true,
    },
  },
};

vi.mock("vuex", () => ({
  useStore: () => mockStore,
}));

vi.mock("@/utils/zincutils", async () => {
  const actual = await vi.importActual("@/utils/zincutils");
  return {
    ...actual,
    getImageURL: (path: string) => `/mock/${path}`,
  };
});

const createWrapper = (props = {}, options = {}) => {
  return mount(OrgStorageSettings, {
    props: { ...props },
    global: {
      ...options,
      provide: {
        store: mockStore,
      },
      plugins: [i18n],
      mocks: {
        $t: (key: string) => key,
      },
    },
  });
};

describe("OrgStorageSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetStorage.mockResolvedValue({
      data: { provider: null, data: "", created_at: 0, updated_at: 0 },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows loading spinner initially", () => {
    mockGetStorage.mockReturnValue(new Promise(() => {}));
    const wrapper = createWrapper();
    expect(wrapper.findComponent({ name: "QSpinner" }).exists()).toBe(true);
  });

  it("shows empty state when not configured", async () => {
    const wrapper = createWrapper();
    await nextTick();
    await nextTick();

    expect(wrapper.text()).toContain("No storage configured");
    expect(
      wrapper.find('[data-test="storage-settings-configure-btn"]').exists()
    ).toBe(true);
  });

  it("navigates to editor when configure is clicked", async () => {
    const wrapper = createWrapper();
    await nextTick();
    await nextTick();

    await wrapper
      .find('[data-test="storage-settings-configure-btn"]')
      .trigger("click");
    await nextTick();

    expect(mockRouterPush).toHaveBeenCalledWith({
      name: "storageSettingsEditor",
      query: { org_identifier: "test-org-123" },
    });
  });

  it("shows summary card when configured", async () => {
    mockGetStorage.mockResolvedValue({
      data: {
        provider: "AwsCredentials",
        data: {
          bucket_name: "my-bucket",
          server_url: "",
          region: "us-west-1",
          access_key: "AKI123456789",
          secret_key: "secret123",
        },
        created_at: 1777361152043890,
        updated_at: 1777361152043891,
      },
    });

    const wrapper = createWrapper();
    await nextTick();
    await nextTick();

    expect(wrapper.text()).toContain("AWS Credentials");
    expect(wrapper.text()).toContain("my-bucket");
    expect(wrapper.text()).toContain("us-west-1");
    expect(wrapper.text()).toContain("AKI123456789");
    expect(wrapper.text()).toContain("secret123");
    expect(
      wrapper.find('[data-test="storage-settings-update-btn"]').exists()
    ).toBe(true);
  });

  it("navigates to editor in edit mode when update is clicked", async () => {
    mockGetStorage.mockResolvedValue({
      data: {
        provider: "AwsCredentials",
        data: {
          bucket_name: "my-bucket",
          access_key: "old-key",
          secret_key: "old-secret",
        },
        created_at: 1777361152043890,
        updated_at: 1777361152043891,
      },
    });

    const wrapper = createWrapper();
    await nextTick();
    await nextTick();

    await wrapper
      .find('[data-test="storage-settings-update-btn"]')
      .trigger("click");
    await nextTick();

    expect(mockRouterPush).toHaveBeenCalledWith({
      name: "storageSettingsEditor",
      query: { org_identifier: "test-org-123", edit: "true" },
    });
  });

  it("shows AwsRoleArn details in summary", async () => {
    mockGetStorage.mockResolvedValue({
      data: {
        provider: "AwsRoleArn",
        data: {
          bucket_name: "role-bucket",
          region: "us-east-1",
          role_arn: "arn:aws:iam::123456789:role/test-role",
        },
        created_at: 1777361152043890,
        updated_at: 1777361152043891,
      },
    });

    const wrapper = createWrapper();
    await nextTick();
    await nextTick();

    expect(wrapper.text()).toContain("AWS Role ARN");
    expect(wrapper.text()).toContain("role-bucket");
    expect(wrapper.text()).toContain("us-east-1");
    expect(wrapper.text()).toContain("arn:aws:iam::123456789:role/test-role");
  });
});
