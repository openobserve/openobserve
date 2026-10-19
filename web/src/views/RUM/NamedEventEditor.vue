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
  <OForm :form="form" class="h-full w-full">
    <OPageLayout
      data-test="rum-analytics-event-editor"
      :title="id ? t('rum.analytics.events.editTitle') : t('rum.analytics.events.createTitle')"
      :subtitle="app ? t('rum.analytics.events.editorApp', { app: raw(app) }) : undefined"
      :back="{ label: backLabel, onClick: goBack, dataTest: 'rum-analytics-event-editor-back-btn' }"
      bleed
    >
      <OEmptyState
        v-if="!formReady && status === 'forbidden'"
        preset="no-access"
        :description="t('rum.analytics.events.noAccess')"
        data-test="rum-analytics-event-editor-no-access"
      />
      <OEmptyState
        v-else-if="!formReady && status === 'failed'"
        preset="load-error"
        :description="t('rum.analytics.events.loadFailed')"
        data-test="rum-analytics-event-editor-load-error"
        @action="retry"
      />
      <div v-else-if="!formReady" class="flex h-full items-center justify-center">
        <OSpinner />
      </div>
      <template v-else>
        <div class="min-h-0 flex-1 overflow-auto">
          <div
            class="mx-auto flex w-full max-w-4xl flex-col gap-4 px-6 py-5 max-md:px-4"
            data-test="rum-analytics-named-events-form"
          >
            <OFormSection :title="t('rum.analytics.events.details')">
              <div class="py-1">
                <OFormInput
                  name="name"
                  :label="t('rum.analytics.events.name')"
                  required
                  data-test="rum-analytics-named-events-name"
                />
              </div>
            </OFormSection>
            <OFormSection :title="t('rum.analytics.events.rules')" required>
              <div class="flex flex-col gap-2 py-1">
                <span class="text-text-secondary text-xs">{{
                  t("rum.analytics.events.rulesHelp")
                }}</span>
                <NamedEventRuleRow
                  v-for="(_, i) in ruleRows"
                  :key="i"
                  :index="i"
                  :page-options="pageOptions"
                  :click-options="clickOptions"
                  :removable="ruleRows.length > 1"
                  @remove="form.removeFieldValue('rules', i)"
                />
                <OButton
                  variant="ghost"
                  size="sm"
                  icon-left="add"
                  class="self-start"
                  :disabled="ruleRows.length >= MAX_RULES"
                  data-test="rum-analytics-named-events-add-rule-btn"
                  @click="form.pushFieldValue('rules', emptyRule())"
                  >{{ t("rum.analytics.events.addRule") }}</OButton
                >
                <span
                  class="text-text-secondary text-xs"
                  data-test="rum-analytics-named-events-preview"
                  >{{ previewText }}</span
                >
                <span
                  v-if="noParamMatch"
                  class="text-text-secondary flex flex-wrap items-center gap-1 text-xs"
                  data-test="rum-analytics-named-events-preview-no-param"
                  >{{ t("rum.analytics.events.previewNoParam") }}
                  <OButton
                    as="a"
                    variant="ghost-primary"
                    size="xs"
                    :href="logsHref"
                    target="_blank"
                    rel="noopener noreferrer"
                    data-test="rum-analytics-named-events-preview-logs-link"
                    >{{ t("rum.analytics.events.openInLogs") }}</OButton
                  ></span
                >
              </div>
            </OFormSection>
          </div>
        </div>
        <footer
          class="bg-surface-base border-border-default sticky bottom-0 z-1 flex shrink-0 items-center justify-end gap-2 border-t px-5.5 py-3"
        >
          <OButton
            type="button"
            variant="outline"
            size="sm-action"
            :disabled="submitting"
            data-test="rum-analytics-event-editor-cancel-btn"
            @click="goBack"
            >{{ t("rum.analytics.events.cancel") }}</OButton
          >
          <OButton
            type="submit"
            variant="primary"
            size="sm-action"
            :loading="submitting"
            :disabled="!canWrite"
            data-test="rum-analytics-event-editor-save-btn"
            >{{ id ? t("rum.analytics.events.save") : t("rum.analytics.events.create") }}</OButton
          >
        </footer>
      </template>
    </OPageLayout>
  </OForm>

  <ConfirmDialog
    v-model="leaveDialog.show"
    :title="t('rum.analytics.events.discardTitle')"
    :message="t('rum.analytics.events.discardMessage')"
    data-test="rum-analytics-event-editor-discard-dialog"
    @update:ok="leaveDialog.onConfirm"
    @update:cancel="leaveDialog.show = false"
  />
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from "vue";
import {
  onBeforeRouteLeave,
  onBeforeRouteUpdate,
  useRoute,
  useRouter,
  type NavigationGuardWithThis,
  type RouteLocationRaw,
} from "vue-router";
import { useStore } from "vuex";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OFormSection from "@/lib/core/FormSection/OFormSection.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import { setServerFieldErrors, useOForm } from "@/lib/forms/Form/useOForm";
import { toast } from "@/lib/feedback/Toast/useToast";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import NamedEventRuleRow from "@/components/rum/productAnalytics/NamedEventRuleRow.vue";
import useNamedEvents, { readNamedEventHandoff } from "@/composables/rum/useNamedEvents";
import useProductAnalytics from "@/composables/rum/useProductAnalytics";
import useAnalyticsSearch from "@/composables/rum/useAnalyticsSearch";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { addCommasToNumber, b64EncodeUnicode } from "@/utils/formatters";
import { sqlEquals } from "@/utils/query/sqlFilterBuilder";
import {
  MAX_RULES,
  parseNamedEventDraft,
  type NamedEvent,
  type NamedRule,
} from "@/utils/rum/productAnalyticsModel";
import { rumPaError } from "@/utils/rum/rumPaApiError";
import { stepPredicateRaw } from "@/utils/rum/productAnalyticsQueries";
import { PA_ROUTES, SUBTAB_ROUTES } from "@/utils/rum/productAnalyticsRoutes";
import {
  emptyRule,
  makeNamedEventSchema,
  namedEventDefaults,
  toRules,
  type NamedEventForm,
  type RuleOp,
} from "./NamedEventEditor.schema";

