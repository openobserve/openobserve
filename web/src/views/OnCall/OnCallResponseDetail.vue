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
      <template v-if="response && isOpenState">
        <!-- Acknowledging is the one action that stops the escalation, so it
             leads. It disappears once taken rather than sitting there inert. -->
        <OButton
          v-if="!response.acked_by"
          variant="primary"
          size="sm-action"
          :loading="acking"
          :title="t('oncall.acknowledgeHint')"
          data-test="oncall-response-ack-btn"
          @click="acknowledgeRecord"
        >
          {{ t("oncall.acknowledge") }}
        </OButton>
        <OButton
          v-if="!response.acked_by"
          variant="secondary"
          size="sm-action"
          :loading="snoozing"
          :title="t('oncall.snoozeHint')"
          data-test="oncall-response-snooze-btn"
          @click="showSnooze = !showSnooze"
        >
          {{ t("oncall.snooze") }}
        </OButton>
        <OButton
          variant="secondary"
          size="sm-action"
          data-test="oncall-response-handoff-btn"
          @click="showHandoff = !showHandoff"
        >
          {{ t("oncall.handoff") }}
        </OButton>
        <OButton
          variant="secondary"
          size="sm-action"
          :loading="resolving"
          data-test="oncall-response-resolve-btn"
          @click="confirmResolve = true"
        >
          {{ t("oncall.resolve") }}
        </OButton>
      </template>
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

      <!-- Snoozing does not assign the page, and the banner has to keep saying
           so — a quiet page that looks owned is how one gets dropped. -->
      <OBanner
        v-if="snoozedUntilLabel"
        variant="warning"
        data-test="oncall-response-snoozed-banner"
      >
        {{ t("oncall.snoozedUntil", { time: snoozedUntilLabel }) }}
      </OBanner>

      <OCard v-if="showSnooze && isOpenState && !response.acked_by">
        <OCardSection>
          <p class="text-text-muted mb-3 text-sm">{{ t("oncall.snoozeHint") }}</p>
          <div class="flex flex-wrap items-center gap-2">
            <span class="text-text-body text-sm">{{ t("oncall.snoozeDuration") }}</span>
            <OButton
              v-for="opt in snoozeOptions"
              :key="opt.minutes"
              variant="secondary"
              size="sm-action"
              :loading="snoozing"
              :data-test="`oncall-response-snooze-${opt.minutes}`"
              @click="snoozeRecord(opt.minutes)"
            >
              {{ raw(opt.label) }}
            </OButton>
          </div>
        </OCardSection>
      </OCard>

      <OCard v-if="showHandoff && isOpenState">
        <OCardSection>
          <h2 class="text-text-heading mb-3 text-lg">{{ t("oncall.handoffTitle") }}</h2>
          <OToggleGroup v-model="handoffMode" class="mb-3">
            <OToggleGroupItem value="person" size="sm" data-test="oncall-handoff-mode-person">
              {{ t("oncall.handoffToPerson") }}
            </OToggleGroupItem>
            <OToggleGroupItem value="team" size="sm" data-test="oncall-handoff-mode-team">
              {{ t("oncall.handoffToTeam") }}
            </OToggleGroupItem>
          </OToggleGroup>

          <!-- The two modes differ in more than their target: moving a page to
               another team clears the ack and re-arms the ladder. Saying so
               here is cheaper than explaining a surprise page later. -->
          <p class="text-text-muted mb-3 text-sm" data-test="oncall-handoff-hint">
            {{ handoffMode === "team" ? t("oncall.handoffTeamHint") : t("oncall.handoffPersonHint") }}
          </p>

          <div class="flex flex-col gap-3">
            <OSelect
              v-if="handoffMode === 'person'"
              v-model="handoffPerson"
              :options="memberOptions"
              :label="t('oncall.handoffPerson')"
              clearable
              data-test="oncall-handoff-person-select"
            />
            <OSelect
              v-else
              v-model="handoffTeam"
              :options="teamOptions"
              :label="t('oncall.handoffTeam')"
              clearable
              data-test="oncall-handoff-team-select"
            />
            <OTextarea
              v-model="handoffNote"
              :label="t('oncall.handoffNote')"
              :rows="2"
              data-test="oncall-handoff-note"
            />
            <div>
              <OButton
                variant="primary"
                size="sm-action"
                :loading="handingOff"
                :disabled="!handoffTarget"
                data-test="oncall-handoff-submit"
                @click="handoffRecord"
              >
                {{ t("oncall.handoff") }}
              </OButton>
            </div>
          </div>
        </OCardSection>
      </OCard>

      <OCard>
        <OCardSection>
          <h2 class="text-text-heading mb-3 text-lg">{{ t("oncall.note") }}</h2>
          <div class="flex flex-col gap-3">
            <OTextarea
              v-model="noteBody"
              :placeholder="t('oncall.notePlaceholder')"
              :rows="3"
              data-test="oncall-response-note-input"
            />
            <div>
              <OButton
                variant="secondary"
                size="sm-action"
                :loading="addingNote"
                :disabled="!noteBody.trim()"
                data-test="oncall-response-note-submit"
                @click="addNote"
              >
                {{ t("oncall.addNote") }}
              </OButton>
            </div>
          </div>
        </OCardSection>
      </OCard>

      <OnCallPriorCauses :groups="priorCauses" @open="openResponse" />

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

    <ODialog
      v-model="confirmResolve"
      :title="t('oncall.resolveTitle')"
      data-test="oncall-resolve-dialog"
    >
      <div class="flex flex-col gap-3">
        <p class="text-text-muted text-sm">{{ t("oncall.resolveMessage") }}</p>

        <!-- Asked HERE and nowhere else. A cause collected later is a cause
             never collected, and it is the only input the prior-causes panel
             has. -->
        <div class="flex flex-col gap-1">
          <span class="text-text-label text-xs">{{ t("oncall.resolveCause") }}</span>
          <span class="text-text-muted text-xs">{{ t("oncall.resolveCauseHint") }}</span>
          <OSelect
            v-model="resolveCause"
            :options="causeOptions"
            clearable
            :placeholder="t('oncall.resolveCausePlaceholder')"
            data-test="oncall-resolve-cause"
          />
        </div>

        <OTextarea
          v-model="resolveNote"
          :label="t('oncall.resolveCauseNote')"
          :placeholder="t('oncall.resolveCauseNotePlaceholder')"
          :rows="2"
          data-test="oncall-resolve-cause-note"
        />
      </div>

      <template #footer>
        <div class="flex justify-end gap-2">
          <OButton variant="outline" size="sm-action" @click="confirmResolve = false">
            {{ t("oncall.cancel") }}
          </OButton>
          <OButton
            variant="primary"
            size="sm-action"
            :loading="resolving"
            data-test="oncall-resolve-confirm"
            @click="resolveRecord"
          >
            {{ t("oncall.resolve") }}
          </OButton>
        </div>
      </template>
    </ODialog>
  </OPageLayout>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useStore } from "vuex";

