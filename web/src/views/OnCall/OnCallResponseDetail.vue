<template>
  <OPageLayout
    bleed
    data-test="oncall-response-detail-page"
    :title="title"
    :subtitle="subtitle"
    icon="notifications-active"
    :back="{ label: t('oncall.backToResponses'), to: { name: 'onCallResponses' } }"
  >
    <!-- The two facts a responder needs before anything else ride the title,
         rather than sitting in a metadata grid below the fold. -->
    <template #title-trail>
      <template v-if="response">
        <OTag type="alertPriority" :value="`p${response.priority}`" size="sm" />
        <OTag type="oncallResponseState" :value="response.state" size="sm" />
        <OTag v-if="snoozedUntilLabel" variant="warning-soft" size="sm">
          {{ t("oncall.snoozed") }}
        </OTag>
        <!-- Why this team is looking at somebody else's outage, said where the
             state is said rather than halfway down the page. -->
        <OTag
          v-if="isImpacted"
          variant="info-outline"
          size="sm"
          data-test="oncall-response-liaison-tag"
        >
          {{ t("oncall.liaisonTag") }}
        </OTag>
      </template>
    </template>

    <template #actions>
      <template v-if="response && isOpenState">
        <!-- Exactly one primary, and it moves: claiming the page matters most
             until somebody has, and closing it matters most after. -->
        <OButton
          v-if="canAcknowledge"
          variant="primary"
          size="sm-action"
          :loading="acking"
          data-test="oncall-response-ack-btn"
          @click="acknowledgeRecord"
        >
          {{ t("oncall.acknowledge") }}
        </OButton>

        <!-- A menu of durations, not a panel that pushes the page down. -->
        <ODropdown v-if="canAcknowledge">
          <template #trigger>
            <OButton
              variant="outline"
              size="sm-action"
              :loading="snoozing"
              data-test="oncall-response-snooze-btn"
            >
              {{ t("oncall.snooze") }}
            </OButton>
          </template>
          <ODropdownItem
            v-for="opt in snoozeOptions"
            :key="opt.minutes"
            :data-test="`oncall-response-snooze-${opt.minutes}`"
            @select="snoozeRecord(opt.minutes)"
          >
            {{ raw(opt.label) }}
          </ODropdownItem>
        </ODropdown>

        <OButton
          variant="outline"
          size="sm-action"
          data-test="oncall-response-handoff-btn"
          @click="showHandoff = true"
        >
          {{ t("oncall.handoff") }}
        </OButton>
      </template>

      <!-- Ten minutes into a page, "this is bigger than an alert" had no way of
           being said: `incident_id` could only ever be set by the path that
           opened the record. Offered on a closed record too — the server does
           not gate it by state, and the realisation that a firing belonged to
           something larger routinely arrives after it was closed. Hidden once
           an incident exists, because the rail links to it from then on. -->
      <OButton
        v-if="response && !response.incident_id"
        variant="outline"
        size="sm-action"
        data-test="oncall-response-promote-btn"
        @click="promoteOpen = true"
      >
        {{ t("oncall.promote") }}
      </OButton>

      <template v-if="response && isOpenState">
        <!-- An impacted record closes through ITS verb. A plain resolve would
             close this record but skip the sibling check that closes the
             owner's — the owner would wait forever on a confirmation that can
             no longer arrive. -->
        <OButton
          v-if="isImpacted"
          :variant="canAcknowledge ? 'outline' : 'primary'"
          size="sm-action"
          :loading="confirmingRecovery"
          data-test="oncall-response-confirm-recovery-btn"
          @click="confirmRecoveryOpen = true"
        >
          {{ t("oncall.confirmRecovery") }}
        </OButton>
        <OButton
          v-else
          :variant="canAcknowledge ? 'outline' : 'primary'"
          size="sm-action"
          :loading="resolving"
          data-test="oncall-response-resolve-btn"
          @click="confirmResolve = true"
        >
          {{ t("oncall.resolve") }}
        </OButton>
      </template>
    </template>

    <template v-if="response">
      <OContent y>
        <!-- Snoozing does not assign the page, and the banner has to keep
             saying so — a quiet page that looks owned is how one gets dropped. -->
        <OBanner
          v-if="snoozedUntilLabel"
          variant="warning"
          class="mb-3"
          data-test="oncall-response-snoozed-banner"
        >
          {{ t("oncall.snoozedUntil", { time: snoozedUntilLabel }) }}
        </OBanner>

        <!-- D-21. This record exists because somebody else's failure reaches
             this team's service. Without saying so, a two-rung ladder that
             stops reads as a broken one, and the team reads its own page as
             an outage it is supposed to fix. -->
        <OBanner
          v-if="isImpacted"
          variant="info"
          class="mb-3"
          data-test="oncall-response-liaison-banner"
        >
          {{ t("oncall.liaisonBanner") }}
          <router-link
            v-if="response.origin_response_id"
            class="text-accent"
            :to="{
              name: 'onCallResponseDetail',
              params: { responseId: response.origin_response_id },
              query: { org_identifier: orgId },
            }"
            data-test="oncall-response-origin-link"
          >
            {{ t("oncall.liaisonOpenOrigin") }}
          </router-link>
        </OBanner>

        <OStatStrip :items="summaryStats" data-test="oncall-response-stats" />
      </OContent>

      <OTabs v-model="tab" data-test="oncall-response-tabs">
        <OTab name="overview" :label="t('oncall.tabOverview')" icon="info-outline" />
        <OTab name="activity" :label="t('oncall.tabActivity')" icon="event-note" />
        <OTab name="causes" :label="t('oncall.tabPriorCauses')" icon="lightbulb-outline" />
      </OTabs>

      <OTabPanels v-model="tab" grow scroll="y">
        <OTabPanel name="overview">
          <OContent y>
            <div class="grid grid-cols-1 gap-6 lg:grid-cols-3">
              <div class="flex flex-col gap-6 lg:col-span-2">
                <!-- Renders nothing until a verdict event exists (§G.7) — the
                     default deployment has no agent and must not show an
                     analysis panel that sits empty forever. -->
                <OnCallVerdictCard :events="events" />
                <OnCallEscalation
                  v-if="escalation"
                  :progress="escalation"
                  :events="events"
                  :responder-role="isImpacted ? 'impacted' : 'owner'"
                />
                <OnCallDeliveryLedger
                  :records="deliveries"
                  :total="deliveriesTotal"
                  :loading="deliveriesLoading"
                />
              </div>

              <!-- Same key/value grid the rest of the app uses for a details
                   rail, rather than a third spelling of the same thing. -->
              <!-- Stacked on a phone: a fixed label column leaves an email or
                   a ksuid about five characters of room on a narrow screen. -->
              <dl
                class="text-compact grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-[10rem_1fr]"
              >
                <dt class="text-text-secondary">{{ t("oncall.ackedBy") }}</dt>
                <dd class="text-text-body">{{ raw(response.acked_by) || ABSENT }}</dd>

                <dt class="text-text-secondary">{{ t("oncall.team") }}</dt>
                <dd class="text-text-body">{{ raw(teamName) }}</dd>

                <!-- The engine records why it picked this team. It was only
                     ever readable by scrolling the timeline, which is not
                     where somebody asks "why me". -->
                <template v-if="routingReason">
                  <dt class="text-text-secondary">{{ t("oncall.routedBecause") }}</dt>
                  <dd class="text-text-body" data-test="oncall-response-routing-reason">
                    {{ raw(routingReason) }}
                  </dd>
                </template>

                <!-- The rule that fired is the first thing a woken engineer
                     wants to open, and this row used to be an unclickable
                     ksuid. -->
                <dt class="text-text-secondary">{{ t("oncall.subject") }}</dt>
                <dd class="text-text-body break-all">
                  <router-link
                    v-if="response.subject.subject_type === 'alert'"
                    class="text-accent"
                    :to="{
                      name: 'alertDetail',
                      params: { alert_id: response.subject.source_id },
                      query: { org_identifier: orgId },
                    }"
                    data-test="oncall-response-subject-link"
                  >
                    {{ raw(subjectName) }}
                  </router-link>
                  <template v-else>{{ raw(subjectName) }}</template>
                </dd>

                <template v-if="subjectStream">
                  <dt class="text-text-secondary">{{ t("oncall.subjectStream") }}</dt>
                  <dd class="text-text-body" data-test="oncall-response-subject-stream">
                    {{ raw(subjectStream) }}
                  </dd>
                </template>

                <dt class="text-text-secondary">{{ t("oncall.firing") }}</dt>
                <dd class="text-text-body">{{ raw(`#${response.subject.firing}`) }}</dd>

                <template v-if="response.incident_id">
                  <dt class="text-text-secondary">{{ t("oncall.incident") }}</dt>
                  <dd>
                    <router-link
                      class="text-accent"
                      :to="{
                        name: 'incidentDetail',
                        params: { id: response.incident_id },
                        query: { org_identifier: orgId },
                      }"
                      data-test="oncall-response-incident-link"
                    >
                      {{ raw(response.incident_id) }}
                    </router-link>
                  </dd>
                </template>

                <dt class="text-text-secondary">{{ t("oncall.openedAt") }}</dt>
                <dd><OTimeCell :value="response.opened_at" unit="us" /></dd>

                <template v-if="response.cause">
                  <dt class="text-text-secondary">{{ t("oncall.resolveCause") }}</dt>
                  <dd class="text-text-body">
                    {{ t(`oncall.cause_${response.cause}`) }}
                    <span v-if="response.cause_note" class="text-text-muted">
                      {{ raw(response.cause_note) }}
                    </span>
                  </dd>
                </template>
              </dl>
            </div>
          </OContent>
        </OTabPanel>

        <OTabPanel name="activity">
          <OContent y>
            <OnCallTimeline :events="events" :opened-at="response.opened_at" />

            <!-- Pinned under the thread it appends to. A note is a comment. -->
            <div class="border-border-default mt-4 flex flex-col gap-2 border-t pt-4">
              <OTextarea
                v-model="noteBody"
                :placeholder="t('oncall.notePlaceholder')"
                :rows="2"
                data-test="oncall-response-note-input"
              />
              <div class="flex justify-end">
                <OButton
                  variant="outline"
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
          </OContent>
        </OTabPanel>

        <OTabPanel name="causes">
          <OContent y>
            <OnCallPriorCauses :groups="priorCauses" @open="openResponse" />
            <OnCallFiringHistory
              class="mt-4"
              :firings="firingHistory"
              @open="openResponse"
            />
          </OContent>
        </OTabPanel>
      </OTabPanels>
    </template>

    <OEmptyState
      v-else-if="!loading"
      size="hero"
      preset="no-data"
      data-test="oncall-response-detail-empty"
    />

    <!-- Handing a page to another team clears the ack and re-arms the ladder,
         so it gets room to say so rather than a menu. -->
    <ODrawer v-model:open="showHandoff" :title="t('oncall.handoffTitle')" data-test="oncall-handoff-drawer">
      <div class="flex flex-col gap-4">
        <OToggleGroup v-model="handoffMode">
          <OToggleGroupItem value="person" size="sm" data-test="oncall-handoff-mode-person">
            {{ t("oncall.handoffToPerson") }}
          </OToggleGroupItem>
          <OToggleGroupItem value="team" size="sm" data-test="oncall-handoff-mode-team">
            {{ t("oncall.handoffToTeam") }}
          </OToggleGroupItem>
        </OToggleGroup>

        <p class="text-text-muted text-sm" data-test="oncall-handoff-hint">
          {{ handoffMode === "team" ? t("oncall.handoffTeamHint") : t("oncall.handoffPersonHint") }}
        </p>

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
      </div>

      <template #footer>
        <div class="flex justify-end gap-2">
          <OButton variant="outline" size="sm-action" @click="showHandoff = false">
            {{ t("oncall.cancel") }}
          </OButton>
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
      </template>
    </ODrawer>

    <ODialog
      :open="confirmRecoveryOpen"
      @update:open="(v: boolean) => (confirmRecoveryOpen = v)"
      :title="t('oncall.confirmRecoveryTitle')"
      data-test="oncall-confirm-recovery-dialog"
    >
      <div class="flex flex-col gap-3">
        <p class="text-text-muted text-sm">{{ t("oncall.confirmRecoveryMessage") }}</p>
        <OInput
          v-model="recoveryNote"
          :label="t('oncall.confirmRecoveryNote')"
          :placeholder="t('oncall.confirmRecoveryNotePlaceholder')"
          data-test="oncall-confirm-recovery-note"
        />
      </div>
      <template #footer>
        <div class="flex justify-end gap-2">
          <OButton variant="outline" size="sm-action" @click="confirmRecoveryOpen = false">
            {{ t("oncall.cancel") }}
          </OButton>
          <OButton
            variant="primary"
            size="sm-action"
            :loading="confirmingRecovery"
            data-test="oncall-confirm-recovery-confirm"
            @click="confirmRecovery"
          >
            {{ t("oncall.confirmRecovery") }}
          </OButton>
        </div>
      </template>
    </ODialog>

    <ODialog
      :open="promoteOpen"
      @update:open="(v: boolean) => (promoteOpen = v)"
      :title="t('oncall.promoteTitle')"
      data-test="oncall-promote-dialog"
    >
      <div class="flex flex-col gap-3">
        <p class="text-text-muted text-sm">{{ t("oncall.promoteMessage") }}</p>

        <OInput
          v-model="promoteTitle"
          :label="t('oncall.promoteIncidentTitle')"
          :placeholder="t('oncall.promoteIncidentTitlePlaceholder')"
          data-test="oncall-promote-title"
        />

        <!-- Only P1 up to this record's own severity is offered. "A promotion
             may raise the severity but must never lower what already woke
             somebody" is an invariant the handler states and does not enforce
             — it takes whatever string it is sent — so the picker is where it
             holds. -->
        <div class="flex flex-col gap-1">
          <span class="text-text-label text-xs">{{ t("oncall.promoteSeverity") }}</span>
          <span class="text-text-muted text-xs">{{ t("oncall.promoteSeverityHint") }}</span>
          <OSelect
            v-model="promoteSeverity"
            :options="severityOptions"
            data-test="oncall-promote-severity"
          />
        </div>
      </div>

      <template #footer>
        <div class="flex justify-end gap-2">
          <OButton variant="outline" size="sm-action" @click="promoteOpen = false">
            {{ t("oncall.cancel") }}
          </OButton>
          <OButton
            variant="primary"
            size="sm-action"
            :loading="promoting"
            data-test="oncall-promote-confirm"
            @click="promoteRecord"
          >
            {{ t("oncall.promote") }}
          </OButton>
        </div>
      </template>
    </ODialog>

    <ODialog
      :open="confirmResolve"
      @update:open="(v: boolean) => (confirmResolve = v)"
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
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useStore } from "vuex";

