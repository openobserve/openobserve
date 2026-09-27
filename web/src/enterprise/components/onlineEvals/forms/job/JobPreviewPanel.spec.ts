// @vitest-environment jsdom

import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { ref } from "vue";
import { describe, expect, it, vi } from "vitest";
import en from "@/locales/languages/en-US.json";
import type { EvalTargetScope } from "@/services/online-evals.service";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import JobPreviewPanel from "./JobPreviewPanel.vue";

vi.mock("../../composables/useJobMatchedTargets", () => ({
  useJobMatchedTargets: () => ({
    count: ref(37),
    isLoading: ref(false),
    error: ref(false),
  }),
}));

function mountPreview(targetScope: EvalTargetScope) {
  const i18n = createI18n({
    legacy: false,
    locale: "en",
    messages: { en },
  });

  return mount(JobPreviewPanel, {
    props: {
      name: "Example job",
      streamType: "traces",
      targetScope,
      mode: "create",
      stream: "default",
      filterWhere: "",
      filterReady: true,
    },
    global: { plugins: [i18n] },
  });
}

describe("JobPreviewPanel", () => {
  it.each([
    ["span", "Matched Spans", "spans matched · last 1h"],
    ["trace", "Matched Traces", "traces matched · last 1h"],
    ["session", "Matched Sessions", "sessions matched · last 1h"],
  ] as const)("uses %s target terminology", (targetScope, title, matchedSuffix) => {
    const text = mountPreview(targetScope).find('[data-test="job-preview-matched-targets"]').text();

    expect(text).toContain(title);
    expect(text).toContain("37");
    expect(text).toContain(matchedSuffix);
  });

  it("does not use the info icon for the Summary card, which has no tooltip", () => {
    const iconNames = mountPreview("span")
      .findAllComponents(OIcon)
      .map((icon) => icon.props("name"));

    expect(iconNames).toContain("fact-check");
    expect(iconNames).not.toContain("info");
  });
});
