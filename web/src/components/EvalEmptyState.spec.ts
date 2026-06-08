// @vitest-environment jsdom
// Tests for the shared EvalEmptyState component. Verifies that:
//   • all four call-site variants render correctly via props
//   • chips render with or without icons
//   • theme prop controls the --dark modifier class
//   • the "create" event is emitted on CTA click
//   • data-test attributes are wired so e2e selectors keep working

import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createStore } from "vuex";
import EvalEmptyState from "./EvalEmptyState.vue";

// Lightweight stubs so we don't pull in the real OButton/OIcon trees.
const OButtonStub = {
  name: "OButton",
  template: '<button :data-test="$attrs[\'data-test\']" @click="$emit(\'click\')"><slot /></button>',
};
const OIconStub = {
  name: "OIcon",
  props: ["name", "size"],
  template: '<i class="o-icon" :data-icon="name" />',
};

function makeWrapper(propsOverride: Record<string, any> = {}, theme: "light" | "dark" = "light") {
  const store = createStore({
    state: { theme },
  });

  return mount(EvalEmptyState, {
    global: {
      plugins: [store],
      stubs: { OButton: OButtonStub, OIcon: OIconStub },
    },
    props: {
      dataTest: "test-empty-state",
      icon: "rule",
      title: "No data yet",
      description: "Get started by creating one.",
      chips: [],
      ctaLabel: "Create",
      ctaDataTest: "test-empty-create-btn",
      ...propsOverride,
    },
  });
}

describe("EvalEmptyState — base rendering", () => {
  it("renders the title and description from props", () => {
    const wrapper = makeWrapper({
      title: "No scorers yet",
      description: "Add a scorer to get started.",
    });
    expect(wrapper.text()).toContain("No scorers yet");
    expect(wrapper.text()).toContain("Add a scorer to get started.");
  });

  it("renders the CTA label and root data-test attributes", () => {
    const wrapper = makeWrapper({
      dataTest: "scorer-empty-state",
      ctaDataTest: "scorer-empty-create-btn",
      ctaLabel: "New Scorer",
    });
    expect(wrapper.find('[data-test="scorer-empty-state"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="scorer-empty-create-btn"]').exists()).toBe(true);
    expect(wrapper.text()).toContain("New Scorer");
  });

  it("renders the main icon prop on the inner OIcon", () => {
    const wrapper = makeWrapper({ icon: "assessment" });
    // OIconStub exposes its name prop as data-icon — find at least one match
    const icons = wrapper.findAll('[data-icon="assessment"]');
    expect(icons.length).toBeGreaterThan(0);
  });
});

describe("EvalEmptyState — chips", () => {
  it("renders nothing in the chips area when chips array is empty", () => {
    const wrapper = makeWrapper({ chips: [] });
    expect(wrapper.find(".ev-empty__chips").exists()).toBe(false);
  });

  it("renders one span per chip with the label", () => {
    const wrapper = makeWrapper({
      chips: [
        { icon: "stream", label: "Streams" },
        { icon: "rule", label: "Scorers" },
        { icon: "tune", label: "Sampling" },
      ],
    });
    const chips = wrapper.findAll(".ev-empty__chip");
    expect(chips).toHaveLength(3);
    expect(chips[0].text()).toContain("Streams");
    expect(chips[1].text()).toContain("Scorers");
    expect(chips[2].text()).toContain("Sampling");
  });

  it("omits the chip icon when chip.icon is not provided (brand-only chips)", () => {
    const wrapper = makeWrapper({
      chips: [{ label: "OpenAI" }, { label: "Anthropic" }],
    });
    const chipsWithIcons = wrapper.findAll(".ev-empty__chip .o-icon");
    expect(chipsWithIcons).toHaveLength(0);
  });

  it("renders icon + label when chip.icon is provided", () => {
    const wrapper = makeWrapper({
      chips: [{ icon: "stream", label: "Streams" }],
    });
    expect(wrapper.find('.ev-empty__chip [data-icon="stream"]').exists()).toBe(true);
  });
});

describe("EvalEmptyState — theme", () => {
  it("applies the --dark modifier class when store theme is dark", () => {
    const wrapper = makeWrapper({}, "dark");
    expect(wrapper.find(".ev-empty").classes()).toContain("ev-empty--dark");
  });

  it("does not apply --dark modifier when theme is light", () => {
    const wrapper = makeWrapper({}, "light");
    expect(wrapper.find(".ev-empty").classes()).not.toContain("ev-empty--dark");
  });

  it("applies --dark on chips when theme is dark", () => {
    const wrapper = makeWrapper(
      { chips: [{ label: "OpenAI" }] },
      "dark",
    );
    expect(wrapper.find(".ev-empty__chip").classes()).toContain(
      "ev-empty__chip--dark",
    );
  });
});

describe("EvalEmptyState — events", () => {
  it("emits 'create' when the CTA button is clicked", async () => {
    const wrapper = makeWrapper({ ctaDataTest: "x-create-btn" });
    await wrapper.find('[data-test="x-create-btn"]').trigger("click");
    // OButton stub forwards both native bubbling + $emit('click') — both reach
    // the parent's @click="$emit('create')", which is fine; we only care that
    // at least one create event fired.
    expect((wrapper.emitted("create") ?? []).length).toBeGreaterThan(0);
  });

  it("does not emit 'create' on chip click", async () => {
    const wrapper = makeWrapper({
      chips: [{ label: "OpenAI" }],
    });
    await wrapper.find(".ev-empty__chip").trigger("click");
    expect(wrapper.emitted("create")).toBeUndefined();
  });
});
