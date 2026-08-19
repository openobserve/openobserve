<!--
  A schedule is only comprehensible when you can see who it puts on call, so
  the calendar leads and the rotation form carries a live preview beside it.
  Configuring without one is how somebody discovers at 3am that the handover
  lands in the middle of their night.
-->
<template>
  <div class="flex flex-col gap-4" data-test="oncall-schedule-editor">
    <OText variant="body"
      v-if="!drawerOnly && !props.members.length"
      data-test="oncall-schedule-no-members">
      {{ t("oncall.scheduleNeedsMembers") }}
    </OText>

    <!-- No second drawing of the week here. This one resolved who was on call
         CLIENT-side, so it could not see overrides, absences or slots, and it
         disagreed with the server-resolved timeline sitting on the same tab. -->
    <template v-else-if="!drawerOnly">
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
            <OText variant="body" as="span" v-if="!row.members.length">
              {{ t("oncall.rotationEmpty") }}
            </OText>
          </span>
        </template>

        <!-- A retired layer still resolves for the past, so it stays in the
             list — but it is not staffing anything now, and a row that reads
             like the others would have somebody looking for the person it
             names. -->
        <template #cell-name="{ row }">
          <span class="flex flex-wrap items-center gap-2">
            {{ raw(row.name) }}
            <OTag
              v-if="isRetired(row)"
              variant="default-soft"
              size="xs"
              :data-test="`oncall-schedule-retired-${row.name}`"
            >
              {{ t("oncall.rotationRetiredOnDate", { date: raw(shortDate(row.ends_at ?? 0)) }) }}
            </OTag>
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
            size="inline"
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
      :title="isNew ? t('oncall.rotationAddTitle') : t('oncall.rotationTitle')"
      :subtitle="t('oncall.rotationDrawerHint')"
      data-test="oncall-rotation-drawer"
    >
      <!-- Three questions in the order somebody answers them — what is it, who
           is in it, when does it turn over — then what that produces. A flat
           stack of four controls made the last two read as afterthoughts. -->
      <div v-if="active" class="flex flex-col gap-6">
        <section class="flex flex-col gap-4">
          <OText variant="section">{{ t("oncall.rotationSectionWhat") }}</OText>

          <OInput
            v-model="active.name"
            :label="t('oncall.rotationName')"
            data-test="oncall-schedule-name"
          />

          <!-- The field that makes a secondary a separate pool rather than
               next week's primary. Without it a team can staff one and no rung
               can ever name it. -->
          <OSelect
            :model-value="active.slot ?? DEFAULT_SLOT"
            :label="t('oncall.rotationSlot')"
            :help-text="t('oncall.rotationSlotHint')"
            :options="slotOptions"
            data-test="oncall-schedule-slot"
            @update:model-value="(v: unknown) => setSlot(active as Rotation, String(v))"
          />
        </section>

        <section class="flex flex-col gap-4">
          <OText variant="section">{{ t("oncall.rotationSectionWho") }}</OText>

          <!-- The picker draws from the team roster, so on an empty team it has
               nothing to offer. Saying so beats a select that opens on nothing. -->
          <div
            v-if="!props.members.length"
            class="border-border-default rounded-surface flex flex-wrap items-center gap-3 border p-3"
            data-test="oncall-rotation-no-members"
          >
            <span class="text-text-secondary min-w-0 flex-1 text-sm">
              {{ t("oncall.scheduleNeedsMembers") }}
            </span>
            <OButton
              variant="outline"
              size="sm-action"
              data-test="oncall-rotation-open-members"
              @click="openMembers"
            >
              {{ t("oncall.rotationOpenMembers") }}
            </OButton>
          </div>

          <OSelect
            :model-value="active.members"
            multiple
            searchable
            :label="t('oncall.rotationOrder')"
            :help-text="t('oncall.rotationOrderHint')"
            :placeholder="t('oncall.rotationPickPlaceholder')"
            :options="memberOptions"
            :disabled="!props.members.length"
            data-test="oncall-schedule-members"
            @update:model-value="(v: unknown) => setMembers(active as Rotation, v as string[])"
          />

          <!-- The server refuses a rotation with nobody in it, so this one would
               store nothing. Said next to the pick that fixes it. -->
          <p
            v-if="!active.members.length"
            class="text-status-warning-text text-sm"
            data-test="oncall-rotation-needs-people"
          >
            {{ t("oncall.rotationNeedsPeople") }}
          </p>

          <!-- Catching this while somebody is still looking at the rotation is
               the entire value; catching it at 3am is not. The rota will pass
               the shift on — the warning is that the order will not be the one
               being written here. -->
          <p
            v-for="clash in awayClashes"
            :key="clash.id"
            class="text-status-warning-text text-sm"
            :data-test="`oncall-schedule-away-${clash.user_email}`"
          >
            {{
              t("oncall.rotationMemberAway", {
                who: raw(clash.user_email),
                from: raw(shortDate(clash.start_at)),
                to: raw(shortDate(clash.end_at)),
              })
            }}
          </p>
        </section>

        <section class="flex flex-col gap-4">
          <OText variant="section">{{ t("oncall.rotationSectionWhen") }}</OText>

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
            :help-text="handoverHint"
            data-test="oncall-schedule-handover"
            @update:model-value="(v: string | number) => setAnchor(active as Rotation, String(v))"
          />
        </section>


        <!-- The half of a layer the editor could not express at all: a
             follow-the-sun setup was preset-or-API only, and a rotation the
             API had restricted rendered here as if it applied always. -->
        <section class="flex flex-col gap-4">
          <OText variant="section">{{ t("oncall.rotationSectionApplies") }}</OText>

          <OText variant="body">{{ t("oncall.rotationRestrictionHint") }}</OText>

          <div
            v-for="(window, index) in active.restrictions ?? []"
            :key="index"
            class="border-border-default rounded-surface flex flex-wrap items-end gap-3 border p-3"
            :data-test="`oncall-schedule-restriction-${index}`"
          >
            <OSelect
              :model-value="window.days"
              multiple
              :label="t('oncall.rotationRestrictionDays')"
              :options="dayOptions"
              width="sm"
              :data-test="`oncall-schedule-restriction-days-${index}`"
              @update:model-value="(v: unknown) => (window.days = (v as number[]) ?? [])"
            />
            <OSelect
              :model-value="window.start_minute"
              :label="t('oncall.rotationRestrictionFrom')"
              :options="minuteOptions"
              width="xs"
              :data-test="`oncall-schedule-restriction-from-${index}`"
              @update:model-value="(v: unknown) => (window.start_minute = Number(v))"
            />
            <OSelect
              :model-value="window.end_minute"
              :label="t('oncall.rotationRestrictionTo')"
              :options="minuteOptions"
              width="xs"
              :data-test="`oncall-schedule-restriction-to-${index}`"
              @update:model-value="(v: unknown) => (window.end_minute = Number(v))"
            />
            <OButton
              variant="ghost"
              size="sm-action"
              icon-left="delete-outline"
              :data-test="`oncall-schedule-restriction-remove-${index}`"
              @click="removeRestriction(index)"
            >
              {{ t("oncall.rotationRestrictionRemove") }}
            </OButton>
          </div>

          <div class="flex">
            <OButton
              variant="outline"
              size="sm-action"
              icon-left="add"
              data-test="oncall-schedule-restriction-add"
              @click="addRestriction"
            >
              {{ t("oncall.rotationRestrictionAdd") }}
            </OButton>
          </div>

          <!-- Two layers that both apply and share a priority are "equally in
               force", and the server refuses the WHOLE save — taking the
               rotation that already worked down with the edit. -->
          <OSelect
            :model-value="active.priority ?? 0"
            :label="t('oncall.rotationPriority')"
            :help-text="t('oncall.rotationPriorityHint')"
            :options="priorityOptions"
            width="sm"
            data-test="oncall-schedule-priority"
            @update:model-value="(v: unknown) => setPriority(active as Rotation, Number(v))"
          />
          <p
            v-if="priorityClash"
            class="text-status-warning-text text-sm"
            data-test="oncall-schedule-priority-clash"
          >
            {{ priorityClash }}
          </p>

          <!-- Retiring a layer, rather than deleting it. Delete was the only
               way to stop a rotation and it threw away the record of who had
               been covering those hours, so "the weekend layer ran until
               March" stopped being something the schedule could say. -->
          <div class="flex flex-col gap-2">
            <OCheckbox
              :model-value="isRetired(active)"
              :label="t('oncall.rotationRetire')"
              data-test="oncall-schedule-retire"
              @update:model-value="(on: CheckboxModelValue) => setRetired(active as Rotation, !!on)"
            />
            <OText variant="meta">{{ t("oncall.rotationRetireHint") }}</OText>
            <OInput
              v-if="isRetired(active)"
              type="datetime-local"
              width="md"
              :model-value="retiredAtLocal(active)"
              :label="t('oncall.rotationRetiredOn')"
              :help-text="t('oncall.rotationRetiredOnHint', { zone: raw(props.timezone) })"
              data-test="oncall-schedule-retire-at"
              @update:model-value="(v: string | number) => setRetiredAt(active as Rotation, v)"
            />
          </div>
        </section>

        <!-- The answer the form produces. It is the reason to have a drawer at
             all: a cadence and an anchor are not readable as a rota until you
             see the dates they generate. -->
        <section class="flex flex-col gap-2">
          <OText variant="section">{{ t("oncall.upcoming") }}</OText>

          <div
            v-if="active.members.length"
            class="border-border-default rounded-surface flex flex-col divide-y divide-border-default border"
          >
            <div
              v-for="shift in preview(active)"
              :key="shift.startMicros"
              class="flex flex-wrap items-center gap-2 px-3 py-2"
              data-test="oncall-schedule-preview-shift"
            >
              <OUserCell :value="shift.member" />
              <span class="text-text-muted ms-auto text-xs">{{ raw(shiftRange(shift)) }}</span>
              <OTag v-if="isCurrent(shift)" variant="success-soft" size="xs">
                {{ t("oncall.onCallNowTag") }}
              </OTag>
            </div>
          </div>

          <!-- An empty preview is the most common state of a NEW rotation, and
               saying why beats showing nothing. -->
          <OText variant="body" v-else data-test="oncall-schedule-preview-empty">
            {{ t("oncall.rotationPreviewEmpty") }}
          </OText>
        </section>
      </div>

      <template #footer>
        <div class="flex items-center gap-2">
          <!-- The only home deletion has now that the bulk table is not on the
               path. Absent on a new rotation — cancel already discards it. -->
          <OButton
            v-if="!isNew"
            variant="ghost"
            size="sm-action"
            icon-left="delete-outline"
            :loading="saving"
            data-test="oncall-rotation-delete"
            @click="deleteActive"
          >
            {{ t("oncall.removeRotation") }}
          </OButton>
          <OButton variant="outline" size="sm-action" class="ms-auto" @click="cancelDrawer">
            {{ t("oncall.cancel") }}
          </OButton>
          <OButton
            variant="primary"
            size="sm-action"
            :loading="saving"
            :disabled="!!priorityClash || !activeIsStaffed"
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
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import type { CheckboxModelValue } from "@/lib/forms/Checkbox/OCheckbox.types";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OText from "@/lib/core/Typography/OText.vue";
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
  ScheduleEditorIntent,
  Unavailability,
} from "@/ts/interfaces/oncall";
import { DEFAULT_SLOT, MICROS_PER_WEEK, sameSlot } from "@/ts/interfaces/oncall";
import type { I18nKey, I18nText } from "@/types/i18n";
import { raw, useI18nTyped } from "@/types/i18n";
import type { Shift } from "@/utils/oncall";
import {
  formatMinuteOfDay,
  fromZonedInputValue,
  SHIFT_PRESETS,
  toZonedInputValue,
  upcomingShifts,
} from "@/utils/oncall";

