// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import i18n from "@/locales";
import onlineEvalsService, {
  type EvalJob,
} from "@/services/online-evals.service";
import ManualEvaluationDialog from "./ManualEvaluationDialog.vue";

vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: vi.fn() }));

vi.mock("@/services/online-evals.service", () => ({
  default: {
    jobs: {
      list: vi.fn(),
      manualEval: vi.fn(),
    },
  },
}));

const matchingTraceJob: EvalJob = {
  id: "trace-job",
  name: "Trace quality",
  stream: "default",
  streamType: "traces",
  targetScope: "trace",
  scorers: [{ id: "scorer-1" }],
  status: "active",
  version: 1,
};

describe("ManualEvaluationDialog", () => {
  let wrapper: VueWrapper | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(onlineEvalsService.jobs.list).mockResolvedValue([
      matchingTraceJob,
      {
        ...matchingTraceJob,
        id: "span-job",
        targetScope: "span",
      },
      {
        ...matchingTraceJob,
        id: "other-stream",
        stream: "other",
      },
    ]);
    vi.mocked(onlineEvalsService.jobs.manualEval).mockResolvedValue({
      jobId: "trace-job",
      targetScope: "trace",
      targetId: "trace-1",
      tasksCreated: 1,
    });
  });

  afterEach(() => {
    wrapper?.unmount();
    document.body.innerHTML = "";
  });

  it("submits only the selected target and its authoritative time range", async () => {
    wrapper = mount(ManualEvaluationDialog, {
      props: {
        open: true,
        orgId: "org-1",
        stream: "default",
        targetScope: "trace",
        targetId: "trace-1",
        startTime: 1_000,
        endTime: 2_000,
        sessionId: "session-1",
      },
      global: { plugins: [i18n] },
    });
    await flushPromises();

    const form = wrapper.findComponent({ name: "OForm" }).vm as {
      form: { handleSubmit: () => Promise<void> };
    };
    await form.form.handleSubmit();
    await flushPromises();

    expect(onlineEvalsService.jobs.manualEval).toHaveBeenCalledWith(
      "org-1",
      "trace-job",
      {
        targetId: "trace-1",
        startTime: 1_000,
        endTime: 2_000,
        spanId: undefined,
        traceId: "trace-1",
        sessionId: "session-1",
      },
    );
    expect(wrapper.emitted("update:open")?.at(-1)).toEqual([false]);
  });

  it("shows an empty state when no job matches scope and stream", async () => {
    vi.mocked(onlineEvalsService.jobs.list).mockResolvedValue([]);
    wrapper = mount(ManualEvaluationDialog, {
      props: {
        open: true,
        orgId: "org-1",
        stream: "default",
        targetScope: "session",
        targetId: "session-1",
        startTime: 1_000,
        endTime: 2_000,
      },
      global: { plugins: [i18n] },
    });
    await flushPromises();

    expect(
      document.querySelector('[data-test="manual-evaluation-no-jobs"]'),
    ).not.toBeNull();
    expect(onlineEvalsService.jobs.manualEval).not.toHaveBeenCalled();
  });
});
