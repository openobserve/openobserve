<template>
  <OPageLayout
    bleed
    data-test="oncall-response-detail-page"
    :title="title"
    icon="notifications-active"
    :back="{ label: t('oncall.backToResponses'), to: { name: 'onCallResponses' } }"
  >
    <!-- Team, which firing this is, and when it opened — the tagline reads as
         one short line rather than a metadata grid below the fold. Team is a
         real link because "whose rotation is this" is the next click a
         responder makes; the firing count carries its history as a tooltip
         instead of a trailing clause, which is enough for "not the first
         time" without spelling out how many. -->
    <template v-if="response" #subtitle>
      <i18n-t
        keypath="oncall.responseSubtitle"
        tag="span"
        scope="global"
        class="flex min-w-0 items-center gap-1 truncate"
        data-test="oncall-response-subtitle"
      >
        <template #team>
          <router-link
            class="text-accent shrink-0 hover:underline"
            :to="teamRoute"
            data-test="oncall-response-team-link"
          >
            {{ raw(teamName) }}
          </router-link>
        </template>
        <template #firing>
          <span class="shrink-0" data-test="oncall-response-firing">
            #{{ response.subject.firing }}
            <OTooltip v-if="historyLabel">
              <template #content>{{ historyLabel }}</template>
            </OTooltip>
          </span>
        </template>
        <template #opened>
          <span class="truncate" data-test="oncall-response-opened">{{ openedAtClock }}</span>
        </template>
      </i18n-t>
    </template>

    <!-- The two facts a responder needs before anything else ride the title,
         rather than sitting in a metadata grid below the fold. -->
    <template #title-trail>
      <template v-if="response">
        <OTag type="alertPriority" :value="`p${response.priority}`" size="sm" />
        <OTag type="oncallResponseState" :value="response.state" size="sm" />
        <!-- How long it has been ringing, beside the word "ringing". The two
             were a stat tile apart, and the one people read first is the
             one that says how bad this already is. -->
        <span class="text-text-secondary text-xs" data-test="oncall-response-elapsed">
          {{ elapsedLabel }}
        </span>
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
        <OTooltip v-if="isImpacted" side="bottom" :content="t('oncall.ladderLiaisonNote')" />
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

        <!-- Escalate keeps this yours; hand off makes it theirs. Both verbs
             have existed server-side since the ladder did, and only one of
             them had a button. A disabled button that does not say why is a
             dead end — the ladder's own explanation for why there is nobody
             left to escalate to belongs right where the button went grey. -->
        <span class="inline-flex">
          <OButton
            variant="outline"
            size="sm-action"
            :loading="escalatingNow"
            :disabled="escalation?.exhausted"
            data-test="oncall-response-escalate-btn"
            @click="escalateNow"
          >
            {{ t("oncall.escalate") }}
          </OButton>
          <OTooltip v-if="escalation?.exhausted" :content="t('oncall.ladderExhausted')" />
        </span>

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
      <!-- OPageLayout keeps the body a fixed column (`scroll` off) so a table
           can own its own scroller. This page is a document, so the body is
           the scroller — without it the activity thread was clipped at the
           fold with no way to reach the rest. -->
      <OContent y class="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <!-- The one sentence this screen exists to say when it is true:
             nobody has seen this page, and here is why. -->
        <OnCallReachAlarm
          :state="response.state"
          :deliveries="deliveries"
          :deliveries-total="deliveriesTotal"
          :progress="escalation"
          :smtp-configured="smtpConfigured"
          :escalating="escalatingNow"
          @escalate="escalateNow"
          @open-reachability="openReachability"
        />

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

        <!-- The four facts a responder reads first, read once rather than
             assembled from the title tags and a description list further
             down the page. -->
        <OStatStrip :items="topStats" class="mb-4" data-test="oncall-response-stats" />

        <!-- Two columns rather than three tabs. Everything a responder needs
             to decide is on one screen: the tabs cost a click each for facts
             that were never optional, and the rail's answers — who this is
             reaching, what fires next, why this team — are the ones people
             opened the tabs to find. -->
        <div class="grid flex-1 grid-cols-1 gap-4 lg:grid-cols-3">
          <div class="flex flex-col gap-4 lg:col-span-2">
            <!-- Renders nothing until a verdict event exists (§G.7) — the
                 default deployment has no agent and must not show an
                 analysis panel that sits empty forever. -->
            <OnCallVerdictCard :events="events" />

            <!-- Activity, deliveries and prior causes used to be a card and two
                 collapsibles stacked on top of each other — only the first was
                 visible without a click, and the other two hid behind their
                 own expand toggle with no hint of what was inside. Tabs put
                 all three labels on screen at once, so which one has the
                 answer is a glance, not three clicks to find out. -->
            <OCard variant="glass" class="flex-1" data-test="oncall-response-tabs">
              <OCardSection role="header" dense class="flex-wrap items-center gap-2">
                <OTabs v-model="activeDetailTab" dense data-test="oncall-response-tabs-strip">
                  <OTab
                    name="activity"
                    :label="t('oncall.tabActivity')"
                    data-test="oncall-response-tab-activity"
                  />
                  <OTab
                    name="deliveries"
                    :label="t('oncall.deliveriesTitle')"
                    data-test="oncall-response-tab-deliveries"
                  />
                  <OTab
                    name="causes"
                    :label="t('oncall.tabPriorCauses')"
                    data-test="oncall-response-tab-causes"
                  />
                </OTabs>
                <OButton
                  v-if="activeDetailTab === 'activity'"
                  variant="ghost-primary"
                  size="sm"
                  class="ml-auto"
                  data-test="oncall-response-activity-toggle-all"
                  @click="showAllActivity = !showAllActivity"
                >
                  {{
                    showAllActivity
                      ? t("oncall.activityHideSystem")
                      : t("oncall.activityShowSystemCount", { count: systemActivityCount })
                  }}
                </OButton>
              </OCardSection>

              <OCardSection role="body" dense>
                <OTabPanels v-model="activeDetailTab">
                  <OTabPanel name="activity" data-test="oncall-response-activity">
                    <OnCallActivityTimeline
                      :events="events"
                      v-model:comment-text="noteBody"
                      v-model:show-all="showAllActivity"
                      :submitting="addingNote"
                      @submit="addNote"
                    />
                  </OTabPanel>

                  <!-- The receipt behind the ladder's claims. -->
                  <OTabPanel name="deliveries" data-test="oncall-response-deliveries">
                    <OnCallDeliveryLedger
                      :records="deliveries"
                      :total="deliveriesTotal"
                      :loading="deliveriesLoading"
                    />
                  </OTabPanel>

                  <!-- The history behind the rail's one-line summary. -->
                  <OTabPanel name="causes" data-test="oncall-response-causes">
                    <OnCallPriorCauses
                      :groups="priorCauses"
                      :loading="priorCausesLoading"
                      @open="openResponse"
                    />
                    <OnCallFiringHistory
                      class="mt-4"
                      :firings="firingHistory"
                      :loading="priorCausesLoading"
                      @open="openResponse"
                    />
                  </OTabPanel>
                </OTabPanels>
              </OCardSection>
            </OCard>
          </div>

          <div class="flex flex-col gap-4">
            <OnCallWhoIsOn
              :positions="onCallPositions"
              :deliveries="deliveries"
              :handover-at="handoverAt"
              :handover-to="handoverTo"
              :closed-at="response.closed_at"
              :acked-by="response.acked_by"
            />

            <OnCallWhatFired
              v-if="response.subject.subject_type === 'alert' && subjectAlert"
              :alert="subjectAlert"
            />

            <OnCallAboutPage
              :org-id="orgId"
              :team-id="response.team_id"
              :team-name="teamName"
              :subject-type="response.subject.subject_type"
              :source-id="response.subject.source_id"
              :routing-reason="routingReason"
              :subject-stream="subjectStream"
              :incident-id="response.incident_id"
              :cause="response.cause"
              :cause-note="response.cause_note"
              :prior-causes="priorCauses"
              :prior-firings="firingHistory.length"
            />
          </div>
        </div>
      </OContent>
    </template>

    <OnCallResponseDetailSkeleton v-else-if="loading" />

    <OEmptyState
      v-else
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

        <p class="text-text-secondary text-sm" data-test="oncall-handoff-hint">
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
        <p class="text-text-secondary text-sm">{{ t("oncall.confirmRecoveryMessage") }}</p>
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
        <p class="text-text-secondary text-sm">{{ t("oncall.promoteMessage") }}</p>

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
          <span class="text-text-secondary text-xs">{{ t("oncall.promoteSeverity") }}</span>
          <span class="text-text-secondary text-xs">{{ t("oncall.promoteSeverityHint") }}</span>
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
        <p class="text-text-secondary text-sm">{{ t("oncall.resolveMessage") }}</p>

        <!-- Asked HERE and nowhere else. A cause collected later is a cause
             never collected, and it is the only input the prior-causes panel
             has. -->
        <div class="flex flex-col gap-1">
          <span class="text-text-secondary text-xs">{{ t("oncall.resolveCause") }}</span>
          <span class="text-text-secondary text-xs">{{ t("oncall.resolveCauseHint") }}</span>
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
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useStore } from "vuex";

