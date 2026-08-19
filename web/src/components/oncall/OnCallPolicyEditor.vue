<template>
  <!-- The ladder is wide — a rung is a wait, a row of target chips and a
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
            ? t("oncall.policyChipRungs", { count: rung.steps.length }, rung.steps.length)
            : t("oncall.reachPagesNobody")
        }}
      </OButton>
    </div>

    <div class="px-dialog-content-px py-dialog-content-py flex flex-col gap-4">
      <div
        v-if="current"
        :key="current.priority"
        class="flex flex-col gap-3"
        data-test="oncall-policy-rung"
      >
        <!-- The ladder, as a ladder: a rail of rungs with the wait edited on
             the connector BETWEEN them. "If nobody acknowledges in 5m" is
             the sentence an operator thinks in; a delay field inside the
             card made every rung an absolute offset they had to subtract. -->
        <div
          v-if="current.steps.length"
          class="flex flex-col"
          :data-test="`oncall-policy-preview-${current.priority}`"
        >
          <template v-for="(step, stepIndex) in current.steps" :key="stepIndex">
            <!-- Connector: the wait that puts this rung where it is. -->
            <div class="border-border-strong ms-3 flex items-center gap-2 border-s py-2 ps-4">
              <OText variant="label">
                {{ stepIndex === 0 ? t("oncall.policyFirstPage") : t("oncall.policyIfNoAck") }}
              </OText>
              <span class="w-44">
                <OSelect
                  :model-value="gapBefore(current, stepIndex)"
                  :options="stepIndex === 0 ? leadGapOptions : gapOptions"
                  :data-test="`oncall-policy-step-delay-${current.priority}-${stepIndex}`"
                  @update:model-value="(v: any) => setGap(current!, stepIndex, Number(v))"
                />
              </span>
            </div>

            <!-- The rung. -->
            <div
              class="border-border-default rounded-surface relative flex flex-col gap-2 border p-3"
              :data-test="`oncall-policy-rung-${current.priority}-${stepIndex}`"
            >
              <div class="flex flex-wrap items-center gap-2">
                <OTag variant="default-soft" size="sm">
                  {{
                    step.after_micros
                      ? raw(`+${formatMicrosDuration(step.after_micros)}`)
                      : t("oncall.ladderNow")
                  }}
                </OTag>
                <OText variant="label">{{ t("oncall.rungPages") }}</OText>

                <OTag
                  v-for="(target, ti) in step.targets"
                  :key="ti"
                  variant="default-soft"
                  size="sm"
                  :data-test="`oncall-policy-target-${current.priority}-${stepIndex}-${ti}`"
                >
                  {{ describeTarget(target, t) }}
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

                <span class="w-52">
                  <OSelect
                    :model-value="''"
                    :options="targetOptions"
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
                    :placeholder="t('oncall.targetPickPerson')"
                    :data-test="`oncall-policy-pick-person-${current.priority}-${stepIndex}`"
                    @update:model-value="(v: any) => addUser(String(v))"
                  />
                </span>

                <!-- Same reason, for the slot-naming kinds: a rung pointed at a
                     slot nobody staffs reaches nobody, and `config-risks`
                     reports it as `slot_pages_nobody`. Asking here is how it
                     never gets written. -->
                <span v-if="pendingSlot?.step === step" class="w-52">
                  <OSelect
                    :model-value="''"
                    :options="slotOptions"
                    :placeholder="t('oncall.targetPickSlot')"
                    :data-test="`oncall-policy-pick-slot-${current.priority}-${stepIndex}`"
                    @update:model-value="(v: any) => addSlot(String(v))"
                  />
                </span>

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

              <!-- Who this rung wakes, resolved against the rotation in
                   force right now — the question the ladder is built out of
                   target KINDS never answers. -->
              <div class="flex flex-wrap items-center gap-2">
                <OText variant="label">{{ t("oncall.policyRightNow") }}</OText>
                <template
                  v-for="(line, i) in [resolveLadder(current, onCallNow)[stepIndex]]"
                  :key="i"
                >
                  <OUserCell v-for="email in line?.people ?? []" :key="email" :value="email" />
                  <OText variant="body" as="span" v-if="line?.wholeTeam">
                    {{ t("oncall.target_whole_team") }}
                  </OText>
                  <OText variant="body" as="span"
                    v-for="pool in line?.pools ?? []"
                    :key="pool">
                    {{ t("oncall.ladderPoolEveryone", { slot: raw(pool) }) }}
                  </OText>
                  <span
                    v-if="line && !line.people.length && !line.wholeTeam && !line.pools.length"
                    class="text-status-warning-text text-sm"
                    :data-test="`oncall-policy-preview-nobody-${current.priority}-${stepIndex}`"
                  >
                    {{ t("oncall.ladderReachesNobody") }}
                  </span>
                </template>
              </div>
            </div>
          </template>

          <!-- What the ladder does when it runs out is part of its shape, so
               it is edited here rather than described here. Both fields were
               read-only — and the warning below fired about a value the editor
               could not set, which is a screen telling somebody to fix
               something it will not let them touch. -->
          <div class="border-border-strong ms-3 flex flex-col gap-2 border-s py-2 ps-4">
            <div class="flex flex-wrap items-center gap-2">
              <OText variant="label">{{ t("oncall.policyWhenRungsRunOut") }}</OText>
              <span class="w-44">
                <OSelect
                  :model-value="repeatCount"
                  :options="repeatOptions"
                  data-test="oncall-policy-repeat-count"
                  @update:model-value="(v: unknown) => (repeatCount = Number(v))"
                />
              </span>
              <span class="w-56">
                <OSelect
                  :model-value="finalAction"
                  :options="finalActionOptions"
                  data-test="oncall-policy-final-action"
                  @update:model-value="(v: unknown) => (finalAction = v as PolicyFinalAction)"
                />
              </span>
            </div>
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
          {{ t("oncall.policyPrioritySilent", { priority: raw(priorityLabel(current.priority)) }) }}
        </OText>

        <div class="flex flex-wrap items-center gap-2">
          <OButton
            variant="outline"
            size="sm-action"
            icon-left="add"
            :data-test="`oncall-policy-add-step-${current.priority}`"
            @click="addStep(current)"
          >
            {{ t("oncall.addRung") }}
          </OButton>
        </div>

        <!-- Channels apply to everyone paged at this priority; the primary
             and the secondary are not treated differently. -->
        <div class="flex flex-col gap-1">
          <OText variant="label">{{ t("oncall.channels") }}</OText>
          <OText variant="meta">{{ t("oncall.channelsAvailableHint") }}</OText>
          <div class="flex flex-wrap gap-2">
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
          </div>
        </div>
      </div>

      <!-- Ticking `webhook` above says HOW to page; this says WHERE. Without
           it the channel is on and delivers nowhere, which looks identical
           to working. -->
      <div v-if="webhookEnabled" class="flex flex-col gap-1">
        <OText variant="label">{{ t("oncall.policyDestinations") }}</OText>
        <OText variant="meta">{{ t("oncall.policyDestinationsHint") }}</OText>
        <OSelect
          v-model="destinations"
          :options="destinationOptions"
          multiple
          :placeholder="t('oncall.policyDestinationsPlaceholder')"
          data-test="oncall-policy-destinations"
        />
        <span
          v-if="!destinations.length"
          class="text-status-warning-text text-xs"
          data-test="oncall-policy-destinations-warning"
        >
          {{ t("oncall.policyNoDestinationWarning") }}
        </span>
      </div>

      <!-- C11: the l0_json block. Wire rule: `l0` absent on the PUT means
           unchanged, so it is only included once the panel is touched —
           editing rungs must never silently rewrite the gate. -->
      <!-- WHERE the team is talked to, beside the policy list it can
           override. `source` makes precedence visible: "I set the team
           channel and pages still go to the old room" has to be answerable
           here, not by paging somebody to find out. -->
      <div class="flex flex-col gap-1" data-test="oncall-team-channel">
        <span class="flex items-center gap-2">
          <OText variant="label">{{ t("oncall.teamChannelTitle") }}</OText>
          <OTag
            v-if="teamChannel"
            :variant="teamChannel.source === 'team' ? 'primary-soft' : 'default-soft'"
            size="sm"
            data-test="oncall-team-channel-source"
          >
            {{
              teamChannel.source === "team"
                ? t("oncall.teamChannelFromTeam")
                : t("oncall.teamChannelFromPolicy")
            }}
          </OTag>
        </span>
        <!-- One post per firing, not a live room: the only transport is an
             HTTP destination, which cannot edit what it already sent. Said
             here so nobody designs an expectation the engine cannot meet. -->
        <OText variant="meta">{{ t("oncall.teamChannelHint") }}</OText>
        <OSelect
          v-model="teamChannelDraft"
          :options="destinationOptions"
          multiple
          :placeholder="t('oncall.teamChannelPlaceholder')"
          data-test="oncall-team-channel-select"
        />
        <span class="flex flex-wrap items-center gap-2">
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
        </span>
        <span
          v-if="teamChannel && !teamChannel.destinations.length"
          class="text-status-warning-text text-xs"
          data-test="oncall-team-channel-silent"
        >
          {{ t("oncall.teamChannelSilent") }}
        </span>
      </div>

      <OnCallL0Editor
        :l0="props.policy?.l0 ?? null"
        @update:l0="onL0Update"
        @update:valid="(v: boolean) => (l0Valid = v)"
      />
    </div>

    <template #footer>
      <div class="flex justify-end gap-2">
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
          {{ t("oncall.save") }}
        </OButton>
      </div>
    </template>
  </ODrawer>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useStore } from "vuex";

