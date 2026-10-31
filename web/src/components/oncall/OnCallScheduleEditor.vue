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
            :aria-label="t('oncall.laneDelete')"
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
      :open="editing"
      :width="60"
      :title="isNew ? t('oncall.rotationAddTitle') : t('oncall.rotationTitle')"
      :subtitle="t('oncall.rotationDrawerHint')"
      :persistent="!draftsActive && wouldDiscardEdits"
      :close-guard="draftsActive ? guardDrawerClose : undefined"
      :show-close="false"
      data-test="oncall-rotation-drawer"
      @update:open="cancelDrawer()"
    >
      <!-- ODrawer closes itself before it emits, so its own ✕ could not be held back for the confirm. -->
      <template #header-right>
        <button
          type="button"
          :aria-label="t('components.drawer.closeDrawer')"
          data-test="o-drawer-close-btn"
          @mousedown.prevent
          @click="cancelDrawer"
          class="rounded-default text-dialog-close-text hover:bg-dialog-close-hover-bg active:bg-dialog-close-active-bg focus-visible:ring-dialog-focus-ring flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </template>
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
        <section class="border-border-default flex flex-col gap-4 border-t pt-6">
          <h3 class="text-base font-semibold">{{ t("oncall.rotationSectionRules") }}</h3>
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
                :key="ruleKey(rule)"
                :name="String(ruleIndex)"
                :data-test="`oncall-schedule-rule-tab-${ruleIndex}`"
              >
                <!-- A status icon before the name; the rare actions sit in the trailing menu. -->
                <OIcon
                  v-if="ruleTabIcon(rule, ruleIndex)"
                  :name="ruleTabIcon(rule, ruleIndex) as any"
                  size="sm"
                  class="shrink-0"
                  :data-test="`oncall-schedule-rule-tab-icon-${ruleIndex}`"
                />
                <span class="truncate">{{
                  raw(
                    rule.name?.trim()
                      ? rule.name
                      : String(t("oncall.shiftRuleNthName", { n: ruleIndex + 1 })),
                  )
                }}</span>
                <template #trailing>
                  <OnCallRuleTabMenu
                    :rule="rule"
                    :rule-index="ruleIndex"
                    :rule-label="namedShiftRules[ruleIndex].name"
                    :can-remove="multiRule"
                    :renaming="renamingRule === rule"
                    :choices="stopChoicesFor(rule)"
                    :consequence-at="(at: number) => stopConsequenceFor(ruleIndex, at)"
                    :timezone="props.timezone"
                    :now-micros="nowMicros"
                    :name-of="nameOf"
                    @remove="removeRule(ruleIndex)"
                    @stop="(at: number) => (rule.ends_at = at)"
                    @unstop="rule.ends_at = undefined"
                    @renamed="renamingRule = null"
                  />
                </template>
              </OTab>
            </OTabs>
            <OButton
              variant="ghost"
              size="icon"
              class="ms-1"
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
                :key="ruleKey(rule)"
                :name="String(ruleIndex)"
                :data-test="`oncall-schedule-rule-panel-${ruleIndex}`"
              >
                <div class="flex flex-col gap-4 pt-3">
                  <OText variant="meta" :data-test="`oncall-schedule-rule-summary-${ruleIndex}`">
                    {{ ruleSummary(ruleIndex) }}
                  </OText>
                  <p
                    v-if="ruleUsage(ruleIndex)"
                    class="text-xs"
                    :class="
                      ruleUsage(ruleIndex)?.kind === 'never-used'
                        ? 'text-status-warning-text'
                        : 'text-text-secondary'
                    "
                    :data-test="`oncall-schedule-rule-${ruleUsage(ruleIndex)?.kind}-${ruleIndex}`"
                  >
                    {{ ruleUsage(ruleIndex)?.text }}
                  </p>

                  <OnCallShiftRuleFields
                    :rule="rule"
                    :rule-index="ruleIndex"
                    :has-team-members="!!props.members.length"
                    :team-members="teamMemberEmails"
                    :holder="ruleHolder(preview.currentSegments.value, rule.name, nowMicros)"
                    :name-of="nameOf"
                    :shift-options="shiftOptions"
                    :day-options="dayOptions"
                    :from-minute-options="fromMinuteOptions"
                    :minute-options="minuteOptions"
                    :timezone="props.timezone"
                    :show-needs-people="showNeedsPeople(rule)"
                    :overlap-names="overlapNames(ruleIndex)"
                    :overlap-count="overlapCount(ruleIndex)"
                    :overlap-choice="overlapChoice(ruleIndex)"
                    :set-members="setMembers"
                    :away-clashes-for="awayClashesFor"
                    :short-date="shortDate"
                    :add-restriction="addRestriction"
                    :remove-restriction="removeRestriction"
                    :set-overlap-winner="(wins: boolean) => setOverlapWinner(ruleIndex, wins)"
                    :priority-clash-for="priorityClashFor"
                    @open-members="openMembers"
                  />
                </div>
              </OTabPanel>
            </OTabPanels>
          </template>
        </section>

        <OnCallDraftPreview
          v-if="active.shift_rules.length"
          v-model:page="preview.page.value"
          class="border-border-default border-t pt-6"
          :rotation="active"
          :active-rule-name="activeRule?.name ?? ''"
          :segments="preview.segments.value"
          :window-from="preview.windowFrom.value"
          :window-to="preview.windowTo.value"
          :now-micros="nowMicros"
          :timezone="props.timezone"
          :error="preview.error.value"
          :show-empty="!preview.hasValidRule.value || preview.loaded.value"
          :name-of="nameOf"
        />
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
            @click="confirmRemove = true"
          >
            {{ t("oncall.laneDelete") }}
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

    <EditorDraftDialogs :draft="scheduleDraft" />
    <ConfirmDialog
      v-model="confirmDiscard"
      data-test="oncall-rotation-discard-confirm"
      :title="t('common.unsavedChanges')"
      :message="t('oncall.rotationDiscardMessage', { name: raw(active?.name ?? '') })"
      :ok-label="t('common.discardChanges')"
      :cancel-label="t('dashboard.layoutEdit.keepEditing')"
      focus-cancel
      @update:ok="discardAndClose"
    />
    <OnCallRemoveRotationDialog
      v-model:open="confirmRemove"
      data-test="oncall-rotation-remove-confirm"
      :rotation-id="active?.id ?? ''"
      :rotations="draft"
      :holders="removeHolders"
      :policy="policy ?? null"
      @confirm="confirmDelete"
      @open-policy="openPolicy"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { useStore } from "vuex";

