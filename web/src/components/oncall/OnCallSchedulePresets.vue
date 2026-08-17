<!--
  Start a schedule from one of the four named shapes instead of hand-building
  layers, priorities and minute-of-day windows. Follow-the-sun is the first
  thing a distributed team asks for, and until this control it had to be
  assembled by somebody who already understood restriction windows.

  The form is GENERATED from the catalogue's own `inputs` schema — kinds,
  labels, help lines, min/max — never hardcoded. follow_the_sun advertising
  `min: 2, max: 4` itself is the whole design: a fifth preset, or a changed
  shape, appears here with no UI change.

  Applying is a FULL REPLACE of the team's rotations, so a confirm stands
  between the button and a working schedule. What comes back is an ordinary
  rotation set with nothing preset-specific stored — a starting point, not a
  mode — and every field stays editable afterwards.
-->
<template>
  <ODrawer v-model:open="open" :title="t('oncall.presetsTitle')" data-test="oncall-presets-drawer">
    <div class="flex flex-col gap-4">
      <p class="text-text-secondary text-sm">{{ t("oncall.presetsHint") }}</p>

      <OInnerLoading v-if="loading" showing />

      <!-- Step 1: pick a shape. Cards, because the description and the layer
           list ARE the decision — a bare name row would send people to docs. -->
      <template v-else-if="!chosen">
        <button
          v-for="preset in presets"
          :key="preset.id"
          type="button"
          class="border-border-default hover:border-border-strong rounded-surface flex flex-col gap-1 border p-3 text-start"
          :data-test="`oncall-preset-${preset.id}`"
          @click="choose(preset)"
        >
          <span class="text-text-heading text-sm font-medium">{{ raw(preset.name) }}</span>
          <span class="text-text-secondary text-xs">{{ raw(preset.description) }}</span>
          <span class="mt-1 flex flex-col gap-0.5">
            <span
              v-for="(layer, i) in preset.layers"
              :key="i"
              class="text-text-muted text-xs"
            >
              {{ raw(`· ${layer}`) }}
            </span>
          </span>
        </button>
      </template>

      <!-- Step 2: the generated form. -->
      <template v-else>
        <span class="flex items-center gap-2">
          <OButton
            variant="ghost"
            size="icon-sm"
            icon-left="arrow-back"
            :aria-label="t('oncall.presetsBack')"
            data-test="oncall-presets-back"
            @click="chosen = null"
          />
          <OText variant="section">{{ raw(chosen.name) }}</OText>
        </span>

        <template v-for="input in chosen.inputs" :key="input.field">
          <!-- A repeatable group: N sub-forms between the catalogue's own
               min and max. -->
          <div v-if="input.kind === 'group_list'" class="flex flex-col gap-3">
            <span class="flex items-baseline gap-2">
              <OText variant="section">{{ raw(input.label) }}</OText>
              <OText variant="meta">{{ raw(input.description) }}</OText>
            </span>
            <div
              v-for="(entry, index) in groupsOf(input)"
              :key="index"
              class="border-border-default rounded-surface flex flex-col gap-3 border p-3"
              :data-test="`oncall-preset-group-${input.field}-${index}`"
            >
              <span class="flex items-center">
                <OText variant="meta">{{ raw(`${index + 1}`) }}</OText>
                <OButton
                  v-if="groupsOf(input).length > (input.min ?? 1)"
                  variant="ghost"
                  size="icon-sm"
                  icon-left="close"
                  class="ms-auto"
                  :aria-label="t('oncall.presetsRemoveGroup')"
                  :data-test="`oncall-preset-group-remove-${input.field}-${index}`"
                  @click="groupsOf(input).splice(index, 1)"
                />
              </span>
              <PresetField
                v-for="sub in input.fields ?? []"
                :key="sub.field"
                :input="sub"
                :model="entry"
                :member-options="memberOptions"
              />
            </div>
            <OButton
              v-if="groupsOf(input).length < (input.max ?? 99)"
              variant="outline"
              size="sm-action"
              icon-left="add"
              :data-test="`oncall-preset-group-add-${input.field}`"
              @click="groupsOf(input).push(emptyGroup(input))"
            >
              {{ t("oncall.presetsAddGroup") }}
            </OButton>
          </div>

          <!-- A single named group: its fields inline, one bordered section. -->
          <div
            v-else-if="input.kind === 'group'"
            class="border-border-default rounded-surface flex flex-col gap-3 border p-3"
          >
            <span class="flex items-baseline gap-2">
              <OText variant="section">{{ raw(input.label) }}</OText>
              <OText variant="meta">{{ raw(input.description) }}</OText>
            </span>
            <PresetField
              v-for="sub in input.fields ?? []"
              :key="sub.field"
              :input="sub"
              :model="groupOf(input)"
              :member-options="memberOptions"
            />
          </div>

          <PresetField v-else :input="input" :model="model" :member-options="memberOptions" />
        </template>

        <!-- The server names the offending field; its sentence is written to
             be read by the person who typed the value. Verbatim, always. -->
        <p v-if="applyError" class="text-status-error-text text-sm" data-test="oncall-presets-error">
          {{ raw(applyError) }}
        </p>
      </template>
    </div>

    <template #footer>
      <div v-if="chosen" class="flex justify-end gap-2">
        <OButton variant="outline" size="sm-action" @click="open = false">
          {{ t("oncall.cancel") }}
        </OButton>
        <OButton
          variant="primary"
          size="sm-action"
          :loading="applying"
          data-test="oncall-presets-apply"
          @click="hasSchedule ? (confirmReplace = true) : apply()"
        >
          {{ t("oncall.presetsApply") }}
        </OButton>
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
import { computed, h, ref, watch, defineComponent, type PropType } from "vue";
import { useStore } from "vuex";

