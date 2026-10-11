<!-- Copyright 2026 OpenObserve Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
-->

<template>
  <ODrawer
    :open="open"
    size="lg"
    :title="t('rum.analytics.exclusions.title', { app: raw(pa.state.app) })"
    :sub-title="t('rum.analytics.exclusions.subtitle')"
    :form-id="readOnly ? undefined : FORM_ID"
    :primary-button-label="readOnly ? undefined : t('common.save')"
    :secondary-button-label="readOnly ? t('common.close') : t('common.cancel')"
    data-test="rum-analytics-exclusions-drawer"
    @update:open="(v) => emit('update:open', v)"
    @click:secondary="emit('update:open', false)"
  >
    <div class="flex flex-col gap-4">
      <OBanner
        v-if="conflicted"
        variant="warning"
        dense
        :content="t('rum.analytics.exclusions.conflict')"
        data-test="rum-analytics-exclusions-conflict"
      />
      <p class="text-text-secondary text-xs" data-test="rum-analytics-exclusions-audit">
        <span v-if="readOnly">{{ t("rum.analytics.exclusions.readOnly") }} </span>{{ audit }}
      </p>

      <OForm v-if="!readOnly" :id="FORM_ID" :form="form" class="flex flex-col gap-4">
        <OFormSection :title="t('rum.analytics.exclusions.builtinTitle')">
          <template #actions>
            <OFormSwitch name="bots" data-test="rum-analytics-exclusions-builtin-switch" />
          </template>
          <BuiltinBotsSummary :builtin="base?.builtinBots" :removed="builtinRemoved" />
        </OFormSection>

        <div class="flex flex-col gap-2" data-test="rum-analytics-exclusions-suggestions">
          <span class="text-text-heading text-sm font-semibold">{{
            t("rum.analytics.exclusions.suggestions")
          }}</span>
          <span
            v-if="!suggestions.length"
            class="text-text-secondary text-xs"
            data-test="rum-analytics-exclusions-suggestions-empty"
            >{{ t("rum.analytics.exclusions.suggestionsEmpty") }}</span
          >
          <div v-else class="flex flex-wrap gap-2">
            <OButton
              v-for="s in suggestions"
              :key="`${s.rule.field}:${s.value}`"
              variant="outline"
              size="sm"
              icon-left="add"
              :data-test="`rum-analytics-exclusions-suggestion-${s.value}`"
              @click="addRule(s.rule)"
              >{{ t("rum.analytics.exclusions.exclude", { value: raw(s.value) }) }}
              <span class="text-text-secondary">{{
                t(
                  "rum.analytics.exclusions.suggestionSessions",
                  { count: addCommasToNumber(s.sessions) },
                  s.sessions,
                )
              }}</span></OButton
            >
          </div>
        </div>

        <OFormSection :title="t('rum.analytics.exclusions.sessionsTitle')">
          <div class="flex flex-col gap-2">
            <span class="text-text-secondary text-xs">{{
              t("rum.analytics.exclusions.sessionsCaption")
            }}</span>
            <div
              v-for="(rule, i) in draft.sessions"
              :key="i"
              class="flex flex-wrap items-start gap-2"
              :data-test="`rum-analytics-exclusions-rule-${i}`"
            >
              <OFormSelect
                :name="`sessions[${i}].field`"
                :options="fieldOptions"
                :aria-label="t('rum.analytics.exclusions.field')"
                size="sm"
                class="w-40"
              />
              <OFormSelect
                :name="`sessions[${i}].op`"
                :options="opOptions"
                :aria-label="t('rum.analytics.exclusions.match')"
                size="sm"
                class="w-32"
              />
              <OFormSelect
                :name="`sessions[${i}].values`"
                :options="rule.values.map((v) => ({ label: raw(v), value: v }))"
                :placeholder="t('rum.analytics.exclusions.values')"
                multiple
                searchable
                creatable
                size="sm"
                class="min-w-40 flex-1"
              />
              <OButton
                variant="ghost"
                size="icon-sm"
                icon-left="close"
                :aria-label="t('rum.analytics.exclusions.remove')"
                :data-test="`rum-analytics-exclusions-rule-${i}-remove`"
                @click="form.removeFieldValue('sessions', i)"
                ><OTooltip :content="t('rum.analytics.exclusions.remove')"
              /></OButton>
              <OTag
                v-if="!pa.schema.value[rule.field]"
                :label="t('rum.analytics.exclusions.fieldMissing')"
                variant="warning-soft"
                size="sm"
                :data-test="`rum-analytics-exclusions-rule-${i}-missing`"
              />
            </div>
            <OButton
              v-if="draft.sessions.length < MAX_SESSION_RULES"
              variant="outline"
              size="sm"
              icon-left="add"
              class="self-start"
              data-test="rum-analytics-exclusions-add-rule"
              @click="form.pushFieldValue('sessions', emptySessionRule())"
              >{{ t("rum.analytics.exclusions.addRule") }}</OButton
            >
          </div>
        </OFormSection>

        <OFormSection :title="t('rum.analytics.exclusions.pagesTitle')">
          <div class="flex flex-col gap-2">
            <span class="text-text-secondary text-xs">{{
              t("rum.analytics.exclusions.pagesCaption")
            }}</span>
            <div
              v-for="(_, i) in draft.pages"
              :key="i"
              class="flex items-start gap-2"
              :data-test="`rum-analytics-exclusions-page-${i}`"
            >
              <OFormSelect
                :name="`pages[${i}].op`"
                :options="pageOpOptions"
                :aria-label="t('rum.analytics.exclusions.match')"
                size="sm"
                class="w-44"
              />
              <OFormInput
                :name="`pages[${i}].value`"
                :aria-label="t('rum.analytics.exclusions.value')"
                size="sm"
                class="min-w-0 flex-1"
              />
              <OButton
                variant="ghost"
                size="icon-sm"
                icon-left="close"
                :aria-label="t('rum.analytics.exclusions.remove')"
                :data-test="`rum-analytics-exclusions-page-${i}-remove`"
                @click="form.removeFieldValue('pages', i)"
                ><OTooltip :content="t('rum.analytics.exclusions.remove')"
              /></OButton>
            </div>
            <OButton
              v-if="draft.pages.length < MAX_PAGE_RULES"
              variant="outline"
              size="sm"
              icon-left="add"
              class="self-start"
              data-test="rum-analytics-exclusions-add-page"
              @click="form.pushFieldValue('pages', emptyPageRule())"
              >{{ t("rum.analytics.exclusions.addPage") }}</OButton
            >
            <span class="text-text-secondary text-xs">{{
              t("rum.analytics.exclusions.pagesFunnelNote")
            }}</span>
          </div>
        </OFormSection>
      </OForm>

      <template v-else-if="base">
        <OFormSection :title="t('rum.analytics.exclusions.builtinTitle')">
          <template #actions>
            <OSwitch :model-value="base.bots" disabled />
          </template>
          <BuiltinBotsSummary :builtin="base.builtinBots" :removed="builtinRemoved" />
        </OFormSection>
        <OFormSection :title="t('rum.analytics.exclusions.sessionsTitle')">
          <ul class="flex flex-col gap-1 text-sm">
            <li v-for="(rule, i) in base.sessions" :key="i" class="flex flex-wrap gap-2">
              <span>{{ t(`rum.analytics.exclusions.fields.${rule.field}`) }}</span>
              <span class="text-text-secondary">{{
                t(`rum.analytics.exclusions.ops.${rule.op}`)
              }}</span>
              <span>{{ raw(rule.values.join(", ")) }}</span>
              <OTag
                v-if="!pa.schema.value[rule.field]"
                :label="t('rum.analytics.exclusions.fieldMissing')"
                variant="warning-soft"
                size="sm"
              />
            </li>
          </ul>
        </OFormSection>
        <OFormSection :title="t('rum.analytics.exclusions.pagesTitle')">
          <ul class="flex flex-col gap-1 text-sm">
            <li v-for="(page, i) in base.pages" :key="i" class="flex gap-2">
              <span class="text-text-secondary">{{
                t(`rum.analytics.exclusions.pageOps.${page.op}`)
              }}</span>
              <span>{{ raw(page.value) }}</span>
            </li>
          </ul>
          <span class="text-text-secondary text-xs">{{
            t("rum.analytics.exclusions.pagesFunnelNote")
          }}</span>
        </OFormSection>
      </template>

      <p
        v-if="preview"
        :class="preview.remain === 0 ? 'text-status-warning-text' : 'text-text-body'"
        class="text-sm"
        data-test="rum-analytics-exclusions-preview"
      >
        {{
          t("rum.analytics.exclusions.preview", {
            remain: addCommasToNumber(preview.remain),
            total: addCommasToNumber(preview.total),
          })
        }}
      </p>
    </div>
  </ODrawer>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useStore } from "vuex";