import OButton from "@/lib/core/Button/OButton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";

import OnCallDeliveryLedger from "@/components/oncall/OnCallDeliveryLedger.vue";
import OnCallEscalation from "@/components/oncall/OnCallEscalation.vue";
import OContent from "@/lib/core/Content/OContent.vue";
import OStatStrip from "@/lib/data/StatStrip/OStatStrip.vue";
import type { StatItem } from "@/lib/data/StatStrip/OStatStrip.types";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import OTabPanels from "@/lib/navigation/Tabs/OTabPanels.vue";
import OTabPanel from "@/lib/navigation/Tabs/OTabPanel.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import OnCallFiringHistory from "@/components/oncall/OnCallFiringHistory.vue";
import OnCallPriorCauses from "@/components/oncall/OnCallPriorCauses.vue";
import OnCallTimeline from "@/components/oncall/OnCallTimeline.vue";
import OnCallVerdictCard from "@/components/oncall/OnCallVerdictCard.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import OTextarea from "@/lib/forms/Input/OTextarea.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import alertsService from "@/services/alerts";
import oncallService from "@/services/oncall";
import type {
  DeliveryRecord,
  CauseGroup,
  EscalationProgress,
  OnCallResponse,
  OnCallResponseEvent,
  PromoteSeverity,
  ResolutionCause,
} from "@/ts/interfaces/oncall";
import { RESOLUTION_CAUSES } from "@/ts/interfaces/oncall";
import type { I18nText } from "@/types/i18n";
import { raw, useI18nTyped } from "@/types/i18n";
import { useOnCallClock } from "@/composables/useOnCallClock";
import {
  isEscalating,
  isSnoozed,
  isUnresolved,
  promoteSeverityFloor,
  promoteSeverityOptions,
  routingReasonOf,
} from "@/utils/oncall";
import { formatMicrosDuration } from "@/utils/formatters";

