<!-- Copyright 2026 OpenObserve Inc.
SPDX-License-Identifier: AGPL-3.0-or-later -->

<!-- Bulk indicators: a CSV file (read and normalised here, so bad rows are
     counted before anything is stored) or a CSV feed URL (fetched and kept
     fresh by the server; its rows must carry an `indicator` column). -->
<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import OFormFile from "@/lib/forms/File/OFormFile.vue";
import OFormSwitch from "@/lib/forms/Switch/OFormSwitch.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import threatIntel, { RemoveRefused, type IntelTable } from "@/services/threat_intel";
import { useConfirmDialog } from "@/composables/useConfirmDialog";
import { INTEL_SEVERITIES, indicatorsFromCsv, intelTableName } from "@/utils/security/intel";
import {
  intelImportDefaults,
  makeIntelImportSchema,
  type IntelImportForm,
} from "./SecurityIntelImportDialog.schema";

const props = defineProps<{
  open: boolean;
  mode: "file" | "url";
  tables: IntelTable[];
  /** `type:indicator` keys already in each list, for de-duplication. */
  existingKeys: Record<string, string[]>;
  /** Stored columns per list; an append must use exactly these. */
  tableColumns: Record<string, string[]>;
}>();
const emit = defineEmits<{ "update:open": [open: boolean]; saved: [table: string] }>();

const { t } = useI18n();
const store = useStore();
const { confirm } = useConfirmDialog();
const FORM_ID = "security-intel-import-form";

const schema = makeIntelImportSchema(t, () => props.mode);
const defaults = computed(() =>
  intelImportDefaults(props.mode === "url" ? "ioc_feed" : "ioc_imported"),
);
const severityOptions = computed(() =>
  INTEL_SEVERITIES.map((s) => ({ label: t(`siem.severity.${s}`), value: s })),
);

async function onSubmit(value: IntelImportForm) {
  const org = store.state.selectedOrganization.identifier;
  const table = intelTableName(value.list);
  const existing = props.tables.find((tb) => tb.name === table);
  try {
    if (props.mode === "url") {
      // A file-fed list cannot become a feed (and vice versa) — the server refuses.
      await threatIntel.importUrl(org, table, value.url.trim(), value.append);
      toast({ variant: "success", message: t("siem.intel.form.feedQueued", { table }) });
    } else {
      const file = Array.isArray(value.file) ? value.file[0] : value.file;
      const parsed = indicatorsFromCsv(
        await (file as File).text(),
        {
          severity: value.severity,
          source: value.source.trim() || (file as File).name,
          confidence: 50,
        },
        new Date().toISOString(),
      );
      if (parsed.missingColumn) {
        toast({ variant: "error", message: t("siem.intel.form.noIndicatorColumn") });
        return;
      }
      if (!parsed.indicators.length) {
        toast({ variant: "error", message: t("siem.intel.form.noValidRows") });
        return;
      }
      if (existing?.feed) {
        toast({ variant: "error", message: t("siem.intel.form.feedReadOnly", { table }) });
        return;
      }
      // The switch alone decides: `existing` comes from page load and may be stale.
      const already = new Set(value.append ? (props.existingKeys[table] ?? []) : []);
      const fresh = parsed.indicators.filter((i) => !already.has(`${i.type}:${i.indicator}`));
      if (!fresh.length) {
        toast({ variant: "info", message: t("siem.intel.form.allPresent", { table }) });
        emit("update:open", false);
        return;
      }
      parsed.indicators = fresh;
      // Replacing drops every row, the schema and settings; say so first.
      if (!value.append && existing) {
        const ok = await confirm({
          title: t("siem.intel.form.replaceTitle"),
          message: t("siem.intel.form.replaceMessage", { table }),
          confirmLabel: t("siem.intel.form.replaceConfirm"),
        });
        if (!ok) return;
      }
      await threatIntel.upload(org, table, fresh, value.append, props.tableColumns[table] ?? []);
      toast({
        variant: parsed.invalid ? "warning" : "success",
        message: parsed.invalid
          ? t(
              "siem.intel.form.importedSkipped",
              { n: parsed.indicators.length, skipped: parsed.invalid, table },
              parsed.invalid,
            )
          : t(
              "siem.intel.form.added",
              { n: parsed.indicators.length, table },
              parsed.indicators.length,
            ),
      });
    }
    emit("saved", table);
    emit("update:open", false);
  } catch (e: any) {
    toast({
      variant: "error",
      message:
        e instanceof RemoveRefused
          ? t("siem.intel.form.noIndicatorColumnIn", { table })
          : (e?.response?.data?.message ?? e?.message ?? t("siem.intel.form.saveFailed")),
    });
  }
}
</script>

<template>
  <ODialog
    :open="open"
    size="md"
    :title="mode === 'url' ? t('siem.intel.form.feedTitle') : t('siem.intel.form.importTitle')"
    :sub-title="
      mode === 'url' ? t('siem.intel.form.feedSubtitle') : t('siem.intel.form.importSubtitle')
    "
    :form-id="FORM_ID"
    :primary-button-label="
      mode === 'url' ? t('siem.intel.form.feedSubmit') : t('siem.intel.form.importSubmit')
    "
    :secondary-button-label="t('siem.intel.form.cancel')"
    data-test="security-intel-import-dialog"
    @update:open="emit('update:open', $event)"
    @click:secondary="emit('update:open', false)"
  >
    <OForm
      v-if="open"
      :id="FORM_ID"
      :schema="schema"
      :default-values="defaults"
      class="flex flex-col gap-5"
      @submit="onSubmit"
    >
      <OFormInput
        name="list"
        :label="t('siem.intel.form.list')"
        :help-text="t('siem.intel.form.listHelp')"
        required
        data-test="security-intel-import-list"
      />
      <OFormFile
        v-if="mode === 'file'"
        name="file"
        accept=".csv"
        :label="t('siem.intel.form.file')"
        :help-text="t('siem.intel.form.fileHelp')"
        required
        data-test="security-intel-import-file"
      />
      <OFormInput
        v-else
        name="url"
        :label="t('siem.intel.form.url')"
        :placeholder="t('siem.intel.form.urlPlaceholder')"
        :help-text="t('siem.intel.form.urlHelp')"
        required
        data-test="security-intel-import-url"
      />
      <div v-if="mode === 'file'" class="grid grid-cols-2 gap-4">
        <OFormSelect
          name="severity"
          :label="t('siem.intel.form.defaultSeverity')"
          :options="severityOptions"
          data-test="security-intel-import-severity"
        />
        <OFormInput
          name="source"
          :label="t('siem.intel.form.source')"
          :placeholder="t('siem.intel.form.sourcePlaceholder')"
          data-test="security-intel-import-source"
        />
      </div>
      <OFormSwitch
        name="append"
        :label="t('siem.intel.form.append')"
        data-test="security-intel-import-append"
      />
    </OForm>
  </ODialog>
</template>