import ConfirmDialog from "@/components/ConfirmDialog.vue";
import EditorDraftDialogs from "@/components/common/drafts/EditorDraftDialogs.vue";
import { useEditorDraft } from "@/composables/useEditorDraft";
import { dropRotationDrafts, newRotationVariant, rotationDraftId } from "./scheduleDrafts";
import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import OInput from "@/lib/forms/Input/OInput.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OUserCell from "@/lib/core/Table/cells/OUserCell.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import OTabPanels from "@/lib/navigation/Tabs/OTabPanels.vue";
import OTabPanel from "@/lib/navigation/Tabs/OTabPanel.vue";
import OnCallShiftRuleFields from "./OnCallShiftRuleFields.vue";
import OnCallDraftPreview from "./OnCallDraftPreview.vue";
import OnCallRuleTabMenu from "./OnCallRuleTabMenu.vue";
import OnCallRemoveRotationDialog from "./OnCallRemoveRotationDialog.vue";
import { useRotationPreview } from "@/composables/useRotationPreview";
import { useOrgUserNames } from "@/composables/useOrgUserNames";
import { queryClient } from "@/composables/query/queryClient";
import { setTeamScheduleMutation, unavailabilityQuery } from "@/services/oncall.queries";
import { useMutation } from "@tanstack/vue-query";
import type {
  OnCallPolicy,
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
import analytics from "@/services/product_analytics";
import {
  coverageHoursSummary,
  effectiveRivals,
  effectiveWeekCoverage,
  formatInZone,
  formatMinuteOfDay,
  formatStamp,
  overlappingRules,
  overlapStanding,
  prioritiesFor,
  resolveHolder,
  resolveNextHolder,
  ruleHolder,
  ruleHoursSummary,
  rulesClash,
  SHIFT_PRESETS,
  stopChoices,
  stopConsequence,
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
  /** The team's policy, so removing a rotation can say which escalation steps it takes. */
  policy?: OnCallPolicy | null;
}>();
const emit = defineEmits<{
  saved: [];
  "intent-handled": [];
  /** Nothing here can add a person, so the roster is asked for by name. */
  "open-members": [];
  /** A hand-edited policy pages the rotation being removed; it has to be edited first. */
  "open-policy": [];
}>();

const { t } = useI18nTyped();
const store = useStore();

interface ScheduleDraftData {
  rotation: Rotation | null;
  isNew: boolean;
  ruleTab: string;
}

/// Only the drawer the team page opens keeps drafts; the bulk editor keeps its own Save and Cancel.
const draftsActive = !!props.drawerOnly;
/// The rotation a new one was duplicated from, which picks its own draft slot.
const duplicateOf = ref<string | null>(null);

const draft = ref<Rotation[]>([]);
const saving = ref(false);
const editing = ref(false);
const active = ref<Rotation | null>(null);
const confirmRemove = ref(false);
const confirmDiscard = ref(false);
/// The roster link opened the confirm, so a Discard also hands over to the roster.
const membersAfterDiscard = ref(false);
/// The open rotation as it was when the drawer opened, to tell an edit from a look.
const openedAs = ref("");

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

/// Rules with a display name resolved, for the combined upcoming-shifts
/// timeline — it needs a name per entry and has no access to a rule's index
/// in `active.shift_rules` to fall back to "Rule N" itself.
const namedShiftRules = computed(() =>
  (active.value?.shift_rules ?? []).map((rule, ruleIndex) => ({
    ...rule,
    name: rule.name?.trim()
      ? rule.name
      : String(t("oncall.shiftRuleNthName", { n: ruleIndex + 1 })),
  })),
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
    editorAbsences.value = await queryClient.fetchQuery(
      unavailabilityQuery(orgId.value, undefined, now, now + ABSENCE_HORIZON_DAYS * 86_400_000_000),
    );
  } catch {
    editorAbsences.value = [];
  }
});

