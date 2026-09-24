<!-- Copyright 2026 OpenObserve Inc.
SPDX-License-Identifier: AGPL-3.0-or-later -->

<!-- New detection: pick a rule from the shipped Sigma library (or write one),
     choose the stream it runs on, and see — before anything is saved — whether
     it compiles against that stream's real columns. A rule that cannot run is
     refused with the reason, never saved as a detection that silently never
     fires. -->
<script setup lang="ts">
import { computed, defineAsyncComponent, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OCode from "@/lib/core/Code/OCode.vue";
import ORadio from "@/lib/forms/Radio/ORadio.vue";
import ORadioGroup from "@/lib/forms/Radio/ORadioGroup.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import alertsService from "@/services/alerts";
import destinationService from "@/services/alert_destination";
import streamService from "@/services/stream";
import { toast } from "@/lib/feedback/Toast/useToast";
import { bestMatch } from "@/utils/security/classify";
import { SOURCE_TYPE_BY_ID, sigmaLogsourceLabel } from "@/utils/security/sourceTypes";
import {
  blockedReason,
  caveat,
  compileSigmaRule,
  parseSigmaRule,
  sigmaCatalog,
  type SigmaRule,
} from "@/utils/security/sigma";
import { KEYWORD_FIELDS, SIGMA_FIELD_MAPS } from "@/utils/security/sigma/catalog";
import { buildDetectionAlert } from "@/utils/security/detection";
import { severityTagValue, toneLabelKey, toneOfSigmaLevel } from "@/utils/security/severity";

const CodeQueryEditor = defineAsyncComponent(() => import("@/components/CodeQueryEditor.vue"));

export interface NewDetectionPreset {
  sigmaId?: string;
  stream?: string;
  source?: string;
}

const props = defineProps<{
  open: boolean;
  orgId: string;
  preset?: NewDetectionPreset | null;
  /** Alert names already in the org; a detection may not reuse one. */
  existingNames?: string[];
}>();
const emit = defineEmits<{
  "update:open": [open: boolean];
  created: [name: string];
}>();

const { t } = useI18n();

const STARTER_YAML = `title: My Detection
status: experimental
description: Detects something worth waking up for.
logsource:
  product: aws
  service: cloudtrail
detection:
  selection:
    eventName: CreateAccessKey
  condition: selection
level: medium
tags:
  - attack.persistence
  - attack.t1098.001`;

const mode = ref<"library" | "custom">("library");
const catalogFilter = ref("");
const pickedRuleId = ref("");
const customYaml = ref(STARTER_YAML);

const streams = ref<string[]>([]);
const pickedStream = ref("");
const streamFields = ref<string[]>([]);
/** The stream `streamFields` were loaded for; compile only when it is the picked one. */
const fieldsStream = ref("");
const destinations = ref<string[]>([]);
const destinationsLoaded = ref(false);
const pickedDestinations = ref<string[]>([]);
const period = ref(15);
const frequency = ref(15);
const silence = ref(30);
const saving = ref(false);
/** The Events page's classification, preferred over re-deciding from a schema. */
const presetSource = ref("");

const catalog = computed(() => sigmaCatalog());
const catalogMatches = computed(() => {
  const needle = catalogFilter.value.trim().toLowerCase();
  if (!needle) return catalog.value;
  return catalog.value.filter(
    (rule) =>
      rule.title.toLowerCase().includes(needle) ||
      rule.techniques.some((tech) => tech.toLowerCase().includes(needle)) ||
      sigmaLogsourceLabel(rule.logsource).toLowerCase().includes(needle),
  );
});

const draftRule = computed<SigmaRule | null>(() => {
  if (mode.value === "library") {
    return catalog.value.find((rule) => rule.id === pickedRuleId.value) ?? null;
  }
  const parsed = parseSigmaRule(customYaml.value);
  return parsed.ok ? parsed.rule : null;
});

const customError = computed(() => {
  if (mode.value !== "custom") return "";
  const parsed = parseSigmaRule(customYaml.value);
  return parsed.ok ? "" : parsed.error.message;
});

const draftSource = computed(() => {
  if (presetSource.value) return SOURCE_TYPE_BY_ID.get(presetSource.value) ?? null;
  return streamFields.value.length ? (bestMatch(streamFields.value)?.source ?? null) : null;
});

const draftCompiled = computed(() => {
  const rule = draftRule.value;
  if (!rule || !streamFields.value.length || fieldsStream.value !== pickedStream.value) return null;
  const sourceId = draftSource.value?.id ?? "";
  return compileSigmaRule(rule, {
    fieldMap: SIGMA_FIELD_MAPS[sourceId],
    availableFields: streamFields.value,
    keywordFields:
      KEYWORD_FIELDS[sourceId] ??
      ["message", "log"].filter((f) => streamFields.value.some((name) => name.toLowerCase() === f)),
  });
});

/**
 * The payload as it would be sent, so the name can be checked before saving.
 * History joins firings to rules by name, so a reused name would merge two
 * detections' firings into one.
 */
const draftPayload = computed(() => {
  const rule = draftRule.value;
  const compiled = draftCompiled.value;
  if (!rule || !compiled?.runnable || !pickedStream.value) return null;
  return buildDetectionAlert({
    rule,
    where: compiled.where,
    fields: compiled.fields,
    stream: pickedStream.value,
    destinations: pickedDestinations.value,
    sourceType: draftSource.value?.id ?? "",
    period: Number(period.value),
    frequency: Number(frequency.value),
    silence: Number(silence.value),
  });
});
const nameTaken = computed(
  () => !!draftPayload.value && (props.existingNames ?? []).includes(draftPayload.value.name),
);

// A run looks back `period` minutes every `frequency` minutes; a period shorter
// than the frequency leaves minutes no run ever looks at.
const periodError = computed(() =>
  !(period.value > 0)
    ? t("siem.detections.validation.positive")
    : period.value < frequency.value
      ? t("siem.detections.validation.periodGap")
      : "",
);
const frequencyError = computed(() =>
  frequency.value > 0 ? "" : t("siem.detections.validation.positive"),
);
const silenceError = computed(() =>
  silence.value >= 0 ? "" : t("siem.detections.validation.nonNegative"),
);

const canSave = computed(
  () =>
    !!draftPayload.value &&
    pickedDestinations.value.length > 0 &&
    !nameTaken.value &&
    !periodError.value &&
    !frequencyError.value &&
    !silenceError.value &&
    !saving.value,
);

async function loadStreams() {
  try {
    const res = await streamService.nameList(props.orgId, "logs", false);
    streams.value = (res.data?.list ?? []).map((s: any) => String(s.name));
  } catch {
    streams.value = [];
  }
}

async function loadDestinations() {
  try {
    const res = await destinationService.list({
      org_identifier: props.orgId,
      page_num: 1,
      page_size: 1000,
      sort_by: "name",
      desc: false,
      module: "alert",
    });
    const list = res.data?.list ?? res.data ?? [];
    destinations.value = (Array.isArray(list) ? list : []).map((d: any) => String(d.name));
    // One destination is the common case; pre-picking it saves a click without
    // hiding the choice.
    if (destinations.value.length === 1 && !pickedDestinations.value.length) {
      pickedDestinations.value = [...destinations.value];
    }
  } catch {
    destinations.value = [];
  } finally {
    destinationsLoaded.value = true;
  }
}

let fieldsSeq = 0;
async function loadStreamFields(name: string) {
  const seq = ++fieldsSeq;
  // Cleared first: the previous stream's columns must never compile this one.
  streamFields.value = [];
  fieldsStream.value = "";
  if (!name) return;
  try {
    const res = await streamService.schema(props.orgId, name, "logs");
    if (seq !== fieldsSeq || pickedStream.value !== name) return;
    streamFields.value = (res.data?.schema ?? []).map((f: any) => String(f.name));
    fieldsStream.value = name;
  } catch {
    /* no fields → nothing compiles, and Save stays off */
  }
}

/** The stream the preset's classification describes. */
let presetStream = "";
watch(pickedStream, (name) => {
  // The preset described the stream Events sent over; a different pick voids it.
  if (name !== presetStream) presetSource.value = "";
  void loadStreamFields(name);
});

// Everything is (re)loaded on open, so a destination created meanwhile shows up.
watch(
  () => props.open,
  (open) => {
    if (!open) return;
    void loadStreams();
    void loadDestinations();
    const preset = props.preset;
    if (preset?.sigmaId) {
      mode.value = "library";
      pickedRuleId.value = preset.sigmaId;
      catalogFilter.value = "";
    }
    presetStream = preset?.stream ?? "";
    presetSource.value =
      preset?.stream && preset?.source && SOURCE_TYPE_BY_ID.has(preset.source) ? preset.source : "";
    if (preset?.stream) pickedStream.value = preset.stream;
  },
  { immediate: true },
);

async function save() {
  const payload = draftPayload.value;
  if (!payload || !canSave.value) return;
  saving.value = true;
  try {
    await alertsService.create_by_alert_id(props.orgId, payload);
    toast({ variant: "success", message: t("siem.detections.created", { name: payload.name }) });
    emit("created", payload.name);
    emit("update:open", false);
  } catch (e: any) {
    toast({
      variant: "error",
      message: e?.response?.data?.message ?? t("siem.detections.createFailed"),
    });
  } finally {
    saving.value = false;
  }
}

const streamOptions = computed(() => streams.value.map((s) => ({ label: s, value: s })));
const destinationOptions = computed(() => destinations.value.map((d) => ({ label: d, value: d })));
const toNumber = (v: string | number) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
</script>

<template>
  <ODialog
    :open="open"
    size="xl"
    :title="t('siem.detections.newTitle')"
    :sub-title="t('siem.detections.newSubtitle')"
    :primary-button-label="t('siem.detections.create')"
    :secondary-button-label="t('siem.detections.cancel')"
    :primary-button-disabled="!canSave"
    :primary-button-loading="saving"
    data-test="security-detections-new-dialog"
    @update:open="(v: boolean) => emit('update:open', v)"
    @click:primary="save"
    @click:secondary="emit('update:open', false)"
  >
    <div class="flex flex-col gap-4">
      <OToggleGroup
        :model-value="mode"
        data-test="security-detections-new-mode"
        @update:model-value="(v: unknown) => (mode = v === 'custom' ? 'custom' : 'library')"
      >
        <OToggleGroupItem
          value="library"
          size="sm"
          icon-left="menu-book"
          data-test="security-detections-new-mode-library"
        >
          {{ t("siem.detections.library", { n: catalog.length }) }}
        </OToggleGroupItem>
        <OToggleGroupItem
          value="custom"
          size="sm"
          icon-left="code"
          data-test="security-detections-new-mode-custom"
        >
          {{ t("siem.detections.writeSigma") }}
        </OToggleGroupItem>
      </OToggleGroup>

      <template v-if="mode === 'library'">
        <OSearchInput
          v-model="catalogFilter"
          :placeholder="t('siem.detections.librarySearch')"
          data-test="security-detections-new-search"
        />
        <div
          class="border-border-default rounded-surface max-h-72 overflow-y-auto border px-3 py-2"
          data-test="security-detections-new-library"
        >
          <ORadioGroup
            :model-value="pickedRuleId"
            :label="t('siem.detections.library', { n: catalog.length })"
            orientation="vertical"
            @update:model-value="(v: unknown) => (pickedRuleId = String(v ?? ''))"
          >
            <ORadio
              v-for="rule in catalogMatches"
              :key="rule.id"
              :value="rule.id ?? ''"
              class="w-full py-1"
              :data-test="`security-detections-new-rule-${rule.id}`"
            >
              <template #label>
                <span class="flex min-w-0 items-center gap-2">
                  <OTag
                    type="severity"
                    :value="severityTagValue(toneOfSigmaLevel(rule.level))"
                    :label="t(toneLabelKey(toneOfSigmaLevel(rule.level)))"
                    size="xs"
                  />
                  <span class="text-text-heading truncate text-sm font-normal">{{
                    rule.title
                  }}</span>
                  <span class="text-text-secondary text-2xs shrink-0 font-mono font-normal">{{
                    sigmaLogsourceLabel(rule.logsource)
                  }}</span>
                </span>
              </template>
            </ORadio>
          </ORadioGroup>
          <OEmptyState
            v-if="!catalogMatches.length"
            size="inline"
            icon="search-off"
            :title="t('siem.detections.libraryEmpty')"
          />
        </div>
      </template>

      <template v-else>
        <div class="border-border-default rounded-default h-72 overflow-hidden border">
          <CodeQueryEditor
            editor-id="security-detections-sigma-editor"
            :query="customYaml"
            language="plaintext"
            :show-line-numbers="true"
            :show-auto-complete="false"
            :debounce-time="150"
            class="h-full"
            data-test="security-detections-new-yaml"
            @update:query="(q: string) => (customYaml = q)"
          />
        </div>
        <OBanner v-if="customError" variant="error-soft" icon="error-outline" dense>
          {{ customError }}
        </OBanner>
      </template>

      <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
        <OSelect
          :model-value="pickedStream"
          :options="streamOptions"
          :label="t('siem.detections.stream')"
          :placeholder="t('siem.detections.streamPlaceholder')"
          searchable
          data-test="security-detections-new-stream"
          @update:model-value="pickedStream = String($event ?? '')"
        />
        <OSelect
          :model-value="pickedDestinations"
          :options="destinationOptions"
          :label="t('siem.detections.notify')"
          :placeholder="t('siem.detections.notifyPlaceholder')"
          multiple
          data-test="security-detections-new-destinations"
          @update:model-value="pickedDestinations = (($event as string[]) ?? []).map(String)"
        />
      </div>

      <OBanner
        v-if="destinationsLoaded && !destinations.length"
        variant="warning"
        icon="warning-amber"
        dense
        data-test="security-detections-new-no-destination"
      >
        {{ t("siem.detections.noDestinations") }}
      </OBanner>

      <div class="grid grid-cols-1 gap-3 md:grid-cols-3">
        <OInput
          :model-value="period"
          type="number"
          :label="t('siem.detections.lookBack')"
          :error="!!periodError"
          :error-message="periodError"
          data-test="security-detections-new-period"
          @update:model-value="(v: string | number) => (period = toNumber(v))"
        />
        <OInput
          :model-value="frequency"
          type="number"
          :label="t('siem.detections.runEvery')"
          :error="!!frequencyError"
          :error-message="frequencyError"
          data-test="security-detections-new-frequency"
          @update:model-value="(v: string | number) => (frequency = toNumber(v))"
        />
        <OInput
          :model-value="silence"
          type="number"
          :label="t('siem.detections.silence')"
          :error="!!silenceError"
          :error-message="silenceError"
          data-test="security-detections-new-silence"
          @update:model-value="(v: string | number) => (silence = toNumber(v))"
        />
      </div>

      <!-- Whether it will run, decided before anything is saved -->
      <OBanner
        v-if="draftRule && pickedStream && draftCompiled"
        :variant="draftCompiled.runnable ? 'success' : 'warning'"
        :icon="draftCompiled.runnable ? 'check-circle-outline' : 'warning-amber'"
        data-test="security-detections-new-compile"
      >
        <div class="flex flex-col gap-1">
          <span class="font-semibold">
            <template v-if="draftCompiled.runnable">
              {{
                draftSource
                  ? t("siem.detections.compilesAs", {
                      stream: pickedStream,
                      source: draftSource.label,
                    })
                  : t("siem.detections.compiles", { stream: pickedStream })
              }}
            </template>
            <template v-else>{{ t("siem.detections.wontRun", { stream: pickedStream }) }}</template>
          </span>
          <span v-if="!draftCompiled.runnable">{{ blockedReason(draftCompiled) }}</span>
          <span v-else-if="caveat(draftCompiled)">{{ caveat(draftCompiled) }}</span>
          <OCode v-if="draftCompiled.where" block>{{ draftCompiled.where }}</OCode>
        </div>
      </OBanner>

      <OBanner
        v-if="nameTaken && draftPayload"
        variant="error-soft"
        icon="error-outline"
        dense
        data-test="security-detections-new-name-taken"
      >
        {{ t("siem.detections.nameTaken", { name: draftPayload.name }) }}
      </OBanner>
    </div>
  </ODialog>
</template>
