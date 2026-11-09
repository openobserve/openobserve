<!-- Copyright 2026 OpenObserve Inc.
SPDX-License-Identifier: AGPL-3.0-or-later -->

<!-- A rule that cannot compile against the stream is refused, never saved to silently never fire. -->
<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onUnmounted, ref, watch } from "vue";
import { raw, useI18nTyped } from "@/types/i18n";
import { useRouter } from "vue-router";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import { firstFieldError } from "@/lib/forms/Form/fieldError";
import { useOForm } from "@/lib/forms/Form/useOForm";
import OTag from "@/lib/core/Badge/OTag.vue";
import OCode from "@/lib/core/Code/OCode.vue";
import ORadio from "@/lib/forms/Radio/ORadio.vue";
import ORadioGroup from "@/lib/forms/Radio/ORadioGroup.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import alertsService from "@/services/alerts";
import analytics from "@/services/product_analytics";
import { invalidateSiemDetections } from "@/composables/security/useSiemDetections";
import destinationService from "@/services/alert_destination";
import streamService from "@/services/stream";
import { toast } from "@/lib/feedback/Toast/useToast";
import { bestMatch } from "@/utils/security/classify";
import { SOURCE_TYPE_BY_ID, sigmaLogsourceLabel } from "@/utils/security/sourceTypes";
import {
  blockedReason,
  caveat,
  compileForSource,
  matchesLogsource,
  ocsfProfileFor,
  parseSigmaRule,
  ruleAppliesTo,
  sigmaCatalog,
  type SigmaRule,
} from "@/utils/security/sigma";
import { buildDetectionAlert, detectionAlertName } from "@/utils/security/detection";
import { severityTagValue, toneLabelKey, toneOfSigmaLevel } from "@/utils/security/severity";
import {
  makeNewDetectionSchema,
  newDetectionDefaults,
  toMinutes,
  type NewDetectionForm,
} from "./SecurityNewDetectionDialog.schema";

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

const { t } = useI18nTyped();
const FORM_ID = "security-detections-new-form";

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
  // The catalog's compile, so a pasted rule gets the source's field map and the OCSF bridge.
  return compileForSource(rule, draftSource.value, streamFields.value);
});

/** A rule for another log kind may still compile on shared field names, so this warns, not blocks. */
const logsourceMismatch = computed(() => {
  const rule = draftRule.value;
  const source = draftSource.value;
  if (!rule || !source || ruleAppliesTo(rule, source)) return "";
  return t("siem.detections.logsourceMismatch", {
    rule: sigmaLogsourceLabel(rule.logsource),
    stream: pickedStream.value,
    source: source.label,
  });
});

/** Set when an OCSF stream runs the rule through the OCSF bridge. */
const ocsfBridge = computed(() => {
  const rule = draftRule.value;
  if (!rule || draftSource.value?.id !== "ocsf_native") return null;
  // Rules written for OCSF itself need no bridge.
  if (matchesLogsource(rule, draftSource.value.sigma)) return null;
  return ocsfProfileFor(rule);
});

/** The bridge's whole guard, in words: class, and activity or product when set. */
const ocsfBridgeText = computed(() => {
  const profile = ocsfBridge.value;
  if (!profile) return "";
  const guard = [t("siem.detections.ocsfGuard.class", { uid: profile.classUid })];
  if (profile.activityId !== undefined)
    guard.push(t("siem.detections.ocsfGuard.activity", { id: profile.activityId }));
  if (profile.product)
    guard.push(t("siem.detections.ocsfGuard.product", { name: profile.product }));
  return t("siem.detections.ocsfBridge", { stream: pickedStream.value, guard: guard.join(", ") });
});

const draftReady = computed(
  () => !!draftRule.value && !!draftCompiled.value?.runnable && !!pickedStream.value,
);
const draftName = computed(() =>
  draftReady.value && draftRule.value
    ? detectionAlertName(draftRule.value.title, pickedStream.value)
    : "",
);

const form = useOForm<NewDetectionForm>({
  defaultValues: newDetectionDefaults(),
  schema: makeNewDetectionSchema(t, () => props.existingNames ?? []),
  onSubmit: save,
});
// The name is derived from the rule and stream, so it is fed into the form for the taken-name check.
watch(draftName, (name) => form.setFieldValue("name", name), { immediate: true });

async function loadStreams() {
  try {
    const res = await streamService.nameList(props.orgId, "logs", false);
    streams.value = (res.data?.list ?? []).map((s: any) => String(s.name));
  } catch {
    streams.value = [];
  }
}

