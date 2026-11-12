<!-- Copyright 2026 OpenObserve Inc.
SPDX-License-Identifier: AGPL-3.0-or-later -->

<!-- Every detection goes through the same server compile and builder as the new-detection dialog. -->
<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import { useOForm } from "@/lib/forms/Form/useOForm";
import OTag from "@/lib/core/Badge/OTag.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OProgressBar from "@/lib/data/ProgressBar/OProgressBar.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import alertsService from "@/services/alerts";
import commonService from "@/services/common";
import destinationService from "@/services/alert_destination";
import streamService from "@/services/stream";
import securitySigma from "@/services/securitySigma";
import type { CatalogRule } from "@/services/securitySigma";
import { normalizeCompileResponse } from "@/services/securitySigma.queries";
import { useDetectionPreview } from "@/composables/security/useDetectionPreview";
import { invalidateSiemDetections } from "@/composables/security/useSiemDetections";
import { useSecurityAccess } from "@/composables/security/useSecurityAccess";
import {
  DETECTIONS_FOLDER_NAME,
  detectionFolderId,
  detectionSaveFailure,
} from "@/utils/security/detectionFolder";
import { runBulkInstall, type BulkResult, type BulkTarget } from "@/utils/security/bulkInstall";
import { severityTagValue, toneLabelKey, toneOfSigmaLevel } from "@/utils/security/severity";
import { toMinutes } from "./SecurityNewDetectionDialog.schema";
import {
  bulkInstallDefaults,
  makeBulkInstallSchema,
  type BulkInstallForm,
} from "./SecurityBulkInstallDialog.schema";

export interface BulkRule {
  rule: CatalogRule;
  /** Streams the rule compiles on now. */
  runnable: string[];
}

export interface BulkStream {
  fields: string[];
  fieldTypes: Record<string, string>;
  sourceId: string | null;
}

const props = defineProps<{
  open: boolean;
  orgId: string;
  rules: BulkRule[];
  streams: Map<string, BulkStream>;
  /** Alert names already in the org; a detection may not reuse one. */
  existingNames: string[];
}>();
const emit = defineEmits<{
  "update:open": [open: boolean];
  done: [installed: number];
}>();

const { t } = useI18nTyped();
const FORM_ID = "security-content-bulk-install-form";
const { canAuthor } = useSecurityAccess();
const shown = computed(() => props.open && canAuthor.value);

// OSelect shows an empty string as no choice, so the defaults carry sentinel values.
const EVERY_STREAM = "__every_stream__";
const DEFAULT_FOLDER = "__security_detections__";
const stream = ref(EVERY_STREAM);
const folderId = ref(DEFAULT_FOLDER);
/** The batch size at confirm, so the title holds once the page clears its selection. */
const batchRules = ref(0);
const destinations = ref<string[]>([]);
const folders = ref<{ id: string; name: string }[]>([]);
const destinationNames = ref<string[]>([]);
const phase = ref<"configure" | "running" | "done">("configure");
const results = ref<(BulkResult | null)[]>([]);

const streamChoices = computed(() => [
  ...new Set(props.rules.flatMap((r) => r.runnable).filter((s) => props.streams.has(s))),
]);
const streamOptions = computed(() => [
  { label: t("siem.content.bulk.everyStream"), value: EVERY_STREAM },
  ...streamChoices.value.map((s) => ({ label: raw(s), value: s })),
]);
const folderOptions = computed(() => [
  { label: raw(DETECTIONS_FOLDER_NAME), value: DEFAULT_FOLDER },
  ...folders.value
    .filter((f) => f.name !== DETECTIONS_FOLDER_NAME)
    .map((f) => ({ label: raw(f.name), value: f.id })),
]);
const destinationOptions = computed(() =>
  destinationNames.value.map((d) => ({ label: raw(d), value: d })),
);

const targets = computed<BulkTarget[]>(() =>
  props.rules.flatMap(({ rule, runnable }) =>
    runnable
      .filter((s) => (stream.value === EVERY_STREAM || s === stream.value) && props.streams.has(s))
      .map((s) => {
        const info = props.streams.get(s)!;
        return {
          rule,
          stream: s,
          sourceType: info.sourceId ?? "",
          fields: info.fields,
          fieldTypes: info.fieldTypes,
        };
      }),
  ),
);
/** The targets of the running batch; the page's selection may change underneath it. */
const frozen = ref<BulkTarget[]>([]);
const shownRules = computed(() =>
  phase.value === "configure" ? props.rules.length : batchRules.value,
);
const hasCorrelation = computed(() => props.rules.some((r) => r.rule.correlation));

const form = useOForm<BulkInstallForm>({
  defaultValues: bulkInstallDefaults(),
  schema: makeBulkInstallSchema(t),
  onSubmit: install,
});

