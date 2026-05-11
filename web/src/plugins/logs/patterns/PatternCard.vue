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
    class="tw:flex tw:border-b tw:cursor-pointer hover:tw:bg-[var(--o2-hover-gray)] table-row-hover tw:relative"
    :class="wrap ? 'tw:items-start' : 'tw:items-center'"
    @click="$emit('click', pattern, index)"
    :data-test="`pattern-card-${index}`"
  >
    <!-- Status level left border -->
    <div
      class="tw:absolute tw:left-0 tw:inset-y-0 tw:w-1 tw:z-10"
      :style="{ backgroundColor: statusColor }"
    />
    <!-- Pattern Column -->
    <div class="tw:flex-1 tw:min-w-0 tw:overflow-hidden tw:px-2">
      <!-- Template rendered as tokenized chips so wildcards are visually distinct -->
      <div
        class="pattern-template-text tw:flex tw:items-baseline tw:gap-x-[2px] tw:gap-y-[1px] tw:w-full"
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
          >
            <template v-for="(seg, si) in highlightLevels(tok.value)" :key="si">
              <span
                v-if="seg.color"
                :style="{ color: seg.color }"
                class="tw:font-bold"
              >{{ seg.text }}</span>
              <span v-else>{{ seg.text }}</span>
            </template>
          </span>
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
              :class="wildcardChipColor(tok.value, tok.sampleValues)"
            >
              {{ wildcardLabel(tok.value, tok.sampleValues) }}
            </q-chip>
          </span>
        </template>
      </div>

      <!-- Anomaly badge with explanation tooltip -->
      <span
        v-if="pattern.is_anomaly"
        class="text-negative text-weight-bold tw:text-[0.625rem] tw:cursor-help"
        :data-test="`pattern-card-${index}-anomaly-badge`"
      >
        ⚠️ {{ t("search.anomalyLabel") }}
        <q-tooltip anchor="bottom middle" self="top middle" class="anomaly-tooltip">
          <div class="tw:text-xs tw:max-w-[22rem]">{{ anomalyExplanationText }}</div>
        </q-tooltip>
      </span>
    </div>

    <!-- Count & Percentage Column -->
    <div class="tw:w-24 tw:flex-shrink-0 tw:px-2 tw:text-right">
      <div
        class="tw:text-[var(--o2-text-4)] tw:font-bold"
        :data-test="`pattern-card-${index}-frequency`"
      >
        {{ pattern.frequency.toLocaleString() }}
      </div>
      <div
        class="tw:text-[0.6875rem] tw:opacity-80"
        :class="store.state.theme === 'dark' ? 'text-grey-5' : 'text-grey-7'"
        :data-test="`pattern-card-${index}-percentage`"
      >
        {{ pattern.percentage.toFixed(2) }}%
      </div>
    </div>

    <!-- Actions Column -->
    <div
      class="tw:w-20 tw:flex-shrink-0 tw:px-2 tw:flex tw:items-center tw:justify-center tw:gap-[2px]"
      :class="wrap ? 'tw:pt-1' : ''"
    >
      <OButton
        variant="ghost"
        size="icon"
        @click.stop="$emit('include', pattern)"
        :title="t('search.includePatternInSearch')"
        :data-test="`pattern-card-${index}-include-btn`"
      >
        <q-icon style="height: 8px; width: 8px">
          <EqualIcon />
        </q-icon>
      </OButton>
      <OButton
        variant="ghost"
        size="icon"
        @click.stop="$emit('exclude', pattern)"
        :title="t('search.excludePatternFromSearch')"
        :data-test="`pattern-card-${index}-exclude-btn`"
      >
        <q-icon style="height: 8px; width: 8px">
          <NotEqualIcon />
        </q-icon>
      </OButton>
      <OButton
        variant="ghost"
        size="icon"
        @click.stop="$emit('create-alert', pattern)"
        :data-test="`pattern-card-${index}-create-alert-btn`"
      >
        <q-icon name="notifications" size="15px" />
        <q-tooltip>{{ t("search.createAlertFromPattern") }}</q-tooltip>
      </OButton>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import EqualIcon from "@/components/icons/EqualIcon.vue";
import NotEqualIcon from "@/components/icons/NotEqualIcon.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import {
  tokenizeTemplate,
  wildcardChipColor,
  wildcardLabel,
  anomalyExplanation,
} from "@/composables/useLogs/useTemplateTokenizer";
import { extractStatusFromTemplate } from "@/utils/logs/statusParser";
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
}>();

const store = useStore();
const { t } = useI18n();
const { onMouseEnter, onMouseLeave } = useWildcardHover();

const templateTokens = computed(() =>
  tokenizeTemplate(props.pattern.template ?? "", props.pattern.wildcard_values ?? []),
);

const anomalyExplanationText = computed(() => anomalyExplanation(props.pattern, t));

const isDark = computed(() => store.state.theme === "dark");

const statusColor = computed(() =>
  extractStatusFromTemplate(props.pattern.template ?? "", isDark.value).color,
);

const LEVEL_RE = /\b(emergency|emerg|fatal|alert|critical|crit|error|err|warning|warn|notice|info|information|debug|trace|verbose)\b/gi;

interface HighlightSegment {
  text: string;
  color: string | null;
}

function highlightLevels(text: string): HighlightSegment[] {
  const segments: HighlightSegment[] = [];
  let lastIndex = 0;
  const re = new RegExp(LEVEL_RE.source, "gi");
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ text: text.slice(lastIndex, match.index), color: null });
    }
    segments.push({
      text: match[0],
      color: extractStatusFromTemplate(match[0], isDark.value).color,
    });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    segments.push({ text: text.slice(lastIndex), color: null });
  }
  return segments;
}
</script>

<style scoped lang="scss">
@import "@/styles/logs/search-result.scss";

.pattern-template-text {
  font-family: monospace;
  font-size: 12px;
}

// Add explicit hover styles
.table-row-hover {
  transition: background-color 0.15s ease-in-out;

  &:hover {
    background-color: var(--o2-hover-gray) !important;
  }
}
</style>

<style lang="scss">
@import "@/assets/styles/log-highlighting.css";
.wildcard-chip {
  font-family: monospace;
  font-size: 0.75rem;
  font-weight: bold;
  height: 1.125rem;
  padding: 0 0.3125rem;
  border-radius: 0.1875rem;
  line-height: 1.125rem;
  // Prevent chips from inheriting the truncate overflow of the parent row
  flex-shrink: 0;
}
</style>
