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
  <OForm :form="form" class="flex flex-col gap-5" data-test="autoresolve-saved-form">
    <OFormInput
      name="name"
      :label="t('autoresolve.saved.form.name')"
      required
      data-test="autoresolve-saved-form-name"
    />
    <OFormTextarea
      name="goal"
      :label="t('autoresolve.saved.form.goal')"
      :rows="3"
      autogrow
      :max-rows="10"
      :help-text="editPausesTrigger ? t('autoresolve.saved.form.editPausesHelp') : undefined"
      required
      data-test="autoresolve-saved-form-goal"
    />
    <AutoResolveConnectionPicker
      name="connection_ids"
      :model-value="chosenIds"
      :connections="connectionOptions"
      :max="maxConnections"
      :label="t('autoresolve.saved.form.connections')"
      :removed-ids="[...learnedRemoved]"
      :loading="mcps.isPending.value"
      :help="connectionsHelp"
      required
      test-prefix="autoresolve-saved-form"
      @update:model-value="setConnections"
    >
      <OInlineNotice
        v-if="removedChosen.length"
        ref="removedLine"
        variant="error"
        wrap
        :text="
          t(
            'autoresolve.saved.connectionsRemoved',
            { mcps: theMcpsStart(removedChosen, t) },
            removedChosen.length,
          )
        "
        data-test="autoresolve-saved-form-connections-removed"
      />
    </AutoResolveConnectionPicker>
    <OFormSelect
      name="trigger_kind"
      :label="t('autoresolve.saved.form.runsWhen')"
      :options="kindOptions"
      :help-text="kindHelp"
      required
      data-test="autoresolve-saved-form-runs-when"
    />
    <OFormSelect
      v-if="kind !== 'person'"
      name="trigger_alert_id"
      :label="
        kind === 'incident'
          ? t('autoresolve.saved.form.incidentAlert')
          : t('autoresolve.saved.form.alert')
      "
      :placeholder="t('autoresolve.saved.form.alertPlaceholder')"
      :options="alertOptions"
      :loading="alerts.isPending.value"
      :help-text="alertsHelp"
      searchable
      required
      data-test="autoresolve-saved-form-alert"
    />
    <OBanner
      v-if="kind !== 'person' && !triggersFireHere && slackApprovalAvailable"
      variant="info"
      :content="t('autoresolve.saved.regionNotice')"
      data-test="autoresolve-saved-form-region-notice"
    />

    <div
      class="flex flex-wrap items-center justify-end gap-2"
      data-test="autoresolve-saved-form-actions"
    >
      <OInlineNotice
        v-if="refusal"
        variant="error"
        wrap
        :text="refusal"
        class="min-w-0 flex-1"
        data-test="autoresolve-saved-form-refusal"
      />
      <OButton
        variant="outline"
        size="sm-action"
        data-test="autoresolve-saved-form-cancel"
        @click="emit('cancel')"
      >
        {{ t("common.cancel") }}
      </OButton>
      <OButton
        variant="primary"
        size="sm-action"
        type="submit"
        data-test="autoresolve-saved-form-save"
      >
        {{ saved ? t("autoresolve.saved.form.saveChanges") : t("autoresolve.saved.form.save") }}
      </OButton>
    </div>
  </OForm>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useMutation, useQuery } from "@tanstack/vue-query";
import OButton from "@/lib/core/Button/OButton.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OInlineNotice from "@/lib/feedback/InlineNotice/OInlineNotice.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import { useOForm } from "@/lib/forms/Form/useOForm";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormTextarea from "@/lib/forms/Input/OFormTextarea.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import AutoResolveConnectionPicker from "@/components/autoresolve/AutoResolveConnectionPicker.vue";
import { useOrgId } from "@/composables/query/useOrgId";
import {
  autoresolveErrorConnection,
  autoresolveErrorStatus,
  DEFAULT_MAX_CONNECTIONS,
  isForbidden,
  type AutoResolveConnectionRef,
  type AutoResolveRun,
  type AutoResolveSaved,
  type AutoResolveSavedInput,
} from "@/services/autoresolve";
import {
  createAutoResolveSavedMutation,
  updateAutoResolveSavedMutation,
} from "@/services/autoresolve.queries";
import { alertsListQuery } from "@/services/alerts.queries";
import { mcpToolsetsQuery } from "@/services/ai_toolsets.queries";
import productAnalytics from "@/services/product_analytics";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import {
  connectionLimitText,
  noMcpsText,
  savedRefusal,
  theMcps,
  theMcpsStart,
} from "@/utils/autoresolve/autoresolveText";
import {
  autoresolveSavedDefaults,
  makeAutoResolveSavedSchema,
  removedRunConnections,
  runConnectionRefs,
  type AutoResolveSavedFormValues,
} from "./AutoResolveSavedForm.schema";