defineOptions({ name: "NamedEventEditor" });

const NEW = "new";
const PREVIEW_DEBOUNCE_MS = 400;
const PREVIEW_DAYS = 7;
const DAY_US = 86_400_000_000;

const props = defineProps<{ id?: string }>();

const { t } = useI18nTyped();
const route = useRoute();
const router = useRouter();
const store = useStore();
const pa = useProductAnalytics();
const ne = useNamedEvents();
const canWrite = computed(() => ne.permission.value === "write");
const runner = useAnalyticsSearch();
const handoff = readNamedEventHandoff(router.options.history.state);

const editingId = ref<string | null>(props.id ?? null);
// The version of the event the form was filled from; a save is an edit of that version only.
let openedVersion: number | undefined;
// The id (or NEW) whose values the form holds; the form shows only once it matches the route.
const formFor = ref<string | null>(null);
const pageOptions = ref<string[]>([]);
const clickOptions = ref<string[]>([]);
const previewPanel = runner.panel<Record<string, number>>("preview");
const leaveDialog = reactive({ show: false, onConfirm: () => {} });
let previewTimer: ReturnType<typeof setTimeout> | null = null;
let generation = 0;
let allowLeave = false;
let inFlight = false;
// A submit whose validation was still pending when the save landed must not create again.
let landed = false;
let alive = true;

const org = (): string => store.state.selectedOrganization?.identifier ?? "";
const app = computed(() => pa.state.app);
const status = computed(() => ne.status(org(), app.value));
const formReady = computed(() => formFor.value === (props.id ?? NEW));

const fold = (name: string) => name.trim().toLowerCase();
// The server folds names the same way and stays authoritative through duplicate_name.
const nameTaken = (name: string) =>
  ne.events.value.some((e) => e.id !== editingId.value && fold(e.name) === fold(name));

