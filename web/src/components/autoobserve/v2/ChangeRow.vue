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
  <article
    class="relative flex gap-3 transition-shadow duration-700 sm:gap-4"
    :data-test="`autoobserve2-change-${entry.id}`"
  >
    <span
      class="bg-surface-base relative z-10 mt-1 flex size-9 shrink-0 items-center justify-center rounded-full bg-linear-to-br ring-1 transition-colors duration-700 sm:size-10"
      :class="look.badge"
      aria-hidden="true"
    >
      <OIcon :name="look.icon" size="sm" />
    </span>
    <div
      class="bg-surface-base border-border-subtle rounded-surface relative flex min-w-0 flex-1 flex-col gap-1 overflow-hidden border px-4 py-3.5 shadow-xs transition duration-200 hover:-translate-y-px hover:shadow-md motion-reduce:transition-none motion-reduce:hover:translate-y-0 sm:px-5"
      :class="{ 'ring-accent ring-2': flash }"
    >
      <span class="absolute inset-y-0 start-0 w-1" :class="look.accent" aria-hidden="true" />
      <div class="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
        <h3
          class="text-text-heading min-w-0 text-base leading-snug font-semibold text-pretty"
          :data-test="`autoobserve2-change-${entry.id}-headline`"
        >
          {{ headline }}
        </h3>
        <span class="flex shrink-0 items-center gap-2.5">
          <span v-if="when" class="text-text-secondary text-xs tabular-nums">{{ when }}</span>
          <OTag
            :variant="STATE_LOOK[change.state].variant"
            :icon="STATE_LOOK[change.state].icon"
            size="sm"
            :label="stateLabel"
            :data-test="`autoobserve2-change-${entry.id}-status`"
          />
        </span>
      </div>
      <p class="text-text-secondary max-w-[65ch] text-sm leading-relaxed text-pretty">
        {{ t(entryKey("why")) }}
      </p>
      <p
        class="bg-surface-subtle border-border-subtle rounded-default mt-1 inline-flex max-w-full flex-wrap items-center gap-x-1.5 self-start border px-2 py-0.5 text-xs leading-5"
        :data-test="`autoobserve2-change-${entry.id}-shift`"
      >
        <span class="text-text-secondary line-through">{{ t(entryKey("from")) }}</span>
        <OIcon name="arrow-forward" size="xs" class="text-text-muted" aria-hidden="true" />
        <span class="text-text-heading font-semibold">{{ t(entryKey("to")) }}</span>
        <span class="text-text-secondary">· {{ t(entryKey("on")) }}</span>
      </p>
      <div class="-ms-2 mt-1.5 flex flex-wrap items-center gap-x-1 gap-y-2">
        <OButton
          variant="ghost-muted"
          size="xs"
          :icon-right="open ? 'expand-less' : 'expand-more'"
          :aria-expanded="open"
          :aria-controls="detailsId"
          :data-test="`autoobserve2-change-${entry.id}-details-toggle`"
          @click="emit('update:open', !open)"
        >
          {{
            open
              ? t("autoobserve2.activityPage.actions.hideDetails")
              : t("autoobserve2.activityPage.actions.showDetails")
          }}
        </OButton>
        <OButton
          v-if="canUndo(change)"
          variant="ghost-muted"
          size="xs"
          icon-left="undo"
          :data-test="`autoobserve2-change-${entry.id}-undo`"
          @click="emit('undo')"
        >
          {{ t("autoobserve2.activityPage.actions.undo") }}
        </OButton>
      </div>
      <div
        v-if="open"
        :id="detailsId"
        class="bg-surface-subtle rounded-default mt-2.5 flex flex-col gap-4 p-4"
        :data-test="`autoobserve2-change-${entry.id}-details`"
      >
        <dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
          <dt class="text-text-secondary">{{ t("autoobserve2.activityPage.details.name") }}</dt>
          <dd class="min-w-0">
            <OText variant="mono" class="text-text-heading break-all">{{
              entry.actionClass
            }}</OText>
          </dd>
          <dt class="text-text-secondary">{{ t("autoobserve2.activityPage.details.target") }}</dt>
          <dd class="text-text-body min-w-0 break-words">{{ entry.target }}</dd>
          <dt class="text-text-secondary">
            {{ t("autoobserve2.activityPage.details.confidence") }}
          </dt>
          <dd class="text-text-body">
            {{ t(CONFIDENCE_LABEL[entry.confidence]) }}
            <span class="text-text-secondary text-xs">
              · {{ t("autoobserve.confidence.uncalibrated") }}</span
            >
          </dd>
        </dl>
        <div class="flex flex-col gap-1">
          <span class="text-text-label text-xs font-medium">{{
            t("autoobserve2.activityPage.details.saw")
          }}</span>
          <p class="text-text-body text-sm leading-relaxed text-pretty">{{ entry.evidence }}</p>
        </div>
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <OCodeBlock
            class="min-w-0"
            :code="entry.before"
            :lang="codeLang(entry.before)"
            chrome="editor"
            :filename="t('autoobserve.activity.before')"
            wrap
            :copyable="false"
            :data-test="`autoobserve2-change-${entry.id}-before`"
          />
          <OCodeBlock
            class="min-w-0"
            :code="entry.after"
            :lang="codeLang(entry.after)"
            chrome="editor"
            :filename="t('autoobserve.activity.after')"
            wrap
            :copyable="false"
            :data-test="`autoobserve2-change-${entry.id}-after`"
          />
        </div>
        <ul v-if="notes.length" class="flex flex-col gap-1.5">
          <li
            v-for="(note, i) in notes"
            :key="i"
            class="text-text-secondary flex items-start gap-2 text-xs leading-relaxed"
          >
            <OIcon name="info-outline" size="xs" class="mt-0.5 shrink-0" />
            <span>{{ note }}</span>
          </li>
        </ul>
      </div>
    </div>
  </article>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { raw, useI18nTyped, type I18nKey, type I18nText } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OCodeBlock from "@/lib/core/Code/OCodeBlock.vue";