async function loadChoices() {
  try {
    const res = await commonService.list_Folders(props.orgId, "alerts", {
      skipAccessToast: true,
    });
    folders.value = (res.data?.list ?? []).map((f: any) => ({
      id: String(f.folderId),
      name: String(f.name),
    }));
  } catch {
    folders.value = [];
  }
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
    destinationNames.value = (Array.isArray(list) ? list : []).map((d: any) => String(d.name));
  } catch {
    destinationNames.value = [];
  }
}

watch(
  shown,
  (open) => {
    if (!open) return;
    phase.value = "configure";
    results.value = [];
    stream.value = streamChoices.value.length === 1 ? streamChoices.value[0] : EVERY_STREAM;
    folderId.value = DEFAULT_FOLDER;
    form.reset(bulkInstallDefaults());
    void loadChoices();
  },
  { immediate: true },
);

const preview = useDetectionPreview();

function failureReason(e: unknown): I18nText {
  const { reason, forbidden } = detectionSaveFailure(e);
  if (reason) return raw(reason);
  return forbidden ? t("siem.detections.createForbidden") : t("siem.detections.createFailed");
}

async function install(value: BulkInstallForm) {
  const batch = targets.value;
  if (!batch.length || !canAuthor.value) return;
  phase.value = "running";
  batchRules.value = props.rules.length;
  frozen.value = batch;
  results.value = batch.map(() => null);
  let folder = folderId.value;
  try {
    if (folder === DEFAULT_FOLDER) folder = await detectionFolderId(props.orgId);
  } catch (e) {
    results.value = batch.map((target) => ({
      key: target.rule.key,
      title: target.rule.title,
      stream: target.stream,
      name: "",
      status: "failed",
      reason: failureReason(e),
    }));
    phase.value = "done";
    return;
  }
  const done = await runBulkInstall(
    batch,
    {
      period: toMinutes(value.period),
      frequency: toMinutes(value.frequency),
      silence: toMinutes(value.silence),
      destinations: destinations.value,
      folderId: folder,
    },
    {
      loadSchema: async (name) => {
        const schema: any[] =
          (await streamService.schema(props.orgId, name, "logs")).data?.schema ?? [];
        return {
          fields: schema.map((f) => String(f.name)),
          fieldTypes: Object.fromEntries(
            schema.filter((f) => f.type).map((f) => [String(f.name), String(f.type)]),
          ),
        };
      },
      compile: async (body) =>
        normalizeCompileResponse((await securitySigma.compile(props.orgId, body)).data),
      validate: (sql) => preview.validate(props.orgId, sql),
      addColumns: async (stream, fields) => {
        await securitySigma.addColumns(props.orgId, stream, fields);
      },
      create: async (payload, folder) => {
        await alertsService.create_by_alert_id(props.orgId, payload, folder, {
          skipAccessToast: true,
        });
      },
      takenNames: new Set(props.existingNames),
      failureReason,
      messages: {
        duplicate: (name) => t("siem.content.bulk.duplicate", { name }),
        correlationBlocked: t("siem.content.bulk.correlationBlocked"),
      },
    },
    (result, i) => {
      results.value[i] = result;
    },
  );
  results.value = done;
  phase.value = "done";
  invalidateSiemDetections(props.orgId);
  emit("done", done.filter((r) => r.status === "installed").length);
}

const finished = computed(() => results.value.filter((r): r is BulkResult => !!r));
const counts = computed(() => ({
  installed: finished.value.filter((r) => r.status === "installed").length,
  skipped: finished.value.filter((r) => r.status === "skipped").length,
  failed: finished.value.filter((r) => r.status === "failed").length,
}));

const STATUS_TAG = {
  installed: { variant: "success-soft", icon: "check-circle" },
  skipped: { variant: "default-soft", icon: "do-not-disturb-on" },
  failed: { variant: "error-soft", icon: "error-outline" },
} as const;

const primaryLabel = computed(() =>
  phase.value === "configure"
    ? t("siem.content.bulk.confirm", { n: targets.value.length }, targets.value.length)
    : t("siem.content.bulk.close"),
);

function onPrimary() {
  if (phase.value !== "configure") emit("update:open", false);
}
</script>

