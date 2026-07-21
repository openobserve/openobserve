// @vitest-environment jsdom
// Tests for EvalListShell — the shrunken page wrapper shared by ScorerList,
// ScoreConfigList, EvalJobList. The shell now only owns:
//   • the empty/populated branching (renders #empty or #table)
//   • a data-test prefix on the outer page wrapper
// Search, filters, and the "create" button now live inside each list's
// OTable #toolbar slot (matching the IncidentList pattern), and per-tab
// action buttons (Import, "New X") live in OnlineEvals's OPageHeader.

import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import EvalListShell from "./EvalListShell.vue";

function makeWrapper(
  propsOverride: Record<string, any> = {},
  slots: Record<string, string> = {},
) {
  return mount(EvalListShell, {
    props: {
      dataTest: "scorer",
      showEmpty: false,
      ...propsOverride,
    },
    slots: {
      empty: '<div class="test-empty">EMPTY_BRANCH</div>',
      table: '<div class="test-table">TABLE_SLOT</div>',
      ...slots,
    },
  });
}

describe("EvalListShell — empty branch", () => {
  it("shows the #empty slot and hides the #table slot when showEmpty=true", () => {
    const wrapper = makeWrapper({ showEmpty: true });
    expect(wrapper.find(".test-empty").exists()).toBe(true);
    expect(wrapper.find(".test-table").exists()).toBe(false);
  });

  it("hides the #empty slot and shows the #table slot when showEmpty=false", () => {
    const wrapper = makeWrapper({ showEmpty: false });
    expect(wrapper.find(".test-empty").exists()).toBe(false);
    expect(wrapper.find(".test-table").exists()).toBe(true);
  });
});

describe("EvalListShell — data-test prefix", () => {
  it("applies the prefix to the outer page wrapper", () => {
    const wrapper = makeWrapper({ dataTest: "eval-job" });
    expect(wrapper.find('[data-test="eval-job-list-page"]').exists()).toBe(true);
  });

  it("keeps the page wrapper data-test even on the empty branch", () => {
    const wrapper = makeWrapper({ dataTest: "score-config", showEmpty: true });
    expect(wrapper.find('[data-test="score-config-list-page"]').exists()).toBe(true);
  });
});
