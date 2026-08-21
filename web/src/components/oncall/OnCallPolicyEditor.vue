<template>
  <!-- The ladder is wide — a step is a wait, a row of target chips and a
       resolved preview on one line. Editing it in place squeezed all three
       into the tab column and pushed the read view off screen; the drawer
       gives it the width and leaves the dry run visible underneath. -->
  <ODrawer
    :open="props.open"
    size="xxl"
    :title="t('oncall.escalationEditing')"
    :sub-title="t('oncall.policyHint')"
    bleed
    data-test="oncall-policy-editor"
    @update:open="(v: boolean) => emit('update:open', v)"
  >
    <!-- `bleed` because the chip bar spans the full width and supplies its own
         inset; everything below keeps the drawer's standard one. -->
    <!-- Same chips as the read view, so editing feels like the ladder
         becoming editable rather than a different screen. One priority at a
         time: five stacked ladders was a page nobody could scan. Sticky,
         because a long ladder scrolls the only thing saying which priority
         you are editing off the top. -->
    <div
      class="bg-dialog-bg border-dialog-header-border px-dialog-content-px py-dialog-content-py sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b"
      data-test="oncall-policy-priority-bar"
    >
      <OButton
        v-for="rung in draft"
        :key="rung.priority"
        :variant="rung.priority === selected ? 'primary' : 'outline'"
        size="xs"
        :data-test="`oncall-policy-priority-${rung.priority}`"
        @click="selected = rung.priority"
      >
        {{ priorityLabel(rung.priority) }}
        {{
          rung.steps.length
            ? t("oncall.policyChipSteps", { count: rung.steps.length }, rung.steps.length)
            : t("oncall.reachPagesNobody")
        }}
      </OButton>
    </div>

    <div class="px-dialog-content-px py-dialog-content-py flex flex-col gap-4">
      <div
        v-if="current"
        :key="current.priority"
        class="flex flex-col gap-4"
        data-test="oncall-policy-rung"
      >
        <!-- The whole ladder as one sentence, before any of the controls. The
             editor is built out of target KINDS and absolute offsets; this is
             the plain reading of what they add up to. -->
        <OBanner variant="info" icon="bolt" dense inline-actions data-test="oncall-policy-sentence">
          {{ ladderSentence }}
        </OBanner>

        <div class="flex flex-col gap-2">
          <OText variant="section" as="div">{{ t("oncall.policyStepsSection") }}</OText>

          <!-- The ladder, as a ladder: a rail of steps with the wait edited on
               the connector BETWEEN them. "If nobody acknowledges in 5m" is
               the sentence an operator thinks in; a delay field inside the
               row made every step an absolute offset they had to subtract. -->
          <div
            v-if="current.steps.length"
            class="border-border-default rounded-surface flex flex-col border"
            :data-test="`oncall-policy-preview-${current.priority}`"
          >
            <template v-for="(step, stepIndex) in current.steps" :key="stepIndex">
              <!-- Connector: the wait that puts this step where it is. Only
                   between steps — the first page's own delay is edited in the
                   step's own offset cell, where the reader is already looking. -->
              <div
                v-if="stepIndex > 0"
                class="border-border-default flex flex-wrap items-center gap-2 border-t py-2 ps-24 pe-3"
              >
                <OText variant="label">{{ t("oncall.policyIfNoAck") }}</OText>
                <span class="w-36">
                  <OSelect
                    :model-value="gapBefore(current, stepIndex)"
                    :options="gapOptions"
                    size="sm"
                    :data-test="`oncall-policy-step-delay-${current.priority}-${stepIndex}`"
                    @update:model-value="(v: any) => setGap(current!, stepIndex, Number(v))"
                  />
                </span>
              </div>

              <!-- The step. -->
              <div
                class="flex flex-wrap items-center gap-2 px-3 py-2"
                :class="stepIndex > 0 ? 'border-border-default border-t' : ''"
                :data-test="`oncall-policy-rung-${current.priority}-${stepIndex}`"
              >
                <!-- The offset cell. On the first step it is a control, because
                     "page at once" and "hold the first page five minutes" is a
                     real choice a P2 makes; below it the offset is the sum of
                     the waits above and is stated, not set. -->
                <span class="w-20 shrink-0">
                  <OSelect
                    v-if="stepIndex === 0"
                    :model-value="step.after_micros"
                    :options="leadGapOptions"
                    appearance="inline"
                    size="sm"
                    :data-test="`oncall-policy-step-delay-${current.priority}-0`"
                    @update:model-value="(v: any) => setGap(current!, 0, Number(v))"
                  />
                  <OText v-else variant="mono">
                    {{ raw(`+${formatMicrosDuration(step.after_micros)}`) }}
                  </OText>
                </span>

                <OText variant="label">{{ t("oncall.rungPages") }}</OText>

                <OTag
                  v-for="(target, ti) in step.targets"
                  :key="ti"
                  variant="default-soft"
                  size="sm"
                  :data-test="`oncall-policy-target-${current.priority}-${stepIndex}-${ti}`"
                >
                  {{ describeTarget(target, t, rotationNameOf(target)) }}
                  <button
                    type="button"
                    class="ml-1"
                    :aria-label="t('oncall.removeTarget')"
                    :data-test="`oncall-policy-target-remove-${current.priority}-${stepIndex}-${ti}`"
                    @click="step.targets.splice(ti, 1)"
                  >
                    {{ raw("×") }}
                  </button>
                </OTag>

                <span class="w-40">
                  <OSelect
                    :model-value="''"
                    :options="targetOptions"
                    size="sm"
                    :placeholder="t('oncall.addTarget')"
                    :data-test="`oncall-policy-add-target-${current.priority}-${stepIndex}`"
                    @update:model-value="(v: any) => addTarget(step, String(v))"
                  />
                </span>

                <!-- A person target needs a name, so it asks rather than
                     adding an empty chip the server would reject on save. -->
                <span v-if="pendingUserStep === step" class="w-52">
                  <OSelect
                    :model-value="''"
                    :options="memberOptions"
                    size="sm"
                    :placeholder="t('oncall.targetPickPerson')"
                    :data-test="`oncall-policy-pick-person-${current.priority}-${stepIndex}`"
                    @update:model-value="(v: any) => addUser(String(v))"
                  />
                </span>

                <!-- Same reason, for a rotation target: a level pointed at a
                     rotation the team does not have pages nobody and the ladder
                     skips it in silence, which `config-risks` reports as
                     `level_names_a_rotation_that_does_not_exist`. Asking here
                     is how it never gets written. -->
                <span v-if="pendingRotation?.step === step" class="w-52">
                  <OSelect
                    :model-value="''"
                    :options="rotationOptions"
                    size="sm"
                    :placeholder="t('oncall.targetPickRotation')"
                    :data-test="`oncall-policy-pick-rotation-${current.priority}-${stepIndex}`"
                    @update:model-value="(v: any) => addRotation(String(v))"
                  />
                </span>

                <!-- Who this step wakes, resolved against the rotation in
                     force right now — the question a ladder built out of
                     target KINDS never answers. On the same line as the step,
                     because it is the answer to that line. -->
                <template
                  v-for="(line, i) in [resolveLadder(current, onCallNow, props.rotations)[stepIndex]]"
                  :key="i"
                >
                  <span v-if="line?.people.length" class="flex items-center gap-2">
                    <span class="flex -space-x-1">
                      <OAvatar
                        v-for="email in line.people.slice(0, AVATARS_SHOWN)"
                        :key="email"
                        :value="email"
                        class="ring-surface-base ring-2"
                      />
                    </span>
                    <OText variant="meta">
                      {{ t("oncall.policyTodayIs", { who: raw(line.people.join(", ")) }) }}
                    </OText>
                  </span>

                  <span v-if="line?.wholeTeam" class="flex items-center gap-2">
                    <span class="flex -space-x-1">
                      <OAvatar
                        v-for="member in teamMembers.slice(0, AVATARS_SHOWN)"
                        :key="member"
                        :value="member"
                        class="ring-surface-base ring-2"
                      />
                    </span>
                    <OText variant="meta">
                      {{
                        t(
                          "oncall.policyPeopleCount",
                          { count: teamMembers.length },
                          teamMembers.length,
                        )
                      }}
                    </OText>
                  </span>

                  <OText variant="meta" v-for="pool in line?.pools ?? []" :key="pool">
                    {{ t("oncall.ladderPoolEveryone", { rotation: raw(pool) }) }}
                  </OText>

                  <!-- A level naming a rotation the team no longer has advanced
                       in silence. It is a high risk server-side; here it is the
                       one thing on the row that must not read as merely
                       uncovered. -->
                  <span
                    v-for="gone in line?.missingRotations ?? []"
                    :key="gone"
                    class="text-status-error-text text-sm"
                    :data-test="`oncall-policy-missing-rotation-${current.priority}-${stepIndex}`"
                  >
                    {{ t("oncall.ladderRotationGone") }}
                  </span>

                  <span
                    v-if="
                      line &&
                      !line.people.length &&
                      !line.wholeTeam &&
                      !line.pools.length &&
                      !line.missingRotations.length
                    "
                    class="text-status-warning-text text-sm"
                    :data-test="`oncall-policy-preview-nobody-${current.priority}-${stepIndex}`"
                  >
                    {{ t("oncall.ladderReachesNobody") }}
                  </span>
                </template>

                <OButton
                  variant="ghost"
                  size="icon-sm"
                  icon-left="delete-outline"
                  class="ms-auto"
                  :aria-label="t('oncall.removeRung')"
                  :data-test="`oncall-policy-remove-rung-${current.priority}-${stepIndex}`"
                  @click="removeStep(current!, stepIndex)"
                />
              </div>
            </template>

            <!-- What the ladder does when it runs out is part of its shape, so
                 it is edited here rather than described here. Both halves are
                 one control because "runs twice" and "then stops" are one
                 decision read as one sentence. -->
            <div class="border-border-default flex flex-col gap-1 border-t px-3 py-2">
              <div class="flex flex-wrap items-center gap-2">
                <OText variant="label">{{ t("oncall.policyWhenStepsRunOut") }}</OText>
                <span class="w-64">
                  <OSelect
                    :model-value="ladderEnd"
                    :options="ladderEndOptions"
                    size="sm"
                    data-test="oncall-policy-ladder-end-select"
                    @update:model-value="(v: unknown) => setLadderEnd(String(v))"
                  />
                </span>
              </div>
              <!-- The option label cannot name the org's catch-all team; this
                   line can, and that is the difference between "hands off" and
                   "hands off to Platform". -->
              <OText variant="meta" data-test="oncall-policy-ladder-end">
                {{ ladderEndLine }}
              </OText>
              <!-- §G.9 #9: notify_default_team with nobody nominated is
                   indistinguishable from stop — the ladder ends silently while
                   the policy reads as having a safety net. Said HERE, where the
                   policy is being written, not on a routing screen the author
                   may never open. -->
              <span
                v-if="defaultTeamMissing"
                class="text-status-warning-text text-xs"
                data-test="oncall-policy-no-default-warning"
              >
                {{ t("oncall.policyNoDefaultTeam") }}
              </span>
            </div>
          </div>

          <OText variant="body" v-else data-test="oncall-policy-silent">
            {{
              t("oncall.policyPrioritySilent", { priority: raw(priorityLabel(current.priority)) })
            }}
          </OText>

          <div class="flex flex-wrap items-center gap-2">
            <OButton
              variant="ghost-primary"
              size="sm-action"
              icon-left="add"
              :data-test="`oncall-policy-add-step-${current.priority}`"
              @click="addStep(current)"
            >
              {{ t("oncall.policyAddStep") }}
            </OButton>
          </div>
        </div>
      </div>

      <!-- Everything that is not the ladder: how the pages get out, and what
           the agent does before they do. Both are set once and then read at a
           glance, so both are folded behind a summary of what they say now. -->
      <div class="flex flex-col gap-2">
        <OnCallPolicySection
          ref="deliverySection"
          icon="activity"
          :title="t('oncall.policyDeliveryTitle')"
          :description="t('oncall.policyDeliveryHint')"
          :summary="deliverySummary"
          data-test="oncall-policy-delivery"
        >
          <template #badge>
            <OTag
              v-if="deliveryProblems"
              variant="error-soft"
              size="xs"
              data-test="oncall-policy-delivery-problems"
            >
              {{ t("oncall.policyProblemCount", { count: deliveryProblems }, deliveryProblems) }}
            </OTag>
          </template>

          <!-- Outside the fold: the webhook channel being on with nowhere to
               post looks identical to working, so the card must say so even
               while it is closed. -->
          <template #problems>
            <OBanner
              v-if="webhookEnabled && !destinations.length"
              variant="error-soft"
              icon="warning"
              dense
              inline-actions
              data-test="oncall-policy-destinations-warning"
            >
              {{ t("oncall.policyNoDestinationWarning") }}
              <template #actions>
                <OButton
                  variant="outline"
                  size="xs"
                  data-test="oncall-policy-destinations-fix"
                  @click="deliverySection?.expand()"
                >
                  {{ t("oncall.policyFix") }}
                </OButton>
              </template>
            </OBanner>
          </template>

          <!-- Channels apply to everyone paged at this priority; the primary
               and the secondary are not treated differently. -->
          <div v-if="current" class="flex flex-wrap items-center gap-2">
            <OText variant="label" class="w-32 shrink-0">{{ t("oncall.channels") }}</OText>
            <OCheckbox
              v-for="channel in CHANNELS"
              :key="channel"
              :model-value="current.channels.includes(channel)"
              :label="t(`oncall.channel_${channel}`)"
              :data-test="`oncall-policy-channel-${current.priority}-${channel}`"
              @update:model-value="
                (on: CheckboxModelValue) => toggleChannel(current!, channel, on === true)
              "
            />
            <OText variant="meta">
              {{
                t("oncall.policyChannelsHint", { priority: raw(priorityLabel(current.priority)) })
              }}
            </OText>
          </div>

          <!-- Ticking `webhook` above says HOW to page; this says WHERE. Without
               it the channel is on and delivers nowhere, which looks identical
               to working. -->
          <div v-if="webhookEnabled" class="flex flex-wrap items-center gap-2">
            <OText variant="label" class="w-32 shrink-0">
              {{ t("oncall.policyDestinations") }}
            </OText>
            <span class="w-72">
              <OSelect
                v-model="destinations"
                :options="destinationOptions"
                multiple
                size="sm"
                :placeholder="t('oncall.policyDestinationsPlaceholder')"
                data-test="oncall-policy-destinations"
              />
            </span>
            <OTag
              v-if="!destinations.length"
              variant="error-soft"
              size="xs"
              data-test="oncall-policy-destinations-empty"
            >
              {{ t("oncall.policyReachesNobody") }}
            </OTag>
            <OText v-else variant="meta">{{ t("oncall.policyDestinationsHint") }}</OText>
          </div>

          <!-- C15/C16: WHERE the team is talked to, beside the policy list it
               can override. `source` makes precedence visible — "I set the team
               channel and pages still go to the old room" has to be answerable
               here, not by paging somebody to find out. -->
          <div class="flex flex-wrap items-center gap-2" data-test="oncall-team-channel">
            <OText variant="label" class="w-32 shrink-0">
              {{ t("oncall.teamChannelTitle") }}
            </OText>
            <span class="w-72">
              <OSelect
                v-model="teamChannelDraft"
                :options="destinationOptions"
                multiple
                size="sm"
                :placeholder="t('oncall.teamChannelPlaceholder')"
                data-test="oncall-team-channel-select"
              />
            </span>
            <OTag
              v-if="teamChannel"
              :variant="teamChannel.source === 'team' ? 'primary-soft' : 'default-soft'"
              size="xs"
              data-test="oncall-team-channel-source"
            >
              {{
                teamChannel.source === "team"
                  ? t("oncall.teamChannelFromTeam")
                  : t("oncall.teamChannelFromPolicy")
              }}
            </OTag>
            <OButton
              variant="outline"
              size="sm-action"
              :loading="savingChannel"
              :disabled="!teamChannelDirty"
              data-test="oncall-team-channel-save"
              @click="saveTeamChannel(teamChannelDraft)"
            >
              {{ t("oncall.teamChannelSave") }}
            </OButton>
            <!-- Clearing is its own verb because null and [] are different
                 facts on the wire: back-to-policy versus silence-on-purpose. -->
            <OButton
              v-if="teamChannel?.source === 'team'"
              variant="ghost"
              size="sm-action"
              :loading="savingChannel"
              data-test="oncall-team-channel-clear"
              @click="saveTeamChannel(null)"
            >
              {{ t("oncall.teamChannelUsePolicy") }}
            </OButton>
            <!-- One post per firing, not a live room: the only transport is an
                 HTTP destination, which cannot edit what it already sent. Said
                 here so nobody designs an expectation the engine cannot meet. -->
            <OText variant="meta">{{ t("oncall.teamChannelHint") }}</OText>
            <span
              v-if="teamChannel && !teamChannel.destinations.length"
              class="text-status-warning-text text-xs"
              data-test="oncall-team-channel-silent"
            >
              {{ t("oncall.teamChannelSilent") }}
            </span>
          </div>
        </OnCallPolicySection>

        <!-- C11: the l0_json block. Wire rule: `l0` absent on the PUT means
             unchanged, so it is only included once the panel is touched —
             editing steps must never silently rewrite the gate. -->
        <OnCallPolicySection
          icon="notifications"
          :title="t('oncall.policyTriageTitle')"
          :description="t('oncall.l0Hint')"
          :summary="triageSummary"
          advanced
          data-test="oncall-policy-triage"
        >
          <template #badge>
            <OTag variant="success-soft" size="xs" data-test="oncall-policy-triage-state">
              {{ t("oncall.policyTriageOn") }}
            </OTag>
          </template>

          <OnCallL0Editor
            :l0="props.policy?.l0 ?? null"
            @update:l0="onL0Update"
            @update:valid="(v: boolean) => (l0Valid = v)"
          />
        </OnCallPolicySection>
      </div>
    </div>

    <template #footer>
      <div class="flex flex-wrap items-center justify-between gap-2">
        <!-- A ladder edit never reaches a page that is already climbing: the
             engine reads the policy once, when the record opens. -->
        <OText variant="meta" data-test="oncall-policy-scope-note">
          {{ t("oncall.policyAppliesToNewPages") }}
        </OText>
        <span class="flex gap-2">
          <OButton variant="outline" size="sm-action" @click="cancel">
            {{ t("oncall.cancel") }}
          </OButton>
          <OButton
            variant="primary"
            size="sm-action"
            :loading="saving"
            :disabled="!l0Valid"
            data-test="oncall-policy-save"
            @click="save"
          >
            {{ t("oncall.policySave") }}
          </OButton>
        </span>
      </div>
    </template>
  </ODrawer>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useStore } from "vuex";