import OButton from "@/lib/core/Button/OButton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";

import OnCallAboutPage from "@/components/oncall/OnCallAboutPage.vue";
import OnCallDeliveryLedger from "@/components/oncall/OnCallDeliveryLedger.vue";
import OnCallReachAlarm from "@/components/oncall/OnCallReachAlarm.vue";
import OnCallWhatFired from "@/components/oncall/OnCallWhatFired.vue";
import OnCallWhoIsOn from "@/components/oncall/OnCallWhoIsOn.vue";
import OCard from "@/lib/core/Card/OCard.vue";
import OCardSection from "@/lib/core/Card/OCardSection.vue";
import OContent from "@/lib/core/Content/OContent.vue";
import OStatStrip from "@/lib/data/StatStrip/OStatStrip.vue";
import type { StatItem } from "@/lib/data/StatStrip/OStatStrip.types";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import OTabPanel from "@/lib/navigation/Tabs/OTabPanel.vue";
import OTabPanels from "@/lib/navigation/Tabs/OTabPanels.vue";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OnCallFiringHistory from "@/components/oncall/OnCallFiringHistory.vue";
import OnCallPriorCauses from "@/components/oncall/OnCallPriorCauses.vue";
import OnCallActivityTimeline from "@/components/oncall/OnCallActivityTimeline.vue";
import OnCallVerdictCard from "@/components/oncall/OnCallVerdictCard.vue";
import OnCallResponseDetailSkeleton from "./OnCallResponseDetailSkeleton.vue";
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
  EscalateResult,
  EscalationProgress,
  OnCallPolicy,
  OnCallResponse,
  OnCallResponseEvent,
  OnCallPosition,
  PromoteSeverity,
  ResolutionCause,
} from "@/ts/interfaces/oncall";
import { RESOLUTION_CAUSES } from "@/ts/interfaces/oncall";
import type { I18nText } from "@/types/i18n";
import { raw, useI18nTyped } from "@/types/i18n";
import { useOnCallClock } from "@/composables/useOnCallClock";
import {
  DEFAULT_ACTIVITY_KINDS,
  isEscalating,
  isSnoozed,
  isUnresolved,
  promoteSeverityFloor,
  promoteSeverityOptions,
  routingReasonOf,
} from "@/utils/oncall";
import { formatMicrosDuration } from "@/utils/formatters";
import { formatTimestampInTimezone } from "@/utils/date";

