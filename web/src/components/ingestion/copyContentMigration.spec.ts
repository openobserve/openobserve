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

import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createStore } from "vuex";
import { createMemoryHistory, createRouter } from "vue-router";
import type { Component } from "vue";
import CredentialCodeBlock from "./CredentialCodeBlock.vue";
import { OPEN_TOKEN_PICKER, maskSecret } from "@/composables/useCredentialSnippet";
import { FIRST_EVENT_SNIPPET_COPIED } from "@/composables/firstEvent/firstEventCopied";
import { b64EncodeStandard } from "@/utils/formatters";

const copyMock = vi.fn();
vi.mock("@/utils/clipboard", () => ({
  copyToClipboard: (...args: unknown[]) => copyMock(...args),
}));
const track = vi.fn();
vi.mock("@/services/product_analytics", () => ({
  default: { track: (...args: unknown[]) => track(...args) },
}));

const PASSCODE = "o2tokenSECRETvalue0123456789";
const EMAIL = "you@acme.io";
const BASIC = b64EncodeStandard(`${EMAIL}:${PASSCODE}`);

const makeStore = (overrides: Record<string, unknown> = {}) =>
  createStore({
    state: {
      API_ENDPOINT: "http://localhost:5080",
      selectedOrganization: { identifier: "acme-prod", name: "acme-prod", id: 1 },
      userInfo: { email: EMAIL },
      zoConfig: { ingestion_url: "", version: "", build_type: "opensource" },
      theme: "light",
      organizationData: {
        organizationPasscode: PASSCODE,
        organizationPasscodeForbidden: false,
        orgTokens: [
          { name: "default", token: PASSCODE, enabled: true },
          { name: "staging", token: "stagingTOKENvalue987654321", enabled: true },
        ],
        rumToken: { rum_token: "" },
        organizationSettings: {},
        ...overrides,
      },
    },
    mutations: {
      setOrganizationPasscode(state: any, value: string) {
        state.organizationData.organizationPasscode = value;
      },
    },
  });

const makeRouter = () =>
  createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/:any(.*)*", name: "curl", component: { template: "<div />" } }],
  });

