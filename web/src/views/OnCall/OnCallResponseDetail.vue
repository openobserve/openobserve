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
  <OPageLayout
    constrained
    data-test="oncall-response-detail-page"
    :title="title"
    icon="notifications-active"
    :back="{ label: t('oncall.backToResponses'), to: { name: 'onCallResponses' } }"
  >
    <template #actions>
      <OButton
        v-if="response && isOpenState"
        variant="primary"
        size="sm-action"
        :loading="resolving"
        data-test="oncall-response-resolve-btn"
        @click="confirmResolve = true"
      >
        {{ t("oncall.resolve") }}
      </OButton>
    </template>

    <div v-if="response" class="flex flex-col gap-4">
      <OCard>
        <OCardSection>
          <dl class="grid grid-cols-2 gap-4 md:grid-cols-4">
            <div class="flex flex-col gap-1">
              <dt class="text-text-muted text-xs">{{ t("oncall.priority") }}</dt>
              <dd>
                <OTag :variant="priorityTagVariant(response.priority)" size="sm">
                  {{ priorityLabel(response.priority) }}
                </OTag>
              </dd>
            </div>
            <div class="flex flex-col gap-1">
              <dt class="text-text-muted text-xs">{{ t("oncall.state") }}</dt>
              <dd>
                <OTag :variant="stateTagVariant(response.state)" size="sm">
                  {{ t(`oncall.state_${response.state}`) }}
                </OTag>
              </dd>
            </div>
            <div class="flex flex-col gap-1">
              <dt class="text-text-muted text-xs">{{ t("oncall.timeToAck") }}</dt>
              <!-- An unacknowledged page shows a dash, never a running total:
                   a number here would read as a measured response. -->
              <dd class="text-text-body text-sm">{{ timeToAck }}</dd>
            </div>
            <div class="flex flex-col gap-1">
              <dt class="text-text-muted text-xs">{{ t("oncall.timeToResolve") }}</dt>
              <dd class="text-text-body text-sm">{{ timeToResolve }}</dd>
            </div>
            <div class="flex flex-col gap-1">
              <dt class="text-text-muted text-xs">{{ t("oncall.team") }}</dt>
              <dd class="text-text-body text-sm">{{ raw(teamName) }}</dd>
            </div>
            <div class="flex flex-col gap-1">
              <dt class="text-text-muted text-xs">{{ t("oncall.ackedBy") }}</dt>
              <dd class="text-text-body text-sm">{{ raw(response.acked_by) || "—" }}</dd>
            </div>
            <div class="flex flex-col gap-1">
              <dt class="text-text-muted text-xs">{{ t("oncall.firing") }}</dt>
              <dd class="text-text-body text-sm">
                {{ raw(`#${response.subject.firing}`) }}
              </dd>
            </div>
            <div class="flex flex-col gap-1">
              <dt class="text-text-muted text-xs">{{ t("oncall.openedAt") }}</dt>
              <dd class="text-text-body text-sm">{{ raw(openedAtLabel) }}</dd>
            </div>
          </dl>
        </OCardSection>
      </OCard>

      <OCard>
        <OCardSection>
          <h2 class="text-text-heading mb-3 text-lg">{{ t("oncall.timeline") }}</h2>
          <OnCallTimeline :events="events" :opened-at="response.opened_at" />
        </OCardSection>
      </OCard>
    </div>

    <OEmptyState
      v-else-if="!loading"
      size="hero"
      preset="no-data"
      data-test="oncall-response-detail-empty"
    />

    <ConfirmDialog
      v-model="confirmResolve"
      :title="t('oncall.resolveTitle')"
      :message="t('oncall.resolveMessage')"
      @update:ok="resolveRecord"
      @update:cancel="confirmResolve = false"
    />
  </OPageLayout>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import { useStore } from "vuex";

import OButton from "@/lib/core/Button/OButton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";

import ConfirmDialog from "@/components/ConfirmDialog.vue";
import OnCallTimeline from "@/components/oncall/OnCallTimeline.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OCard from "@/lib/core/Card/OCard.vue";
import OCardSection from "@/lib/core/Card/OCardSection.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import oncallService from "@/services/oncall";
import type { OnCallResponse, OnCallResponseEvent } from "@/ts/interfaces/oncall";
import { raw, useI18nTyped } from "@/types/i18n";
import {
  formatMicrosDuration,
  isOpen,
  priorityLabel,
  priorityTagVariant,
  stateTagVariant,
} from "@/utils/oncall";

const { t } = useI18nTyped();
const store = useStore();
const route = useRoute();

const response = ref<OnCallResponse | null>(null);
const events = ref<OnCallResponseEvent[]>([]);
const teamName = ref("");
const loading = ref(false);
const resolving = ref(false);
const confirmResolve = ref(false);

const orgId = computed(() => store.state.selectedOrganization.identifier);
const responseId = computed(() => String(route.params.responseId ?? ""));

const title = computed(() =>
  response.value ? raw(response.value.subject.source_id) : t("oncall.responseDetail"),
);

const isOpenState = computed(() => !!response.value && isOpen(response.value.state));

const openedAtLabel = computed(() =>
  response.value ? new Date(response.value.opened_at / 1000).toLocaleString() : "",
);

const timeToAck = computed(() => {
  const r = response.value;
  if (!r?.acked_at) return "—";
  return formatMicrosDuration(r.acked_at - r.opened_at);
});

const timeToResolve = computed(() => {
  const r = response.value;
  if (!r?.closed_at) return "—";
  return formatMicrosDuration(r.closed_at - r.opened_at);
});

async function fetchResponse() {
  loading.value = true;
  try {
    const res = await oncallService.getResponse({
      org_identifier: orgId.value,
      response_id: responseId.value,
    });
    response.value = res.data.response;
    events.value = res.data.events ?? [];
    await fetchTeamName();
  } catch (err: any) {
    toast({
      variant: "error",
      message: raw(err?.response?.data?.message) || t("oncall.loadResponseFailed"),
    });
  } finally {
    loading.value = false;
  }
}

// The record stores a team id; a deleted team still has records pointing at
// it, so the id is the fallback rather than an error.
async function fetchTeamName() {
  if (!response.value) return;
  teamName.value = response.value.team_id;
  try {
    const res = await oncallService.getTeam({
      org_identifier: orgId.value,
      team_id: response.value.team_id,
    });
    if (res.data?.name) teamName.value = res.data.name;
  } catch {
    // Keep the id.
  }
}

async function resolveRecord() {
  confirmResolve.value = false;
  resolving.value = true;
  try {
    await oncallService.resolveResponse({
      org_identifier: orgId.value,
      response_id: responseId.value,
    });
    toast({ variant: "success", message: t("oncall.resolved") });
    await fetchResponse();
  } catch (err: any) {
    toast({
      variant: "error",
      message: raw(err?.response?.data?.message) || t("oncall.resolveFailed"),
    });
  } finally {
    resolving.value = false;
  }
}

onMounted(fetchResponse);
</script>