/// One line per chosen member with an absence in the horizon.
function awayClashesFor(rule: ShiftRule): Unavailability[] {
  const chosen = new Set((rule.members ?? []).map((m) => m.toLowerCase()));
  return editorAbsences.value.filter((a) => chosen.has(a.user_email.toLowerCase()));
}

const stamp = (micros: number) => formatStamp(micros, props.timezone);

// The team's clock, the same one the roster's away chip uses.
function shortDate(micros: number): string {
  return formatInZone(micros, props.timezone, { day: "numeric", month: "short" });
}

function editRotation(rotation: Rotation) {
  active.value = rotation;
  openedAs.value = JSON.stringify(rotation);
  editing.value = true;
}

// Bulk mode keeps an edited existing rotation in the table's draft, so only a discarding close counts.
const wouldDiscardEdits = computed(() => {
  const rotation = active.value;
  if (!rotation || !(props.drawerOnly || isNew.value)) return false;
  return JSON.stringify(rotation) !== openedAs.value;
});

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

function removeRotation(rotation: Rotation) {
  draft.value = draft.value.filter((r) => r !== rotation);
}
const nowMicros = ref(Date.now() * 1000);

const orgId = computed(() => store.state.selectedOrganization.identifier);

const scheduleWrite = useMutation(() => setTeamScheduleMutation(orgId.value, props.teamId));

/// A rotation with no rules, or a rule with nobody in it, stores nothing — so
/// Save stays out of reach until both are answered.
const activeIsSavable = computed(() => {
  const rotation = active.value;
  if (!rotation?.name?.trim()) return false;
  if (!rotation.shift_rules.length) return false;
  if (rotation.shift_rules.some((rule) => !rule.members.length)) return false;
  return !rotation.shift_rules.some((rule) => priorityClashFor(rule));
});

async function openMembers() {
  if (draftsActive) {
    if (!(await scheduleDraft.confirmLeave())) return;
    editing.value = false;
    emit("open-members");
    return;
  }
  if (wouldDiscardEdits.value) {
    membersAfterDiscard.value = true;
    confirmDiscard.value = true;
    return;
  }
  editing.value = false;
  emit("open-members");
}

const teamMemberEmails = computed(() => props.members.map((m) => m.user_email));

// One server preview for the whole drawer: the picture, the list, the people line and the stop choices all read it.
const { nameOf } = useOrgUserNames();

const preview = useRotationPreview({
  rotation: () => active.value,
  teamId: () => props.teamId,
  timezone: () => props.timezone,
  nowMicros: () => nowMicros.value,
});

const activeRule = computed(() => active.value?.shift_rules[Number(activeRuleTab.value)] ?? null);

// Rules carry no id, so a tab and its panel keep their state by the rule object, not its position.
const ruleKeys = new WeakMap<ShiftRule, number>();
let nextRuleKey = 0;
function ruleKey(rule: ShiftRule): number {
  if (!ruleKeys.has(rule)) ruleKeys.set(rule, nextRuleKey++);
  return ruleKeys.get(rule) as number;
}

