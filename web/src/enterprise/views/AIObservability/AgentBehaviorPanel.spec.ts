// Copyright 2026 OpenObserve Inc.
//
// @vitest-environment jsdom
//
// Regression test for the Agent Behavior panel's signal-scoping predicate.
//
// The bug: `scopedSignals` filtered by `agent_name` only, so two variants of
// the same agent (differing by env/version) collapsed into one — e.g. a
// "prod" and "staging" deployment of agent "a" both counted as agent "a"'s
// loops/failures. This pins `matchesAgentScope` narrowing by name + env +
// version, using the CANONICAL serialized keys `gen_ai_agent_env` /
// `gen_ai_agent_version` (NOT `agent_env`).
//
// The full panel pulls in OTable/OStatStrip/i18n/vuex/http — heavier than
// needed to pin this predicate, so per the task brief we test the extracted
// pure helper directly.

import { describe, it, expect } from "vitest";
import { matchesAgentScope } from "./agentScope";

describe("matchesAgentScope", () => {
  it("narrows by env when the selected variant has one", () => {
    const prod = { agent_name: "a", gen_ai_agent_env: "prod", gen_ai_agent_version: null };
    const staging = { agent_name: "a", gen_ai_agent_env: "staging", gen_ai_agent_version: null };

    const scope = { name: "a", env: "prod", version: null };

    expect(matchesAgentScope(prod, scope)).toBe(true);
    expect(matchesAgentScope(staging, scope)).toBe(false);
  });

  it("does not constrain on env/version when the selected scope omits them", () => {
    const prod = { agent_name: "a", gen_ai_agent_env: "prod", gen_ai_agent_version: "1.0" };
    const staging = { agent_name: "a", gen_ai_agent_env: "staging", gen_ai_agent_version: "2.0" };

    const scope = { name: "a" };

    expect(matchesAgentScope(prod, scope)).toBe(true);
    expect(matchesAgentScope(staging, scope)).toBe(true);
  });

  it("narrows by version when the selected variant has one", () => {
    const v1 = { agent_name: "a", gen_ai_agent_env: null, gen_ai_agent_version: "1.0" };
    const v2 = { agent_name: "a", gen_ai_agent_env: null, gen_ai_agent_version: "2.0" };

    const scope = { name: "a", env: null, version: "1.0" };

    expect(matchesAgentScope(v1, scope)).toBe(true);
    expect(matchesAgentScope(v2, scope)).toBe(false);
  });

  it("always rejects a different agent name regardless of env/version", () => {
    const other = { agent_name: "b", gen_ai_agent_env: "prod", gen_ai_agent_version: "1.0" };
    const scope = { name: "a", env: "prod", version: "1.0" };

    expect(matchesAgentScope(other, scope)).toBe(false);
  });
});
