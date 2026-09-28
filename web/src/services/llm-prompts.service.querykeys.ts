// Copyright 2026 OpenObserve Inc.
import { orgKey } from "@/composables/query/keys";

export const llmPromptKeys = {
  all: (org: string) => orgKey(org, "llm", "prompts"),
  list: (org: string) => orgKey(org, "llm", "prompts", "list"),
  settings: (org: string) => orgKey(org, "llm", "prompts", "settings"),
};