/// The rule just added by "+": its tab opens straight into renaming, or it stays "Rule N".
const renamingRule = ref<ShiftRule | null>(null);

function stopChoicesFor(rule: ShiftRule) {
  return stopChoices(
    preview.currentSegments.value,
    rule.name,
    nowMicros.value,
    preview.currentWindowTo.value,
  );
}

/// Who takes a rule's hours once it stops at `at`, or which of them nobody covers.
function stopConsequenceFor(index: number, at: number): { text: I18nText; gap: boolean } {
  const rules = namedShiftRules.value;
  const { takers, gap } = stopConsequence(rules, index, at);
  if (gap.length) {
    return { text: t("oncall.stopGap", { hours: coverageHoursSummary(gap, t) }), gap: true };
  }
  const names = raw(takers.map((k) => rules[k].name).join(", "));
  return { text: t("oncall.stopTakers", { names }), gap: false };
}

const shiftOptions = computed(() =>
  SHIFT_PRESETS.map((preset) => ({ label: t(preset.phraseKey), value: preset.micros })),
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

// The server refuses a window starting at 24:00.
const fromMinuteOptions = computed(() => minuteOptions.value.slice(0, -1));

// The server refuses two rules of one rotation only when priority and hours are both identical.
function priorityClashFor(rule: ShiftRule): I18nText | "" {
  const rules = active.value?.shift_rules ?? [];
  const at = rules.indexOf(rule);
  const rival = rules.findIndex((other, k) => k !== at && rulesClash(rule, other));
  return rival < 0 ? "" : t("oncall.ruleClash", { name: raw(namedShiftRules.value[rival].name) });
}

function overlapNames(index: number): string {
  const rules = active.value?.shift_rules ?? [];
  return overlappingRules(rules, index)
    .map((k) => namedShiftRules.value[k].name)
    .join(", ");
}

function overlapCount(index: number): number {
  return overlappingRules(active.value?.shift_rules ?? [], index).length;
}

function overlapChoice(index: number): "wins" | "loses" | undefined {
  const { winsOver, losesTo } = overlapStanding(active.value?.shift_rules ?? [], index);
  if (winsOver.length && !losesTo.length) return "wins";
  if (losesTo.length && !winsOver.length) return "loses";
  return undefined;
}

function setOverlapWinner(index: number, wins: boolean) {
  const rules = active.value?.shift_rules ?? [];
  prioritiesFor(rules, index, wins).forEach((priority, k) => {
    rules[k].priority = priority;
  });
}

/// The rule's hours, then who wins where it overlaps another rule.
function ruleSummary(index: number): I18nText {
  const rules = active.value?.shift_rules ?? [];
  const nameList = (indices: number[]) =>
    indices.map((k) => namedShiftRules.value[k].name).join(", ");
  const { winsOver, losesTo } = overlapStanding(rules, index);
  const parts: string[] = [ruleHoursSummary(rules[index], t)];
  if (winsOver.length) parts.push(t("oncall.ruleWinsOver", { names: raw(nameList(winsOver)) }));
  if (losesTo.length) {
    parts.push(t("oncall.ruleLosesTo", { names: raw(nameList(losesTo)) }, losesTo.length));
  }
  const named = namedShiftRules.value;
  const effective = effectiveWeekCoverage(named, index, nowMicros.value);
  // A rival that counts always takes some minutes, so rivals mean the hours differ.
  if (effective.length && effectiveRivals(named, index, nowMicros.value).length) {
    parts.push(t("oncall.ruleOnCallOnly", { hours: coverageHoursSummary(effective, t) }));
  }
  const endsAt = rules[index].ends_at;
  if (endsAt !== undefined) parts.push(t("oncall.ruleStops", { date: raw(stamp(endsAt)) }));
  return t("oncall.ruleSummaryLine", { parts: parts.join(" · ") });
}

/// A staffed rule that wins no minute: a mistake if it has windows, a standby if it has none.
function ruleUsage(index: number): { kind: "never-used" | "standby"; text: I18nText } | null {
  const rules = namedShiftRules.value;
  const rule = rules[index];
  if (!rule?.members.length || effectiveWeekCoverage(rules, index, nowMicros.value).length) {
    return null;
  }
  const rivals = effectiveRivals(rules, index, nowMicros.value);
  const names = raw(rivals.map((k) => rules[k].name).join(", "));
  return rule.restrictions?.length
    ? { kind: "never-used", text: t("oncall.ruleNeverWins", { names }, rivals.length) }
    : { kind: "standby", text: t("oncall.ruleStandby", { names }, rivals.length) };
}

/// A stopped rule keeps its record; `ends_at` is exclusive, like every other boundary here.
const isRetired = (rule: ShiftRule) => rule.ends_at !== undefined;

// A window with no days applies every day; a new one starts as the working week.
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
  const from = rotation.shift_rules[Number(activeRuleTab.value)];
  rotation.shift_rules.push({
    // Never the rotation's name: the rotation is the position, the rule is who
    // holds it and when, and one word for both is what "Base" exists to avoid.
    name: rotation.shift_rules.length
      ? String(t("oncall.shiftRuleNthName", { n: rotation.shift_rules.length + 1 }))
      : BASE_SHIFT_RULE_NAME,
    members: [],
    shift_micros: from?.shift_micros ?? MICROS_PER_WEEK,
    // Top of the hour, so a handover is readable rather than landing at
    // whatever minute somebody happened to click Add.
    anchor_micros:
      from?.anchor_micros ?? Math.floor(nowMicros.value / 3_600_000_000) * 3_600_000_000,
    priority: rotation.shift_rules.length ? highest + 1 : 0,
    restrictions: [],
  });
  // Land on the rule just added — otherwise it's created behind whichever
  // tab was already open, and looks like the click did nothing.
  activeRuleTab.value = String(rotation.shift_rules.length - 1);
  renamingRule.value = rotation.shift_rules[rotation.shift_rules.length - 1];
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

function ruleTabIcon(rule: ShiftRule, index: number): string | undefined {
  if (ruleHasProblem(rule)) return "error-outline";
  if (ruleUsage(index)?.kind === "never-used") return "warning-amber";
  if (isRetired(rule)) return "pause-circle-filled";
  return undefined;
}

// Missing people are said out loud once the picker was used or the server stored the rule empty.
const peopleAsked = reactive(new WeakSet<ShiftRule>());

function showNeedsPeople(rule: ShiftRule): boolean {
  return !rule.members.length && peopleAsked.has(rule);
}

function setMembers(rule: ShiftRule, members: string[]) {
  rule.members = [...members];
  peopleAsked.add(rule);
}

/** `rule` with every array and window the editor mutates copied, so edits never reach the original. [pure] */
function copyRule(rule: ShiftRule): ShiftRule {
  return {
    ...rule,
    members: [...rule.members],
    restrictions: rule.restrictions?.map((window) => ({ ...window, days: [...window.days] })),
  };
}

function reset() {
  draft.value = (props.schedule?.rotations ?? []).map((r) => ({
    ...r,
    shift_rules: (r.shift_rules ?? []).map(copyRule),
  }));
  for (const rule of draft.value.flatMap((r) => r.shift_rules)) {
    if (!rule.members.length) peopleAsked.add(rule);
  }
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
        duplicateOf.value = null;
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
  duplicateOf.value = null;
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
    shift_rules: source.shift_rules.map(copyRule),
    // A copy is somebody's choice, so it is no longer the system's default.
    source: undefined,
  };
  draft.value.push(copy);
  isNew.value = true;
  duplicateOf.value = id;
  editRotation(copy);
}

