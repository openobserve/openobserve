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
      :width="60"
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

        <!-- The rules. Always tabbed, even with just one — the Base rule
             gets a tab of its own like any other, so there's one layout to
             read rather than a plain form that turns into tabs the moment a
             second rule shows up. -->
        <section class="flex flex-col gap-4">
          <OText v-if="multiRule" variant="section">{{ t("oncall.rotationSectionRules") }}</OText>

          <p
            v-if="!active.shift_rules.length"
            class="text-status-warning-text text-xs"
            data-test="oncall-rotation-needs-rules"
          >
            {{ t("oncall.rotationNeedsRules") }}
          </p>

          <!-- The add button lives here regardless of rule count — with no
               rules there's no tab strip for it to sit beside yet, but it's
               still the only way to add the first one. Matches the
               dashboard tab strip's own add-tab placement: snug against the
               last tab, not stretched off to the row's far edge. -->
          <div class="flex items-center">
            <OTabs
              v-if="active.shift_rules.length"
              v-model="activeRuleTab"
              bordered
              class="max-w-[calc(100%_-_2.5rem)]"
              data-test="oncall-schedule-rule-tabs"
            >
              <OTab
                v-for="(rule, ruleIndex) in active.shift_rules"
                :key="ruleIndex"
                :name="String(ruleIndex)"
                :icon="ruleTabIcon(rule)"
                :label="raw(rule.name?.trim() ? rule.name : String(t('oncall.shiftRuleNthName', { n: ruleIndex + 1 })))"
                :data-test="`oncall-schedule-rule-tab-${ruleIndex}`"
              />
            </OTabs>
            <OButton
              variant="ghost"
              size="icon"
              class="ml-1"
              icon-left="add"
              :aria-label="t('oncall.addShiftRule')"
              data-test="oncall-schedule-rule-add"
              @click="addRule"
            >
              <OTooltip :content="t('oncall.addShiftRule')" />
            </OButton>
          </div>

          <template v-if="active.shift_rules.length">
            <OTabPanels v-model="activeRuleTab" keep-alive>
              <OTabPanel
                v-for="(rule, ruleIndex) in active.shift_rules"
                :key="ruleIndex"
                :name="String(ruleIndex)"
                :data-test="`oncall-schedule-rule-panel-${ruleIndex}`"
              >
                <div class="flex flex-col gap-4 pt-3">
                  <div v-if="multiRule || isRetired(rule)" class="flex flex-wrap items-end gap-3">
                    <OInput
                      v-model="rule.name"
                      class="min-w-0 flex-1"
                      :label="t('oncall.shiftRuleName')"
                      :data-test="`oncall-schedule-rule-name-${ruleIndex}`"
                    />
                    <OTag v-if="isRetired(rule)" variant="default-soft" size="xs">
                      {{ t("oncall.rotationRetiredOnDate", { date: raw(shortDate(rule.ends_at ?? 0)) }) }}
                    </OTag>
                    <!-- The only rule left has no delete affordance — a
                         rotation with no rules stores nothing, so the last
                         one can't be removed via this button. -->
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

                  <OnCallShiftRuleFields
                    :rule="rule"
                    :multi-rule="multiRule"
                    :has-team-members="!!props.members.length"
                    :member-options="memberOptions"
                    :shift-options="shiftOptions"
                    :day-options="dayOptions"
                    :minute-options="minuteOptions"
                    :priority-options="priorityOptions"
                    :timezone="props.timezone"
                    :handover-hint="handoverHint"
                    :set-members="setMembers"
                    :away-clashes-for="awayClashesFor"
                    :short-date="shortDate"
                    :handover-input="handoverInput"
                    :set-anchor="setAnchor"
                    :uses-advanced="usesAdvanced"
                    :add-restriction="addRestriction"
                    :remove-restriction="removeRestriction"
                    :is-retired="isRetired"
                    :set-retired="setRetired"
                    :retired-at-local="retiredAtLocal"
                    :set-retired-at="setRetiredAt"
                    :priority-clash-for="priorityClashFor"
                    @open-members="openMembers"
                  />
                </div>
              </OTabPanel>
            </OTabPanels>

            <!-- Kept out from under the tabs and shown for every rule at
                 once: it's the one place a follow-the-sun handover gets
                 checked by eye, and that only works if every rule's shifts
                 are visible without switching tabs. -->
            <div class="border-border-default flex flex-col gap-4 border-t pt-4">
              <OText variant="section">{{ t("oncall.upcoming") }}</OText>
              <div
                v-for="(rule, ruleIndex) in active.shift_rules"
                :key="ruleIndex"
                class="flex flex-col gap-2"
              >
                <OText v-if="multiRule" variant="label">
                  {{ raw(rule.name?.trim() ? rule.name : String(t("oncall.shiftRuleNthName", { n: ruleIndex + 1 }))) }}
                </OText>
                <OnCallUpcomingList :rule="rule" :now-micros="nowMicros" />
              </div>
            </div>
          </template>
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
import { toast } from "@/lib/feedback/Toast/useToast";
import OInput from "@/lib/forms/Input/OInput.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OUserCell from "@/lib/core/Table/cells/OUserCell.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import OTabPanels from "@/lib/navigation/Tabs/OTabPanels.vue";
import OTabPanel from "@/lib/navigation/Tabs/OTabPanel.vue";
import OnCallShiftRuleFields from "./OnCallShiftRuleFields.vue";
import OnCallUpcomingList from "./OnCallUpcomingList.vue";
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
import {
  formatMinuteOfDay,
  fromZonedInputValue,
  resolveHolder,
  resolveNextHolder,
  SHIFT_PRESETS,
  toZonedInputValue,
} from "@/utils/oncall";

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

/// Which rule's tab is showing. Keyed by index rather than a rule id — shift
/// rules don't carry one. Reset every time the drawer OPENS, not on `active`
/// changing reference — `active` gets set to the same rotation object on a
/// second edit within one session, so a reference-only reset would leave the
/// drawer reopening on whichever tab was last active instead of the Base one.
const activeRuleTab = ref("0");
watch(editing, (isOpen) => {
  if (isOpen) activeRuleTab.value = "0";
});

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
  // Land on the rule just added — otherwise it's created behind whichever
  // tab was already open, and looks like the click did nothing.
  activeRuleTab.value = String(rotation.shift_rules.length - 1);
}

function removeRule(index: number) {
  const rotation = active.value;
  if (!rotation) return;
  rotation.shift_rules = rotation.shift_rules.filter((_, at) => at !== index);
  // The removed rule may have been the active tab, or the active tab's index
  // may now point past the end — either way, land somewhere that still exists.
  const lastIndex = rotation.shift_rules.length - 1;
  if (Number(activeRuleTab.value) > lastIndex) {
    activeRuleTab.value = String(Math.max(0, lastIndex));
  }
}

/// A rule with a problem that BLOCKS Save (nobody in it, or a priority tied
/// with a rival) needs to be visible on its tab — the inline warning text sits
/// inside the panel, which is exactly what's hidden when that tab isn't the
/// active one.
function ruleHasProblem(rule: ShiftRule): boolean {
  return !rule.members.length || !!priorityClashFor(rule);
}

function ruleTabIcon(rule: ShiftRule): string | undefined {
  if (ruleHasProblem(rule)) return "error-outline";
  if (isRetired(rule)) return "pause-circle-filled";
  return undefined;
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
