// Copyright 2026 OpenObserve Inc.

import { computed, ref, watch, type ComputedRef, type Ref } from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import type { SearchObject } from "@/composables/useLogs/searchState";
import { bumpSelectionToken, currentSelectionToken } from "@/composables/useLogs/useSearchBar";
import type { StreamListOptions } from "@/composables/useLogs/useStreamFields";
import {
  useStreamPickerOptions,
  type PickerStream,
  type StreamPickerOption,
} from "@/composables/useStreamPickerOptions";
import { useFeatureLock } from "@/composables/useFeatureLock";
import { compareStreamsByLatest } from "@/utils/logs/estimateScanMb";
import { saveLogsStreamType } from "@/utils/streamPersist";
import type { StreamOption, StreamPickerHooks } from "../fieldPanel.types";

/** One-click picks on the no-stream state; the rest stay reachable through the picker's search. */
export const QUICK_PICK_LIMIT = 8;

export interface QuickPickStream {
  label: string;
  value: string;
  internal: boolean;
}

export interface QuickPickGroup {
  id: string;
  label?: I18nText;
  header?: StreamPickerOption;
  streams: QuickPickStream[];
}

export interface LogsPickerDeps {
  searchObj: SearchObject;
  onStreamChange: (query: string, options: { origin: "selector" }) => void;
  getStreamList: (selectStream: boolean, options: StreamListOptions) => Promise<void>;
}

export interface LogsPickerSource {
  streams: ComputedRef<StreamOption[]>;
  selectedStreams: ComputedRef<string[]>;
  streamType: ComputedRef<string>;
  picker: StreamPickerHooks;
  selectStreams: (names: string[]) => void;
  changeStreamType: (type: string) => void;
  refreshStreams: () => void;
  showBackToLogs: ComputedRef<boolean>;
  backToLogs: () => void;
  quickPickGroups: ComputedRef<QuickPickGroup[]>;
  quickPickMoreCount: ComputedRef<number>;
  quickSelectStream: (name: string) => void;
  onPickerHeaderAction: (option: { value?: unknown }) => void;
}