const { t } = useI18nTyped();
const nowMicros = useOnCallClock();
const store = useStore();
const route = useRoute();
const router = useRouter();

const response = ref<OnCallResponse | null>(null);
const events = ref<OnCallResponseEvent[]>([]);
const teamName = ref("");
const loading = ref(false);
const resolving = ref(false);
const confirmRecoveryOpen = ref(false);
const confirmingRecovery = ref(false);
const recoveryNote = ref("");

/// An impacted record was opened alongside another team's page to contain the
/// blast radius on THIS team's service. The role is always on the wire and the
/// origin id says the same thing (§ "UI rule"); either one is enough, and an
/// older record written before the role column is still readable.
const isImpacted = computed(
  () =>
    response.value?.responder_role === "impacted" || !!response.value?.origin_response_id,
);

/// The dependent's close. The owner's record closes on its own once the last
/// dependent has confirmed — which may be this call.
async function confirmRecovery() {
  confirmingRecovery.value = true;
  try {
    await oncallService.confirmRecovery({
      org_identifier: orgId.value,
      response_id: responseId.value,
      data: recoveryNote.value.trim() ? { note: recoveryNote.value.trim() } : undefined,
    });
    confirmRecoveryOpen.value = false;
    recoveryNote.value = "";
    toast({ variant: "success", message: t("oncall.recoveryConfirmed") });
    await fetchResponse();
  } catch (err: any) {
    toast({
      variant: "error",
      message: raw(err?.response?.data?.message) || t("oncall.confirmRecoveryFailed"),
    });
  } finally {
    confirmingRecovery.value = false;
  }
}
const promoteOpen = ref(false);
const promoting = ref(false);
const promoteTitle = ref("");
const promoteSeverity = ref<PromoteSeverity>("P4");

