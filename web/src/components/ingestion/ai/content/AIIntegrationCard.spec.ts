// Copyright 2026 OpenObserve Inc.

import { mount, VueWrapper } from "@vue/test-utils";
import { describe, expect, it, afterEach, beforeEach, vi } from "vitest";

vi.mock("@/composables/useIngestion", () => ({
  default: () => ({
    endpoint: { value: { url: "https://api.example.com" } },
  }),
}));

import AIIntegrationCard from "./AIIntegrationCard.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

const BANNER = '[data-test="ai-integration-card-passcode-forbidden"]';
const CARD = '[data-test="ai-integration-card"]';

// A card whose runnable snippet embeds the credential.
const CONTENT_WITH_TOKEN = [
  "# Anthropic",
  "",
  "## Setup",
  "",
  "```bash",
  'curl -H "Authorization: Basic {token}" {url}/api/{org}/default/_json',
  "```",
].join("\n");

// A card that is purely explanatory — endpoints and prose, no credential.
const CONTENT_WITHOUT_TOKEN = [
  "# Anthropic",
  "",
  "## Overview",
  "",
  "Point your collector at the OpenObserve endpoint.",
  "",
  "```yaml",
  "exporters:",
  "  otlphttp:",
  "    endpoint: {url}/api/{org}",
  "```",
].join("\n");

const mountCard = (content: string) =>
  mount(AIIntegrationCard, {
    props: { content },
    global: {
      plugins: [i18n],
      provide: { store },
      stubs: {
        OTag: { template: "<span><slot /></span>" },
        OCodeBlock: { template: "<pre />", props: ["code", "lang"] },
        OBanner: {
          template: '<div :data-test="$attrs[`data-test`]" />',
          props: ["variant", "content"],
        },
      },
    },
  });

describe("AIIntegrationCard passcode gating", () => {
  let wrapper: VueWrapper | null = null;

  beforeEach(() => {
    store.state.organizationData.organizationPasscodeForbidden = false;
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    store.state.organizationData.organizationPasscodeForbidden = false;
  });

  it("withholds a credential-bearing card when the passcode is forbidden", () => {
    store.state.organizationData.organizationPasscodeForbidden = true;
    wrapper = mountCard(CONTENT_WITH_TOKEN);

    expect(wrapper.find(BANNER).exists()).toBe(true);
    expect(wrapper.find(CARD).exists()).toBe(false);
  });

  it("still renders a card that embeds no credential when the passcode is forbidden", () => {
    // The whole point of matching CopyContent's gate: prose, endpoints and doc
    // links stay visible to a non-Admin when there is no credential to leak.
    store.state.organizationData.organizationPasscodeForbidden = true;
    wrapper = mountCard(CONTENT_WITHOUT_TOKEN);

    expect(wrapper.find(BANNER).exists()).toBe(false);
    expect(wrapper.find(CARD).exists()).toBe(true);
  });

  it("renders a credential-bearing card normally when the passcode is readable", () => {
    wrapper = mountCard(CONTENT_WITH_TOKEN);

    expect(wrapper.find(BANNER).exists()).toBe(false);
    expect(wrapper.find(CARD).exists()).toBe(true);
  });
});