import OnCallL0Editor from "@/components/oncall/OnCallL0Editor.vue";
import OnCallPolicySection from "@/components/oncall/OnCallPolicySection.vue";
import OAvatar from "@/lib/core/Avatar/OAvatar.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import type { CheckboxModelValue } from "@/lib/forms/Checkbox/OCheckbox.types";
import { toast } from "@/lib/feedback/Toast/useToast";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import destinationService from "@/services/alert_destination";
import { useOnCallRoutingConfig } from "@/composables/useOnCallRoutingConfig";
import oncallService from "@/services/oncall";
import type {
  Channel,
  TeamChannel,
  EscalationTarget,
  L0Policy,
  LadderStep,
  OnCallPolicy,
  OnCallPosition,
  PolicyFinalAction,
  PriorityRung,
  Rotation,
  RotationMode,
} from "@/ts/interfaces/oncall";
import { MICROS_PER_MINUTE, TARGET_KINDS } from "@/ts/interfaces/oncall";
import type { I18nText } from "@/types/i18n";
import { raw, useI18nTyped } from "@/types/i18n";
import { formatMicrosDuration } from "@/utils/formatters";
import {
  DELIVERABLE_CHANNELS,
  describeTarget,
  l0Defaults,
  priorityLabel,
  resolveLadder,
} from "@/utils/oncall";