/// What a promotion may be set to on THIS record, most severe first, floored
/// at its own priority.
const severityOptions = computed(() =>
  promoteSeverityOptions(response.value?.priority ?? 5).map((severity) => ({
    label: raw(severity),
    value: severity,
  })),
);

/// The record's own severity is the default: the wire derives exactly this
/// when no severity is sent, so the picker opens on the answer rather than on
/// an empty box somebody has to fill in mid-incident.
watch(
  [response, promoteOpen],
  () => {
    if (!promoteOpen.value || !response.value) return;
    promoteTitle.value = response.value.title || "";
    promoteSeverity.value = promoteSeverityFloor(response.value.priority);
  },
  { immediate: true },
);

/// Makes an incident out of a page that turned out to be one. The refusal path
/// matters as much as the success one: a 409 means somebody else promoted this
/// record while this dialog was open, so the record is refetched and the rail's
/// incident link is what the responder sees next.
async function promoteRecord() {
  promoting.value = true;
  try {
    const res = await oncallService.promoteResponse({
      org_identifier: orgId.value,
      response_id: responseId.value,
      data: {
        ...(promoteTitle.value.trim() ? { title: promoteTitle.value.trim() } : {}),
        severity: promoteSeverity.value,
      },
    });
    promoteOpen.value = false;
    toast({
      variant: "success",
      message: t("oncall.promoted", { incident: res.data.incident_id }),
    });
    await fetchResponse();
  } catch (err: any) {
    promoteOpen.value = false;
    toast({
      variant: "error",
      message: raw(err?.response?.data?.message) || t("oncall.promoteFailed"),
    });
    if (err?.response?.status === 409) await fetchResponse();
  } finally {
    promoting.value = false;
  }
}

