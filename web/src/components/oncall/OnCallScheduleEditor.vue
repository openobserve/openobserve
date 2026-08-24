<!--
  A schedule is only comprehensible when you can see who it puts on call, so
  the calendar leads and the rotation form carries a live preview beside it.
  Configuring without one is how somebody discovers at 3am that the handover
  lands in the middle of their night.

  The table lists ROTATIONS — named positions, one person on call each. The
  drawer edits one rotation's SHIFT RULES, which is where layering lives.
  Two rotations are two people on call; two shift rules are one person across
  different hours. Collapsing those two ideas into one is what let a restricted
  rotation silently hand its position to somebody no rule had rostered.
-->
<template>
  <div class="flex flex-col gap-4" data-test="oncall-schedule-editor">
    <OText
      variant="body"
      v-if="!drawerOnly && !props.members.length"
      data-test="oncall-schedule-no-members"
    >
      {{ t("oncall.scheduleNeedsMembers") }}
    </OText>

    <!-- No second drawing of the week here. This one resolved who was on call
         CLIENT-side, so it could not see overrides or absences, and it
         disagreed with the server-resolved timeline sitting on the same tab. -->
    <template v-else-if="!drawerOnly">
      <OTable
        :data="draft"
        :columns="columns"
        row-key="id"
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

        <!-- A rotation the system staffed is not something somebody designed,
             and reading it as a considered choice is how a default goes
             unreviewed until it pages the wrong person. -->
        <template #cell-name="{ row }">
          <span class="flex flex-wrap items-center gap-2">
            {{ raw(row.name) }}
            <OTag
              v-if="row.source === 'default'"
              variant="default-soft"
              size="xs"
              :data-test="`oncall-schedule-default-${row.id}`"
            >
              {{ t("oncall.rotationSourceDefault") }}
            </OTag>
          </span>
        </template>

        <!-- One rotation, one person. The second column is the calendar's "up
             next" — it is NOT a position, and nothing pages it. -->
        <template #cell-oncall="{ row }">
          <OUserCell :value="holderOf(row)" />
        </template>

        <template #cell-upnext="{ row }">
          <OUserCell :value="nextOf(row)" />
        </template>

        <template #cell-rules="{ row }">
          <OText variant="body" as="span">
            {{ t("oncall.rotationRuleCount", { count: row.shift_rules?.length ?? 0 }) }}
          </OText>
        </template>

        <template #cell-actions="{ row }">
          <OButton
            variant="ghost"
            size="icon-sm"
            icon-left="delete-outline"
            :aria-label="t('oncall.removeRotation')"
            :data-test="`oncall-schedule-remove-${row.id}`"
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

    <!-- Editing gets room and a preview rather than expanding the page. The
         wide panel is what lets a shift rule read as one row of decisions
         instead of a column of wrapped paragraphs. -->
    <ODrawer
      v-model:open="editing"
      size="xl"
      :title="isNew ? t('oncall.rotationAddTitle') : t('oncall.rotationTitle')"
      :subtitle="t('oncall.rotationDrawerHint')"
      data-test="oncall-rotation-drawer"
    >
      <div v-if="active" class="flex flex-col gap-6">
        <div class="flex flex-col gap-1.5">
          <OInput
            v-model="active.name"
            :label="t('oncall.rotationName')"
            :help-text="t('oncall.rotationNameHint')"
            :maxlength="MAX_ROTATION_NAME_CHARS"
            data-test="oncall-schedule-name"
          />

          <p
            v-if="nameClash"
            class="text-status-warning-text text-xs"
            data-test="oncall-schedule-name-clash"
          >
            {{ nameClash }}
          </p>
        </div>

        <!-- The rules. One is the ordinary case and reads as the whole form, so
             it gets no heading and no card of its own; several is
             follow-the-sun, and only then does each rule need naming and
             framing to be told apart. -->
        <section class="flex flex-col gap-4">
          <OText v-if="multiRule" variant="section">{{ t("oncall.rotationSectionRules") }}</OText>

          <p
            v-if="!active.shift_rules.length"
            class="text-status-warning-text text-xs"
            data-test="oncall-rotation-needs-rules"
          >
            {{ t("oncall.rotationNeedsRules") }}
          </p>

          <div
            v-for="(rule, ruleIndex) in active.shift_rules"
            :key="ruleIndex"
            class="flex flex-col gap-4"
            :class="multiRule ? 'border-border-default rounded-surface border p-4' : ''"
            :data-test="`oncall-schedule-rule-${ruleIndex}`"
          >
            <div v-if="multiRule || isRetired(rule)" class="flex flex-wrap items-end gap-3">
              <OInput
                v-if="multiRule"
                v-model="rule.name"
                class="min-w-0 flex-1"
                :label="t('oncall.shiftRuleName')"
                :data-test="`oncall-schedule-rule-name-${ruleIndex}`"
              />
              <OTag v-if="isRetired(rule)" variant="default-soft" size="xs">
                {{ t("oncall.rotationRetiredOnDate", { date: raw(shortDate(rule.ends_at ?? 0)) }) }}
              </OTag>
              <OButton
                v-if="multiRule"
                variant="ghost"
                size="icon-sm"
                icon-left="delete-outline"
                :aria-label="t('oncall.removeShiftRule')"
                :data-test="`oncall-schedule-rule-remove-${ruleIndex}`"
                @click="removeRule(ruleIndex)"
              />
            </div>

            <!-- The picker draws from the team roster, so on an empty team it
                 has nothing to offer. Saying so beats a select that opens on
                 nothing. -->
            <div
              v-if="!props.members.length"
              class="border-border-default rounded-default flex flex-wrap items-center gap-3 border p-3"
              data-test="oncall-rotation-no-members"
            >
              <span class="text-text-secondary min-w-0 flex-1 text-xs">
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
              :model-value="rule.members"
              multiple
              searchable
              :label="t('oncall.rotationOrder')"
              :help-text="t('oncall.rotationOrderHint')"
              :placeholder="t('oncall.rotationPickPlaceholder')"
              :options="memberOptions"
              :disabled="!props.members.length"
              :data-test="`oncall-schedule-members-${ruleIndex}`"
              @update:model-value="(v: unknown) => setMembers(rule, v as string[])"
            />

            <!-- The server refuses a rule with nobody in it, so this one would
                 store nothing. Said next to the pick that fixes it. -->
            <p
              v-if="!rule.members.length"
              class="text-status-warning-text text-xs"
              :data-test="`oncall-rotation-needs-people-${ruleIndex}`"
            >
              {{ t("oncall.rotationNeedsPeople") }}
            </p>

            <!-- Catching this while somebody is still looking at the rotation
                 is the entire value; catching it at 3am is not. -->
            <p
              v-for="clash in awayClashesFor(rule)"
              :key="clash.id"
              class="text-status-warning-text text-xs"
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

            <!-- Cadence and anchor are one decision — "every week, starting
                 then" — so they sit on one row rather than reading as two
                 unrelated questions. -->
            <div class="grid gap-3 sm:grid-cols-2">
              <OSelect
                v-model="rule.shift_micros"
                :label="t('oncall.shiftLength')"
                :options="shiftOptions"
                :data-test="`oncall-schedule-shift-${ruleIndex}`"
              />

              <!-- Without this the anchor was silently "now", so a rotation
                   created at 14:32 handed over at 14:32 forever. -->
              <OInput
                :model-value="handoverInput(rule)"
                type="datetime-local"
                :label="t('oncall.firstHandover')"
                :help-text="handoverHint"
                :data-test="`oncall-schedule-handover-${ruleIndex}`"
                @update:model-value="(v: string | number) => setAnchor(rule, String(v))"
              />
            </div>

            <!-- Restricting the hours, ranking two rules and retiring one are
                 what a follow-the-sun setup needs and what an ordinary rotation
                 never touches, so they are folded away — and unfolded already
                 when this rule is one of the ones using them. -->
            <OCollapsible
              :label="t('oncall.rotationSectionApplies')"
              :caption="t('oncall.rotationSectionAppliesCaption')"
              :default-open="usesAdvanced(rule)"
              :data-test="`oncall-schedule-advanced-${ruleIndex}`"
            >
              <div class="flex flex-col gap-4 px-2 pt-2 pb-1">
                <!-- Hours: the windows and the button that adds one are one
                     idea, so they sit together under one hint. -->
                <div class="flex flex-col gap-2">
                  <OText variant="meta">{{ t("oncall.rotationRestrictionHint") }}</OText>

                  <div
                    v-for="(window, index) in rule.restrictions ?? []"
                    :key="index"
                    class="border-border-default rounded-default grid items-end gap-3 border p-3 sm:grid-cols-[1fr_auto_auto_auto]"
                    :data-test="`oncall-schedule-restriction-${ruleIndex}-${index}`"
                  >
                    <OSelect
                      :model-value="window.days"
                      multiple
                      :label="t('oncall.rotationRestrictionDays')"
                      :options="dayOptions"
                      :data-test="`oncall-schedule-restriction-days-${ruleIndex}-${index}`"
                      @update:model-value="(v: unknown) => (window.days = (v as number[]) ?? [])"
                    />
                    <OSelect
                      :model-value="window.start_minute"
                      :label="t('oncall.rotationRestrictionFrom')"
                      :options="minuteOptions"
                      width="xs"
                      :data-test="`oncall-schedule-restriction-from-${ruleIndex}-${index}`"
                      @update:model-value="(v: unknown) => (window.start_minute = Number(v))"
                    />
                    <OSelect
                      :model-value="window.end_minute"
                      :label="t('oncall.rotationRestrictionTo')"
                      :options="minuteOptions"
                      width="xs"
                      :data-test="`oncall-schedule-restriction-to-${ruleIndex}-${index}`"
                      @update:model-value="(v: unknown) => (window.end_minute = Number(v))"
                    />
                    <OButton
                      variant="ghost"
                      size="icon-sm"
                      icon-left="delete-outline"
                      :aria-label="t('oncall.rotationRestrictionRemove')"
                      :data-test="`oncall-schedule-restriction-remove-${ruleIndex}-${index}`"
                      @click="removeRestriction(rule, index)"
                    />

                    <!-- start === end is zero length regardless of which
                         minute it is — the engine never matches it, and the
                         layer beneath silently wins instead. Flagged here
                         because 0/0 looks like a reasonable "all day" guess
                         when 1440 is the value that actually means that. -->
                    <p
                      v-if="window.start_minute === window.end_minute"
                      class="text-status-warning-text text-xs sm:col-span-4"
                      :data-test="`oncall-schedule-restriction-zero-length-${ruleIndex}-${index}`"
                    >
                      {{ t("oncall.rotationRestrictionZeroLength") }}
                    </p>
                  </div>

                  <div class="flex">
                    <OButton
                      variant="outline"
                      size="sm-action"
                      icon-left="add"
                      :data-test="`oncall-schedule-restriction-add-${ruleIndex}`"
                      @click="addRestriction(rule)"
                    >
                      {{ t("oncall.rotationRestrictionAdd") }}
                    </OButton>
                  </div>
                </div>

                <!-- Two rules of the SAME rotation that both apply and share a
                     priority are "equally in force", and the server refuses the
                     WHOLE save. A lone rule has nothing to compete with, so it
                     is not asked the question at all. -->
                <template v-if="multiRule">
                  <OSeparator />
                  <OSelect
                    :model-value="rule.priority ?? 0"
                    :label="t('oncall.rotationPriority')"
                    :help-text="t('oncall.rotationPriorityHint')"
                    :options="priorityOptions"
                    width="sm"
                    :data-test="`oncall-schedule-priority-${ruleIndex}`"
                    @update:model-value="(v: unknown) => (rule.priority = Number(v))"
                  />
                </template>

                <OSeparator />

                <!-- Retiring a rule, rather than deleting it. Delete was the only
                     way to stop one and it threw away the record of who had been
                     covering those hours. -->
                <div class="flex flex-col gap-1.5">
                  <OCheckbox
                    :model-value="isRetired(rule)"
                    :label="t('oncall.rotationRetire')"
                    :data-test="`oncall-schedule-retire-${ruleIndex}`"
                    @update:model-value="(on: CheckboxModelValue) => setRetired(rule, !!on)"
                  />
                  <OText variant="meta">{{ t("oncall.rotationRetireHint") }}</OText>
                  <OInput
                    v-if="isRetired(rule)"
                    type="datetime-local"
                    width="md"
                    class="pt-1"
                    :model-value="retiredAtLocal(rule)"
                    :label="t('oncall.rotationRetiredOn')"
                    :help-text="t('oncall.rotationRetiredOnHint', { zone: raw(props.timezone) })"
                    :data-test="`oncall-schedule-retire-at-${ruleIndex}`"
                    @update:model-value="(v: string | number) => setRetiredAt(rule, v)"
                  />
                </div>
              </div>
            </OCollapsible>

            <!-- Outside the fold on purpose: this one BLOCKS the save, and a
                 reason for a dead Save button hidden behind a disclosure is how
                 somebody concludes the form is broken. -->
            <p
              v-if="priorityClashFor(rule)"
              class="text-status-warning-text text-xs"
              :data-test="`oncall-schedule-priority-clash-${ruleIndex}`"
            >
              {{ priorityClashFor(rule) }}
            </p>

            <!-- The answer this rule produces. A cadence and an anchor are not
                 readable as a rota until you see the dates they generate. -->
            <div class="border-border-default flex flex-col gap-2 border-t pt-4">
              <OText variant="section">{{ t("oncall.upcoming") }}</OText>

              <div
                v-if="rule.members.length"
                class="border-border-default divide-border-default rounded-default flex flex-col divide-y border"
              >
                <div
                  v-for="shift in preview(rule)"
                  :key="shift.startMicros"
                  class="flex flex-wrap items-center gap-2 px-3 py-1.5"
                  data-test="oncall-schedule-preview-shift"
                >
                  <OUserCell :value="shift.member" />
                  <span class="text-text-muted ms-auto text-xs">{{ raw(shiftRange(shift)) }}</span>
                  <OTag v-if="isCurrent(shift)" variant="success-soft" size="xs">
                    {{ t("oncall.onCallNowTag") }}
                  </OTag>
                </div>
              </div>

              <!-- An empty preview is the most common state of a NEW rule, and
                   saying why beats showing nothing. -->
              <OText variant="meta" v-else data-test="oncall-schedule-preview-empty">
                {{ t("oncall.rotationPreviewEmpty") }}
              </OText>
            </div>
          </div>

          <!-- The one place the second-rule idea is worth explaining is next to
               the button that creates one. -->
          <div class="flex flex-wrap items-center gap-3">
            <OButton
              variant="outline"
              size="sm-action"
              icon-left="add"
              data-test="oncall-schedule-rule-add"
              @click="addRule"
            >
              {{ t("oncall.addShiftRule") }}
            </OButton>
            <OText variant="meta" class="min-w-0 flex-1">{{ t("oncall.rotationRulesHint") }}</OText>
          </div>
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
            :disabled="!activeIsSavable"
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
import OCollapsible from "@/lib/core/Collapsible/OCollapsible.vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";
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
  ShiftRule,
  Unavailability,
} from "@/ts/interfaces/oncall";
import {
  BASE_SHIFT_RULE_NAME,
  DEFAULT_ROTATION_NAME,
  MAX_ROTATION_NAME_CHARS,
  MICROS_PER_WEEK,
} from "@/ts/interfaces/oncall";
import type { I18nKey, I18nText } from "@/types/i18n";
import { raw, useI18nTyped } from "@/types/i18n";
import type { Shift } from "@/utils/oncall";
import {
  formatMinuteOfDay,
  fromZonedInputValue,
  resolveHolder,
  resolveNextHolder,
  SHIFT_PRESETS,
  toZonedInputValue,
  upcomingShifts,
} from "@/utils/oncall";

