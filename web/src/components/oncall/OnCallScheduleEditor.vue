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

<!--
  A schedule is only comprehensible when you can see who it puts on call, so
  every rotation shows its upcoming shifts beside its settings. Configuring
  without a preview is how somebody discovers at 3am that the handover lands in
  the middle of their night.
-->
<template>
  <OCard data-test="oncall-schedule-editor">
    <OCardSection>
      <p class="text-text-secondary mb-4 text-sm">{{ t("oncall.scheduleHint") }}</p>

      <p
        v-if="!props.members.length"
        class="text-text-secondary text-sm"
        data-test="oncall-schedule-no-members"
      >
        {{ t("oncall.scheduleNeedsMembers") }}
      </p>

      <div v-else class="flex flex-col gap-4">
        <!-- Answer-first: the shape of the coming weeks, before the form that
             edits it. -->
        <OnCallScheduleCalendar :rotations="draft" />

        <div
          v-for="(rotation, index) in draft"
          :key="index"
          class="border-border-default flex flex-col gap-3 rounded-surface border p-4"
          data-test="oncall-schedule-rotation"
        >
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div class="w-56">
              <OInput
                v-model="rotation.name"
                :label="t('oncall.rotationName')"
                :data-test="`oncall-schedule-name-${index}`"
              />
            </div>
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

          <div class="flex flex-wrap items-end gap-2">
            <div class="min-w-0 flex-1">
              <!-- Ordered, and the order IS the handover order, so it is
                   labelled as such rather than left implicit. -->
              <OSelect
                :model-value="rotation.members"
                multiple
                searchable
                :label="t('oncall.rotationOrder')"
                :placeholder="t('oncall.rotationPickPlaceholder')"
                :options="memberOptions"
                :data-test="`oncall-schedule-members-${index}`"
                @update:model-value="(v: unknown) => setMembers(rotation, v as string[])"
              />
            </div>
            <div class="w-44">
              <OSelect
                v-model="rotation.shift_micros"
                :label="t('oncall.shiftLength')"
                :options="shiftOptions"
                :data-test="`oncall-schedule-shift-${index}`"
              />
            </div>
            <div class="w-56">
              <!-- Without this the anchor was silently "now", so a rotation
                   created at 14:32 handed over at 14:32 forever. -->
              <OInput
                :model-value="handoverInput(rotation)"
                type="datetime-local"
                :label="t('oncall.firstHandover')"
                :data-test="`oncall-schedule-handover-${index}`"
                @update:model-value="(v: string | number) => setAnchor(rotation, String(v))"
              />
            </div>
          </div>

          <div v-if="rotation.members.length" class="flex flex-col gap-1">
            <span class="text-text-label text-xs">{{ t("oncall.upcoming") }}</span>
            <div class="flex flex-col gap-1">
              <div
                v-for="shift in preview(rotation)"
                :key="shift.startMicros"
                class="flex flex-wrap items-center gap-2"
                data-test="oncall-schedule-preview-shift"
              >
                <span class="text-text-body w-40 shrink-0 text-compact">
                  {{ raw(shift.member) }}
                </span>
                <span class="text-text-muted text-xs">{{ raw(shiftRange(shift)) }}</span>
                <OTag v-if="isCurrent(shift)" variant="success-soft" size="xs">
                  {{ t("oncall.onCallNowTag") }}
                </OTag>
              </div>
            </div>
          </div>
          <p v-else class="text-text-secondary text-sm">{{ t("oncall.rotationEmpty") }}</p>
        </div>

        <div class="flex flex-wrap items-end gap-2">
          <OButton
            variant="outline"
            size="sm-action"
            data-test="oncall-schedule-add-rotation"
            @click="addRotation"
          >
            {{ t("oncall.addRotation") }}
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

import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OCard from "@/lib/core/Card/OCard.vue";
import OCardSection from "@/lib/core/Card/OCardSection.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import OnCallScheduleCalendar from "@/components/oncall/OnCallScheduleCalendar.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import oncallService from "@/services/oncall";
import type {
  OnCallSchedule,
  OnCallTeamMember,
  Rotation,
} from "@/ts/interfaces/oncall";
import { MICROS_PER_WEEK } from "@/ts/interfaces/oncall";
import { raw, useI18nTyped } from "@/types/i18n";
import type { Shift } from "@/utils/oncall";
import { SHIFT_PRESETS, upcomingShifts } from "@/utils/oncall";

const PREVIEW_SHIFTS = 5;

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
const saving = ref(false);
const nowMicros = ref(Date.now() * 1000);

const orgId = computed(() => store.state.selectedOrganization.identifier);

const memberOptions = computed(() =>
  props.members.map((m) => ({ label: raw(m.user_email), value: m.user_email })),
);

const shiftOptions = computed(() =>
  SHIFT_PRESETS.map((preset) => ({ label: t(preset.labelKey), value: preset.micros })),
);





function preview(rotation: Rotation): Shift[] {
  return upcomingShifts(rotation, nowMicros.value, PREVIEW_SHIFTS);
}

function isCurrent(shift: Shift): boolean {
  return shift.startMicros <= nowMicros.value && nowMicros.value < shift.endMicros;
}

function shiftRange(shift: Shift): string {
  const start = new Date(shift.startMicros / 1000);
  const end = new Date(shift.endMicros / 1000);
  return `${start.toLocaleString()} — ${end.toLocaleString()}`;
}

function setMembers(rotation: Rotation, members: string[]) {
  rotation.members = [...members];
}

/** `datetime-local` wants local wall time with no zone suffix. */
function handoverInput(rotation: Rotation): string {
  const d = new Date(rotation.anchor_micros / 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function setAnchor(rotation: Rotation, value: string) {
  const parsed = Date.parse(value);
  // An unparseable value means the user is mid-edit; keeping the previous
  // anchor beats writing NaN and blanking the preview.
  if (Number.isNaN(parsed)) return;
  rotation.anchor_micros = parsed * 1000;
}

function reset() {
  draft.value = (props.schedule?.rotations ?? []).map((r) => ({
    ...r,
    members: [...r.members],
  }));
  nowMicros.value = Date.now() * 1000;
}

watch(() => props.schedule, reset, { immediate: true });

function addRotation() {
  // Most teams have exactly one. A second is for follow-the-sun, where each
  // covers a different part of the day.
  draft.value.push({
    name: draft.value.length ? `Rotation ${draft.value.length + 1}` : "Primary",
    members: [],
    shift_micros: MICROS_PER_WEEK,
    anchor_micros: nowMicros.value,
  });
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
