<!--
  Start a schedule from one of the named shapes instead of hand-building
  layers, priorities and minute-of-day windows. Follow-the-sun is the first
  thing a distributed team asks for, and until this control it had to be
  assembled by somebody who already understood restriction windows.

  One radio card per shape, a select on a phone. Each shape keeps what was
  typed into it, so switching to compare never costs the values.

  A drawer rather than a dialog: the coverage grid is seven columns wide and
  every layer is a row of four controls, so the width is load-bearing.

  The form is GENERATED from the catalogue's own `inputs` schema — kinds,
  labels, min/max — never hardcoded. Which control a field gets, whether a
  layer takes a window, how many regions are allowed: all read from the
  descriptor, so a fifth preset appears here with no UI change. The one thing
  the browser has to know on its own is what each shape COVERS, because that
  picture is redrawn on every keystroke; that lives in `.shape.ts` and degrades
  to "no picture" for an id this build has not met.

  Applying replaces the chosen rotation's shift rules, keeping its id and name, or adds a new rotation.
-->
<template>
  <ODrawer v-model:open="open" size="xxl" :title="drawerTitle" data-test="oncall-presets-drawer">
    <OInnerLoading v-if="loading" showing />

    <div v-else class="flex flex-col gap-4">
      <div
        v-if="rotations.length"
        class="flex flex-wrap items-start gap-3"
        data-test="oncall-presets-target-row"
      >
        <OToggleGroup
          :model-value="target"
          type="single"
          :label="t('oncall.presetsUseFor')"
          label-position="top"
          data-test="oncall-presets-target"
          @update:model-value="setTarget"
        >
          <OToggleGroupItem :value="NEW_ROTATION" size="sm">
            {{ t("oncall.presetsNewRotation") }}
          </OToggleGroupItem>
          <OToggleGroupItem
            v-for="rotation in rotations"
            :key="rotation.id"
            :value="rotation.id"
            size="sm"
          >
            {{ raw(rotation.name) }}
          </OToggleGroupItem>
        </OToggleGroup>
        <!-- Kept in both modes so switching does not move the form; gap-2 matches the toggle's label gap. -->
        <OInput
          :model-value="targetRotation ? raw(targetRotation.name) : newName"
          :label="t('oncall.rotationName')"
          :maxlength="MAX_ROTATION_NAME_CHARS"
          :disabled="Boolean(targetRotation)"
          size="sm"
          width="md"
          class="gap-2!"
          :error="newNameBlank || newNameTaken"
          data-test="oncall-presets-new-name"
          @update:model-value="setNewName"
        />
      </div>

      <OSelect
        v-if="isMobile"
        v-model="activeId"
        :label="t('oncall.presetsPickerLabel')"
        :options="presetOptions"
        data-test="oncall-presets-picker"
      />
      <ORadioGroup
        v-else
        v-model="activeId"
        :label="t('oncall.presetsPickerLabel')"
        orientation="vertical"
        class="grid grid-cols-2 gap-2"
        data-test="oncall-presets-picker"
      >
        <ORadio
          v-for="preset in presets"
          :key="preset.id"
          :value="preset.id"
          variant="card"
          :data-test="`oncall-preset-${preset.id}`"
        >
          <template #label>
            <span class="flex min-w-0 flex-col gap-0.5">
              <OText variant="body-strong">{{ raw(preset.name) }}</OText>
              <span
                class="text-text-secondary line-clamp-2 text-xs"
                :data-test="`oncall-preset-${preset.id}-description`"
                >{{ raw(preset.description) }}</span
              >
            </span>
          </template>
        </ORadio>
      </ORadioGroup>
      <OText v-if="isMobile && chosen" variant="meta" data-test="oncall-presets-picked-description">
        {{ raw(chosen.description) }}
      </OText>

      <div v-if="chosen" class="flex min-w-0 flex-col gap-4">
        <!-- One row per layer, in the priority order the schedule will hold
             them. A layer's people and its hours belong on one line: they are
             read together and, until this screen, were three stacked fields
             apart. -->
        <div class="border-border-default rounded-surface overflow-hidden border">
          <div
            v-for="(row, index) in rows"
            :key="row.key"
            class="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3"
            :class="index ? 'border-border-default border-t' : ''"
            :data-test="`oncall-preset-row-${row.key}`"
          >
            <span
              class="h-6 w-1 shrink-0 rounded-full"
              :class="fillOf(toneOf(row.key))"
              aria-hidden="true"
            />

            <span class="flex min-w-0 shrink-0 flex-col md:w-40">
              <OInlineEdit
                v-if="row.titleField"
                :model-value="titleOf(row)"
                size="sm"
                :maxlength="MAX_ROTATION_NAME_CHARS"
                :aria-label="raw(row.titleField.label)"
                :error="nameInvalid(row)"
                :error-message="nameInvalid(row) ? t('common.nameIsRequired') : undefined"
                :data-test="`oncall-preset-field-${row.key}-name`"
                @update:model-value="(v: string) => setField(row, row.titleField, v)"
              />
              <span v-else class="flex items-center gap-1">
                <OText variant="body-strong">{{ row.title }}</OText>
                <OIcon
                  v-if="row.help"
                  name="info"
                  size="sm"
                  :label="row.help"
                  tabindex="0"
                  class="text-icon-color cursor-pointer"
                >
                  <OTooltip :content="row.help" side="right" />
                </OIcon>
              </span>
            </span>

            <!-- The catch-all is a DEFAULT, not a blank: it already covers the
                 rest with everybody above. Offering an empty picker instead
                 read as a required field nobody knew how to fill. -->
            <template v-if="row.optional && !overridden[row.key]">
              <OText
                variant="meta"
                class="min-w-0 flex-1 max-md:order-last max-md:basis-full max-md:ps-4"
              >
                {{ t("oncall.presetCatchAllDefault") }}
              </OText>
              <OButton
                variant="outline"
                size="sm-action"
                class="ms-auto"
                icon-left="edit"
                :data-test="`oncall-preset-override-${row.key}`"
                @click="overridden[row.key] = true"
              >
                {{ t("oncall.presetOverride") }}
              </OButton>
            </template>

            <template v-else>
              <OnCallMemberPicker
                v-if="row.memberField"
                :model-value="membersOf(row)"
                :options="memberOptions"
                class="min-w-0 md:w-56"
                :aria-label="raw(row.memberField.label)"
                :data-test="`oncall-preset-field-${row.key}-members`"
                @update:model-value="(v: string[]) => setField(row, row.memberField, v)"
              />

              <template v-if="row.window">
                <OToggleGroup
                  v-if="row.window.days"
                  type="multiple"
                  :model-value="dayValues(row.window)"
                  :data-test="`oncall-preset-field-${row.key}-days`"
                  @update:model-value="(v: unknown) => setDays(row.window, v)"
                >
                  <OToggleGroupItem v-for="day in WEEK_DAYS" :key="day" :value="day" size="xs">
                    {{ dayName(day) }}
                  </OToggleGroupItem>
                </OToggleGroup>

                <span class="flex items-center gap-1.5">
                  <OSelect
                    :model-value="edgeOf(row.window, 'from')"
                    :options="HALF_HOURS"
                    size="sm"
                    width="xs"
                    :aria-label="raw(row.window.from.label)"
                    :data-test="`oncall-preset-field-${row.key}-from`"
                    @update:model-value="(v: SelectModelValue) => setEdge(row.window, 'from', v)"
                  />
                  <OIcon name="arrow-right-alt" size="xs" class="text-text-muted" />
                  <OSelect
                    :model-value="edgeOf(row.window, 'to')"
                    :options="MINUTES"
                    size="sm"
                    width="xs"
                    :aria-label="raw(row.window.to.label)"
                    :data-test="`oncall-preset-field-${row.key}-to`"
                    @update:model-value="(v: SelectModelValue) => setEdge(row.window, 'to', v)"
                  />
                </span>
              </template>

              <OText v-else-if="whenOf(row.key)" variant="meta" class="min-w-0">
                {{ whenOf(row.key) }}
              </OText>

              <OButton
                v-if="row.optional"
                variant="ghost-primary"
                size="sm-action"
                class="ms-auto"
                :data-test="`oncall-preset-revert-${row.key}`"
                @click="revert(row)"
              >
                {{ t("oncall.presetRevert") }}
              </OButton>

              <OButton
                v-if="row.removable"
                variant="ghost"
                size="icon-sm"
                icon-left="delete"
                class="ms-auto"
                :aria-label="t('oncall.presetsRemoveGroup')"
                :data-test="`oncall-preset-remove-${row.key}`"
                @click="removeRow(row)"
              />
            </template>
          </div>

          <!-- The boundary between two halves of a week is not a property of
               either half, so it gets the line between them. -->
          <div
            v-if="sentenceInputs.length"
            class="border-border-default flex flex-wrap items-center gap-x-3 gap-y-2 border-t px-4 py-3"
            data-test="oncall-preset-row-boundary"
          >
            <span class="bg-border-default h-6 w-1 shrink-0 rounded-full" aria-hidden="true" />
            <template v-for="input in sentenceInputs" :key="input.field">
              <OText variant="body-strong">{{ sentenceLead(input) }}</OText>
              <OSelect
                :model-value="model[input.field] as SelectModelValue"
                :options="optionsFor(input)"
                size="sm"
                width="xs"
                :aria-label="raw(input.label)"
                :data-test="`oncall-preset-field-${input.field}`"
                @update:model-value="(v: SelectModelValue) => (model[input.field] = v)"
              />
            </template>
            <OText v-if="sentenceHint" variant="meta" class="min-w-0 basis-full ps-4">
              {{ sentenceHint }}
            </OText>
          </div>
        </div>

        <span v-if="growable" class="flex items-center gap-2 self-start">
          <OButton
            variant="outline"
            size="sm-action"
            icon-left="add"
            :disabled="atLimit"
            :data-test="`oncall-preset-group-add-${growable.field}`"
            @click="addGroup(growable)"
          >
            {{ t("oncall.presetsAddGroup") }}
          </OButton>
          <OText v-if="limitNote" variant="meta" data-test="oncall-preset-group-limit">
            {{ limitNote }}
          </OText>
        </span>

        <!-- Cadence and anchor are right by default, so they read as a sentence until somebody disagrees. -->
        <div
          class="border-border-default rounded-surface flex flex-col gap-3 border px-4 py-3"
          data-test="oncall-preset-defaults"
        >
          <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
            <OText variant="label">{{ t("oncall.presetDefaults") }}</OText>
            <OText variant="meta" class="min-w-0">{{ defaultsSentence }}</OText>
            <OButton
              variant="ghost"
              size="sm-action"
              class="ms-auto"
              icon-left="tune"
              data-test="oncall-preset-defaults-toggle"
              @click="defaultsOpen = !defaultsOpen"
            >
              {{ defaultsOpen ? t("oncall.presetDefaultsDone") : t("oncall.presetDefaultsChange") }}
            </OButton>
          </div>

          <div v-if="defaultsOpen" class="flex flex-wrap items-start gap-3">
            <OSelect
              v-for="input in tickInputs"
              :key="input.field"
              :model-value="model[input.field] as SelectModelValue"
              :options="optionsFor(input)"
              :label="raw(input.label)"
              size="sm"
              width="md"
              :data-test="`oncall-preset-field-${input.field}`"
              @update:model-value="(v: SelectModelValue) => (model[input.field] = v)"
            >
              <template #tooltip>
                <OTooltip side="right" :content="raw(input.description)" />
              </template>
            </OSelect>
            <div v-if="anchorInput" :key="anchorInput.field" class="flex gap-2">
              <ODate
                :model-value="anchorDate"
                :label="raw(anchorInput.label)"
                :data-test="`oncall-preset-field-${anchorInput.field}-date`"
                @update:model-value="setAnchorDate"
              >
                <template #tooltip>
                  <OTooltip side="right" :content="raw(anchorInput.description)" />
                </template>
              </ODate>
              <OTime
                :model-value="anchorTime"
                :data-test="`oncall-preset-field-${anchorInput.field}-time`"
                @update:model-value="setAnchorTime"
              />
            </div>
          </div>
        </div>

        <!-- The server names the offending field; its sentence is written to
             be read by the person who typed the value. Verbatim, always. -->
        <p
          v-if="applyError"
          class="text-status-error-text text-sm"
          data-test="oncall-presets-error"
        >
          {{ raw(applyError) }}
        </p>
      </div>
    </div>

    <template #footer>
      <div class="flex flex-wrap items-center gap-3">
        <span class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <OText v-if="replaceNote" variant="meta" data-test="oncall-presets-replace-note">
            {{ replaceNote }}
          </OText>
          <!-- Not OText: its meta colour would override the warning token. -->
          <span
            v-if="blockedReason"
            class="text-status-warning-text text-xs"
            data-test="oncall-presets-blocked"
          >
            {{ blockedReason }}
          </span>
        </span>
        <div class="ms-auto flex gap-2">
          <OButton variant="outline" size="sm-action" @click="open = false">
            {{ t("oncall.cancel") }}
          </OButton>
          <OButton
            variant="primary"
            size="sm-action"
            :loading="applying"
            :disabled="!chosen || Boolean(blockedReason)"
            data-test="oncall-presets-apply"
            @click="onSave"
          >
            {{ targetRotation ? t("oncall.save") : t("oncall.addRotation") }}
          </OButton>
        </div>
      </div>
    </template>
  </ODrawer>

  <!-- Only a replace confirms: adding a rotation loses nothing. -->
  <ODialog
    v-model:open="confirmReplace"
    size="sm"
    data-test="oncall-presets-replace-confirm"
    :title="t('oncall.presetsReplaceTitle', { name: raw(targetRotation?.name ?? '') })"
    :primary-button-label="t('oncall.presetsReplaceOk')"
    :secondary-button-label="t('oncall.cancel')"
    @click:primary="confirmApply"
    @click:secondary="confirmReplace = false"
  >
    <ul v-if="sideEffects.length" class="flex flex-col gap-2">
      <li
        v-for="(line, index) in sideEffects"
        :key="index"
        :data-test="`oncall-presets-effect-${index}`"
      >
        <OText>{{ line }}</OText>
      </li>
    </ul>
  </ODialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useStore } from "vuex";

