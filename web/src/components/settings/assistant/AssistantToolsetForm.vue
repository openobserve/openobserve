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
  <section class="flex max-w-2xl flex-col gap-4" data-test="ai-toolset-form">
    <div class="flex flex-wrap items-center gap-2">
      <OButton
        variant="ghost"
        size="sm"
        class="max-md:min-h-11"
        data-test="ai-toolset-back-btn"
        @click="close"
        >{{ t("assistant.toolsets.form.back") }}</OButton
      >
      <h2 class="text-text-heading text-base font-semibold" data-test="ai-toolset-form-title">
        {{
          isEdit ? t("assistant.toolsets.form.editTitle") : t("assistant.toolsets.form.newTitle")
        }}
      </h2>
    </div>
    <div
      v-if="editId && record.isPending.value"
      class="flex flex-col gap-3"
      data-test="ai-toolset-form-loading"
    >
      <OSkeleton v-for="n in 5" :key="n" type="rect" class="h-9 w-full" />
    </div>
    <div
      v-else-if="isEdit && (!editId || record.isError.value)"
      class="flex flex-col items-start gap-3"
      data-test="ai-toolset-form-load-error"
    >
      <p class="text-text-body text-sm">{{ t("assistant.toolsets.form.loadFailed") }}</p>
      <div class="flex flex-wrap gap-2">
        <OButton
          v-if="editId"
          variant="outline"
          size="sm-action"
          data-test="ai-toolset-form-retry"
          @click="record.refetch()"
        >
          {{ t("common.retry") }}
        </OButton>
        <OButton variant="ghost" size="sm-action" data-test="ai-toolset-form-back" @click="close">
          {{ t("assistant.toolsets.form.back") }}
        </OButton>
      </div>
    </div>
    <OForm v-else :form="form" class="flex flex-col gap-4" v-slot="{ isSubmitting }">
      <p v-if="needsRetype" class="text-text-body text-sm" data-test="ai-toolset-retype-notice">
        {{ t("assistant.toolsets.form.retypeNotice") }}
      </p>
      <p
        v-if="reenter"
        role="status"
        class="text-status-warning-text text-sm"
        data-test="ai-toolset-reenter-notice"
      >
        {{ t(REENTER_COPY[reenter]) }}
      </p>
      <OBanner v-if="formError" variant="error" data-test="ai-toolset-form-error">{{
        formError
      }}</OBanner>
      <div class="flex flex-col gap-1">
        <OFormInput
          name="name"
          :label="t('aiToolset.name')"
          required
          :readonly="isEdit"
          :disabled="isEdit"
          data-test="ai-toolset-name-input"
        />
        <p v-if="agentName" class="text-text-secondary text-xs" data-test="ai-toolset-agent-name">
          {{ t("assistant.toolsets.form.agentName", { agent: agentName }) }}
        </p>
      </div>
      <OFormSelect
        name="kind"
        :label="t('aiToolset.kind')"
        required
        :options="kindOptions"
        label-key="label"
        value-key="value"
        :aria-label="t('aiToolset.kind')"
        :disabled="isEdit"
        :help-text="isEdit ? t('assistant.toolsets.form.kindLocked') : undefined"
        data-test="ai-toolset-kind-select"
      />
      <OFormTextarea
        name="description"
        :label="t('assistant.toolsets.form.descriptionLabel')"
        :help-text="t('assistant.toolsets.form.descriptionHelp')"
        data-test="ai-toolset-description-input"
      />

      <template v-if="kind === 'mcp'">
        <h3 class="text-text-heading text-sm font-semibold">
          {{ t("assistant.toolsets.form.mcpSection") }}
        </h3>
        <OFormInput
          name="mcp.url"
          :label="t('aiToolset.mcpUrl')"
          required
          data-test="ai-toolset-mcp-url"
        />
        <OFormInput
          name="mcp.timeout_seconds"
          type="number"
          min="1"
          :label="t('aiToolset.timeoutSeconds')"
          data-test="ai-toolset-mcp-timeout"
        />
        <AssistantToolsetSecretRows
          :form="form"
          field="mcp.headers"
          kind="header"
          :rows="headers"
        />
      </template>

      <AssistantToolsetCliFields v-if="kind === 'cli'" :form="form" :editing="isEdit" />

      <template v-if="kind === 'skill'">
        <div class="flex flex-wrap items-center gap-2">
          <h3 class="text-text-heading text-sm font-semibold">{{ t("aiToolset.skillContent") }}</h3>
          <OButton
            v-if="!skillContent.trim()"
            variant="ghost-primary"
            size="xs"
            data-test="ai-toolset-skill-template"
            @click="setSkill(t('assistant.toolsets.form.skillTemplate'))"
            >{{ t("assistant.toolsets.form.insertTemplate") }}</OButton
          >
        </div>
        <QueryEditor
          data-test="ai-toolset-skill-content"
          editor-id="assistant-skill-content-editor"
          class="rounded-default border-border-default min-h-80 w-full resize-y overflow-auto border"
          language="markdown"
          :query="skillContent"
          @update:query="setSkill"
        />
        <p v-if="skillError" class="text-status-error-text text-xs">
          {{ t("aiToolset.skillContentRequired") }}
        </p>
      </template>

      <div
        class="border-border-default bg-surface-base sticky bottom-0 flex flex-wrap gap-2 border-t py-3"
      >
        <OButton
          type="submit"
          variant="primary"
          size="sm-action"
          class="max-md:min-h-11"
          :loading="isSubmitting"
          data-test="ai-toolset-save-btn"
          >{{ t("common.save") }}</OButton
        >
        <OButton
          variant="outline"
          size="sm-action"
          class="max-md:min-h-11"
          :disabled="isSubmitting"
          data-test="ai-toolset-cancel-btn"
          @click="close"
          >{{ t("common.cancel") }}</OButton
        >
      </div>
    </OForm>
  </section>
