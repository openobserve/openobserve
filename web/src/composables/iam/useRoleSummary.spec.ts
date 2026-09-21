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

// Characterization suite for the role summary and the pending-changes model. It records
// what useRoleSummary does TODAY. Never edit a test to make it pass.

import { describe, it, expect, afterEach } from "vitest";
import { computed, effectScope, ref, type EffectScope } from "vue";
import { flushPromises } from "@vue/test-utils";

import i18n from "@/locales";
import { raw } from "@/types/i18n";
import { useRoleSummary } from "@/composables/iam/useRoleSummary";
import type { RoleModule } from "@/components/iam/roles/roleModules";
import type { RailModule } from "@/components/iam/roles/ModuleRail.vue";

const ORG = "default";
const ALL = `_all_${ORG}`;

const ACTION_ORDER = ["AllowAll", "AllowList", "AllowGet", "AllowPost", "AllowPut", "AllowDelete"];

const ACTION_LABEL_KEYS = {
  AllowAll: "iam.all",
  AllowList: "iam.list",
  AllowGet: "iam.get",
  AllowPost: "iam.create",
  AllowPut: "iam.update",
  AllowDelete: "iam.delete",
} as const;

const RESOURCES = [
  { key: "stream", display_name: "Streams", parent: "" },
  { key: "logs", display_name: "Logs", parent: "stream" },
  { key: "metrics", display_name: "Metrics", parent: "stream" },
  { key: "dfolder", display_name: "Dash Folders", parent: "" },
  { key: "dashboard", display_name: "Dashboards", parent: "dfolder" },
];

const STREAM_KEYS = ["stream", "logs", "metrics"];

let scope: EffectScope | undefined;

function setup() {
  const selectedPermissionsHash = ref(new Set<string>());
  const addedPermissions = ref<Record<string, unknown>>({});
  const removedPermissions = ref<Record<string, unknown>>({});
  const resourceMapper = ref<Record<string, any>>({});
  const heavyResourceEntities = ref<Record<string, any[]>>({});
  const unsavedDrawerOpen = ref(false);
  const permissionsState = { resources: RESOURCES };

  const resourceLabel = (key: string) =>
    permissionsState.resources.find((resource) => resource.key === key)?.display_name ?? key;

  const roleModules = computed<RoleModule[]>(() => [
    {
      key: "stream",
      group: "data",
      icon: "window",
      hasEntities: true,
      scopeKeys: ["stream"],
      countedKeys: STREAM_KEYS,
    } as RoleModule,
    {
      key: "dfolder",
      group: "dashboards",
      icon: "dashboard",
      hasEntities: true,
      scopeKeys: ["dfolder"],
      countedKeys: ["dfolder", "dashboard"],
    } as RoleModule,
  ]);
  const railModules = computed<RailModule[]>(() => [
    {
      key: "stream",
      label: raw("Streams"),
      icon: "window",
      groupId: "data",
      groupLabel: raw("Data"),
      granted: 2,
      added: 0,
      removed: 0,
    } as RailModule,
  ]);

  scope = effectScope();
  const summary = scope.run(() =>
    useRoleSummary({
      selectedPermissionsHash,
      addedPermissions,
      removedPermissions,
      permissionsState,
      resourceMapper,
      heavyResourceEntities,
      roleModules,
      railModules,
      unsavedDrawerOpen,
      resourceLabel,
      moduleLabel: (key) => raw(resourceLabel(key)),
      getOrgId: () => ORG,
      t: i18n.global.t as any,
      ACTION_ORDER,
      ACTION_LABEL_KEYS,
    }),
  )!;

  // Mirrors the grant store: saved keys are shown, staged adds are shown and recorded, staged removals are hidden and recorded.
  const seed = ({
    saved = [],
    added = [],
    removed = [],
  }: {
    saved?: string[];
    added?: string[];
    removed?: string[];
  }) => {
    selectedPermissionsHash.value = new Set(
      [...saved, ...added].filter((key) => !removed.includes(key)),
    );
    addedPermissions.value = Object.fromEntries(added.map((key) => [key, true]));
    removedPermissions.value = Object.fromEntries(removed.map((key) => [key, true]));
  };

  return { ...summary, seed, heavyResourceEntities, unsavedDrawerOpen };
}

afterEach(() => {
  scope?.stop();
  scope = undefined;
});

