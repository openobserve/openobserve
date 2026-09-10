// Copyright 2026 OpenObserve Inc.
// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";

const getSigningStatus = vi.fn();
const rotateSigning = vi.fn();
const testSigningCandidate = vi.fn();
const activateSigning = vi.fn();
const endSigningGrace = vi.fn();
vi.mock("@/services/remote-tasks.service", () => ({
  default: {
    getSigningStatus: (...a: any[]) => getSigningStatus(...a),
    rotateSigning: (...a: any[]) => rotateSigning(...a),
    testSigningCandidate: (...a: any[]) => testSigningCandidate(...a),
    activateSigning: (...a: any[]) => activateSigning(...a),
    endSigningGrace: (...a: any[]) => endSigningGrace(...a),
  },
}));

const toast = vi.fn();
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: (...a: any[]) => toast(...a) }));

const confirm = vi.fn();
vi.mock("@/composables/useConfirmDialog", () => ({ useConfirmDialog: () => ({ confirm }) }));

import RemoteTaskSigningPanel from "./RemoteTaskSigningPanel.vue";

const OButtonStub = {
  emits: ["click"],
  props: ["disabled"],
  template: `<button v-bind="$attrs" :disabled="disabled" @click="$emit('click', $event)"><slot /></button>`,
};

function key(state: string, overrides: Record<string, unknown> = {}) {
  return {
    purpose: "signing" as const,
    keyId: `${state}-key`,
    state,
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  };
}

function mountPanel(enabled = true) {
  return mount(RemoteTaskSigningPanel, {
    props: { orgId: "acme", entityId: "head-1", enabled },
    global: { stubs: { OButton: OButtonStub } },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  getSigningStatus.mockResolvedValue({ keys: [] });
});

describe("RemoteTaskSigningPanel", () => {
  it("says signing is off rather than offering a rotation that cannot run", async () => {
    const wrapper = mountPanel(false);
    await flushPromises();
    expect(wrapper.find('[data-test="ai-remote-task-signing-disabled"]').exists()).toBe(true);
    expect(getSigningStatus).not.toHaveBeenCalled();
  });

  it("lists the current and candidate keys, current first", async () => {
    getSigningStatus.mockResolvedValue({
      keys: [key("candidate"), key("current"), key("retired")],
    });
    const wrapper = mountPanel();
    await flushPromises();
    const order = wrapper
      .findAll('[data-test^="ai-remote-task-signing-key-"]')
      .map((node) => node.attributes("data-test"));
    expect(order).toEqual([
      "ai-remote-task-signing-key-current",
      "ai-remote-task-signing-key-candidate",
      "ai-remote-task-signing-key-retired",
    ]);
  });

  // Activation is refused server-side until the candidate passes an explicit
  // test, so the button has to say so rather than surface a 409.
  it("keeps Activate shut until the candidate passes its test", async () => {
    getSigningStatus.mockResolvedValue({ keys: [key("current"), key("candidate")] });
    const wrapper = mountPanel();
    await flushPromises();

    const activate = () => wrapper.get('[data-test="ai-remote-task-signing-activate-btn"]');
    expect(activate().attributes("disabled")).toBeDefined();

    testSigningCandidate.mockResolvedValue({ verified: false, error: "bad signature" });
    await wrapper.get('[data-test="ai-remote-task-signing-test-btn"]').trigger("click");
    await flushPromises();
    expect(activate().attributes("disabled")).toBeDefined();
    expect(wrapper.get('[data-test="ai-remote-task-signing-test-message"]').text()).toContain(
      "bad signature",
    );

    testSigningCandidate.mockResolvedValue({ verified: true });
    await wrapper.get('[data-test="ai-remote-task-signing-test-btn"]').trigger("click");
    await flushPromises();
    expect(activate().attributes("disabled")).toBeUndefined();
  });

  it("cannot mint a second candidate while one is outstanding", async () => {
    getSigningStatus.mockResolvedValue({ keys: [key("candidate")] });
    const wrapper = mountPanel();
    await flushPromises();
    expect(
      wrapper.get('[data-test="ai-remote-task-signing-rotate-btn"]').attributes("disabled"),
    ).toBeDefined();
  });

  // Candidate material comes back exactly once and no read route exposes it
  // later, so it has to be put in front of the operator immediately.
  it("shows freshly minted material once", async () => {
    rotateSigning.mockResolvedValue({
      metadata: key("candidate", { keyId: "k2" }),
      material: { type: "token", value: "s3cr3t" },
    });
    const wrapper = mountPanel();
    await flushPromises();

    await wrapper.get('[data-test="ai-remote-task-signing-rotate-btn"]').trigger("click");
    await flushPromises();

    expect((wrapper.vm as any).candidateSecretOpen).toBe(true);
    expect((wrapper.vm as any).candidateKey).toBe("s3cr3t");
    expect((wrapper.vm as any).candidateKeyId).toBe("k2");
  });

  it("sends the chosen grace period in milliseconds", async () => {
    getSigningStatus.mockResolvedValue({ keys: [key("candidate")] });
    testSigningCandidate.mockResolvedValue({ verified: true });
    activateSigning.mockResolvedValue(key("current"));
    const wrapper = mountPanel();
    await flushPromises();
    await wrapper.get('[data-test="ai-remote-task-signing-test-btn"]').trigger("click");
    await flushPromises();

    (wrapper.vm as any).graceHours = 6;
    await flushPromises();
    await wrapper.get('[data-test="ai-remote-task-signing-activate-btn"]').trigger("click");
    await flushPromises();

    expect(activateSigning).toHaveBeenCalledWith("acme", "head-1", 6 * 60 * 60 * 1000);
    // A fresh rotation starts unverified again.
    expect((wrapper.vm as any).candidateVerified).toBe(false);
  });

  // Ending grace early breaks any request the receiver still verifies with the
  // old key, so it goes through a confirmation.
  it("confirms before retiring the previous key early", async () => {
    getSigningStatus.mockResolvedValue({
      keys: [key("current"), key("retired", { graceExpiresAt: 1_800_000_000_000 })],
    });
    confirm.mockResolvedValue(false);
    const wrapper = mountPanel();
    await flushPromises();

    await wrapper.get('[data-test="ai-remote-task-signing-end-grace-btn"]').trigger("click");
    await flushPromises();
    expect(endSigningGrace).not.toHaveBeenCalled();

    confirm.mockResolvedValue(true);
    endSigningGrace.mockResolvedValue(undefined);
    await wrapper.get('[data-test="ai-remote-task-signing-end-grace-btn"]').trigger("click");
    await flushPromises();
    expect(endSigningGrace).toHaveBeenCalledWith("acme", "head-1");
  });

  it("offers no End Grace when no key is in one", async () => {
    getSigningStatus.mockResolvedValue({ keys: [key("current")] });
    const wrapper = mountPanel();
    await flushPromises();
    expect(wrapper.find('[data-test="ai-remote-task-signing-end-grace-btn"]').exists()).toBe(false);
  });
});
