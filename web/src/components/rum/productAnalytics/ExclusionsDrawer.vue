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
    :primary-button-disabled="!base"
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

      <OFormSection
        :title="t('rum.analytics.exclusions.inThisView')"
        data-test="rum-analytics-exclusions-view"
      >
        <div class="flex flex-col gap-2 text-sm">
          <span class="text-text-body flex flex-col gap-1">
            <span
              v-for="line in viewLines"
              :key="line.id"
              :data-test="`rum-analytics-app-filters-${line.id}`"
              >{{ line.text }}</span
            >
          </span>
          <OSwitch
            :model-value="pa.state.includeExcluded"
            :label="t('rum.analytics.appFilters.switchLabel')"
            data-test="rum-analytics-app-filters-include-switch"
            @update:model-value="(v) => appFilters.setIncludeHidden(router, v === true)"
          />
        </div>
      </OFormSection>

      <OForm v-if="!readOnly" :id="FORM_ID" :form="form" class="flex flex-col gap-4">
        <OFormSection :title="t('rum.analytics.exclusions.builtinTitle')">
          <template #actions>
            <OFormSwitch
              name="bots"
              :aria-label="t('rum.analytics.exclusions.builtinTitle')"
              data-test="rum-analytics-exclusions-builtin-switch"
            />
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

        <OFormSection
          :title="t('rum.analytics.exclusions.sessionsTitle')"
          :info="t('rum.analytics.exclusions.sessionsCaption')"
        >
          <div class="flex flex-col gap-2">
            <span v-if="draft.sessions.length" class="flex flex-wrap items-center gap-1.5">
              <span
                v-for="(rule, i) in draft.sessions"
                :key="i"
                class="flex max-w-full min-w-0 items-center gap-1"
                :data-test="`rum-analytics-exclusions-rule-${i}`"
              >
                <OTag
                  :label="ruleLabel(rule)"
                  variant="primary-outline"
                  size="sm"
                  clickable
                  removable
                  class="max-w-full min-w-0"
                  :remove-label="t('rum.analytics.exclusions.remove')"
                  :data-test="`rum-analytics-exclusions-rule-${i}-chip`"
                  @click="editRule(i)"
                  @remove="removeRule(i)"
                >
                  <OTruncatedText as="span" class="min-w-0">{{ ruleLabel(rule) }}</OTruncatedText>
                </OTag>
                <OTag
                  v-if="!pa.schema.value[rule.field]"
                  :label="t('rum.analytics.exclusions.fieldMissing')"
                  variant="warning-soft"
                  size="sm"
                  :data-test="`rum-analytics-exclusions-rule-${i}-missing`"
                />
              </span>
            </span>
            <OPopover
              :open="ruleOpen"
              side="bottom"
              align="start"
              content-class="p-3 w-96 max-w-[calc(100vw-1.5rem)]"
              @update:open="setRuleOpen"
            >
              <template #trigger>
                <span class="self-start">
                  <OButton
                    variant="outline"
                    size="sm"
                    icon-left="add"
                    :active="ruleOpen"
                    :disabled="draft.sessions.length >= MAX_SESSION_RULES"
                    data-test="rum-analytics-exclusions-add-rule"
                    @click="ruleEditing = null"
                    >{{ t("rum.analytics.exclusions.addRule") }}</OButton
                  >
                </span>
              </template>
              <SessionFieldPicker
                v-if="ruleOpen"
                :key="ruleEditing ?? '+'"
                :fields="ruleFields"
                :values="ruleValues"
                :initial="editingRule"
                :lock-field="ruleEditing !== null"
                :conditions="RULE_CONDITIONS"
                @load="loadRuleValues"
                @apply="applyRule"
                @cancel="setRuleOpen(false)"
              />
            </OPopover>
          </div>
        </OFormSection>

        <OFormSection
          :title="t('rum.analytics.exclusions.pagesTitle')"
          :info="t('rum.analytics.exclusions.pagesCaption')"
        >
          <div class="flex flex-col gap-2">
            <span v-if="draft.pages.length" class="flex flex-wrap items-center gap-1.5">
              <OTag
                v-for="(page, i) in draft.pages"
                :key="i"
                :label="pageLabel(page)"
                variant="primary-outline"
                size="sm"
                clickable
                removable
                class="max-w-full min-w-0"
                :remove-label="t('rum.analytics.exclusions.remove')"
                :data-test="`rum-analytics-exclusions-page-${i}`"
                @click="editPage(i)"
                @remove="removePage(i)"
              >
                <OTruncatedText as="span" class="min-w-0">{{ pageLabel(page) }}</OTruncatedText>
              </OTag>
            </span>
            <OPopover
              :open="pageOpen"
              side="bottom"
              align="start"
              content-class="p-3 w-96 max-w-[calc(100vw-1.5rem)]"
              @update:open="setPageOpen"
            >
              <template #trigger>
                <span class="self-start">
                  <OButton
                    variant="outline"
                    size="sm"
                    icon-left="add"
                    :active="pageOpen"
                    :disabled="draft.pages.length >= MAX_PAGE_RULES"
                    data-test="rum-analytics-exclusions-add-page"
                    @click="pageEditing = null"
                    >{{ t("rum.analytics.exclusions.addPage") }}</OButton
                  >
                </span>
              </template>
              <AppFilterPagePicker
                v-if="pageOpen"
                :key="pageEditing ?? '+'"
                :initial="pageEditing === null ? undefined : draft.pages[pageEditing]"
                @apply="applyPage"
                @cancel="setPageOpen(false)"
              />
            </OPopover>
            <span class="text-text-secondary text-xs">{{
              t("rum.analytics.exclusions.pagesFunnelNote")
            }}</span>
          </div>
        </OFormSection>
      </OForm>

      <template v-else-if="base">
        <OFormSection :title="t('rum.analytics.exclusions.builtinTitle')">
          <template #actions>
            <OSwitch
              :model-value="base.bots"
              disabled
              :aria-label="t('rum.analytics.exclusions.builtinTitle')"
            />
          </template>
          <BuiltinBotsSummary :builtin="base.builtinBots" :removed="builtinRemoved" />
        </OFormSection>
        <OFormSection
          :title="t('rum.analytics.exclusions.sessionsTitle')"
          :info="t('rum.analytics.exclusions.sessionsCaption')"
        >
          <ul class="flex flex-col gap-1 text-sm">
            <li v-if="!base.sessions.length" class="text-text-muted">{{ dash }}</li>
            <li v-for="(rule, i) in base.sessions" :key="i" class="flex flex-wrap gap-2">
              <span>{{ ruleLabel(rule) }}</span>
              <OTag
                v-if="!pa.schema.value[rule.field]"
                :label="t('rum.analytics.exclusions.fieldMissing')"
                variant="warning-soft"
                size="sm"
              />
            </li>
          </ul>
        </OFormSection>
        <OFormSection
          :title="t('rum.analytics.exclusions.pagesTitle')"
          :info="t('rum.analytics.exclusions.pagesCaption')"
        >
          <ul class="flex flex-col gap-1 text-sm">
            <li v-if="!base.pages.length" class="text-text-muted">{{ dash }}</li>
            <li v-for="(page, i) in base.pages" :key="i">{{ pageLabel(page) }}</li>
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
          t(
            "rum.analytics.exclusions.preview",
            {
              remain: addCommasToNumber(preview.remain),
              total: addCommasToNumber(preview.total),
            },
            preview.total,
          )
        }}
      </p>
    </div>
  </ODrawer>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { formatInTimeZone } from "date-fns-tz";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OFormSection from "@/lib/core/FormSection/OFormSection.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormSwitch from "@/lib/forms/Switch/OFormSwitch.vue";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";