const props = withDefaults(
  defineProps<{
    teamId: string;
    policy: OnCallPolicy | null;
    open?: boolean;
    /** The priority the reader had selected — the editor opens on the same one. */
    priority?: number;
    /**
     * The rotations this team staffs, in schedule order.
     *
     * The team's own schedule is the authority on which rotations are real, so
     * a level cannot be pointed at one nothing staffs — and a chip can show a
     * stored id as the name somebody recognises.
     */
    rotations?: Rotation[];
  }>(),
  { rotations: () => [] },
);
const emit = defineEmits<{ saved: []; "update:open": [boolean] }>();

const { t } = useI18nTyped();
const store = useStore();

// Only channels a Notifier can actually send. Rendering the rest would let
// somebody tick SMS and receive nothing.
const CHANNELS = DELIVERABLE_CHANNELS;

/// Enough faces to read the row as "people", not enough to wrap it. The count
/// beside them carries the real number.
const AVATARS_SHOWN = 3;

const draft = ref<PriorityRung[]>([]);

/// One ladder on screen at a time, chosen by the same chips the read view
/// uses. P1 first because it is the ladder that matters most.
const selected = ref(1);
const current = computed(() => draft.value.find((r) => r.priority === selected.value) ?? null);
const pendingUserStep = ref<LadderStep | null>(null);
/// The step and the mode together: a rotation target pages either the one
/// person on call in it or everyone on it, and which was asked for decides
/// what the picked rotation MEANS.
const pendingRotation = ref<{ step: LadderStep; mode: RotationMode } | null>(null);
const memberOptions = ref<{ label: I18nText; value: string }[]>([]);
const teamMembers = computed(() => memberOptions.value.map((m) => m.value));
/// The rotation in force, so the preview names people rather than target
/// kinds. Empty is a legitimate answer — it means a coverage gap, which the
/// preview then reports as a step reaching nobody.
const onCallNow = ref<OnCallPosition[]>([]);
const destinations = ref<string[]>([]);
/// Both are part of the ladder's shape, so both are draft state — reading them
/// off `props.policy` is what made them read-only.
const repeatCount = ref(1);
const finalAction = ref<PolicyFinalAction>("stop");
const availableDestinations = ref<string[]>([]);
const saving = ref(false);