import { formatInTimeZone } from "date-fns-tz";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OFormSection from "@/lib/core/FormSection/OFormSection.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import OFormSwitch from "@/lib/forms/Switch/OFormSwitch.vue";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";
import { useOForm } from "@/lib/forms/Form/useOForm";
import { toast } from "@/lib/feedback/Toast/useToast";
import BuiltinBotsSummary from "@/components/rum/productAnalytics/BuiltinBotsSummary.vue";
import useProductAnalytics from "@/composables/rum/useProductAnalytics";
import useNamedEvents from "@/composables/rum/useNamedEvents";
import useExclusionSuggestions from "@/composables/rum/useExclusionSuggestions";
import useAnalyticsSearch from "@/composables/rum/useAnalyticsSearch";
import { raw, useI18nTyped } from "@/types/i18n";
import { addCommasToNumber } from "@/utils/formatters";
import { rumPaError } from "@/utils/rum/rumPaApiError";
import { summarySql } from "@/utils/rum/productAnalyticsQueries";
import type { AppSettings, SessionRule } from "@/utils/rum/productAnalyticsModel";
import {
  MATCH_OPS,
  MAX_PAGE_RULES,
  MAX_SESSION_RULES,
  PAGE_OPS,
  SESSION_FIELDS,
  appSettingsDefaults,
  emptyPageRule,
  emptySessionRule,
  makeAppSettingsSchema,
  type AppSettingsForm,
} from "@/components/rum/productAnalytics/AppSettings.schema";