import OPopover from "@/lib/overlay/Popover/OPopover.vue";
import { useOForm } from "@/lib/forms/Form/useOForm";
import { toast } from "@/lib/feedback/Toast/useToast";
import BuiltinBotsSummary from "@/components/rum/productAnalytics/BuiltinBotsSummary.vue";
import AppFilterPagePicker from "@/components/rum/productAnalytics/AppFilterPagePicker.vue";
import SessionFieldPicker from "@/components/rum/productAnalytics/funnelParts/SessionFieldPicker.vue";
import {
  FILTER_CONDITIONS,
  conditionOf,
  filterFieldLabel,
  type FilterValuesState,
} from "@/components/rum/productAnalytics/funnelParts/funnelFilters";
import useProductAnalytics from "@/composables/rum/useProductAnalytics";
import useNamedEvents from "@/composables/rum/useNamedEvents";
import useExclusionSuggestions from "@/composables/rum/useExclusionSuggestions";
import useAnalyticsSearch from "@/composables/rum/useAnalyticsSearch";
import useAppFilterCounts from "@/composables/rum/useAppFilterCounts";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { addCommasToNumber } from "@/utils/formatters";
import { rumPaError } from "@/utils/rum/rumPaApiError";
import {
  filterValuesSql,
  summarySql,
  type FunnelFilter,
} from "@/utils/rum/productAnalyticsQueries";
import type {
  AppSettings,
  PageRule,
  SessionField,
  SessionRule,
} from "@/utils/rum/productAnalyticsModel";
import {
  MAX_PAGE_RULES,
  MAX_RULE_VALUES,
  MAX_SESSION_RULES,
  SESSION_FIELDS,
  appSettingsDefaults,
  makeAppSettingsSchema,
  type AppSettingsForm,
} from "@/components/rum/productAnalytics/AppSettings.schema";

