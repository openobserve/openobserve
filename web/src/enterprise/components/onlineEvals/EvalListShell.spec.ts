// @vitest-environment jsdom
// Tests for EvalListShell — the page chrome shared by ScorerList,
// ScoreConfigList, EvalJobList. Verifies:
//   • the empty branch shows the #empty slot when showEmpty is true
//   • the populated branch shows toolbar (title, search, filter slot, add button) and #table slot
//   • search v-model emits update:search
//   • CTA click emits create
//   • data-test attributes follow the `${dataTest}-list-*` convention

import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import EvalListShell from "./EvalListShell.vue";

const OButtonStub = {
  name: "OButton",
  template: '<button :data-test="$attrs[\'data-test\']" @click="$emit(\'click\')"><slot /></button>',
};
const OIconStub = {
  name: "OIcon",
  props: ["name", "size"],
  template: '<i :data-icon="name" />',
};
const OInputStub = {
  name: "OInput",
  props: ["modelValue", "placeholder"],
  emits: ["update:modelValue"],
  template: `<input
    :data-test="$attrs['data-test']"
    :placeholder="placeholder"
    :value="modelValue"
    @input="$emit('update:modelValue', $event.target.value)"
  />`,
};

function makeWrapper(
  propsOverride: Record<string, any> = {},
  slots: Record<string, string> = {},
) {
  return mount(EvalListShell, {
    global: { stubs: { OButton: OButtonStub, OIcon: OIconStub, OInput: OInputStub } },
    props: {
      dataTest: "scorer",
      title: "Scorers",
      search: "",
      searchPlaceholder: "Search scorers",
      addLabel: "New Scorer",
      showEmpty: false,
      ...propsOverride,
    },
    slots: {
      empty: '<div class="test-empty">EMPTY_BRANCH</div>',
      filter: '<div class="test-filter">FILTER_SLOT</div>',
      table: '<div class="test-table">TABLE_SLOT</div>',
      ...slots,
    },
  });
}

describe("EvalListShell — empty branch", () => {
  it("shows the #empty slot and hides toolbar/table when showEmpty=true", () => {
    const wrapper = makeWrapper({ showEmpty: true });
    expect(wrapper.find(".test-empty").exists()).toBe(true);
    expect(wrapper.find(".test-table").exists()).toBe(false);
    expect(wrapper.find('[data-test="scorer-list-add-btn"]').exists()).toBe(false);
  });

  it("hides the empty slot when showEmpty=false", () => {
    const wrapper = makeWrapper({ showEmpty: false });
    expect(wrapper.find(".test-empty").exists()).toBe(false);
  });
});

describe("EvalListShell — populated branch", () => {
  it("renders the title from the prop", () => {
    const wrapper = makeWrapper({ title: "Eval Jobs" });
    expect(wrapper.text()).toContain("Eval Jobs");
  });

  it("renders the search input with the configured placeholder", () => {
    const wrapper = makeWrapper({ searchPlaceholder: "Search jobs…" });
    const input = wrapper.find("input");
    expect(input.attributes("placeholder")).toBe("Search jobs…");
  });

  it("renders the add button with the configured label", () => {
    const wrapper = makeWrapper({ addLabel: "New Job" });
    expect(wrapper.find('[data-test="scorer-list-add-btn"]').text()).toContain(
      "New Job",
    );
  });

  it("renders the #filter slot in the toolbar", () => {
    const wrapper = makeWrapper();
    expect(wrapper.find(".test-filter").exists()).toBe(true);
  });

  it("renders the #table slot in the body", () => {
    const wrapper = makeWrapper();
    expect(wrapper.find(".test-table").exists()).toBe(true);
  });
});

describe("EvalListShell — data-test prefix", () => {
  it("wires every data-test attribute with the prefix", () => {
    const wrapper = makeWrapper({ dataTest: "eval-job" });
    expect(wrapper.find('[data-test="eval-job-list-page"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="eval-job-list-title"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="eval-job-list-search-input"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="eval-job-list-add-btn"]').exists()).toBe(true);
  });

  it("keeps the data-test-page attribute even on the empty branch", () => {
    const wrapper = makeWrapper({ dataTest: "score-config", showEmpty: true });
    expect(wrapper.find('[data-test="score-config-list-page"]').exists()).toBe(true);
  });
});

describe("EvalListShell — events", () => {
  it("emits update:search when the input value changes", async () => {
    const wrapper = makeWrapper();
    await wrapper.find("input").setValue("hello");
    const events = wrapper.emitted("update:search");
    expect(events).toBeTruthy();
    expect(events![events!.length - 1][0]).toBe("hello");
  });

  it("emits create when the add button is clicked", async () => {
    const wrapper = makeWrapper();
    await wrapper.find('[data-test="scorer-list-add-btn"]').trigger("click");
    expect((wrapper.emitted("create") ?? []).length).toBeGreaterThan(0);
  });

  it("reflects the search prop into the input value", () => {
    const wrapper = makeWrapper({ search: "abc" });
    expect((wrapper.find("input").element as HTMLInputElement).value).toBe("abc");
  });
});