export function useLogsPickerSource(deps: LogsPickerDeps): LogsPickerSource {
  const { searchObj } = deps;
  const store = useStore();
  const router = useRouter();
  const pageLock = useFeatureLock();
  const { t } = useI18nTyped();

  const selectedStreams = computed<string[]>(() => searchObj.data.stream.selectedStream);
  const streamType = computed<string>(() => searchObj.data.stream.streamType);

  const pickerStreams = computed<PickerStream[]>(() =>
    (searchObj.data.stream.streamLists || []).map(
      (option: { value: string; internal?: boolean }) => ({
        name: option.value,
        is_internal: option.internal === true,
      }),
    ),
  );

  const pickerOpen = ref(false);
  const pickerSearch = ref("");
  const {
    options: pickerOptions,
    hideInternalStreams,
    internalHeader,
    onHeaderAction: onPickerHeaderAction,
    announcement,
  } = useStreamPickerOptions({
    streams: pickerStreams,
    selected: selectedStreams,
    open: pickerOpen,
    search: pickerSearch,
  });

  const streams = computed<StreamOption[]>(() =>
    pickerOptions.value.map((option) => ({ ...option, value: option.value ?? "" })),
  );

  // A debounced search can land after the popover closed and would stick until the next open.
  const onPickerSearch = (term: string) => {
    if (pickerOpen.value) pickerSearch.value = term;
  };
  const onPickerClose = () => {
    pickerOpen.value = false;
    pickerSearch.value = "";
  };

  // The open popover would cover the Source Details drawer.
  const pickerCloseSignal = ref(0);
  watch(
    () => searchObj.meta.showDetailTab,
    (open) => {
      if (open) pickerCloseSignal.value += 1;
    },
  );

  const isCurrentSelection = (token: number, org: string, type: string) => () =>
    token === currentSelectionToken() &&
    searchObj.data.stream.streamType === type &&
    store.state.selectedOrganization.identifier === org;

  // A schema load writes onto the list entry it started from, so a list swapped in mid-load would lose that schema; the refresh waits for the load.
  let refreshAfterLoad = false;
  const waitForSchemaLoad = () => {
    if (!searchObj.loadingStream) return false;
    refreshAfterLoad = true;
    return true;
  };

  // A stream created since the page loaded shows up on the next open; the selection is left alone.
  const refreshStreams = () => {
    if (waitForSchemaLoad()) return;
    const isSelected = isCurrentSelection(
      currentSelectionToken(),
      store.state.selectedOrganization.identifier,
      streamType.value,
    );
    const isCurrent = () => isSelected() && !waitForSchemaLoad();
    void deps.getStreamList(false, { isCurrent, force: true, keepLoadedSchemas: true });
  };

  watch(
    () => searchObj.loadingStream,
    (loading) => {
      if (loading || !refreshAfterLoad) return;
      refreshAfterLoad = false;
      refreshStreams();
    },
  );

  const selectStreams = (names: string[]) => {
    searchObj.data.stream.selectedStream = names;
    searchObj.data.filterErrMsg = "";
    deps.onStreamChange("", { origin: "selector" });
  };

  const quickSelectStream = (name: string) => selectStreams([name]);

  const changeStreamType = async (newType: string) => {
    const token = bumpSelectionToken();
    const org = store.state.selectedOrganization.identifier;
    searchObj.data.stream.streamType = newType;
    searchObj.data.stream.selectedStream = [];
    searchObj.data.stream.selectedStreamFields = [];
    saveLogsStreamType(org, newType);
    // A locked page cannot run the search that would update `stream_type`, which the lock reads from the URL.
    if (pageLock.locked.value) {
      void router.replace({
        query: { ...router.currentRoute.value.query, stream_type: newType, stream: undefined },
      });
    }
    const isCurrent = isCurrentSelection(token, org, newType);
    await deps.getStreamList(true, { isCurrent });
    if (!isCurrent()) return;
    if (searchObj.data.stream.selectedStream.length) {
      deps.onStreamChange("", { origin: "selector" });
    }
  };

  const showBackToLogs = computed(() => !!streamType.value && streamType.value !== "logs");
  const backToLogs = () => {
    void changeStreamType("logs");
  };

  // User streams first, internal ones last, each by most recent data; the plain list order without stats.
  const quickPickOrdered = computed(() => {
    const detailed = searchObj.data.streamResults?.list;
    const ordered: PickerStream[] =
      Array.isArray(detailed) && detailed.length
        ? [...detailed].sort(compareStreamsByLatest)
        : pickerStreams.value;
    return {
      user: ordered.filter((s) => !s.is_internal),
      internal: ordered.filter((s) => s.is_internal),
    };
  });

  // Same rule as the dropdown, so "+N more" counts only streams a search there can reach.
  const quickPickCandidates = computed<PickerStream[]>(() => {
    const { user, internal } = quickPickOrdered.value;
    return hideInternalStreams.value ? user : [...user, ...internal];
  });

  const quickPickStreams = computed<QuickPickStream[]>(() =>
    quickPickCandidates.value.slice(0, QUICK_PICK_LIMIT).map((s) => ({
      label: s.name,
      value: s.name,
      internal: s.is_internal === true,
    })),
  );

  const quickPickGroups = computed<QuickPickGroup[]>(() => {
    const { user, internal } = quickPickOrdered.value;
    // Only while internal streams would win a slot, so Show always reveals a stream.
    const internalRow = internal.length > 0 && user.length < QUICK_PICK_LIMIT;
    const internalListed = quickPickStreams.value.filter((s) => s.internal);
    const internalGroupHeader = hideInternalStreams.value
      ? internalHeader("hidden", internal.length)
      : internalHeader("shown", internalListed.length);
    const groups: QuickPickGroup[] = [
      {
        id: "user",
        label: t("search.quickPickStreamsLabel"),
        streams: quickPickStreams.value.filter((s) => !s.internal),
      },
      {
        id: "internal",
        header: internalRow ? internalGroupHeader : undefined,
        streams: internalListed,
      },
    ];
    return groups.filter((group) => group.header || group.streams.length > 0);
  });

  const quickPickMoreCount = computed(
    () => quickPickCandidates.value.length - quickPickStreams.value.length,
  );

  const picker: StreamPickerHooks = {
    announcement: announcement as Ref<I18nText | "">,
    searchDebounce: 150,
    closeSignal: pickerCloseSignal,
    onOpen: () => {
      pickerOpen.value = true;
    },
    onClose: onPickerClose,
    onSearch: onPickerSearch,
    onHeaderAction: onPickerHeaderAction,
  };

  return {
    streams,
    selectedStreams,
    streamType,
    picker,
    selectStreams,
    changeStreamType: (type: string) => {
      void changeStreamType(type);
    },
    refreshStreams,
    showBackToLogs,
    backToLogs,
    quickPickGroups,
    quickPickMoreCount,
    quickSelectStream,
    onPickerHeaderAction,
  };
}
