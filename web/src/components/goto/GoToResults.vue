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

<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";

import { assistantGlyph } from "@/components/ai-assistant/common/glyphs";
import { goToGroupOf, goToOptionId, type GoToGroup } from "@/composables/goto/useGoToIndex";
import type { GoToMatch } from "@/composables/goto/types";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.types";
import OText from "@/lib/core/Typography/OText.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import { useI18nTyped, type I18nKey } from "@/types/i18n";

const props = withDefaults(
  defineProps<{
    matches: GoToMatch[];
    /** The typed text; the empty state shows only once something is typed. */
    query: string;
    listboxId: string;
    dataTest?: string;
  }>(),
  { dataTest: "go-to-results" },
);
const emit = defineEmits<{
  (_e: "select", _match: GoToMatch): void;
  (_e: "close"): void;
}>();
/** Index of the highlighted row; -1 is none, so Enter asks. */
const active = defineModel<number>("active", { default: -1 });

const { t } = useI18nTyped();

const GROUP_LABEL: Record<GoToGroup, I18nKey> = {
  pages: "overview.goTo.group.pages",
  alertFolders: "overview.goTo.group.alertFolders",
  alerts: "overview.goTo.group.alerts",
  dashboards: "overview.goTo.group.dashboards",
};

const KIND_ICON: Record<GoToMatch["kind"], IconName> = {
  page: "arrow-forward",
  alert_folder: "folder",
  alert: "notifications",
  dashboard_folder: "folder",
  dashboard: "dashboard",
  more: "search",
  ask: assistantGlyph.assistant,
};

const rows = computed(() =>
  props.matches.map((match, index, all) => {
    const group = goToGroupOf(match);
    const header = group !== null && (index === 0 || goToGroupOf(all[index - 1]) !== group);
    return { match, index, group, header };
  }),
);

const empty = computed(
  () => props.query.trim() !== "" && !props.matches.some((match) => match.kind !== "ask"),
);

const activeDescendant = computed(() =>
  active.value >= 0 && active.value < props.matches.length
    ? goToOptionId(props.listboxId, active.value)
    : undefined,
);

/** Id of the row the user arrowed onto; null until they arrow, so late matches cannot move it. */
const arrowedId = ref<string | null>(null);

function defaultActive(): number {
  const exact = props.matches.findIndex((match) => match.exact);
  const asks = props.matches.some((match) => match.kind === "ask");
  return exact >= 0 ? exact : !asks && props.matches.length > 0 ? 0 : -1;
}

let lastQuery = props.query;

// Keyed on exactness too, as "log" to "logs" keeps the IDs.
watch(
  () =>
    [props.query, ...props.matches.map((match) => `${match.id}:${match.exact ? 1 : 0}`)].join("\n"),
  () => {
    if (props.query !== lastQuery) arrowedId.value = null;
    lastQuery = props.query;
    const kept =
      arrowedId.value === null
        ? -1
        : props.matches.findIndex((match) => match.id === arrowedId.value);
    if (kept < 0) arrowedId.value = null;
    active.value = kept >= 0 ? kept : defaultActive();
  },
  { immediate: true },
);

function move(step: 1 | -1): void {
  const count = props.matches.length;
  if (count === 0) return;
  if (active.value < 0) active.value = step === 1 ? 0 : count - 1;
  else active.value = (active.value + step + count) % count;
  arrowedId.value = props.matches[active.value].id;
  const optionId = goToOptionId(props.listboxId, active.value);
  void nextTick(() => document.getElementById(optionId)?.scrollIntoView?.({ block: "nearest" }));
}

function enter(): boolean {
  const target =
    active.value >= 0
      ? props.matches[active.value]
      : props.matches.find((match) => match.kind === "ask");
  if (!target) return false;
  emit("select", target);
  return true;
}

/** The host input forwards its keydown here; true when the key was handled. */
function onKeydown(event: KeyboardEvent): boolean {
  if (event.isComposing) return false;
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    move(event.key === "ArrowDown" ? 1 : -1);
    return true;
  }
  if (event.key === "Enter") {
    if (!enter()) return false;
    event.preventDefault();
    return true;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    emit("close");
    return true;
  }
  return false;
}

defineExpose({ onKeydown, activeDescendant });
</script>

<template>
  <div
    :id="listboxId"
    role="listbox"
    :aria-label="t('overview.goTo.heading')"
    class="flex flex-col"
    :data-test="dataTest"
  >
    <OText v-if="empty" as="div" variant="meta" class="px-2 py-3" :data-test="`${dataTest}-empty`">
      {{ t("overview.goTo.empty") }}
    </OText>
    <template v-for="row in rows" :key="row.match.id">
      <OText
        v-if="row.header && row.group"
        as="div"
        role="presentation"
        variant="label"
        class="text-text-secondary px-2 pt-2 pb-1"
        :data-test="`${dataTest}-group-${row.group}`"
      >
        {{ t(GROUP_LABEL[row.group]) }}
      </OText>
      <div
        :id="goToOptionId(listboxId, row.index)"
        role="option"
        :aria-selected="row.index === active"
        class="rounded-default flex cursor-pointer items-center gap-2 px-2 py-1.5 text-sm"
        :class="[
          row.index === active ? 'bg-select-item-selected-bg' : 'hover:bg-dropdown-item-hover-bg',
          row.match.kind === 'ask' ? 'border-border-default mt-1 border-t' : '',
        ]"
        :data-test="`${dataTest}-option-${row.index}`"
        :data-kind="row.match.kind"
        @mousedown.prevent
        @click="emit('select', row.match)"
      >
        <OIcon :name="KIND_ICON[row.match.kind]" size="sm" class="text-text-secondary shrink-0" />
        <OTruncatedText class="text-text-heading min-w-0 flex-1">{{
          row.match.label
        }}</OTruncatedText>
        <span v-if="row.match.secondary" class="text-text-secondary shrink-0 text-xs">{{
          row.match.secondary
        }}</span>
      </div>
    </template>
  </div>
</template>