<template>
  <ODialog
    :open="shown"
    size="lg"
    :persistent="phase === 'running'"
    :title="t('siem.content.bulk.title', { n: shownRules }, shownRules)"
    :sub-title="t('siem.content.bulk.subtitle')"
    :primary-button-label="primaryLabel"
    :secondary-button-label="phase === 'configure' ? t('siem.detections.cancel') : undefined"
    :form-id="phase === 'configure' ? FORM_ID : undefined"
    :primary-button-disabled="
      phase === 'running' || (phase === 'configure' && (!targets.length || !canAuthor))
    "
    :primary-button-loading="phase === 'running'"
    primary-button-data-test="security-content-bulk-primary"
    data-test="security-content-bulk-dialog"
    @update:open="(v: boolean) => phase !== 'running' && emit('update:open', v)"
    @click:secondary="emit('update:open', false)"
    @click:primary="onPrimary"
  >
    <div v-if="phase === 'configure'" class="flex flex-col gap-4">
      <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
        <OSelect
          :model-value="stream"
          :options="streamOptions"
          :label="t('siem.content.bulk.stream')"
          data-test="security-content-bulk-stream"
          @update:model-value="stream = String($event ?? EVERY_STREAM)"
        />
        <OSelect
          :model-value="folderId"
          :options="folderOptions"
          :label="t('siem.content.bulk.folder')"
          data-test="security-content-bulk-folder"
          @update:model-value="folderId = String($event ?? DEFAULT_FOLDER)"
        />
      </div>
      <OSelect
        :model-value="destinations"
        :options="destinationOptions"
        :label="t('siem.detections.notify')"
        :placeholder="t('siem.detections.notifyPlaceholder')"
        multiple
        data-test="security-content-bulk-destinations"
        @update:model-value="destinations = (($event as string[]) ?? []).map(String)"
      />
      <OForm :id="FORM_ID" :form="form" class="grid grid-cols-1 gap-3 md:grid-cols-3">
        <OFormInput
          name="period"
          type="number"
          :label="t('siem.detections.lookBack')"
          :help-text="hasCorrelation ? t('siem.content.bulk.correlationWindow') : undefined"
          data-test="security-content-bulk-period"
        />
        <OFormInput
          name="frequency"
          type="number"
          :label="t('siem.detections.runEvery')"
          data-test="security-content-bulk-frequency"
        />
        <OFormInput
          name="silence"
          type="number"
          :label="t('siem.detections.silence')"
          data-test="security-content-bulk-silence"
        />
      </OForm>
      <OBanner
        v-if="!targets.length"
        variant="warning"
        icon="warning-amber"
        dense
        data-test="security-content-bulk-nothing"
      >
        {{ t("siem.content.bulk.nothing") }}
      </OBanner>
      <div v-else class="flex flex-col gap-2">
        <span class="text-text-secondary text-xs">{{
          t("siem.content.bulk.plan", { n: targets.length }, targets.length)
        }}</span>
        <ul
          class="border-border-default rounded-surface max-h-60 overflow-y-auto border"
          data-test="security-content-bulk-targets"
        >
          <li
            v-for="target in targets"
            :key="`${target.rule.key}/${target.stream}`"
            class="border-border-subtle flex items-center gap-2 border-b px-3 py-1.5 last:border-b-0"
          >
            <OTag
              type="severity"
              :value="severityTagValue(toneOfSigmaLevel(target.rule.level))"
              :label="t(toneLabelKey(toneOfSigmaLevel(target.rule.level)))"
              size="xs"
            />
            <OTruncatedText class="text-text-heading min-w-0 flex-1 text-sm">{{
              target.rule.title
            }}</OTruncatedText>
            <OTag v-if="target.rule.correlation" variant="purple-soft" size="xs">{{
              t("siem.content.bulk.correlation")
            }}</OTag>
            <span class="text-text-secondary shrink-0 font-mono text-xs">{{ target.stream }}</span>
          </li>
        </ul>
      </div>
    </div>

    <div v-else class="flex flex-col gap-3" data-test="security-content-bulk-results">
      <div class="flex flex-col gap-1.5">
        <span
          class="text-text-heading text-sm font-semibold"
          data-test="security-content-bulk-summary"
          >{{
            t("siem.content.bulk.summary", {
              installed: counts.installed,
              skipped: counts.skipped,
              failed: counts.failed,
              total: results.length,
            })
          }}</span
        >
        <OProgressBar
          :value="results.length ? finished.length / results.length : 0"
          :variant="counts.failed ? 'warning' : 'success'"
        />
      </div>
      <ul class="border-border-default rounded-surface max-h-96 overflow-y-auto border">
        <li
          v-for="(result, i) in results"
          :key="i"
          class="border-border-subtle flex flex-col gap-0.5 border-b px-3 py-2 last:border-b-0"
          :data-test="`security-content-bulk-result-${i}`"
        >
          <div class="flex items-center gap-2">
            <OTag
              v-if="result"
              :variant="STATUS_TAG[result.status].variant"
              :icon="STATUS_TAG[result.status].icon"
              size="xs"
              >{{ t(`siem.content.bulk.status.${result.status}`) }}</OTag
            >
            <OTag v-else variant="default-soft" icon="hourglass-empty" size="xs">{{
              t("siem.content.bulk.status.pending")
            }}</OTag>
            <OTruncatedText class="text-text-heading min-w-0 flex-1 text-sm">{{
              result?.title ?? frozen[i]?.rule.title ?? ""
            }}</OTruncatedText>
            <span class="text-text-secondary shrink-0 font-mono text-xs">{{
              result?.stream ?? frozen[i]?.stream
            }}</span>
          </div>
          <span
            v-if="result && result.status !== 'installed' && result.reason"
            class="text-text-secondary text-xs break-words"
            >{{ result.reason }}</span
          >
        </li>
      </ul>
    </div>
  </ODialog>
</template>
