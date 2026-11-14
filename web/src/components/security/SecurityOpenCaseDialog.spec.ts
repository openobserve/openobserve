// Copyright 2026 OpenObserve Inc.

import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";

vi.mock("@/lib/overlay/Dialog/ODialog.vue", () => ({
  default: {
    name: "ODialog",
    props: ["open", "title", "primaryButtonLabel"],
    template: `<div v-if="open"><span data-test="primary">{{ primaryButtonLabel }}</span><slot /></div>`,
  },
}));

import SecurityOpenCaseDialog from "./SecurityOpenCaseDialog.vue";

let wrapper: VueWrapper | null = null;

const existingCase = {
  id: "3Lv2pNZ5c3kZQfzBNck2DfCNfW2",
  org_id: "acme",
  status: "acknowledged" as const,
  severity: "P1" as const,
  title: "2 detections on 185.220.101.47",
  first_alert_at: 1,
  last_alert_at: 2,
  alert_count: 3,
  created_at: 1,
  updated_at: 2,
  rca: null,
  entity: "185.220.101.47",
  entity_kind: "ip" as const,
};

const mountDialog = (existing: unknown[] = []) => {
  const submit = vi.fn().mockResolvedValue(true);
  wrapper = mount(SecurityOpenCaseDialog, {
    props: {
      open: true,
      defaultTitle: "Web request on 185.220.101.47",
      defaultPriority: "P2",
      entities: [{ kind: "ip", value: "185.220.101.47" }],
      existing,
      submit,
    },
  });
  return { w: wrapper, submit };
};

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

describe("SecurityOpenCaseDialog", () => {
  it("picks the open case already on the entity and adds the event to it", async () => {
    const { w, submit } = mountDialog([existingCase]);
    await flushPromises();
    expect(w.find(`[data-test="security-open-case-target-${existingCase.id}"]`).exists()).toBe(
      true,
    );
    expect(w.find('[data-test="security-open-case-target"]').text()).toContain(
      `Add to 2 detections on 185.220.101.47 (${existingCase.id})`,
    );
    expect(w.find('[data-test="primary"]').text()).toBe("Add to case");
    expect(w.find('[data-test="security-open-case-title"]').exists()).toBe(false);
    await w.find("form").trigger("submit");
    await vi.waitFor(() => expect(submit).toHaveBeenCalled());
    expect(submit).toHaveBeenCalledWith({ caseId: existingCase.id, note: "" });
  });

  it("opens a new case when there is none on the entity", async () => {
    const { w, submit } = mountDialog();
    await flushPromises();
    expect(w.find('[data-test="security-open-case-target"]').exists()).toBe(false);
    expect(w.find('[data-test="primary"]').text()).toBe("Open case");
    await w.find("form").trigger("submit");
    await vi.waitFor(() => expect(submit).toHaveBeenCalled());
    expect(submit.mock.calls[0][0]).toMatchObject({
      title: "Web request on 185.220.101.47",
      priority: "P2",
      entities: [{ kind: "ip", value: "185.220.101.47" }],
    });
    expect(submit.mock.calls[0][0].caseId).toBeUndefined();
  });
});