import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OText from "@/lib/core/Typography/OText.vue";
import { useOnCallClock } from "@/composables/useOnCallClock";
import { useOrgUserNames } from "@/composables/useOrgUserNames";
import ORadio from "@/lib/forms/Radio/ORadio.vue";
import ORadioGroup from "@/lib/forms/Radio/ORadioGroup.vue";
import useBreakpoint from "@/composables/useBreakpoint";
import OInnerLoading from "@/lib/feedback/InnerLoading/OInnerLoading.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import ODate from "@/lib/forms/Date/ODate.vue";
import OInlineEdit from "@/lib/forms/InlineEdit/OInlineEdit.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import type { SelectModelValue, SelectOption } from "@/lib/forms/Select/OSelect.types";
import OTime from "@/lib/forms/Time/OTime.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { queryClient } from "@/composables/query/queryClient";
import { applySchedulePresetMutation, schedulePresetsQuery } from "@/services/oncall.queries";
import { useMutation } from "@tanstack/vue-query";
import type {
  OnCallTeamMember,
  PresetDescriptor,
  PresetInput,
  Rotation,
} from "@/ts/interfaces/oncall";
import { DEFAULT_ROTATION_NAME, MAX_ROTATION_NAME_CHARS } from "@/ts/interfaces/oncall";
import type { I18nKey, I18nText } from "@/types/i18n";
import { raw, useI18nTyped } from "@/types/i18n";
import {
  SHIFT_PRESETS,
  formatInZone,
  formatMinuteOfDay,
  fromZonedInputValue,
  toZonedInputValue,
} from "@/utils/oncall";
import { licenseDeniedFeatures } from "@/utils/featureGate";

