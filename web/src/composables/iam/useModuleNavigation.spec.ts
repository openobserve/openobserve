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

// Characterization suite for the module view model and navigation. It records
// what useModuleNavigation does TODAY. Never edit a test to make it pass.

import { describe, it, expect, afterEach, vi } from "vitest";
import { effectScope, ref, type EffectScope } from "vue";
import { flushPromises } from "@vue/test-utils";

import { raw } from "@/types/i18n";
import { useModuleNavigation } from "@/composables/iam/useModuleNavigation";
import type { RoleModule } from "@/components/iam/roles/roleModules";

const MODULES: Record<string, Pick<RoleModule, "key" | "hasEntities">> = {
  stream: { key: "stream", hasEntities: true },
  dfolder: { key: "dfolder", hasEntities: true },
  provider: { key: "provider", hasEntities: true },
  role: { key: "role", hasEntities: false },
};

const LABELS: Record<string, string> = {
  stream: "Streams",
  dfolder: "Dash Folders",
  provider: "LLM Providers",
  role: "Roles",
};

let scope: EffectScope | undefined;

function setup() {
  const metricsRows = [{ name: "cpu" }, { name: "mem" }];
  const folder = { name: "default", entities: [{ name: "d1" }] };
  const metricsType = { name: "metrics", display_name: "Metrics", entities: [] };

  const activeModule = ref("");
  const openFolder = ref<any>(null);
  const loadingFor = ref("");
  const resourceMapper = ref<Record<string, any>>({
    stream: { name: "stream", entities: [metricsType] },
    dfolder: { name: "dfolder", entities: [folder] },
    provider: { name: "provider", entities: [{ name: "openai" }] },
    role: { name: "role", entities: [] },
  });
  const heavyResourceEntities = ref<Record<string, any[]>>({ metrics: metricsRows });
  const getResourceEntities = vi.fn(async (_resource: unknown) => undefined);

  scope = effectScope();
  const nav = scope.run(() =>
    useModuleNavigation({
      activeModule,
      openFolder,
      loadingFor,
      resourceMapper,
      heavyResourceEntities,
      moduleOf: (key) => MODULES[key] as RoleModule | undefined,
      moduleLabel: (key) => raw(LABELS[key] ?? key),
      moduleScopes: (key) => [{ key } as any],
      folderScopes: (key, child) => [{ key: `${key}/${child.name}` } as any],
      streamTypeScopes: (typeNode) => [{ key: typeNode.name } as any],
      getResourceEntities,
    }),
  )!;

  return {
    ...nav,
    activeModule,
    openFolder,
    loadingFor,
    resourceMapper,
    heavyResourceEntities,
    getResourceEntities,
    folder: resourceMapper.value.dfolder.entities[0],
    metricsType: resourceMapper.value.stream.entities[0],
  };
}

afterEach(() => {
  scope?.stop();
  scope = undefined;
});

describe("useModuleNavigation - active module view [characterization]", () => {
  it("shows the summary with no module selected", () => {
    const nav = setup();
    expect(nav.activeModule.value).toBe("");
    expect(nav.activeModuleView.value).toBeNull();
  });

  it("shows nothing for a key that is not a module", async () => {
    const nav = setup();
    nav.activeModule.value = "logs";
    await flushPromises();
    expect(nav.activeModuleView.value).toBeNull();
  });

  // An org-wide resource has no items, so its own node is the single row.
  it("lists the module node itself when the module has no entities", async () => {
    const nav = setup();
    nav.activeModule.value = "role";
    await flushPromises();

    expect(nav.activeModuleView.value).toEqual({
      trail: ["Roles"],
      scopes: [],
      entities: [nav.resourceMapper.value.role],
    });
  });

  it("lists a plain module's entities under its own type scope", async () => {
    const nav = setup();
    nav.activeModule.value = "provider";
    await flushPromises();

    expect(nav.activeModuleView.value!.trail).toEqual(["LLM Providers"]);
    expect(nav.activeModuleView.value!.scopes.map((row: any) => row.key)).toEqual(["provider"]);
    expect(nav.activeModuleView.value!.entities).toBe(nav.resourceMapper.value.provider.entities);
  });

  it("reads a drilled stream type's rows from heavyResourceEntities", async () => {
    const nav = setup();
    nav.activeModule.value = "stream";
    await flushPromises();
    await nav.openFolderRow(nav.metricsType);

    expect(nav.activeModuleView.value!.trail).toEqual(["Streams", "Metrics"]);
    expect(nav.activeModuleView.value!.scopes.map((row: any) => row.key)).toEqual(["metrics"]);
    expect(nav.activeModuleView.value!.entities).toBe(nav.heavyResourceEntities.value.metrics);
  });

  it("reads a drilled folder's rows from the folder node", async () => {
    const nav = setup();
    nav.activeModule.value = "dfolder";
    await flushPromises();
    await nav.openFolderRow(nav.folder);

    expect(nav.activeModuleView.value!.trail).toEqual(["Dash Folders", "default"]);
    expect(nav.activeModuleView.value!.scopes.map((row: any) => row.key)).toEqual([
      "dfolder/default",
    ]);
    expect(nav.activeModuleView.value!.entities).toBe(nav.folder.entities);
  });
});

