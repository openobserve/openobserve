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
  Queue Detail — STUB. Gives the Queues-list Review action a real destination.
  The queue item list + review workbench land in the next slice; for now this
  resolves the queue and shows its summary with a placeholder body.
-->
<template>
  <OPageLayout
    data-test="ai-queue-detail-page"
    :title="queue?.name || t('aiObservability.queues.detail.fallbackTitle')"
    :subtitle="queue?.description || ''"
    icon="fact-check"
    bleed
    :scroll="false"
  >
    <template #actions>
      <OButton
        variant="outline"
        size="sm"
        icon-left="arrow-back"
        data-test="ai-queue-detail-back-btn"
        @click="goBack"
      >
        {{ t("aiObservability.queues.detail.back") }}
      </OButton>
    </template>

    <div class="flex h-full min-h-0 flex-col items-center justify-center gap-3 p-8">
      <OIcon name="fact-check" class="text-text-secondary h-12 w-12" />
      <div class="text-text-heading text-base font-semibold">
        {{ t("aiObservability.queues.detail.comingSoonTitle") }}
      </div>
      <div class="text-text-secondary max-w-md text-center text-sm">
        {{ t("aiObservability.queues.detail.comingSoonBody") }}
      </div>
    </div>
  </OPageLayout>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useRoute, useRouter } from "vue-router";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import llmQueuesService, { type LlmQueue } from "@/services/llm-queues.service";

defineOptions({ name: "AIQueueDetailPage" });

const { t } = useI18n();
const store = useStore();
const route = useRoute();
const router = useRouter();

const orgId = computed<string>(() => store.state.selectedOrganization?.identifier ?? "");
const queueId = computed<string>(() => String(route.params.id ?? ""));

const queue = ref<LlmQueue | null>(null);

function goBack() {
  router.push({ name: "aiQueues", query: { org_identifier: orgId.value } });
}

onMounted(async () => {
  if (!orgId.value || !queueId.value) return;
  queue.value = await llmQueuesService.get(orgId.value, queueId.value);
});
</script>