/// The parent opens the delivery card when somebody presses Fix on a problem
/// it is reporting from outside the fold.
const deliverySection = ref<{ expand: () => void } | null>(null);

/// Held OUTSIDE the PUT body until touched: the server reads an absent `l0`
/// as "unchanged", which is the only reason a step edit cannot wipe the gate.
const l0Draft = ref<L0Policy | null>(null);
const l0Touched = ref(false);
const l0Valid = ref(true);

// The picker only matters if something is set to page through it.
const webhookEnabled = computed(() =>
  draft.value.some((rung) => rung.channels.includes("webhook")),
);

const destinationOptions = computed(() =>
  availableDestinations.value.map((name) => ({ label: raw(name), value: name })),
);

const orgId = computed(() => store.state.selectedOrganization.identifier);

/// The team's room, read whole with its provenance.
const teamChannel = ref<TeamChannel | null>(null);
const teamChannelDraft = ref<string[]>([]);
const savingChannel = ref(false);

const teamChannelDirty = computed(
  () =>
    JSON.stringify([...teamChannelDraft.value].sort()) !==
    JSON.stringify([...(teamChannel.value?.destinations ?? [])].sort()),
);

async function fetchTeamChannel() {
  try {
    const res = await oncallService.getTeamChannel({
      org_identifier: orgId.value,
      team_id: props.teamId,
    });
    teamChannel.value = res.data ?? null;
    teamChannelDraft.value = [...(res.data?.destinations ?? [])];
  } catch {
    teamChannel.value = null;
  }
}