const props = withDefaults(
  defineProps<{
    /** The AutoResolve being edited; absent when saving a new one. */
    saved?: AutoResolveSaved | null;
    /** The finished run a new AutoResolve is saved from. */
    fromRun?: AutoResolveRun | null;
    triggersFireHere: boolean;
    /** False: alert and incident triggers cannot be turned on, so only a person can start it. */
    slackApprovalAvailable?: boolean;
    maxConnections?: number;
  }>(),
  {
    saved: null,
    fromRun: null,
    slackApprovalAvailable: true,
    maxConnections: DEFAULT_MAX_CONNECTIONS,
  },
);

const emit = defineEmits<{ saved: [view: AutoResolveSaved]; cancel: [] }>();

const SLACK = raw("Slack");

const { t } = useI18nTyped();
const orgId = useOrgId();

const create = useMutation(() => createAutoResolveSavedMutation(orgId.value));
const update = useMutation(() => updateAutoResolveSavedMutation(orgId.value));
const refusal = ref<I18nText | null>(null);

const onSubmit = async (value: AutoResolveSavedFormValues) => {
  refusal.value = null;
  // The server refuses a removed connection with the sentence the red line already shows.
  if (removedChosen.value.length) {
    removedLine.value?.$el?.scrollIntoView?.({ block: "nearest" });
    return;
  }
  const body: AutoResolveSavedInput = {
    name: value.name.trim(),
    goal: value.goal.trim(),
    connection_ids: [...value.connection_ids],
    trigger_kind: value.trigger_kind,
    trigger_alert_id: value.trigger_kind === "person" ? null : value.trigger_alert_id,
    from_run_id: props.saved ? null : (props.fromRun?.id ?? null),
  };
  try {
    const view = props.saved
      ? await update.mutateAsync({ id: props.saved.id, body })
      : await create.mutateAsync(body);
    if (!props.saved) {
      productAnalytics.track("autoresolve_saved", {
        trigger_kind: body.trigger_kind,
        from_run: !!body.from_run_id,
      });
    }
    emit("saved", view);
  } catch (err) {
    refusal.value = savedRefusal(err, t);
    // The not-MCP 400 names a connection too, so only the removed flag marks it removed.
    const named = autoresolveErrorConnection(err);
    if (autoresolveErrorStatus(err) === 400 && named?.removed === true) {
      learnedRemoved.value.add(named.id);
    }
  }
};

// Saving needs Update on every chosen MCP, so only those are offered.
const mcps = useQuery(() =>
  Object.assign(mcpToolsetsQuery(orgId.value, "update"), { enabled: !!orgId.value }),
);
const learnedRemoved = ref(new Set<string>());

const form = useOForm({
  defaultValues: autoresolveSavedDefaults({ saved: props.saved, run: props.fromRun }),
  schema: makeAutoResolveSavedSchema(t),
  onSubmit,
});
const kind = form.useStore((s) => s.values.trigger_kind);
const chosenIds = form.useStore((s) => s.values.connection_ids);

const editPausesTrigger = computed(
  () => !!props.saved && props.saved.trigger.kind !== "person" && props.saved.trigger.enabled,
);

// A chosen MCP this person cannot update, or one since removed, stays under its stored name.
const connectionOptions = computed<AutoResolveConnectionRef[]>(() => {
  const all = new Map((mcps.data.value?.mcps ?? []).map((c) => [c.id, { id: c.id, name: c.name }]));
  const stored =
    props.saved?.connections ?? (props.fromRun ? runConnectionRefs(props.fromRun) : []);
  const chosen = new Set(chosenIds.value);
  for (const c of stored) if (chosen.has(c.id) && !all.has(c.id)) all.set(c.id, c);
  return [...all.values()];
});