const acking = ref(false);
const snoozing = ref(false);
const addingNote = ref(false);
const handingOff = ref(false);
const confirmResolve = ref(false);
const showHandoff = ref(false);
const tab = ref("overview");

// Local rather than imported from the SLO composable that also defines it:
// on-call has no business depending on that module for an em dash.
const ABSENT = raw("—");
const noteBody = ref("");
const resolveCause = ref<ResolutionCause | "">("");
const resolveNote = ref("");
const priorCauses = ref<CauseGroup[]>([]);
const firingHistory = ref<OnCallResponse[]>([]);
/// Only the two fields the page shows; the alert payload is large and the rest
/// of it belongs on the alert's own screen, which the subject row links to.
const subjectAlert = ref<{
  name?: string;
  stream_name?: string;
  stream_type?: string;
} | null>(null);
const escalation = ref<EscalationProgress | null>(null);
const handoffMode = ref<"person" | "team">("person");
const handoffPerson = ref("");
const handoffTeam = ref("");
const handoffNote = ref("");
const memberOptions = ref<{ label: I18nText; value: string }[]>([]);
const teamOptions = ref<{ label: I18nText; value: string }[]>([]);

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
  response.value
    ? raw(response.value.title || response.value.subject.source_id)
    : t("oncall.responseDetail"),
);

