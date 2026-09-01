<!--
  Start a schedule from one of the named shapes instead of hand-building
  layers, priorities and minute-of-day windows. Follow-the-sun is the first
  thing a distributed team asks for, and until this control it had to be
  assembled by somebody who already understood restriction windows.

  A tab per shape, not a step. The names stay on one strip while the chosen
  one's form is edited under it, because choosing between four shapes is a
  comparison — a back button between the names and what they build made the
  reader hold the other three in their head. The strip is the same OTabs
  every other module heads its sub-pages with, so this reads as one more page
  rather than a bespoke picker.

  A drawer rather than a dialog: the coverage grid is seven columns wide and
  every layer is a row of four controls, so the width is load-bearing.

  The form is GENERATED from the catalogue's own `inputs` schema — kinds,
  labels, min/max — never hardcoded. Which control a field gets, whether a
  layer takes a window, how many regions are allowed: all read from the
  descriptor, so a fifth preset appears here with no UI change. The one thing
  the browser has to know on its own is what each shape COVERS, because that
  picture is redrawn on every keystroke; that lives in `.shape.ts` and degrades
  to "no picture" for an id this build has not met.

  Applying is a FULL REPLACE of the team's rotations, so the footer counts what
  is being replaced and a confirm stands between the button and a working
  schedule. What comes back is an ordinary rotation set with nothing
  preset-specific stored — a starting point, not a mode.
-->
<template>
  <ODrawer
    v-model:open="open"
    size="xxl"
    :title="t('oncall.presetsTitle')"
    :sub-title="t('oncall.presetsSubtitle')"
    data-test="oncall-presets-drawer"
  >
    <OInnerLoading v-if="loading" showing />

    <div v-else class="flex flex-col gap-4">
      <!-- Every shape stays reachable: the chosen one has to be re-comparable
           without losing the values already typed into it. -->
      <OTabs v-model="activeId" bordered data-test="oncall-presets-tabs">
        <OTab
          v-for="preset in presets"
          :key="preset.id"
          :name="preset.id"
          :label="raw(preset.name)"
          :data-test="`oncall-preset-${preset.id}`"
        />
      </OTabs>

      <div v-if="chosen" class="flex min-w-0 flex-col gap-4">
        <!-- The tab carries the name, so the line under it carries the part a
             name cannot: what applying this one actually builds. -->
        <OText variant="meta">{{ raw(chosen.description) }}</OText>

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
                :placeholder="raw(row.titleField.label)"
                :aria-label="raw(row.titleField.label)"
                :data-test="`oncall-preset-field-${row.key}-name`"
                @update:model-value="(v: string) => setField(row, row.titleField, v)"
              />
              <span v-else class="flex items-center gap-1">
                <OText variant="body-strong">{{ row.title }}</OText>
                <OIcon v-if="row.help" name="info" size="sm" class="text-icon-color cursor-pointer">
                  <OTooltip :content="row.help" side="right" />
                </OIcon>
              </span>
            </span>

            <!-- The catch-all is a DEFAULT, not a blank: it already covers the
                 rest with everybody above. Offering an empty picker instead
                 read as a required field nobody knew how to fill. -->
            <template v-if="row.optional && !overridden[row.key]">
              <OText variant="meta" class="min-w-0 flex-1">
                {{ t("oncall.presetCatchAllDefault") }}
              </OText>
              <OButton
                variant="outline"
                size="sm-action"
                class="ms-auto"
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
                    :options="MINUTES"
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
              <OText variant="body-strong">{{ raw(input.label) }}</OText>
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
            <OText variant="meta" class="min-w-0">{{ sentenceHint }}</OText>
          </div>
        </div>

        <OButton
          v-if="addable"
          variant="ghost"
          size="sm-action"
          icon-left="add"
          class="self-start"
          :data-test="`oncall-preset-group-add-${addable.field}`"
          @click="addGroup(addable)"
        >
          {{ t("oncall.presetsAddGroup") }}
        </OButton>

        <!-- Timezone, cadence and anchor are the same three answers for every
             shape and are right by default, so they read as a sentence and
             open only when somebody disagrees with one. -->
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
              :searchable="input.kind === 'timezone'"
              :label="raw(input.label)"
              :placeholder="t('oncall.presetTimezoneTeamShort')"
              clearable
              size="sm"
              width="md"
              :data-test="`oncall-preset-field-${input.field}`"
              @update:model-value="(v: SelectModelValue) => (model[input.field] = v)"
            >
              <template #tooltip>
                <OTooltip side="right" :content="raw(input.description)" />
              </template>
            </OSelect>
            <OInput
              v-if="anchorInput"
              :key="anchorInput.field"
              type="datetime-local"
              width="md"
              :model-value="anchorLocal"
              :label="raw(anchorInput.label)"
              :data-test="`oncall-preset-field-${anchorInput.field}`"
              @update:model-value="setAnchor"
            >
              <template #tooltip>
                <OTooltip side="right" :content="raw(anchorInput.description)" />
              </template>
            </OInput>
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
        <OText variant="meta" class="min-w-0">{{ replaceNote }}</OText>
        <div class="ms-auto flex gap-2">
          <OButton variant="outline" size="sm-action" @click="open = false">
            {{ t("oncall.cancel") }}
          </OButton>
          <OButton
            variant="primary"
            size="sm-action"
            :loading="applying"
            :disabled="!chosen"
            data-test="oncall-presets-apply"
            @click="rotationCount ? (confirmReplace = true) : apply()"
          >
            {{ t("oncall.presetsApply") }}
          </OButton>
        </div>
      </div>
    </template>
  </ODrawer>

  <!-- Full replace, so the confirm names what is being replaced. Only when a
       schedule exists: confirming the replacement of nothing is a click tax. -->
  <ConfirmDialog
    v-model="confirmReplace"
    :title="t('oncall.presetsReplaceTitle')"
    :message="t('oncall.presetsReplaceMessage')"
    :ok-label="t('oncall.presetsApply')"
    @update:ok="apply"
  />
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useStore } from "vuex";

