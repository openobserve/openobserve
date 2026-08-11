<!--
  A schedule is only comprehensible when you can see who it puts on call, so
  the calendar leads and the rotation form carries a live preview beside it.
  Configuring without one is how somebody discovers at 3am that the handover
  lands in the middle of their night.
-->
<template>
  <div class="flex flex-col gap-4" data-test="oncall-schedule-editor">
    <p
      v-if="!props.members.length"
      class="text-text-secondary text-sm"
      data-test="oncall-schedule-no-members"
    >
      {{ t("oncall.scheduleNeedsMembers") }}
    </p>

    <template v-else>
      <OnCallScheduleCalendar :rotations="draft" />

      <OTable
        :data="draft"
        :columns="columns"
        row-key="name"
        :frame="false"
        pagination="client"
        :show-global-filter="false"
        table-id="oncall-team-rotations"
        data-test="oncall-rotations-table"
        @row-click="editRotation"
      >
        <template #toolbar>
          <div class="flex w-full items-center justify-between gap-2">
            <span class="text-text-secondary text-sm">{{ t("oncall.scheduleHint") }}</span>
            <OButton
              variant="outline"
              size="sm-action"
              icon-left="add"
              data-test="oncall-schedule-add-rotation"
              @click="addRotation"
            >
              {{ t("oncall.addRotation") }}
            </OButton>
          </div>
        </template>

        <!-- The order IS the paging order, so it is shown as such: whoever is
             on now, and whoever the rotation hands to next. -->
        <template #cell-people="{ row }">
          <span class="flex flex-wrap items-center gap-1">
            <OUserCell v-for="m in row.members" :key="m" :value="m" />
            <span v-if="!row.members.length" class="text-text-muted text-sm">
              {{ t("oncall.rotationEmpty") }}
            </span>
          </span>
        </template>

        <template #cell-primary="{ row }">
          <OUserCell :value="holderOf(row, 0)" />
        </template>

        <template #cell-secondary="{ row }">
          <OUserCell :value="holderOf(row, 1)" />
        </template>

        <template #cell-actions="{ row }">
          <OButton
            variant="ghost"
            size="icon-sm"
            icon-left="delete-outline"
            :aria-label="t('oncall.removeRotation')"
            :data-test="`oncall-schedule-remove-${row.name}`"
            @click.stop="removeRotation(row)"
          />
        </template>

        <template #empty>
          <OEmptyState
            size="compact"
            preset="no-data"
            :description="t('oncall.noRotations')"
            data-test="oncall-schedule-empty"
          />
        </template>
      </OTable>

      <div class="flex justify-end gap-2">
        <OButton variant="outline" size="sm-action" @click="reset">
          {{ t("oncall.cancel") }}
        </OButton>
        <OButton
          variant="primary"
          size="sm-action"
          :loading="saving"
          :disabled="!dirty"
          data-test="oncall-schedule-save"
          @click="save"
        >
          {{ t("oncall.save") }}
        </OButton>
      </div>
    </template>

    <!-- Editing gets room and a preview rather than expanding the page. -->
    <ODrawer
      v-model:open="editing"
      :title="t('oncall.rotationTitle')"
      data-test="oncall-rotation-drawer"
    >
      <div v-if="active" class="flex flex-col gap-5">
        <OInput
          v-model="active.name"
          :label="t('oncall.rotationName')"
          data-test="oncall-schedule-name"
        />

        <OSelect
          :model-value="active.members"
          multiple
          searchable
          :label="t('oncall.rotationOrder')"
          :help-text="t('oncall.rotationOrderHint')"
          :placeholder="t('oncall.rotationPickPlaceholder')"
          :options="memberOptions"
          data-test="oncall-schedule-members"
          @update:model-value="(v: unknown) => setMembers(active as Rotation, v as string[])"
        />

        <OSelect
          v-model="active.shift_micros"
          :label="t('oncall.shiftLength')"
          :options="shiftOptions"
          data-test="oncall-schedule-shift"
        />

        <!-- Without this the anchor was silently "now", so a rotation created
             at 14:32 handed over at 14:32 forever. -->
        <OInput
          :model-value="handoverInput(active)"
          type="datetime-local"
          :label="t('oncall.firstHandover')"
          data-test="oncall-schedule-handover"
          @update:model-value="(v: string | number) => setAnchor(active as Rotation, String(v))"
        />

        <div v-if="active.members.length" class="flex flex-col gap-1">
          <span class="text-text-label text-xs">{{ t("oncall.upcoming") }}</span>
          <div
            v-for="shift in preview(active)"
            :key="shift.startMicros"
            class="flex flex-wrap items-center gap-2"
            data-test="oncall-schedule-preview-shift"
          >
            <OUserCell :value="shift.member" />
            <span class="text-text-muted text-xs">{{ raw(shiftRange(shift)) }}</span>
            <OTag v-if="isCurrent(shift)" variant="success-soft" size="xs">
              {{ t("oncall.onCallNowTag") }}
            </OTag>
          </div>
        </div>
      </div>

      <template #footer>
        <div class="flex justify-end gap-2">
          <OButton variant="outline" size="sm-action" @click="editing = false">
            {{ t("oncall.cancel") }}
          </OButton>
          <OButton
            variant="primary"
            size="sm-action"
            :loading="saving"
            data-test="oncall-rotation-done"
            @click="save"
          >
            {{ t("oncall.save") }}
          </OButton>
        </div>
      </template>
    </ODrawer>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useStore } from "vuex";