/// `null` clears the override; an array (even empty) is the team's own list.
async function saveTeamChannel(destinations: string[] | null) {
  savingChannel.value = true;
  try {
    const res = await oncallService.setTeamChannel({
      org_identifier: orgId.value,
      team_id: props.teamId,
      data: { destinations },
    });
    teamChannel.value = res.data ?? null;
    teamChannelDraft.value = [...(res.data?.destinations ?? [])];
    toast({ variant: "success", message: t("oncall.teamChannelSaved") });
  } catch (err: any) {
    toast({
      variant: "error",
      message: raw(err?.response?.data?.message) || t("oncall.teamChannelSaveFailed"),
    });
  } finally {
    savingChannel.value = false;
  }
}

/// Only read to answer one question: does the final action's safety net
/// exist. A failure leaves the warning off — a false "no default team" on a
/// transient error would send somebody to fix a setting that is fine.
/// Shared, not fetched here. This is a pure reader — it only needs to know
/// whether a catch-all exists so the ladder's end can warn when it does not —
/// and its own copy went stale the moment somebody nominated one on the
/// Routing screen.
const { config: routingConfig, load: loadRoutingConfig } = useOnCallRoutingConfig();
async function fetchRoutingConfig() {
  await loadRoutingConfig(orgId.value);
}