import OnCallMemberPicker from "./OnCallMemberPicker.vue";
import {
  WEEK_DAYS,
  dayName,
  describeWhen,
  layersOf,
  splitDay,
  type CoverageMark,
} from "./OnCallSchedulePresets.shape";
import {
  firstFreeName,
  duplicateName,
  handoverChange,
  lastMondayMidnight,
  nextRotationName,
  sharedPeople,
  templateProblem,
  type TemplateProblem,
} from "./OnCallSchedulePresets.target";

const props = defineProps<{
  teamId: string;
  members: OnCallTeamMember[];
  /** The team's own zone, the only zone every template time is read in. */
  timezone: string;
  /** The team's rotations, in lane order. */
  rotations: Rotation[];
  /** The rotation id the drawer opens on; empty opens on a new rotation. */
  startOn: string;
}>();
const emit = defineEmits<{ applied: []; licenseDenied: [features: string[]] }>();
const open = defineModel<boolean>("open", { required: true });

const { t } = useI18nTyped();
const store = useStore();
const { isMobile } = useBreakpoint();
const nowMicros = useOnCallClock();

const MINUTES_PER_DAY = 1440;
/** The toggle's value for "New rotation"; never a minted rotation id. */
const NEW_ROTATION = "__new__";
const orgId = computed(() => store.state.selectedOrganization.identifier);