const FORM_ID = "rum-analytics-exclusions-form";
const PREVIEW_DELAY_MS = 400;
// App rules have no negation on the server, so only the kept conditions are offered.
const RULE_CONDITIONS = FILTER_CONDITIONS.filter((c) => !c.not);

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ "update:open": [boolean] }>();
const { t } = useI18nTyped();
const store = useStore();
const router = useRouter();
const pa = useProductAnalytics();
const appFilters = useAppFilterCounts();
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

const dash = raw("—");
const schema = makeAppSettingsSchema(t);
const form = useOForm<AppSettingsForm>({
  defaultValues: base.value
    ? appSettingsDefaults(base.value)
    : { bots: true, sessions: [], pages: [] },
  schema,
  onSubmit: (value) => save(value),
});
const draft = form.useStore((s: { values: AppSettingsForm }) => s.values);

const valuesPanel = runner.panel<{ v: string; sessions: number }>("rule-values");
const valuesField = ref<string | null>(null);
const ruleOpen = ref(false);
const ruleEditing = ref<number | null>(null);
const pageOpen = ref(false);
const pageEditing = ref<number | null>(null);

const ruleFields = computed(() => SESSION_FIELDS.filter((f) => !!pa.schema.value[f]));

const editingRule = computed<FunnelFilter | undefined>(() =>
  ruleEditing.value === null ? undefined : draft.value.sessions[ruleEditing.value],
);

// Values are listed with every app filter lifted, so a value already hidden can still be picked.
const valuesScope = computed(() => ({ ...pa.scope.value, xall: true }));
const valuesKey = (field: string) => `${pa.scopeKey.value}|all|${field}`;

// Rows from another field or scope must never be offered as this field's values.
const ruleValues = computed<FilterValuesState>(() => {
  const p = valuesPanel.value;
  const field = valuesField.value;
  if (!field || p.key !== valuesKey(field)) return { field, status: "idle", rows: [] };
  if (p.status === "ok")
    return {
      field,
      status: "ok",
      rows: p.rows.map((r) => ({ value: String(r.v), sessions: Number(r.sessions) || 0 })),
    };
  if (p.status === "loading") return { field, status: "loading", rows: [] };
  return {
    field,
    status: p.status === "error" || p.status === "forbidden" ? "error" : "idle",
    rows: [],
  };
});

const ruleLabel = (r: SessionRule): I18nText =>
  t("rum.analytics.funnel.filterChipCondition", {
    field: filterFieldLabel(t, r.field),
    condition: t(`rum.analytics.funnel.conditions.${conditionOf(r).id}`),
    values: raw(r.values.join(", ")),
  });

const pageLabel = (p: PageRule): I18nText =>
  t("rum.analytics.exclusions.pageRule", {
    op: t(`rum.analytics.exclusions.pageOps.${p.op}`),
    value: raw(p.value),
  });

