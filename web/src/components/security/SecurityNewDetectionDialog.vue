<!-- Copyright 2026 OpenObserve Inc.
SPDX-License-Identifier: AGPL-3.0-or-later -->

<!-- A rule that cannot compile against the stream is refused, never saved to silently never fire. -->
<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onUnmounted, ref, watch } from "vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { useRouter } from "vue-router";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OFormCheckbox from "@/lib/forms/Checkbox/OFormCheckbox.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import { firstFieldError } from "@/lib/forms/Form/fieldError";
import { useOForm } from "@/lib/forms/Form/useOForm";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OCode from "@/lib/core/Code/OCode.vue";
import ORadio from "@/lib/forms/Radio/ORadio.vue";
import ORadioGroup from "@/lib/forms/Radio/ORadioGroup.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import { useDetectionPreview } from "@/composables/security/useDetectionPreview";
import alertsService from "@/services/alerts";
import analytics from "@/services/product_analytics";
import { detectionFolderId, detectionSaveFailure } from "@/utils/security/detectionFolder";
import { invalidateSiemDetections } from "@/composables/security/useSiemDetections";
import { useSecurityAccess } from "@/composables/security/useSecurityAccess";
import destinationService from "@/services/alert_destination";
import streamService from "@/services/stream";
import { toast } from "@/lib/feedback/Toast/useToast";
import { sourceMatchQuery, sourceTypesQuery } from "@/services/securitySources.queries";
import { useQuery } from "@tanstack/vue-query";
import { blockedReason, caveat } from "@/utils/security/compileText";
import securitySigma, {
  type CatalogRule,
  type CompiledSigma,
  type SigmaCompileRequest,
} from "@/services/securitySigma";
import { sigmaCatalogQuery, sigmaCompileQuery } from "@/services/securitySigma.queries";
import { buildDetectionAlert } from "@/utils/security/detection";
import { severityTagValue, toneLabelKey, toneOfSigmaLevel } from "@/utils/security/severity";
import {
  BACKFILL_HOURS,
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
// Defence in depth: the server refuses a detection write without the Security create grant too.
const { canAuthor } = useSecurityAccess();
const shown = computed(() => props.open && canAuthor.value);

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
/** Column types from the schema, so a quoted number is compared the way the column stores it. */
const streamFieldTypes = ref<Record<string, string>>({});
/** The stream `streamFields` were loaded for; compile only when it is the picked one. */
const fieldsStream = ref("");
const destinations = ref<string[]>([]);
const destinationsLoaded = ref(false);
const pickedDestinations = ref<string[]>([]);
/** The Events page's classification, preferred over re-deciding from a schema. */
const presetSource = ref("");

const catalogQuery = useQuery(() => ({
  ...sigmaCatalogQuery(props.orgId),
  enabled: shown.value && !!props.orgId,
}));
const catalog = computed<CatalogRule[]>(() => catalogQuery.data.value?.rules ?? []);
const catalogMatches = computed(() => {
  const needle = catalogFilter.value.trim().toLowerCase();
  if (!needle) return catalog.value;
  return catalog.value.filter(
    (rule) =>
      rule.title.toLowerCase().includes(needle) ||
      rule.techniques.some((tech) => tech.toLowerCase().includes(needle)) ||
      rule.logsourceLabel.toLowerCase().includes(needle),
  );
});

/** The pasted rule as last typed, settled so the server compiles a pause, not every keystroke. */
const settledYaml = ref(customYaml.value);
let yamlTimer: ReturnType<typeof setTimeout> | undefined;
watch(customYaml, (text) => {
  clearTimeout(yamlTimer);
  yamlTimer = setTimeout(() => (settledYaml.value = text), 300);
});
onUnmounted(() => clearTimeout(yamlTimer));

const sourceTypes = useQuery(() => ({
  ...sourceTypesQuery(props.orgId),
  enabled: shown.value && !!props.orgId,
}));
const sourceById = computed(() => new Map((sourceTypes.data.value ?? []).map((s) => [s.id, s])));
const fieldsMatch = useQuery(() => ({
  ...sourceMatchQuery(props.orgId, streamFields.value),
  enabled: shown.value && !!props.orgId && !!streamFields.value.length && !presetSource.value,
}));
const draftSource = computed(() => {
  if (presetSource.value) return sourceById.value.get(presetSource.value) ?? null;
  return streamFields.value.length
    ? (fieldsMatch.data.value?.classification?.source ?? null)
    : null;
});

/** Columns are only offered once they belong to the picked stream. */
const fieldsReady = computed(
  () => !!streamFields.value.length && fieldsStream.value === pickedStream.value,
);

/** The server compiles the rule (a pasted one is parsed there too) for the picked stream. */
const compileRequest = computed<SigmaCompileRequest | null>(() => {
  const rule =
    mode.value === "library"
      ? pickedRuleId.value
        ? { rule_id: pickedRuleId.value }
        : null
      : settledYaml.value.trim()
        ? { rule_yaml: settledYaml.value }
        : null;
  if (!rule) return null;
  if (!fieldsReady.value) return { ...rule, fields: [] };
  return {
    ...rule,
    source_type: draftSource.value?.id,
    stream: pickedStream.value,
    fields: streamFields.value,
    field_types: streamFieldTypes.value,
  };
});
const compileQuery = useQuery(() => ({
  ...sigmaCompileQuery(props.orgId, compileRequest.value ?? {}),
  enabled: shown.value && !!props.orgId && !!compileRequest.value,
}));
const compileResult = computed(() =>
  compileRequest.value ? (compileQuery.data.value ?? null) : null,
);

// The source's whole pack compiled for the picked stream, so the library marks what cannot run there yet.
const packQuery = useQuery(() => ({
  ...sigmaCompileQuery(props.orgId, {
    source_type: draftSource.value?.id,
    stream: pickedStream.value,
    fields: streamFields.value,
    field_types: streamFieldTypes.value,
  }),
  enabled: shown.value && !!props.orgId && fieldsReady.value && !!draftSource.value,
}));
const packCompiled = computed(() => {
  const map = new Map<string, CompiledSigma>();
  if (!fieldsReady.value || !draftSource.value) return map;
  for (const { key, compiled } of packQuery.data.value?.applicable ?? []) map.set(key, compiled);
  return map;
});
/** A rule that applies to the picked stream's source but cannot run on its columns yet. */
const notRunnableYet = (key: string) => {
  const compiled = packCompiled.value.get(key);
  return compiled && !compiled.runnable ? compiled : null;
};

const draftRule = computed<CatalogRule | null>(() => {
  if (mode.value === "library") {
    return catalog.value.find((rule) => rule.key === pickedRuleId.value) ?? null;
  }
  return compileResult.value?.rule ?? null;
});

const customError = computed(() =>
  mode.value === "custom" ? (compileResult.value?.parseError ?? "") : "",
);

const draftCompiled = computed(() => {
  if (!draftRule.value || !fieldsReady.value) return null;
  return compileResult.value?.compiled ?? null;
});

/** The server-built detection SQL for the picked rule, from its own compile or the pack's. */
const draftServerSql = computed(() => {
  if (!draftRule.value || !draftCompiled.value) return undefined;
  return draftCompiled.value.sql || packCompiled.value.get(draftRule.value.key)?.sql || undefined;
});

/** The picked correlation compiled for the picked stream; null for a single-event rule. */
const draftCorrelation = computed(() => {
  if (!draftRule.value?.correlation || !draftCompiled.value || !pickedStream.value) return null;
  return compileResult.value?.correlation ?? null;
});

/** A rule for another log kind may still compile on shared field names, so this warns, not blocks. */
const logsourceMismatch = computed(() => {
  const rule = draftRule.value;
  const source = draftSource.value;
  if (!rule || !source || !draftCompiled.value || compileResult.value?.applies !== false) return "";
  return t("siem.detections.logsourceMismatch", {
    rule: rule.logsourceLabel,
    stream: pickedStream.value,
    source: source.label,
  });
});

/** Columns the rule reads that no event has carried yet; saving creates them so the rule is armed. */
const unseenFields = computed(() =>
  draftCompiled.value?.runnable ? (draftCompiled.value.unseenFields ?? []) : [],
);
const unseenText = computed(() =>
  unseenFields.value.length
    ? t("siem.detections.unseenFields", {
        fields: unseenFields.value.map((f) => f.name).join(", "),
      })
    : "",
);

/** Set when an OCSF stream runs the rule through the OCSF bridge. */
const ocsfBridge = computed(() =>
  draftRule.value && draftCompiled.value ? (compileResult.value?.ocsfBridge ?? null) : null,
);

/** The bridge's whole guard, in words: class, and activity or product when set. */
const ocsfBridgeText = computed(() => {
  const profile = ocsfBridge.value;
  if (!profile) return "";
  const guard = [t("siem.detections.ocsfGuard.class", { uid: profile.classUid })];
  if (profile.activityId != null)
    guard.push(t("siem.detections.ocsfGuard.activity", { id: profile.activityId }));
  if (profile.product)
    guard.push(t("siem.detections.ocsfGuard.product", { name: profile.product }));
  return t("siem.detections.ocsfBridge", { stream: pickedStream.value, guard: guard.join(", ") });
});

/** The alert as it would be sent; timing comes from the form at submit. */
function buildDraft(
  timing: { period?: number; frequency?: number; silence?: number; backfillMinutes?: number } = {},
) {
  const rule = draftRule.value;
  const compiled = draftCompiled.value;
  if (!rule || !compiled?.runnable || !pickedStream.value) return null;
  const correlation = draftCorrelation.value;
  if (rule.correlation && !correlation?.runnable) return null;
  return buildDetectionAlert({
    rule,
    where: compiled.where,
    fields: compiled.fields,
    stream: pickedStream.value,
    destinations: pickedDestinations.value,
    sourceType: draftSource.value?.id ?? "",
    ...timing,
    correlation: correlation ?? undefined,
    sql: draftServerSql.value,
  });
}
const draftPayload = computed(() => buildDraft());
const draftReady = computed(() => !!draftPayload.value);
const draftName = computed<string>(() => draftPayload.value?.name ?? "");

const form = useOForm<NewDetectionForm>({
  defaultValues: newDetectionDefaults(),
  schema: makeNewDetectionSchema(
    t,
    () => props.existingNames ?? [],
    () => draftRule.value?.timespanMinutes,
  ),
  onSubmit: save,
});
// The name is derived from the rule and stream, so it is fed into the form for the taken-name check.
watch(draftName, (name) => form.setFieldValue("name", name), { immediate: true });

// The look-back stays editable, but a correlation's starts at its timespan so one run sees a whole window.
watch(
  () => draftRule.value?.timespanMinutes,
  (minutes) => {
    if (!minutes) return;
    if (toMinutes(form.getFieldValue("period")) < minutes) form.setFieldValue("period", minutes);
  },
);
const backfillChosen = form.useStore((s: { values: NewDetectionForm }) => !!s.values.backfill);
const backfillOptions = BACKFILL_HOURS.map((hours) => ({
  label: t("siem.detections.backfillHours", { n: hours }, hours),
  value: hours,
}));

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
  streamFieldTypes.value = {};
  fieldsStream.value = "";
  if (!name) return;
  try {
    const res = await streamService.schema(props.orgId, name, "logs");
    if (seq !== fieldsSeq || pickedStream.value !== name) return;
    const schema: any[] = res.data?.schema ?? [];
    streamFields.value = schema.map((f) => String(f.name));
    streamFieldTypes.value = Object.fromEntries(
      schema.filter((f) => f.type).map((f) => [String(f.name), String(f.type)]),
    );
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
  shown,
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
    presetSource.value = preset?.stream && preset?.source ? preset.source : "";
    if (preset?.stream) pickedStream.value = preset.stream;
  },
  { immediate: true },
);

