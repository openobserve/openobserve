// Copyright 2026 OpenObserve Inc.
// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { reactive } from "vue";

const route = reactive({ params: {}, query: {} }) as any;
const push = vi.fn();
vi.mock("vue-router", () => ({
  useRoute: () => route,
  useRouter: () => ({ push }),
}));
vi.mock("vuex", () => ({
  useStore: () => ({ state: { selectedOrganization: { identifier: "acme" } } }),
}));

const create = vi.fn();
const saveDraft = vi.fn();
const testConnection = vi.fn();
const get = vi.fn();
const remove = vi.fn();
vi.mock("@/services/remote-tasks.service", () => ({
  default: {
    create: (...a: any[]) => create(...a),
    saveDraft: (...a: any[]) => saveDraft(...a),
    testConnection: (...a: any[]) => testConnection(...a),
    get: (...a: any[]) => get(...a),
    delete: (...a: any[]) => remove(...a),
  },
}));

const toast = vi.fn();
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: (...a: any[]) => toast(...a) }));

import RemoteTaskFormPage from "./RemoteTaskFormPage.vue";

const report = { rawRequest: "{}", rawResponse: "{}", statusCode: 200, latencyMs: 42 };

function mountForm() {
  return mount(RemoteTaskFormPage, {
    global: {
      stubs: {
        // The rail fetches datasets on mount; the sample it collects is owned by
        // the page, so the page's behaviour is testable without it.
        RemoteTaskTestPanel: true,
      },
    },
  });
}

async function fillValid(wrapper: any, overrides: Record<string, unknown> = {}) {
  const form = (wrapper.vm as any).form;
  form.setFieldValue("name", "summarizer");
  form.setFieldValue("endpoint", "https://tasks.example.com/run");
  for (const [key, value] of Object.entries(overrides)) form.setFieldValue(key, value);
  await flushPromises();
}

/**
 * The click records which button was pressed; the submission is then awaited
 * directly, because OForm's own submit handler is fire-and-forget and TanStack's
 * async validation outlives a fixed number of microtask flushes.
 */
async function submit(wrapper: any, intent: "publish" | "draft" = "publish") {
  const target = intent === "draft" ? "draft-btn" : "submit-btn";
  await wrapper.get(`[data-test="ai-remote-task-form-${target}"]`).trigger("click");
  await (wrapper.vm as any).form.handleSubmit();
  await flushPromises();
}

beforeEach(() => {
  vi.clearAllMocks();
  route.params = {};
});