import OnCallL0Editor from "@/components/oncall/OnCallL0Editor.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
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
  EscalationTargetKind,
  L0Policy,
  LadderStep,
  OnCallPolicy,
  OnCallSlot,
  PolicyFinalAction,
  PriorityRung,
  SlotTargetKind,
} from "@/ts/interfaces/oncall";
import {
  isSlotTarget,
  MICROS_PER_MINUTE,
  sameSlot,
  TARGET_KINDS,
} from "@/ts/interfaces/oncall";
import type { I18nText } from "@/types/i18n";
import { raw, useI18nTyped } from "@/types/i18n";
import OUserCell from "@/lib/core/Table/cells/OUserCell.vue";
import { formatMicrosDuration } from "@/utils/formatters";
import { DELIVERABLE_CHANNELS, describeTarget, priorityLabel, resolveLadder } from "@/utils/oncall";

const props = withDefaults(
  defineProps<{
  teamId: string;
  policy: OnCallPolicy | null;
  open?: boolean;
  /** The priority the reader had selected — the editor opens on the same one. */
  priority?: number;
  /**
   * The slots this team staffs, in schedule order. More than one unlocks the
   * slot-naming targets; the team's own schedule is the authority on which
   * names are real, so a rung cannot be pointed at a slot nobody staffs.
   */
  slots?: string[];
  }>(),
  { slots: () => [] },
);
const emit = defineEmits<{ saved: []; "update:open": [boolean] }>();

