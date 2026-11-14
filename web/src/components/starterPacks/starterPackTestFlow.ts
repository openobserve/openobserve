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

import { computed, ref, shallowRef } from "vue";
import { vi } from "vitest";

import type { StarterPackFlow } from "@/composables/starterPacks/useStarterPackFlow";

export const PACK = {
  id: "kubernetes",
  titleKey: "starterPacks.kubernetes.title",
  dashboards: [{ id: "overview", title: "Overview" }],
  alerts: ["a1", "a2"],
  savedViews: [{ id: "v1", name: "Events" }],
  folder: { name: "Kubernetes", description: "" },
  nativeView: { feature: "kubernetes_monitoring", route: "infraKubernetes" },
  clusterScoped: true,
  collectorRoute: "ingestFromKubernetes",
};

/** A flow double whose state a spec sets directly. */
export const fakeFlow = (over: Record<string, unknown> = {}) =>
  ({
    alertCount: ref(2),
    alertsOff: ref(2),
    alertsOn: ref(0),
    alertsRoute: computed(() => ({ name: "alertList", query: { org_identifier: "org" } })),
    alertsTotal: ref(2),
    busy: ref(false),
    dashboardCount: ref(1),
    dashboardItem: shallowRef(undefined),
    enabledAlertIds: shallowRef(new Set<string>()),
    canManage: ref(true),
    canUndo: ref(true),
    failed: ref([]),
    forbidden: ref(false),
    install: vi.fn(async () => true),
    installFailed: ref(false),
    installed: ref(false),
    interrupted: ref(false),
    isAdmin: ref(false),
    items: ref([]),
    keepOff: vi.fn(async () => undefined),
    packLink: () => "http://x/web/starter-packs/kubernetes?org_identifier=org",
    packRoute: computed(() => ({ name: "starterPack", params: { pack: "kubernetes" } })),
    remindAlerts: ref(true),
    skipped: ref([]),
    trackAlertEdit: vi.fn((_pack: unknown, _ids: unknown, work: () => unknown) => work()),
    land: vi.fn(async () => undefined),
    licensed: ref(true),
    load: vi.fn(async () => undefined),
    loadFailed: ref(false),
    loadPreview: vi.fn(async () => undefined),
    loaded: ref(true),
    made: ref([]),
    nameOf: (id: string) => `name-${id}`,
    org: "org",
    alertTitle: (_id: string, fallback: string) => fallback,
    pack: PACK,
    preview: shallowRef(null),
    previewState: ref("ready"),
    record: shallowRef(null),
    remove: vi.fn(async () => true),
    removal: shallowRef(null),
    removalFailed: ref(false),
    running: ref(false),
    toCreate: ref([]),
    undo: vi.fn(async () => true),
    undoLeftUs: ref(5 * 60 * 60 * 1_000_000),
    viewCount: ref(1),
    ...over,
  }) as unknown as StarterPackFlow;