const { t } = useI18nTyped();
const nowMicros = useOnCallClock();
const store = useStore();
const route = useRoute();
const router = useRouter();

const response = ref<OnCallResponse | null>(null);
const events = ref<OnCallResponseEvent[]>([]);
const systemActivityCount = computed(
  () => events.value.filter((e) => !DEFAULT_ACTIVITY_KINDS.includes(e.kind)).length,
);
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
const escalatingNow = ref(false);

// Local rather than imported from the SLO composable that also defines it:
// on-call has no business depending on that module for an em dash.
const ABSENT = raw("—");
const noteBody = ref("");
const showAllActivity = ref(true);
/// Activity, deliveries and prior causes as tabs of one card rather than a
/// card plus two collapsibles — the toggle-all button in the header only
/// makes sense while activity is the one showing.
const activeDetailTab = ref("activity");
const resolveCause = ref<ResolutionCause | "">("");
const resolveNote = ref("");
const priorCauses = ref<CauseGroup[]>([]);
const firingHistory = ref<OnCallResponse[]>([]);
const priorCausesLoading = ref(false);
/// Only the fields the page shows — the stream, and the condition that
/// tripped it; the rest of the payload belongs on the alert's own screen,
/// which the subject row links to. `query_condition`/`condition` is `any`
/// because `alertConditionText` (shared with the alert's own config summary)
/// already treats it that way — the same rule read by two screens.
const subjectAlert = ref<{
  name?: string;
  stream_name?: string;
  stream_type?: string;
  query_condition?: any;
  condition?: any;
} | null>(null);
const escalation = ref<EscalationProgress | null>(null);
/// Who a page to this team reaches right now, and where the pager goes next.
const onCallPositions = ref<OnCallPosition[]>([]);
const handoverAt = ref<number | null>(null);
const handoverTo = ref<string | null>(null);
/// The team's own policy, for the one thing progress cannot say: what the
/// ladder does after its last rung.
const policy = ref<OnCallPolicy | null>(null);
/// `false` is the server's finding that no mail can leave this deployment —
/// the usual reason every row of the ledger failed. `null` is "not answered",
/// which is not the same thing and must never be rendered as a cause.
const smtpConfigured = ref<boolean | null>(null);
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

