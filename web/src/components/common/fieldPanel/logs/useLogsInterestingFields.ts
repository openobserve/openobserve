// Copyright 2026 OpenObserve Inc.

import type { Ref } from "vue";
import type { SearchObject } from "@/composables/useLogs/searchState";
import { interestingRowsOf } from "@/utils/logs/interestingFields";
import { useLocalInterestingFields } from "@/utils/zincutils";
import type { PanelField } from "../fieldPanel.types";

type InterestingStore = Record<string, string[]>;

export interface LogsInterestingDeps {
  searchObj: SearchObject;
  streamSchemaFieldsIndexMapping: Ref<Record<string, number>>;
  timestampColumn: () => string;
  defaultInterestingFields: () => Set<string>;
  /** Flipped off when the last interesting field goes, so the list falls back to every field. */
  showOnlyInterestingFields: Ref<boolean>;
  onChange: (field: PanelField, isFieldExistInSQL: boolean) => void;
}

const readStore = (): InterestingStore =>
  (useLocalInterestingFields()?.value as InterestingStore | null | undefined) ?? {};

export function useLogsInterestingFields(deps: LogsInterestingDeps) {
  const { searchObj } = deps;

  const markRow = (name: string, isInteresting: boolean) => {
    const index = deps.streamSchemaFieldsIndexMapping.value[name];
    const row = searchObj.data.stream.selectedStreamFields[index];
    if (row) row.isInterestingField = isInteresting;
  };

  const forget = (field: PanelField, defaults: Set<string>) => {
    const list = searchObj.data.stream.interestingFieldList;
    const index = list.indexOf(field.name);
    if (index === -1) return;
    list.splice(index, 1);
    markRow(field.name, false);
    const local = readStore();
    const org = searchObj.organizationIdentifier;
    for (const stream of field.streams ?? []) {
      const entries = local[`${org}_${stream}`];
      const localIndex = entries?.indexOf(field.name) ?? -1;
      if (entries && localIndex > -1) entries.splice(localIndex, 1);
      // A dropped default is remembered, or the next extract would bring it back.
      const deselectKey = `deselect_${org}_${stream}`;
      const deselected = local[deselectKey] || [];
      if (defaults.has(field.name) && !deselected.includes(field.name)) {
        local[deselectKey] = [...deselected, field.name];
      }
    }
    if (!list.length) deps.showOnlyInterestingFields.value = false;
    useLocalInterestingFields(local);
  };

  const remember = (field: PanelField, defaults: Set<string>) => {
    const list = searchObj.data.stream.interestingFieldList;
    if (list.includes(field.name) || field.name === "*") return;
    list.push(field.name);
    markRow(field.name, true);
    const local = readStore();
    const org = searchObj.organizationIdentifier;
    for (const stream of field.streams ?? []) {
      const key = `${org}_${stream}`;
      if (local[key] === undefined) local[key] = [];
      // Defaults and the timestamp are interesting without a stored entry.
      if (
        !local[key].includes(field.name) &&
        field.name !== deps.timestampColumn() &&
        !defaults.has(field.name)
      ) {
        local[key].push(field.name);
      }
      const deselectKey = `deselect_${org}_${stream}`;
      if (defaults.has(field.name) && (local[deselectKey] ?? []).includes(field.name)) {
        local[deselectKey] = local[deselectKey].filter((name) => name !== field.name);
      }
    }
    useLocalInterestingFields(local);
  };

  const toggleInteresting = (field: PanelField) => {
    // Before the index mapping exists the rows cannot be flagged, so the click is ignored.
    if (!Object.keys(deps.streamSchemaFieldsIndexMapping.value).length) return;
    const isInteresting = field.isInterestingField === true;
    const defaults = deps.defaultInterestingFields();
    if (isInteresting) forget(field, defaults);
    else remember(field, defaults);
    searchObj.data.stream.selectedInterestingStreamFields = interestingRowsOf(
      searchObj.data.stream.selectedStreamFields,
    );
    deps.onChange(field, isInteresting);
  };

  return { toggleInteresting };
}
