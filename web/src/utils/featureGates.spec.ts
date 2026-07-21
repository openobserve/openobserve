// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.hoisted: vi.mock is lifted above module scope, so the doubles have to be
// created there too or the factories close over an uninitialised const.
const { mockConfig, mockStore } = vi.hoisted(() => ({
  mockConfig: { isEnterprise: "true", isCloud: "false" },
  mockStore: { state: { zoConfig: {} as Record<string, unknown> } },
}));

vi.mock("@/aws-exports", () => ({ default: mockConfig }));
vi.mock("@/stores", () => ({ default: mockStore }));

import {
  createFeatureGate,
  isWorkflowsEnabled,
  isWorkflowsDisabled,
} from "./featureGates";

const setup = (
  build: Partial<typeof mockConfig>,
  zoConfig: Record<string, unknown>,
) => {
  Object.assign(mockConfig, { isEnterprise: "false", isCloud: "false" }, build);
  mockStore.state.zoConfig = zoConfig;
};

beforeEach(() => setup({ isEnterprise: "true" }, {}));

describe("createFeatureGate", () => {
  const gate = createFeatureGate("my_thing_enabled");

  it("is enabled on an enterprise build with the flag on", () => {
    setup({ isEnterprise: "true" }, { my_thing_enabled: true });
    expect(gate.isEnabled()).toBe(true);
    expect(gate.isDisabled()).toBe(false);
  });

  it("is enabled on a cloud build too", () => {
    setup({ isCloud: "true" }, { my_thing_enabled: true });
    expect(gate.isEnabled()).toBe(true);
  });

  it("is disabled on an OSS build regardless of the flag", () => {
    setup({}, { my_thing_enabled: true });
    expect(gate.isEnabled()).toBe(false);
    expect(gate.isDisabled()).toBe(true);
  });

  it("is disabled when the flag is explicitly off", () => {
    setup({ isEnterprise: "true" }, { my_thing_enabled: false });
    expect(gate.isEnabled()).toBe(false);
    expect(gate.isDisabled()).toBe(true);
  });

  it("🔑 unknown flag ⇒ NOT enabled AND NOT disabled", () => {
    // The whole reason both predicates exist. main.ts does not await
    // getConfig(), so zoConfig is briefly {}: a nav entry must stay hidden
    // (so it never flashes) while a route guard must NOT redirect (so a
    // bookmarked deep link survives a cold load).
    setup({ isEnterprise: "true" }, {});
    expect(gate.isEnabled()).toBe(false);
    expect(gate.isDisabled()).toBe(false);
  });

  it("requires a real boolean, not a truthy value", () => {
    setup({ isEnterprise: "true" }, { my_thing_enabled: "true" });
    expect(gate.isEnabled()).toBe(false);
    // ...and a truthy string is not "explicitly off" either, so routes stay open
    expect(gate.isDisabled()).toBe(false);
  });

  it("reads through on every call — a late /config response is picked up", () => {
    setup({ isEnterprise: "true" }, {});
    expect(gate.isEnabled()).toBe(false);
    mockStore.state.zoConfig = { my_thing_enabled: true };
    expect(gate.isEnabled()).toBe(true);
  });

  describe("requiresEnterprise: false (feature also ships in OSS)", () => {
    const ossGate = createFeatureGate("oss_thing_enabled", {
      requiresEnterprise: false,
    });

    it("follows the flag alone on an OSS build", () => {
      setup({}, { oss_thing_enabled: true });
      expect(ossGate.isEnabled()).toBe(true);
      expect(ossGate.isDisabled()).toBe(false);
    });

    it("still honours an explicit off", () => {
      setup({}, { oss_thing_enabled: false });
      expect(ossGate.isDisabled()).toBe(true);
    });
  });

  describe("build-only feature (flag = null)", () => {
    const buildGate = createFeatureGate(null);

    it("has no unknown state — build decides outright", () => {
      setup({ isEnterprise: "true" }, {});
      expect(buildGate.isEnabled()).toBe(true);
      expect(buildGate.isDisabled()).toBe(false);

      setup({}, {});
      expect(buildGate.isEnabled()).toBe(false);
      expect(buildGate.isDisabled()).toBe(true);
    });
  });
});

describe("workflows gate (the wrappers the app imports)", () => {
  it("is on only for an enterprise/cloud build with workflows_enabled true", () => {
    setup({ isEnterprise: "true" }, { workflows_enabled: true });
    expect(isWorkflowsEnabled()).toBe(true);
    expect(isWorkflowsDisabled()).toBe(false);
  });

  it("hides the UI but does not block routes while /config is in flight", () => {
    setup({ isEnterprise: "true" }, {});
    expect(isWorkflowsEnabled()).toBe(false);
    expect(isWorkflowsDisabled()).toBe(false);
  });

  it("blocks everything when the backend says workflows are off", () => {
    setup({ isEnterprise: "true" }, { workflows_enabled: false });
    expect(isWorkflowsEnabled()).toBe(false);
    expect(isWorkflowsDisabled()).toBe(true);
  });

  it("is off in OSS", () => {
    setup({}, { workflows_enabled: true });
    expect(isWorkflowsEnabled()).toBe(false);
    expect(isWorkflowsDisabled()).toBe(true);
  });
});
