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
import { gt } from "@/types/i18n";
import { convertToCamelCase } from "@/utils/zincutils";
import {
  useServiceCorrelation,
  type KeyFieldsConfig,
  type FieldGroupingConfig,
} from "@/composables/useServiceCorrelation";
import {
  buildSemanticIndex,
  applyFieldGrouping,
  applyStreamGrouping,
  type SemanticIndex,
  type FieldObj,
  type StreamGroupLabels,
} from "@/utils/fieldCategories";

export interface FieldGroupingOptions {
  /** Without semantic aliases, still group by key fields, prefixes and types instead of a flat list. */
  fallbackGroups?: boolean;
}

/** Header text of the multi-stream layout; resolved per call so a locale switch is picked up. */
export const streamGroupLabels = (): StreamGroupLabels => ({
  common: gt("search.commonGroupFields"),
  stream: convertToCamelCase,
});

/** Loads the org's semantic groups, key fields and grouping config and buckets fields with them. */
export default function useFieldGrouping(options: FieldGroupingOptions = {}) {
  const { loadSemanticGroups, loadKeyFields, loadFieldGrouping } = useServiceCorrelation();

  const semanticIndex = ref<SemanticIndex | null>(null);
  const groupingConfig = ref<FieldGroupingConfig | null>(null);
  const keyFieldSet = ref<Set<string>>(new Set());
  const keyGroupSet = ref<Set<string>>(new Set());
  const contextLoaded = ref(false);
  // Bumped by every load and reset so an answer that lands after a newer call is dropped.
  let generation = 0;

  /** Drops the loaded context so the next load starts from a flat list and in-flight answers are ignored. */
  function reset(): void {
    generation += 1;
    semanticIndex.value = null;
    groupingConfig.value = null;
    keyFieldSet.value = new Set();
    keyGroupSet.value = new Set();
    contextLoaded.value = false;
  }

  /**
   * Fetch the org's grouping configuration for a stream type and build the
   * SemanticIndex. Semantic groups are an enterprise/cloud feature; outside of
   * those builds the index stays null and grouping is a no-op (flat fallback).
   */
  async function loadGroupingContext(streamType = "logs"): Promise<void> {
    const isEnterprise = config.isEnterprise === "true" || config.isCloud === "true";
    generation += 1;
    const current = generation;

    const [semanticAliases, keyFieldsConfig, fieldGrouping] = await Promise.all([
      isEnterprise ? loadSemanticGroups() : Promise.resolve([]),
      loadKeyFields(),
      loadFieldGrouping(),
    ]);
    if (current !== generation) return;

    const grouping = (fieldGrouping as FieldGroupingConfig).prefix_aliases
      ? (fieldGrouping as FieldGroupingConfig)
      : null;
    groupingConfig.value = grouping;
    semanticIndex.value =
      semanticAliases.length > 0 ? buildSemanticIndex(semanticAliases, grouping) : null;
    contextLoaded.value = true;

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
    const index =
      semanticIndex.value ??
      (options.fallbackGroups ? buildSemanticIndex([], groupingConfig.value) : null);
    return applyFieldGrouping(fields, index, keyFieldSet.value, keyGroupSet.value);
  }

  /** Multi-stream layout: common fields first, then each stream's own fields, with the loaded key fields on top. */
  function groupFieldsByStream(fields: FieldObj[], streams: string[]): FieldObj[] {
    return applyStreamGrouping(
      fields,
      streams,
      keyFieldSet.value,
      keyGroupSet.value,
      streamGroupLabels(),
    );
  }

  return {
    semanticIndex,
    keyFieldSet,
    keyGroupSet,
    contextLoaded,
    loadGroupingContext,
    reset,
    groupFields,
    groupFieldsByStream,
  };
}