describe("useModuleNavigation - navigation [characterization]", () => {
  it("clears the open folder whenever a module is opened", async () => {
    const nav = setup();
    nav.activeModule.value = "dfolder";
    await flushPromises();
    await nav.openFolderRow(nav.folder);

    await nav.openModule("provider");

    expect(nav.openFolder.value).toBeNull();
  });

  it("does not load entities for a module that has none", async () => {
    const nav = setup();
    await nav.openModule("role");
    expect(nav.loadingFor.value).toBe("");
    expect(nav.getResourceEntities).not.toHaveBeenCalled();
  });

  // Two loads can overlap when the user switches module fast; the older one finishing must not
  // clear the spinner of the module on screen, or its pane shows "no resources" while still loading.
  it("keeps the spinner for the module on screen when an older load finishes first", async () => {
    const nav = setup();
    const finish: Record<string, () => void> = {};
    nav.getResourceEntities.mockImplementation(
      (resource: any) =>
        new Promise<undefined>((resolve) => (finish[resource.name] = () => resolve(undefined))),
    );

    nav.activeModule.value = "provider";
    await flushPromises();
    nav.activeModule.value = "dfolder";
    await flushPromises();
    expect(nav.loadingFor.value).toBe("dfolder");

    finish.provider();
    await flushPromises();
    expect(nav.loadingFor.value).toBe("dfolder");

    finish.dfolder();
    await flushPromises();
    expect(nav.loadingFor.value).toBe("");
  });

  // The type's full list already sits in heavyResourceEntities, so re-opening it loads nothing.
  it("re-opens a loaded stream type without a fetch", async () => {
    const nav = setup();
    nav.activeModule.value = "stream";
    await flushPromises();
    nav.getResourceEntities.mockClear();

    await nav.openFolderRow(nav.metricsType);

    expect(nav.getResourceEntities).not.toHaveBeenCalled();
    expect(nav.loadingFor.value).toBe("");
    expect(nav.openFolder.value).toBe(nav.metricsType);
  });

  it("goes back to the module's top level from the first crumb", async () => {
    const nav = setup();
    nav.activeModule.value = "dfolder";
    await flushPromises();
    await nav.openFolderRow(nav.folder);

    nav.navigateTrail(0);

    expect(nav.openFolder.value).toBeNull();
    expect(nav.activeModuleView.value!.trail).toEqual(["Dash Folders"]);
  });

  it("stays put when the last crumb is clicked", async () => {
    const nav = setup();
    nav.activeModule.value = "dfolder";
    await flushPromises();
    await nav.openFolderRow(nav.folder);

    nav.navigateTrail(1);

    expect(nav.openFolder.value).toBe(nav.folder);
  });
});

describe("useModuleNavigation - a list that fails to load", () => {
  // openModule and openFolderRow are new call sites; without a catch the rejection escapes unhandled.
  it("does not reject when a module's rows fail to load", async () => {
    const nav = setup();
    nav.getResourceEntities.mockRejectedValueOnce(new Error("boom"));

    await expect(nav.openModule("dfolder")).resolves.toBeUndefined();
    expect(nav.loadingFor.value).toBe("");
  });

  it("does not reject when a folder fails to open", async () => {
    const nav = setup();
    nav.activeModule.value = "dfolder";
    await flushPromises();
    nav.getResourceEntities.mockRejectedValueOnce(new Error("boom"));

    await expect(nav.openFolderRow(nav.folder)).resolves.toBeUndefined();
    expect(nav.loadingFor.value).toBe("");
  });
});
