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
  <div
    class="tw:rounded-lg tw:border tw:border-[var(--o2-border-color)] tw:bg-[var(--o2-card-bg)] tw:p-[0.75rem] tw:mb-[0.5rem] tw:cursor-pointer tw:transition-[box-shadow] tw:duration-150 hover:tw:shadow-md"
    :data-test="`pattern-card-${index}`"
    tabindex="0"
    role="button"
    @click="$emit('click', pattern, index)"
    @contextmenu.prevent="$emit('contextmenu', pattern, $event)"
    @keydown.up.prevent="$emit('keynav', 'up', index)"
    @keydown.down.prevent="$emit('keynav', 'down', index)"
    @keydown.enter.prevent="$emit('click', pattern, index)"
    @keydown.escape.prevent="$emit('keynav', 'escape', index)"
  >
    <!-- Top row: Template (hero) + anomaly badge -->
    <div class="tw:flex tw:items-start tw:gap-[0.5rem] tw:mb-[0.5rem]">
      <div
        class="pattern-template-text tw:flex tw:items-baseline tw:gap-x-[2px] tw:gap-y-[1px] tw:flex-1 tw:min-w-0"
        :class="[
          store.state.theme === 'dark' ? 'text-grey-4' : 'text-grey-8',
          wrap
            ? 'tw:flex-wrap tw:break-all'
            : 'tw:flex-nowrap tw:overflow-hidden',
        ]"
        :data-test="`pattern-card-${index}-template`"
      >
        <template v-for="(tok, i) in templateTokens" :key="i">
          <span
            v-if="tok.kind === 'text'"
            :class="wrap ? 'tw:whitespace-pre-wrap tw:break-all' : 'tw:whitespace-pre'"
          >{{ tok.value }}</span>
          <span
            v-else
            class="tw:inline-flex"
            @mouseenter="onMouseEnter(tok.value, tok.sampleValues, $event)"
            @mouseleave="onMouseLeave"
          >
            <q-chip
              dense
              size="xs"
              class="wildcard-chip q-my-none q-mx-none"
              :class="wildcardChipColor(tok.value)"
            >
              {{ tok.value }}
            </q-chip>
          </span>
        </template>
      </div>

      <!-- Anomaly badge -->
      <span
        v-if="pattern.is_anomaly"
        class="tw:inline-flex tw:items-center tw:gap-[0.125rem] tw:rounded-full tw:px-[0.5rem] tw:py-[0.125rem] tw:text-[0.6875rem] tw:font-bold tw:cursor-help tw:flex-shrink-0 tw:bg-[var(--o2-anomaly-bg,#fef2f2)] tw:text-[var(--o2-anomaly-color,#ef4444)] tw:border tw:border-[var(--o2-anomaly-border,#fecaca)]"
        :data-test="`pattern-card-${index}-anomaly-badge`"
      >
        <q-icon name="warning" size="0.6875rem" />
        {{ t("search.anomalyLabel") }}
        <q-tooltip anchor="bottom middle" self="top middle" class="anomaly-tooltip">
          <div class="tw:text-xs tw:max-w-[22rem]">{{ anomalyExplanationText }}</div>
        </q-tooltip>
      </span>
    </div>

    <!-- Example log preview -->
    <div
      v-if="previewLog"
      class="tw:mb-[0.5rem] tw:text-[0.75rem] tw:text-[var(--o2-text-secondary)]"
      :data-test="`pattern-card-${index}-value-preview`"
    >
      <span class="tw:opacity-60">{{ t("search.patternExample") }}:</span>
      <span class="tw:font-mono tw:ml-[0.25rem] tw:line-clamp-2 tw:break-all">{{ previewLog }}</span>
    </div>

    <!-- Frequency bar -->
    <PatternFrequencyBar
      :percentage="pattern.percentage"
      :isAnomaly="pattern.is_anomaly"
      :dataTestSuffix="`${index}`"
    />

    <!-- Stats row: occurrence + percentage badges -->
    <div class="tw:flex tw:items-center tw:gap-[0.5rem] tw:mt-[0.5rem] tw:mb-[0.625rem]">
      <span
        class="tw:text-xs tw:font-semibold tw:text-[var(--o2-text-primary)]"
        :data-test="`pattern-card-${index}-frequency`"
      >
        {{ pattern.frequency.toLocaleString() }}
        {{ t("search.occurrenceColumnHeader").toLowerCase() }}
      </span>
      <span
        class="tw:text-xs tw:font-semibold tw:text-[var(--o2-primary-color)] tw:bg-[var(--o2-primary-bg-light)] tw:rounded-full tw:px-[0.5rem] tw:py-[0.063rem]"
        :data-test="`pattern-card-${index}-percentage`"
      >
        {{ pattern.percentage.toFixed(2) }}%
      </span>
    </div>

    <!-- Action buttons row -->
    <div
      class="tw:flex tw:items-center tw:gap-[0.375rem] tw:flex-wrap"
      :class="wrap ? 'tw:pt-1' : ''"
    >
      <OButton
        variant="ghost-primary"
        size="sm"
        @click.stop="$emit('include', pattern)"
        :title="t('search.patternFilterIn')"
        :data-test="`pattern-card-${index}-include-btn`"
      >
        <template #icon-left>
          <q-icon style="height: 0.625rem; width: 0.625rem">
            <EqualIcon />
          </q-icon>
        </template>
        {{ t("search.patternFilterIn") }}
      </OButton>
      <OButton
        variant="ghost-primary"
        size="sm"
        @click.stop="$emit('exclude', pattern)"
        :title="t('search.patternFilterOut')"
        :data-test="`pattern-card-${index}-exclude-btn`"
      >
        <template #icon-left>
          <q-icon style="height: 0.625rem; width: 0.625rem">
            <NotEqualIcon />
          </q-icon>
        </template>
        {{ t("search.patternFilterOut") }}
      </OButton>
      <OButton
        variant="ghost-primary"
        size="sm"
        @click.stop="$emit('create-alert', pattern)"
        :data-test="`pattern-card-${index}-create-alert-btn`"
      >
        <template #icon-left>
          <q-icon name="notifications" size="0.8125rem" />
        </template>
        {{ t("search.patternAlert") }}
      </OButton>
      <div class="tw:flex-1" />
      <OButton
        variant="ghost"
        size="icon"
        @click.stop="handleCopySql"
        :title="t('search.patternCopySql')"
        :data-test="`pattern-card-${index}-copy-sql-btn`"
      >
        <q-icon name="content_copy" size="0.8125rem" />
      </OButton>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import { useQuasar } from "quasar";
