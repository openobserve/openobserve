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
    providerType: "openai",
    availableModels: ["gpt-4o-mini"],
    defaultModel: "gpt-4o-mini",
  },
  {
    id: "anthropic",
    name: "Anthropic",
    providerType: "anthropic",
    availableModels: ["claude-sonnet", "claude-haiku"],
    defaultModel: "claude-sonnet",
  },
];

describe("PlaygroundVariantHeader", () => {
  it("labels each row with the connection name and its model", () => {
    const wrapper = mount(PlaygroundVariantHeader, {
      props: { variant: emptyVariant("openai", "gpt-4o-mini"), providers, label: "A" },
      global: { stubs: { OSelect, OButton: true, OInput: true, ODropdown: true } },
    });

    expect(wrapper.findComponent(OSelect).props("options")).toContainEqual({
      label: "OpenAI : gpt-4o-mini",
      value: "openai::gpt-4o-mini",
    });
  });

  // The real-world case: three connections the user named differently, all
  // exposing one identical model string.
  it("stays distinguishable when every provider carries the same model", () => {
    const wrapper = mount(PlaygroundVariantHeader, {
      props: {
        variant: emptyVariant("", ""),
        providers: [
          {
            id: "a",
            name: "gemini",
            providerType: "openai_compatible",
            availableModels: ["dummy-evaluator"],
          },
          {
            id: "b",
            name: "openai",
            providerType: "openai_compatible",
            availableModels: ["dummy-evaluator"],
          },
        ] as Provider[],
        label: "A",
      },
      global: { stubs: { OSelect, OButton: true, OInput: true, ODropdown: true } },
    });

    const options = wrapper.findComponent(OSelect).props("options");
    expect(options.map((option: any) => option.label)).toEqual([
      "gemini : dummy-evaluator",
      "openai : dummy-evaluator",
    ]);
  });

  // Without this the provider vanishes from a model-first list and becomes
  // unselectable, with nothing on screen saying why.
  it("falls back to a provider's default model, then says the list is empty", () => {
    const wrapper = mount(PlaygroundVariantHeader, {
      props: {
        variant: emptyVariant("", ""),
        providers: [
          { id: "p1", name: "Default only", defaultModel: "llama-3" },
          { id: "p2", name: "Nothing listed" },
        ] as Provider[],
        label: "A",
      },
      global: { stubs: { OSelect, OButton: true, OInput: true, ODropdown: true } },
    });

    const options = wrapper.findComponent(OSelect).props("options");
    expect(options).toContainEqual({ label: "Default only : llama-3", value: "p1::llama-3" });
    expect(options).toContainEqual({
      label: "Nothing listed",
      value: "p2::",
      disabled: true,
    });
  });

  // A typed model has no entry in any list, so without this the trigger falls
  // back to the placeholder and reads as "nothing selected".
  it("attributes a hand-typed model to the provider it was typed against", () => {
    const wrapper = mount(PlaygroundVariantHeader, {
      props: { variant: emptyVariant("anthropic", "claude-opus-typed"), providers, label: "A" },
      global: { stubs: { OSelect, OButton: true, OInput: true, ODropdown: true } },
    });

    expect(wrapper.findComponent(OSelect).props("options")).toContainEqual({
      label: "Anthropic : claude-opus-typed",
      value: "anthropic::claude-opus-typed",
    });
  });

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