/// Every way out but Save and Remove comes here; the watcher below discards.
async function cancelDrawer() {
  if (draftsActive) {
    if (await scheduleDraft.confirmLeave()) editing.value = false;
    return;
  }
  membersAfterDiscard.value = false;
  if (wouldDiscardEdits.value) confirmDiscard.value = true;
  else editing.value = false;
}

/// ✕, Escape and the backdrop ask through the leave dialog instead of closing over unsaved edits.
function guardDrawerClose(): boolean {
  if (!scheduleDraft.hasUnsavedChanges()) return true;
  void cancelDrawer();
  return false;
}

function discardAndClose() {
  editing.value = false;
  if (membersAfterDiscard.value) emit("open-members");
  membersAfterDiscard.value = false;
}

/// EVERY way out of the drawer has to discard an unfinished rotation, not just
/// the Cancel button. `addRotation` pushes the row into `draft` before anybody
/// has filled it in, and the ✕, Esc and the backdrop all close through
/// `v-model:open` without passing Cancel — so an abandoned row stayed in the
/// draft and failed the NEXT save, naming a rotation that was no longer on
/// screen ("Primary" has nobody in it). The save is all-or-nothing at the
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

/// Who each rotation puts on call now, by name, for the delete confirm.
const removeHolders = computed(() =>
  draft.value
    .map((rotation) => ({ rotation_id: rotation.id, email: holderOf(rotation) }))
    .filter((holder) => holder.email)
    .map((holder) => ({ rotation_id: holder.rotation_id, name: nameOf(holder.email) })),
);