/// Where the team-name link in the subtitle goes — same target and tab
/// OnCallAboutPage's own team row links to, so the two agree on what
/// clicking the team means.
const teamRoute = computed(() => ({
  name: "onCallTeamDetail",
  params: { teamId: response.value?.team_id ?? "", tab: "overview" },
  query: { org_identifier: orgId.value },
}));

/// The subtitle used to spell out "first page from this subject" / "N earlier
/// firings" inline, which made a one-line tagline read as a paragraph. The
/// firing count alone says "this isn't the first time" (or is); the rest is a
/// tooltip on that count instead of a trailing clause, and the same prose the
/// About card already carries.
const historyLabel = computed(() =>
  firingHistory.value.length
    ? t("oncall.historyFirings", { count: firingHistory.value.length }, firingHistory.value.length)
    : t("oncall.historyFirstPage"),
);

/// Clock time, not "N ago" — the elapsed duration is already said once, beside
/// the title tags, and repeating it here as "opened 2 hours ago" would just be
/// the same fact twice in two words.
const openedAtClock = computed(() => {
  const r = response.value;
  if (!r) return "";
  return formatTimestampInTimezone(r.opened_at, "HH:mm", store.state.timezone);
});

/// How long this has been somebody's problem. An open page reads as elapsed;
/// a closed one stops at the moment it closed, rather than counting forever.
const elapsedLabel = computed(() => {
  const r = response.value;
  if (!r) return "";
  const end = r.closed_at ?? nowMicros.value;
  return formatMicrosDuration(end - r.opened_at);
});

/// Until somebody acks, "time to ack" is a clock still running, and freezing
/// it at a dash hid the number the SLA is measured on.
const ackLabel = computed(() => {
  const r = response.value;
  const openMicros = r ? nowMicros.value - r.opened_at : null;
  return r?.acked_at || !openMicros ? t("oncall.timeToAck") : t("oncall.statUnackedFor");
});

const ackValue = computed(() => {
  const r = response.value;
  const openMicros = r ? nowMicros.value - r.opened_at : null;
  if (r?.acked_at) return timeToAck.value;
  return openMicros ? formatMicrosDuration(openMicros) : ABSENT;
});

