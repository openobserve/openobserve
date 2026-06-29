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

import { ref } from "vue";
import config from "@/aws-exports";
import {
  useServiceCorrelation,
  type KeyFieldsConfig,
  type FieldGroupingConfig,
} from "@/composables/useServiceCorrelation";
import {
  buildSemanticIndex,
  applyFieldGrouping,
  type SemanticIndex,
  type FieldObj,
} from "@/utils/fieldCategories";

/**
 * Reusable field-grouping context loader.
 *
 * Encapsulates the load-semantic-groups + key-fields + field-grouping config
 * fetch (parallel, all cached) and the SemanticIndex build that the logs field
 * sidebar uses, so other field sidebars (RUM sessions, error tracking, etc.)
 * can apply the exact same grouping mechanism without duplicating the wiring.
 */
export default function useFieldGrouping() {
  const { loadSemanticGroups, loadKeyFields, loadFieldGrouping } =
    useServiceCorrelation();

  const semanticIndex = ref<SemanticIndex | null>(null);
  const keyFieldSet = ref<Set<string>>(new Set());
  const keyGroupSet = ref<Set<string>>(new Set());

  /**
   * Fetch the org's grouping configuration for a stream type and build the
   * SemanticIndex. Semantic groups are an enterprise/cloud feature; outside of
   * those builds the index stays null and grouping is a no-op (flat fallback).
   */
  async function loadGroupingContext(streamType = "logs"): Promise<void> {
    const isEnterprise =
      config.isEnterprise === "true" || config.isCloud === "true";

    const [semanticAliases, keyFieldsConfig, fieldGrouping] = await Promise.all([
      isEnterprise ? loadSemanticGroups() : Promise.resolve([]),
      loadKeyFields(),
      loadFieldGrouping(),
    ]);

    const grouping = (fieldGrouping as FieldGroupingConfig).prefix_aliases
      ? (fieldGrouping as FieldGroupingConfig)
      : null;
    semanticIndex.value =
      semanticAliases.length > 0
        ? buildSemanticIndex(semanticAliases, grouping)
        : null;

    const keySpec = (keyFieldsConfig as KeyFieldsConfig)[streamType] ?? {
      fields: [],
      groups: [],
    };
    keyFieldSet.value = new Set(keySpec.fields.map((f) => f.toLowerCase()));
    keyGroupSet.value = new Set(keySpec.groups.map((g) => g.toLowerCase()));
  }

  /**
   * Bucket `fields` into semantic groups (injecting label header rows).
   * Returns the input unchanged when no semantic index is configured.
   */
  function groupFields(fields: FieldObj[]): FieldObj[] {
    return applyFieldGrouping(
      fields,
      semanticIndex.value,
      keyFieldSet.value,
      keyGroupSet.value,
    );
  }

  return {
    semanticIndex,
    keyFieldSet,
    keyGroupSet,
    loadGroupingContext,
    groupFields,
  };
}