// Every action hangs off this. It asks "is this still somebody's problem",
// not "is the ladder running" — an acknowledged page still needs resolving.
const isOpenState = computed(
  () => !!response.value && isUnresolved(response.value.state),
);

/// Only an escalating page can be claimed. Once it is owned, Acknowledge and
/// Snooze are gone and Resolve becomes the primary action.
const canAcknowledge = computed(
  () => !!response.value && isEscalating(response.value.state),
);

const subtitle = computed(() =>
  response.value ? raw(`${response.value.subject.source_id} · ${teamName.value}`) : undefined,
);

/// The headline is "when does this wake somebody else" — the question a
/// responder actually has, previously buried mid-page.
const summaryStats = computed<StatItem[]>(() => {
  const r = response.value;
  const next = escalation.value?.next_at;
  const remaining = next ? next - nowMicros.value : null;
  return [
    {
      key: "escalatesIn",
      label: t("oncall.statEscalatesIn"),
      value: remaining && remaining > 0 ? formatMicrosDuration(remaining) : ABSENT,
      icon: "notifications-active",
      tone: remaining && remaining > 0 && remaining < 5 * 60 * 1_000_000 ? "error" : "neutral",
      dataTest: "oncall-stat-escalates-in",
    },
    {
      key: "ack",
      label: t("oncall.timeToAck"),
      value: timeToAck.value,
      icon: "check-circle",
      tone: "neutral",
      dataTest: "oncall-stat-ttack",
    },
    {
      key: "resolve",
      label: t("oncall.timeToResolve"),
      value: timeToResolve.value,
      icon: "task-alt",
      tone: "neutral",
      dataTest: "oncall-stat-ttr",
    },
    {
      key: "firing",
      label: t("oncall.firing"),
      value: r ? `#${r.subject.firing}` : ABSENT,
      icon: "format-list-numbered",
      tone: "neutral",
      dataTest: "oncall-stat-firing",
    },
  ];
});

