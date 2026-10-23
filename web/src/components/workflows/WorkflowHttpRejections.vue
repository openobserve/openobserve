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
    v-if="total > 0 && !open"
    data-test="workflow-http-rejections-line"
    class="flex flex-wrap items-center gap-2"
  >
    <OIcon name="warning" size="sm" class="text-status-warning-text shrink-0" />
    <OText as="span" class="min-w-0">{{ lineText }}</OText>
    <OButton
      variant="ghost-primary"
      size="xs"
      data-test="workflow-http-rejections-show"
      @click="open = true"
    >
      {{ t("workflow.http.rejectionsShow") }}
    </OButton>
  </div>
  <section
    v-else-if="total > 0"
    data-test="workflow-http-rejections"
    class="border-border-default rounded-default flex flex-col border"
  >
    <div class="flex items-center gap-2 px-3 py-2">
      <OButton
        variant="ghost"
        size="icon-xs-sq"
        :aria-label="t('workflow.http.rejectionsHide')"
        data-test="workflow-http-rejections-hide"
        @click="open = false"
      >
        <OIcon name="expand-more" size="sm" />
      </OButton>
      <OText variant="body-strong">{{ t("workflow.http.rejectionsTitle") }}</OText>
      <OText variant="meta" class="min-w-0 flex-1">
        {{ t("workflow.http.rejectionsCaption", { count: total }, total) }}
      </OText>
      <ORefreshButton
        layout="inline"
        variant="ghost"
        :loading="loading"
        data-test="workflow-http-rejections-refresh"
        @click="emit('refresh')"
      />
    </div>

    <div v-if="loading" class="flex flex-col gap-2 px-3 pb-3">
      <OSkeleton
        v-for="n in 3"
        :key="n"
        class="h-10 w-full"
        data-test="workflow-http-rejections-skeleton"
      />
    </div>
    <div v-else-if="error" class="flex items-center gap-3 px-3 pb-3">
      <OText variant="meta" class="text-status-negative min-w-0 flex-1">
        {{ t("workflow.http.rejectionsLoadError") }}
      </OText>
      <OButton
        variant="outline"
        size="xs"
        data-test="workflow-http-rejections-retry"
        @click="emit('refresh')"
      >
        {{ t("common.retry") }}
      </OButton>
    </div>
    <ul v-else class="divide-border-default flex flex-col divide-y px-3">
      <li
        v-for="row in rows"
        :key="row.reason"
        :data-test="`workflow-http-rejection-${row.reason}`"
        class="flex items-start gap-3 py-3"
      >
        <OTag
          type="httpStatus"
          :value="httpStatusBucket(row.status)"
          :label="raw(row.status)"
          class="shrink-0"
        />
        <div class="flex min-w-0 flex-1 flex-col gap-1">
          <OText as="p" class="flex flex-wrap items-baseline gap-x-1">
            <span class="text-text-heading font-medium">
              {{ t(HOOK_REASON_KEYS[row.reason].title) }}
            </span>
            <span class="text-text-secondary">{{ rowMeta(row) }}</span>
          </OText>
          <OText variant="meta" as="p">{{ fixText(row.reason) }}</OText>
        </div>
        <OButton
          v-if="row.reason === 'rate_limited' && triggerLimit < orgBudget"
          variant="ghost-primary"
          size="xs"
          class="shrink-0"
          data-test="workflow-http-rejection-raise-limit"
          @click="emit('raise-limit')"
        >
          {{ t("workflow.http.raiseLimit") }}
        </OButton>
        <OButton
          v-else-if="row.reason === 'credential_in_url'"
          variant="ghost-primary"
          size="xs"
          class="shrink-0"
          data-test="workflow-http-rejection-rotate"
          @click="emit('rotate')"
        >
          {{ t("workflow.http.rotateLink") }}
        </OButton>
      </li>
    </ul>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useStore } from "vuex";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OText from "@/lib/core/Typography/OText.vue";
import ORefreshButton from "@/lib/core/RefreshButton/ORefreshButton.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import { httpStatusBucket } from "@/lib/core/Badge/badgeGroups";
import { formatTimestampInTimezone } from "@/utils/date";
import type { HookReasonCode, HttpRejection } from "@/services/workflows";
import {
  HOOK_REASON_KEYS,
  HOOK_REASON_STATUS,
  ORG_QUEUE_MAX,
  formatBodySize,
} from "@/plugins/workflows/httpEndpointUi";

interface RejectionRow extends HttpRejection {
  reason: HookReasonCode;
  status: number;
}

const TIME_FORMAT = "MMM D, HH:mm";

const props = defineProps<{
  rejections: Partial<Record<HookReasonCode, HttpRejection>>;
  triggerLimit: number;
  orgBudget: number;
  maxBodyBytes: number;
  loading: boolean;
  error: boolean;
}>();

const emit = defineEmits<{
  (e: "rotate"): void;
  (e: "raise-limit"): void;
  (e: "refresh"): void;
}>();

const { t } = useI18nTyped();
const store = useStore();

const open = ref(false);

const rows = computed<RejectionRow[]>(() =>
  (Object.entries(props.rejections) as [HookReasonCode, HttpRejection | undefined][])
    .filter((entry): entry is [HookReasonCode, HttpRejection] => !!entry[1]?.count_24h)
    .map(([reason, r]) => ({ ...r, reason, status: HOOK_REASON_STATUS[reason] }))
    .sort((a, b) => b.count_24h - a.count_24h),
);
const total = computed(() => rows.value.reduce((sum, r) => sum + r.count_24h, 0));
// Walks the server's order, not the count order, so a tie names the first reason stored.
const latest = computed(() => {
  let best: RejectionRow | undefined;
  for (const reason of Object.keys(props.rejections) as HookReasonCode[]) {
    const r = rows.value.find((row) => row.reason === reason);
    if (r && (!best || r.last_at > best.last_at)) best = r;
  }
  return best;
});

const formatTime = (us: number) =>
  raw(formatTimestampInTimezone(us, TIME_FORMAT, store.state.timezone));

const lineText = computed<I18nText>(() => {
  const last = latest.value;
  if (!last) return raw("");
  return t(
    "workflow.http.rejectionsLine",
    {
      count: total.value,
      reason: t(HOOK_REASON_KEYS[last.reason].title),
      time: formatTime(last.last_at),
    },
    total.value,
  );
});

const rowMeta = (row: RejectionRow) =>
  t(
    "workflow.http.rejectionMeta",
    { count: row.count_24h, time: formatTime(row.last_at), ip: raw(row.last_ip) },
    row.count_24h,
  );

const fixText = (reason: HookReasonCode): I18nText => {
  const key = HOOK_REASON_KEYS[reason].fix;
  switch (reason) {
    case "invalid_signature":
      return t(key, { format: raw("webhook-id.webhook-timestamp.body") });
    case "payload_too_large":
      return t(key, { size: formatBodySize(props.maxBodyBytes, t) });
    case "rate_limited":
      return t(key, { count: props.triggerLimit, org: props.orgBudget });
    case "queue_full":
      return t(key, { count: ORG_QUEUE_MAX });
    default:
      return t(key);
  }
};
</script>