import ConfirmDialog from "@/components/ConfirmDialog.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OInnerLoading from "@/lib/feedback/InnerLoading/OInnerLoading.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import OInlineEdit from "@/lib/forms/InlineEdit/OInlineEdit.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import type { SelectModelValue, SelectOption } from "@/lib/forms/Select/OSelect.types";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import oncallService from "@/services/oncall";
import type { OnCallTeamMember, PresetDescriptor, PresetInput } from "@/ts/interfaces/oncall";
import type { I18nText } from "@/types/i18n";
import { raw, useI18nTyped } from "@/types/i18n";
import {
  SHIFT_PRESETS,
  formatInZone,
  formatMinuteOfDay,
  fromZonedInputValue,
  resolvableTimezones,
  toZonedInputValue,
} from "@/utils/oncall";

import OnCallMemberPicker from "./OnCallMemberPicker.vue";
import {
  WEEK_DAYS,
  dayName,
  describeWhen,
  layersOf,
  type CoverageMark,
} from "./OnCallSchedulePresets.shape";

const props = defineProps<{
  teamId: string;
  members: OnCallTeamMember[];
  /** The team's own zone — what an absent `timezone` resolves to server-side. */
  timezone: string;
  /** How many rotations applying would replace. Zero skips the confirm. */
  rotationCount: number;
}>();
const emit = defineEmits<{ applied: [] }>();
const open = defineModel<boolean>("open", { required: true });

const { t } = useI18nTyped();
const store = useStore();

const MINUTES_PER_DAY = 1440;
const orgId = computed(() => store.state.selectedOrganization.identifier);

const presets = ref<PresetDescriptor[]>([]);
const loading = ref(false);
const chosen = ref<PresetDescriptor | null>(null);
const applying = ref(false);
const applyError = ref("");
const confirmReplace = ref(false);
const defaultsOpen = ref(false);
/// Which optional groups the user has taken off their default. Keyed by row.
const overridden = ref<Record<string, boolean>>({});

/// One flat model keyed by field name; groups hold arrays of row objects.
/// Kept as plain wire values so `apply` is a spread, not a translation.
const model = ref<Record<string, unknown>>({});

const memberOptions = computed<SelectOption[]>(() =>
  props.members.map((m) => ({ label: raw(m.user_email), value: m.user_email })),
);

// ── The catalogue ─────────────────────────────────────────────────────────────

watch(
  open,
  (isOpen) => {
    if (isOpen && !presets.value.length) fetchPresets();
    if (!isOpen) applyError.value = "";
  },
  // A dialog can be MOUNTED open; without this the catalogue never loads.
  { immediate: true },
);

