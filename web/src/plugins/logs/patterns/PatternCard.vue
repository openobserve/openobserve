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
    class="flex border-b border-border-default cursor-pointer hover:bg-hover-gray relative py-1 transition-colors duration-150 ease-in-out"
    :class="wrap ? 'items-start' : 'items-center'"
    @click="$emit('click', pattern, index)"
    :data-test="`pattern-card-${index}`"
  >
    <!-- Status level left border -->
    <div
      class="absolute left-0 inset-y-0 w-1 z-10"
      :style="{ backgroundColor: statusColor }"
    />
    <!-- Pattern Column -->
    <div class="flex-1 min-w-0 px-2 pl-3" :class="wrap ? '' : 'overflow-hidden'">
      <!-- Template rendered as tokenized chips so wildcards are visually distinct -->
      <div
        class="font-mono text-xs w-full text-text-secondary"
        :class="[
          wrap
            ? 'break-all'
            : 'flex items-baseline gap-x-[2px] gap-y-[1px] flex-nowrap overflow-hidden',
        ]"
        :data-test="`pattern-card-${index}-template`"
      >
        <template v-for="(tok, i) in templateTokens" :key="i">
          <span
            v-if="tok.kind === 'text'"
            :class="wrap ? 'whitespace-pre-wrap break-all' : 'whitespace-pre'"
          >
            <template v-for="(seg, si) in highlightLevels(tok.value)" :key="si">
              <span
                v-if="seg.color"
                :style="{ color: seg.color }"
                class="font-bold"
              >{{ seg.text }}</span>
              <span v-else>{{ seg.text }}</span>
            </template>
          </span>
          <span
            v-else
            class="inline-flex"
            @mouseenter="onMouseEnter(tok.value, tok.sampleValues, $event)"
            @mouseleave="onMouseLeave"
          >
            <OTag
              type="wildcardChip"
              data-test="pattern-card-wildcard-chip"
              :class="wildcardChipColor(tok.value, tok.sampleValues)"
            >
              {{ wildcardLabel(tok.value, tok.sampleValues) }}
            </OTag>
          </span>
        </template>
      </div>

      <!-- Anomaly badge with explanation tooltip -->
      <span
        v-if="pattern.is_anomaly"
        class="text-badge-error-ol-text font-bold text-2xs cursor-help"
        :data-test="`pattern-card-${index}-anomaly-badge`"
      >
        ⚠️ {{ t("search.anomalyLabel") }}
        <OTooltip :content="anomalyExplanationText" max-width="22rem" />
      </span>
    </div>

    <!-- Count & Percentage Column -->
    <div class="w-24 flex-shrink-0 px-2 text-right">
      <div
        class="text-text-body font-bold"
        :data-test="`pattern-card-${index}-frequency`"
      >
        {{ pattern.frequency.toLocaleString() }}
      </div>
      <div
        class="text-2xs opacity-80"
        :class="'text-text-secondary'"
        :data-test="`pattern-card-${index}-percentage`"
      >
        {{ pattern.percentage.toFixed(2) }}%
      </div>
    </div>

    <!-- Actions Column -->
    <div
      class="w-20 flex-shrink-0 px-2 flex items-center justify-center gap-0.5"
      :class="wrap ? 'pt-1' : ''"
    >
      <OButton
        variant="ghost"
        size="icon"
        @click.stop="$emit('include', pattern)"
        :title="t('search.includePatternInSearch')"
        :data-test="`pattern-card-${index}-include-btn`"
      >
        <OIcon style="height: 8px; width: 8px">
          <EqualIcon />
        </OIcon>
      </OButton>
      <OButton
        variant="ghost"
        size="icon"
        @click.stop="$emit('exclude', pattern)"
        :title="t('search.excludePatternFromSearch')"
        :data-test="`pattern-card-${index}-exclude-btn`"
      >
        <OIcon style="height: 8px; width: 8px">
          <NotEqualIcon />
        </OIcon>
      </OButton>
      <OButton
        variant="ghost"
        size="icon"
        @click.stop="$emit('create-alert', pattern)"
        :data-test="`pattern-card-${index}-create-alert-btn`"
      >
        <OIcon name="notifications" size="sm" />
        <OTooltip :content="t('search.createAlertFromPattern')" />
      </OButton>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import useTheme from "@/composables/useTheme";
import EqualIcon from "@/components/icons/EqualIcon.vue";
import NotEqualIcon from "@/components/icons/NotEqualIcon.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
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

const { t } = useI18n();
const { isDark } = useTheme();
const { onMouseEnter, onMouseLeave } = useWildcardHover();

const templateTokens = computed(() =>
  tokenizeTemplate(props.pattern.template ?? "", props.pattern.wildcard_values ?? []),
);

const anomalyExplanationText = computed(() => anomalyExplanation(props.pattern, t));

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

