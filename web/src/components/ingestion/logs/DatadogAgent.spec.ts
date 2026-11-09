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
import { load } from "js-yaml";
import { flushPromises, mount } from "@vue/test-utils";
import { createStore } from "vuex";
import { createMemoryHistory, createRouter } from "vue-router";
import DatadogAgent from "@/components/ingestion/logs/DatadogAgent.vue";
import { queryClient } from "@/composables/query/queryClient";

vi.mock("@/lib/core/Code/OCodeBlock.vue", () => ({
  default: {
    name: "OCodeBlock",
    props: ["code", "dataTest"],
    emits: ["copy"],
    template: "<pre :data-test='dataTest'>{{ code }}</pre>",
  },
}));

vi.mock("@/services/product_analytics", () => ({ default: { track: vi.fn() } }));

const awsConfig = vi.hoisted(() => ({ isCloud: "false", isEnterprise: "false" }));
vi.mock("@/aws-exports", () => ({ default: awsConfig }));

const ingestion = vi.hoisted(() => ({ url: "https://o2.example.com/base" }));
vi.mock("../../../utils/zincutils", () => ({
  getImageURL: vi.fn(() => "image.png"),
  getEndPoint: vi.fn((url: string) => ({
    url,
    host: "o2.example.com",
    port: "443",
    protocol: "https",
    tls: "On",
  })),
}));

const credentialApi = vi.hoisted(() => ({
  get_organization_passcode: vi.fn(),
  list_org_ingestion_tokens: vi.fn(),
}));
vi.mock("@/services/organizations", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), { default: credentialApi });
});

const ORG = "acme_prod";
const ORG_TOKEN = "o2oi_test";
const USER_PASSCODE = "userPasscode0123456789";

// the credential reads settle through the query client's own timer
const settle = async () => {
  for (let i = 0; i < 3; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await flushPromises();
  }
};

const makeStore = () =>
  createStore({
    state: {
      API_ENDPOINT: ingestion.url,
      selectedOrganization: { identifier: ORG, name: ORG, id: 1 },
      userInfo: { email: "you@acme.io" },
      zoConfig: { ingestion_url: "", version: "", build_type: "opensource" },
      theme: "light",
      organizationData: {
        organizationPasscode: "",
        organizationPasscodeForbidden: false,
        orgTokens: [],
        rumToken: { rum_token: "" },
        organizationSettings: {},
      },
    },
    actions: {
      setOrganizationPasscode({ state }, value: string) {
        state.organizationData.organizationPasscode = value;
      },
      setOrganizationPasscodeForbidden({ state }, value: boolean) {
        state.organizationData.organizationPasscodeForbidden = value;
      },
      setOrganizationPasscodeUser() {},
      setOrgTokens({ state }, value: unknown[]) {
        state.organizationData.orgTokens = value;
      },
    },
  });

const makeRouter = () =>
  createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/iam/tokens", name: "ingestionTokens", component: { template: "<div />" } },
      { path: "/:any(.*)*", name: "datadogAgentLogs", component: { template: "<div />" } },
    ],
  });

let store: ReturnType<typeof makeStore>;

const mountPage = async () => {
  store = makeStore();
  const router = makeRouter();
  await router.push("/");
  const wrapper = mount(DatadogAgent, {
    props: { currOrgIdentifier: ORG, currUserEmail: "you@acme.io" },
    global: {
      plugins: [store, router],
      provide: { store },
      stubs: { FirstEventStatus: { template: "<div />", methods: { start: vi.fn() } } },
    },
  });
  await settle();
  await vi.waitFor(() =>
    expect(wrapper.find('[data-test$="-code-block-loading"]').exists()).toBe(false),
  );
  return wrapper;
};

const block = (wrapper: Awaited<ReturnType<typeof mountPage>>, slug: string) =>
  wrapper.find(`[data-test="ingestion-${slug}-code-block"]`).text() as string;

