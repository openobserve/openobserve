<!-- Copyright 2026 OpenObserve Inc.
SPDX-License-Identifier: AGPL-3.0-or-later -->

<script setup lang="ts">
import { computed } from "vue";
import { raw, useI18nTyped } from "@/types/i18n";
import { useStore } from "vuex";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import { useSecurityAccess } from "@/composables/security/useSecurityAccess";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormTextarea from "@/lib/forms/Input/OFormTextarea.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import threatIntel, { RemoveRefused, type IntelTable } from "@/services/threat_intel";
import securityIntel, { MAX_LIST_INDICATORS } from "@/services/securityIntel";
import { INDICATOR_TYPES, INTEL_SEVERITIES, intelTableName } from "@/utils/security/intel";
import {
  EXPIRY_DAYS,
  intelAddDefaults,
  makeIntelAddSchema,
  type IntelAddForm,
} from "./SecurityIntelAddDialog.schema";

const props = defineProps<{
  open: boolean;
  tables: IntelTable[];
  /** `type:indicator` keys already in each list, for de-duplication. */
  existingKeys: Record<string, string[]>;
  /** Stored columns per list; an append must use exactly these. */
  tableColumns: Record<string, string[]>;
}>();
const emit = defineEmits<{ "update:open": [open: boolean]; saved: [table: string] }>();

const { t } = useI18nTyped();
const store = useStore();
// Writing intel lists is authoring; the server refuses it without the grant too.
const { canAuthor } = useSecurityAccess();
const shown = computed(() => props.open && canAuthor.value);
const FORM_ID = "security-intel-add-form";

const schema = makeIntelAddSchema(t);
// Feeds are refreshed by the server and cannot take pasted rows, so default to a hand-kept list.
const defaults = computed(() =>
  intelAddDefaults(props.tables.find((tb) => !tb.feed)?.name ?? "ioc_manual"),
);

const typeOptions = computed(() => [
  { label: t("siem.intel.type.auto"), value: "auto" },
  ...INDICATOR_TYPES.map((type) => ({ label: t(`siem.intel.type.${type}`), value: type })),
]);
const severityOptions = computed(() =>
  INTEL_SEVERITIES.map((s) => ({ label: t(`siem.severity.${s}`), value: s })),
);
const expiryOptions = computed(() =>
  EXPIRY_DAYS.map((d) => ({
    label: d === "0" ? t("siem.intel.form.never") : t("siem.intel.form.days", Number(d)),
    value: d,
  })),
);

