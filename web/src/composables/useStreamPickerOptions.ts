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

/** Header value whose action hides the internal streams. */
export const INTERNAL_GROUP_HIDE = "internal-streams:hide";
/** Header value whose action shows the internal streams again. */
export const INTERNAL_GROUP_SHOW = "internal-streams:show";

export type PickerStream = Pick<StreamListItem, "name" | "is_internal">;

export interface StreamPickerOption {
  label: I18nText;
  value?: string;
  header?: boolean;
  headerCount?: I18nText;
  headerAction?: I18nText;
  headerActionAriaLabel?: I18nText;
  keepOnSearch?: boolean;
}

export interface InternalGroupText {
  label: I18nText;
  hidden: (count: number) => I18nText;
  match: (count: number) => I18nText;
  hide: I18nText;
  show: I18nText;
  hideAriaLabel: I18nText;
  showAriaLabel: I18nText;
}

/** `shown` counts every internal stream, `hidden` the ones left out, `match` the left-out ones the search hits. */
export type InternalGroupMode = "shown" | "hidden" | "match";

export interface StreamPickerInput {
  streams: readonly PickerStream[];
  /** Stream names that stay listed while hidden: the selection, plus the one the open popover started with. */
  keep: ReadonlySet<string>;
  hide: boolean;
  search: string;
  text: InternalGroupText;
}

export interface StreamPickerState {
  options: StreamPickerOption[];
  hiddenCount: number;
}

export interface StreamPickerSources {
  streams: MaybeRefOrGetter<readonly PickerStream[]>;
  selected: MaybeRefOrGetter<readonly string[]>;
  open: MaybeRefOrGetter<boolean>;
  search: MaybeRefOrGetter<string>;
}

/** The "Internal streams" header row: a Hide action over the listed group, or a Show action on the collapsed one. */
export function internalGroupHeader(
  mode: InternalGroupMode,
  count: number,
  text: InternalGroupText,
): StreamPickerOption {
  const shown = mode === "shown";
  const countText = {
    shown: raw(String(count)),
    hidden: text.hidden(count),
    match: text.match(count),
  }[mode];
  return {
    label: text.label,
    value: shown ? INTERNAL_GROUP_HIDE : INTERNAL_GROUP_SHOW,
    header: true,
    ...(shown || count > 0 ? { headerCount: countText } : {}),
    headerAction: shown ? text.hide : text.show,
    headerActionAriaLabel: shown ? text.hideAriaLabel : text.showAriaLabel,
    // Hidden matches have no row of their own, so the header is the only result that says they exist.
    ...(mode === "match" ? { keepOnSearch: true } : {}),
  };
}

/** Orders user streams first and internal streams under their header, collapsing hidden ones into it. */
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

  if (!input.hide) {
    const header = internalGroupHeader("shown", internal.length, input.text);
    return { options: internal.length ? [...user, header, ...internal] : user, hiddenCount: 0 };
  }
  if (!internal.length && !hiddenNames.length) return { options: user, hiddenCount: 0 };

  const term = input.search.trim().toLowerCase();
  const matches = term ? hiddenNames.filter((name) => name.toLowerCase().includes(term)).length : 0;
  const header = matches
    ? internalGroupHeader("match", matches, input.text)
    : internalGroupHeader("hidden", hiddenNames.length, input.text);
  return { options: [...user, header, ...internal], hiddenCount: hiddenNames.length };
}

/** Reactive stream-picker options over the shared hide setting; the kept set is frozen while the popover is open. */
export function useStreamPickerOptions(sources: StreamPickerSources) {
  const { t } = useI18nTyped();
  const { hideInternalStreams } = useHideInternalStreams();

  const text = computed<InternalGroupText>(() => ({
    label: t("components.streamPicker.internalStreams"),
    hidden: (count) => t("components.streamPicker.hiddenCount", { count }, count),
    match: (count) => t("components.streamPicker.matchCount", { count }, count),
    hide: t("components.streamPicker.hide"),
    show: t("components.streamPicker.show"),
    hideAriaLabel: t("components.streamPicker.hideInternal"),
    showAriaLabel: t("components.streamPicker.showInternal"),
  }));

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
      text: text.value,
    }),
  );

  const announcement = ref<I18nText | "">("");

  /** Handles a `header-action` from the picker or the quick-pick; headers other than the internal-streams one are ignored. */
  const onHeaderAction = (option: { value?: unknown }) => {
    if (option.value !== INTERNAL_GROUP_HIDE && option.value !== INTERNAL_GROUP_SHOW) return;
    const hide = option.value === INTERNAL_GROUP_HIDE;
    hideInternalStreams.value = hide;
    announcement.value = hide
      ? t("components.streamPicker.announceHidden")
      : t("components.streamPicker.announceShown");
  };

  return {
    options: computed(() => state.value.options),
    hiddenCount: computed(() => state.value.hiddenCount),
    hideInternalStreams,
    internalHeader: (mode: InternalGroupMode, count: number) =>
      internalGroupHeader(mode, count, text.value),
    onHeaderAction,
    announcement,
  };
}