const form = useOForm<NamedEventForm>({
  defaultValues: namedEventDefaults(props.id ? null : handoff.draft),
  schema: makeNamedEventSchema(t, nameTaken),
  onSubmit: (value) => submit(value),
});
const ruleRows = form.useStore((s: { values: NamedEventForm }) => s.values.rules ?? []);
const values = form.useStore((s: { values: NamedEventForm }) => s.values);
const submitting = form.useStore((s: { isSubmitting: boolean }) => s.isSubmitting);
// Compared by value: OFormCombobox writes its empty value on mount, which sets TanStack's isDirty on a pristine form.
const baseline = ref(JSON.stringify(form.state.values));
const dirty = computed(() => JSON.stringify(values.value) !== baseline.value);

const backLabel = computed<I18nText>(() =>
  handoff.from && !props.id
    ? t(`rum.analytics.subtabs.${handoff.from}`)
    : t("rum.analytics.events.title"),
);

const returnLocation = () => ({
  name: handoff.from && !props.id ? SUBTAB_ROUTES[handoff.from] : PA_ROUTES.events,
  query: route.query,
});
const listLocation = () => ({ name: PA_ROUTES.events, query: route.query });

const previewText = computed<I18nText>(() => {
  const p = previewPanel.value;
  if (p.status === "loading") return t("rum.analytics.events.previewLoading");
  if (p.status !== "ok") return raw("");
  const n = Number(p.rows[0]?.e0_sessions ?? 0);
  return t("rum.analytics.events.preview", { count: addCommasToNumber(n) }, n);
});

const draftEvent = (rules: NamedRule[]): NamedEvent | null => {
  const parsed = parseNamedEventDraft(
    { app: app.value, name: values.value.name || "preview", rules },
    app.value,
  );
  return parsed
    ? {
        ...parsed,
        id: "preview",
        version: 1,
        createdBy: "",
        createdAt: 0,
        updatedBy: "",
        updatedAt: 0,
      }
    : null;
};

const paramRules = computed(() =>
  toRules(values.value.rules ?? []).filter((r) => r.t === "view" && r.op === "param"),
);

const noParamMatch = computed(() => {
  const p = previewPanel.value;
  return p.status === "ok" && !Number(p.rows[0]?.e0_sessions ?? 0) && paramRules.value.length > 0;
});

// Logs gets the same predicate the preview counted, so the analyst can read the raw URLs.
const logsHref = computed(() => {
  const ev = draftEvent(paramRules.value);
  if (!ev) return "";
  const where = `${sqlEquals("application_id", app.value)} AND ${stepPredicateRaw({ kind: "e", key: ev.id }, pa.scope.value, [ev])}`;
  return router.resolve({
    name: "logs",
    query: {
      org_identifier: org(),
      stream_type: "logs",
      stream: "_rumdata",
      period: `${PREVIEW_DAYS}d`,
      sql_mode: "false",
      // Standard padding: Logs decodes either form, and plain base64 readers need it.
      query: (b64EncodeUnicode(where) ?? "").replace(/\./g, "="),
    },
  }).href;
});

// Ref and error rules read columns a stream may not have, and a query naming one would fail.
const previewable = (rules: NamedRule[]): boolean =>
  rules.every((r) =>
    r.t === "error"
      ? pa.scope.value.schema.error_message
      : r.t !== "view" || r.op !== "ref" || pa.scope.value.schema.view_referrer,
  );

const loadOptions = async () => {
  const options = await pa.pickerOptions();
  pageOptions.value = [
    ...new Set([...handoff.pageHints, ...options.filter((o) => o.kind === "p").map((o) => o.key)]),
  ];
  clickOptions.value = options.filter((o) => o.kind === "c").map((o) => o.key);
};

// A cold link carries the scope in its query; arriving from the shell, the scope is already this app's.
const prepareScope = async () => {
  const linked = route.query.app;
  if (typeof linked === "string" && linked && linked !== pa.state.app)
    pa.initFromRoute(route.query);
  await pa.loadScope();
};

const leave = (to: RouteLocationRaw) => {
  allowLeave = true;
  void router.push(to);
};