const defaultTeamMissing = computed(
  () =>
    finalAction.value === "notify_default_team" &&
    routingConfig.value !== null &&
    !routingConfig.value.default_team_id,
);

/// What actually happens when the steps run out, from the policy itself —
/// the static "decided by the repeat and final action" told the author to go
/// find out. `repeat_count` 1 means the ladder runs once; there is no zero.
const ladderEndLine = computed(() => {
  const repeats = repeatCount.value;
  const hands = finalAction.value === "notify_default_team";
  if (hands) {
    const team = routingConfig.value?.default_team_name;
    return team
      ? t("oncall.policyEndsHandsTo", { count: repeats, team: raw(team) }, repeats)
      : t("oncall.policyEndsHandsToUnset", { count: repeats }, repeats);
  }
  return t("oncall.policyEndsStops", { count: repeats }, repeats);
});

/// The whole selected ladder as one sentence. The editor is built out of
/// target kinds and absolute offsets; this is what they add up to, said the way
/// somebody would say it out loud.
const ladderSentence = computed<I18nText>(() => {
  const rung = current.value;
  const priority = raw(priorityLabel(rung?.priority ?? selected.value));
  if (!rung?.steps.length) return t("oncall.policySentenceNobody", { priority });

  const steps = rung.steps
    .map((step) => {
      const who = step.targets
        .map((target) => describeTarget(target, t, rotationNameOf(target)))
        .join(", ");
      return step.after_micros === 0
        ? t("oncall.policySentenceStepNow", { who: raw(who) })
        : t("oncall.policySentenceStepAt", {
            who: raw(who),
            delay: raw(formatMicrosDuration(step.after_micros)),
          });
    })
    .join(", ");

  const team = routingConfig.value?.default_team_name;
  const ending =
    finalAction.value === "notify_default_team"
      ? team
        ? t("oncall.policySentenceEndHandOff", { team: raw(team) })
        : t("oncall.policySentenceEndHandOffUnset")
      : t("oncall.policySentenceEndStop");

  return t("oncall.policySentence", { priority, steps: raw(steps), ending });
});

/// The two halves of the ladder's end as one value, because they are one
/// decision: how many passes, and what happens after the last one.
const ladderEnd = computed(() => `${repeatCount.value}:${finalAction.value}`);

/// One to five passes. More than five is a ladder somebody should shorten
/// rather than repeat, and there is no zero — a policy that runs its ladder no
/// times is a policy that pages nobody, which is what an empty step list says.
const ladderEndOptions = computed(() => [
  ...[1, 2, 3, 4, 5].map((n) => ({
    label: t("oncall.policyEndOptionStop", { count: n }, n),
    value: `${n}:stop`,
  })),
  ...[1, 2, 3, 4, 5].map((n) => ({
    label: t("oncall.policyEndOptionHandOff", { count: n }, n),
    value: `${n}:notify_default_team`,
  })),
]);

function setLadderEnd(value: string) {
  const [repeats, action] = value.split(":");
  repeatCount.value = Number(repeats);
  finalAction.value = action as PolicyFinalAction;
}

/// What the delivery card says while it is folded away: the channels this
/// priority pages on, and the room the firing is announced in.
const deliverySummary = computed<I18nText>(() => {
  const channels = (current.value?.channels ?? []).map((c) => t(`oncall.channel_${c}`)).join(" + ");
  if (!channels) return t("oncall.policyDeliverySummaryNoChannel");
  const room = teamChannel.value?.destinations ?? [];
  return room.length
    ? t("oncall.policyDeliverySummary", { channels: raw(channels), room: raw(room.join(", ")) })
    : t("oncall.policyDeliverySummaryNoRoom", { channels: raw(channels) });
});

const deliveryProblems = computed(() =>
  webhookEnabled.value && !destinations.value.length ? 1 : 0,
);

/// The gate as it stands right now — the draft once touched, else what is
/// stored, else the block auto-creation would have written. Reading an absent
/// block as "off" would describe a team that is in fact gating its P2s.
const l0Current = computed<L0Policy>(() => l0Draft.value ?? props.policy?.l0 ?? l0Defaults());

function l0ModeShort(mode: L0Policy["mode"]["P2"]): I18nText {
  if (mode === "gate")
    return t("oncall.l0ModeShortGate", { seconds: l0Current.value.triage_budget_seconds });
  if (mode === "parallel") return t("oncall.l0ModeShortParallel");
  return t("oncall.l0ModeShortOnly");
}

/// What the triage card says while it is folded away.
const triageSummary = computed<I18nText>(() =>
  t("oncall.policyTriageSummary", {
    p2: l0ModeShort(l0Current.value.mode.P2),
    p3: l0ModeShort(l0Current.value.mode.P3),
  }),
);