const resolveLabel = computed(() => {
  const r = response.value;
  const openMicros = r ? nowMicros.value - r.opened_at : null;
  return r?.closed_at || !openMicros ? t("oncall.timeToResolve") : t("oncall.statOpenFor");
});

const resolveValue = computed(() => {
  const r = response.value;
  const openMicros = r ? nowMicros.value - r.opened_at : null;
  if (r?.closed_at) return timeToResolve.value;
  return openMicros ? formatMicrosDuration(openMicros) : ABSENT;
});

/// How far up the ladder a page got, said as the rung rather than as a delay.
///
/// **`reached_rung_micros` is omitted when no page went out, and `0` is a real
/// and common value** meaning it never left the first rung — so `if (micros)`
/// is a bug here and the test is for `undefined`.
///
/// The number on the wire is the rung's `after_micros`, which is a delay, not
/// an index. Matching it back against the policy's own steps is what turns it
/// into "rung 2 of 5"; without a policy to match against, the delay is still
/// more honest than nothing.
const reachedRung = computed<I18nText | string>(() => {
  const micros = response.value?.reached_rung_micros;
  if (micros === undefined || micros === null) return ABSENT;
  const steps = policy.value?.rungs.find((rung) => rung.priority === response.value?.priority)
    ?.steps;
  const index = steps?.findIndex((step) => step.after_micros === micros) ?? -1;
  if (index < 0 || !steps) return raw(`+${formatMicrosDuration(micros)}`);
  return t("oncall.statReachedRungOf", { n: index + 1, total: steps.length });
});

/// The four facts a responder reads first — read once at the top rather than
/// pieced together from the title tags and the "who is on" card below.
const topStats = computed<StatItem[]>(() => {
  const r = response.value;
  if (!r) return [];
  return [
    {
      key: "ack",
      label: ackLabel.value,
      value: ackValue.value,
      icon: "check-circle",
      tone: r.acked_at ? "success" : "warning",
      dataTest: "oncall-response-stat-ack",
    },
    {
      key: "resolve",
      label: resolveLabel.value,
      value: resolveValue.value,
      icon: "check-circle",
      tone: r.closed_at ? "success" : "warning",
      dataTest: "oncall-response-stat-resolve",
    },
    {
      key: "rung",
      label: t("oncall.statReachedRung"),
      value: reachedRung.value,
      icon: "trending-up",
      tone: "warning",
      dataTest: "oncall-response-stat-rung",
    },
    {
      key: "firing",
      label: t("oncall.firing"),
      value: `#${r.subject.firing}`,
      icon: "format-list-numbered",
      tone: "neutral",
      dataTest: "oncall-response-stat-firing",
    },
  ];
});

const routingReason = computed(() => routingReasonOf(events.value));

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
    await fetchTeamContext();
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
  priorCausesLoading.value = true;
  try {
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
  } finally {
    priorCausesLoading.value = false;
  }
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

/**
 * The rail's four answers — who is on, when the pager changes hands, what the
 * ladder does at the end, and whether mail can leave this deployment.
 *
 * Every one is context. A page a responder can act on must render when all
 * four fail, so nothing here is allowed to throw and none of it gates the
 * record.
 */
async function fetchTeamContext() {
  const r = response.value;
  if (!r) return;
  const [slots, policyRes, reach] = await Promise.allSettled([
    // A closed record is history, and the live rotation is not its history:
    // hours later the pager has moved on, and the rail named whoever holds it
    // now as though they had been the one paged. The schedule endpoint answers
    // as of any instant, so a closed record asks it about its own last moment.
    oncallService.whoIsOnCall({
      org_identifier: orgId.value,
      team_id: r.team_id,
      at: r.closed_at ?? undefined,
    }),
    oncallService.getPolicy({ org_identifier: orgId.value, team_id: r.team_id }),
    oncallService.teamReachability({ org_identifier: orgId.value, team_id: r.team_id }),
  ]);
  onCallPositions.value = slots.status === "fulfilled" ? (slots.value.data ?? []) : [];
  policy.value = policyRes.status === "fulfilled" ? (policyRes.value.data ?? null) : null;
  smtpConfigured.value =
    reach.status === "fulfilled" ? (reach.value.data?.smtp_configured ?? null) : null;
  await fetchHandover();
}