describe("DatadogAgent", () => {
  beforeEach(() => {
    ingestion.url = "https://o2.example.com/base";
    credentialApi.list_org_ingestion_tokens.mockResolvedValue({
      data: { data: [{ name: "default", token: ORG_TOKEN, enabled: true }] },
    });
    credentialApi.get_organization_passcode.mockResolvedValue({
      data: { data: { passcode: USER_PASSCODE, user: "you@acme.io" } },
    });
  });

  afterEach(() => {
    queryClient.clear();
    vi.clearAllMocks();
  });

  it("resolves the host through getEndPoint, like every other ingestion page", async () => {
    await mountPage();
    const { getEndPoint } = await vi.importMock<any>("../../../utils/zincutils");
    expect(getEndPoint).toHaveBeenCalledWith("https://o2.example.com/base");
  });

  it("makes a relative API endpoint absolute against the page origin", async () => {
    ingestion.url = "/base";
    const wrapper = await mountPage();
    const env = block(wrapper, "datadogagent-env");
    expect(env).toContain(`DD_DD_URL=${window.location.origin}/base/datadog/${ORG}\n`);
  });

  it("follows an ingestion URL that the config supplies after mount", async () => {
    const wrapper = await mountPage();
    store.state.zoConfig.ingestion_url = "https://ingest.example.com";
    await flushPromises();
    const env = block(wrapper, "datadogagent-env");
    expect(env).toContain(`DD_DD_URL=https://ingest.example.com/datadog/${ORG}\n`);
  });

  it("prints the key and the three URLs with the org token and the org URL under the base URI", async () => {
    const wrapper = await mountPage();
    const url = `https://o2.example.com/base/datadog/${ORG}`;
    expect(block(wrapper, "datadogagent-env").split("\n").slice(0, 4)).toEqual([
      `DD_API_KEY=${ORG_TOKEN}`,
      `DD_DD_URL=${url}`,
      `DD_APM_DD_URL=${url}`,
      `DD_LOGS_CONFIG_LOGS_DD_URL=${url}`,
    ]);
  });

  it("turns off every Agent feature that would send the key to Datadog's own hosts", async () => {
    const wrapper = await mountPage();
    expect(block(wrapper, "datadogagent-env").split("\n").slice(4)).toEqual([
      "DD_INVENTORIES_DIAGNOSTICS_ENABLED=false",
      "DD_REMOTE_CONFIGURATION_ENABLED=false",
      "DD_DISCOVERY_ENABLED=false",
      "DD_PROCESS_CONFIG_CONTAINER_COLLECTION_ENABLED=false",
      "DD_PROCESS_CONFIG_PROCESS_DISCOVERY_ENABLED=false",
      "DD_CONTAINER_LIFECYCLE_ENABLED=false",
      "DD_CONTAINER_IMAGE_ENABLED=false",
      "DD_ORCHESTRATOR_EXPLORER_ENABLED=false",
      "DD_AGENT_TELEMETRY_ENABLED=false",
      "DD_APM_TELEMETRY_ENABLED=false",
      "DD_DATA_PLANE_ENABLED=false",
    ]);
    const note = wrapper.find('[data-test="ingestion-datadogagent-features-off-note"]').text();
    expect(note).toContain("DD_DATA_PLANE_ENABLED=false");
    expect(note).toContain("agent-data-plane");
  });

  it("never leaves a trailing slash on the base before the datadog path", async () => {
    ingestion.url = "https://o2.example.com/base/";
    const wrapper = await mountPage();
    const env = block(wrapper, "datadogagent-env");
    expect(env).toContain(`DD_DD_URL=https://o2.example.com/base/datadog/${ORG}\n`);
    expect(env).not.toContain("//datadog");
    expect(env).not.toMatch(/\/\n|\/$/);
  });

  it("splits the URL into host, port and path for the additional logs endpoint", async () => {
    const wrapper = await mountPage();
    const yaml = block(wrapper, "datadogagent-dual");
    expect(yaml).toContain(`"https://o2.example.com/base/datadog/${ORG}": ["${ORG_TOKEN}"]`);
    expect(yaml).toContain("force_use_http: true");
    expect(yaml).toContain('- host: "o2.example.com"');
    expect(yaml).toContain("port: 443");
    expect(yaml).toContain("use_ssl: true");
    expect(yaml).toContain(`path_prefix: /base/datadog/${ORG}`);
    expect(yaml).toContain(`api_key: ${ORG_TOKEN}`);
  });

  it("uses plain HTTP settings for an http endpoint with an explicit port", async () => {
    ingestion.url = "http://o2.internal:5080";
    const wrapper = await mountPage();
    const yaml = block(wrapper, "datadogagent-dual");
    expect(yaml).toContain("port: 5080");
    expect(yaml).toContain("use_ssl: false");
    expect(yaml).toContain(`path_prefix: /datadog/${ORG}`);
  });

  it("does not warn when the key is an org ingestion token", async () => {
    const wrapper = await mountPage();
    expect(wrapper.find('[data-test="ingestion-datadogagent-token-note"]').exists()).toBe(false);
  });

  it("offers no snippet when only the user passcode is available, since the intake rejects it", async () => {
    credentialApi.list_org_ingestion_tokens.mockResolvedValue({ data: { data: [] } });
    const wrapper = await mountPage();
    expect(wrapper.find('[data-test="ingestion-datadogagent-env-code-block"]').exists()).toBe(
      false,
    );
    expect(wrapper.find('[data-test="ingestion-datadogagent-dual-code-block"]').exists()).toBe(
      false,
    );
    expect(wrapper.text()).not.toContain(USER_PASSCODE);
    expect(wrapper.find('[data-test="ingestion-datadogagent-token-note"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="ingestion-datadogagent-tokens-link"]').exists()).toBe(true);
  });

  it.each([
    ["https://o2.example.com/base", "o2.example.com", 443, true, "/base"],
    ["http://127.0.0.1:5080", "127.0.0.1", 5080, false, ""],
    ["https://[2001:db8::1]:5080", "[2001:db8::1]", 5080, true, ""],
  ])("generates usable dual-shipping YAML for %s", async (url, host, port, useSsl, prefix) => {
    ingestion.url = url;
    const wrapper = await mountPage();
    const config = load(block(wrapper, "datadogagent-dual"));
    const endpoint = `${url}/datadog/${ORG}`;
    expect(config).toEqual({
      data_plane: { enabled: false },
      additional_endpoints: { [endpoint]: [ORG_TOKEN] },
      apm_config: { additional_endpoints: { [endpoint]: [ORG_TOKEN] } },
      logs_config: {
        force_use_http: true,
        additional_endpoints: [
          {
            host,
            port,
            use_ssl: useSsl,
            path_prefix: `${prefix}/datadog/${ORG}`,
            api_key: ORG_TOKEN,
          },
        ],
      },
    });
  });

  it("explains full-width Java correlation, profiler destinations and repeated tags", async () => {
    const wrapper = await mountPage();
    const text = wrapper.text();
    expect(text).toContain("DD_TRACE_128_BIT_TRACEID_LOGGING_ENABLED=true");
    expect(text).toContain("profiling");
    expect(text).toContain("JSON");
  });
});