const sources = import.meta.glob(["./**/*.vue", "./**/*.ts", "!./**/*.spec.ts"], {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

// These render the block only in a fallback branch the default mount does not reach.
const FALLBACK_ONLY = new Set([
  "./setupCard/DataSourceSetupCard.vue",
  "./ai/AIIntegrationDetail.vue",
]);

const pageModules = import.meta.glob<{ default: Component }>("./**/*.vue");
const migratedPages = Object.keys(sources)
  .filter((path) => path.endsWith(".vue") && sources[path].includes("<CredentialCodeBlock"))
  .sort();

describe("CopyContent migration", () => {
  it("leaves no CopyContent import under components/ingestion", () => {
    const importers = Object.keys(sources).filter((path) =>
      /import\s+\w+\s+from\s+["'][^"']*CopyContent(\.vue)?["']/.test(sources[path]),
    );
    expect(importers).toEqual([]);
  });

  it("migrates every page that rendered CopyContent", () => {
    // 57 importers at this branch's base, AzureConfig, AIIntegrationDetail and DataSourceSetupCard's fallback among them, minus SplunkHec (plain OCodeBlock).
    expect(migratedPages.length).toBe(56);
    expect(sources["./logs/SplunkHec.vue"]).toContain("<OCodeBlock");
  });

  it("gives every block a slug, so data-test ids follow the OCodeBlock prefix convention", () => {
    const tags = migratedPages.flatMap(
      (path) => sources[path].match(/<CredentialCodeBlock[^>]*>/g) ?? [],
    );
    expect(tags.length).toBeGreaterThan(0);
    for (const tag of tags) expect(tag).toMatch(/\s:?slug="/);
  });

  describe.each(migratedPages)("%s", (path) => {
    it("renders a code-masked OCodeBlock with no passcode in clear", async () => {
      const store = makeStore();
      const router = makeRouter();
      await router.push("/");
      const page = (await pageModules[path]()).default;
      const wrapper = mount(page, {
        props: { currOrgIdentifier: "acme-prod", currUserEmail: EMAIL, slug: "unregistered" },
        global: {
          plugins: [store, router],
          provide: { store },
          stubs: { IngestionDocLink: true, AIIntegrationCard: true, SetupCardRenderer: true },
        },
      });
      await flushPromises();
      const blocks = wrapper.findAllComponents(CredentialCodeBlock);
      if (FALLBACK_ONLY.has(path)) {
        expect(blocks.length).toBeLessThanOrEqual(1);
      } else {
        expect(blocks.length).toBeGreaterThan(0);
      }
      for (const block of blocks) {
        expect(block.find('[data-test$="-code-block"]').attributes("data-test")).toMatch(
          /^ingestion-[a-z0-9-]+-code-block$/,
        );
      }
      expect(wrapper.html()).not.toContain(PASSCODE);
      expect(wrapper.html()).not.toContain(BASIC);
      wrapper.unmount();
    });
  });
});

describe("CredentialCodeBlock", () => {
  const template = "curl -u [EMAIL]:[PASSCODE] https://h/api/acme-prod/default/_json";

  const router = makeRouter();

  const mountBlock = (
    content = template,
    store = makeStore(),
    provide: Record<symbol, unknown> = {},
  ) =>
    mount(CredentialCodeBlock, {
      props: { content, slug: "curl" },
      global: { plugins: [store, router], provide: { store, ...provide } },
      attachTo: document.body,
    });

  beforeEach(async () => {
    await router.push("/ingestion/custom/logs/curl");
    copyMock.mockReset();
    copyMock.mockResolvedValue(true);
    track.mockReset();
  });

  it("masks the passcode to its first and last four characters", () => {
    expect(maskSecret(PASSCODE)).toBe(`o2to${"•".repeat(12)}6789`);
    expect(maskSecret("short")).toBe("•".repeat(12));
    expect(maskSecret("")).toBe("");
  });

  it("shows the masked snippet and copies the real one with the token name", async () => {
    const wrapper = mountBlock();
    const pre = wrapper.find('[data-test="ingestion-curl-code-block-pre"]');
    expect(pre.text()).toContain(maskSecret(PASSCODE));
    expect(wrapper.html()).not.toContain(PASSCODE);
    await pre.trigger("click");
    await flushPromises();
    expect(copyMock.mock.calls[0][0]).toBe(
      `curl -u ${EMAIL}:${PASSCODE} https://h/api/acme-prod/default/_json`,
    );
    expect(copyMock.mock.calls[0][2].successMessage).toBe("Copied with org token default");
    expect(track).toHaveBeenCalledWith("snippet_copied", { route: "curl", partial: false });
    wrapper.unmount();
  });

  it("insets the code from the block border, as CopyContent did", () => {
    const wrapper = mountBlock();
    const pre = wrapper.find('[data-test="ingestion-curl-code-block-pre"]');
    expect(pre.attributes("style")).toContain("padding: 0.75rem");
    wrapper.unmount();
  });

  it("masks [BASIC_PASSCODE] too", () => {
    const wrapper = mountBlock("Authorization: Basic [BASIC_PASSCODE]");
    expect(wrapper.html()).not.toContain(BASIC);
    expect(wrapper.text()).toContain(maskSecret(BASIC));
    wrapper.unmount();
  });

  it("restarts the page's first-event watch on a copy, like every other copy", async () => {
    const copied = vi.fn();
    const wrapper = mountBlock(template, makeStore(), { [FIRST_EVENT_SNIPPET_COPIED]: copied });
    await wrapper.find('[data-test="ingestion-curl-code-block-pre"]').trigger("click");
    await flushPromises();
    expect(copied).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it("copies with no first-event watch on the page", async () => {
    const wrapper = mountBlock();
    await wrapper.find('[data-test="ingestion-curl-code-block-pre"]').trigger("click");
    await flushPromises();
    expect(copyMock).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it("opens the injected token picker from the toolbar link", async () => {
    const openPicker = vi.fn();
    const wrapper = mountBlock(template, makeStore(), { [OPEN_TOKEN_PICKER]: openPicker });
    const link = wrapper.find('[data-test="ingestion-curl-code-block-token-link"]');
    expect(link.text()).toBe("org token · default");
    await link.trigger("click");
    expect(openPicker).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it("recomputes the name, the mask and the copied token when the token changes", async () => {
    const store = makeStore();
    const wrapper = mountBlock(template, store);
    store.commit("setOrganizationPasscode", "stagingTOKENvalue987654321");
    await flushPromises();
    expect(wrapper.find('[data-test="ingestion-curl-code-block-token-link"]').text()).toBe(
      "org token · staging",
    );
    expect(wrapper.text()).toContain(maskSecret("stagingTOKENvalue987654321"));
    await wrapper.find('[data-test="ingestion-curl-code-block-pre"]').trigger("click");
    await flushPromises();
    expect(copyMock.mock.calls[0][0]).toContain("stagingTOKENvalue987654321");
    wrapper.unmount();
  });

  it("shows the forbidden banner instead of a hollow snippet", () => {
    const wrapper = mountBlock(template, makeStore({ organizationPasscodeForbidden: true }));
    expect(
      wrapper.find('[data-test="ingestion-curl-code-block-passcode-forbidden"]').exists(),
    ).toBe(true);
    expect(wrapper.find("pre").exists()).toBe(false);
    wrapper.unmount();
  });

  it("renders a snippet without credentials unmasked, with no token link", () => {
    const wrapper = mountBlock("echo hello");
    expect(wrapper.find('[data-test="ingestion-curl-code-block-reveal-btn"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="ingestion-curl-code-block-token-link"]').exists()).toBe(false);
    wrapper.unmount();
  });
});