function confirmDelete() {
  confirmRemove.value = false;
  void deleteActive();
}

/// The drawer closes first: the policy editor is a drawer too, and one flow gets one surface.
function openPolicy() {
  confirmRemove.value = false;
  editing.value = false;
  emit("open-policy");
}

/// Deletion is a save: the drawer is the only surface, so there is no separate
/// "now press Save" step to forget.
async function deleteActive() {
  const target = active.value;
  if (!target) return;
  const stored = !isNew.value;
  draft.value = draft.value.filter((r) => r !== target);
  if ((await save()) && stored) {
    dropRotationDrafts({ org: String(orgId.value), teamId: props.teamId, rotationId: target.id });
  }
}

async function save(): Promise<boolean> {
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
    return false;
  }
  // `setTeamScheduleMutation` clears the default-staffing marker: a schedule a human saved is no longer the one nobody chose.
  const rotations = draft.value;
  saving.value = true;
  try {
    await scheduleWrite.mutateAsync({ timezone: props.timezone, rotations });
    analytics.track("oncall_schedule_saved", {
      source: "editor",
      rotation_count: rotations.length,
    });
    toast({ variant: "success", message: t("oncall.scheduleSaved") });
    if (draftsActive) scheduleDraft.markSaved();
    // Stored, so no longer new — the close watcher would otherwise read this
    // rotation as abandoned and drop it straight back out of the draft.
    isNew.value = false;
    // Close BEFORE the parent refetches. `reset` rebuilds `draft` from the new
    // props, which detaches `active` from it — leaving the drawer open over an
    // object nothing reads, so every further keystroke went nowhere.
    editing.value = false;
    active.value = null;
    // The parent's schedule is a ref: invalidation expires it, it never repaints it.
    emit("saved");
    return true;
  } catch (err: any) {
    toast({
      variant: "error",
      message: raw(err?.response?.data?.message) || t("oncall.saveScheduleFailed"),
    });
    return false;
  } finally {
    saving.value = false;
  }
}

/// Laid over the stored schedule, so rotations other people changed since are not written back stale.
function applyScheduleDraft(data: ScheduleDraftData) {
  const restored = data.rotation;
  if (!restored) return;
  reset();
  const at = draft.value.findIndex((r) => r.id === restored.id);
  // A stored rotation deleted meanwhile is dropped by the restore before it gets here; never re-add one.
  if (!data.isNew && at < 0) return;
  const stored = at >= 0 ? JSON.stringify(draft.value[at]) : "";
  if (at >= 0) draft.value.splice(at, 1, restored);
  else draft.value.push(restored);
  active.value = draft.value.find((r) => r.id === restored.id) ?? null;
  isNew.value = data.isNew;
  openedAs.value = isNew.value ? "" : stored;
  activeRuleTab.value = Number(data.ruleTab) < restored.shift_rules.length ? data.ruleTab : "0";
}

const scheduleDraft = useEditorDraft<ScheduleDraftData>({
  kind: "oncall_schedule",
  entityLabel: () => t("common.editorDraft.entities.oncall_schedule"),
  entityId: () =>
    !isNew.value && active.value ? rotationDraftId(props.teamId, active.value.id) : null,
  newVariant: () => newRotationVariant(props.teamId, duplicateOf.value),
  snapshot: () => ({
    rotation: active.value,
    isNew: isNew.value,
    ruleTab: activeRuleTab.value,
  }),
  apply: applyScheduleDraft,
  // The stored rotation, or null once it is gone, which drops its draft with a notice.
  base: () =>
    isNew.value
      ? undefined
      : ((props.schedule?.rotations ?? []).find((r) => r.id === active.value?.id) ?? null),
  hasChanges: () => editing.value && wouldDiscardEdits.value,
  save: () => save(),
});

// Immediate: an intent present at mount opens the drawer during setup, before this watcher exists.
watch(
  editing,
  (isOpen) => {
    if (isOpen && draftsActive) void scheduleDraft.start();
  },
  { immediate: true },
);
</script>