const PREVIEW_SHIFTS = 5;

/// The second pool a team reaches for. Offered by name so the common case does
/// not depend on somebody spelling it the same way the ladder does.
const SECONDARY_SLOT = "secondary";

const props = defineProps<{
  teamId: string;
  timezone: string;
  schedule: OnCallSchedule | null;
  members: OnCallTeamMember[];
  /** What the user asked for when they opened this. See `ScheduleEditorIntent`. */
  intent?: ScheduleEditorIntent | null;
  /**
   * Render only the drawer, over whatever view mounted this.
   *
   * The inline calendar/table/save surface is the bulk editor; opening it to
   * add ONE rotation put a page-sized mode between the button and the form.
   */
  drawerOnly?: boolean;
}>();
const emit = defineEmits<{
  saved: [];
  "intent-handled": [];
  /** Nothing here can add a person, so the roster is asked for by name. */
  "open-members": [];
}>();

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

/// A rotation the user has not saved yet: the drawer says "Add", and its empty
/// preview is expected rather than a fault.
const isNew = ref(false);

/// Absences over the editing horizon, fetched when the drawer opens. A
/// failure leaves the list empty and the warning off — a false "Ana is away"
/// would get a working rotation rewritten.
const ABSENCE_HORIZON_DAYS = 30;
const editorAbsences = ref<Unavailability[]>([]);
watch(editing, async (isOpen) => {
  if (!isOpen) return;
  try {
    const now = Date.now() * 1000;
    const res = await oncallService.listUnavailability({
      org_identifier: orgId.value,
      from: now,
      to: now + ABSENCE_HORIZON_DAYS * 86_400_000_000,
    });
    editorAbsences.value = res.data ?? [];
  } catch {
    editorAbsences.value = [];
  }
});