const applyPresetWrite = useMutation(() => applySchedulePresetMutation(orgId.value, props.teamId));

const presets = ref<PresetDescriptor[]>([]);
const loading = ref(false);
const chosen = ref<PresetDescriptor | null>(null);
const applying = ref(false);
const applyError = ref("");
const confirmReplace = ref(false);
const defaultsOpen = ref(false);
/// Which optional groups the user has taken off their default. Keyed by row.
const overridden = ref<Record<string, boolean>>({});
/// A rotation id to replace, or NEW_ROTATION.
const target = ref(NEW_ROTATION);
const newName = ref("");
/// Set by a successful apply, so the next open starts a new form even for the same target.
const stale = ref(true);

/// One flat model keyed by field name; groups hold arrays of row objects.
/// Kept as plain wire values so `apply` is a spread, not a translation.
const model = ref<Record<string, unknown>>({});

const { optionOf, nameOf } = useOrgUserNames();

/// What each shape holds while another is on screen, keyed by preset id.
const drafts = new Map<
  string,
  { model: Record<string, unknown>; overridden: Record<string, boolean> }
>();

const memberOptions = computed<SelectOption[]>(() =>
  props.members.map((m) => optionOf(m.user_email, true)),
);

// ── The target ────────────────────────────────────────────────────────────────

const targetRotation = computed(
  () => props.rotations.find((rotation) => rotation.id === target.value) ?? null,
);

const newNameBlank = computed(
  () => !targetRotation.value && props.rotations.length > 0 && !newName.value.trim(),
);

/// The server refuses a second rotation of the same name, compared trimmed and case-insensitive.
const newNameTaken = computed(() => {
  const name = newName.value.trim().toLowerCase();
  return (
    !targetRotation.value &&
    !!name &&
    props.rotations.some((rotation) => rotation.name.trim().toLowerCase() === name)
  );
});

/// With no rotation at all the server names the first one, as it always has.
const addedName = computed(() =>
  props.rotations.length ? newName.value.trim() : DEFAULT_ROTATION_NAME,
);

function setNewName(value: string | number | null | undefined) {
  if (!targetRotation.value) newName.value = String(value ?? "");
}

function setTarget(value: unknown) {
  // A single toggle clicked again emits empty; the target stays where it was.
  if (typeof value !== "string" || !value) return;
  target.value = value;
  refreshTickDefaults();
}

const drawerTitle = computed<I18nText>(() =>
  targetRotation.value
    ? t("oncall.presetsTitleFor", { name: raw(targetRotation.value.name) })
    : t("oncall.presetsTitleNew"),
);

// ── The catalogue ─────────────────────────────────────────────────────────────

watch(
  open,
  (isOpen) => {
    if (isOpen) {
      const next = props.rotations.some((r) => r.id === props.startOn)
        ? props.startOn
        : NEW_ROTATION;
      // A form filled for another target, or already saved, must not carry over; Esc must not cost one.
      if (stale.value || next !== target.value) {
        stale.value = false;
        target.value = next;
        newName.value = nextRotationName(
          props.rotations.map((r) => r.name),
          (n) => String(t("oncall.rotationNthName", { n })),
        );
        drafts.clear();
        chosen.value = null;
      } else {
        refreshTickDefaults();
      }
      // Entered on every open: the catalogue's cache entry, not a guard, keeps a reopen off the wire.
      fetchPresets();
    } else {
      applyError.value = "";
    }
  },
  // A dialog can be MOUNTED open; without this the catalogue never loads.
  { immediate: true },
);

async function fetchPresets() {
  loading.value = true;
  try {
    presets.value = await queryClient.fetchQuery(schedulePresetsQuery(orgId.value));
    // Landing on a chosen shape: the screen's job is comparison, and an empty
    // right pane makes the first click cost a shape nobody had rejected yet.
    if (!chosen.value && presets.value[0]) choose(presets.value[0]);
  } catch (err) {
    const denied = licenseDeniedFeatures(err);
    if (denied) emit("licenseDenied", denied);
    presets.value = [];
  } finally {
    loading.value = false;
  }
}

/// The team zone is the only zone, so a timezone input an older server still lists is dropped.
function inputsOf(preset: PresetDescriptor): PresetInput[] {
  return preset.inputs.filter((input) => input.kind !== "timezone");
}

function emptyGroup(input: PresetInput): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const sub of input.fields ?? []) {
    if (sub.default !== undefined) row[sub.field] = sub.default;
  }
  return row;
}