// Counts the filters cannot back with a query stay off the list rather than show a guess.
const viewLines = computed<{ id: string; text: I18nText }[]>(() => {
  const c = appFilters.counts.value;
  const n = (v: number) => addCommasToNumber(v);
  const synthetic =
    c && c.synthetic > 0
      ? [
          {
            id: "synthetic",
            text: t("rum.analytics.appFilters.synthetic", { count: n(c.synthetic) }),
          },
        ]
      : [];
  if (pa.state.includeExcluded) {
    const total = appFilters.hiddenTotal.value;
    const included =
      total === null
        ? t("rum.analytics.appFilters.includedPending")
        : t("rum.analytics.appFilters.included", { count: n(total) }, total);
    return [{ id: "included", text: included }, ...synthetic];
  }
  if (!c) return [];
  const lines = [
    ...(c.builtin
      ? [{ id: "builtin", text: t("rum.analytics.appFilters.builtin", { count: n(c.builtin) }) }]
      : []),
    ...(c.rules
      ? [{ id: "rules", text: t("rum.analytics.appFilters.rules", { count: n(c.rules) }) }]
      : []),
    ...synthetic,
  ];
  return lines.length ? lines : [{ id: "none", text: t("rum.analytics.appFilters.nothingHidden") }];
});

// Under xall the page summary runs with the built-in flag off, so the draft query, which never uses xall, counts it.
const builtinRemoved = computed(() => {
  if (pa.state.includeExcluded) return draftPreview.value?.builtinRemoved ?? null;
  const s = pa.summary.value;
  return s ? Math.max(0, s.totalSessions - s.builtinKeptSessions) : null;
});

// The suggestions read the saved rules, so one the draft already holds is dropped to keep a click from adding it twice.
const suggestions = computed(() =>
  [...suggest.ua.value, ...(suggest.identity.value ? [suggest.identity.value] : [])].filter(
    (s) =>
      !draft.value.sessions.some((r) => r.field === s.rule.field && r.values.includes(s.value)),
  ),
);

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
    setRuleOpen(false);
    setPageOpen(false);
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

// A drawer opened before the rules loaded holds defaults, which Save would write over the stored rules.
watch(saved, (now, before) => {
  if (props.open && now && !before && !conflictRow.value) form.reset(appSettingsDefaults(now));
});

const addRule = (rule: SessionRule) => {
  if (draft.value.sessions.length >= MAX_SESSION_RULES) return;
  form.pushFieldValue("sessions", { ...rule, values: [...rule.values] });
};

const setRuleOpen = (v: boolean) => {
  ruleOpen.value = v;
  if (!v) ruleEditing.value = null;
};

const editRule = (i: number) => {
  setPageOpen(false);
  ruleEditing.value = i;
  ruleOpen.value = true;
};

const removeRule = (i: number) => {
  setRuleOpen(false);
  form.removeFieldValue("sessions", i);
};

const loadRuleValues = (field: string) => {
  valuesField.value = field;
  if (!pa.schema.value[field]) return;
  const key = valuesKey(field);
  const p = valuesPanel.value;
  if (p.key === key && (p.status === "ok" || p.status === "loading")) return;
  void runner.run(
    "rule-values",
    { sql: filterValuesSql(valuesScope.value, field), ...pa.resolveRange(), limit: 20, sampled: 1 },
    key,
  );
};

// An edited `eq` rule stays `eq`, so re-applying it unchanged keeps saved funnels from going stale.
const applyRule = (f: FunnelFilter) => {
  const before = editingRule.value;
  const rule: SessionRule = {
    field: f.field as SessionField,
    op: f.op === "in" && before?.op === "eq" ? "eq" : f.op,
    values: [...new Set(f.values)],
  };
  if (!schema.shape.sessions.element.safeParse(rule).success) {
    toast({
      variant: "error",
      message: t("rum.analytics.exclusions.valuesInvalid", { max: MAX_RULE_VALUES }),
    });
    return;
  }
  if (ruleEditing.value === null) addRule(rule);
  else form.replaceFieldValue("sessions", ruleEditing.value, rule);
  setRuleOpen(false);
};

const setPageOpen = (v: boolean) => {
  pageOpen.value = v;
  if (!v) pageEditing.value = null;
};

const editPage = (i: number) => {
  setRuleOpen(false);
  pageEditing.value = i;
  pageOpen.value = true;
};

const removePage = (i: number) => {
  setPageOpen(false);
  form.removeFieldValue("pages", i);
};

const applyPage = (page: PageRule) => {
  if (pageEditing.value === null) form.pushFieldValue("pages", page);
  else form.replaceFieldValue("pages", pageEditing.value, page);
  setPageOpen(false);
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
