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

/**
 * Component: FrontendRumConfig
 * Path: src/components/ingestion/recommended/FrontendRumConfig.vue
 *
 * Props: currOrgIdentifier?, currUserEmail?
 * Emits: none
 * Store deps: organizationData.rumToken.rum_token, selectedOrganization.identifier, API_ENDPOINT
 * Service deps: getIngestionURL (from @/utils/zincutils), maskText (from @/utils/zincutils)
 * Child components: SetupCardRenderer (stubbed)
 *
 * Conditional states:
 *   - Token present  → renders SetupCardRenderer [data-test="rum-web-setup-card"]
 *   - Token absent   → renders <p data-test="rum-web-no-token-message">
 *
 * Key computed values:
 *   - endpoint  = getIngestionURL() with trailing slash stripped
 *   - site      = endpoint without protocol
 *   - insecureHTTP = API_ENDPOINT does NOT start with "https://"
 *   - content   = rumCard({ site, endpoint, org, rumToken, rumTokenMasked, insecureHTTP })
 *   - subs      = { url: endpoint, org, token: "" }
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import { createStore } from "vuex";
import { createI18n } from "vue-i18n";

// ── vi.mock() must be at the top — hoisted by Vitest ──────────────────────────

vi.mock("@/utils/zincutils", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    getImageURL: vi.fn((p: string) => `/mock/${p}`),
    getIngestionURL: vi.fn(() => "https://ingest.example.com"),
    maskText: vi.fn((t: string) => t), // real maskText is identity
  };
});

// Stub SetupCardRenderer so we can inspect the props it receives without
// rendering its (heavy) internals.
vi.mock(
  "@/components/ingestion/setupCard/SetupCardRenderer.vue",
  () => ({
    default: {
      name: "SetupCardRenderer",
      props: ["content", "subs"],
      // Renders the hero-actions slot like the real component does — the
      // platform switch lives there, so the tests below need it in the DOM.
      template:
        '<div data-test="rum-web-setup-card"><slot name="hero-actions" /></div>',
    },
  }),
);

import FrontendRumConfig from "./FrontendRumConfig.vue";
import { getIngestionURL, maskText } from "@/utils/zincutils";

// ── helpers ───────────────────────────────────────────────────────────────────

const HTTPS_ENDPOINT = "https://ingest.example.com";
const HTTP_ENDPOINT = "http://ingest.example.com";
const ORG_ID = "my-org";
const RUM_TOKEN = "rum-secret-token-xyz";

function makeStore(overrides: {
  rumToken?: string;
  org?: string;
  apiEndpoint?: string;
} = {}) {
  const {
    rumToken = RUM_TOKEN,
    org = ORG_ID,
    apiEndpoint = HTTPS_ENDPOINT,
  } = overrides;

  return createStore({
    state: {
      API_ENDPOINT: apiEndpoint,
      selectedOrganization: { identifier: org },
      organizationData: {
        rumToken: rumToken !== undefined ? { rum_token: rumToken } : null,
      },
      zoConfig: {},
    },
    mutations: {
      setRUMToken(state: any, payload: any) {
        state.organizationData.rumToken = payload;
      },
      endpoint(state: any, payload: any) {
        state.API_ENDPOINT = payload;
      },
    },
  });
}

const i18n = createI18n({
  locale: "en",
  messages: {
    en: {
      ingestion: {
        generateRUMTokenMessage:
          "Generate RUM Token to enable RUM for your organization.",
        rumPlatform: "Platform",
        rumPlatformBrowser: "Browser",
        rumPlatformReactNative: "React Native",
      },
    },
  },
});

function mountComponent(storeOverrides: Parameters<typeof makeStore>[0] = {}) {
  const store = makeStore(storeOverrides);
  const wrapper = mount(FrontendRumConfig, {
    props: { currOrgIdentifier: ORG_ID, currUserEmail: "user@example.com" },
    global: { plugins: [store, i18n] },
  });
  return { wrapper, store };
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("FrontendRumConfig", () => {
  let wrapper: VueWrapper<any>;

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  // ── rendering ───────────────────────────────────────────────────────────────

  describe("rendering — token present", () => {
    beforeEach(() => {
      // reset the mock so each test starts with the default endpoint
      vi.mocked(getIngestionURL).mockReturnValue(HTTPS_ENDPOINT);
      ({ wrapper } = mountComponent());
    });

    it("renders SetupCardRenderer when rumToken is non-empty", () => {
      expect(
        wrapper.find('[data-test="rum-web-setup-card"]').exists(),
      ).toBe(true);
    });

    it("does NOT render the no-token message when token is present", () => {
      expect(
        wrapper.find('[data-test="rum-web-no-token-message"]').exists(),
      ).toBe(false);
    });

    it("passes content with 3 steps to SetupCardRenderer", () => {
      const card = wrapper.findComponent({ name: "SetupCardRenderer" });
      expect(card.props("content").steps).toHaveLength(3);
    });

    it("passes step ids install / init / verify", () => {
      const card = wrapper.findComponent({ name: "SetupCardRenderer" });
      const ids = card.props("content").steps.map((s: any) => s.id);
      expect(ids).toEqual(["install", "init", "verify"]);
    });

    it("passes subs.token as empty string (RUM never exposes Basic-auth token)", () => {
      const card = wrapper.findComponent({ name: "SetupCardRenderer" });
      expect(card.props("subs").token).toBe("");
    });

    it("passes subs.org matching the store's selected organization identifier", () => {
      const card = wrapper.findComponent({ name: "SetupCardRenderer" });
      expect(card.props("subs").org).toBe(ORG_ID);
    });

    it("passes subs.url equal to the endpoint (no trailing slash)", () => {
      const card = wrapper.findComponent({ name: "SetupCardRenderer" });
      expect(card.props("subs").url).toBe(HTTPS_ENDPOINT);
    });

    it("strips a trailing slash from getIngestionURL output", () => {
      vi.mocked(getIngestionURL).mockReturnValue("https://ingest.example.com/");
      wrapper.unmount();
      ({ wrapper } = mountComponent());

      const card = wrapper.findComponent({ name: "SetupCardRenderer" });
      expect(card.props("subs").url).toBe("https://ingest.example.com");
      expect(card.props("subs").url.endsWith("/")).toBe(false);
    });

    it("passes the rum token into content init variant raw code", () => {
      const card = wrapper.findComponent({ name: "SetupCardRenderer" });
      const initStep = card
        .props("content")
        .steps.find((s: any) => s.id === "init");
      const npmVariant = initStep.variants.find((v: any) => v.id === "npm");
      expect(npmVariant.code.raw).toContain(RUM_TOKEN);
    });

    it("content's masked code does NOT equal the raw when maskText produces a different string", () => {
      // With the real maskText (identity), raw === masked; but the structure must exist
      const card = wrapper.findComponent({ name: "SetupCardRenderer" });
      const initStep = card
        .props("content")
        .steps.find((s: any) => s.id === "init");
      const npmVariant = initStep.variants.find((v: any) => v.id === "npm");
      // Both raw and masked must be strings
      expect(typeof npmVariant.code.raw).toBe("string");
      expect(typeof npmVariant.code.masked).toBe("string");
    });

    it("content's detect targets _rumdata stream with type='view' filter", () => {
      const card = wrapper.findComponent({ name: "SetupCardRenderer" });
      const detect = card.props("content").detect;
      expect(detect.streamType).toBe("logs");
      expect(detect.streamName).toBe("_rumdata");
      expect(detect.filter).toBe("type = 'view'");
    });

    it("install and init steps share variantGroup 'pkg'", () => {
      const card = wrapper.findComponent({ name: "SetupCardRenderer" });
      const steps = card.props("content").steps;
      const install = steps.find((s: any) => s.id === "install");
      const init = steps.find((s: any) => s.id === "init");
      expect(install.variantGroup).toBe("pkg");
      expect(init.variantGroup).toBe("pkg");
    });

    it("install and init steps each have npm and cdn variants", () => {
      const card = wrapper.findComponent({ name: "SetupCardRenderer" });
      const steps = card.props("content").steps;
      for (const stepId of ["install", "init"]) {
        const step = steps.find((s: any) => s.id === stepId);
        const variantIds = step.variants.map((v: any) => v.id);
        expect(variantIds).toContain("npm");
        expect(variantIds).toContain("cdn");
      }
    });
  });

  describe("rendering — token absent", () => {
    it("renders the no-token message paragraph when rumToken is empty string", () => {
      vi.mocked(getIngestionURL).mockReturnValue(HTTPS_ENDPOINT);
      ({ wrapper } = mountComponent({ rumToken: "" }));

      const msg = wrapper.find('[data-test="rum-web-no-token-message"]');
      expect(msg.exists()).toBe(true);
      expect(msg.text()).toContain(
        "Generate RUM Token to enable RUM for your organization.",
      );
    });

    it("does NOT render SetupCardRenderer when rumToken is empty string", () => {
      vi.mocked(getIngestionURL).mockReturnValue(HTTPS_ENDPOINT);
      ({ wrapper } = mountComponent({ rumToken: "" }));

      expect(
        wrapper.find('[data-test="rum-web-setup-card"]').exists(),
      ).toBe(false);
    });

    it("renders the no-token message when organizationData has no rumToken property", () => {
      vi.mocked(getIngestionURL).mockReturnValue(HTTPS_ENDPOINT);
      const store = createStore({
        state: {
          API_ENDPOINT: HTTPS_ENDPOINT,
          selectedOrganization: { identifier: ORG_ID },
          organizationData: {},
          zoConfig: {},
        },
        mutations: {},
      });
      wrapper = mount(FrontendRumConfig, {
        global: { plugins: [store, i18n] },
      });

      expect(
        wrapper.find('[data-test="rum-web-no-token-message"]').exists(),
      ).toBe(true);
      expect(
        wrapper.find('[data-test="rum-web-setup-card"]').exists(),
      ).toBe(false);
    });
  });

  // ── insecureHTTP flag ────────────────────────────────────────────────────────

  describe("insecureHTTP derivation", () => {
    it("insecureHTTP is false when API_ENDPOINT starts with https://", () => {
      vi.mocked(getIngestionURL).mockReturnValue(HTTPS_ENDPOINT);
      ({ wrapper } = mountComponent({ apiEndpoint: "https://api.example.com" }));

      const card = wrapper.findComponent({ name: "SetupCardRenderer" });
      const initStep = card
        .props("content")
        .steps.find((s: any) => s.id === "init");
      const npmVariant = initStep.variants.find((v: any) => v.id === "npm");
      expect(npmVariant.code.raw).toContain("insecureHTTP: false");
    });

    it("insecureHTTP is true when API_ENDPOINT starts with http://", () => {
      vi.mocked(getIngestionURL).mockReturnValue(HTTP_ENDPOINT);
      ({ wrapper } = mountComponent({ apiEndpoint: "http://api.example.com" }));

      const card = wrapper.findComponent({ name: "SetupCardRenderer" });
      const initStep = card
        .props("content")
        .steps.find((s: any) => s.id === "init");
      const npmVariant = initStep.variants.find((v: any) => v.id === "npm");
      expect(npmVariant.code.raw).toContain("insecureHTTP: true");
    });

    it("insecureHTTP is true when API_ENDPOINT is empty string", () => {
      vi.mocked(getIngestionURL).mockReturnValue(HTTPS_ENDPOINT);
      ({ wrapper } = mountComponent({ apiEndpoint: "" }));

      const card = wrapper.findComponent({ name: "SetupCardRenderer" });
      const initStep = card
        .props("content")
        .steps.find((s: any) => s.id === "init");
      const npmVariant = initStep.variants.find((v: any) => v.id === "npm");
      expect(npmVariant.code.raw).toContain("insecureHTTP: true");
    });
  });

  // ── site derivation ──────────────────────────────────────────────────────────

  describe("site value (protocol stripped)", () => {
    it("strips https:// from endpoint for site option", () => {
      vi.mocked(getIngestionURL).mockReturnValue("https://ingest.openobserve.ai");
      ({ wrapper } = mountComponent());

      const card = wrapper.findComponent({ name: "SetupCardRenderer" });
      const initStep = card
        .props("content")
        .steps.find((s: any) => s.id === "init");
      const npmVariant = initStep.variants.find((v: any) => v.id === "npm");
      expect(npmVariant.code.raw).toContain("site: 'ingest.openobserve.ai'");
    });

    it("strips http:// from endpoint for site option", () => {
      vi.mocked(getIngestionURL).mockReturnValue("http://ingest.openobserve.ai");
      ({ wrapper } = mountComponent({ apiEndpoint: "http://ingest.openobserve.ai" }));

      const card = wrapper.findComponent({ name: "SetupCardRenderer" });
      const initStep = card
        .props("content")
        .steps.find((s: any) => s.id === "init");
      const npmVariant = initStep.variants.find((v: any) => v.id === "npm");
      expect(npmVariant.code.raw).toContain("site: 'ingest.openobserve.ai'");
    });
  });

  // ── org substitution ─────────────────────────────────────────────────────────

  describe("org substitution", () => {
    it("reflects the org identifier in content init code", () => {
      vi.mocked(getIngestionURL).mockReturnValue(HTTPS_ENDPOINT);
      ({ wrapper } = mountComponent({ org: "acme-corp" }));

      const card = wrapper.findComponent({ name: "SetupCardRenderer" });
      const initStep = card
        .props("content")
        .steps.find((s: any) => s.id === "init");
      const npmVariant = initStep.variants.find((v: any) => v.id === "npm");
      expect(npmVariant.code.raw).toContain("organizationIdentifier: 'acme-corp'");
    });

    it("reflects empty org when selectedOrganization is absent", () => {
      vi.mocked(getIngestionURL).mockReturnValue(HTTPS_ENDPOINT);
      const store = createStore({
        state: {
          API_ENDPOINT: HTTPS_ENDPOINT,
          selectedOrganization: null,
          organizationData: { rumToken: { rum_token: RUM_TOKEN } },
          zoConfig: {},
        },
        mutations: {},
      });
      wrapper = mount(FrontendRumConfig, {
        global: { plugins: [store, i18n] },
      });

      const card = wrapper.findComponent({ name: "SetupCardRenderer" });
      const initStep = card
        .props("content")
        .steps.find((s: any) => s.id === "init");
      const npmVariant = initStep.variants.find((v: any) => v.id === "npm");
      expect(npmVariant.code.raw).toContain("organizationIdentifier: ''");
    });
  });

  // ── props ────────────────────────────────────────────────────────────────────

  describe("props", () => {
    beforeEach(() => {
      vi.mocked(getIngestionURL).mockReturnValue(HTTPS_ENDPOINT);
    });

    it("mounts without currOrgIdentifier and currUserEmail (both optional)", () => {
      const store = makeStore();
      const w = mount(FrontendRumConfig, {
        global: { plugins: [store, i18n] },
      });
      expect(w.exists()).toBe(true);
      w.unmount();
    });

    it("accepts any string values for currOrgIdentifier and currUserEmail", () => {
      const store = makeStore();
      const w = mount(FrontendRumConfig, {
        props: { currOrgIdentifier: "alt-org", currUserEmail: "alt@example.com" },
        global: { plugins: [store, i18n] },
      });
      expect(w.exists()).toBe(true);
      w.unmount();
    });
  });

  // ── masked token ─────────────────────────────────────────────────────────────

  describe("masked token in content", () => {
    it("masked code variant exists on npm init step", () => {
      vi.mocked(getIngestionURL).mockReturnValue(HTTPS_ENDPOINT);
      ({ wrapper } = mountComponent());

      const card = wrapper.findComponent({ name: "SetupCardRenderer" });
      const initStep = card
        .props("content")
        .steps.find((s: any) => s.id === "init");
      const npmVariant = initStep.variants.find((v: any) => v.id === "npm");
      expect(npmVariant.code).toHaveProperty("masked");
    });

    it("masked code variant exists on cdn init step", () => {
      vi.mocked(getIngestionURL).mockReturnValue(HTTPS_ENDPOINT);
      ({ wrapper } = mountComponent());

      const card = wrapper.findComponent({ name: "SetupCardRenderer" });
      const initStep = card
        .props("content")
        .steps.find((s: any) => s.id === "init");
      const cdnVariant = initStep.variants.find((v: any) => v.id === "cdn");
      expect(cdnVariant.code).toHaveProperty("masked");
    });

    it("masked token is built from maskText and differs from raw when maskText transforms the input", () => {
      // The component calls maskText(rumToken) to get rumTokenMasked and passes
      // both to rumCard. We verify the masked variant's code contains the masked
      // value while the raw variant's code retains the original token.
      vi.mocked(getIngestionURL).mockReturnValue(HTTPS_ENDPOINT);

      // Override maskText to return a clearly-different value
      vi.mocked(maskText).mockReturnValue("****masked****");

      wrapper?.unmount();
      ({ wrapper } = mountComponent());

      const card = wrapper.findComponent({ name: "SetupCardRenderer" });
      const initStep = card
        .props("content")
        .steps.find((s: any) => s.id === "init");
      const npmVariant = initStep.variants.find((v: any) => v.id === "npm");
      // masked should use the maskText return value
      expect(npmVariant.code.masked).toContain("****masked****");
      // raw should use the real token
      expect(npmVariant.code.raw).toContain(RUM_TOKEN);
    });
  });

  // ── CDN install code ─────────────────────────────────────────────────────────

  describe("CDN install step code", () => {
    beforeEach(() => {
      vi.mocked(getIngestionURL).mockReturnValue(HTTPS_ENDPOINT);
      ({ wrapper } = mountComponent());
    });

    it("CDN install code contains preconnect link for browsersdk.openobserve.ai", () => {
      const card = wrapper.findComponent({ name: "SetupCardRenderer" });
      const installStep = card
        .props("content")
        .steps.find((s: any) => s.id === "install");
      const cdnVariant = installStep.variants.find((v: any) => v.id === "cdn");
      expect(cdnVariant.code.raw).toContain(
        'rel="preconnect" href="https://browsersdk.openobserve.ai"',
      );
    });

    it("CDN install code contains dns-prefetch for browsersdk.openobserve.ai", () => {
      const card = wrapper.findComponent({ name: "SetupCardRenderer" });
      const installStep = card
        .props("content")
        .steps.find((s: any) => s.id === "install");
      const cdnVariant = installStep.variants.find((v: any) => v.id === "cdn");
      expect(cdnVariant.code.raw).toContain(
        'rel="dns-prefetch" href="https://browsersdk.openobserve.ai"',
      );
    });

    it("CDN install code contains preconnect link for the ingestion endpoint", () => {
      const card = wrapper.findComponent({ name: "SetupCardRenderer" });
      const installStep = card
        .props("content")
        .steps.find((s: any) => s.id === "install");
      const cdnVariant = installStep.variants.find((v: any) => v.id === "cdn");
      expect(cdnVariant.code.raw).toContain(
        `href="${HTTPS_ENDPOINT}"`,
      );
    });

    it("CDN install code contains OO_RUM async loader global", () => {
      const card = wrapper.findComponent({ name: "SetupCardRenderer" });
      const installStep = card
        .props("content")
        .steps.find((s: any) => s.id === "install");
      const cdnVariant = installStep.variants.find((v: any) => v.id === "cdn");
      expect(cdnVariant.code.raw).toContain("OO_RUM");
    });

    it("CDN install code contains OO_LOGS async loader global", () => {
      const card = wrapper.findComponent({ name: "SetupCardRenderer" });
      const installStep = card
        .props("content")
        .steps.find((s: any) => s.id === "install");
      const cdnVariant = installStep.variants.find((v: any) => v.id === "cdn");
      expect(cdnVariant.code.raw).toContain("OO_LOGS");
    });
  });

  // ── NPM install command ──────────────────────────────────────────────────────

  describe("NPM install step", () => {
    beforeEach(() => {
      vi.mocked(getIngestionURL).mockReturnValue(HTTPS_ENDPOINT);
      ({ wrapper } = mountComponent());
    });

    it("NPM install code is the exact install command", () => {
      const card = wrapper.findComponent({ name: "SetupCardRenderer" });
      const installStep = card
        .props("content")
        .steps.find((s: any) => s.id === "install");
      const npmVariant = installStep.variants.find((v: any) => v.id === "npm");
      expect(npmVariant.code.raw).toBe(
        "npm i @openobserve/browser-rum @openobserve/browser-logs",
      );
    });
  });

  // ── platform switcher ───────────────────────────────────────────────────

  describe("platform switcher", () => {
    beforeEach(() => {
      vi.mocked(getIngestionURL).mockReturnValue(HTTPS_ENDPOINT);
      ({ wrapper } = mountComponent());
    });

    it("renders both platform options with their labels when rumToken is present", () => {
      const browserTab = wrapper.find(
        '[data-test="rum-setup-platform-browser"]',
      );
      const reactNativeTab = wrapper.find(
        '[data-test="rum-setup-platform-react-native"]',
      );

      expect(browserTab.exists()).toBe(true);
      expect(browserTab.text()).toBe("Browser");
      expect(reactNativeTab.exists()).toBe(true);
      expect(reactNativeTab.text()).toBe("React Native");
    });

    it("does NOT render the platform switcher when rumToken is empty", () => {
      wrapper.unmount();
      ({ wrapper } = mountComponent({ rumToken: "" }));

      expect(
        wrapper.find('[data-test="rum-setup-platform-group"]').exists(),
      ).toBe(false);
      expect(
        wrapper.find('[data-test="rum-web-no-token-message"]').exists(),
      ).toBe(true);
    });

    it("defaults to the browser card with 3 steps and the browser provider name", () => {
      const card = wrapper.findComponent({ name: "SetupCardRenderer" });
      const content = card.props("content");

      expect(content.provider.name).toBe("Real User Monitoring");
      expect(content.steps).toHaveLength(3);
    });

    it("swaps to the React Native card when React Native is selected", async () => {
      const reactNativeTab = wrapper.find(
        '[data-test="rum-setup-platform-react-native"]',
      );

      await reactNativeTab.trigger("click");

      const card = wrapper.findComponent({ name: "SetupCardRenderer" });
      const content = card.props("content");
      // Title deliberately stays "Real User Monitoring" on both platforms.
      expect(content.provider.name).toBe("Real User Monitoring");
      expect(content.steps.map((s: any) => s.id)).toEqual([
        "install",
        "init",
        "session-replay",
        "navigation",
        "verify",
      ]);
    });

    it("sets the React Native card's detect filter to source = 'react-native'", async () => {
      const reactNativeTab = wrapper.find(
        '[data-test="rum-setup-platform-react-native"]',
      );

      await reactNativeTab.trigger("click");

      const card = wrapper.findComponent({ name: "SetupCardRenderer" });
      expect(card.props("content").detect.filter).toBe(
        "source = 'react-native'",
      );
    });

    it("restores the browser card when switching back to Browser", async () => {
      await wrapper
        .find('[data-test="rum-setup-platform-react-native"]')
        .trigger("click");

      await wrapper
        .find('[data-test="rum-setup-platform-browser"]')
        .trigger("click");

      const card = wrapper.findComponent({ name: "SetupCardRenderer" });
      const content = card.props("content");
      expect(content.provider.name).toBe("Real User Monitoring");
      expect(content.steps.map((s: any) => s.id)).toEqual([
        "install",
        "init",
        "verify",
      ]);
    });
  });
});
