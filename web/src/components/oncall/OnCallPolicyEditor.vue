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

          <div v-if="rung.steps.length" class="flex flex-col gap-2">
            <div
              v-for="(step, stepIndex) in rung.steps"
              :key="stepIndex"
              class="flex flex-wrap items-end gap-2"
            >
              <div class="w-44">
                <OSelect
                  v-model="step.level"
                  :label="stepIndex === 0 ? t('oncall.level') : undefined"
                  :options="levelOptions"
                  :data-test="`oncall-policy-step-level-${rung.priority}-${stepIndex}`"
                />
              </div>
              <div class="w-44">
                <OSelect
                  v-model="step.after_micros"
                  :label="stepIndex === 0 ? t('oncall.after') : undefined"
                  :options="delayOptions"
                  :data-test="`oncall-policy-step-delay-${rung.priority}-${stepIndex}`"
                />
              </div>
              <OButton
                variant="ghost"
                size="icon-sm"
                icon-left="close"
                :aria-label="t('oncall.removeStep')"
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
              {{ t("oncall.addStep") }}
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
                :model-value="rung.channels.includes(channel)"
                :label="t(`oncall.channel_${channel}`)"
                :data-test="`oncall-policy-channel-${rung.priority}-${channel}`"
                @update:model-value="(on: CheckboxModelValue) => toggleChannel(rung, channel, on === true)"
              />
            </div>
          </div>
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
import { computed, ref, watch } from "vue";
import { useStore } from "vuex";

import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OCard from "@/lib/core/Card/OCard.vue";
import OCardSection from "@/lib/core/Card/OCardSection.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import type { CheckboxModelValue } from "@/lib/forms/Checkbox/OCheckbox.types";
import { toast } from "@/lib/feedback/Toast/useToast";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import oncallService from "@/services/oncall";
import type { Channel, OnCallPolicy, PriorityRung } from "@/ts/interfaces/oncall";
import { HUMAN_LEVELS, MICROS_PER_MINUTE } from "@/ts/interfaces/oncall";
import { raw, useI18nTyped } from "@/types/i18n";
import { DELIVERABLE_CHANNELS, priorityLabel, priorityTagVariant } from "@/utils/oncall";

const props = defineProps<{ teamId: string; policy: OnCallPolicy | null }>();
const emit = defineEmits<{ saved: [] }>();

const { t } = useI18nTyped();
const store = useStore();

// Only channels a Notifier can actually send. Rendering the rest would let
// somebody tick SMS and receive nothing.
const CHANNELS = DELIVERABLE_CHANNELS;

const draft = ref<PriorityRung[]>([]);
const saving = ref(false);

const orgId = computed(() => store.state.selectedOrganization.identifier);

const levelOptions = computed(() =>
  HUMAN_LEVELS.map((level) => ({ label: t(`oncall.level_${level}`), value: level })),
);

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
}

watch(() => props.policy, reset, { immediate: true });

function addStep(rung: PriorityRung) {
  // Defaults to the first level not already on this ladder — the server
  // refuses a duplicate level, so offering one would only produce an error.
  const used = new Set(rung.steps.map((s) => s.level));
  const nextLevel = HUMAN_LEVELS.find((level) => !used.has(level));
  if (!nextLevel) return;
  const lastDelay = rung.steps.length
    ? rung.steps[rung.steps.length - 1].after_micros
    : -MICROS_PER_MINUTE * 5;
  rung.steps.push({ level: nextLevel, after_micros: lastDelay + 5 * MICROS_PER_MINUTE });
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
      data: { rungs: draft.value },
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