const { t } = useI18nTyped();
const store = useStore();

// Only channels a Notifier can actually send. Rendering the rest would let
// somebody tick SMS and receive nothing.
const CHANNELS = DELIVERABLE_CHANNELS;

const draft = ref<PriorityRung[]>([]);

/// One ladder on screen at a time, chosen by the same chips the read view
/// uses. P1 first because it is the ladder that matters most.
const selected = ref(1);
const current = computed(() => draft.value.find((r) => r.priority === selected.value) ?? null);
const pendingUserStep = ref<LadderStep | null>(null);
/// The step and the kind together: three kinds take a slot, and which one was
/// picked decides what the slot MEANS — on call in it, next in it, or all of it.
const pendingSlot = ref<{ step: LadderStep; kind: SlotTargetKind } | null>(null);
const memberOptions = ref<{ label: I18nText; value: string }[]>([]);
/// The rotation in force, so the preview names people rather than target
/// kinds. Empty is a legitimate answer — it means a coverage gap, which the
/// preview then reports as a rung reaching nobody.
const onCallNow = ref<OnCallSlot[]>([]);
const destinations = ref<string[]>([]);
/// Both are part of the ladder's shape, so both are draft state — reading them
/// off `props.policy` is what made them read-only.
const repeatCount = ref(1);
const finalAction = ref<PolicyFinalAction>("stop");
const availableDestinations = ref<string[]>([]);
const saving = ref(false);

/// Held OUTSIDE the PUT body until touched: the server reads an absent `l0`
/// as "unchanged", which is the only reason a rung edit cannot wipe the gate.
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

/// What actually happens when the rungs run out, from the policy itself —
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

/// The slot-naming kinds are offered only where there is a second slot to
/// name: on a one-slot team "the primary on-call" and "whoever is on call" are
/// the same person said two ways, and a picker offering both teaches a
/// distinction that does not exist yet.
const targetOptions = computed(() =>
  TARGET_KINDS.filter((kind) => props.slots.length > 1 || !isSlotTarget(kind)).map((kind) => ({
    label: t(`oncall.target_${kind}`),
    value: kind,
  })),
);

