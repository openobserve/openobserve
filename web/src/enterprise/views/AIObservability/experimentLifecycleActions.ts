// Copyright 2026 OpenObserve Inc.

import type { LlmExperiment } from "@/services/llm-experiments.service";

export type ExperimentLifecycleAction = "cancel" | "retry" | "clone";

const allowedStatus: Record<ExperimentLifecycleAction, LlmExperiment["status"]> = {
  cancel: "running",
  retry: "failed",
  clone: "cancelled",
};

interface LifecycleActionOptions {
  current: () => LlmExperiment | null | undefined;
  busy: () => boolean;
  setBusy: (busy: boolean) => void;
  execute: (
    action: ExperimentLifecycleAction,
    experiment: LlmExperiment,
  ) => Promise<LlmExperiment>;
  apply: (
    action: ExperimentLifecycleAction,
    experiment: LlmExperiment,
  ) => Promise<void> | void;
  notify: (action: ExperimentLifecycleAction, success: boolean) => void;
}

export function createExperimentLifecycleActions(options: LifecycleActionOptions) {
  async function run(action: ExperimentLifecycleAction) {
    const experiment = options.current();
    if (!experiment || options.busy() || experiment.status !== allowedStatus[action]) return;

    options.setBusy(true);
    try {
      const updated = await options.execute(action, experiment);
      await options.apply(action, updated);
      options.notify(action, true);
    } catch {
      options.notify(action, false);
    } finally {
      options.setBusy(false);
    }
  }

  return {
    cancel: () => run("cancel"),
    retry: () => run("retry"),
    clone: () => run("clone"),
  };
}