/// **Three options: a rotation, some people, or the whole team.** It was eight,
/// six of which existed only to name a slot or to describe a derivation — and
/// a picker offering "the on-call" beside "the primary on-call" taught a
/// distinction that did not exist.
///
/// `rotation_all` is the same kind with `mode: "all"`, offered as its own row
/// because "everyone on Platform" and "whoever is on call in Platform" are
/// different errands, not a setting on one.
const targetOptions = computed(() => [
  ...TARGET_KINDS.map((kind) => ({ label: t(`oncall.target_${kind}`), value: kind })),
  { label: t("oncall.target_rotation_everyone"), value: "rotation_all" },
]);

const rotationOptions = computed(() =>
  props.rotations.map((rotation) => ({ label: raw(rotation.name), value: rotation.id })),
);

/// A chip stores an id; a reader needs the name. A rotation the team no longer
/// has resolves to `null`, which `describeTarget` says out loud rather than
/// printing an identifier nobody can look up.
function rotationNameOf(target: EscalationTarget): string | null {
  if (target.kind !== "rotation") return null;
  return props.rotations.find((r) => r.id === target.rotation_id)?.name ?? null;
}

/// A user target needs an email and a rotation target needs a rotation, so both
/// open a picker rather than adding an empty chip the policy would reject on
/// save.
function addTarget(step: LadderStep, kind: string) {
  if (!kind) return;
  if (kind === "user") {
    pendingUserStep.value = step;
    return;
  }
  if (kind === "rotation" || kind === "rotation_all") {
    pendingRotation.value = { step, mode: kind === "rotation_all" ? "all" : "on_call" };
    return;
  }
  if (!step.targets.some((x) => x.kind === kind)) {
    step.targets.push({ kind } as EscalationTarget);
  }
}

function addUser(email: string) {
  const step = pendingUserStep.value;
  pendingUserStep.value = null;
  if (!step || !email) return;
  if (!step.targets.some((x) => x.kind === "user" && x.email === email)) {
    step.targets.push({ kind: "user", email });
  }
}

/// Duplicates are compared on the rotation AND the mode. Two rotations on one
/// step is a legitimate — and common — wide first level, and it is now the only
/// way a level pages more than one person.
///
/// `mode` is omitted from the wire when it is `on_call`, so a level written
/// without it round-trips unchanged rather than gaining a field it never had.
function addRotation(rotationId: string) {
  const pending = pendingRotation.value;
  pendingRotation.value = null;
  if (!pending || !rotationId) return;
  const { step, mode } = pending;
  const already = step.targets.some(
    (x) => x.kind === "rotation" && x.rotation_id === rotationId && (x.mode ?? "on_call") === mode,
  );
  if (already) return;
  step.targets.push(
    mode === "all"
      ? { kind: "rotation", rotation_id: rotationId, mode }
      : { kind: "rotation", rotation_id: rotationId },
  );
}

/// The wait between two steps — what the connector edits. The data model
/// stores absolute offsets from the record opening; the operator thinks in
/// "if nobody acks in five minutes". Editing the gap and recomputing the
/// offsets keeps both true.
function gapBefore(rung: PriorityRung, index: number): number {
  const prev = index > 0 ? rung.steps[index - 1].after_micros : 0;
  return rung.steps[index].after_micros - prev;
}

/// Shifts this step and every step after it, preserving the later gaps —
/// pulling one wait in should not silently stretch the waits below it.
function setGap(rung: PriorityRung, index: number, micros: number) {
  const delta = micros - gapBefore(rung, index);
  if (!delta) return;
  for (let i = index; i < rung.steps.length; i++) {
    rung.steps[i].after_micros += delta;
  }
}

const GAP_MINUTES = [1, 5, 10, 15, 30, 60];

/// Between steps. Never zero: two steps at the same instant are one step with
/// both target sets, and the server rejects them as such.
const gapOptions = computed(() =>
  GAP_MINUTES.map((minutes) => ({
    label: t("oncall.afterMinutes", { count: minutes }),
    value: minutes * MICROS_PER_MINUTE,
  })),
);

/// Before the FIRST step zero is legal and usual — P1 pages at once. A held
/// first page (P2's five minutes) is the same control with a nonzero value.
const leadGapOptions = computed(() => [
  { label: t("oncall.ladderNow"), value: 0 },
  ...gapOptions.value,
]);

/// Gap-preserving: removing a step pulls the ones below it up by its wait,
/// keeping their spacing — the ladder gets shorter, not sparser.
function removeStep(rung: PriorityRung, index: number) {
  const gap = index === 0 ? rung.steps[0].after_micros : gapBefore(rung, index);
  rung.steps.splice(index, 1);
  for (let i = index; i < rung.steps.length; i++) {
    rung.steps[i].after_micros -= gap;
  }
}