const PREVIEW_SHIFTS = 5;

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

/**
 * A stable handle for a rotation the server has not seen yet.
 *
 * Minted here because the id is what an escalation level stores: the level has
 * to be writable against this rotation the moment it is saved, and a
 * server-assigned id would mean a round trip before a ladder could name it.
 */
function mintRotationId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return `rot_${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/// Who this rotation puts on call now — ONE person, resolved the way the engine
/// resolves it. A rotation with a gap shows nobody rather than borrowing a
/// holder from somewhere else.
function holderOf(rotation: Rotation): string {
  return resolveHolder(rotation, nowMicros.value, props.timezone).member ?? "";
}

/// The calendar's "up next". **Display only** — nothing pages it. It used to
/// double as the secondary, which is exactly how one team got two different
/// people both correctly labelled "the secondary".
function nextOf(rotation: Rotation): string {
  return resolveNextHolder(rotation, nowMicros.value, props.timezone) ?? "";
}

const columns = computed<OTableColumnDef<Rotation>[]>(() => [
  {
    id: "name",
    header: t("oncall.rotationName"),
    accessorFn: (row: Rotation) => row.name,
    meta: { isName: true },
  },
  {
    id: "oncall",
    header: t("oncall.rotationOnCallNow"),
    accessorFn: (row: Rotation) => holderOf(row),
  },
  {
    id: "upnext",
    header: t("oncall.rotationUpNext"),
    accessorFn: (row: Rotation) => nextOf(row),
  },
  {
    id: "rules",
    header: t("oncall.rotationSectionRules"),
    accessorFn: (row: Rotation) => String(row.shift_rules?.length ?? 0),
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

/// One rule IS the rotation, so it needs no name, no frame and no heading of
/// its own; several are follow-the-sun and only then have to be told apart.
const multiRule = computed(() => (active.value?.shift_rules.length ?? 0) > 1);

/// Whether this rule already uses anything behind the fold — an unfolded
/// section is how a restriction the API wrote stops being invisible.
function usesAdvanced(rule: ShiftRule): boolean {
  return (rule.restrictions?.length ?? 0) > 0 || (rule.priority ?? 0) !== 0 || isRetired(rule);
}

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
function awayClashesFor(rule: ShiftRule): Unavailability[] {
  const chosen = new Set((rule.members ?? []).map((m) => m.toLowerCase()));
  return editorAbsences.value.filter((a) => chosen.has(a.user_email.toLowerCase()));
}

function shortDate(micros: number): string {
  return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" }).format(
    new Date(micros / 1000),
  );
}

function editRotation(rotation: Rotation) {
  active.value = rotation;
  editing.value = true;
}

/// Two rotations with one name is a screen where "page the Secondary" names
/// two things. The server keys on the id, so this is a legibility rule rather
/// than a storage one — which is why it warns rather than blocks.
const nameClash = computed<I18nText | "">(() => {
  const rotation = active.value;
  if (!rotation) return "";
  const rival = draft.value.find(
    (other) =>
      other.id !== rotation.id &&
      other.name.trim().toLowerCase() === rotation.name.trim().toLowerCase(),
  );
  return rival ? t("oncall.rotationNameClash", { name: raw(rival.name) }) : "";
});

/// The zone the handover is measured in. It is the team's, never the browser's,
/// and getting that wrong is the single easiest mistake in this form.
const handoverHint = computed(() => t("oncall.firstHandoverHint", { zone: raw(props.timezone) }));

function removeRotation(rotation: Rotation) {
  draft.value = draft.value.filter((r) => r !== rotation);
}
const nowMicros = ref(Date.now() * 1000);

const orgId = computed(() => store.state.selectedOrganization.identifier);

/// A rotation with no rules, or a rule with nobody in it, stores nothing — so
/// Save stays out of reach until both are answered.
const activeIsSavable = computed(() => {
  const rotation = active.value;
  if (!rotation?.name?.trim()) return false;
  if (!rotation.shift_rules.length) return false;
  if (rotation.shift_rules.some((rule) => !rule.members.length)) return false;
  return !rotation.shift_rules.some((rule) => priorityClashFor(rule));
});

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

/// Half-hours from local midnight, plus 1440 as an end — `formatMinuteOfDay`
/// reads that as "24:00" rather than wrapping it to "00:00", which is what
/// keeps a window ending at end-of-day from reading as zero length.
const minuteOptions = computed(() =>
  Array.from({ length: 49 }, (_, index) => index * 30).map((minute) => ({
    label: raw(formatMinuteOfDay(minute)),
    value: minute,
  })),
);

/// Offered rather than typed. Two rules that both apply and share a priority
/// are equally in force, and the server rejects the ENTIRE save rather than
/// the one rule — so a free number field is a way to take a working rota down
/// while editing something else.
const priorityOptions = computed(() => {
  const rules = active.value?.shift_rules ?? [];
  const highest = rules.reduce((max, r) => Math.max(max, r.priority ?? 0), 0);
  const levels = new Set<number>([0, highest, highest + 1]);
  return [...levels]
    .filter((level) => level >= 0)
    .sort((a, b) => a - b)
    .map((level) => ({
      label: level === 0 ? t("oncall.rotationPriorityBase") : raw(String(level)),
      value: level,
    }));
});

/// Only rules of the SAME rotation compete. Two rotations resolve at the same
/// instant with their own people, so an identical priority across them is not
/// a clash — reading it as one is the confusion this rework removed.
function priorityClashFor(rule: ShiftRule): I18nText | "" {
  const rules = active.value?.shift_rules ?? [];
  const rival = rules.find(
    (other) => other !== rule && (other.priority ?? 0) === (rule.priority ?? 0),
  );
  return rival ? t("oncall.rotationPriorityClash", { name: raw(rival.name) }) : "";
}

/// ── Retiring a rule ───────────────────────────────────────────────────────
///
/// `ends_at` is how a rule is taken out of service without deleting it.
/// Deleting was the only way to stop one, and it discarded exactly the record
/// the field exists to keep: "the weekend rule ran until March" stopped being
/// something the schedule could say, and the calendar lost the reason those
/// hours had been covered at all.
///
/// The end is exclusive, like every other boundary here.
const isRetired = (rule: ShiftRule) => rule.ends_at !== undefined;

const retiredAt = (rule: ShiftRule) => rule.ends_at ?? nowMicros.value;

/// The picker is a `datetime-local`, which has no timezone of its own — so the
/// value is rendered in the TEAM's zone and labelled with it, rather than in
/// whatever zone the reader's laptop is set to.
function retiredAtLocal(rule: ShiftRule): string {
  return toZonedInputValue(retiredAt(rule), props.timezone);
}

function setRetired(rule: ShiftRule, on: boolean) {
  // Defaults to now: "retire this" almost always means "as of today", and a
  // date somebody has to fill in before the checkbox means anything is a
  // second step for the common case.
  rule.ends_at = on ? retiredAt(rule) : undefined;
}

function setRetiredAt(rule: ShiftRule, value: string | number) {
  const micros = fromZonedInputValue(String(value), props.timezone);
  if (micros !== null) rule.ends_at = micros;
}

/// A window with no days applies on no day, which is a rule that resolves to
/// nobody — so a new one starts as the working week.
function addRestriction(rule: ShiftRule) {
  rule.restrictions = [
    ...(rule.restrictions ?? []),
    { days: [0, 1, 2, 3, 4], start_minute: 9 * 60, end_minute: 17 * 60 },
  ];
}

function removeRestriction(rule: ShiftRule, index: number) {
  if (!rule.restrictions) return;
  rule.restrictions = rule.restrictions.filter((_, at) => at !== index);
}

/// A second rule is follow-the-sun: the same position, different hours. It gets
/// a distinct priority for the same reason the server demands one — two rules
/// equally in force are refused as a whole.
function addRule() {
  const rotation = active.value;
  if (!rotation) return;
  const highest = rotation.shift_rules.reduce((max, r) => Math.max(max, r.priority ?? 0), 0);
  rotation.shift_rules.push({
    // Never the rotation's name: the rotation is the position, the rule is who
    // holds it and when, and one word for both is what "Base" exists to avoid.
    name: rotation.shift_rules.length
      ? String(t("oncall.shiftRuleNthName", { n: rotation.shift_rules.length + 1 }))
      : BASE_SHIFT_RULE_NAME,
    members: [],
    shift_micros: MICROS_PER_WEEK,
    // Top of the hour, so a handover is readable rather than landing at
    // whatever minute somebody happened to click Add.
    anchor_micros: Math.floor(nowMicros.value / 3_600_000_000) * 3_600_000_000,
    priority: rotation.shift_rules.length ? highest + 1 : 0,
    restrictions: [],
  });
}

function removeRule(index: number) {
  const rotation = active.value;
  if (!rotation) return;
  rotation.shift_rules = rotation.shift_rules.filter((_, at) => at !== index);
}

function preview(rule: ShiftRule): Shift[] {
  return upcomingShifts(rule, nowMicros.value, PREVIEW_SHIFTS);
}

function isCurrent(shift: Shift): boolean {
  return shift.startMicros <= nowMicros.value && nowMicros.value < shift.endMicros;
}

function shiftRange(shift: Shift): string {
  const start = new Date(shift.startMicros / 1000);
  const end = new Date(shift.endMicros / 1000);
  return `${start.toLocaleString()} — ${end.toLocaleString()}`;
}

function setMembers(rule: ShiftRule, members: string[]) {
  rule.members = [...members];
}

/// In the TEAM's zone, which is what the label beside it promises and what
/// every restriction window is evaluated in. Read and written with the
/// browser's zone, an operator in Berlin editing an Asia/Kolkata team saw the
/// handover three and a half hours from where it was — and moved it there by
/// saving.
function handoverInput(rule: ShiftRule): string {
  return toZonedInputValue(rule.anchor_micros, props.timezone);
}

function setAnchor(rule: ShiftRule, value: string) {
  const micros = fromZonedInputValue(value, props.timezone);
  // An incomplete value means the user is mid-edit; keeping the previous
  // anchor beats writing NaN and blanking the preview.
  if (micros !== null) rule.anchor_micros = micros;
}

function reset() {
  draft.value = (props.schedule?.rotations ?? []).map((r) => ({
    ...r,
    shift_rules: (r.shift_rules ?? []).map((rule) => ({
      ...rule,
      members: [...rule.members],
      restrictions: rule.restrictions ? [...rule.restrictions] : undefined,
    })),
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
      duplicateRotation(intent.id);
    } else {
      const found = draft.value.find((r) => r.id === intent.id);
      if (found) {
        isNew.value = false;
        editRotation(found);
      }
    }
    emit("intent-handled");
  },
  { immediate: true, flush: "post" },
);

/// A team's first rotation is its Primary; a second is an ordinary rotation
/// that happens to be a second position. Nothing links them — if somebody
/// edits one roster and not the other they drift, and `config-risks` reports
/// the collision rather than a hidden rule preventing it.
function addRotation() {
  const name = draft.value.length
    ? String(t("oncall.rotationNthName", { n: draft.value.length + 1 }))
    : DEFAULT_ROTATION_NAME;
  const rotation: Rotation = {
    id: mintRotationId(),
    name,
    shift_rules: [
      {
        // The position is named above; the rule underneath is always "Base".
        name: BASE_SHIFT_RULE_NAME,
        members: [],
        shift_micros: MICROS_PER_WEEK,
        anchor_micros: Math.floor(nowMicros.value / 3_600_000_000) * 3_600_000_000,
        priority: 0,
        restrictions: [],
      },
    ],
  };
  draft.value.push(rotation);
  // Straight into the editor: an empty row is not something anybody can act on.
  isNew.value = true;
  editRotation(rotation);
}

/// A copy is a starting point, not a save: the editor opens on a duplicate
/// nobody has committed yet, so it is named and reviewed before it is real.
/// It gets its own id — sharing one would make the copy and the original the
/// same row to every level that names either.
function duplicateRotation(id: string) {
  const source = draft.value.find((r) => r.id === id);
  if (!source) return;
  const copy: Rotation = {
    id: mintRotationId(),
    name: String(t("oncall.railCopyName", { name: raw(source.name) })),
    shift_rules: source.shift_rules.map((rule) => ({
      ...rule,
      members: [...rule.members],
      restrictions: rule.restrictions ? [...rule.restrictions] : undefined,
    })),
    // A copy is somebody's choice, so it is no longer the system's default.
    source: undefined,
  };
  draft.value.push(copy);
  isNew.value = true;
  editRotation(copy);
}

/// Cancel closes; the watcher below discards. Routing every dismissal through
/// one place is the point.
function cancelDrawer() {
  editing.value = false;
}

/// EVERY way out of the drawer has to discard an unfinished rotation, not just
/// the Cancel button. `addRotation` pushes the row into `draft` before anybody
/// has filled it in, and the ✕, Esc and the backdrop all close through
/// `v-model:open` without passing Cancel — so an abandoned row stayed in the
/// draft and failed the NEXT save, naming a rotation that was no longer on
/// screen ("`Primary` has nobody in it"). The save is all-or-nothing at the
/// server, so one ghost blocks every rotation after it.
///
/// A save clears `isNew` before it closes, so the rotation it just stored is
/// not read as abandoned here.
watch(editing, (isOpen) => {
  if (isOpen) return;
  const abandoned = isNew.value ? active.value : null;
  isNew.value = false;
  active.value = null;
  // In the bulk editor an abandoned draft is visible in the table and
  // Cancel/Save deal with it; drawer-only has no such surface, so the whole
  // draft goes back to what is stored rather than lingering until the next open.
  if (props.drawerOnly) {
    reset();
    return;
  }
  if (abandoned) draft.value = draft.value.filter((r) => r !== abandoned);
});

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
  // rule with nobody in it, so this has to be refused here and said out loud.
  const empty = draft.value.find(
    (r) => !r.shift_rules.length || r.shift_rules.some((rule) => !rule.members.length),
  );
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
    // Stored, so no longer new — the close watcher would otherwise read this
    // rotation as abandoned and drop it straight back out of the draft.
    isNew.value = false;
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