/// The shape as the catalogue would open it: every default filled, and a
/// group_list at its own declared minimum so the form starts valid-shaped.
function defaultModelOf(preset: PresetDescriptor): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  for (const input of inputsOf(preset)) {
    if (input.kind === "group_list") {
      const entries: Record<string, unknown>[] = [];
      for (let i = 0; i < (input.min ?? 1); i++) appendGroup(input, entries);
      next[input.field] = entries;
    } else if (input.kind === "group") {
      next[input.field] = emptyGroup(input);
    } else if (input.default !== undefined) {
      next[input.field] = input.default;
    }
  }
  applyTickDefaults(preset, next);
  return next;
}

/// A replace keeps the target's handovers: cadence and anchor come from its first shift rule.
function applyTickDefaults(preset: PresetDescriptor, values: Record<string, unknown>) {
  const rule = targetRotation.value?.shift_rules[0];
  for (const input of inputsOf(preset)) {
    let value: unknown;
    if (input.kind === "duration_micros") value = rule ? rule.shift_micros : input.default;
    else if (input.kind === "timestamp_micros") value = rule ? rule.anchor_micros : input.default;
    else continue;
    if (value === undefined) delete values[input.field];
    else values[input.field] = value;
  }
}

/// Every shape's cadence and anchor follow the target as it is now, not as it was when last opened.
function refreshTickDefaults() {
  if (chosen.value) applyTickDefaults(chosen.value, model.value);
  for (const [id, draft] of drafts) {
    const preset = presets.value.find((p) => p.id === id);
    if (preset) applyTickDefaults(preset, draft.model);
  }
}

function choose(preset: PresetDescriptor) {
  if (chosen.value) {
    drafts.set(chosen.value.id, { model: model.value, overridden: overridden.value });
  }
  const draft = drafts.get(preset.id);
  chosen.value = preset;
  applyError.value = "";
  defaultsOpen.value = false;
  overridden.value = draft?.overridden ?? {};
  model.value = draft?.model ?? defaultModelOf(preset);
}

/// The picker's v-model; re-picking the open shape is a no-op.
const activeId = computed<string>({
  get: () => chosen.value?.id ?? "",
  set: (id) => {
    const preset = presets.value.find((p) => p.id === id);
    if (preset && preset.id !== chosen.value?.id) choose(preset);
  },
});

const presetOptions = computed<SelectOption[]>(() =>
  presets.value.map((preset) => ({ label: raw(preset.name), value: preset.id })),
);

function groupsOf(input: PresetInput): Record<string, unknown>[] {
  return (model.value[input.field] ?? []) as Record<string, unknown>[];
}

/** The pair of minute fields a group carries, when it carries exactly one pair. */
function edgesOf(input: PresetInput): [PresetInput, PresetInput] | null {
  const minutes = (input.fields ?? []).filter((f) => f.kind === "minute_of_day");
  return minutes.length === 2 && minutes[0] && minutes[1] ? [minutes[0], minutes[1]] : null;
}

/** A repeated group's own name field, when it has one. */
function titleFieldOf(input: PresetInput): PresetInput | null {
  return (input.fields ?? []).find((f) => f.kind === "text" && f.required) ?? null;
}

/// A new region arrives named and the day is re-split evenly, so every row covers hours from the start.
function appendGroup(input: PresetInput, entries: Record<string, unknown>[]) {
  const entry = emptyGroup(input);
  const title = titleFieldOf(input);
  if (title) {
    entry[title.field] = firstFreeName(
      entries.map((e) => (typeof e[title.field] === "string" ? String(e[title.field]) : "")),
      (n) => String(t("oncall.presetsGroupName", { label: title.label, n })),
      1,
    );
  }
  entries.push(entry);
  const edges = edgesOf(input);
  if (!edges) return;
  const [from, to] = edges;
  splitDay(entries.length).forEach(([start, end], index) => {
    entries[index][from.field] = start;
    entries[index][to.field] = end;
  });
}

function addGroup(input: PresetInput) {
  appendGroup(input, groupsOf(input));
}

// ── The form, read off the schema ─────────────────────────────────────────────

/// How the schedule ticks rather than who covers what; keyed on kind so a second duration is quiet too.
const DEFAULT_KINDS = new Set(["duration_micros", "timestamp_micros"]);

interface WindowSpec {
  /** Where the window's values live — a group's own row, or the flat model. */
  model: Record<string, unknown>;
  days: PresetInput | null;
  from: PresetInput;
  to: PresetInput;
}

interface RowSpec {
  key: string;
  entry: Record<string, unknown>;
  title: I18nText;
  help: I18nText | "";
  titleField: PresetInput | null;
  memberField: PresetInput | null;
  window: WindowSpec | null;
  removable: boolean;
  /** An optional group — the catch-all, which already has an answer. */
  optional: boolean;
  owner: PresetInput;
  index: number;
}

const visibleInputs = computed(() => (chosen.value ? inputsOf(chosen.value) : []));

const groupInputs = computed(() =>
  visibleInputs.value.filter((i) => i.kind === "group" || i.kind === "group_list"),
);

const scalarInputs = computed(() =>
  visibleInputs.value.filter(
    (i) => i.kind !== "group" && i.kind !== "group_list" && !DEFAULT_KINDS.has(i.kind),
  ),
);

const defaultInputs = computed(() => visibleInputs.value.filter((i) => DEFAULT_KINDS.has(i.kind)));

/**
 * A start/end PAIR of minutes at the top level is one layer's window and
 * belongs on that layer's row; anything else left over is a boundary BETWEEN
 * layers and gets its own line. Read from kinds rather than from field names,
 * so neither reading is tied to a preset id.
 */