/// One line per chosen member with an absence in the horizon.
const awayClashes = computed(() => {
  const chosen = new Set((active.value?.members ?? []).map((m) => m.toLowerCase()));
  return editorAbsences.value.filter((a) => chosen.has(a.user_email.toLowerCase()));
});

function shortDate(micros: number): string {
  return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" }).format(
    new Date(micros / 1000),
  );
}

function editRotation(rotation: Rotation) {
  active.value = rotation;
  editing.value = true;
}

/// The slots this team already staffs, plus the two everyone starts from.
/// Offered as a list rather than free text because a typo is a rotation that
/// resolves on its own and is reached by no rung.
const slotOptions = computed(() => {
  const used = draft.value.map((r) => r.slot ?? DEFAULT_SLOT);
  const names = [...new Set([DEFAULT_SLOT, SECONDARY_SLOT, ...used])];
  return names.map((name) => ({ label: raw(name), value: name }));
});

function setSlot(rotation: Rotation, slot: string) {
  rotation.slot = slot;
}

/// The zone the handover is measured in. It is the team's, never the browser's,
/// and getting that wrong is the single easiest mistake in this form.
const handoverHint = computed(() => t("oncall.firstHandoverHint", { zone: raw(props.timezone) }));

function removeRotation(rotation: Rotation) {
  draft.value = draft.value.filter((r) => r !== rotation);
}
const nowMicros = ref(Date.now() * 1000);

