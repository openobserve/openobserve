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

import type { I18nKey } from "@/types/i18n";
import { lensPodStatus, type PodRow } from "./kubernetesModel";
import type { EventRow } from "./kubernetesEvents";
import type { View } from "./kubernetesQueries";

export type StatusChipId =
  "all" | "running" | "pending" | "failing" | "completed" | "warnings" | "normal";

export interface StatusChipDef {
  id: StatusChipId;
  label: I18nKey;
  count: number;
}

interface ChipSpec {
  id: StatusChipId;
  label: I18nKey;
  test: (row: any) => boolean;
}

const POD_CHIPS: ChipSpec[] = [
  { id: "all", label: "infra.k8s2.chipAll", test: () => true },
  {
    id: "running",
    label: "infra.k8s2.chipRunning",
    test: (r: PodRow) => lensPodStatus(r) === "running",
  },
  {
    id: "pending",
    label: "infra.k8s2.chipPending",
    test: (r: PodRow) => lensPodStatus(r) === "pending",
  },
  {
    id: "failing",
    label: "infra.k8s2.chipFailing",
    test: (r: PodRow) => ["failed", "evicted"].includes(lensPodStatus(r)),
  },
  {
    id: "completed",
    label: "infra.k8s2.chipCompleted",
    test: (r: PodRow) => lensPodStatus(r) === "succeeded",
  },
];

const EVENT_CHIPS: ChipSpec[] = [
  { id: "all", label: "infra.k8s2.chipAll", test: () => true },
  { id: "warnings", label: "infra.k8s2.chipWarnings", test: (e: EventRow) => e.type === "Warning" },
  { id: "normal", label: "infra.k8s2.chipNormal", test: (e: EventRow) => e.type === "Normal" },
];

const specsFor = (view: View): ChipSpec[] | null =>
  view === "pods" ? POD_CHIPS : view === "events" ? EVENT_CHIPS : null;

export function statusChipsFor(view: View, rows: any[]): StatusChipDef[] {
  const specs = specsFor(view);
  if (!specs) return [];
  return specs.map(({ id, label, test }) => ({ id, label, count: rows.filter(test).length }));
}

export function matchesStatusChip(view: View, row: any, id: StatusChipId): boolean {
  const spec = specsFor(view)?.find((s) => s.id === id);
  return spec ? spec.test(row) : true;
}