async function fetchPresets() {
  loading.value = true;
  try {
    const res = await oncallService.listSchedulePresets({ org_identifier: orgId.value });
    presets.value = res.data ?? [];
    // Landing on a chosen shape: the screen's job is comparison, and an empty
    // right pane makes the first click cost a shape nobody had rejected yet.
    if (!chosen.value && presets.value[0]) choose(presets.value[0]);
  } catch {
    presets.value = [];
  } finally {
    loading.value = false;
  }
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
  for (const input of preset.inputs) {
    if (input.kind === "group_list") {
      const entries = Array.from({ length: input.min ?? 1 }, () => emptyGroup(input));
      tileDay(input, entries);
      next[input.field] = entries;
    } else if (input.kind === "group") {
      next[input.field] = emptyGroup(input);
    } else if (input.default !== undefined) {
      next[input.field] = input.default;
    }
  }
  return next;
}

function choose(preset: PresetDescriptor) {
  chosen.value = preset;
  applyError.value = "";
  defaultsOpen.value = false;
  overridden.value = {};
  model.value = defaultModelOf(preset);
}

/// The strip's v-model. Re-picking the open tab must not wipe the values
/// already typed into it, so the setter only fires on a real change.
const activeId = computed<string>({
  get: () => chosen.value?.id ?? "",
  set: (id) => {
    const preset = presets.value.find((p) => p.id === id);
    if (preset && preset.id !== chosen.value?.id) choose(preset);
  },
});

function groupsOf(input: PresetInput): Record<string, unknown>[] {
  return (model.value[input.field] ?? []) as Record<string, unknown>[];
}

/** The pair of minute fields a group carries, when it carries exactly one pair. */
function edgesOf(input: PresetInput): [PresetInput, PresetInput] | null {
  const minutes = (input.fields ?? []).filter((f) => f.kind === "minute_of_day");
  return minutes.length === 2 && minutes[0] && minutes[1] ? [minutes[0], minutes[1]] : null;
}

/**
 * Regions open covering the day between them, in equal slices.
 *
 * The catalogue gives windows no default because it has no opinion about how
 * many regions there are. Opening on two blank time pickers made the first
 * thing the screen said "168 hours nobody covers" — about a shape whose whole
 * promise is that it covers them.
 */
function tileDay(input: PresetInput, entries: Record<string, unknown>[]) {
  const edges = edgesOf(input);
  if (!edges || !entries.length) return;
  const [from, to] = edges;
  const step = Math.round(MINUTES_PER_DAY / entries.length / 30) * 30;
  entries.forEach((entry, index) => {
    if (entry[from.field] === undefined) entry[from.field] = index * step;
    if (entry[to.field] === undefined)
      entry[to.field] = index === entries.length - 1 ? MINUTES_PER_DAY : (index + 1) * step;
  });
}

/**
 * A new region halves the last one rather than arriving empty: a region with no
 * hours is a row that changes nothing, and the picture above would not move.
 */
function addGroup(input: PresetInput) {
  const entries = groupsOf(input);
  const next = emptyGroup(input);
  const edges = edgesOf(input);
  const last = entries.at(-1);
  if (edges && last) {
    const [from, to] = edges;
    const start = Number(last[from.field] ?? 0);
    const end = Number(last[to.field] ?? MINUTES_PER_DAY);
    const span = end > start ? end - start : end + MINUTES_PER_DAY - start;
    const mid = (start + Math.round(span / 2 / 30) * 30) % MINUTES_PER_DAY;
    last[to.field] = mid;
    next[from.field] = mid;
    next[to.field] = end;
  }
  entries.push(next);
}

// ── The form, read off the schema ─────────────────────────────────────────────

/// The three answers that are about how the schedule TICKS rather than about
/// who covers what. Keyed on kind, not on field name, so a shape that adds a
/// second duration still gets the quiet treatment.
const DEFAULT_KINDS = new Set(["timezone", "duration_micros", "timestamp_micros"]);

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

const groupInputs = computed(() =>
  (chosen.value?.inputs ?? []).filter((i) => i.kind === "group" || i.kind === "group_list"),
);

const scalarInputs = computed(() =>
  (chosen.value?.inputs ?? []).filter(
    (i) => i.kind !== "group" && i.kind !== "group_list" && !DEFAULT_KINDS.has(i.kind),
  ),
);

const defaultInputs = computed(() =>
  (chosen.value?.inputs ?? []).filter((i) => DEFAULT_KINDS.has(i.kind)),
);

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

