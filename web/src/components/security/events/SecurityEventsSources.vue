<!-- Copyright 2026 OpenObserve Inc.
SPDX-License-Identifier: AGPL-3.0-or-later -->

<script setup lang="ts">
import { computed, ref } from "vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import type { SourceHealth } from "@/services/securitySources";
import { formatCompactCount } from "@/utils/formatters";

interface SourceEntry {
  name: string;
  reason?: string | null;
  verdict?: { label: string; confidence: number } | null;
  /** The server's read of whether the source is still reporting. */
  health?: SourceHealth;
}

const props = defineProps<{
  names: string[];
  selected: string | null;
  streamStats: Map<string, any>;
  sourceByName: Map<string, SourceEntry>;
  suggestions: SourceEntry[];
  classifying: boolean;
  otherNames: string[];
  canInclude: boolean;
  canExclude: boolean;
}>();
const emit = defineEmits<{
  select: [name: string];
  remove: [name: string];
  add: [name: string];
  dismiss: [name: string];
}>();
const { t } = useI18nTyped();

const SUGGESTIONS_SHOWN = 5;
const showAll = ref(false);
const visibleSuggestions = computed(() =>
  showAll.value ? props.suggestions : props.suggestions.slice(0, SUGGESTIONS_SHOWN),
);
const addOptions = computed(() => props.otherNames.map((n) => ({ label: raw(n), value: n })));

const healthOf = (name: string): SourceHealth => props.sourceByName.get(name)?.health ?? "never";

const HEALTH_DOT: Record<SourceHealth, string> = {
  live: "bg-status-positive",
  quiet: "bg-badge-amber-solid-bg",
  never: "bg-border-default",
};

function sourceHint(name: string): I18nText | undefined {
  const entry = props.sourceByName.get(name);
  if (entry?.reason === "auto" && entry.verdict) {
    const n = Math.round(entry.verdict.confidence * 100);
    return t("siem.events.autoSource", { label: entry.verdict.label, n });
  }
  return undefined;
}

function onAdd(name: unknown) {
  const n = String(name ?? "");
  if (n) emit("add", n);
}
</script>

<template>
  <div class="border-border-default flex flex-col gap-1 border-b pt-2 pb-2">
    <div
      class="px-page-edge text-text-secondary text-2xs flex items-center justify-between font-semibold tracking-wide uppercase"
    >
      <span>{{ t("siem.events.sources") }}</span>
      <span class="tabular-nums">{{ names.length }}</span>
    </div>
    <ul class="flex max-h-48 flex-col overflow-y-auto">
      <li
        v-for="name in names"
        :key="name"
        class="group px-page-edge hover:bg-surface-subtle flex cursor-pointer items-center gap-2 py-1"
        :class="{ 'bg-surface-subtle': selected === name }"
        role="button"
        tabindex="0"
        :data-test="`security-events-source-${name}`"
        @click="emit('select', name)"
        @keydown.enter="emit('select', name)"
        @keydown.space.prevent="emit('select', name)"
      >
        <span class="size-2 shrink-0 rounded-full" :class="HEALTH_DOT[healthOf(name)]">
          <OTooltip :content="t(`siem.health.${healthOf(name)}`)" />
        </span>
        <span
          class="min-w-0 flex-1 truncate font-mono text-xs"
          :class="selected === name ? 'text-text-heading font-semibold' : 'text-text-heading'"
          >{{ name }}<OTooltip v-if="sourceHint(name)" :content="sourceHint(name)"
        /></span>
        <OTag
          v-if="sourceByName.get(name)?.reason === 'auto'"
          variant="primary-soft"
          size="xs"
          :data-test="`security-events-source-auto-${name}`"
          >{{ t("siem.events.autoTag") }}</OTag
        >
        <span class="text-text-secondary text-2xs tabular-nums">{{
          formatCompactCount(Number(streamStats.get(name)?.doc_num ?? 0))
        }}</span>
        <OButton
          v-if="canExclude"
          :data-test="`security-events-source-remove-${name}`"
          variant="ghost"
          size="icon-xs"
          icon-left="remove"
          class="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
          @click.stop="emit('remove', name)"
        >
          <OTooltip :content="t('siem.events.removeSource')" />
        </OButton>
      </li>
    </ul>
    <div
      v-if="suggestions.length || classifying"
      class="flex flex-col gap-0.5"
      data-test="security-events-suggested"
    >
      <div
        class="px-page-edge text-text-secondary text-2xs flex items-center gap-1.5 pt-1 font-semibold tracking-wide uppercase"
      >
        <span>{{ t("siem.events.suggested") }}</span>
        <OSpinner v-if="classifying" size="xs">
          <OTooltip :content="t('siem.events.classifying')" />
        </OSpinner>
      </div>
      <div
        v-for="entry in visibleSuggestions"
        :key="entry.name"
        class="px-page-edge flex items-center gap-1 py-0.5"
        :data-test="`security-events-suggested-${entry.name}`"
      >
        <span class="text-text-secondary min-w-0 flex-1 truncate font-mono text-xs"
          >{{ entry.name
          }}<OTooltip
            v-if="entry.verdict"
            :content="
              t('siem.events.suggestedSource', {
                label: entry.verdict.label,
                n: Math.round(entry.verdict.confidence * 100),
              })
            "
        /></span>
        <OButton
          v-if="canInclude"
          variant="ghost"
          size="icon-xs"
          icon-left="add"
          :data-test="`security-events-suggested-add-${entry.name}`"
          @click="emit('add', entry.name)"
        >
          <OTooltip :content="t('siem.events.addSuggested')" />
        </OButton>
        <OButton
          variant="ghost"
          size="icon-xs"
          icon-left="close"
          :data-test="`security-events-suggested-dismiss-${entry.name}`"
          @click="emit('dismiss', entry.name)"
        >
          <OTooltip :content="t('siem.events.dismissSuggestion')" />
        </OButton>
      </div>
      <div v-if="suggestions.length > SUGGESTIONS_SHOWN" class="px-page-edge">
        <OButton
          variant="ghost"
          size="xs"
          data-test="security-events-suggested-more"
          @click="showAll = !showAll"
        >
          {{
            showAll
              ? t("siem.events.showFewer")
              : t("siem.events.showMore", { n: suggestions.length - SUGGESTIONS_SHOWN })
          }}
        </OButton>
      </div>
    </div>
    <div v-if="canInclude" class="px-page-edge">
      <OSelect
        :aria-label="t('siem.aria.addSource')"
        :model-value="null"
        :options="addOptions"
        :placeholder="t('siem.events.addSource')"
        searchable
        size="sm"
        data-test="security-events-add-source"
        @update:model-value="onAdd"
      />
    </div>
  </div>
</template>