// A 403 carries the reason, such as a missing Security permission, so it is shown as sent.
function createErrorMessage(e: unknown) {
  const { reason, forbidden } = detectionSaveFailure(e);
  if (reason) return raw(reason);
  return forbidden ? t("siem.detections.createForbidden") : t("siem.detections.createFailed");
}

const preview = useDetectionPreview();
const draftSql = computed<string>(() => draftPayload.value?.query_condition?.sql ?? "");
const queryFailure = ref("");
/** The server's refusal of the last save, such as SQL that cannot plan or a duplicate name. */
const saveFailure = ref<I18nText | "">("");
watch(draftPayload, () => {
  saveFailure.value = "";
});
watch(draftSql, () => {
  preview.reset();
  queryFailure.value = "";
});
const previewCurrent = computed(
  () => !!draftSql.value && preview.previewedSql.value === draftSql.value,
);
function runPreview() {
  // The query names columns the stream does not have yet, and no event can match them anyway.
  if (!draftSql.value || unseenFields.value.length) return;
  // A correlation counts within its own timespan, so its preview covers exactly one.
  const minutes = draftCorrelation.value?.timespanMinutes;
  void preview.preview(
    props.orgId,
    draftSql.value,
    Date.now(),
    minutes ? minutes * 60_000 : undefined,
  );
}
type PreviewRow = Record<string, unknown>;
const previewColumns = computed<OTableColumnDef<PreviewRow>[]>(() => {
  // A correlation returns one row per group, so its columns are whatever the query projects.
  if (draftCorrelation.value) {
    const first = preview.rows.value[0] ?? {};
    return Object.keys(first).map((field) => ({
      id: field,
      header: raw(field),
      accessorKey: field,
      size: 180,
    }));
  }
  // The server's SQL may project columns beyond the matched fields, such as host and user.
  const fields = draftServerSql.value
    ? Object.keys(preview.rows.value[0] ?? {})
    : (draftCompiled.value?.fields ?? []);
  return [
    {
      id: "_timestamp",
      header: t("siem.detections.preview.time"),
      accessorKey: "_timestamp",
      size: 170,
    },
    ...fields
      .filter((field) => field !== "_timestamp")
      .map((field) => ({ id: field, header: raw(field), accessorKey: field, size: 200 })),
  ];
});

