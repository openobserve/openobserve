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

import { computed, ref, toValue, watch, type MaybeRefOrGetter } from "vue";
import { useHideInternalStreams } from "@/composables/useHideInternalStreams";
import type { StreamListItem } from "@/services/stream";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";

export type PickerStream = Pick<StreamListItem, "name" | "is_internal">;

export interface StreamPickerOption {
  label: I18nText;
  value?: string;
  header?: boolean;
}

export interface StreamPickerInput {
  streams: readonly PickerStream[];
  /** Stream names that stay listed while hidden: the selection, plus the one the open popover started with. */
  keep: ReadonlySet<string>;
  hide: boolean;
  search: string;
  headerLabel: I18nText;
}

export interface StreamPickerState {
  options: StreamPickerOption[];
  hiddenCount: number;
  searchHiddenMatchCount: number;
  /** Every stream is internal and hidden, so the list has nothing to show. */
  onlyInternalHidden: boolean;
}

export interface StreamPickerSources {
  streams: MaybeRefOrGetter<readonly PickerStream[]>;
  selected: MaybeRefOrGetter<readonly string[]>;
  open: MaybeRefOrGetter<boolean>;
  search: MaybeRefOrGetter<string>;
}

/** Orders user streams first and internal streams after an "Internal streams" header, dropping hidden ones that are not kept. */
export function buildStreamPickerOptions(input: StreamPickerInput): StreamPickerState {
  const user: StreamPickerOption[] = [];
  const internal: StreamPickerOption[] = [];
  const hiddenNames: string[] = [];
  for (const stream of input.streams) {
    const option = { label: raw(stream.name), value: stream.name };
    if (!stream.is_internal) user.push(option);
    else if (input.hide && !input.keep.has(stream.name)) hiddenNames.push(stream.name);
    else internal.push(option);
  }

  const term = input.search.trim().toLowerCase();
  const searchHiddenMatchCount = term
    ? hiddenNames.filter((name) => name.toLowerCase().includes(term)).length
    : 0;
  const options = internal.length
    ? [...user, { label: input.headerLabel, header: true }, ...internal]
    : user;

  return {
    options,
    hiddenCount: hiddenNames.length,
    searchHiddenMatchCount,
    onlyInternalHidden: options.length === 0 && hiddenNames.length > 0,
  };
}

/** Reactive stream-picker options over the shared hide setting; the kept set is frozen while the popover is open. */
export function useStreamPickerOptions(sources: StreamPickerSources) {
  const { t } = useI18nTyped();
  const { hideInternalStreams, showInternalStreams } = useHideInternalStreams();

  // Deselecting a hidden stream mid-popover must not pull its row out from under the cursor.
  const selectedAtOpen = ref<ReadonlySet<string>>(new Set());
  watch(
    () => toValue(sources.open),
    (open) => {
      selectedAtOpen.value = open ? new Set(toValue(sources.selected)) : new Set();
    },
    { immediate: true },
  );

  const state = computed(() =>
    buildStreamPickerOptions({
      streams: toValue(sources.streams),
      keep: new Set([...selectedAtOpen.value, ...toValue(sources.selected)]),
      hide: hideInternalStreams.value,
      search: toValue(sources.search),
      headerLabel: t("components.streamPicker.internalStreams"),
    }),
  );

  return {
    options: computed(() => state.value.options),
    hiddenCount: computed(() => state.value.hiddenCount),
    searchHiddenMatchCount: computed(() => state.value.searchHiddenMatchCount),
    onlyInternalHidden: computed(() => state.value.onlyInternalHidden),
    hideInternalStreams,
    showInternalStreams,
  };
}