/// When the default slot's current span ends, and who inherits it. The
/// on-call payload names the next person but not the hour, and a page still
/// open at handover is one somebody inherits without being told.
async function fetchHandover() {
  handoverAt.value = null;
  handoverTo.value = null;
  const r = response.value;
  if (!r) return;
  // Who inherits the pager next is advice for a page somebody still has to
  // carry. On a closed one it is a fact about next week's rota that nobody
  // opened this record to read.
  if (r.closed_at) return;
  const from = nowMicros.value;
  const to = from + 7 * 24 * 60 * 60 * 1_000_000;
  try {
    const res = await oncallService.resolvedSchedule({
      org_identifier: orgId.value,
      team_id: r.team_id,
      from,
      to,
    });
    const segments = [...(res.data ?? [])].sort((a, b) => a.from - b.from);
    const currentIndex = segments.findIndex((seg) => seg.from <= from && seg.to > from);
    if (currentIndex < 0) return;
    handoverAt.value = segments[currentIndex].to;
    // A gap after the current shift is a real answer — the pager goes to
    // nobody — so the name is left unset rather than skipped forward.
    handoverTo.value = segments[currentIndex + 1]?.user_email ?? null;
  } catch {
    // A team with no resolved schedule simply has no handover row.
  }
}

/// What the escalation actually did, from the response the verb already sends.
///
/// "Escalated" alone is a claim; the person who pressed it wants to know which
/// phone is ringing. The 200 body carries `recipients`, `chased` (reached again
/// although a page had already landed on them) and `deduplicated` (skipped for
/// the same reason), and all four fields were being thrown away for a fixed
/// sentence.
///
/// `ladder_exhausted` arrives as a 200, deliberately — "there is nobody above
/// you" is an answer, not a failure — so it is said plainly rather than as an
/// error, which would read as though the press failed and invite a second one.
/// It is not a success either: nothing advanced, so the toast reports it as
/// `info` rather than reusing the green checkmark a real escalation gets.
function escalateOutcome(result: EscalateResult | undefined): {
  variant: "success" | "info";
  message: I18nText;
} {
  if (result?.escalated_to === "ladder_exhausted") {
    return { variant: "info", message: t("oncall.escalateExhausted", { team: teamName.value }) };
  }
  const reached = result?.escalated_to === "rung" ? [...result.recipients, ...result.chased] : [];
  if (!reached.length) {
    // A rung that resolved to nobody is a real outcome and the one worth
    // saying loudest: the ladder moved and no phone rang.
    return { variant: "success", message: t("oncall.escalatedNobody", { team: teamName.value }) };
  }
  return {
    variant: "success",
    message: t("oncall.escalatedTo", {
      team: teamName.value,
      who: raw(reached.join(", ")),
    }),
  };
}

/// Wakes the next rung now instead of when the timer says so. Ownership does
/// not move — this is asking for more hands, which is what separates it from
/// a handoff.
async function escalateNow() {
  escalatingNow.value = true;
  try {
    const res = await oncallService.escalateNow({
      org_identifier: orgId.value,
      response_id: responseId.value,
    });
    toast(escalateOutcome(res.data));
    await fetchResponse();
  } catch (err: any) {
    toast({
      variant: "error",
      message: raw(err?.response?.data?.message) || t("oncall.escalateFailed"),
    });
  } finally {
    escalatingNow.value = false;
  }
}

/// The two rail links out. Both land on the tab that answers the question the
/// reader had when they clicked, rather than on the team's front page.
function openReachability() {
  if (!response.value) return;
  router.push({
    name: "onCallTeamDetail",
    params: { teamId: response.value.team_id, tab: "members" },
    query: { org_identifier: orgId.value },
  });
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

// The origin-response link stays on this same route with a new responseId
// param, so Vue Router reuses this instance instead of remounting it — the
// fetch has to key off responseId directly rather than firing once on mount.
watch(responseId, fetchResponse, { immediate: true });
</script>