/// The one group_list that has not hit its own ceiling, if any.
const addable = computed(
  () =>
    groupInputs.value.find(
      (i) => i.kind === "group_list" && groupsOf(i).length < (i.max ?? Infinity),
    ) ?? null,
);

function rowOf(input: PresetInput, entry: Record<string, unknown>, index: number): RowSpec {
  const fields = input.fields ?? [];
  const titleField = fields.find((f) => f.kind === "text" && f.required) ?? null;
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
    titleField,
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

const ZONE_OPTIONS = computed<SelectOption[]>(() =>
  resolvableTimezones(props.timezone).map((z) => ({ label: raw(z), value: z })),
);

const HANDOVER_OPTIONS: SelectOption[] = SHIFT_PRESETS.map((preset) => ({
  label: t(preset.labelKey),
  value: preset.micros,
}));

function optionsFor(input: PresetInput): SelectOption[] {
  switch (input.kind) {
    case "minute_of_day":
      return MINUTES;
    case "day_of_week":
    case "day_list":
      return DAY_OPTIONS;
    case "timezone":
      return ZONE_OPTIONS.value;
    case "duration_micros":
      return HANDOVER_OPTIONS;
    default:
      return [];
  }
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

const sentenceHint = computed<I18nText | "">(() =>
  sentenceInputs.value[0] ? raw(sentenceInputs.value[0].description) : "",
);

const anchorLocal = computed(() => {
  const value = anchorInput.value ? model.value[anchorInput.value.field] : undefined;
  return typeof value === "number" ? toZonedInputValue(value, zone.value) : "";
});

function setAnchor(value: string | number) {
  const input = anchorInput.value;
  if (!input) return;
  const micros = fromZonedInputValue(String(value), zone.value);
  if (micros === null) delete model.value[input.field];
  else model.value[input.field] = micros;
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

const zone = computed(() => (model.value.timezone as string) || props.timezone);

const defaultsSentence = computed<I18nText>(() => {
  const cadence = SHIFT_PRESETS.find((p) => p.micros === model.value.handover_micros);
  const anchor = model.value.anchor_micros;
  return t("oncall.presetDefaultsSentence", {
    zone: model.value.timezone
      ? String(model.value.timezone)
      : String(t("oncall.presetTimezoneTeam", { zone: props.timezone })),
    handover: String(cadence ? t(cadence.labelKey) : t("oncall.presetHandoverCustom")),
    anchor:
      typeof anchor === "number"
        ? formatInZone(anchor, zone.value)
        : String(t("oncall.presetAnchorDefault")),
  });
});

const replaceNote = computed<I18nText>(() =>
  props.rotationCount
    ? t("oncall.presetsReplaceNote", { count: props.rotationCount }, props.rotationCount)
    : t("oncall.presetsReplaceNone"),
);

// ── Applying ──────────────────────────────────────────────────────────────────

/// A row whose title is a REQUIRED text field (only follow-the-sun's regions,
/// which the preset genuinely cannot guess) but is blank or was never typed
/// into. Caught here, before the request leaves the browser, because the
/// server refuses a blank name too but only after a round trip — and its
/// rejection arrives as axum's own extraction failure, not this API's usual
/// named-field error.
function missingNameRow(): RowSpec | null {
  return rows.value.find((row) => row.titleField && !titleOf(row).trim()) ?? null;
}

async function apply() {
  if (!chosen.value) return;
  applyError.value = "";
  const missing = missingNameRow();
  if (missing?.titleField) {
    applyError.value = t("oncall.presetsMissingName", { label: missing.titleField.label });
    return;
  }
  applying.value = true;
  try {
    // Absent beats empty: a field the user never touched is the server's to
    // default — `timezone` absent means the TEAM's zone, never UTC, and an
    // un-overridden catch-all absent means everybody named above.
    const body: Record<string, unknown> & { preset: string } = { preset: chosen.value.id };
    for (const [key, value] of Object.entries(model.value)) {
      if (value === undefined || value === "" || value === null) continue;
      if (isUntouchedOptionalGroup(key, value)) continue;
      body[key] = value;
    }
    await oncallService.applySchedulePreset({
      org_identifier: orgId.value,
      team_id: props.teamId,
      data: body,
    });
    toast({ variant: "success", message: t("oncall.presetsApplied") });
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
