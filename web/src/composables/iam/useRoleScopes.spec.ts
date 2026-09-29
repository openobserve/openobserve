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

// Characterization suite for the scope ladder. It records what useRoleScopes
// builds TODAY. Never edit a test to make it pass.

import { describe, it, expect, vi } from "vitest";
import { ref } from "vue";

import i18n from "@/locales";
import { useRoleScopes } from "@/composables/iam/useRoleScopes";

const ACTION_ORDER = ["AllowAll", "AllowList", "AllowGet", "AllowPost", "AllowPut", "AllowDelete"];

const DISPLAY_NAMES: Record<string, string> = {
  stream: "Streams",
  logs: "Logs",
  metrics: "Metrics",
  dfolder: "Dash Folders",
  dashboard: "Dashboards",
  afolder: "Alert Folders",
  alert: "Alerts",
};

const t = i18n.global.t as unknown as (key: string, named?: Record<string, unknown>) => string;

function setup({ loadStreamTypes = false } = {}) {
  const streamTypes = ["logs", "metrics", "traces", "index"].map((name) => ({
    name,
    display_name: DISPLAY_NAMES[name] ?? name,
  }));

  const resourceMapper = ref<Record<string, any>>({
    stream: {
      name: "stream",
      display_name: "Streams",
      entities: loadStreamTypes ? streamTypes : [],
    },
    dfolder: { name: "dfolder", display_name: "Dash Folders", entities: [] },
    afolder: { name: "afolder", display_name: "Alert Folders", entities: [] },
  });

  const isGranted = vi.fn(() => false);
  const resourceLabel = (key: string) => DISPLAY_NAMES[key] ?? key;

  const scopes = useRoleScopes({
    resourceMapper,
    isGranted,
    resourceLabel,
    moduleLabel: resourceLabel,
    t,
    ACTION_ORDER,
  } as any);

  return { ...scopes, resourceMapper, isGranted };
}

describe("useRoleScopes - module scopes [characterization]", () => {
  it("gives a plain module one type scope covering only itself", () => {
    const { moduleScopes, resourceMapper } = setup();
    const [scope] = moduleScopes("dfolder");

    expect(scope).toMatchObject({
      key: "dfolder",
      resource: "dfolder",
      covers: ["dfolder"],
      label: t("iam.editRole.scopeAllOf", { module: "Dash Folders" }),
      hint: t("iam.editRole.scopeIncludesFuture"),
    });
    expect(scope.hidden).toBeUndefined();
    expect(scope.node).toBe(resourceMapper.value.dfolder);
  });

  it("returns no scope for a module the catalogue does not carry", () => {
    const { moduleScopes } = setup();
    expect(moduleScopes("not_a_resource")).toEqual([]);
  });

  it("has no stream type keys before the Streams module is opened", () => {
    const { streamTypeKeys } = setup();
    expect(streamTypeKeys()).toEqual([]);
  });

  it("covers every loaded stream type from the Every Stream scope", () => {
    const { moduleScopes, streamTypeKeys } = setup({ loadStreamTypes: true });

    expect([...streamTypeKeys()].sort()).toEqual(["index", "logs", "metrics", "traces"]);

    const [scope] = moduleScopes("stream");
    expect(scope.key).toBe("stream");
    expect(scope.label).toBe(t("iam.editRole.scopeEveryStream"));
    expect(scope.hint).toBe(t("iam.editRole.scopeEveryStreamHint"));
    expect([...scope.covers].sort()).toEqual(["index", "logs", "metrics", "traces"]);
  });
});

describe("useRoleScopes - stream type scopes [characterization]", () => {
  // A stream type is both covered by Every Stream and an `_all_` scope of its own.
  it("stacks the hidden Every Stream scope above a drilled stream type", () => {
    const { streamTypeScopes } = setup({ loadStreamTypes: true });
    const scopes = streamTypeScopes({ name: "metrics", display_name: "Metrics" });

    expect(scopes).toHaveLength(2);
    expect(scopes.map((scope) => scope.key)).toEqual(["stream", "metrics"]);
    expect(scopes.map((scope) => scope.covers)).toEqual([["metrics"], ["metrics"]]);
    expect(scopes.map((scope) => !!scope.hidden)).toEqual([true, false]);
    expect(scopes[1].resource).toBe("metrics");
  });

  it("keeps the stream type hint plain while nothing above it grants", () => {
    const { streamTypeScopes } = setup({ loadStreamTypes: true });
    const scopes = streamTypeScopes({ name: "metrics", display_name: "Metrics" });

    expect(scopes[1].hint).toBe(t("iam.editRole.scopeIncludesFuture"));
  });

  it("names Every Stream as the source once it grants anything", () => {
    const { streamTypeScopes, isGranted } = setup({ loadStreamTypes: true });
    isGranted.mockImplementation(
      ((node: any, action: string) => node?.name === "stream" && action === "AllowList") as any,
    );

    const scopes = streamTypeScopes({ name: "metrics", display_name: "Metrics" });

    expect(scopes[1].hint).toBe(
      t("iam.editRole.scopeCoveredByParent", {
        scope: t("iam.editRole.scopeEveryStream"),
        module: "Streams",
      }),
    );
  });
});

describe("useRoleScopes - folder scopes [characterization]", () => {
  it("lets a dashboard folder cover its dashboards and the type scope cover both", () => {
    const { folderScopes } = setup();
    const [typeScope, thisFolder] = folderScopes("dfolder", {
      name: "default",
      childName: "dashboard",
    });

    expect(typeScope).toMatchObject({
      key: "dfolder",
      resource: "dfolder",
      covers: ["dfolder", "dashboard"],
      hidden: true,
    });
    expect(thisFolder).toMatchObject({
      key: "folder-default",
      resource: "dfolder",
      covers: ["dashboard"],
      label: t("iam.editRole.scopeThisFolder"),
      hint: t("iam.editRole.scopeThisFolderHint"),
    });
    expect(thisFolder.hidden).toBeUndefined();
  });

  it("covers nothing extra for a folder with no item type", () => {
    const { folderScopes } = setup();
    const [typeScope, thisFolder] = folderScopes("dfolder", { name: "bare", childName: "" });

    expect(thisFolder.covers).toEqual([]);
    expect(typeScope.covers).toEqual(["dfolder"]);
    expect(thisFolder.key).toBe("folder-bare");
  });

  it("builds the same two rows for an alert folder as for a dashboard folder", () => {
    const { folderScopes } = setup();
    const scopes = folderScopes("afolder", { name: "default", childName: "alert" });

    expect(scopes.map((scope) => scope.resource)).toEqual(["afolder", "afolder"]);
    expect(scopes.map((scope) => scope.covers)).toEqual([["afolder", "alert"], ["alert"]]);
  });
});