const FORM_ID = "rum-analytics-exclusions-form";
const PREVIEW_DELAY_MS = 400;

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ "update:open": [boolean] }>();
const { t } = useI18nTyped();
const store = useStore();
const pa = useProductAnalytics();
const namedEvents = useNamedEvents();
const suggest = useExclusionSuggestions();
const runner = useAnalyticsSearch();

const conflictRow = ref<AppSettings | null>(null);
const conflicted = ref(false);
const denied = ref(false);
const draftPreview = ref<{ remain: number; total: number; builtinRemoved: number } | null>(null);
let previewTimer: ReturnType<typeof setTimeout> | null = null;
let previewSeq = 0;

// Settings ride on the scope as the full row the server returned.
const saved = computed(() => pa.scope.value.exclusions as AppSettings | undefined);
const base = computed(() => conflictRow.value ?? saved.value);

// Named events and exclusions share the rum_analytics PUT permission.
const readOnly = computed(() => denied.value || namedEvents.permission.value === "read");

const schema = makeAppSettingsSchema(t);
const form = useOForm<AppSettingsForm>({
  defaultValues: base.value
    ? appSettingsDefaults(base.value)
    : { bots: true, sessions: [], pages: [] },
  schema,
  onSubmit: (value) => save(value),
});
const draft = form.useStore((s: { values: AppSettingsForm }) => s.values);

const fieldOptions = computed(() =>
  SESSION_FIELDS.map((f) => ({ label: t(`rum.analytics.exclusions.fields.${f}`), value: f })),
);
const opOptions = computed(() =>
  MATCH_OPS.map((o) => ({ label: t(`rum.analytics.exclusions.ops.${o}`), value: o })),
);
const pageOpOptions = computed(() =>
  PAGE_OPS.map((o) => ({ label: t(`rum.analytics.exclusions.pageOps.${o}`), value: o })),
);

// Under xall the page summary runs with the built-in flag off, so the draft query, which never uses xall, counts it.
const builtinRemoved = computed(() => {
  if (pa.state.includeExcluded) return draftPreview.value?.builtinRemoved ?? null;
  const s = pa.summary.value;
  return s ? Math.max(0, s.totalSessions - s.builtinKeptSessions) : null;
});

const suggestions = computed(() => [
  ...suggest.ua.value,
  ...(suggest.identity.value ? [suggest.identity.value] : []),
]);