</template>

<script setup lang="ts">
import { useMutation, useQuery } from "@tanstack/vue-query";
import { computed, defineAsyncComponent, nextTick, ref, watch } from "vue";
import { onBeforeRouteUpdate } from "vue-router";

import {
  askLeaveGuard,
  useAssistantLeaveGuard,
  useAssistantName,
  type LeaveGuard,
} from "@/composables/assistant";
import { useConfirmDialog } from "@/composables/useConfirmDialog";
import OButton from "@/lib/core/Button/OButton.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import OForm from "@/lib/forms/Form/OForm.vue";
import { setServerFieldErrors, useOForm } from "@/lib/forms/Form/useOForm";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormTextarea from "@/lib/forms/Input/OFormTextarea.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import {
  createToolsetMutation,
  toolsetQuery,
  updateToolsetMutation,
} from "@/services/assistant_toolsets.queries";
import { raw, useI18nTyped, type I18nKey, type I18nText } from "@/types/i18n";

import {
  keptSecretPaths,
  makeToolsetFormSchema,
  reenterReason,
  toolsetDataOf,
  toolsetFormDefaults,
  toolsetFormOf,
  type ReenterReason,
  type SecretRow,
  type ToolsetFormValues,
} from "./AssistantToolsetForm.schema";
import AssistantToolsetCliFields from "./AssistantToolsetCliFields.vue";
import AssistantToolsetSecretRows from "./AssistantToolsetSecretRows.vue";
import { agentNameOf, type ToolsetRow } from "./assistantToolsets";
import { useAssistantSettingsPage } from "./useAssistantSettingsPage";

const REENTER_COPY: Record<ReenterReason | "refused", I18nKey> = {
  destination: "assistant.toolsets.form.reenterDestination",
  secret: "assistant.toolsets.form.reenterSecret",
  refused: "assistant.toolsets.form.reenterRefused",
};

const QueryEditor = defineAsyncComponent(() => import("@/components/CodeQueryEditor.vue"));

const props = withDefaults(
  defineProps<{
    mode?: "add" | "edit";
    editId?: string;
    existing: ToolsetRow[];
    mergeSecrets: boolean;
  }>(),
  { mode: "add", editId: undefined },
);
const emit = defineEmits<{ (e: "done"): void; (e: "forbidden"): void }>();

const { t } = useI18nTyped();
const name = useAssistantName();
const page = useAssistantSettingsPage();
const { confirm } = useConfirmDialog();
// The org the form opened in is the one every request goes to.
const org = page.org.value;
const orgName = page.orgName.value;
// `?action=edit` without an id stays an edit that failed to load, never a create form.
const isEdit = props.mode === "edit" || !!props.editId;

const record = useQuery(
  computed(() => ({ ...toolsetQuery(org, props.editId ?? ""), enabled: !!props.editId })),
);
const create = useMutation(() => createToolsetMutation(org));
const update = useMutation(() => updateToolsetMutation(org));

const kindOptions = [
  { label: t("assistant.toolsets.kinds.mcp"), value: "mcp" },
  { label: t("assistant.toolsets.kinds.cli"), value: "cli" },
  { label: t("assistant.toolsets.kinds.skill"), value: "skill" },
];

const taken = computed(
  () =>
    new Set(props.existing.filter((row) => row.id !== props.editId).map((row) => row.agentName)),
);
const loaded = ref<ToolsetFormValues | null>(null);
const formError = ref<I18nText | string>("");
// Kept once the kept secrets were turned into fields, so the reason stays next to them.
const forced = ref<ReenterReason | "refused" | null>(null);

const form = useOForm<ToolsetFormValues>({
  defaultValues: toolsetFormDefaults(),
  schema: makeToolsetFormSchema(t as never, {
    isTaken: (agent) => taken.value.has(agent),
    editing: isEdit,
    mergeSecrets: props.mergeSecrets,
  }),
  onSubmit: save,
});

