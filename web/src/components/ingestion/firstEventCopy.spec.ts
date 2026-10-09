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

import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createStore } from "vuex";
import { createMemoryHistory, createRouter } from "vue-router";
import { defineComponent, h, type Component } from "vue";
import i18n from "@/locales";
import OtelConfig from "./recommended/OtelConfig.vue";
import AWSConfig from "./recommended/AWSConfig.vue";
import AzureConfig from "./recommended/AzureConfig.vue";
import SplunkHec from "./logs/SplunkHec.vue";

vi.mock("@/utils/zincutils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/zincutils")>()),
  getIngestionURL: () => "http://localhost:5080",
  getEndPoint: () => ({
    url: "http://localhost:5080",
    host: "localhost",
    port: "5080",
    protocol: "http",
    tls: "off",
  }),
}));
vi.mock("@/services/product_analytics", () => ({ default: { track: vi.fn() } }));

// A copy on a credential block reaches the page only through the injected hook.
vi.mock("@/components/ingestion/CredentialCodeBlock.vue", async () => {
  const vue = await import("vue");
  const key = (await import("@/composables/firstEvent/firstEventCopied"))
    .FIRST_EVENT_SNIPPET_COPIED;
  return {
    default: vue.defineComponent({
      name: "CredentialCodeBlock",
      props: ["content", "slug"],
      setup(props) {
        const copied = vue.inject(key, null);
        return () =>
          vue.h("button", { "data-test": `copy-${props.slug}`, onClick: () => copied?.() });
      },
    }),
  };
});

const barStart = vi.fn();
const FirstEventStatusStub = defineComponent({
  name: "FirstEventStatus",
  props: ["org", "signal", "targetStream", "kind", "guideName", "docUrl", "snippetKind"],
  setup: (_props, { expose }) => {
    expose({ start: barStart });
    return () => h("div", { "data-test": "bar-stub" });
  },
});
const OCodeBlockStub = defineComponent({
  name: "OCodeBlock",
  props: ["code"],
  emits: ["copy"],
  setup:
    (_props, { emit }) =>
    () =>
      h("button", { onClick: () => emit("copy", { partial: false }) }),
});

const makeStore = () =>
  createStore({
    state: {
      API_ENDPOINT: "http://localhost:5080",
      selectedOrganization: { identifier: "acme-prod", name: "acme-prod" },
      userInfo: { email: "you@acme.io" },
      zoConfig: { ingestion_url: "", version: "", build_type: "opensource" },
      organizationData: { organizationPasscode: "x", orgTokens: [] },
    },
  });

let wrapper: VueWrapper;
const mountPage = async (page: Component) => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/tokens", name: "ingestionTokens", component: { template: "<div />" } },
      { path: "/:any(.*)*", name: "guide", component: { template: "<div />" } },
    ],
  });
  await router.push("/");
  const store = makeStore();
  wrapper = mount(page, {
    props: { currOrgIdentifier: "acme-prod", currUserEmail: "you@acme.io" },
    global: {
      plugins: [i18n, store, router],
      provide: { store },
      stubs: {
        FirstEventStatus: FirstEventStatusStub,
        OCodeBlock: OCodeBlockStub,
        AWSQuickSetup: true,
        AWSIndividualServices: true,
        IngestionDocLink: true,
      },
    },
  });
  await flushPromises();
  barStart.mockClear();
  return wrapper;
};

afterEach(() => {
  wrapper?.unmount();
  vi.clearAllMocks();
});

describe("a copy restarts the first-event watch on pages that mount the bar themselves", () => {
  it.each([
    ["OtelConfig", OtelConfig, "copy-otel-http"],
    ["AWSConfig", AWSConfig, "copy-aws"],
    ["AzureConfig", AzureConfig, "copy-azure-manual"],
  ] as const)("%s restarts the bar on a credential block copy", async (_n, page, button) => {
    await mountPage(page);
    await wrapper.find(`[data-test="${button}"]`).trigger("click");
    expect(barStart).toHaveBeenCalledWith("copy");
    expect(barStart).toHaveBeenCalledTimes(1);
  });

  it("SplunkHec restarts the bar on a copy of its curl example", async () => {
    await mountPage(SplunkHec);
    await wrapper.find('[data-test="ingestion-splunkhec-example-code-block"]').trigger("click");
    expect(barStart).toHaveBeenCalledWith("copy");
    expect(barStart).toHaveBeenCalledTimes(1);
  });
});