describe("useRoleSummary - summary model [characterization]", () => {
  it("groups grants by resource and entity, keeping staged removals visible", () => {
    const summary = setup();
    summary.seed({
      saved: ["logs:app:AllowGet", "logs:app:AllowList"],
      added: ["metrics:cpu:AllowGet"],
      removed: ["logs:app:AllowList"],
    });

    const byResource = summary.grantsByResource.value;
    expect(byResource.get("logs")!.get("app")).toEqual([
      { action: "AllowGet", state: "saved" },
      { action: "AllowList", state: "removed" },
    ]);
    expect(byResource.get("metrics")!.get("cpu")).toEqual([{ action: "AllowGet", state: "added" }]);
  });

  it("drops an entity from heldGrants once its only action is staged for removal", () => {
    const summary = setup();
    summary.seed({
      saved: ["logs:app:AllowGet", "logs:sys:AllowGet"],
      removed: ["logs:app:AllowGet"],
    });

    expect(summary.heldGrants("logs")).toEqual([["sys", [{ action: "AllowGet", state: "saved" }]]]);
  });

  it("describes a type level grant as reaching every stream", () => {
    const summary = setup();
    summary.seed({ saved: [`stream:${ALL}:AllowGet`] });

    expect(summary.moduleDescription("stream", STREAM_KEYS)).toBe(
      i18n.global.t("iam.editRole.summaryReachEveryStream"),
    );
  });

  it("describes a type level grant on a plain module as all of it", () => {
    const summary = setup();
    summary.seed({ saved: [`dfolder:${ALL}:AllowGet`] });

    expect(summary.moduleDescription("dfolder", ["dfolder", "dashboard"])).toBe(
      i18n.global.t("iam.editRole.summaryReachAllOf", { module: "Dash Folders" }),
    );
  });

  // Two or more granted resources fall back to a bare label list, with no reach at all.
  it("lists the resource labels when more than one is granted", () => {
    const summary = setup();
    summary.seed({ saved: ["logs:app:AllowGet", "metrics:cpu:AllowGet"] });

    expect(summary.moduleDescription("stream", STREAM_KEYS)).toBe("Logs, Metrics");
  });

  it("counts the entities when only one resource is granted and no list is loaded", () => {
    const summary = setup();
    summary.seed({ saved: ["logs:app:AllowGet", "logs:sys:AllowGet"] });

    expect(summary.moduleDescription("stream", STREAM_KEYS)).toBe(
      i18n.global.t("iam.editRole.summaryReachOne", {
        label: "Logs",
        reach: i18n.global.t("iam.editRole.summaryGrantCount", { count: 2 }, 2),
      }),
    );
  });

  it("reads N of M once the resource's list is loaded", () => {
    const summary = setup();
    summary.heavyResourceEntities.value = { metrics: [{ name: "cpu" }, { name: "mem" }] };
    summary.seed({ saved: ["metrics:cpu:AllowGet"] });

    expect(summary.moduleDescription("stream", STREAM_KEYS)).toBe(
      i18n.global.t("iam.editRole.summaryReachOne", {
        label: "Metrics",
        reach: i18n.global.t("iam.editRole.summaryReachSome", { count: "1", total: "2" }),
      }),
    );
  });

  it("describes a type level grant in words, not the raw _all_ id", () => {
    const summary = setup();
    summary.seed({ saved: [`stream:${ALL}:AllowAll`] });

    const [stream] = summary.summaryModules.value;

    expect(String(stream.description)).not.toContain("_all_");
    expect(stream.description).toBe(i18n.global.t("iam.editRole.summaryReachEveryStream"));
  });

  it("builds a summary card from the rail module it mirrors", () => {
    const summary = setup();
    summary.seed({ saved: ["logs:app:AllowGet", "logs:app:AllowList"] });

    const [card] = summary.summaryModules.value;
    expect(card).toMatchObject({
      moduleKey: "stream",
      label: "Streams",
      icon: "window",
      group: "data",
      granted: 2,
    });
    expect(card.actions.map((action) => action.action)).toEqual(["AllowList", "AllowGet"]);
  });

  it("lists each held action once, in column order", () => {
    const summary = setup();
    summary.seed({
      saved: ["metrics:cpu:AllowGet", "metrics:cpu:AllowList", "logs:app:AllowGet"],
    });

    const [stream] = summary.summaryModules.value;

    expect(stream.actions.map((action) => action.action)).toEqual(["AllowList", "AllowGet"]);
  });

  it("labels each summary action with its column name", () => {
    const summary = setup();
    summary.seed({ saved: ["logs:app:AllowGet"] });

    expect(summary.summaryModules.value[0].actions).toEqual([
      { action: "AllowGet", label: i18n.global.t("iam.get") },
    ]);
  });
});

describe("useRoleSummary - pending changes [characterization]", () => {
  it("keys a change by resource, entity and state, and carries the grant keys", () => {
    const summary = setup();
    summary.seed({ added: ["metrics:cpu:AllowGet", "metrics:cpu:AllowList"] });

    expect(summary.pendingChanges.value).toEqual([
      {
        id: "metrics-cpu-added",
        state: "added",
        label: "cpu",
        moduleLabel: "Metrics",
        actions: [
          { action: "AllowList", label: i18n.global.t("iam.list") },
          { action: "AllowGet", label: i18n.global.t("iam.get") },
        ],
        keys: ["metrics:cpu:AllowGet", "metrics:cpu:AllowList"],
      },
    ]);
  });

  it("names a wildcard entity in words rather than as _all_", () => {
    const summary = setup();
    summary.seed({ added: [`dfolder:${ALL}:AllowGet`, `stream:${ALL}:AllowGet`] });

    expect(summary.pendingChanges.value.map((change) => change.label)).toEqual([
      i18n.global.t("iam.editRole.scopeAllOf", { module: "Dash Folders" }),
      i18n.global.t("iam.editRole.scopeEveryStream"),
    ]);
  });

  it("splits one entity's additions and removals into two changes", () => {
    const summary = setup();
    summary.seed({
      saved: ["logs:app:AllowGet"],
      added: ["logs:app:AllowPut"],
      removed: ["logs:app:AllowGet"],
    });

    expect(summary.pendingChanges.value.map((change) => [change.state, change.keys])).toEqual([
      ["added", ["logs:app:AllowPut"]],
      ["removed", ["logs:app:AllowGet"]],
    ]);
  });

  it("keeps the review drawer open while any change remains", async () => {
    const summary = setup();
    summary.seed({ added: ["metrics:cpu:AllowGet", "metrics:mem:AllowGet"] });
    summary.unsavedDrawerOpen.value = true;
    await flushPromises();

    summary.seed({ added: ["metrics:mem:AllowGet"] });
    await flushPromises();

    expect(summary.unsavedDrawerOpen.value).toBe(true);
  });

  it("closes the review drawer once the last change is undone", async () => {
    const summary = setup();
    summary.seed({ added: ["metrics:cpu:AllowGet"] });
    summary.unsavedDrawerOpen.value = true;
    await flushPromises();

    summary.seed({});
    await flushPromises();

    expect(summary.unsavedDrawerOpen.value).toBe(false);
  });
});
