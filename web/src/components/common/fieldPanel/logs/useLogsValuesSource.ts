// Copyright 2026 OpenObserve Inc.

import { ref, watch, type Ref } from "vue";
import type { TranslateFn } from "@/types/i18n";
import useFieldValuesStream, {
  type FieldValuesRequest,
  type FieldValuesState,
} from "@/composables/useFieldValuesStream";
import type { SearchObject } from "@/composables/useLogs/searchState";
import { toast } from "@/lib/feedback/Toast/useToast";
import type { PanelField, ValuesRequest } from "../fieldPanel.types";
import { valuesTimeRange, type TimeRange, type ValuesPlan } from "./logsValuesPlan";

export interface LogsValuesDeps {
  searchObj: SearchObject;
  t: TranslateFn;
  pageSize: () => number;
  showFtsFieldValues: () => boolean;
  buildValuesPlan: (name: string, streams: string[], range: TimeRange) => ValuesPlan;
  /** Identifies the stream set; open lists are dropped when it changes. */
  streamsKey: () => string;
}

export interface LogsValuesSource {
  expandedFields: Ref<string[]>;
  fieldValues: Ref<Record<string, FieldValuesState>>;
  openField: (field: PanelField) => void;
  closeField: (name: string) => void;
  searchValues: (name: string, term: string) => void;
  loadMoreValues: (name: string) => void;
  valuesRequest: (field: PanelField) => ValuesRequest;
}

export function useLogsValuesSource(deps: LogsValuesDeps): LogsValuesSource {
  const { searchObj, t } = deps;
  const {
    fieldValues,
    fieldValuesFinalizedValues,
    fetchFieldValues,
    fetchMoreFieldValues,
    isFetchSettled,
    rememberUnfiltered,
    restoreUnfiltered,
    forgetUnfiltered,
    cancelFieldStream,
    cancelAllFieldStreams,
    resetFieldValues,
    setFieldError,
  } = useFieldValuesStream(t);

  const expandedFields = ref<string[]>([]);
  const payloadsPerField = ref<Record<string, FieldValuesRequest[]>>({});
  const sizePerField = ref<Record<string, number>>({});
  const keywordPerField = ref<Record<string, string>>({});
  const pinnedRange = ref<Record<string, TimeRange>>({});

  const isExpandable = (field: PanelField) =>
    field.isSchemaField && field.showValues && !(field.ftsKey && !deps.showFtsFieldValues());

  const startFieldValues = (field: PanelField) => {
    const name = field.name;
    const range = valuesTimeRange(searchObj);
    pinnedRange.value[name] = range;
    sizePerField.value[name] = deps.pageSize();
    delete keywordPerField.value[name];
    forgetUnfiltered(name);
    cancelFieldStream(name);
    resetFieldValues(name, true);
    const plan = deps.buildValuesPlan(
      name,
      field.streams ?? searchObj.data.stream.selectedStream,
      range,
    );
    payloadsPerField.value[name] = plan.payloads;
    if (plan.error !== undefined) {
      setFieldError(name, plan.error);
      return;
    }
    if (!plan.payloads.length) {
      fieldValues.value[name].isLoading = false;
      return;
    }
    fetchFieldValues(plan.payloads);
  };

  const openField = (field: PanelField) => {
    if (!isExpandable(field)) return;
    if (!expandedFields.value.includes(field.name)) {
      expandedFields.value = [...expandedFields.value, field.name];
    }
    try {
      startFieldValues(field);
    } catch {
      fieldValues.value[field.name].isLoading = false;
      toast({ variant: "error", message: t("logs.indexList.errorFetchingFieldValues") });
    }
  };

  const closeField = (name: string) => {
    cancelFieldStream(name);
    delete payloadsPerField.value[name];
    delete sizePerField.value[name];
    delete keywordPerField.value[name];
    delete pinnedRange.value[name];
    forgetUnfiltered(name);
    resetFieldValues(name);
    expandedFields.value = expandedFields.value.filter((id) => id !== name);
  };

  // Clearing the search puts back the list it started from, so no request is sent.
  const searchValues = (name: string, term: string) => {
    keywordPerField.value[name] = term;
    if (!term) {
      const size = restoreUnfiltered(name);
      if (size !== null) {
        sizePerField.value[name] = size;
        return;
      }
    } else {
      rememberUnfiltered(name, sizePerField.value[name] ?? deps.pageSize());
    }
    sizePerField.value[name] = deps.pageSize();
    delete fieldValuesFinalizedValues.value[name];
    const payloads = payloadsPerField.value[name];
    if (!payloads?.length) return;
    cancelFieldStream(name);
    resetFieldValues(name, true);
    fetchFieldValues(payloads.map((payload) => ({ ...payload, keyword: term || undefined })));
  };

  const loadMoreValues = (name: string) => {
    const payloads = payloadsPerField.value[name];
    if (!payloads?.length || !isFetchSettled(name)) return;
    const previous = sizePerField.value[name] ?? deps.pageSize();
    const size = previous + deps.pageSize();
    sizePerField.value[name] = size;
    const keyword = keywordPerField.value[name];
    const pinned = pinnedRange.value[name];
    fetchMoreFieldValues(
      payloads.map((payload) => ({
        ...payload,
        size,
        ...(pinned ? { start_time: pinned.startTime, end_time: pinned.endTime } : {}),
        ...(keyword ? { keyword } : {}),
      })),
      name,
      () => {
        sizePerField.value[name] = previous;
      },
    );
    if (fieldValues.value[name]) {
      fieldValues.value[name].isLoading = true;
      fieldValues.value[name].hasMore = false;
    }
  };

  const resetValues = () => {
    cancelAllFieldStreams();
    expandedFields.value = [];
    payloadsPerField.value = {};
    sizePerField.value = {};
    keywordPerField.value = {};
    pinnedRange.value = {};
    fieldValues.value = {};
  };

  // Open lists belong to the streams they were fetched from.
  watch(() => deps.streamsKey(), resetValues);

  const valuesRequest = (field: PanelField): ValuesRequest => {
    const range = pinnedRange.value[field.name] ?? valuesTimeRange(searchObj);
    return {
      streamName: field.streams?.[0] ?? searchObj.data.stream.selectedStream[0] ?? "",
      streamType: searchObj.data.stream.streamType,
      startTime: range.startTime,
      endTime: range.endTime,
      whereClause: "",
    };
  };

  return {
    expandedFields,
    fieldValues,
    openField,
    closeField,
    searchValues,
    loadMoreValues,
    valuesRequest,
  };
}