const fillForm = (): boolean => {
  if (!props.id) {
    form.reset(namedEventDefaults(handoff.draft));
    return true;
  }
  const ev = ne.events.value.find((e) => e.id === props.id);
  if (!ev) {
    toast({ variant: "error", message: t("rum.analytics.events.notFound") });
    allowLeave = true;
    void router.replace(listLocation());
    return false;
  }
  form.reset(namedEventDefaults(ev));
  openedVersion = ev.version;
  return true;
};

const open = async () => {
  const gen = ++generation;
  allowLeave = false;
  landed = false;
  editingId.value = props.id ?? null;
  await prepareScope();
  if (gen !== generation || !alive) return;
  const ready = await ne.ensure(org(), app.value);
  if (gen !== generation || !alive || ready !== "ready") return;
  const target = props.id ?? NEW;
  if (formFor.value !== target && fillForm()) {
    formFor.value = target;
    baseline.value = JSON.stringify(form.state.values);
  }
  void loadOptions();
};

const retry = async () => {
  await ne.ensure(org(), app.value, true);
  await open();
};

async function submit(value: NamedEventForm) {
  if (inFlight || landed) return;
  const gen = generation;
  inFlight = true;
  try {
    const res = await ne.save(org(), app.value, {
      id: editingId.value ?? undefined,
      version: openedVersion,
      app: app.value,
      name: value.name.trim(),
      rules: toRules(value.rules),
    });
    // The refusal was toasted; the draft stays on screen so it is not lost.
    if (res.kind === "forbidden") return;
    landed = true;
    if (gen === generation && alive) leave(returnLocation());
  } catch (e) {
    if (gen !== generation || !alive) return;
    const { code } = rumPaError(e);
    if (code === "duplicate_name") {
      setServerFieldErrors(form, { name: t("rum.analytics.events.duplicateName") });
    } else if (code === "not_found") {
      editingId.value = null;
    }
  } finally {
    inFlight = false;
  }
}

const goBack = () => {
  void router.push(returnLocation());
};

const schedulePreview = () => {
  if (previewTimer) clearTimeout(previewTimer);
  previewTimer = setTimeout(() => {
    previewTimer = null;
    const draft = draftEvent(toRules(values.value.rules ?? []));
    if (!draft || !formReady.value) return;
    // Counting before the app's rules are known would ignore its exclusions.
    if (!pa.rulesReady.value) {
      runner.hold("preview", "loading");
      return;
    }
    if (!previewable(draft.rules)) {
      runner.hold("preview", "idle");
      return;
    }
    const endUs = Date.now() * 1000;
    const startUs = endUs - PREVIEW_DAYS * DAY_US;
    const sql = pa.eventPreviewSql(draft.rules);
    if (!sql) return;
    void runner.run(
      "preview",
      { sql, startUs, endUs, limit: 1, sampled: 1 },
      JSON.stringify(draft.rules),
    );
  }, PREVIEW_DEBOUNCE_MS);
};

// A save in flight carries the edits with it, so leaving then needs no discard prompt.
const guardLeave: NavigationGuardWithThis<undefined> = (to, _from, next) => {
  if (allowLeave || inFlight || !dirty.value) {
    next();
    return;
  }
  // Cancel and ask in a dialog: browsers suppress confirm() during navigation.
  next(false);
  const destination = to.fullPath;
  leaveDialog.onConfirm = () => {
    leaveDialog.show = false;
    allowLeave = true;
    void router.push(destination);
  };
  leaveDialog.show = true;
};

watch(values, schedulePreview, { deep: true });
watch(formReady, (ready) => ready && schedulePreview());
// The preview waits for the app's rules, so it runs once they arrive.
watch(pa.rulesReady, (ready) => ready && schedulePreview());
watch(
  () => values.value.name,
  () => setServerFieldErrors(form, {}),
);
watch(() => props.id, open, { immediate: true });

onBeforeRouteLeave(guardLeave);
onBeforeRouteUpdate(guardLeave);

onBeforeUnmount(() => {
  alive = false;
  if (previewTimer) clearTimeout(previewTimer);
  runner.abortAll();
});

defineExpose({
  setRuleOp: (i: number, op: RuleOp) => form.setFieldValue(`rules[${i}].op`, op),
});
</script>