async function save(value: NewDetectionForm) {
  const payload = buildDraft({
    period: toMinutes(value.period),
    frequency: toMinutes(value.frequency),
    silence: toMinutes(value.silence),
    backfillMinutes: value.backfill ? toMinutes(value.backfillHours) * 60 : 0,
  });
  if (!payload || !canAuthor.value) return;
  queryFailure.value = "";
  saveFailure.value = "";
  try {
    if (unseenFields.value.length) {
      await securitySigma.addColumns(props.orgId, pickedStream.value, unseenFields.value);
    }
    // The alerts API stores SQL unchecked, and a query that cannot plan errors on every run.
    const failure = await preview.validate(props.orgId, payload.query_condition.sql);
    if (failure) {
      queryFailure.value = failure;
      toast({ variant: "error", message: t("siem.detections.queryFailed", { reason: failure }) });
      return;
    }
    const folderId = await detectionFolderId(props.orgId);
    // The dialog shows the server's 403 reason itself, so the access boundary stays quiet.
    await alertsService.create_by_alert_id(props.orgId, payload, folderId, {
      skipAccessToast: true,
    });
    analytics.track("security_detection_created", {
      mode: mode.value,
      source_type: draftSource.value?.id ?? "unknown",
      mitre_techniques: draftRule.value?.techniques.length ?? 0,
      from_preset: !!props.preset?.sigmaId,
    });
    invalidateSiemDetections(props.orgId);
    toast({ variant: "success", message: t("siem.detections.created", { name: payload.name }) });
    emit("created", payload.name);
    emit("update:open", false);
  } catch (e: any) {
    const message = createErrorMessage(e);
    saveFailure.value = message;
    toast({ variant: "error", message });
  }
}