const orgId = computed(() => store.state.selectedOrganization.identifier);

/// A rotation with nobody in it stores nothing, so Save stays out of reach
/// until somebody is picked.
const activeIsStaffed = computed(() => !!active.value?.members.length);

function openMembers() {
  cancelDrawer();
  emit("open-members");
}

const memberOptions = computed(() =>
  props.members.map((m) => ({ label: raw(m.user_email), value: m.user_email })),
);

const shiftOptions = computed(() =>
  SHIFT_PRESETS.map((preset) => ({ label: t(preset.labelKey), value: preset.micros })),
);

/// 0 = Monday .. 6 = Sunday, matching the engine's own numbering.
const DAY_KEYS: I18nKey[] = [
  "oncall.day_mon",
  "oncall.day_tue",
  "oncall.day_wed",
  "oncall.day_thu",
  "oncall.day_fri",
  "oncall.day_sat",
  "oncall.day_sun",
];

const dayOptions = computed(() => DAY_KEYS.map((key, value) => ({ label: t(key), value })));

/// Half-hours from local midnight, plus 24:00 as an end — a window ending at
/// midnight is the common night shift, and 00:00 would read as zero length.
const minuteOptions = computed(() =>
  Array.from({ length: 49 }, (_, index) => index * 30).map((minute) => ({
    label: raw(minute === 1440 ? "24:00" : formatMinuteOfDay(minute)),
    value: minute,
  })),
);

