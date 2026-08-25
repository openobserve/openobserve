// Copyright 2026 OpenObserve Inc.
// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { reactive } from "vue";
import type { RemoteTask } from "@/services/remote-tasks.service";

const route = reactive({ params: { id: "head-1" }, query: {} }) as any;
const push = vi.fn();
vi.mock("vue-router", () => ({ useRoute: () => route, useRouter: () => ({ push }) }));
vi.mock("vuex", () => ({
  useStore: () => ({ state: { selectedOrganization: { identifier: "acme" } } }),
}));

const get = vi.fn();
const versions = vi.fn();
const discardDraft = vi.fn();
const remove = vi.fn();
vi.mock("@/services/remote-tasks.service", () => ({
  default: {
    get: (...a: any[]) => get(...a),
    versions: (...a: any[]) => versions(...a),
    discardDraft: (...a: any[]) => discardDraft(...a),
    delete: (...a: any[]) => remove(...a),
    getSigningStatus: vi.fn().mockResolvedValue({ keys: [] }),
    testRun: vi.fn(),
  },
}));

const toast = vi.fn();
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: (...a: any[]) => toast(...a) }));
const confirm = vi.fn();
vi.mock("@/composables/useConfirmDialog", () => ({ useConfirmDialog: () => ({ confirm }) }));

import RemoteTaskDetailPage from "./RemoteTaskDetailPage.vue";

function task(overrides: Partial<RemoteTask> = {}): RemoteTask {
  return {
    id: "row-1",
    orgId: "acme",
    entityId: "head-1",
    version: 2,
    isDraft: false,
    isReferenceable: true,
    taskRef: "summarizer@2",
    name: "summarizer",
    description: "does things",
    endpoint: "https://tasks.example.com/run",
    httpMethod: "POST",
    auth: { type: "none", usesSecret: false },
    customHeaders: [],
    contentType: "application/json",
    responseSchema: "$.output",
    timeoutMs: 90_000,
    maxAttempts: 3,
    maxConcurrency: 4,
    signing: { enabled: false, usesSecret: false },
    verificationStatus: "verified",
    isActive: true,
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  };
}

const OButtonStub = {
  emits: ["click"],
  props: ["disabled"],
  template: `<button v-bind="$attrs" :disabled="disabled" @click="$emit('click', $event)"><slot /></button>`,
};

function mountPage() {
  return mount(RemoteTaskDetailPage, {
    global: { stubs: { OButton: OButtonStub, OTable: true } },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  route.params = { id: "head-1" };
  get.mockResolvedValue(task());
  versions.mockResolvedValue([task()]);
});

describe("RemoteTaskDetailPage", () => {
  it("renders the head and its versions without runtime errors", async () => {
    const errors: unknown[] = [];
    const wrapper = mount(RemoteTaskDetailPage, {
      global: { config: { errorHandler: (e) => errors.push(e) } },
    });
    await flushPromises();
    expect(errors).toEqual([]);
    expect(get).toHaveBeenCalledWith("acme", "head-1");
    expect(versions).toHaveBeenCalledWith("acme", "head-1");
    expect(wrapper.get('[data-test="ai-remote-task-detail-title"]').text()).toBe("summarizer");
  });

  it("leads with the reference an experiment pins", async () => {
    const wrapper = mountPage();
    await flushPromises();
    expect(wrapper.get('[data-test="ai-remote-task-detail-reference"]').text()).toContain(
      "summarizer@2",
    );
  });

  it("says there is nothing to pin when the head has never published", async () => {
    // A draft carries no `taskRef` at all — the server omits it, because there
    // is no version to pin.
    get.mockResolvedValue(
      task({ isDraft: true, version: 0, isReferenceable: false, taskRef: undefined }),
    );
    const wrapper = mountPage();
    await flushPromises();
    const reference = wrapper.get('[data-test="ai-remote-task-detail-reference"]').text();
    expect(reference).toContain("Publish a version first");
    expect(reference).not.toContain("summarizer@");
  });

  // A Secret-backed header reports that it is, never what — the whole point of
  // the write-only rule.
  it("never renders a secret-backed header's value", async () => {
    get.mockResolvedValue(
      task({
        customHeaders: [
          { key: "x-team", value: "search", usesSecret: false },
          { key: "x-api-key", usesSecret: true },
        ],
      }),
    );
    const wrapper = mountPage();
    await flushPromises();
    const headers = wrapper.get('[data-test="ai-remote-task-detail-headers"]').text();
    expect(headers).toContain("x-team");
    expect(headers).toContain("search");
    expect(headers).toContain("x-api-key");
    expect(headers).toContain("Secret");
    expect(wrapper.html()).not.toContain("secretRef");
  });

  it("shows the default body when the task configured no template", async () => {
    const wrapper = mountPage();
    await flushPromises();
    const template = wrapper.get('[data-test="ai-remote-task-detail-template"]').text();
    expect(template).toContain("Using the default body");
    expect(template).toContain("{{input}}");
    expect(template).not.toContain("expected");
  });

  it("surfaces the reason a test connection failed", async () => {
    get.mockResolvedValue(
      task({
        isDraft: true,
        version: 0,
        isReferenceable: false,
        verificationStatus: "failed",
        verificationError: "upstream deadline exceeded",
      }),
    );
    const wrapper = mountPage();
    await flushPromises();
    expect(wrapper.get('[data-test="ai-remote-task-detail-verification-error"]').text()).toContain(
      "upstream deadline exceeded",
    );
  });

  it("disables Edit for a task the platform cannot round-trip", async () => {
    get.mockResolvedValue(task({ auth: { type: "bearer", usesSecret: true } }));
    const wrapper = mountPage();
    await flushPromises();
    expect(
      wrapper.get('[data-test="ai-remote-task-detail-edit-btn"]').attributes("disabled"),
    ).toBeDefined();
    await wrapper.get('[data-test="ai-remote-task-detail-edit-btn"]').trigger("click");
    expect(push).not.toHaveBeenCalled();
  });

  it("offers Discard Draft only when a draft exists", async () => {
    const wrapper = mountPage();
    (wrapper.vm as any).currentTab = "versions";
    await flushPromises();
    expect(wrapper.find('[data-test="ai-remote-task-detail-discard-draft"]').exists()).toBe(false);

    versions.mockResolvedValue([task(), task({ id: "row-0", isDraft: true, version: 0 })]);
    await (wrapper.vm as any).refresh();
    await flushPromises();
    expect(wrapper.find('[data-test="ai-remote-task-detail-discard-draft"]').exists()).toBe(true);

    confirm.mockResolvedValue(true);
    discardDraft.mockResolvedValue(undefined);
    await wrapper.get('[data-test="ai-remote-task-detail-discard-draft"]').trigger("click");
    await flushPromises();
    expect(discardDraft).toHaveBeenCalledWith("acme", "head-1");
  });

  it("returns to the list after deleting", async () => {
    confirm.mockResolvedValue(true);
    remove.mockResolvedValue(undefined);
    const wrapper = mountPage();
    await flushPromises();
    await wrapper.get('[data-test="ai-remote-task-detail-delete-btn"]').trigger("click");
    await flushPromises();
    expect(remove).toHaveBeenCalledWith("acme", "head-1");
    expect(push).toHaveBeenCalledWith(expect.objectContaining({ name: "aiRemoteTasks" }));
  });

  it("reports a failed load", async () => {
    get.mockRejectedValue({ response: { data: { message: "gone" } } });
    mountPage();
    await flushPromises();
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "error", message: "gone" }),
    );
  });
});
