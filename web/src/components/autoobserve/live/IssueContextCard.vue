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
  <OCard variant="glass" data-test="autoobserve-issue-context-card">
    <OCardSection role="header" dense>
      <OIcon name="psychology" size="sm" class="text-text-secondary" />
      <OText variant="panel-title">{{ t("autoobserve.issueLive.whatHappened") }}</OText>
    </OCardSection>
    <OCardSection role="body" dense class="flex flex-col gap-3">
      <div class="flex h-6 min-w-0 items-center">
        <OTruncatedText
          v-if="why"
          as="p"
          class="text-text-body text-sm"
          data-test="autoobserve-issue-context-card-why"
        >
          {{ why }}
        </OTruncatedText>
        <OSkeleton v-else-if="!held" animation="none" class="h-3.5 w-3/5" />
      </div>
      <!-- A load that ends without context keeps the block's space and says why, so nothing below moves. -->
      <div
        v-if="held"
        :class="flags.step ? BLOCK_HEIGHT.step : BLOCK_HEIGHT.bare"
        data-test="autoobserve-issue-context-card-held"
      >
        <OInlineNotice
          v-if="'failed' in held"
          variant="error"
          :text="t('autoobserve.context.loadFailed')"
          :action-label="t('common.retry')"
          action-data-test="autoobserve-issue-context-card-retry"
          data-test="autoobserve-issue-context-card-failed"
          @action="emit('retry')"
        />
        <p
          v-else
          class="text-text-secondary text-sm"
          data-test="autoobserve-issue-context-card-note"
        >
          {{ held.note }}
        </p>
      </div>
      <CauseList v-else :context="context" :recovered="recovered" :step="flags.step">
        <NextStepLine
          v-if="flags.step && showsNextStep(context)"
          :context="context"
          :now-ms="now"
        />
      </CauseList>
    </OCardSection>
  </OCard>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import { useNow } from "@/composables/useNow";
import OCard from "@/lib/core/Card/OCard.vue";
import OCardSection from "@/lib/core/Card/OCardSection.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OInlineNotice from "@/lib/feedback/InlineNotice/OInlineNotice.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import type { AutoObserveIncidentItem, AutoObserveIssueContext } from "@/services/autoobserve";
import CauseList from "./CauseList.vue";
import NextStepLine from "./NextStepLine.vue";
import { BLOCK_HEIGHT } from "./causeCopy";
import { issueCause, issueEndUs } from "./issueModel";
import { showsNextStep } from "./liveAdapter";
import { useContextFlags, useLiveZone } from "./liveModel";

const props = defineProps<{
  // Both null while the incident's AutoObserve item loads; the card then holds its place.
  item: AutoObserveIncidentItem | null;
  context: AutoObserveIssueContext | null;
  // Set once no context will come: the failure, or the neutral line that stands in the held block.
  held: { failed: true } | { note: I18nText } | null;
}>();

const emit = defineEmits<{ retry: [] }>();

const { t } = useI18nTyped();
const zone = useLiveZone();
const now = useNow();
const flags = useContextFlags();

const why = computed(() => (props.item ? issueCause(t, zone.value, props.item, now.value) : null));
const recovered = computed(() => !!props.item && issueEndUs(props.item) !== null);
</script>
