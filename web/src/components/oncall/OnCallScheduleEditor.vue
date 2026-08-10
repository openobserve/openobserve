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
  <OCard data-test="oncall-schedule-editor">
    <OCardSection>
      <p class="text-text-secondary mb-4 text-sm">{{ t("oncall.scheduleHint") }}</p>

      <div class="flex flex-col gap-4">
        <div
          v-for="(rotation, index) in draft"
          :key="rotation.level"
          class="border-border-default flex flex-col gap-3 rounded-surface border p-4"
          data-test="oncall-schedule-rotation"
        >
          <div class="flex flex-wrap items-center justify-between gap-2">
            <OTag variant="default-soft" size="sm">
              {{ t(`oncall.level_${rotation.level}`) }}
            </OTag>
            <OButton
              variant="ghost"
              size="sm"
              icon-left="delete"
              data-test="oncall-schedule-remove-rotation"
              @click="draft.splice(index, 1)"
            >
              {{ t("oncall.removeRotation") }}
            </OButton>
          </div>

          <!-- Order is the handover order, so it is stated rather than implied. -->
          <div class="flex flex-col gap-1">
            <span class="text-text-label text-xs">{{ t("oncall.rotationOrder") }}</span>
            <div class="flex flex-wrap gap-2">
              <div
                v-for="(email, memberIndex) in rotation.members"
                :key="`${email}-${memberIndex}`"
                class="border-border-default flex items-center gap-1 rounded-default border px-2 py-1"
              >
                <span class="text-text-muted text-2xs">{{ raw(`${memberIndex + 1}`) }}</span>
                <span class="text-text-body text-sm">{{ raw(email) }}</span>
                <OButton
                  variant="ghost"
                  size="icon-xs"
                  icon-left="arrow-upward"
                  :disabled="memberIndex === 0"
                  :aria-label="t('oncall.moveEarlier')"
                  @click="moveMember(rotation, memberIndex, -1)"
                />
                <OButton
                  variant="ghost"
                  size="icon-xs"
                  icon-left="close"
                  :aria-label="t('oncall.removeFromRotation')"
                  @click="rotation.members.splice(memberIndex, 1)"
                />
              </div>
              <p v-if="!rotation.members.length" class="text-text-secondary text-sm">
                {{ t("oncall.rotationEmpty") }}
              </p>
            </div>
          </div>

          <div class="flex flex-wrap items-end gap-2">
            <div class="w-64">
              <OSelect
                v-model="memberPicker[rotation.level]"
                :label="t('oncall.addToRotation')"
                :options="availableFor(rotation)"
                :data-test="`oncall-schedule-member-select-${rotation.level}`"
              />
            </div>
            <OButton
              variant="outline"
              size="sm-action"
              :disabled="!memberPicker[rotation.level]"
              @click="addToRotation(rotation)"
            >
              {{ t("oncall.add") }}
            </OButton>
            <div class="w-48">
              <OSelect
                v-model="rotation.shift_micros"
                :label="t('oncall.shiftLength')"
                :options="shiftOptions"
                :data-test="`oncall-schedule-shift-select-${rotation.level}`"
              />
            </div>
          </div>

          <p class="text-text-muted text-xs">
            {{ t("oncall.handoverSummary", { shift: formatShift(rotation.shift_micros) }) }}
          </p>
        </div>

        <div class="flex flex-wrap items-end gap-2">
          <div class="w-48">
            <OSelect
              v-model="newRotationLevel"
              :label="t('oncall.addRotation')"
              :options="unusedLevelOptions"
              data-test="oncall-schedule-new-level"
            />
          </div>
          <OButton
            variant="outline"
            size="sm-action"
            :disabled="!unusedLevelOptions.length"
            data-test="oncall-schedule-add-rotation"
            @click="addRotation"
          >
            {{ t("oncall.add") }}
          </OButton>
        </div>

        <div class="flex justify-end gap-2">
          <OButton variant="outline" size="sm-action" @click="reset">
            {{ t("oncall.cancel") }}
          </OButton>
          <OButton
            variant="primary"
            size="sm-action"
            :loading="saving"
            data-test="oncall-schedule-save"
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
import { toast } from "@/lib/feedback/Toast/useToast";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import oncallService from "@/services/oncall";
import type {
  EscalationLevel,
  OnCallSchedule,
  OnCallTeamMember,
  Rotation,
} from "@/ts/interfaces/oncall";
import { HUMAN_LEVELS, MICROS_PER_WEEK } from "@/ts/interfaces/oncall";
import { raw, useI18nTyped } from "@/types/i18n";
import { SHIFT_PRESETS, formatShift, levelOrder } from "@/utils/oncall";