const sharedWindow = computed<Omit<WindowSpec, "model"> | null>(() => {
  const minutes = scalarInputs.value.filter((i) => i.kind === "minute_of_day");
  if (minutes.length !== 2 || !minutes[0] || !minutes[1]) return null;
  return {
    days: scalarInputs.value.find((i) => i.kind === "day_list") ?? null,
    from: minutes[0],
    to: minutes[1],
  };
});

const sentenceInputs = computed(() => {
  const window = sharedWindow.value;
  if (!window) return scalarInputs.value;
  return scalarInputs.value.filter(
    (i) => i !== window.days && i !== window.from && i !== window.to,
  );
});

/// The one repeatable group, kept on screen at its ceiling so the limit can say why.
const growable = computed(() => groupInputs.value.find((i) => i.kind === "group_list") ?? null);

const atLimit = computed(
  () => !!growable.value && groupsOf(growable.value).length >= (growable.value.max ?? Infinity),
);

const limitNote = computed<I18nText | "">(() => {
  const input = growable.value;
  if (!input?.max) return "";
  return t("oncall.presetsGroupLimit", { max: input.max, label: input.label.toLowerCase() });
});

function rowOf(input: PresetInput, entry: Record<string, unknown>, index: number): RowSpec {
  const fields = input.fields ?? [];
  const minutes = fields.filter((f) => f.kind === "minute_of_day");
  const own: WindowSpec | null =
    minutes.length === 2 && minutes[0] && minutes[1]
      ? { model: entry, days: null, from: minutes[0], to: minutes[1] }
      : null;

  return {
    key: index >= 0 ? `${input.field}-${index}` : input.field,
    entry,
    title: raw(input.label),
    // A repeated row's own label is its name field; the group label above it
    // would be the same word N times.
    help: index >= 0 ? "" : raw(input.description),
    titleField: titleFieldOf(input),
    memberField: fields.find((f) => f.kind === "member_list") ?? null,
    window: own,
    removable: index >= 0 && groupsOf(input).length > (input.min ?? 1),
    optional: input.kind === "group" && !input.required,
    owner: input,
    index,
  };
}

const rows = computed<RowSpec[]>(() => {
  const out: RowSpec[] = [];
  for (const input of groupInputs.value) {
    if (input.kind === "group_list") {
      groupsOf(input).forEach((entry, index) => out.push(rowOf(input, entry, index)));
    } else {
      out.push(rowOf(input, (model.value[input.field] ?? {}) as Record<string, unknown>, -1));
    }
  }
  // A top-level window restricts the highest-priority layer — the one the
  // shape is named after — so it rides on that row rather than standing alone.
  const shared = sharedWindow.value;
  if (shared && out[0] && !out[0].window) out[0].window = { ...shared, model: model.value };
  return out;
});

function removeRow(row: RowSpec) {
  groupsOf(row.owner).splice(row.index, 1);
}

/// Back to "Covered by everyone above": an emptied catch-all is left out of the request.
function revert(row: RowSpec) {
  overridden.value[row.key] = false;
  if (row.memberField) row.entry[row.memberField.field] = [];
}

function membersOf(row: RowSpec): string[] {
  const field = row.memberField;
  if (!field) return [];
  const value = row.entry[field.field];
  return Array.isArray(value) ? (value as string[]) : [];
}

function titleOf(row: RowSpec): string {
  const field = row.titleField;
  const value = field ? row.entry[field.field] : "";
  return typeof value === "string" ? value : "";
}

/// The template addresses a field through its schema entry, which is nullable
/// at every call site — one writer keeps the null check out of the markup.
function setField(row: RowSpec, field: PresetInput | null, value: unknown) {
  if (field) row.entry[field.field] = value;
}

/// Whether a row's own controls are on screen at all — the un-overridden
/// catch-all shows its default sentence instead, so it has nothing to validate.
function controlsVisible(row: RowSpec): boolean {
  return !(row.optional && !overridden.value[row.key]);
}

function nameInvalid(row: RowSpec): boolean {
  return Boolean(row.titleField) && !titleOf(row).trim();
}

function edgeOf(window: WindowSpec | null, edge: "from" | "to"): SelectModelValue {
  if (!window) return undefined;
  return window.model[window[edge].field] as SelectModelValue;
}

function setEdge(window: WindowSpec | null, edge: "from" | "to", value: SelectModelValue) {
  if (window) window.model[window[edge].field] = value;
}

// ── Controls ──────────────────────────────────────────────────────────────────

const HALF_HOURS: SelectOption[] = Array.from({ length: 48 }, (_, i) => ({
  label: raw(formatMinuteOfDay(i * 30)),
  value: i * 30,
}));
// 1440 is "until end of day" — end_minute's exclusive bound, kept out of
// HALF_HOURS' 30-minute stride and appended once on its own.
const MINUTES: SelectOption[] = [...HALF_HOURS, { label: raw("24:00"), value: MINUTES_PER_DAY }];

const DAY_OPTIONS: SelectOption[] = WEEK_DAYS.map((day) => ({ label: dayName(day), value: day }));

const HANDOVER_OPTIONS: SelectOption[] = SHIFT_PRESETS.map((preset) => ({
  label: t(preset.labelKey),
  value: preset.micros,
}));

function optionsFor(input: PresetInput): SelectOption[] {
  switch (input.kind) {
    // A lone minute is a start or a split, and the server refuses 24:00 for both.
    case "minute_of_day":
      return HALF_HOURS;
    case "day_of_week":
    case "day_list":
      return DAY_OPTIONS;
    case "duration_micros":
      return HANDOVER_OPTIONS;
    default:
      return [];
  }
}

