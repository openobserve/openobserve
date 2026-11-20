// Copyright 2026 OpenObserve Inc.

import { getCurrentScope, onScopeDispose, ref, type Ref } from "vue";
import type { TranslateFn } from "@/types/i18n";
import type { FieldValueEntry, FieldValuesState } from "@/composables/useFieldValuesStream";

export interface FieldValuesFetchRequest {
  field: string;
  /** Values wanted from the top, all pages so far; load more asks again with a bigger size. */
  size: number;
  keyword: string;
  signal: AbortSignal;
}

export interface FieldValuesPage {
  values: FieldValueEntry[];
  hasMore: boolean;
}

export type FieldValuesFetcher = (request: FieldValuesFetchRequest) => Promise<FieldValuesPage>;

interface Snapshot {
  values: FieldValuesState["values"];
  hasMore: boolean;
  size: number;
}

export interface FetchedFieldValues {
  fieldValues: Ref<Record<string, FieldValuesState>>;
  /** Starts a field's list over: first page, no keyword. */
  open: (field: string) => void;
  /** Fetches the field again with its current page count and keyword, as after a new search. */
  refresh: (field: string) => void;
  search: (field: string, term: string) => void;
  loadMore: (field: string) => void;
  close: (field: string) => void;
  reset: () => void;
}

/** The panel's values state for a page that fetches values itself; same shape `useFieldValuesStream` produces. */
export default function useFetchedFieldValues(
  fetchValues: FieldValuesFetcher,
  pageSize: () => number,
  t: TranslateFn,
): FetchedFieldValues {
  const fieldValues = ref<Record<string, FieldValuesState>>({});
  const generations: Record<string, number> = {};
  const controllers: Record<string, AbortController> = {};
  const sizes: Record<string, number> = {};
  const keywords: Record<string, string> = {};
  const unfiltered: Record<string, Snapshot> = {};

  const abort = (field: string) => {
    controllers[field]?.abort();
    delete controllers[field];
  };

  const isSettled = (field: string) => {
    const state = fieldValues.value[field];
    return !state || state.settled === state.generation;
  };

  // A load more keeps the shown values until the bigger page lands, a refresh keeps them marked busy, anything else starts empty.
  const load = async (field: string, mode: "fresh" | "more" | "refresh", rollbackSize?: number) => {
    abort(field);
    const controller = new AbortController();
    controllers[field] = controller;
    const generation = (generations[field] ?? 0) + 1;
    generations[field] = generation;
    const previous = fieldValues.value[field];
    const keep = mode === "more" || (mode === "refresh" && !!previous?.values.length);
    if (previous && keep) {
      fieldValues.value[field] = {
        ...previous,
        isLoading: mode === "refresh",
        errMsg: "",
        generation,
      };
    } else {
      fieldValues.value[field] = {
        values: [],
        isLoading: true,
        hasMore: false,
        errMsg: "",
        generation,
        settled: previous?.settled,
      };
    }
    try {
      const page = await fetchValues({
        field,
        size: sizes[field],
        keyword: keywords[field] ?? "",
        signal: controller.signal,
      });
      if (generations[field] !== generation) return;
      fieldValues.value[field] = {
        values: page.values,
        hasMore: page.hasMore,
        isLoading: false,
        errMsg: "",
        generation,
        settled: generation,
      };
    } catch (error) {
      if (generations[field] !== generation || controller.signal.aborted) return;
      if (rollbackSize !== undefined) sizes[field] = rollbackSize;
      const state = fieldValues.value[field];
      fieldValues.value[field] = {
        ...state,
        // Values from before a failed refresh no longer describe the query.
        values: mode === "refresh" ? [] : state.values,
        isLoading: false,
        errMsg: (error as Error)?.message || t("search.failedToFetchFieldValues"),
        settled: generation,
      };
    } finally {
      if (controllers[field] === controller) delete controllers[field];
    }
  };

  const open = (field: string) => {
    sizes[field] = pageSize();
    keywords[field] = "";
    delete unfiltered[field];
    void load(field, "fresh");
  };

  const refresh = (field: string) => {
    sizes[field] ??= pageSize();
    delete unfiltered[field];
    void load(field, "refresh");
  };

  // Clearing the search puts back the list it started from, so no request is sent.
  const search = (field: string, term: string) => {
    const snapshot = unfiltered[field];
    if (!term && snapshot) {
      abort(field);
      const generation = (generations[field] ?? 0) + 1;
      generations[field] = generation;
      sizes[field] = snapshot.size;
      keywords[field] = "";
      delete unfiltered[field];
      fieldValues.value[field] = {
        values: snapshot.values,
        hasMore: snapshot.hasMore,
        isLoading: false,
        errMsg: "",
        generation,
        settled: generation,
      };
      return;
    }
    const state = fieldValues.value[field];
    if (term && !snapshot && state?.values.length && isSettled(field)) {
      unfiltered[field] = { values: state.values, hasMore: state.hasMore, size: sizes[field] };
    }
    sizes[field] = pageSize();
    keywords[field] = term;
    void load(field, "fresh");
  };

  const loadMore = (field: string) => {
    if (!isSettled(field)) return;
    const previous = sizes[field] ?? pageSize();
    sizes[field] = previous + pageSize();
    void load(field, "more", previous);
  };

  const close = (field: string) => {
    abort(field);
    generations[field] = (generations[field] ?? 0) + 1;
    delete sizes[field];
    delete keywords[field];
    delete unfiltered[field];
    const next = { ...fieldValues.value };
    delete next[field];
    fieldValues.value = next;
  };

  const reset = () => {
    for (const field of Object.keys(controllers)) abort(field);
    for (const field of Object.keys(generations)) generations[field] += 1;
    for (const store of [sizes, keywords, unfiltered]) {
      for (const field of Object.keys(store)) delete store[field];
    }
    fieldValues.value = {};
  };

  if (getCurrentScope()) onScopeDispose(reset);

  return { fieldValues, open, refresh, search, loadMore, close, reset };
}