// A removal learned from a save refusal is said once, by the refusal in the button row.
const removedChosen = computed(() => {
  const removed = new Map(
    connectionOptions.value.filter((c) => c.removed === true).map((c) => [c.id, c.name]),
  );
  return chosenIds.value.flatMap((id) => (removed.has(id) ? [removed.get(id) ?? ""] : []));
});
const removedLine = ref<{ $el?: HTMLElement } | null>(null);
const setConnections = (ids: string[]) => form.setFieldValue("connection_ids", ids);

// Only a new AutoResolve takes the one MCP on offer; an edit or Save as keeps what it was given.
watch(
  () => mcps.data.value?.mcps,
  (list) => {
    if (props.saved || props.fromRun || list?.length !== 1 || chosenIds.value.length) return;
    setConnections([list[0].id]);
  },
  { immediate: true },
);

const notFilledIn = computed(() =>
  !props.saved && props.fromRun ? removedRunConnections(props.fromRun).map((c) => c.name) : [],
);
// Empty is the required field's own error, so only the cap is said here, as the goal box says it.
const connectionsHelp = computed<I18nText>(() => {
  if (mcps.isError.value) return t("autoresolve.saved.form.connectionsFailed");
  if (mcps.data.value?.mcps.length === 0) return noMcpsText(t, mcps.data.value.canCreate);
  if (notFilledIn.value.length) {
    return t(
      "autoresolve.saved.form.connectionsNotFilled",
      { mcps: theMcps(notFilledIn.value, t) },
      notFilledIn.value.length,
    );
  }
  const limit = chosenIds.value.length
    ? connectionLimitText(chosenIds.value.length, props.maxConnections, t)
    : null;
  return limit ?? t("autoresolve.saved.form.connectionsHelp");
});

const noTriggers = computed(() => !props.slackApprovalAvailable);
const kindOptions = computed(() => [
  { label: t("autoresolve.saved.kind.person"), value: "person" },
  { label: t("autoresolve.saved.kind.alert"), value: "alert", disabled: noTriggers.value },
  { label: t("autoresolve.saved.kind.incident"), value: "incident", disabled: noTriggers.value },
]);

const kindHelp = computed<I18nText | undefined>(() => {
  if (noTriggers.value) return t("autoresolve.saved.slackUnavailable");
  if (!props.saved && kind.value !== "person") {
    return t("autoresolve.saved.form.createTriggerHelp", { slack: SLACK });
  }
  return undefined;
});

// A new AutoResolve saved from a triggered run could not be saved with that trigger here.
watch(
  noTriggers,
  (off) => {
    if (off && !props.saved && kind.value !== "person")
      form.setFieldValue("trigger_kind", "person");
  },
  { immediate: true },
);

const alerts = useQuery(() =>
  Object.assign(alertsListQuery(orgId.value, "", undefined, undefined, { silentForbidden: true }), {
    enabled: !!orgId.value && kind.value !== "person",
  }),
);
const alertOptions = computed(() => {
  const rows = (alerts.data.value ?? []) as { alert_id: string; name: string }[];
  const options = rows.map((a) => ({ label: raw(a.name), value: a.alert_id }));
  const stored = props.saved?.trigger.alert_id;
  if (stored && !rows.some((a) => a.alert_id === stored)) {
    const name = props.saved?.trigger.alert_name;
    options.push({
      label: name ? raw(name) : t("autoresolve.saved.form.alertGone"),
      value: stored,
    });
  }
  return options;
});

const alertsHelp = computed<I18nText | undefined>(() => {
  if (alerts.isPending.value && !alerts.error.value) return undefined;
  if (alerts.error.value) {
    return isForbidden(alerts.error.value)
      ? t("autoresolve.saved.form.alertsForbidden")
      : t("autoresolve.saved.form.alertsFailed");
  }
  return alertOptions.value.length ? undefined : t("autoresolve.saved.form.alertsNone");
});
</script>