async function onSubmit(value: IntelAddForm) {
  if (!canAuthor.value) return;
  const table = intelTableName(value.list);
  const existing = props.tables.find((tb) => tb.name === table);
  if (existing?.feed) {
    toast({ variant: "error", message: t("siem.intel.form.feedReadOnly", { table }) });
    return;
  }
  const already = new Set(props.existingKeys[table] ?? []);
  // Stats lag uploads and the page reads a capped number of rows, so take the larger count.
  const held = Math.max(already.size, existing?.docs ?? 0);
  let checked;
  try {
    checked = (
      await securityIntel.validate(store.state.selectedOrganization.identifier, {
        text: value.indicators,
        forced_type: value.type === "auto" ? null : value.type,
        held,
      })
    ).data;
  } catch (e: any) {
    toast({
      variant: "error",
      message: raw(e?.response?.data?.message) || t("siem.intel.form.saveFailed"),
    });
    return;
  }
  const parsed = checked.parsed ?? { valid: [], invalid: [], duplicates: 0 };
  if (parsed.invalid.length) {
    const sample = parsed.invalid
      .slice(0, 3)
      .map((i) => `${i.value} (${t("siem.intel.form.line", { n: i.line })})`)
      .join(", ");
    toast({
      variant: "error",
      message: t("siem.intel.form.invalid", { n: parsed.invalid.length, sample }),
    });
    return;
  }
  if (parsed.valid.length > checked.max_indicators) {
    toast({
      variant: "error",
      message: t("siem.intel.form.tooMany", {
        n: parsed.valid.length,
        max: checked.max_indicators,
      }),
    });
    return;
  }
  if (!parsed.valid.length) {
    toast({ variant: "error", message: t("siem.intel.form.indicatorsRequired") });
    return;
  }
  const fresh = parsed.valid.filter((v) => !already.has(`${v.type}:${v.indicator}`));
  if (!fresh.length) {
    toast({ variant: "info", message: t("siem.intel.form.allPresent", { table }) });
    emit("update:open", false);
    return;
  }
  if (fresh.length > checked.room) {
    toast({
      variant: "error",
      message: t("siem.intel.form.listFull", {
        table,
        count: held + fresh.length,
        max: checked.max_indicators,
      }),
    });
    return;
  }
  const now = new Date();
  const days = Number(value.expiry);
  const expiresAt = days ? new Date(now.getTime() + days * 86_400_000).toISOString() : "";
  try {
    await threatIntel.upload(
      store.state.selectedOrganization.identifier,
      table,
      fresh.map((v) => ({
        indicator: v.indicator,
        type: v.type,
        severity: value.severity,
        confidence: Number(value.confidence),
        source: value.source.trim(),
        description: value.description.trim(),
        addedAt: now.toISOString(),
        expiresAt,
      })),
      // Always append: a list created after this page loaded must never be replaced by an add.
      true,
      props.tableColumns[table] ?? [],
    );
    const dupes = parsed.valid.length - fresh.length;
    toast({
      variant: "success",
      message: dupes
        ? t("siem.intel.form.addedSkippedDupes", { n: fresh.length, table, dupes }, fresh.length)
        : t("siem.intel.form.added", { n: fresh.length, table }, fresh.length),
    });
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
    :open="shown"
    size="md"
    :title="t('siem.intel.form.addTitle')"
    :sub-title="t('siem.intel.form.addSubtitle')"
    :form-id="FORM_ID"
    :primary-button-label="t('siem.intel.form.addSubmit')"
    :secondary-button-label="t('siem.intel.form.cancel')"
    data-test="security-intel-add-dialog"
    @update:open="emit('update:open', $event)"
    @click:secondary="emit('update:open', false)"
  >
    <OForm
      v-if="shown"
      :id="FORM_ID"
      :schema="schema"
      :default-values="defaults"
      class="flex flex-col gap-5"
      @submit="onSubmit"
    >
      <OFormTextarea
        name="indicators"
        :label="t('siem.intel.form.indicators')"
        :placeholder="t('siem.intel.form.indicatorsPlaceholder')"
        :help-text="t('siem.intel.form.indicatorsHelp', { max: MAX_LIST_INDICATORS })"
        :rows="6"
        required
        data-test="security-intel-add-indicators"
      />
      <div class="grid grid-cols-2 gap-4">
        <OFormInput
          name="list"
          :label="t('siem.intel.form.list')"
          :help-text="t('siem.intel.form.listHelp')"
          required
          data-test="security-intel-add-list"
        />
        <OFormSelect
          name="type"
          :label="t('siem.intel.form.type')"
          :options="typeOptions"
          data-test="security-intel-add-type"
        />
        <OFormSelect
          name="severity"
          :label="t('siem.common.severity')"
          :options="severityOptions"
          data-test="security-intel-add-severity"
        />
        <OFormInput
          name="confidence"
          type="number"
          :label="t('siem.intel.form.confidence')"
          data-test="security-intel-add-confidence"
        />
        <OFormInput
          name="source"
          :label="t('siem.intel.form.source')"
          :placeholder="t('siem.intel.form.sourcePlaceholder')"
          data-test="security-intel-add-source"
        />
        <OFormSelect
          name="expiry"
          :label="t('siem.intel.form.expiry')"
          :options="expiryOptions"
          data-test="security-intel-add-expiry"
        />
      </div>
      <OFormTextarea
        name="description"
        :label="t('siem.intel.form.description')"
        :rows="2"
        data-test="security-intel-add-description"
      />
    </OForm>
  </ODialog>
</template>