/// Offered rather than typed. Two layers that both apply and share a priority
/// are equally in force, and the server rejects the ENTIRE save rather than
/// the one rotation — so a free number field is a way to take a working rota
/// down while editing something else.
const priorityOptions = computed(() => {
  const highest = draft.value.reduce((max, r) => Math.max(max, r.priority ?? 0), 0);
  const mine = active.value?.priority ?? 0;
  const levels = new Set<number>([0, mine, highest, highest + 1]);
  return [...levels]
    .filter((level) => level >= 0)
    .sort((a, b) => a - b)
    .map((level) => ({
      label: level === 0 ? t("oncall.rotationPriorityBase") : raw(String(level)),
      value: level,
    }));
});

/// Only rotations sharing a SLOT compete: two slots resolve at the same instant
/// with their own members, so an identical priority across them is not a clash.
const priorityClash = computed<I18nText | "">(() => {
  const rotation = active.value;
  if (!rotation) return "";
  const rival = draft.value.find(
    (other) =>
      other !== rotation &&
      other.name !== rotation.name &&
      sameSlot(other.slot, rotation.slot) &&
      (other.priority ?? 0) === (rotation.priority ?? 0),
  );
  return rival ? t("oncall.rotationPriorityClash", { name: raw(rival.name) }) : "";
});

function setPriority(rotation: Rotation, priority: number) {
  rotation.priority = priority;
}

/// ── Retiring a layer ──────────────────────────────────────────────────────
///
/// `ends_at` is how a rotation is taken out of service without deleting it.
/// Deleting was the only way to stop one, and it discarded exactly the record
/// the field exists to keep: "the weekend layer ran until March" stopped being
/// something the schedule could say, and the calendar lost the reason those
/// hours had been covered at all.
///
/// The end is exclusive, like every other boundary here.
const isRetired = (rotation: Rotation) => rotation.ends_at !== undefined;

const retiredAt = (rotation: Rotation) => rotation.ends_at ?? nowMicros.value;

/// The picker is a `datetime-local`, which has no timezone of its own — so the
/// value is rendered in the TEAM's zone and labelled with it, rather than in
/// whatever zone the reader's laptop is set to.
function retiredAtLocal(rotation: Rotation): string {
  return toZonedInputValue(retiredAt(rotation), props.timezone);
}

function setRetired(rotation: Rotation, on: boolean) {
  // Defaults to now: "retire this" almost always means "as of today", and a
  // date somebody has to fill in before the checkbox means anything is a
  // second step for the common case.
  rotation.ends_at = on ? retiredAt(rotation) : undefined;
}

function setRetiredAt(rotation: Rotation, value: string | number) {
  const micros = fromZonedInputValue(String(value), props.timezone);
  if (micros !== null) rotation.ends_at = micros;
}

