<template>
  <OCard data-test="oncall-policy-editor">
    <OCardSection>
      <p class="text-text-secondary mb-4 text-sm">{{ t("oncall.policyHint") }}</p>

      <div class="flex flex-col gap-4">
        <!-- Same chips as the read view, so editing feels like the ladder
             becoming editable rather than a different screen. One priority at
             a time: five stacked ladders was a page nobody could scan. -->
        <div class="flex flex-wrap items-center gap-2">
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
                <span class="text-text-label text-xs">
                  {{
                    stepIndex === 0
                      ? t("oncall.policyFirstPage")
                      : t("oncall.policyIfNoAck")
                  }}
                </span>
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
                class="border-border-default relative flex flex-col gap-2 rounded-surface border p-3"
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
                  <span class="text-text-label text-xs">{{ t("oncall.rungPages") }}</span>

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
                  <span class="text-text-label text-xs">{{ t("oncall.policyRightNow") }}</span>
                  <template v-for="(line, i) in [resolveLadder(current, onCallNow)[stepIndex]]" :key="i">
                    <OUserCell v-for="email in line?.people ?? []" :key="email" :value="email" />
                    <span v-if="line?.wholeTeam" class="text-text-body text-sm">
                      {{ t("oncall.target_whole_team") }}
                    </span>
                    <span
                      v-if="line && !line.people.length && !line.wholeTeam"
                      class="text-status-warning-text text-sm"
                      :data-test="`oncall-policy-preview-nobody-${current.priority}-${stepIndex}`"
                    >
                      {{ t("oncall.ladderReachesNobody") }}
                    </span>
                  </template>
                </div>
              </div>
            </template>

            <!-- What the ladder does when it runs out is part of its shape. -->
            <div class="border-border-strong ms-3 border-s py-2 ps-4">
              <span class="text-text-secondary text-xs">{{ t("oncall.policyLadderEnds") }}</span>
            </div>
          </div>

          <p v-else class="text-text-secondary text-sm" data-test="oncall-policy-silent">
            {{ t("oncall.policyPrioritySilent", { priority: raw(priorityLabel(current.priority)) }) }}
          </p>

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
            <span class="text-text-label text-xs">{{ t("oncall.channels") }}</span>
            <span class="text-text-muted text-xs">{{ t("oncall.channelsAvailableHint") }}</span>
            <div class="flex flex-wrap gap-2">
              <OCheckbox
                v-for="channel in CHANNELS"
                :key="channel"
                :model-value="current.channels.includes(channel)"
                :label="t(`oncall.channel_${channel}`)"
                :data-test="`oncall-policy-channel-${current.priority}-${channel}`"
                @update:model-value="(on: CheckboxModelValue) => toggleChannel(current!, channel, on === true)"
              />
            </div>
          </div>
        </div>

        <!-- Ticking `webhook` above says HOW to page; this says WHERE. Without
             it the channel is on and delivers nowhere, which looks identical
             to working. -->
        <div v-if="webhookEnabled" class="flex flex-col gap-1">
          <span class="text-text-label text-xs">{{ t("oncall.policyDestinations") }}</span>
          <span class="text-text-muted text-xs">{{ t("oncall.policyDestinationsHint") }}</span>
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

        <div class="flex justify-end gap-2">
          <OButton variant="outline" size="sm-action" @click="reset">
            {{ t("oncall.cancel") }}
          </OButton>
          <OButton
            variant="primary"
            size="sm-action"
            :loading="saving"
            data-test="oncall-policy-save"
            @click="save"
          >
            {{ t("oncall.save") }}
          </OButton>
        </div>
      </div>
    </OCardSection>
  </OCard>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useStore } from "vuex";

import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OCard from "@/lib/core/Card/OCard.vue";
import OCardSection from "@/lib/core/Card/OCardSection.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import type { CheckboxModelValue } from "@/lib/forms/Checkbox/OCheckbox.types";
import { toast } from "@/lib/feedback/Toast/useToast";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import destinationService from "@/services/alert_destination";
import oncallService from "@/services/oncall";
import type {
  Channel,
  EscalationTarget,
  LadderStep,
  OnCallPolicy,
  OnCallSlot,
  PriorityRung,
} from "@/ts/interfaces/oncall";
import { MICROS_PER_MINUTE, TARGET_KINDS } from "@/ts/interfaces/oncall";
import type { I18nText } from "@/types/i18n";
import { raw, useI18nTyped } from "@/types/i18n";
import OUserCell from "@/lib/core/Table/cells/OUserCell.vue";
import { formatMicrosDuration } from "@/utils/formatters";
import {
  DELIVERABLE_CHANNELS,
  describeTarget,
  priorityLabel,
  priorityTagVariant,
  resolveLadder,
} from "@/utils/oncall";

const props = defineProps<{ teamId: string; policy: OnCallPolicy | null }>();
const emit = defineEmits<{ saved: [] }>();

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
const memberOptions = ref<{ label: I18nText; value: string }[]>([]);
/// The rotation in force, so the preview names people rather than target
/// kinds. Empty is a legitimate answer — it means a coverage gap, which the
/// preview then reports as a rung reaching nobody.
const onCallNow = ref<OnCallSlot[]>([]);
const destinations = ref<string[]>([]);
const availableDestinations = ref<string[]>([]);
const saving = ref(false);

// The picker only matters if something is set to page through it.
const webhookEnabled = computed(() =>
  draft.value.some((rung) => rung.channels.includes("webhook")),
);

const destinationOptions = computed(() =>
  availableDestinations.value.map((name) => ({ label: raw(name), value: name })),
);

const orgId = computed(() => store.state.selectedOrganization.identifier);

const targetOptions = computed(() =>
  TARGET_KINDS.map((kind) => ({ label: t(`oncall.target_${kind}`), value: kind })),
);

/// A user target needs an email, so it opens a picker rather than adding an
/// empty chip the policy would reject on save.
function addTarget(step: LadderStep, kind: string) {
  if (!kind) return;
  if (kind === "user") {
    pendingUserStep.value = step;
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
    steps: rung.steps.map((step) => ({ ...step })).sort((a, b) => a.after_micros - b.after_micros),
    channels: [...rung.channels],
  }));
  pendingUserStep.value = null;
  destinations.value = [...(props.policy?.destinations ?? [])];
}

watch(() => props.policy, reset, { immediate: true });

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

onMounted(() => {
  fetchDestinations();
  fetchMembers();
  fetchOnCallNow();
});

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

async function save() {
  saving.value = true;
  try {
    await oncallService.setPolicy({
      org_identifier: orgId.value,
      team_id: props.teamId,
      data: { rungs: draft.value, destinations: destinations.value },
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