/// The boundary line reads "Split on <day> at <time>"; a kind it has no word for keeps the catalogue's label.
function sentenceLead(input: PresetInput): I18nText {
  if (input.kind === "day_of_week") return t("oncall.presetSplitOn");
  if (input.kind === "minute_of_day") return t("oncall.presetSplitAt");
  return raw(input.label);
}

function dayValues(window: WindowSpec | null): number[] {
  if (!window?.days) return [];
  const value = window.model[window.days.field];
  return Array.isArray(value) ? (value as number[]) : [];
}

function setDays(window: WindowSpec | null, value: unknown) {
  if (!window?.days) return;
  // OToggleGroup round-trips values through the DOM dataset, so a day comes
  // back as its own string — the wire wants the number the catalogue named.
  window.model[window.days.field] = (Array.isArray(value) ? value : [])
    .map((day) => Number(day))
    .filter((day) => Number.isInteger(day))
    .sort((a, b) => a - b);
}

/// An instant is a date and a time read in a zone; a cadence is a number and a
/// unit. The catalogue distinguishes them, so the controls do too.
const anchorInput = computed(
  () => defaultInputs.value.find((i) => i.kind === "timestamp_micros") ?? null,
);
const tickInputs = computed(() => defaultInputs.value.filter((i) => i.kind !== "timestamp_micros"));
const handoverInput = computed(
  () => defaultInputs.value.find((i) => i.kind === "duration_micros") ?? null,
);

const sentenceHint = computed<I18nText | "">(() =>
  sentenceInputs.value.some((i) => i.kind === "day_of_week") ? t("oncall.presetSplitHint") : "",
);

/// What the first shift is when nothing is sent: what the server would pick, so the pickers never open blank.
const anchorMicros = computed(() => {
  const value = anchorInput.value ? model.value[anchorInput.value.field] : undefined;
  return typeof value === "number" ? value : lastMondayMidnight(nowMicros.value, zone.value);
});

const anchorLocal = computed(() => toZonedInputValue(anchorMicros.value, zone.value));

function setAnchor(value: string | number) {
  const input = anchorInput.value;
  // A picker echoing the shown value must not swap the target's exact anchor for a minute-rounded one.
  if (!input || String(value) === anchorLocal.value) return;
  const micros = fromZonedInputValue(String(value), zone.value);
  if (micros === null) delete model.value[input.field];
  else model.value[input.field] = micros;
}

// ODate/OTime split anchorLocal's `YYYY-MM-DDTHH:mm` in two; recombining on
// either half's change keeps the other half's current value in place.
const anchorDate = computed(() => anchorLocal.value.slice(0, 10));
const anchorTime = computed(() => anchorLocal.value.slice(11));

function setAnchorDate(date: string) {
  setAnchor(`${date}T${anchorTime.value}`);
}
function setAnchorTime(time: string) {
  setAnchor(`${anchorDate.value}T${time}`);
}

// ── What the picture and the footer say ───────────────────────────────────────

const layers = computed(() => (chosen.value ? layersOf(chosen.value, model.value) : null));

function toneOf(key: string): CoverageMark {
  return layers.value?.find((layer) => layer.key === key)?.tone ?? "rest";
}

/// A row with no window of its own says when it holds instead — "the rest of
/// the time" is an answer, and a blank half-row read as a missing control.
function whenOf(key: string): I18nText | "" {
  const layer = layers.value?.find((l) => l.key === key);
  return layer ? describeWhen(layer.restriction) : "";
}

const FILLS: Record<CoverageMark, string> = {
  1: "bg-schedule-band-1-solid-bg",
  2: "bg-schedule-band-2-solid-bg",
  3: "bg-schedule-band-3-solid-bg",
  4: "bg-schedule-band-4-solid-bg",
  5: "bg-schedule-band-5-solid-bg",
  6: "bg-schedule-band-6-solid-bg",
  rest: "bg-border-strong",
  unstaffed: "bg-status-warning-bg",
  gap: "bg-schedule-gap-bg",
};

function fillOf(tone: CoverageMark): string {
  return FILLS[tone];
}

const zone = computed(() => props.timezone);

const handoverMicros = computed(() => {
  const value = handoverInput.value ? model.value[handoverInput.value.field] : undefined;
  return typeof value === "number" ? value : null;
});

/// What applying changes about the target rotation's handovers; nothing for a new rotation.
const handoverDelta = computed(() =>
  handoverMicros.value === null
    ? { length: false, anchor: false }
    : handoverChange(
        targetRotation.value?.shift_rules[0],
        handoverMicros.value,
        anchorMicros.value,
        zone.value,
      ),
);
const handoverMoves = computed(() => handoverDelta.value.length || handoverDelta.value.anchor);

/// A shift length as the handover picker names it, lowercased to sit mid-sentence.
function lengthName(micros: number | null): string {
  const preset = SHIFT_PRESETS.find((p) => p.micros === micros);
  return String(preset ? t(preset.labelKey) : t("oncall.presetHandoverCustomLength")).toLowerCase();
}

const HANDOVER_AT: Intl.DateTimeFormatOptions = {
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
};

const defaultsSentence = computed<I18nText>(() => {
  const cadence = SHIFT_PRESETS.find((p) => p.micros === handoverMicros.value);
  const values = {
    zone: raw(zone.value),
    handover: cadence ? lengthName(cadence.micros) : String(t("oncall.presetHandoverCustom")),
    anchor: formatInZone(anchorMicros.value, zone.value),
  };
  return targetRotation.value && !handoverMoves.value
    ? t("oncall.presetDefaultsSentenceSame", values)
    : t("oncall.presetDefaultsSentence", values);
});