const routingReason = computed(() => routingReasonOf(events.value));

/// The producer sends the rule's name as the record title, so the name is
/// known without the alert; the fetch below only adds what it cannot carry.
const subjectName = computed(
  () => subjectAlert.value?.name || response.value?.title || response.value?.subject.source_id,
);

/// Which stream the rule watches — context the record does not carry and the
/// page had nowhere else to get.
const subjectStream = computed(() => {
  const alert = subjectAlert.value;
  if (!alert?.stream_name) return null;
  return alert.stream_type ? `${alert.stream_name} (${alert.stream_type})` : alert.stream_name;
});

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
    await fetchSubjectAlert();
    await fetchHandoffTargets();
    await fetchPriorCauses();
    await fetchEscalation();
    await fetchDeliveries();
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
      label: raw(m.user_email),
      value: m.user_email,
    }));
  } catch {
    memberOptions.value = [];
  }
  try {
    const teams = await oncallService.listTeams({ org_identifier: orgId.value });
    teamOptions.value = (teams.data ?? [])
      .filter((tm: { id: string }) => tm.id !== response.value?.team_id)
      .map((tm: { id: string; name: string }) => ({ label: raw(tm.name), value: tm.id }));
  } catch {
    teamOptions.value = [];
  }
}

/// Only alerts have a rule to fetch, and a page whose alert has since been
/// deleted must still render — the record is the authority on what happened,
/// the alert only decorates it.
async function fetchSubjectAlert() {
  subjectAlert.value = null;
  if (response.value?.subject.subject_type !== "alert") return;
  try {
    const res = await alertsService.get_by_alert_id(
      orgId.value,
      response.value.subject.source_id,
    );
    subjectAlert.value = res.data ?? null;
  } catch {
    subjectAlert.value = null;
  }
}

// History is context, not the page itself: failing to load it must not stop a
// responder acting on what is in front of them. The two calls are independent,
// so one server without the history route still leaves the causes readable.
async function fetchPriorCauses() {
  const [causeRes, historyRes] = await Promise.allSettled([
    oncallService.priorCauses({
      org_identifier: orgId.value,
      response_id: responseId.value,
    }),
    oncallService.responseHistory({
      org_identifier: orgId.value,
      response_id: responseId.value,
    }),
  ]);
  priorCauses.value = causeRes.status === "fulfilled" ? (causeRes.value.data ?? []) : [];
  firingHistory.value = historyRes.status === "fulfilled" ? (historyRes.value.data ?? []) : [];
}

// Context, like the history: a failure here must not stop somebody acting on
// the page in front of them.
const deliveries = ref<DeliveryRecord[]>([]);
const deliveriesTotal = ref(0);
const deliveriesLoading = ref(false);

/// The receipt beside the claim: the timeline says "paged ana", the ledger
/// says whether the transport took it. A failure leaves the panel empty with
/// its own empty state — the rest of the page still answers its questions.
async function fetchDeliveries() {
  deliveriesLoading.value = true;
  try {
    const res = await oncallService.listDeliveries({
      org_identifier: orgId.value,
      response_id: responseId.value,
    });
    deliveries.value = res.data?.deliveries ?? [];
    deliveriesTotal.value = res.data?.total ?? 0;
  } catch {
    deliveries.value = [];
    deliveriesTotal.value = 0;
  } finally {
    deliveriesLoading.value = false;
  }
}

async function fetchEscalation() {
  try {
    const res = await oncallService.escalationProgress({
      org_identifier: orgId.value,
      response_id: responseId.value,
    });
    escalation.value = res.data ?? null;
  } catch {
    escalation.value = null;
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
