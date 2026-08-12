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
  <OCard data-test="oncall-policy-editor">
    <OCardSection>
      <p class="text-text-secondary mb-4 text-sm">{{ t("oncall.policyHint") }}</p>

      <div class="flex flex-col gap-4">
        <div
          v-for="rung in draft"
          :key="rung.priority"
          class="border-border-default flex flex-col gap-3 rounded-surface border p-4"
          data-test="oncall-policy-rung"
        >
          <div class="flex flex-wrap items-center gap-2">
            <OTag :variant="priorityTagVariant(rung.priority)" size="sm">
              {{ priorityLabel(rung.priority) }}
            </OTag>
            <span v-if="!rung.steps.length" class="text-text-secondary text-sm">
              {{ t("oncall.pagesNobody") }}
            </span>
          </div>

          <!-- One line per rung, reading as a sentence: page THESE people,
               THIS long after the record opened. Targets on one rung fire
               together, which is why a rung holds a set rather than a single
               slot. -->
          <div v-if="rung.steps.length" class="flex flex-col gap-2">
            <div
              v-for="(step, stepIndex) in rung.steps"
              :key="stepIndex"
              class="border-border-subtle flex flex-wrap items-center gap-2 rounded-default border p-2"
              :data-test="`oncall-policy-rung-${rung.priority}-${stepIndex}`"
            >
              <span class="text-text-label text-xs">{{ t("oncall.rungPages") }}</span>

              <OTag
                v-for="(target, ti) in step.targets"
                :key="ti"
                variant="default-soft"
                size="sm"
                :data-test="`oncall-policy-target-${rung.priority}-${stepIndex}-${ti}`"
              >
                {{ describeTarget(target, t) }}
                <button
                  type="button"
                  class="ml-1"
                  :aria-label="t('oncall.removeTarget')"
                  :data-test="`oncall-policy-target-remove-${rung.priority}-${stepIndex}-${ti}`"
                  @click="step.targets.splice(ti, 1)"
                >
                  {{ raw("×") }}
                </button>
              </OTag>

              <OSelect
                :model-value="''"
                :options="targetOptions"
                :placeholder="t('oncall.addTarget')"
                class="w-52"
                :data-test="`oncall-policy-add-target-${rung.priority}-${stepIndex}`"
                @update:model-value="(v: any) => addTarget(step, String(v))"
              />

              <!-- A person target needs a name, so it asks rather than adding
                   an empty chip the server would reject on save. -->
              <OSelect
                v-if="pendingUserStep === step"
                :model-value="''"
                :options="memberOptions"
                :placeholder="t('oncall.targetPickPerson')"
                class="w-52"
                :data-test="`oncall-policy-pick-person-${rung.priority}-${stepIndex}`"
                @update:model-value="(v: any) => addUser(String(v))"
              />

              <span class="text-text-label text-xs">{{ t("oncall.rungAfter") }}</span>
              <OSelect
                v-model="step.after_micros"
                :options="delayOptions"
                class="w-40"
                :data-test="`oncall-policy-step-delay-${rung.priority}-${stepIndex}`"
              />

              <OButton
                variant="ghost"
                size="icon-sm"
                icon-left="close"
                :aria-label="t('oncall.removeRung')"
                :data-test="`oncall-policy-remove-rung-${rung.priority}-${stepIndex}`"
                @click="rung.steps.splice(stepIndex, 1)"
              />
            </div>
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <OButton
              variant="outline"
              size="sm-action"
              :data-test="`oncall-policy-add-step-${rung.priority}`"
              @click="addStep(rung)"
            >
              {{ t("oncall.addRung") }}
            </OButton>
          </div>

          <!-- The ladder is built out of target KINDS, which is not the question
               anybody has about it. This answers that one — who this wakes, and
               when — against the rotation in force right now. -->
          <div
            v-if="rung.steps.length"
            class="border-border-subtle flex flex-col gap-1 rounded-default border p-3"
            :data-test="`oncall-policy-preview-${rung.priority}`"
          >
            <span class="text-text-label text-xs">{{ t("oncall.ladderPreview") }}</span>
            <div
              v-for="(step, i) in resolveLadder(rung, onCallNow)"
              :key="i"
              class="flex flex-wrap items-center gap-2"
            >
              <OTag variant="default-soft" size="sm">
                {{ step.afterMicros ? formatMicrosDuration(step.afterMicros) : t("oncall.ladderNow") }}
              </OTag>
              <OUserCell v-for="email in step.people" :key="email" :value="email" />
              <span v-if="step.wholeTeam" class="text-text-body text-sm">
                {{ t("oncall.target_whole_team") }}
              </span>
              <!-- A rung that resolves to nobody is configured and useless —
                   a next-on-call step on a one-person rotation, or a gap. -->
              <span
                v-if="!step.people.length && !step.wholeTeam"
                class="text-status-warning-text text-sm"
                :data-test="`oncall-policy-preview-nobody-${rung.priority}-${i}`"
              >
                {{ t("oncall.ladderReachesNobody") }}
              </span>
            </div>
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
                :model-value="rung.channels.includes(channel)"
                :label="t(`oncall.channel_${channel}`)"
                :data-test="`oncall-policy-channel-${rung.priority}-${channel}`"
                @update:model-value="(on: CheckboxModelValue) => toggleChannel(rung, channel, on === true)"
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

const delayOptions = computed(() =>
  [0, 5, 15, 30, 60].map((minutes) => ({
    label:
      minutes === 0
        ? t("oncall.immediately")
        : t("oncall.afterMinutes", { count: minutes }),
    value: minutes * MICROS_PER_MINUTE,
  })),
);

function reset() {
  draft.value = (props.policy?.rungs ?? []).map((rung) => ({
    priority: rung.priority,
    steps: rung.steps.map((step) => ({ ...step })),
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
