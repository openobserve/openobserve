// Copyright 2026 OpenObserve Inc.
//
// Prompt snapshots can contain customer content, so this one-shot handoff uses
// sessionStorage rather than query strings, browser history, or server logs.

import type { PromptConfig } from "@/services/llm-prompts.service";

const PROMPT_HANDOFF_KEY = "o2-playground-from-prompt";

export interface PromptPlaygroundHandoff {
  entityId: string;
  /** Physical immutable version row id. */
  id: string;
  name: string;
  version: number;
  payload: unknown;
  config: PromptConfig;
  provenance: { type: "prompt"; label: string };
}

export function storePromptPlaygroundHandoff(handoff: PromptPlaygroundHandoff): boolean {
  try {
    sessionStorage.setItem(PROMPT_HANDOFF_KEY, JSON.stringify(handoff));
    return true;
  } catch {
    return false;
  }
}

/** Consume once: reloading the Playground must preserve the edited fork. */
export function takePromptPlaygroundHandoff(): PromptPlaygroundHandoff | null {
  try {
    const stored = sessionStorage.getItem(PROMPT_HANDOFF_KEY);
    if (!stored) return null;
    sessionStorage.removeItem(PROMPT_HANDOFF_KEY);
    const parsed = JSON.parse(stored) as PromptPlaygroundHandoff;
    if (
      !parsed.entityId ||
      !parsed.id ||
      !parsed.name ||
      !Number.isInteger(parsed.version) ||
      parsed.version < 1
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