import OButton from "@/lib/core/Button/OButton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";

import OnCallPriorCauses from "@/components/oncall/OnCallPriorCauses.vue";
import OnCallTimeline from "@/components/oncall/OnCallTimeline.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OCard from "@/lib/core/Card/OCard.vue";
import OCardSection from "@/lib/core/Card/OCardSection.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import OTextarea from "@/lib/forms/Input/OTextarea.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import oncallService from "@/services/oncall";
import type {
  CauseGroup,
  OnCallResponse,
  OnCallResponseEvent,
  ResolutionCause,
} from "@/ts/interfaces/oncall";
import { RESOLUTION_CAUSES } from "@/ts/interfaces/oncall";
import { raw, useI18nTyped } from "@/types/i18n";
import {
  formatMicrosDuration,
  isOpen,
  isSnoozed,
  priorityLabel,
  priorityTagVariant,
  stateTagVariant,
} from "@/utils/oncall";

const { t } = useI18nTyped();
const store = useStore();
const route = useRoute();
const router = useRouter();

const response = ref<OnCallResponse | null>(null);
const events = ref<OnCallResponseEvent[]>([]);
const teamName = ref("");
const loading = ref(false);
const resolving = ref(false);
const acking = ref(false);
const snoozing = ref(false);
const addingNote = ref(false);
const handingOff = ref(false);
const confirmResolve = ref(false);
const showSnooze = ref(false);
const showHandoff = ref(false);
const noteBody = ref("");
const resolveCause = ref<ResolutionCause | "">("");
const resolveNote = ref("");
const priorCauses = ref<CauseGroup[]>([]);
const handoffMode = ref<"person" | "team">("person");
const handoffPerson = ref("");
const handoffTeam = ref("");
const handoffNote = ref("");
const memberOptions = ref<{ label: string; value: string }[]>([]);
const teamOptions = ref<{ label: string; value: string }[]>([]);

// Round numbers a half-awake person can pick without doing arithmetic.
const snoozeOptions = [
  { minutes: 15, label: "15 min" },
  { minutes: 30, label: "30 min" },
  { minutes: 60, label: "1 h" },
  { minutes: 180, label: "3 h" },
];

const orgId = computed(() => store.state.selectedOrganization.identifier);
const responseId = computed(() => String(route.params.responseId ?? ""));

const title = computed(() =>
  response.value ? raw(response.value.subject.source_id) : t("oncall.responseDetail"),
);

const isOpenState = computed(() => !!response.value && isOpen(response.value.state));

const openedAtLabel = computed(() =>
  response.value ? new Date(response.value.opened_at / 1000).toLocaleString() : "",
);