function reset() {
  draft.value = (props.policy?.rungs ?? []).map((rung) => ({
    priority: rung.priority,
    // Sorted, because the connectors edit the gaps between NEIGHBOURS — an
    // out-of-order array would show a negative wait.
    // `targets` is copied, not shared. A shallow `{ ...step }` handed the
    // draft the SAME array the policy prop holds, so adding or removing a
    // target edited `props.policy` in place — and Cancel, which only throws
    // the draft away, discarded nothing. The step read as reverted and the
    // next save wrote the abandoned edit.
    steps: rung.steps
      .map((step) => ({ ...step, targets: [...step.targets] }))
      .sort((a, b) => a.after_micros - b.after_micros),
    channels: [...rung.channels],
  }));
  pendingUserStep.value = null;
  pendingRotation.value = null;
  destinations.value = [...(props.policy?.destinations ?? [])];
  // `repeat_count` 1 means the ladder runs once; there is no zero.
  repeatCount.value = props.policy?.repeat_count ?? 1;
  finalAction.value = props.policy?.final_action ?? "stop";
  l0Draft.value = null;
  l0Touched.value = false;
}

watch(() => props.policy, reset, { immediate: true });

/// The drawer keeps this component mounted between visits, so a discarded edit
/// would still be sitting in `draft` the next time it opens — and nothing the
/// body needs is worth fetching until then. Re-read on every open because the
/// preview names whoever is on call at THIS instant.
watch(
  () => props.open,
  (open) => {
    if (!open) return;
    reset();
    // A policy need not carry a rung for every priority, so an unrepresented
    // one falls back to a chip that exists rather than an empty body.
    const wanted = props.priority ?? selected.value;
    selected.value = draft.value.some((rung) => rung.priority === wanted)
      ? wanted
      : (draft.value[0]?.priority ?? selected.value);
    fetchDestinations();
    fetchRoutingConfig();
    fetchTeamChannel();
    fetchMembers();
    fetchOnCallNow();
  },
  { immediate: true },
);

function cancel() {
  reset();
  emit("update:open", false);
}

// A failure here leaves the picker empty rather than breaking the editor: the
// rest of the policy is still worth editing.
async function fetchDestinations() {
  try {
    const res = await destinationService.list({
      org_identifier: orgId.value,
      page_num: 1,
      page_size: 1000,
      sort_by: "name",
      desc: false,
      module: "alert",
    });
    availableDestinations.value = (res.data ?? [])
      .map((d: { name: string }) => d.name)
      .filter(Boolean);
  } catch {
    availableDestinations.value = [];
  }
}

/// Team members are the people a step can name, and the faces behind a
/// whole-team step. A failure leaves the picker empty rather than breaking the
/// editor.
async function fetchMembers() {
  try {
    const res = await oncallService.listMembers({
      org_identifier: orgId.value,
      team_id: props.teamId,
    });
    memberOptions.value = (res.data ?? []).map((m: { user_email: string }) => ({
      label: raw(m.user_email),
      value: m.user_email,
    }));
  } catch {
    memberOptions.value = [];
  }
}

/// A gap is a legitimate answer, so a failure here leaves the list empty and
/// the preview says the step reaches nobody — which is what a gap means.
async function fetchOnCallNow() {
  try {
    const res = await oncallService.whoIsOnCall({
      org_identifier: orgId.value,
      team_id: props.teamId,
    });
    onCallNow.value = res.data ?? [];
  } catch {
    onCallNow.value = [];
  }
}

function addStep(rung: PriorityRung) {
  // A new step lands after the last one. Two steps at the same delay would
  // fire together, which the server rejects — and rightly, since that is one
  // step with both sets of targets.
  const used = new Set(rung.steps.map((s) => s.after_micros));
  const last = rung.steps.reduce((max, s) => Math.max(max, s.after_micros), -1);
  let next = last < 0 ? 0 : last + 5 * MICROS_PER_MINUTE;
  while (used.has(next)) next += 5 * MICROS_PER_MINUTE;
  // Starts with the team's first rotation, which is what a new step almost
  // always means. With no rotations there is nothing honest to preselect — an
  // empty step asks rather than writing a level that pages nobody.
  const first = props.rotations[0];
  rung.steps.push({
    after_micros: next,
    targets: first ? [{ kind: "rotation", rotation_id: first.id }] : [],
  });
}

function toggleChannel(rung: PriorityRung, channel: Channel, on: boolean) {
  if (on) {
    if (!rung.channels.includes(channel)) rung.channels.push(channel);
  } else {
    rung.channels = rung.channels.filter((c) => c !== channel);
  }
}

function onL0Update(value: L0Policy) {
  l0Draft.value = value;
  l0Touched.value = true;
}

async function save() {
  saving.value = true;
  try {
    await oncallService.setPolicy({
      org_identifier: orgId.value,
      team_id: props.teamId,
      data: {
        rungs: draft.value,
        destinations: destinations.value,
        repeat_count: repeatCount.value,
        final_action: finalAction.value,
        ...(l0Touched.value && l0Draft.value ? { l0: l0Draft.value } : {}),
      },
    });
    toast({ variant: "success", message: t("oncall.policySaved") });
    emit("saved");
  } catch (err: any) {
    toast({
      variant: "error",
      message: raw(err?.response?.data?.message) || t("oncall.savePolicyFailed"),
    });
  } finally {
    saving.value = false;
  }
}
</script>