import EqualIcon from "@/components/icons/EqualIcon.vue";
import NotEqualIcon from "@/components/icons/NotEqualIcon.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import PatternFrequencyBar from "./PatternFrequencyBar.vue";
import { buildPatternSqlQuery } from "./patternUtils";
import {
  tokenizeTemplate,
  wildcardChipColor,
  anomalyExplanation,
} from "@/composables/useLogs/useTemplateTokenizer";
import useWildcardHover from "./useWildcardHover";

const props = defineProps<{
  pattern: any;
  index: number;
  wrap?: boolean;
}>();

defineEmits<{
  (e: "click", pattern: any, index: number): void;
  (e: "include", pattern: any): void;
  (e: "exclude", pattern: any): void;
  (e: "create-alert", pattern: any): void;
  (e: "copy-sql", pattern: any): void;
  (e: "contextmenu", pattern: any, event: MouseEvent): void;
  (e: "keynav", direction: string, index: number): void;
}>();

const store = useStore();
const { t } = useI18n();
const $q = useQuasar();
const { onMouseEnter, onMouseLeave } = useWildcardHover();

const templateTokens = computed(() =>
  tokenizeTemplate(props.pattern.template ?? "", props.pattern.wildcard_values ?? []),
);

const anomalyExplanationText = computed(() => anomalyExplanation(props.pattern, t));

const previewLog = computed(() => {
  const examples = props.pattern?.examples;
  if (!examples || examples.length === 0) return "";
  const first = examples[0];
  return first?.log_message || first?.log || "";
});

const streamName = computed(() => {
  return store.state.zoConfig?.selectedStream?.[0] || props.pattern.stream_name || "";
});

const handleCopySql = () => {
  try {
    const sql = buildPatternSqlQuery(props.pattern.template, streamName.value);
    navigator.clipboard.writeText(sql);
    $q.notify({
      type: "positive",
      message: t("search.patternSqlCopied"),
      timeout: 2000,
    });
     
  } catch (_e) {
    $q.notify({
      type: "negative",
      message: t("search.patternSqlCopyFailed"),
      timeout: 2000,
    });
  }
};
</script>

<style scoped lang="scss">
.pattern-template-text {
  font-family: monospace;
  font-size: 0.8125rem;
}
</style>

<style lang="scss">
@import "@/assets/styles/log-highlighting.css";

.wildcard-chip {
  font-family: monospace;
  font-size: 0.625rem;
  height: 1rem;
  padding: 0 0.25rem;
  border-radius: 0.1875rem;
  line-height: 1rem;
  flex-shrink: 0;
}
</style>