const slotOptions = computed(() =>
  props.slots.map((slot) => ({ label: raw(slot), value: slot })),
);

/// One to five passes. More than five is a ladder somebody should shorten
/// rather than repeat, and there is no zero — a policy that runs its ladder no
/// times is a policy that pages nobody, which is what an empty rung list says.
const repeatOptions = computed(() =>
  [1, 2, 3, 4, 5].map((n) => ({
    label: t("oncall.policyRepeatTimes", { count: n }, n),
    value: n,
  })),
);

const finalActionOptions = computed(() => [
  { label: t("oncall.policyFinalStop"), value: "stop" },
  { label: t("oncall.policyFinalNotifyDefault"), value: "notify_default_team" },
]);

/// A user target needs an email and a slot target needs a slot name, so both
/// open a picker rather than adding an empty chip the policy would reject on
/// save.
function addTarget(step: LadderStep, kind: string) {
  if (!kind) return;
  if (kind === "user") {
    pendingUserStep.value = step;
    return;
  }
  if (isSlotTarget(kind as EscalationTargetKind)) {
    pendingSlot.value = { step, kind: kind as SlotTargetKind };
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

/// Duplicates are compared on the PAIR. The same kind against two slots is two
/// different rungs' worth of people — "the primary on-call" and "the secondary
/// on-call" on one rung is a legitimate, and common, wide first step.
function addSlot(slot: string) {
  const pending = pendingSlot.value;
  pendingSlot.value = null;
  if (!pending || !slot) return;
  const { step, kind } = pending;
  if (!step.targets.some((x) => x.kind === kind && "slot" in x && sameSlot(x.slot, slot))) {
    step.targets.push({ kind, slot });
  }
}

/// The wait between two rungs — what the connector edits. The data model
/// stores absolute offsets from the record opening; the operator thinks in
/// "if nobody acks in five minutes". Editing the gap and recomputing the
/// offsets keeps both true.
function gapBefore(rung: PriorityRung, index: number): number {
  const prev = index > 0 ? rung.steps[index - 1].after_micros : 0;
  return rung.steps[index].after_micros - prev;
}

/// Shifts this rung and every rung after it, preserving the later gaps —
/// pulling one wait in should not silently stretch the waits below it.
function setGap(rung: PriorityRung, index: number, micros: number) {
  const delta = micros - gapBefore(rung, index);
  if (!delta) return;
  for (let i = index; i < rung.steps.length; i++) {
    rung.steps[i].after_micros += delta;
  }
}

const GAP_MINUTES = [1, 5, 10, 15, 30, 60];

/// Between rungs. Never zero: two rungs at the same instant are one rung with
/// both target sets, and the server rejects them as such.
const gapOptions = computed(() =>
  GAP_MINUTES.map((minutes) => ({
    label: t("oncall.afterMinutes", { count: minutes }),
    value: minutes * MICROS_PER_MINUTE,
  })),
);

/// Before the FIRST rung zero is legal and usual — P1 pages at once. A held
/// first page (P2's five minutes) is the same control with a nonzero value.
const leadGapOptions = computed(() => [
  { label: t("oncall.immediately"), value: 0 },
  ...gapOptions.value,
]);

/// Gap-preserving: removing a rung pulls the ones below it up by its wait,
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
    // the draft away, discarded nothing. The rung read as reverted and the
    // next save wrote the abandoned edit.
    steps: rung.steps
      .map((step) => ({ ...step, targets: [...step.targets] }))
      .sort((a, b) => a.after_micros - b.after_micros),
    channels: [...rung.channels],
  }));
  pendingUserStep.value = null;
  pendingSlot.value = null;
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

/// Team members are the people a rung can name. A failure leaves the picker
/// empty rather than breaking the editor.
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
/// the preview says the rung reaches nobody — which is what a gap means.
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
  // A new rung lands after the last one. Two rungs at the same delay would
  // fire together, which the server rejects — and rightly, since that is one
  // rung with both sets of targets.
  const used = new Set(rung.steps.map((s) => s.after_micros));
  const last = rung.steps.reduce((max, s) => Math.max(max, s.after_micros), -1);
  let next = last < 0 ? 0 : last + 5 * MICROS_PER_MINUTE;
  while (used.has(next)) next += 5 * MICROS_PER_MINUTE;
  // Starts with the on-call, which is what a new rung almost always means.
  rung.steps.push({ after_micros: next, targets: [{ kind: "on_call_now" }] });
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