/// A window with no days applies on no day, which is a rotation that resolves
/// to nobody — so a new one starts as the working week.
function addRestriction() {
  const rotation = active.value;
  if (!rotation) return;
  rotation.restrictions = [
    ...(rotation.restrictions ?? []),
    { days: [0, 1, 2, 3, 4], start_minute: 9 * 60, end_minute: 17 * 60 },
  ];
}

function removeRestriction(index: number) {
  const rotation = active.value;
  if (!rotation?.restrictions) return;
  rotation.restrictions = rotation.restrictions.filter((_, at) => at !== index);
}





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

/// In the TEAM's zone, which is what the label beside it promises and what
/// every restriction window is evaluated in. Read and written with the
/// browser's zone, an operator in Berlin editing an Asia/Kolkata team saw the
/// handover three and a half hours from where it was — and moved it there by
/// saving.
function handoverInput(rotation: Rotation): string {
  return toZonedInputValue(rotation.anchor_micros, props.timezone);
}

function setAnchor(rotation: Rotation, value: string) {
  const micros = fromZonedInputValue(value, props.timezone);
  // An incomplete value means the user is mid-edit; keeping the previous
  // anchor beats writing NaN and blanking the preview.
  if (micros !== null) rotation.anchor_micros = micros;
}

function reset() {
  draft.value = (props.schedule?.rotations ?? []).map((r) => ({
    ...r,
    members: [...r.members],
  }));
  nowMicros.value = Date.now() * 1000;
}

watch(() => props.schedule, reset, { immediate: true });

/// Act on the intent once the draft exists — opening the drawer against a
/// rotation the reset had not copied yet would edit a row that vanishes.
watch(
  () => props.intent,
  (intent) => {
    if (!intent) return;
    if (intent.mode === "new") {
      addRotation();
    } else if (intent.mode === "duplicate") {
      duplicateRotation(intent.name);
    } else {
      const found = draft.value.find((r) => r.name === intent.name);
      if (found) {
        isNew.value = false;
        editRotation(found);
      }
    }
    emit("intent-handled");
  },
  { immediate: true, flush: "post" },
);

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
  isNew.value = true;
  editRotation(rotation);
}

/// A copy is a starting point, not a save: the editor opens on a duplicate
/// nobody has committed yet, so it is named and reviewed before it is real. The
/// name must differ — the server keys a rotation by it — and so must the
/// priority, or two identical layers are "equally in force" and the whole save
/// is refused, taking the working one down with the copy.
function duplicateRotation(name: string) {
  const source = draft.value.find((r) => r.name === name);
  if (!source) return;
  const highest = draft.value.reduce((max, r) => Math.max(max, r.priority ?? 0), 0);
  const copy: Rotation = {
    ...source,
    name: String(t("oncall.railCopyName", { name: raw(source.name) })),
    members: [...source.members],
    restrictions: source.restrictions ? [...source.restrictions] : [],
    priority: highest + 1,
  };
  draft.value.push(copy);
  isNew.value = true;
  editRotation(copy);
}

/// Cancel must also discard. In the bulk editor an abandoned draft stays
/// visible and Cancel/Save deal with it; drawer-only has no such surface, so a
/// half-added rotation would silently linger and reappear on the next open.
function cancelDrawer() {
  editing.value = false;
  active.value = null;
  if (props.drawerOnly) reset();
}

/// Deletion is a save: the drawer is the only surface, so there is no separate
/// "now press Save" step to forget.
async function deleteActive() {
  const target = active.value;
  if (!target) return;
  draft.value = draft.value.filter((r) => r !== target);
  await save();
}

async function save() {
  // Dropping the empty ones and reporting success is how a rotation somebody
  // just filled in looked saved while nothing was stored: the server refuses a
  // rotation with nobody in it, so this has to be refused here and said out loud.
  const empty = draft.value.find((r) => !r.members.length);
  if (empty) {
    toast({
      variant: "error",
      message: t("oncall.rotationEmptyNotSaved", { name: raw(empty.name) }),
    });
    return;
  }
  const rotations = draft.value;
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
