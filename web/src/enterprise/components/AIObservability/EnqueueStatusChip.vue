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

<!--
  "In Queue?" cell for Discovery: projects a target's queue memberships onto one
  chip. Discovery is stateless — a row never leaves the list once enqueued, so
  this chip is the only place the queue state shows. Items are `pending` or
  `reviewed` only; there is no in-review state.
-->
<template>
  <OTag
    v-if="!queues.length"
    variant="default-outline"
    shape="rounded"
    data-test="enqueue-chip-none"
  >
    {{ t("aiObservability.discovery.inQueue.none") }}
  </OTag>

  <OTag
    v-else-if="reviewed"
    variant="success-soft"
    shape="rounded"
    data-test="enqueue-chip-reviewed"
  >
    {{ t("aiObservability.discovery.inQueue.reviewed") }}
    <OTooltip side="bottom" :content="queueNames" />
  </OTag>

  <OTag
    v-else-if="queues.length > 1"
    variant="default-soft"
    shape="rounded"
    data-test="enqueue-chip-multi"
  >
    {{ t("aiObservability.discovery.inQueue.multiple", { count: queues.length }) }}
    <OTooltip side="bottom" :content="queueNames" />
  </OTag>

  <OTag v-else variant="default-soft" shape="rounded" data-test="enqueue-chip-single">
    <span class="max-w-40 truncate">{{ singleLabel }}</span>
    <OTooltip side="bottom" :content="singleLabel" />
  </OTag>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { raw, useI18nTyped } from "@/types/i18n";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import type { DiscoveryQueueMembership } from "@/services/llm-discovery.service";

defineOptions({ name: "EnqueueStatusChip" });

const props = defineProps<{ queues: DiscoveryQueueMembership[] }>();

const { t } = useI18nTyped();

const reviewed = computed(() => props.queues.some((queue) => queue.status === "reviewed"));

/** Queue names are server data, so they go through raw() to stay type-safe. */
const queueNames = computed(() =>
  raw(props.queues.map((queue) => queue.queueName ?? queue.queueId).join(", ")),
);

const singleLabel = computed(() => {
  const queue = props.queues[0];
  return raw(queue?.queueName ?? queue?.queueId ?? "");
});
</script>