import OButton from "@/lib/core/Button/OButton.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OInnerLoading from "@/lib/feedback/InnerLoading/OInnerLoading.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import oncallService from "@/services/oncall";
import type { OnCallTeamMember, PresetDescriptor, PresetInput } from "@/ts/interfaces/oncall";
import type { I18nText } from "@/types/i18n";
import { gt, raw, useI18nTyped } from "@/types/i18n";

const props = defineProps<{
  teamId: string;
  members: OnCallTeamMember[];
  /** Whether a schedule already exists — applying over one gets a confirm. */
  hasSchedule: boolean;
}>();
const emit = defineEmits<{ applied: [] }>();
const open = defineModel<boolean>("open", { required: true });

const { t } = useI18nTyped();
const store = useStore();
const orgId = computed(() => store.state.selectedOrganization.identifier);

const presets = ref<PresetDescriptor[]>([]);
const loading = ref(false);
const chosen = ref<PresetDescriptor | null>(null);
const applying = ref(false);
const applyError = ref("");
const confirmReplace = ref(false);

/// One flat model keyed by field name; groups hold arrays of row objects.
/// Kept as plain wire values so `apply` is a spread, not a translation.
const model = ref<Record<string, unknown>>({});

const memberOptions = computed(() =>
  props.members.map((m) => ({ label: raw(m.user_email), value: m.user_email })),
);

watch(
  open,
  (isOpen) => {
    if (isOpen && !presets.value.length) fetchPresets();
    if (!isOpen) {
      chosen.value = null;
      applyError.value = "";
    }
  },
  // A drawer can be MOUNTED open; without this the catalogue never loads.
  { immediate: true },
);

