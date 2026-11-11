// @vitest-environment jsdom
// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createStore } from "vuex";
import ScorerLibrary from "./ScorerLibrary.vue";
import onlineEvalsService from "@/services/online-evals.service";
import { fetchOnlineEvalsCatalog } from "@/services/online-evals-catalog.service";
import i18n from "@/locales";
import { CODE_SCORER_STARTERS } from "./utils/codeScorerStarters";

vi.mock("@/services/online-evals.service", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: {
      scorers: { create: vi.fn(), update: vi.fn() },
      scoreConfigs: { create: vi.fn(), update: vi.fn() },
    },
  });
});

vi.mock("@/services/online-evals-catalog.service", () => ({
  fetchOnlineEvalsCatalog: vi.fn(),
}));

const store = createStore({ state: { selectedOrganization: { identifier: "test-org" } } });

function createWrapper() {
  return mount(ScorerLibrary, {
    props: { orgId: "test-org", scoreConfigs: [], scorers: [], providers: [] },
    global: { plugins: [store, i18n] },
  });
}

describe("ScorerLibrary code checks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchOnlineEvalsCatalog).mockRejectedValue(new Error("offline"));
    vi.mocked(onlineEvalsService.scoreConfigs.create).mockResolvedValue({
      id: "row-1",
      entity_id: "scfg-json",
      name: "json_is_valid",
      version: 1,
    } as any);
    vi.mocked(onlineEvalsService.scorers.create).mockResolvedValue({} as any);
  });

  it("lists the six checks with no provider and no catalog", async () => {
    const wrapper = createWrapper();
    await flushPromises();

    const section = wrapper.find('[data-test="scorer-library-section-code"]');
    expect(section.exists()).toBe(true);
    expect(section.findAll("li")).toHaveLength(CODE_SCORER_STARTERS.length);
    expect(wrapper.find('[data-test="scorer-library-error"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it("imports a check as a Code scorer with a Boolean score config", async () => {
    const wrapper = createWrapper();
    await flushPromises();
    await wrapper.find('[data-test="scorer-library-item-json_is_valid"]').trigger("click");
    await (wrapper.vm as any).importSelected();
    await flushPromises();

    const [, config] = vi.mocked(onlineEvalsService.scoreConfigs.create).mock.calls[0];
    expect(config).toMatchObject({
      name: "json_is_valid",
      dataType: "boolean",
      healthyThreshold: { healthy_value: true },
    });
    const [, scorer] = vi.mocked(onlineEvalsService.scorers.create).mock.calls[0];
    expect(scorer.name).toBe("json_is_valid");
    expect(scorer.scorer).toEqual({
      type: "code",
      producesScoreConfigId: "scfg-json",
      template: CODE_SCORER_STARTERS[0].source,
    });
    wrapper.unmount();
  });
});
