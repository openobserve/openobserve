<!-- Copyright 2026 OpenObserve Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
-->

<template>
  <div class="flex min-w-0 flex-col gap-1.5">
    <div
      data-test="date-time-range-summary"
      class="flex h-7 min-w-0 flex-nowrap items-center gap-x-1.5 overflow-hidden text-xs"
      :data-mode="view.mode"
    >
      <span v-if="view.lead" class="text-text-secondary shrink-0 whitespace-nowrap">{{
        view.lead
      }}</span>
      <span
        data-test="date-time-range-summary-range"
        class="shrink-0 font-semibold whitespace-nowrap tabular-nums"
        :class="view.range ? 'text-text-heading' : 'text-text-secondary'"
        >{{ view.range || t("common.rangeNoneSelected") }}</span
      >
      <template v-if="view.duration">
        <span class="text-text-secondary shrink-0 max-sm:hidden" aria-hidden="true">·</span>
        <span
          data-test="date-time-range-duration"
          class="text-text-secondary shrink-0 whitespace-nowrap max-sm:hidden"
          >{{ view.duration }}</span
        >
      </template>
      <template v-if="view.kind">
        <span class="text-text-secondary shrink-0" aria-hidden="true">·</span>
        <span
          data-test="date-time-range-kind"
          class="text-text-secondary shrink-0 whitespace-nowrap"
          >{{ view.kind
          }}<OTooltip v-if="view.kindTooltip" :content="view.kindTooltip" side="bottom"
        /></span>
      </template>
      <template v-if="$slots.zone">
        <span class="text-text-secondary shrink-0" aria-hidden="true">·</span>
        <div
          data-test="date-time-range-tz"
          class="flex min-w-0 shrink items-center overflow-hidden"
        >
          <slot name="zone" />
        </div>
      </template>
      <div class="ms-auto flex shrink-0 items-center ps-2">
        <OBadge
          v-if="view.endSlot === 'badge'"
          data-test="date-time-range-draft"
          variant="primary-outline"
          size="sm"
          >{{ t("common.rangeNotApplied") }}</OBadge
        >
        <OButton
          v-else-if="view.endSlot === 'freeze'"
          data-test="date-time-range-freeze"
          variant="ghost-primary"
          size="xs"
          @click="emit('freeze')"
          >{{ t("common.rangeUseTheseDates") }}</OButton
        >
        <OTooltip
          v-else-if="view.endSlot === 'zoom'"
          :content="zoomDisabled ? t('common.rangeZoomOutCapped') : t('common.rangeZoomOut')"
        >
          <OButton
            data-test="date-time-zoom-out-btn"
            variant="ghost"
            size="xs"
            icon-left="zoom-out"
            :aria-label="t('common.rangeZoomOut')"
            :disabled="zoomDisabled"
            focusable-unavailable
            @click="emit('zoom-out')"
            ><span class="max-sm:hidden">{{ t("common.rangeZoomOut") }}</span></OButton
          >
        </OTooltip>
      </div>
    </div>

    <div
      v-if="note"
      :id="noteId"
      data-test="date-time-range-note"
      class="rounded-default flex items-start gap-1.5 px-2 py-1.5 text-xs"
      :class="noteClass"
      :data-kind="note.kind"
      :data-reason="note.reason"
      :role="note.kind === 'error' ? 'alert' : 'status'"
    >
      <OIcon :name="noteIcon" size="xs" class="mt-0.5 shrink-0" aria-hidden="true" />
      <span
        class="min-w-0 flex-1"
        :data-test="note.kind === 'error' && note.input ? 'date-time-range-input-error' : undefined"
        >{{ note.text }}</span
      >
      <OButton
        v-for="action in note.actions ?? []"
        :key="action.id"
        :data-test="action.dataTest"
        variant="ghost-primary"
        size="xs"
        class="shrink-0"
        :icon-left="action.id === 'undo' ? 'undo' : undefined"
        @click="emit('note-action', action.id)"
        >{{ action.label }}</OButton
      >
    </div>

    <span class="sr-only" aria-live="polite" data-test="date-time-range-live">{{ liveText }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { useI18nTyped, type I18nText } from "@/types/i18n";

/** What the line shows, in fixed slots: lead, range, duration, kind, then one end control. */
export interface ResolvedLineView {
  mode: "applied" | "read-as" | "preview" | "instant" | "runs";
  lead?: I18nText;
  range: string;
  duration: string;
  kind: I18nText | "";
  kindTooltip?: I18nText;
  endSlot: "zoom" | "badge" | "freeze" | null;
}

/** A button the note offers: Undo, Swap, the next valid time, or a suggested rewrite. */
export interface ResolvedLineAction {
  id: "undo" | "swap" | "dst-next" | "suggestion";
  label: I18nText;
  dataTest: string;
}

/** The one note under the line. */
export interface ResolvedLineNote {
  kind: "info" | "warn" | "error";
  text: I18nText;
  reason?: string;
  /** The error is about the field's text, not the Start/End fields. */
  input?: boolean;
  actions?: ResolvedLineAction[];
}

const props = withDefaults(
  defineProps<{
    view: ResolvedLineView;
    note?: ResolvedLineNote | null;
    noteId?: string;
    zoomDisabled?: boolean;
    /** Announced politely; the picker sets it only on a commit or an error. */
    liveText?: string;
  }>(),
  { note: null, noteId: undefined, zoomDisabled: false, liveText: "" },
);

const emit = defineEmits<{
  "zoom-out": [];
  freeze: [];
  "note-action": [id: ResolvedLineAction["id"]];
}>();

const { t } = useI18nTyped();

const noteClass = computed(() => {
  if (props.note?.kind === "error") return "text-input-error-text bg-surface-tint-error";
  if (props.note?.kind === "warn") return "text-status-warning-text bg-status-warning-bg";
  return "text-text-secondary bg-surface-panel";
});

const noteIcon = computed(() => {
  if (props.note?.kind === "error") return "error";
  if (props.note?.kind === "warn") return "warning";
  return "info";
});
</script>