let destinationsSeq = 0;
async function loadDestinations() {
  // Focus and Refresh can overlap; only the latest answer lands, and a failure keeps the last list.
  const seq = ++destinationsSeq;
  try {
    const res = await destinationService.list({
      org_identifier: props.orgId,
      page_num: 1,
      page_size: 1000,
      sort_by: "name",
      desc: false,
      module: "alert",
    });
    if (seq !== destinationsSeq) return;
    const list = res.data?.list ?? res.data ?? [];
    destinations.value = (Array.isArray(list) ? list : []).map((d: any) => String(d.name));
    if (destinations.value.length === 1 && !pickedDestinations.value.length) {
      pickedDestinations.value = [...destinations.value];
    }
  } catch {
    if (seq === destinationsSeq && !destinationsLoaded.value) destinations.value = [];
  } finally {
    if (seq === destinationsSeq) destinationsLoaded.value = true;
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

// The alerts API needs a destination; one made in a new tab is re-read on focus, keeping the dialog open.
const router = useRouter();
function createDestination() {
  const { href } = router.resolve({
    name: "alertDestinations",
    query: { org_identifier: props.orgId, action: "add" },
  });
  window.open(href, "_blank", "noopener");
}
const onFocus = () => {
  if (props.open && destinationsLoaded.value && !destinations.value.length) void loadDestinations();
};
window.addEventListener("focus", onFocus);
onUnmounted(() => window.removeEventListener("focus", onFocus));

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
      // The dialog may still be rendering, so look for the picked rule's row for a few frames.
      const id = preset.sigmaId;
      const selector = `[data-test="security-detections-new-rule-${CSS.escape(id)}"]`;
      const reveal = (tries: number) => {
        const row = document.querySelector(selector);
        if (row) row.scrollIntoView({ block: "nearest" });
        else if (tries > 0) requestAnimationFrame(() => reveal(tries - 1));
      };
      void nextTick(() => reveal(30));
    }
    presetStream = preset?.stream ?? "";
    presetSource.value =
      preset?.stream && preset?.source && SOURCE_TYPE_BY_ID.has(preset.source) ? preset.source : "";
    if (preset?.stream) pickedStream.value = preset.stream;
  },
  { immediate: true },
);

async function save(value: NewDetectionForm) {
  const rule = draftRule.value;
  const compiled = draftCompiled.value;
  if (!rule || !compiled?.runnable || !pickedStream.value || !pickedDestinations.value.length)
    return;
  const payload = buildDetectionAlert({
    rule,
    where: compiled.where,
    fields: compiled.fields,
    stream: pickedStream.value,
    destinations: pickedDestinations.value,
    sourceType: draftSource.value?.id ?? "",
    period: toMinutes(value.period),
    frequency: toMinutes(value.frequency),
    silence: toMinutes(value.silence),
  });
  try {
    await alertsService.create_by_alert_id(props.orgId, payload);
    analytics.track("security_detection_created", {
      mode: mode.value,
      source_type: draftSource.value?.id ?? "unknown",
      mitre_techniques: rule.techniques.length,
      from_preset: !!props.preset?.sigmaId,
    });
    invalidateSiemDetections(props.orgId);
    toast({ variant: "success", message: t("siem.detections.created", { name: payload.name }) });
    emit("created", payload.name);
    emit("update:open", false);
  } catch (e: any) {
    toast({
      variant: "error",
      message: e?.response?.data?.message ?? t("siem.detections.createFailed"),
    });
  }
}

const streamOptions = computed(() => streams.value.map((s) => ({ label: raw(s), value: s })));
const destinationOptions = computed(() =>
  destinations.value.map((d) => ({ label: raw(d), value: d })),
);
</script>

<template>
  <ODialog
    :open="open"
    size="xl"
    :title="t('siem.detections.newTitle')"
    :sub-title="t('siem.detections.newSubtitle')"
    :primary-button-label="t('siem.detections.create')"
    :secondary-button-label="t('siem.detections.cancel')"
    :form-id="FORM_ID"
    :primary-button-disabled="!draftReady || !pickedDestinations.length"
    data-test="security-detections-new-dialog"
    @update:open="(v: boolean) => emit('update:open', v)"
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
        <template #actions>
          <OButton
            variant="outline"
            size="sm"
            icon-right="open-in-new"
            :aria-label="t('siem.detections.createDestinationAria')"
            data-test="security-detections-new-create-destination"
            @click="createDestination"
            >{{ t("siem.detections.createDestination") }}</OButton
          >
          <OButton
            variant="ghost"
            size="sm"
            icon-left="refresh"
            data-test="security-detections-new-reload-destinations"
            @click="loadDestinations"
            >{{ t("siem.detections.reloadDestinations") }}</OButton
          >
        </template>
      </OBanner>

      <OForm :id="FORM_ID" :form="form" class="grid grid-cols-1 gap-3 md:grid-cols-3">
        <OFormInput
          name="period"
          type="number"
          :label="t('siem.detections.lookBack')"
          data-test="security-detections-new-period"
        />
        <OFormInput
          name="frequency"
          type="number"
          :label="t('siem.detections.runEvery')"
          data-test="security-detections-new-frequency"
        />
        <OFormInput
          name="silence"
          type="number"
          :label="t('siem.detections.silence')"
          data-test="security-detections-new-silence"
        />
      </OForm>

      <OBanner
        v-if="logsourceMismatch"
        variant="warning"
        icon="warning-amber"
        dense
        data-test="security-detections-new-logsource-mismatch"
      >
        {{ logsourceMismatch }}
      </OBanner>
      <OBanner
        v-else-if="ocsfBridge && draftCompiled?.runnable"
        variant="info"
        icon="info-outline"
        dense
        data-test="security-detections-new-ocsf-bridge"
      >
        {{ ocsfBridgeText }}
      </OBanner>

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

      <component :is="form.Field" name="name">
        <template #default="{ field }">
          <OBanner
            v-if="field.state.meta.errors.length > 0"
            variant="error-soft"
            icon="error-outline"
            dense
            data-test="security-detections-new-name-taken"
          >
            {{ firstFieldError(field.state.meta.errors) }}
          </OBanner>
        </template>
      </component>
    </div>
  </ODialog>
</template>