const replaceNote = computed<I18nText | "">(() => {
  if (targetRotation.value)
    return t("oncall.presetsReplaceNote", { name: raw(targetRotation.value.name) });
  if (!addedName.value || newNameTaken.value) return "";
  return t("oncall.presetsAddNote", { name: raw(addedName.value) });
});

/// Save waits for every field to be valid, and the footer names the first problem.
const blockedReason = computed<I18nText | "">(() => {
  if (newNameBlank.value) return t("oncall.presetsBlockedNewName");
  if (newNameTaken.value)
    return t("oncall.presetsBlockedNameTaken", { name: raw(newName.value.trim()) });
  const unnamed = rows.value.find(nameInvalid)?.titleField;
  if (unnamed) return t("oncall.presetsBlockedName", { label: unnamed.label.toLowerCase() });
  const twice = duplicateName(
    rows.value.map((row) => (row.titleField ? titleOf(row) : String(row.title))),
  );
  if (twice) return t("oncall.presetsBlockedDuplicateRule", { name: raw(twice) });
  if (rows.value.some((row) => row.memberField && controlsVisible(row) && !membersOf(row).length))
    return t("oncall.presetsBlockedMembers");
  const problem = templateProblem(visibleInputs.value, model.value);
  return problem ? problemReason(problem) : "";
});

function problemReason(problem: TemplateProblem): I18nText {
  switch (problem.kind) {
    case "empty_window":
      return t("oncall.presetsBlockedEmptyWindow");
    case "overlap": {
      const label = titleFieldOf(problem.input)?.label ?? problem.input.label;
      return t("oncall.presetsBlockedOverlap", { label: label.toLowerCase() });
    }
    case "no_days":
      return t("oncall.presetsBlockedNoDays");
    case "week_start":
      return t("oncall.presetsBlockedWeekStart");
  }
}

/// What a replace does beyond the rotation itself, one line each.
const sideEffects = computed<I18nText[]>(() => {
  const lines: I18nText[] = [];
  const rule = targetRotation.value?.shift_rules[0];
  // A line whose two ends read the same says nothing, so it is never shown.
  const change = (key: I18nKey, from: string, to: string) => {
    if (from !== to) lines.push(t(key, { from, to }));
  };
  if (rule && handoverDelta.value.length) {
    change(
      "oncall.presetsEffectLength",
      lengthName(rule.shift_micros),
      lengthName(handoverMicros.value),
    );
  }
  if (rule && handoverDelta.value.anchor) {
    change(
      "oncall.presetsEffectMove",
      formatInZone(rule.anchor_micros, zone.value, HANDOVER_AT),
      formatInZone(anchorMicros.value, zone.value, HANDOVER_AT),
    );
  }
  const people = rows.value.flatMap((row) => (controlsVisible(row) ? membersOf(row) : []));
  const shared = sharedPeople(people, props.rotations, target.value);
  const [first] = shared;
  if (first) {
    const values = {
      name: raw(nameOf(first.email)),
      rotation: raw(first.rotation),
      count: shared.length - 1,
    };
    lines.push(
      shared.length > 1
        ? t(
            shared.every((person) => person.rotation === first.rotation)
              ? "oncall.presetsEffectSharedMore"
              : "oncall.presetsEffectSharedOthers",
            values,
            values.count,
          )
        : t("oncall.presetsEffectShared", values),
    );
  }
  return lines;
});

// ── Applying ──────────────────────────────────────────────────────────────────

function onSave() {
  if (!chosen.value || blockedReason.value) return;
  if (targetRotation.value) confirmReplace.value = true;
  else apply();
}

function confirmApply() {
  confirmReplace.value = false;
  apply();
}

async function apply() {
  if (!chosen.value) return;
  applyError.value = "";
  applying.value = true;
  const template = raw(chosen.value.name);
  const replacing = targetRotation.value;
  try {
    // Absent beats empty: an untouched field is the server's to default, and an absent catch-all means everyone above.
    const body: Record<string, unknown> & { preset: string } = { preset: chosen.value.id };
    for (const [key, value] of Object.entries(model.value)) {
      if (value === undefined || value === "" || value === null) continue;
      if (isUntouchedOptionalGroup(key, value)) continue;
      body[key] = value;
    }
    if (replacing) body.rotation_id = replacing.id;
    else if (props.rotations.length) body.new_rotation_name = addedName.value;
    await applyPresetWrite.mutateAsync(body);
    toast({
      variant: "success",
      message: replacing
        ? t("oncall.presetsReplaced", { name: raw(replacing.name), template })
        : t("oncall.presetsAdded", { name: raw(addedName.value), template }),
    });
    stale.value = true;
    open.value = false;
    emit("applied");
  } catch (err) {
    // Named-field validation, written for the person who typed the value —
    // but a rejection that never reached that code (a body the server could
    // not even parse) carries its reason as a plain string, not `{message}`.
    // Either way, show the real reason rather than axios's generic status text.
    const failure = err as {
      response?: { data?: { message?: string } | string };
      message?: string;
    };
    const data = failure?.response?.data;
    const reason = typeof data === "string" ? data : data?.message;
    applyError.value = String(reason || failure?.message || "");
  } finally {
    applying.value = false;
  }
}

function isUntouchedOptionalGroup(field: string, value: unknown): boolean {
  const input = chosen.value?.inputs.find((i) => i.field === field);
  if (!input || input.kind !== "group" || input.required) return false;
  const members = (value as Record<string, unknown>)?.members;
  return !Array.isArray(members) || !members.length;
}
</script>