const props = defineProps<{
  teamId: string;
  timezone: string;
  schedule: OnCallSchedule | null;
  members: OnCallTeamMember[];
}>();
const emit = defineEmits<{ saved: [] }>();

const { t } = useI18nTyped();
const store = useStore();

const draft = ref<Rotation[]>([]);
const memberPicker = ref<Record<string, string>>({});
const newRotationLevel = ref<EscalationLevel>("primary");
const saving = ref(false);

const orgId = computed(() => store.state.selectedOrganization.identifier);

const shiftOptions = computed(() =>
  SHIFT_PRESETS.map((preset) => ({ label: t(preset.labelKey), value: preset.micros })),
);

const usedLevels = computed(() => new Set(draft.value.map((r) => r.level)));

const unusedLevelOptions = computed(() =>
  HUMAN_LEVELS.filter((level) => !usedLevels.value.has(level)).map((level) => ({
    label: t(`oncall.level_${level}`),
    value: level,
  })),
);

/** Members of this team not already in that rotation. */
function availableFor(rotation: Rotation) {
  const already = new Set(rotation.members);
  const emails = [...new Set(props.members.map((m) => m.user_email))];
  return emails
    .filter((email) => !already.has(email))
    .map((email) => ({ label: raw(email), value: email }));
}

function reset() {
  draft.value = (props.schedule?.rotations ?? [])
    .map((r) => ({ ...r, members: [...r.members] }))
    .sort((a, b) => levelOrder(a.level) - levelOrder(b.level));
  memberPicker.value = {};
  const firstUnused = HUMAN_LEVELS.find((level) => !usedLevels.value.has(level));
  newRotationLevel.value = firstUnused ?? "primary";
}

watch(() => props.schedule, reset, { immediate: true });

function moveMember(rotation: Rotation, index: number, delta: number) {
  const target = index + delta;
  if (target < 0 || target >= rotation.members.length) return;
  const [moved] = rotation.members.splice(index, 1);
  rotation.members.splice(target, 0, moved);
}

function addToRotation(rotation: Rotation) {
  const email = memberPicker.value[rotation.level];
  if (!email) return;
  rotation.members.push(email);
  memberPicker.value[rotation.level] = "";
}

function addRotation() {
  // Anchored to now: the first shift starts when the rotation is created,
  // which is the only anchor a user does not have to reason about.
  draft.value.push({
    level: newRotationLevel.value,
    members: [],
    shift_micros: MICROS_PER_WEEK,
    anchor_micros: Date.now() * 1000,
  });
  draft.value.sort((a, b) => levelOrder(a.level) - levelOrder(b.level));
  const firstUnused = HUMAN_LEVELS.find((level) => !usedLevels.value.has(level));
  if (firstUnused) newRotationLevel.value = firstUnused;
}

async function save() {
  // An empty rotation is refused by the server; dropping it here keeps a
  // half-filled form from failing the whole save.
  const rotations = draft.value.filter((r) => r.members.length > 0);
  saving.value = true;
  try {
    await oncallService.setSchedule({
      org_identifier: orgId.value,
      team_id: props.teamId,
      data: { timezone: props.timezone, rotations },
    });
    toast({ variant: "success", message: t("oncall.scheduleSaved") });
    emit("saved");
  } catch (err: any) {
    toast({
      variant: "error",
      message: raw(err?.response?.data?.message) || t("oncall.saveScheduleFailed"),
    });
  } finally {
    saving.value = false;
  }
}
</script>