const audit = computed(() => {
  const row = base.value;
  if (!row) return "";
  if (!row.id || !row.updatedAt) return t("rum.analytics.exclusions.auditNever");
  return t("rum.analytics.exclusions.auditSaved", {
    user: raw(row.updatedBy ?? ""),
    time: raw(
      formatInTimeZone(new Date(row.updatedAt), store.state.timezone || "UTC", "yyyy-MM-dd HH:mm"),
    ),
  });
});

const ruleKey = (v: Pick<AppSettingsForm, "bots" | "sessions">) =>
  JSON.stringify([v.bots, v.sessions]);

// The summary already counts the saved rules; only a draft that differs from them needs its own query.
const draftChanged = computed(
  () =>
    !!base.value &&
    (pa.state.includeExcluded ||
      !!conflictRow.value ||
      ruleKey(draft.value) !== ruleKey(appSettingsDefaults(base.value))),
);

const preview = computed(() => {
  const s = pa.summary.value;
  if (!s || !base.value) return null;
  return draftChanged.value ? draftPreview.value : { remain: s.sessions, total: s.totalSessions };
});

// A half-typed rule would make the preview query fail, so only complete rules count.
const completeRules = (v: AppSettingsForm): AppSettingsForm => ({
  bots: v.bots,
  sessions: v.sessions.filter((r) => schema.shape.sessions.element.safeParse(r).success),
  pages: v.pages.filter((p) => schema.shape.pages.element.safeParse(p).success),
});

const runPreview = async () => {
  const row = base.value;
  if (!row || !props.open) return;
  const seq = ++previewSeq;
  const rules = completeRules(draft.value);
  const scope = { ...pa.scope.value, xall: undefined, exclusions: { ...row, ...rules } };
  const cur = pa.resolveRange();
  const res = await runner.run<Record<string, number>>(
    "exclusions-preview",
    { sql: summarySql(scope, cur.startUs), ...cur, limit: 1, sampled: 1 },
    `${pa.scopeKey.value}|${JSON.stringify(rules)}`,
  );
  if (seq !== previewSeq || res.status !== "ok") return;
  const hit = res.rows[0] ?? {};
  draftPreview.value = {
    remain: Number(hit.sessions ?? 0),
    total: Number(hit.total_sessions ?? 0),
    builtinRemoved: Math.max(
      0,
      Number(hit.total_sessions ?? 0) - Number(hit.builtin_kept_sessions ?? 0),
    ),
  };
};

watch(
  () => [props.open, draftChanged.value, ruleKey(draft.value)],
  () => {
    if (previewTimer) clearTimeout(previewTimer);
    previewTimer = null;
    draftPreview.value = null;
    if (props.open && draftChanged.value) {
      previewTimer = setTimeout(() => void runPreview(), PREVIEW_DELAY_MS);
    }
  },
);

watch(
  () => props.open,
  (open) => {
    if (!open) {
      runner.abortAll();
      return;
    }
    conflictRow.value = null;
    conflicted.value = false;
    if (saved.value) form.reset(appSettingsDefaults(saved.value));
    void suggest.loadUa();
  },
);

const addRule = (rule: SessionRule) => {
  if (draft.value.sessions.length >= MAX_SESSION_RULES) return;
  form.pushFieldValue("sessions", { ...rule, values: [...rule.values] });
};

async function save(value: AppSettingsForm) {
  const row = base.value;
  if (!row) return;
  try {
    await pa.saveAppSettings({
      bots: value.bots,
      sessions: value.sessions.map((r) => ({ field: r.field, op: r.op, values: [...r.values] })),
      pages: value.pages.map((p) => ({ op: p.op, value: p.value })),
      version: row.version,
    });
    emit("update:open", false);
  } catch (e) {
    const err = rumPaError(e);
    if (err.code === "version_conflict" && err.current) {
      conflictRow.value = err.current as AppSettings;
      conflicted.value = true;
      form.reset(appSettingsDefaults(conflictRow.value));
      return;
    }
    if (err.status === 403) denied.value = true;
    toast({
      variant: "error",
      message:
        err.status === 403
          ? t("rum.analytics.exclusions.readOnly")
          : t("rum.analytics.exclusions.saveFailed"),
    });
  }
}

onBeforeUnmount(() => {
  if (previewTimer) clearTimeout(previewTimer);
  runner.abortAll();
});
</script>