describe("RemoteTaskFormPage — registering", () => {
  it("renders the register form without runtime errors", async () => {
    const errors: unknown[] = [];
    const wrapper = mount(RemoteTaskFormPage, {
      global: {
        stubs: { RemoteTaskTestPanel: true },
        config: { errorHandler: (e) => errors.push(e) },
      },
    });
    await flushPromises();
    expect(errors).toEqual([]);
    expect(wrapper.get('[data-test="ai-remote-task-form-title"]').text()).toBe(
      "Register Remote Task",
    );
  });

  // Registering is two calls: POST /tasks produces an unverified draft, and only
  // a passing test connection publishes a version.
  it("registers and then tests, publishing on success", async () => {
    create.mockResolvedValue({ entityId: "head-1" });
    testConnection.mockResolvedValue({
      published: true,
      versionBumped: true,
      task: { version: 1 },
      report,
    });
    const wrapper = mountForm();
    await fillValid(wrapper);
    await submit(wrapper);

    expect(create).toHaveBeenCalledTimes(1);
    expect(testConnection).toHaveBeenCalledWith("acme", "head-1", expect.any(Object));
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: "success" }));
    expect(push).toHaveBeenCalledWith(
      expect.objectContaining({ name: "aiRemoteTaskDetail", params: { id: "head-1" } }),
    );
  });

  // OInput and OSelect put `w-full` on their own root, and `.w-full` is emitted
  // AFTER `.w-32` in the stylesheet — so a width handed to a field loses the
  // cascade fight and the row collapses. Width belongs on a wrapper.
  it("never puts a width and the field's own w-full on one element", async () => {
    const wrapper = mountForm();
    await flushPromises();

    const offenders = wrapper
      .findAll("*")
      .filter((node) => {
        const classes = node.classes();
        if (!classes.includes("w-full")) return false;
        return classes.some((name) => /^(w-\d|flex-1$|w-\[)/.test(name));
      })
      .map((node) => node.classes().join(" "));

    expect(offenders).toEqual([]);
  });

  it("does not call the endpoint at all when the form is invalid", async () => {
    const wrapper = mountForm();
    await submit(wrapper);
    expect(create).not.toHaveBeenCalled();
    expect(testConnection).not.toHaveBeenCalled();
  });

  // A failed test publishes nothing, so the operator must stay where their work
  // is rather than being sent to a task that cannot be used.
  it("keeps the operator on the form when the test fails", async () => {
    create.mockResolvedValue({ entityId: "head-1" });
    testConnection.mockResolvedValue({
      published: false,
      versionBumped: false,
      error: "remote task 504",
      task: { version: 0 },
      report,
    });
    const wrapper = mountForm();
    await fillValid(wrapper);
    await submit(wrapper);

    expect(push).not.toHaveBeenCalled();
    expect((wrapper.vm as any).testState).toBe("failed");
    expect((wrapper.vm as any).testError).toBe("remote task 504");
    expect((wrapper.vm as any).testReport).toEqual(report);
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: "error" }));
  });

  // Without a secret the draft is editable, which is what the registry intends —
  // so the retry edits it rather than registering a second head.
  it("retries a secret-free draft by saving it, not re-registering", async () => {
    create.mockResolvedValue({ entityId: "head-1" });
    testConnection.mockResolvedValue({
      published: false,
      versionBumped: false,
      error: "bad path",
      task: { version: 0 },
      report,
    });
    const wrapper = mountForm();
    await fillValid(wrapper);
    await submit(wrapper);
    expect(remove).not.toHaveBeenCalled();

    saveDraft.mockResolvedValue({});
    await fillValid(wrapper, { responseSchema: "$.answer" });
    await submit(wrapper);

    expect(create).toHaveBeenCalledTimes(1);
    expect(saveDraft).toHaveBeenCalledWith(
      "acme",
      "head-1",
      expect.objectContaining({ responseSchema: "$.answer" }),
    );
  });

  // A secret-bearing draft can never be re-sent — its reference is write-only —
  // so leaving it behind would strand an uneditable, unusable head.
  it("rolls back a secret-bearing head when the test fails", async () => {
    create.mockResolvedValue({ entityId: "head-1" });
    testConnection.mockResolvedValue({
      published: false,
      versionBumped: false,
      error: "401",
      task: { version: 0 },
      report,
    });
    remove.mockResolvedValue(undefined);
    const wrapper = mountForm();
    await fillValid(wrapper, { authType: "bearer", token: "abc" });
    await submit(wrapper);

    expect(remove).toHaveBeenCalledWith("acme", "head-1");

    // The retry re-registers, carrying the credential still in the form.
    testConnection.mockResolvedValue({
      published: true,
      versionBumped: true,
      task: { version: 1 },
      report,
    });
    create.mockResolvedValue({ entityId: "head-2" });
    await submit(wrapper);

    expect(create).toHaveBeenCalledTimes(2);
    expect(saveDraft).not.toHaveBeenCalled();
  });

  it("keeps the head when the rollback itself fails, so a retry re-tests it", async () => {
    create.mockResolvedValue({ entityId: "head-1" });
    testConnection.mockResolvedValue({
      published: false,
      versionBumped: false,
      task: { version: 0 },
      report,
    });
    remove.mockRejectedValue(new Error("nope"));
    const wrapper = mountForm();
    await fillValid(wrapper, { authType: "bearer", token: "abc" });
    await submit(wrapper);

    expect((wrapper.vm as any).draftEntityId).toBe("head-1");
  });

  // Generated HMAC material is returned exactly once and never again.
  it("blocks navigation on the one-time signing key until it is dismissed", async () => {
    create.mockResolvedValue({
      entityId: "head-1",
      generatedSigningSecret: { keyId: "k1", material: { type: "token", value: "s3cr3t" } },
    });
    testConnection.mockResolvedValue({
      published: true,
      versionBumped: true,
      task: { version: 1 },
      report,
    });
    const wrapper = mountForm();
    await fillValid(wrapper, { signingEnabled: true, signingGenerate: true });
    await submit(wrapper);

    expect((wrapper.vm as any).generatedSecretOpen).toBe(true);
    expect((wrapper.vm as any).generatedKey).toBe("s3cr3t");
    expect(push).not.toHaveBeenCalled();

    (wrapper.vm as any).dismissGeneratedSecret();
    await flushPromises();
    expect(push).toHaveBeenCalledWith(
      expect.objectContaining({ name: "aiRemoteTaskDetail", params: { id: "head-1" } }),
    );
  });

  it("saves a draft without testing, and says it is not referenceable yet", async () => {
    create.mockResolvedValue({ entityId: "head-1" });
    const wrapper = mountForm();
    await fillValid(wrapper);

    await submit(wrapper, "draft");

    expect(create).toHaveBeenCalledTimes(1);
    expect(testConnection).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: "success",
        message: "Draft saved. Test the connection to publish it.",
      }),
    );
  });
});

describe("RemoteTaskFormPage — editing", () => {
  it("prefills from the stored task", async () => {
    route.params = { id: "head-1" };
    get.mockResolvedValue({
      entityId: "head-1",
      name: "summarizer",
      description: "does things",
      endpoint: "https://tasks.example.com/run",
      httpMethod: "POST",
      auth: { type: "none", usesSecret: false },
      customHeaders: [],
      responseSchema: "$.answer",
      timeoutMs: 90_000,
      maxAttempts: 2,
      maxConcurrency: 8,
      signing: { enabled: false, usesSecret: false },
      isDraft: false,
      version: 3,
      isActive: true,
      verificationStatus: "verified",
    });
    const wrapper = mountForm();
    await flushPromises();

    expect(wrapper.get('[data-test="ai-remote-task-form-title"]').text()).toBe("Edit Remote Task");
    expect((wrapper.vm as any).form.state.values.responseSchema).toBe("$.answer");
    expect((wrapper.vm as any).form.state.values.timeoutSeconds).toBe("90");
    expect((wrapper.vm as any).draftFromVersion).toBe(3);
  });

  // Opening the edit route directly for a secret-bearing task must not present a
  // form whose submit could only ever strip the credential.
  it("refuses to edit a task holding a secret", async () => {
    route.params = { id: "head-1" };
    get.mockResolvedValue({
      entityId: "head-1",
      name: "summarizer",
      endpoint: "https://tasks.example.com/run",
      httpMethod: "POST",
      auth: { type: "bearer", usesSecret: true },
      customHeaders: [],
      responseSchema: "$.output",
      timeoutMs: 60_000,
      maxAttempts: 3,
      maxConcurrency: 4,
      signing: { enabled: false, usesSecret: false },
      isDraft: false,
      version: 1,
      isActive: true,
      verificationStatus: "verified",
    });
    mountForm();
    await flushPromises();

    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: "error" }));
    expect(push).toHaveBeenCalledWith(expect.objectContaining({ name: "aiRemoteTasks" }));
  });
});