import { CONFIDENCE_LABEL } from "../fixtures";
import { KIND_LOOK, STATE_LOOK, canUndo, recurringBug, type Change } from "./changes";

const props = defineProps<{
  change: Change;
  open: boolean;
  flash?: boolean;
  when?: I18nText;
}>();

const emit = defineEmits<{
  "update:open": [open: boolean];
  undo: [];
}>();

const { t } = useI18nTyped();

const entry = computed(() => props.change.entry);
const look = computed(() => KIND_LOOK[props.change.kind]);
const detailsId = computed(() => `autoobserve2-change-details-${entry.value.id}`);

const entryKey = (part: string) =>
  `autoobserve2.activityPage.entries.${entry.value.id}.${part}` as I18nKey;

const headline = computed(() => t(entryKey("done")));

const stateLabel = computed(() =>
  props.change.state === "review" && props.change.reviewDays
    ? t(
        "autoobserve2.activityPage.status.reviewDays",
        { count: props.change.reviewDays },
        props.change.reviewDays,
      )
    : t(STATE_LOOK[props.change.state].key),
);

const codeLang = (code: string) => (code.startsWith("WHERE") ? "sql" : "yaml");

const notes = computed(() => {
  const e = entry.value;
  const bug = recurringBug(e.actionClass);
  return [
    e.note,
    e.status === "auto_applied" && e.reviewWindow
      ? t("autoobserve.activity.reviewWindow", { window: raw(e.reviewWindow) })
      : undefined,
    e.actionClass === "ReviewForDeletion" ? t("autoobserve.activity.neverAutoRetire") : undefined,
    e.userBuilt ? t("autoobserve.activity.neverSilent") : undefined,
    bug ? t("autoobserve2.activityPage.details.recurring", { bug: raw(bug) }) : undefined,
    e.decided ? t("autoobserve2.activityPage.details.undoDecided") : undefined,
  ].filter((n): n is I18nText => !!n);
});
</script>