async function fetchPresets() {
  loading.value = true;
  try {
    const res = await oncallService.listSchedulePresets({ org_identifier: orgId.value });
    presets.value = res.data ?? [];
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

function choose(preset: PresetDescriptor) {
  chosen.value = preset;
  applyError.value = "";
  const next: Record<string, unknown> = {};
  for (const input of preset.inputs) {
    if (input.kind === "group_list") {
      // Start at the catalogue's own minimum — the form opens valid-shaped.
      next[input.field] = Array.from({ length: input.min ?? 1 }, () => emptyGroup(input));
    } else if (input.kind === "group") {
      next[input.field] = emptyGroup(input);
    } else if (input.default !== undefined) {
      next[input.field] = input.default;
    }
  }
  model.value = next;
}

function groupsOf(input: PresetInput): Record<string, unknown>[] {
  return model.value[input.field] as Record<string, unknown>[];
}
function groupOf(input: PresetInput): Record<string, unknown> {
  return model.value[input.field] as Record<string, unknown>;
}

async function apply() {
  if (!chosen.value) return;
  applying.value = true;
  applyError.value = "";
  try {
    // Absent beats empty: a field the user never touched is the server's to
    // default — `timezone` absent means the TEAM's zone, never UTC.
    const body: Record<string, unknown> & { preset: string } = { preset: chosen.value.id };
    for (const [key, value] of Object.entries(model.value)) {
      if (value !== undefined && value !== "" && value !== null) body[key] = value;
    }
    await oncallService.applySchedulePreset({
      org_identifier: orgId.value,
      team_id: props.teamId,
      data: body,
    });
    toast({ variant: "success", message: t("oncall.presetsApplied") });
    open.value = false;
    emit("applied");
  } catch (err: any) {
    // Named-field validation, written for the person who typed the value.
    applyError.value = String(err?.response?.data?.message ?? err?.message ?? "");
  } finally {
    applying.value = false;
  }
}

/// One control per catalogue kind. A functional child rather than a separate
/// file because it is meaningless outside this drawer, and the drawer is the
/// unit a fifth preset has to work in unaided.
const PresetField = defineComponent({
  name: "OnCallPresetField",
  props: {
    input: { type: Object as PropType<PresetInput>, required: true },
    model: { type: Object as PropType<Record<string, unknown>>, required: true },
    memberOptions: {
      type: Array as PropType<{ label: I18nText; value: string }[]>,
      required: true,
    },
  },
  setup(fieldProps) {
    const HALF_HOURS = Array.from({ length: 48 }, (_, i) => {
      const minutes = i * 30;
      const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
      const mm = String(minutes % 60).padStart(2, "0");
      return { label: raw(`${hh}:${mm}`), value: minutes };
    });
    // 1440 is "until end of day" — end_minute's exclusive bound.
    const MINUTES = [...HALF_HOURS, { label: raw("24:00"), value: 1440 }];
    const DAYS = [
      gt("oncall.day_mon"), gt("oncall.day_tue"), gt("oncall.day_wed"), gt("oncall.day_thu"),
      gt("oncall.day_fri"), gt("oncall.day_sat"), gt("oncall.day_sun"),
    ].map((label, value) => ({ label, value }));
    const DURATIONS = [1, 2, 3, 7, 14].map((days) => ({
      label: gt("oncall.durationDays", { count: days }, days),
      value: days * 86_400_000_000,
    }));
    const zones = (Intl as { supportedValuesOf?: (k: string) => string[] })
      .supportedValuesOf?.("timeZone") ?? ["UTC"];
    const ZONES = zones.map((z) => ({ label: raw(z), value: z }));

    return () => {
      const { input, model, memberOptions } = fieldProps;
      const bind = {
        label: raw(input.label),
        helpText: raw(input.description),
        modelValue: model[input.field] as never,
        "onUpdate:modelValue": (v: unknown) => (model[input.field] = v),
        "data-test": `oncall-preset-field-${input.field}`,
      };
      switch (input.kind) {
        case "member_list":
          return h(OSelect, { ...bind, options: memberOptions, multiple: true, searchable: true });
        case "minute_of_day":
          return h(OSelect, { ...bind, options: MINUTES });
        case "timezone":
          return h(OSelect, { ...bind, options: ZONES, searchable: true });
        case "day_of_week":
          return h(OSelect, { ...bind, options: DAYS });
        case "day_list":
          return h(OSelect, { ...bind, options: DAYS, multiple: true });
        case "duration_micros":
          return h(OSelect, { ...bind, options: DURATIONS });
        default:
          return h(OInput, bind);
      }
    };
  },
});
</script>