const kind = form.useStore((s) => s.values.kind);
const headers = form.useStore((s): SecretRow[] => s.values.mcp.headers);
const secretCount = form.useStore(
  (s) => s.values.mcp.headers.length + s.values.cli.env.length + s.values.cli.credFiles.length,
);
const values = form.useStore((s) => s.values);
const skillContent = form.useStore((s) => s.values.skill.content ?? "");
const typedName = form.useStore((s) => s.values.name);
const submitted = form.useStore((s) => s.submissionAttempts > 0);
const dirty = form.useStore((s) => s.isDirty);

const agentName = computed(() => (typedName.value ? agentNameOf(typedName.value) : ""));
const skillError = computed(
  () => submitted.value && kind.value === "skill" && !skillContent.value.trim(),
);
const needsRetype = computed(() => isEdit && !props.mergeSecrets && secretCount.value > 0);
const reenter = computed<ReenterReason | "refused" | null>(
  () => reenterReason(values.value, loaded.value, props.mergeSecrets) ?? forced.value,
);

watch(
  () => record.data.value,
  (data) => {
    if (!data) return;
    const next = toolsetFormOf(data, props.mergeSecrets);
    loaded.value = structuredClone(next);
    form.reset(next);
  },
  { immediate: true },
);

const leaveGuard: LeaveGuard = {
  host: "settings",
  isDirty: () => dirty.value,
  name: () =>
    t("assistant.toolsets.form.leaveName", {
      name: typedName.value || t("assistant.toolsets.form.newTitle"),
      org: orgName,
    }),
};
useAssistantLeaveGuard(leaveGuard);
// The form lives on the settings route, so Back, Cancel, a tab or `?action` change are route updates.
onBeforeRouteUpdate((to, from) => {
  const same =
    to.params.tab === from.params.tab &&
    to.query.action === from.query.action &&
    to.query.id === from.query.id;
  return same || askLeaveGuard(leaveGuard);
});

function close() {
  emit("done");
}

function setSkill(value: string) {
  form.setFieldValue("skill.content", value);
}

async function confirmApprovalOff(values: ToolsetFormValues): Promise<boolean> {
  if (!isEdit || values.kind !== "cli" || values.cli.requires_confirmation) return true;
  if (loaded.value?.cli.requires_confirmation !== true) return true;
  return confirm({
    title: t("assistant.toolsets.form.approvalOffTitle", { command: values.cli.command }),
    message: t("assistant.toolsets.form.approvalOffMessage", {
      allow: values.cli.allowed_subcommands_raw,
    }),
    confirmLabel: t("assistant.toolsets.form.approvalOffConfirm"),
    confirmVariant: "destructive",
    focusCancel: true,
  });
}

/** Turns every kept secret into a required field and moves focus to the first one. */
async function requireKeptSecrets(paths: string[]) {
  for (const path of paths) {
    form.setFieldValue(`${path}.state` as never, "replacing" as never);
    form.setFieldValue(`${path}.value` as never, "" as never);
  }
  await nextTick();
  const first = document.querySelector<HTMLElement>(
    '[data-test="ai-toolset-form"] [data-state="replacing"] input, [data-test="ai-toolset-form"] textarea[data-test$="-editor-field"]',
  );
  first?.focus();
}

async function save(values: ToolsetFormValues) {
  formError.value = "";
  if (org !== page.org.value) return;
  const reason = reenterReason(values, loaded.value, props.mergeSecrets);
  if (reason) {
    forced.value = reason;
    await requireKeptSecrets(keptSecretPaths(values));
    return;
  }
  if (!(await confirmApprovalOff(values))) return;
  const data = toolsetDataOf(values, props.mergeSecrets);
  try {
    if (props.editId) {
      const body = { description: values.description, data };
      await update.mutateAsync({ id: props.editId, body });
      toast({ variant: "success", message: t("assistant.toolsets.form.updated") });
    } else {
      const description = values.description || undefined;
      await create.mutateAsync({ name: values.name, kind: values.kind, description, data });
      toast({
        variant: "success",
        message: t("assistant.toolsets.form.added", { ...name, org: orgName }),
      });
    }
    form.reset(values);
    emit("done");
  } catch (err) {
    await showSaveError(err, values);
  }
}

/** A 403 is already toasted by the transport; a refused kept secret and a named field get their own message. */
async function showSaveError(err: unknown, values: ToolsetFormValues) {
  const res = (err as { response?: { status?: number; data?: Record<string, unknown> } })?.response;
  if (res?.status === 403) {
    formError.value = t("assistant.toolsets.viewOnly");
    emit("forbidden");
    return;
  }
  if (res?.data?.error_code === "destination_changed") {
    forced.value = "refused";
    await requireKeptSecrets(keptSecretPaths(values));
    return;
  }
  const message = typeof res?.data?.message === "string" ? res.data.message.slice(0, 500) : "";
  const field = res?.data?.field;
  if (message && (field === "name" || field === "mcp.url" || field === "cli.command")) {
    setServerFieldErrors(form, { [field]: raw(message) });
    return;
  }
  formError.value = message ? raw(message) : t("assistant.toolsets.form.saveFailed");
}
</script>
