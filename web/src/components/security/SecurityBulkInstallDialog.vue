<!-- Copyright 2026 OpenObserve Inc.
SPDX-License-Identifier: AGPL-3.0-or-later -->

<!-- Every detection goes through the same server compile and builder as the new-detection dialog. -->
<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import OButton from "@/lib/core/Button/OButton.vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormCheckbox from "@/lib/forms/Checkbox/OFormCheckbox.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
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
import {
  targetKey,
  targetMismatch,
  type BulkDeps,
  type BulkSettings,
  type BulkTarget,
} from "@/utils/security/bulkInstall";
import { useBulkInstallQueue } from "@/composables/security/useBulkInstallQueue";
import { severityTagValue, toneLabelKey, toneOfSigmaLevel } from "@/utils/security/severity";
import { BACKFILL_HOURS, toMinutes } from "./SecurityNewDetectionDialog.schema";
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
  /** Targets a closed tab left unfinished; set, the dialog runs them at once with their saved settings. */
  resume?: { targets: BulkTarget[]; settings: BulkSettings } | null;
}>();
const emit = defineEmits<{
  "update:open": [open: boolean];
  done: [installed: number];
}>();
const store = useStore();
const router = useRouter();
const scope = computed(() => ({
  org: props.orgId,
  user: String(store.state.userInfo?.email ?? ""),
}));

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
const queue = useBulkInstallQueue();
const results = queue.results;
const configuring = ref(true);
const phase = computed<"configure" | "running" | "done">(() =>
  configuring.value ? "configure" : queue.phase.value === "running" ? "running" : "done",
);

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
/** Rows the author unticked; a rule written for another log source starts unticked. */
const excluded = ref(new Set<string>());
const chosenTargets = computed(() =>
  targets.value.filter((t) => !excluded.value.has(targetKey(t))),
);
function setChosen(target: BulkTarget, chosen: unknown) {
  const next = new Set(excluded.value);
  if (chosen === true) next.delete(targetKey(target));
  else next.add(targetKey(target));
  excluded.value = next;
}
const allChosen = computed<boolean | "indeterminate">(() =>
  !chosenTargets.value.length
    ? false
    : chosenTargets.value.length === targets.value.length
      ? true
      : "indeterminate",
);
function chooseAll(chosen: unknown) {
  excluded.value = chosen === true ? new Set() : new Set(targets.value.map(targetKey));
}
const mismatchCount = computed(() => targets.value.filter(targetMismatch).length);

/** The targets of the running batch; the page's selection may change underneath it. */
const frozen = queue.targets;
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
    if (!open || phase.value === "running") return;
    if (props.resume?.targets.length) {
      batchRules.value = new Set(props.resume.targets.map((t) => t.rule.key)).size;
      configuring.value = false;
      void run(props.resume.targets, props.resume.settings);
      return;
    }
    configuring.value = true;
    queue.reset();
    stream.value = streamChoices.value.length === 1 ? streamChoices.value[0] : EVERY_STREAM;
    folderId.value = DEFAULT_FOLDER;
    excluded.value = new Set(targets.value.filter(targetMismatch).map(targetKey));
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

const backfillChosen = form.useStore((s: { values: BulkInstallForm }) => !!s.values.backfill);
const backfillOptions = BACKFILL_HOURS.map((hours) => ({
  label: t("siem.detections.backfillHours", { n: hours }, hours),
  value: hours,
}));

async function install(value: BulkInstallForm) {
  const batch = chosenTargets.value;
  if (!batch.length || !canAuthor.value) return;
  configuring.value = false;
  batchRules.value = props.rules.length;
  let folder = folderId.value;
  try {
    if (folder === DEFAULT_FOLDER) folder = await detectionFolderId(props.orgId);
  } catch (e) {
    queue.failAll(batch, (target) => ({
      key: target.rule.key,
      title: target.rule.title,
      stream: target.stream,
      name: "",
      status: "failed",
      reason: failureReason(e),
    }));
    return;
  }
  await run(batch, {
    period: toMinutes(value.period),
    frequency: toMinutes(value.frequency),
    silence: toMinutes(value.silence),
    destinations: destinations.value,
    folderId: folder,
    backfillMinutes: value.backfill ? toMinutes(value.backfillHours) * 60 : 0,
    learnFirstRun: !value.backfill && !!value.learnFirstRun,
  });
}

const deps = (): BulkDeps => ({
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
});

async function run(batch: BulkTarget[], settings: BulkSettings) {
  const done = await queue.start(scope.value, batch, settings, deps());
  invalidateSiemDetections(props.orgId);
  emit("done", done.filter((r) => r.status === "installed").length);
}

const counts = queue.counts;
/** A finished run that created nothing is not a success, whatever each row says. */
const nothingInstalled = computed(
  () => phase.value === "done" && counts.value.total > 0 && counts.value.installed === 0,
);
const installedSome = computed(() => phase.value === "done" && counts.value.installed > 0);
function openAllowlists() {
  emit("update:open", false);
  void router.push({
    path: "/security/detections",
    query: { org_identifier: props.orgId, tuning: "allowlists" },
  });
}

const STATUS_TAG = {
  installed: { variant: "success-soft", icon: "check-circle" },
  skipped: { variant: "default-soft", icon: "do-not-disturb-on" },
  failed: { variant: "error-soft", icon: "error-outline" },
} as const;