const streamOptions = computed(() => streams.value.map((s) => ({ label: raw(s), value: s })));
const destinationOptions = computed(() =>
  destinations.value.map((d) => ({ label: raw(d), value: d })),
);
</script>

<template>
  <ODialog
    :open="shown"
    size="xl"
    :title="t('siem.detections.newTitle')"
    :sub-title="t('siem.detections.newSubtitle')"
    :primary-button-label="t('siem.detections.create')"
    :secondary-button-label="t('siem.detections.cancel')"
    :form-id="FORM_ID"
    :primary-button-disabled="!draftReady || !canAuthor"
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
              :key="rule.key"
              :value="rule.key"
              class="w-full py-1"
              :data-test="`security-detections-new-rule-${rule.key}`"
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
                    rule.logsourceLabel
                  }}</span>
                  <span
                    v-if="notRunnableYet(rule.key)"
                    class="inline-flex shrink-0"
                    :data-test="`security-detections-new-not-runnable-${rule.key}`"
                  >
                    <OTag variant="default-soft" icon="hourglass-empty" size="xs">{{
                      t("siem.content.notRunnableYet")
                    }}</OTag>
                    <OTooltip :content="blockedReason(notRunnableYet(rule.key)!)" />
                  </span>
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
        variant="info"
        icon="info"
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
        <OInput
          v-if="draftRule?.timespanMinutes"
          :model-value="String(draftRule.timespanMinutes)"
          :label="t('siem.detections.correlationWindowLabel')"
          :help-text="t('siem.detections.correlationWindow')"
          readonly
          class="md:col-span-3"
          data-test="security-detections-new-correlation-window"
        />
        <OFormInput
          name="period"
          type="number"
          :label="t('siem.detections.lookBack')"
          :help-text="
            draftRule?.timespanMinutes
              ? t('siem.detections.lookBackHelp', { minutes: draftRule.timespanMinutes })
              : undefined
          "
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
        <OFormCheckbox
          name="backfill"
          :label="t('siem.detections.backfill')"
          class="md:col-span-2"
          data-test="security-detections-new-backfill"
        />
        <OFormSelect
          v-if="backfillChosen"
          name="backfillHours"
          :options="backfillOptions"
          :label="t('siem.detections.backfillRange')"
          data-test="security-detections-new-backfill-range"
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
        v-if="unseenText"
        variant="info"
        icon="info-outline"
        dense
        data-test="security-detections-new-unseen-fields"
      >
        {{ unseenText }}
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
        </div>
      </OBanner>
      <div
        v-if="draftRule && pickedStream && draftCompiled"
        class="min-w-0"
        data-test="security-detections-new-compiled-sql"
      >
        <OCode v-if="draftCorrelation?.runnable" block>{{ draftCorrelation.sql }}</OCode>
        <OCode v-else-if="draftCompiled.where" block>{{ draftCompiled.where }}</OCode>
      </div>

      <div v-if="draftSql" class="flex flex-col gap-2" data-test="security-detections-new-preview">
        <div class="flex flex-wrap items-center gap-3">
          <OButton
            variant="outline"
            size="sm"
            icon-left="play-arrow"
            :loading="preview.running.value"
            data-test="security-detections-new-preview-run"
            @click="runPreview"
            >{{ t("siem.detections.preview.run") }}</OButton
          >
          <span class="text-text-secondary text-xs">{{
            previewCurrent && !preview.error.value && preview.rows.value.length
              ? t("siem.detections.preview.shown", {
                  shown: preview.rows.value.length,
                  total: preview.total.value,
                })
              : t("siem.detections.preview.hint")
          }}</span>
        </div>
        <OBanner
          v-if="queryFailure || (previewCurrent && preview.error.value)"
          variant="error-soft"
          icon="error-outline"
          dense
          data-test="security-detections-new-preview-error"
        >
          {{ t("siem.detections.preview.failed", { reason: queryFailure || preview.error.value }) }}
        </OBanner>
        <OEmptyState
          v-else-if="previewCurrent && !preview.running.value && !preview.rows.value.length"
          size="inline"
          icon="search-off"
          :title="t('siem.detections.preview.empty')"
          data-test="security-detections-new-preview-empty"
        />
        <div
          v-else-if="previewCurrent && preview.rows.value.length"
          class="border-border-default rounded-surface h-64 overflow-hidden border"
        >
          <OTable
            :data="preview.rows.value"
            :columns="previewColumns"
            pagination="none"
            sorting="none"
            :show-global-filter="false"
            :frame="false"
            class="h-full"
            data-test="security-detections-new-preview-table"
          >
            <template #cell-_timestamp="{ row }">
              <OTimeCell :value="Number(row._timestamp)" unit="us" />
            </template>
          </OTable>
        </div>
      </div>

      <OBanner
        v-if="saveFailure"
        variant="error-soft"
        icon="error-outline"
        dense
        data-test="security-detections-new-save-error"
      >
        {{ saveFailure }}
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