import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import OnCallScheduleCalendar from "@/components/oncall/OnCallScheduleCalendar.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OUserCell from "@/lib/core/Table/cells/OUserCell.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
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
const editing = ref(false);
const active = ref<Rotation | null>(null);

/// Primary and secondary are POSITIONS in one rotation, not two rotations to
/// staff. This is the same walk the engine does when it pages.
function holderOf(rotation: Rotation, offset: number): string {
  const shifts = preview(rotation);
  return shifts[offset]?.member ?? "";
}

const columns = computed<OTableColumnDef<Rotation>[]>(() => [
  {
    id: "name",
    header: t("oncall.rotationName"),
    accessorFn: (row: Rotation) => row.name,
    meta: { isName: true },
  },
  {
    id: "primary",
    header: t("oncall.rolePrimary"),
    accessorFn: (row: Rotation) => holderOf(row, 0),
  },
  {
    id: "secondary",
    header: t("oncall.roleSecondary"),
    accessorFn: (row: Rotation) => holderOf(row, 1),
  },
  {
    id: "people",
    header: t("oncall.rotationOrder"),
    accessorFn: (row: Rotation) => row.members.join(", "),
    hideable: true,
  },
  {
    id: "actions",
    header: t("oncall.actions"),
    isAction: true,
    sortable: false,
    size: 80,
    meta: { align: "center", cellClass: "actions-column", actionCount: 1 },
  },
]);

const dirty = computed(
  () => JSON.stringify(draft.value) !== JSON.stringify(props.schedule?.rotations ?? []),
);

function editRotation(rotation: Rotation) {
  active.value = rotation;
  editing.value = true;
}

function removeRotation(rotation: Rotation) {
  draft.value = draft.value.filter((r) => r !== rotation);
}
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
  // NOT named "Primary". Primary and secondary are POSITIONS within a
  // rotation, so naming the rotation itself "Primary" reads as though a
  // second one called "Secondary" is also required. Most teams have exactly
  // one; a second is for follow-the-sun, each covering part of the day.
  // A distinct priority is mandatory, not cosmetic: two rotations with the
  // same priority and the same (empty) restrictions are "equally in force",
  // and the server rejects the ENTIRE save — taking the rotation that already
  // worked down with the new one. Newer rotations sit above the base, which
  // stays the catch-all underneath.
  const highest = draft.value.reduce((max, r) => Math.max(max, r.priority ?? 0), 0);
  const rotation: Rotation = {
    name: draft.value.length
      ? t("oncall.rotationNthName", { n: draft.value.length + 1 })
      : t("oncall.rotationDefaultName"),
    members: [],
    shift_micros: MICROS_PER_WEEK,
    // Top of the hour, so a handover is readable rather than landing at
    // whatever minute somebody happened to click Add.
    anchor_micros: Math.floor(nowMicros.value / 3_600_000_000) * 3_600_000_000,
    priority: draft.value.length ? highest + 1 : 0,
    restrictions: [],
  };
  draft.value.push(rotation);
  // Straight into the editor: an empty row is not something anybody can act on.
  editRotation(rotation);
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
    // Close BEFORE the parent refetches. `reset` rebuilds `draft` from the new
    // props, which detaches `active` from it — leaving the drawer open over an
    // object nothing reads, so every further keystroke went nowhere.
    editing.value = false;
    active.value = null;
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
