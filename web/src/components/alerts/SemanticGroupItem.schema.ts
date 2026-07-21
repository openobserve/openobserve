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

import { z } from "zod";

// Co-located Zod schema for SemanticGroupItem (the inline correlation "semantic
// field group" row). Only three controls are form-owned:
//   • display           → required (pre-migration rule: `!!v || t('common.name') + ' is required'`)
//   • is_workload_type  → optional boolean (no rule today)
//   • fields (OFormTagInput) → optional string[] (NO required rule today — do NOT add one)
//
// The generated `id` and the parent-supplied `group` (category) are NOT form
// fields — `id` is a slugify side-effect of `display` and `group` comes from the
// prop; both are merged back into the emitted group object, never validated.
export const makeSemanticGroupItemSchema = (t: (_key: string) => string) =>
  z.object({
    display: z.string().min(1, t("common.nameRequired")),
    is_workload_type: z.boolean().optional(),
    fields: z.array(z.string()).optional(),
  });

export type SemanticGroupItemForm = z.infer<
  ReturnType<typeof makeSemanticGroupItemSchema>
>;

/**
 * Typed default values for the form, projected from the (optional) group record
 * the row is editing.
 */
export const semanticGroupItemDefaults = (
  group?: Partial<Pick<SemanticGroupItemForm, "display" | "is_workload_type" | "fields">>,
): SemanticGroupItemForm => ({
  display: group?.display ?? "",
  is_workload_type: group?.is_workload_type ?? false,
  fields: group?.fields ? [...group.fields] : [],
});
