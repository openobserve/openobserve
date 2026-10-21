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

import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useStore } from "vuex";
import { useQuery } from "@tanstack/vue-query";
import { debounce } from "lodash-es";
import { resolvedSchedulePreviewQuery } from "@/services/oncall.queries";
import type { ResolvedSegment, Rotation } from "@/ts/interfaces/oncall";
import type { I18nText } from "@/types/i18n";
import { raw, useI18nTyped } from "@/types/i18n";
import { isShiftRuleValid, zonedMidnight } from "@/utils/oncall";

export const PREVIEW_DAYS = 7;
// A page fetches a week past what it draws, so stop choices and "next up" reach the next weekly turn.
const FETCH_DAYS = 14;
const PREVIEW_DEBOUNCE_MS = 400;

/** The drawer's one preview of a draft rotation, as the server resolves it, paged by 7 team-local days. */
export function useRotationPreview(options: {
  /** The draft being edited; null while the drawer is closed, which makes no request. */
  rotation: () => Rotation | null;
  teamId: () => string;
  timezone: () => string;
  nowMicros: () => number;
}) {
  const { t } = useI18nTyped();
  const store = useStore();
  const orgId = computed<string>(() => store.state.selectedOrganization.identifier);

  // A plain copy, so the query key is the draft as it stood rather than a live proxy.
  const snapshot = (): Rotation | null => {
    const rotation = options.rotation();
    return rotation ? JSON.parse(JSON.stringify(rotation)) : null;
  };
  const draft = ref<Rotation | null>(snapshot());
  const settle = debounce(() => {
    draft.value = snapshot();
  }, PREVIEW_DEBOUNCE_MS);
  const page = ref(0);
  // Opening a rotation shows it at once and from today; only edits wait for typing to stop.
  watch(options.rotation, (now, before) => {
    if (now === before) return;
    settle.cancel();
    draft.value = snapshot();
    page.value = 0;
  });
  // An edit is judged against the present, so the picture goes back to the first page.
  watch(
    options.rotation,
    () => {
      page.value = 0;
      settle();
    },
    { deep: true },
  );
  onBeforeUnmount(() => settle.cancel());

  const windowAt = (offset: number) => ({
    from: zonedMidnight(options.nowMicros(), options.timezone(), offset * PREVIEW_DAYS),
    to: zonedMidnight(options.nowMicros(), options.timezone(), offset * PREVIEW_DAYS + FETCH_DAYS),
  });
  const windowFrom = computed(() => windowAt(page.value).from);
  const windowTo = computed(() => windowAt(page.value).to);

  // Nobody to put on call yet: there is nothing to ask the server.
  const hasValidRule = computed(() => !!draft.value?.shift_rules.some(isShiftRuleValid));

  const previewOf = (window: () => { from: number; to: number }) =>
    useQuery(() =>
      Object.assign(
        resolvedSchedulePreviewQuery(
          orgId.value,
          options.teamId(),
          draft.value as Rotation,
          window().from,
          window().to,
        ),
        {
          enabled: !!orgId.value && !!options.teamId() && hasValidRule.value,
          // Keep the last answer while the next loads, but never another rotation's.
          placeholderData: (previous: ResolvedSegment[] | undefined, previousQuery: any) =>
            (previousQuery?.queryKey.at(-1) as Rotation | undefined)?.id === draft.value?.id
              ? previous
              : undefined,
        },
      ),
    );

  const shown = previewOf(() => windowAt(page.value));
  // Who holds a turn now is a fact about the first page; on page 0 it is the same cached query.
  const current = previewOf(() => windowAt(0));

  const segments = computed<ResolvedSegment[]>(() =>
    hasValidRule.value ? (shown.data.value ?? []) : [],
  );
  const currentSegments = computed<ResolvedSegment[]>(() =>
    hasValidRule.value ? (current.data.value ?? []) : [],
  );
  const currentWindowTo = computed(() => windowAt(0).to);

  const error = computed<I18nText | null>(() => {
    const err: any = shown.error.value;
    if (!err || !hasValidRule.value) return null;
    const message = err?.response?.data?.message;
    return message ? raw(String(message)) : t("oncall.upcomingPreviewFailed");
  });

  return {
    page,
    windowFrom,
    windowTo,
    hasValidRule,
    segments,
    currentSegments,
    currentWindowTo,
    error,
    loaded: shown.isSuccess,
  };
}

export type RotationPreview = ReturnType<typeof useRotationPreview>;
