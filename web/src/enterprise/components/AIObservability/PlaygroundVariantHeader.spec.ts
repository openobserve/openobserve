// Copyright 2026 OpenObserve Inc.
// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import { emptyVariant } from "@/enterprise/views/AIObservability/playgroundDraft";
import type { Provider } from "@/services/online-evals.service";
import PlaygroundVariantHeader from "./PlaygroundVariantHeader.vue";

vi.mock("@/types/i18n", async () => {
  const actual = await vi.importActual<typeof import("@/types/i18n")>("@/types/i18n");
  return {
    ...actual,
    useI18nTyped: () => ({ t: (key: string) => key }),
  };
});

const OSelect = {
  name: "OSelect",
  props: ["modelValue", "options"],
  emits: ["update:model-value", "create"],
  template: "<div />",
};

const providers: Provider[] = [
  {
    id: "openai",
    name: "OpenAI",
    availableModels: ["gpt-4o-mini"],
    defaultModel: "gpt-4o-mini",
  },
  {
    id: "anthropic",
    name: "Anthropic",
    availableModels: ["claude-sonnet", "claude-haiku"],
    defaultModel: "claude-sonnet",
  },
];

describe("PlaygroundVariantHeader", () => {
  it("updates provider and model atomically", async () => {
    const variant = emptyVariant("openai", "gpt-4o-mini");
    const wrapper = mount(PlaygroundVariantHeader, {
      props: { variant, providers, label: "A" },
      global: {
        stubs: {
          OSelect,
          OButton: true,
          OInput: true,
          ODropdown: true,
        },
      },
    });

    wrapper.findComponent(OSelect).vm.$emit("update:model-value", "anthropic::claude-sonnet");
    await wrapper.vm.$nextTick();

    expect(wrapper.emitted("change")?.[0]?.[0]).toMatchObject({
      providerId: "anthropic",
      model: "claude-sonnet",
    });
  });
});