const causeOptions = computed(() =>
  RESOLUTION_CAUSES.map((cause) => ({ label: t(`oncall.cause_${cause}`), value: cause })),
);

const handoffTarget = computed(() =>
  handoffMode.value === "person" ? handoffPerson.value : handoffTeam.value,
);

// Only while it is actually in the future — a lapsed snooze is not a state,
// and leaving the banner up would say the page is quiet when it is escalating.
const snoozedUntilLabel = computed(() => {
  const r = response.value;
  if (!r || !isSnoozed(r)) return "";
  return new Date((r.snoozed_until as number) / 1000).toLocaleString();
});

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
    await fetchHandoffTargets();
    await fetchPriorCauses();
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
      cause: resolveCause.value || undefined,
      cause_note: resolveNote.value.trim() || undefined,
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

async function acknowledgeRecord() {
  acking.value = true;
  try {
    await oncallService.acknowledgeResponse({
      org_identifier: orgId.value,
      response_id: responseId.value,
    });
    toast({ variant: "success", message: t("oncall.acknowledged") });
    await fetchResponse();
  } catch (err: any) {
    toast({
      variant: "error",
      message: raw(err?.response?.data?.message) || t("oncall.acknowledgeFailed"),
    });
  } finally {
    acking.value = false;
  }
}

async function snoozeRecord(minutes: number) {
  snoozing.value = true;
  try {
    await oncallService.snoozeResponse({
      org_identifier: orgId.value,
      response_id: responseId.value,
      minutes,
    });
    showSnooze.value = false;
    toast({ variant: "success", message: t("oncall.snoozed") });
    await fetchResponse();
  } catch (err: any) {
    toast({
      variant: "error",
      message: raw(err?.response?.data?.message) || t("oncall.snoozeFailed"),
    });
  } finally {
    snoozing.value = false;
  }
}

async function addNote() {
  const body = noteBody.value.trim();
  if (!body) return;
  addingNote.value = true;
  try {
    await oncallService.addNote({
      org_identifier: orgId.value,
      response_id: responseId.value,
      body,
    });
    noteBody.value = "";
    toast({ variant: "success", message: t("oncall.noteAdded") });
    await fetchResponse();
  } catch (err: any) {
    toast({
      variant: "error",
      message: raw(err?.response?.data?.message) || t("oncall.addNoteFailed"),
    });
  } finally {
    addingNote.value = false;
  }
}

async function handoffRecord() {
  if (!handoffTarget.value) {
    toast({ variant: "error", message: t("oncall.handoffPickOne") });
    return;
  }
  handingOff.value = true;
  try {
    await oncallService.handoffResponse({
      org_identifier: orgId.value,
      response_id: responseId.value,
      to: handoffMode.value === "person" ? handoffPerson.value : undefined,
      to_team_id: handoffMode.value === "team" ? handoffTeam.value : undefined,
      note: handoffNote.value.trim() || undefined,
    });
    showHandoff.value = false;
    handoffPerson.value = "";
    handoffTeam.value = "";
    handoffNote.value = "";
    toast({ variant: "success", message: t("oncall.handoffDone") });
    await fetchResponse();
  } catch (err: any) {
    toast({
      variant: "error",
      message: raw(err?.response?.data?.message) || t("oncall.handoffFailed"),
    });
  } finally {
    handingOff.value = false;
  }
}

// Handoff targets. Failing to load them leaves the selects empty rather than
// breaking the page — every other action still works.
async function fetchHandoffTargets() {
  if (!response.value) return;
  try {
    const members = await oncallService.listMembers({
      org_identifier: orgId.value,
      team_id: response.value.team_id,
    });
    memberOptions.value = (members.data ?? []).map((m: { user_email: string }) => ({
      label: m.user_email,
      value: m.user_email,
    }));
  } catch {
    memberOptions.value = [];
  }
  try {
    const teams = await oncallService.listTeams({ org_identifier: orgId.value });
    teamOptions.value = (teams.data ?? [])
      .filter((tm: { id: string }) => tm.id !== response.value?.team_id)
      .map((tm: { id: string; name: string }) => ({ label: tm.name, value: tm.id }));
  } catch {
    teamOptions.value = [];
  }
}

// History is context, not the page itself: failing to load it must not stop a
// responder acting on what is in front of them.
async function fetchPriorCauses() {
  try {
    const res = await oncallService.priorCauses({
      org_identifier: orgId.value,
      response_id: responseId.value,
    });
    priorCauses.value = res.data ?? [];
  } catch {
    priorCauses.value = [];
  }
}

function openResponse(id: string) {
  router.push({
    name: "onCallResponseDetail",
    params: { responseId: id },
    query: { org_identifier: orgId.value },
  });
}

onMounted(fetchResponse);
</script>
