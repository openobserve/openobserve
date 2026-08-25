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
  <OCard variant="glass" data-test="oncall-prior-causes">
    <OCardSection role="header" dense>
      <OText variant="card-title">{{ t("oncall.priorCauses") }}</OText>
    </OCardSection>

    <OCardSection role="body" dense>
      <p class="text-text-secondary mb-3 text-xs">{{ t("oncall.priorCausesHint") }}</p>

      <!-- Reserves the list's shape while the fetch is in flight, so it does
           not flash "no history yet" — the wrong answer — for a moment before
           the real one arrives. -->
      <div v-if="loading" class="flex flex-col gap-2" data-test="oncall-prior-causes-loading">
        <OSkeleton type="text" class="h-4 w-2/3" />
        <OSkeleton type="text" class="h-4 w-1/2" />
      </div>

      <!-- An org with no history yet is told how the history gets made, rather
           than being shown an empty box it cannot act on. -->
      <p
        v-else-if="!groups.length"
        class="text-text-secondary text-sm"
        data-test="oncall-prior-causes-empty"
      >
        {{ t("oncall.priorCausesEmpty") }}
      </p>

      <ul v-else class="flex flex-col">
        <li
          v-for="group in groups"
          :key="group.cause"
          class="border-border-subtle flex items-start gap-3 border-b py-2 last:border-b-0"
          :data-test="`oncall-prior-cause-${group.cause}`"
        >
          <OTag :variant="countVariant(group.cause)" size="sm">
            {{ t("oncall.priorCauseCount", { count: group.count }) }}
          </OTag>
          <div class="flex-1">
            <div class="text-text-body text-sm">{{ t(`oncall.cause_${group.cause}`) }}</div>
            <div v-if="group.note" class="text-text-secondary text-xs">
              {{ raw(group.note) }}
            </div>
          </div>
          <OButton
            variant="outline"
            size="sm-action"
            :data-test="`oncall-prior-cause-open-${group.cause}`"
            @click="emit('open', group.last_response_id)"
          >
            {{ t("oncall.openThatOne") }}
          </OButton>
        </li>
      </ul>
    </OCardSection>
  </OCard>
</template>

<script setup lang="ts">
import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OCard from "@/lib/core/Card/OCard.vue";
import OCardSection from "@/lib/core/Card/OCardSection.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import type { CauseGroup, ResolutionCause } from "@/ts/interfaces/oncall";
import { raw, useI18nTyped } from "@/types/i18n";

defineProps<{ groups: CauseGroup[]; loading?: boolean }>();
const emit = defineEmits<{ open: [responseId: string] }>();

const { t } = useI18nTyped();

// A recurring genuine defect is worth a different colour from a recurring
// maintenance window: one is a bug nobody has fixed, the other is expected.
function countVariant(cause: ResolutionCause) {
  if (cause === "genuine_defect") return "error-soft" as const;
  if (cause === "expected_or_maintenance") return "success-soft" as const;
  return "amber-soft" as const;
}
</script>