const primaryLabel = computed(() =>
  phase.value === "configure"
    ? t("siem.content.bulk.confirm", { n: chosenTargets.value.length }, chosenTargets.value.length)
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
      phase === 'running' || (phase === 'configure' && (!chosenTargets.length || !canAuthor))
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
        <OFormCheckbox
          name="backfill"
          :label="t('siem.detections.backfill')"
          class="md:col-span-2"
          data-test="security-content-bulk-backfill"
        />
        <OFormSelect
          v-if="backfillChosen"
          name="backfillHours"
          :options="backfillOptions"
          :label="t('siem.detections.backfillRange')"
          data-test="security-content-bulk-backfill-range"
        />
        <OFormCheckbox
          v-else
          name="learnFirstRun"
          :label="t('siem.content.bulk.learnFirstRun')"
          :help-text="t('siem.content.bulk.learnFirstRunHint')"
          class="md:col-span-3"
          data-test="security-content-bulk-learn"
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
        <div class="flex items-center gap-2">
          <OCheckbox
            :model-value="allChosen"
            :aria-label="t('siem.content.bulk.chooseAll')"
            data-test="security-content-bulk-choose-all"
            @update:model-value="chooseAll"
          />
          <span class="text-text-secondary min-w-0 flex-1 text-xs">{{
            t(
              "siem.content.bulk.planChosen",
              { n: chosenTargets.length, total: targets.length },
              chosenTargets.length,
            )
          }}</span>
        </div>
        <OBanner
          v-if="mismatchCount"
          variant="info"
          icon="info-outline"
          dense
          data-test="security-content-bulk-mismatch"
        >
          {{ t("siem.content.bulk.mismatchHint", { n: mismatchCount }, mismatchCount) }}
        </OBanner>
        <ul
          class="border-border-default rounded-surface max-h-60 overflow-y-auto border"
          data-test="security-content-bulk-targets"
        >
          <li
            v-for="target in targets"
            :key="targetKey(target)"
            class="border-border-subtle flex items-center gap-2 border-b px-3 py-1.5 last:border-b-0"
            :data-test="`security-content-bulk-target-${targetKey(target)}`"
          >
            <OCheckbox
              :model-value="!excluded.has(targetKey(target))"
              :aria-label="
                t('siem.content.bulk.chooseTarget', {
                  rule: target.rule.title,
                  stream: target.stream,
                })
              "
              :data-test="`security-content-bulk-target-check-${targetKey(target)}`"
              @update:model-value="(v: unknown) => setChosen(target, v)"
            />
            <OTag
              type="severity"
              :value="severityTagValue(toneOfSigmaLevel(target.rule.level))"
              :label="t(toneLabelKey(toneOfSigmaLevel(target.rule.level)))"
              size="xs"
            />
            <OTruncatedText class="text-text-heading min-w-0 flex-1 text-sm">{{
              target.rule.title
            }}</OTruncatedText>
            <span v-if="targetMismatch(target)" class="inline-flex shrink-0">
              <OTag variant="warning-soft" icon="warning-amber" size="xs">{{
                t("siem.content.bulk.otherSource")
              }}</OTag>
              <OTooltip
                :content="
                  t('siem.content.bulk.otherSourceHint', {
                    rule: target.rule.logsourceLabel,
                    source: target.sourceType,
                  })
                "
              />
            </span>
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
            phase === "running"
              ? t("siem.content.bulk.progress", counts)
              : t("siem.content.bulk.summary", {
                  installed: counts.installed,
                  skipped: counts.skipped,
                  failed: counts.failed,
                  total: counts.total,
                })
          }}</span
        >
        <OProgressBar
          :value="counts.total ? (counts.total - counts.pending) / counts.total : 0"
          :variant="counts.failed ? 'warning' : 'success'"
          data-test="security-content-bulk-progress"
        />
        <span
          v-if="phase === 'running'"
          class="text-text-secondary text-xs"
          data-test="security-content-bulk-keep-open"
          >{{ t("siem.content.bulk.keepOpen") }}</span
        >
      </div>
      <OBanner
        v-if="nothingInstalled"
        variant="error-soft"
        icon="error-outline"
        dense
        data-test="security-content-bulk-none-installed"
        >{{ t("siem.content.bulk.noneInstalled") }}</OBanner
      >
      <OBanner
        v-else-if="installedSome"
        variant="info"
        icon="lightbulb-outline"
        data-test="security-content-bulk-onboarding"
      >
        <div class="flex min-w-0 flex-1 flex-col gap-1.5">
          <span class="text-text-heading font-medium">{{
            t("siem.content.bulk.tuneFirstTitle")
          }}</span>
          <span>{{ t("siem.content.bulk.tuneFirstIntro") }}</span>
          <ul class="list-disc ps-5">
            <li>{{ t("siem.content.bulk.tuneEtl") }}</li>
            <li>{{ t("siem.content.bulk.tuneEgress") }}</li>
            <li>{{ t("siem.content.bulk.tuneJumpHosts") }}</li>
            <li>{{ t("siem.content.bulk.tuneScanners") }}</li>
          </ul>
          <div>
            <OButton
              variant="outline"
              size="sm"
              icon-left="checklist"
              data-test="security-content-bulk-open-allowlists"
              @click="openAllowlists"
              >{{ t("siem.content.bulk.openAllowlists") }}</OButton
            >
          </div>
        </div>
      </OBanner>
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
