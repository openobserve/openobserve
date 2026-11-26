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
    <div v-else-if="step === 1" class="flex flex-col gap-4" data-test="ai-toolset-type-step">
      <AiToolsetTypeTiles
        v-model="pickedTile"
        :tiles="typeTiles"
        :label="t('aiToolset.selectType')"
      />
      <div class="flex flex-wrap gap-2">
        <OButton
          variant="primary"
          size="sm-action"
          class="max-md:min-h-11"
          :disabled="!pickedTile"
          data-test="ai-toolset-continue-btn"
          @click="continueToForm"
          >{{ t("alerts.continue") }}</OButton
        >
        <OButton
          variant="outline"
          size="sm-action"
          class="max-md:min-h-11"
          data-test="ai-toolset-step1-cancel-btn"
          @click="close"
          >{{ t("common.cancel") }}</OButton
        >
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
        v-if="isEdit"
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
      <div v-if="superCluster" class="flex flex-col gap-1">
        <OFormSwitch
          name="region_only"
          :label="t('aiToolset.regionOnly')"
          data-test="ai-toolset-region-only"
        />
        <p class="text-text-secondary text-xs">{{ t("aiToolset.regionOnlyHint") }}</p>
      </div>

      <template v-if="kind === 'mcp'">
        <h3 class="text-text-heading text-sm font-semibold">
          {{ t("assistant.toolsets.form.mcpSection") }}
        </h3>
        <p v-if="preset?.help" class="text-text-secondary text-xs">{{ raw(preset.help) }}</p>
        <template v-for="param in preset?.params ?? []" :key="param.name">
          <OFormSelect
            v-if="param.options?.length"
            :name="`mcp.preset_params.${param.name}`"
            :label="raw(param.label)"
            required
            :options="param.options"
            :data-test="`ai-toolset-preset-param-${param.name}`"
            @update:model-value="(v: string) => setPresetParam(param.name, v)"
          />
          <OFormInput
            v-else
            :name="`mcp.preset_params.${param.name}`"
            :label="raw(param.label)"
            required
            :placeholder="param.placeholder ? raw(param.placeholder) : undefined"
            data-o2-privacy="mask"
            :data-test="`ai-toolset-preset-param-${param.name}`"
            @update:model-value="(v: string) => setPresetParam(param.name, v)"
          />
        </template>
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
        <AssistantToolsetSecretRows :form="form" :rows="headers" />
        <fieldset
          ref="connectionAnchor"
          class="flex flex-col gap-3"
          aria-describedby="ai-toolset-oauth-hint"
          data-test="ai-toolset-oauth"
        >
          <legend class="text-text-heading mb-1 text-sm font-medium">
            {{ t("aiToolset.oauthClientCredentials") }}
          </legend>
          <p id="ai-toolset-oauth-hint" class="text-text-secondary text-xs">
            {{ t("aiToolset.oauthHint") }}
          </p>
          <OFormInput
            name="mcp.auth.token_url"
            :label="t('aiToolset.tokenUrl')"
            data-o2-privacy="mask"
            data-test="ai-toolset-token-url"
          />
          <OFormInput
            name="mcp.auth.client_id"
            :label="t('aiToolset.clientId')"
            autocomplete="off"
            data-test="ai-toolset-client-id"
          />
          <OFormSecretInput
            name="mcp.auth.secret.value"
            :state="clientSecret.state"
            :label="t('aiToolset.clientSecret')"
            :unchanged-label="t('assistant.toolsets.secret.unchanged')"
            :replace-label="t('assistant.toolsets.secret.replace')"
            :keep-label="t('assistant.toolsets.secret.keep')"
            :will-replace-label="t('assistant.toolsets.secret.willReplace')"
            :show-label="t('assistant.toolsets.secret.show')"
            :hide-label="t('assistant.toolsets.secret.hide')"
            data-test="ai-toolset-client-secret"
            @update:state="(state) => form.setFieldValue('mcp.auth.secret.state', state)"
          />
          <OFormInput
            name="mcp.auth.scope"
            :label="t('aiToolset.scope')"
            data-test="ai-toolset-scope"
          />
        </fieldset>
        <section
          ref="toolPickerAnchor"
          class="flex flex-col gap-2"
          data-test="ai-toolset-section-tools"
        >
          <h3 class="text-text-heading text-sm font-semibold">{{ t("aiToolset.tools") }}</h3>
          <AiToolsetToolPicker
            :lists="tools.lists.value"
            :tools="tools.tools.value"
            :status="tools.status.value"
            :error="tools.error.value"
            :can-refresh="!!mcpValues.url.trim()"
            :preset-tools="preset ? (tools.lists.value.allowed ?? []).length : undefined"
            :preset-name="preset?.label"
            @update:lists="setToolLists"
            @remove="tools.remove"
            @refresh="connect"
            @go-connection="focusConnection"
          />
        </section>
      </template>

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
        <p
          v-else-if="skillLong"
          class="text-status-warning-text text-xs"
          data-test="ai-toolset-skill-long"
        >
          {{ t("aiToolset.skillContentLong", { chars: skillContent.length }) }}
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
        <OButton
          v-if="!isEdit"
          variant="ghost"
          size="sm-action"
          class="max-md:min-h-11"
          :disabled="isSubmitting"
          data-test="ai-toolset-step-back-btn"
          @click="backToTypes"
          >{{ t("common.back") }}</OButton
        >
      </div>
    </OForm>
    <EditorDraftDialogs :draft="toolsetDraft" />
  </section>
</template>

<script setup lang="ts">
import { useMutation, useQuery } from "@tanstack/vue-query";
import { computed, defineAsyncComponent, nextTick, ref, watch } from "vue";
import { useRouter, type LocationQuery } from "vue-router";
import { useStore } from "vuex";

import AiToolsetToolPicker from "@/components/ai_toolsets/AiToolsetToolPicker.vue";
import AiToolsetTypeTiles, {
  type ToolsetTypeTile,
} from "@/components/ai_toolsets/AiToolsetTypeTiles.vue";
import {
  defaultParams,
  paramsFromUrl,
  presetData,
  renderUrl,
  stripPresetName,
  type Preset,
} from "@/components/ai_toolsets/presets";
import { CLIENT_CREDENTIALS, sameUrl } from "@/components/ai_toolsets/toolsetAuth";
import type { ToolLists } from "@/components/ai_toolsets/toolPicker";

import EditorDraftDialogs from "@/components/common/drafts/EditorDraftDialogs.vue";
import { useAssistantLeaveGuard, type LeaveGuard } from "@/composables/assistant";
import { useEditorDraft } from "@/composables/useEditorDraft";
import OButton from "@/lib/core/Button/OButton.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import OForm from "@/lib/forms/Form/OForm.vue";
import { setServerFieldErrors, useOForm } from "@/lib/forms/Form/useOForm";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormTextarea from "@/lib/forms/Input/OFormTextarea.vue";
import OFormSecretInput from "@/lib/forms/SecretInput/OFormSecretInput.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import OFormSwitch from "@/lib/forms/Switch/OFormSwitch.vue";
import { aiToolsetPresetsQuery } from "@/services/ai_toolsets.queries";
import {
  createToolsetMutation,
  toolsetQuery,
  updateToolsetMutation,
} from "@/services/assistant_settings.queries";
import { raw, useI18nTyped, type I18nKey, type I18nText } from "@/types/i18n";
import { getImageURL } from "@/utils/queryUtils";

import {
  emptyFormAuth,
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
import AssistantToolsetSecretRows from "./AssistantToolsetSecretRows.vue";
import {
  draftFieldName,
  draftRedactedLabels,
  redactToolsetDraft,
  toolsetDraftOf,
  toolsetFormOfDraft,
  type ToolsetDraft,
} from "./assistantToolsetDraft";
import { agentNameOf, type ToolsetRow } from "./assistantToolsets";
import { useAssistantSettingsPage } from "./useAssistantSettingsPage";
import { readyToDiscover, useToolsetTools } from "./useToolsetTools";

const REENTER_COPY: Record<ReenterReason | "refused", I18nKey> = {
  destination: "assistant.toolsets.form.reenterDestination",
  secret: "assistant.toolsets.form.reenterSecret",
  refused: "assistant.toolsets.form.reenterRefused",
};

const QueryEditor = defineAsyncComponent(() => import("@/components/CodeQueryEditor.vue"));
// About 10k tokens, as much again as a normal chat turn.
const SKILL_LONG_CHARS = 40_000;
const CUSTOM_MCP = "custom-mcp";
const SKILL = "skill";
const DRAFT_FIELD_LABELS = {
  url: "aiToolset.mcpUrl",
  token_url: "aiToolset.tokenUrl",
  client_secret: "aiToolset.clientSecret",
} as const satisfies Record<string, I18nKey>;
// The server's preset has no logo field, so known ones are mapped by id.
const PRESET_LOGOS: Record<string, string> = {
  datadog: "datadog",
  dynatrace: "dynatrace",
  grafana: "grafana",
};

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
const page = useAssistantSettingsPage();
const router = useRouter();
// Replication exists only on a super cluster, so the switch means nothing elsewhere.
const superCluster = !!useStore()?.state?.zoConfig?.super_cluster_enabled;
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
  { label: t("assistant.toolsets.kinds.skill"), value: "skill" },
];

const taken = computed(
  () =>
    new Set(props.existing.filter((row) => row.id !== props.editId).map((row) => row.agentName)),
);
const loaded = ref<ToolsetFormValues | null>(null);
// The edited toolset as loaded, so a draft left over an older copy is flagged as changed on the server.
let serverDraft: ToolsetDraft | null = null;
// Set while the leave dialog's Save runs, so a successful save does not close the form itself.
let leaveSave: { saved: boolean } | null = null;
let draftStarted = false;
// A row replicated without this region's secrets; it saves without them while its URLs stay.
const needsCredentials = ref(false);
const formError = ref<I18nText | string>("");
// Kept once the kept secrets were turned into fields, so the reason stays next to them.
const forced = ref<ReenterReason | "refused" | null>(null);

const form = useOForm<ToolsetFormValues>({
  defaultValues: toolsetFormDefaults(),
  schema: makeToolsetFormSchema(t as never, {
    isTaken: (agent) => taken.value.has(agent),
    editing: isEdit,
    mergeSecrets: props.mergeSecrets,
    missingSecretOk: (): boolean => {
      const stored = loaded.value?.mcp;
      const mcp = (form.state.values as ToolsetFormValues).mcp;
      return (
        needsCredentials.value &&
        !!stored &&
        sameUrl(mcp.url, stored.url) &&
        sameUrl(mcp.auth.token_url, stored.auth.token_url)
      );
    },
  }),
  onSubmit: save,
});

const kind = form.useStore((s) => s.values.kind);
const headers = form.useStore((s): SecretRow[] => s.values.mcp.headers);
const values = form.useStore((s) => s.values);
const skillContent = form.useStore((s) => s.values.skill.content ?? "");
const typedName = form.useStore((s) => s.values.name);
const submitted = form.useStore((s) => s.submissionAttempts > 0);

const agentName = computed(() => (typedName.value ? agentNameOf(typedName.value) : ""));
const skillError = computed(
  () => submitted.value && kind.value === "skill" && !skillContent.value.trim(),
);
// A warning only: the whole skill goes into every turn, so a long one costs every turn.
const skillLong = computed(() => skillContent.value.length > SKILL_LONG_CHARS);
const mcpValues = computed(() => values.value.mcp);
const clientSecret = computed(() => values.value.mcp.auth.secret);

const presetList = useQuery(computed(() => aiToolsetPresetsQuery(org)));
const mcpPresets = computed<Preset[]>(() =>
  (presetList.data.value ?? []).filter((p: Preset) => p.kind === "mcp"),
);
const presetById = (id: unknown) => mcpPresets.value.find((p) => p.id === id) ?? null;
const preset = ref<Preset | null>(null);

const typeTiles = computed<ToolsetTypeTile[]>(() => [
  ...mcpPresets.value.map((p) => {
    const full = p.description ? stripPresetName(p.description, p.label) : "";
    const short = full.split(/(?<=\.)\s/)[0];
    const fallback = t("aiToolset.addMcpDesc", { name: p.label });
    const logo = PRESET_LOGOS[p.id];
    return {
      id: p.id,
      name: raw(p.label),
      short: short ? raw(short) : fallback,
      tip: full ? raw(full) : fallback,
      // Without a logo the theme-coloured MCP icon stands in, so it reads in dark mode too.
      ...(logo
        ? { image: getImageURL(`images/ai_toolsets/${logo}.svg`) }
        : { icon: "mcp" as const }),
    };
  }),
  {
    id: CUSTOM_MCP,
    name: t("aiToolset.addCustomMcp"),
    short: t("aiToolset.addCustomMcpDesc"),
    tip: t("aiToolset.addCustomMcpDesc"),
    icon: "mcp",
  },
  {
    id: SKILL,
    name: t("aiToolset.addCustomSkill"),
    short: t("aiToolset.addSkillDesc"),
    tip: t("aiToolset.addSkillDesc"),
    icon: "menu-book",
  },
]);

// `?preset=` or `?kind=` names the type, so a link skips the type step and Back returns to it.
function tileFromQuery(query: LocationQuery): string | null {
  if (query.preset) return String(query.preset);
  if (query.kind === "skill") return SKILL;
  return query.kind === "mcp" ? CUSTOM_MCP : null;
}
function queryWithTile(tile: string | null): LocationQuery {
  const { preset: _preset, kind: _kind, ...rest } = router.currentRoute.value.query;
  if (!tile) return rest;
  if (tile === SKILL || tile === CUSTOM_MCP)
    return { ...rest, kind: tile === SKILL ? "skill" : "mcp" };
  return { ...rest, preset: tile };
}
// The tile the URL names, so the first render already opens the right step.
const appliedTile = ref<string | null>(
  isEdit ? null : tileFromQuery(router.currentRoute.value.query),
);
const step = computed(() => (isEdit || appliedTile.value ? 2 : 1));
const pickedTile = ref<string | null>(appliedTile.value);
const filledTile = ref<string | null>(null);
const knownTile = (tile: string | null) =>
  tile === SKILL || tile === CUSTOM_MCP || !!presetById(tile);

const tools = useToolsetTools({
  org,
  editId: () => props.editId,
  mcp: mcpValues,
  setLists: setToolLists,
});
const needsRetype = computed(() => isEdit && !props.mergeSecrets && headers.value.length > 0);
const reenter = computed<ReenterReason | "refused" | null>(
  () => reenterReason(values.value, loaded.value, props.mergeSecrets) ?? forced.value,
);

watch(
  () => record.data.value,
  async (data) => {
    if (!data) return;
    const next = toolsetFormOf(data, props.mergeSecrets);
    needsCredentials.value = (data as { needs_credentials?: unknown }).needs_credentials === true;
    preset.value = presetById((next.mcp.extra.preset as { id?: unknown } | undefined)?.id);
    loaded.value = structuredClone(next);
    form.reset(next);
    syncPresetParams();
    serverDraft = toolsetDraftOf(values.value);
    // After setup, which declares the draft below; the restore offer waits for no one.
    if (!draftStarted) void nextTick().then(() => toolsetDraft.start());
    draftStarted = true;
    // A saved toolset already has its credentials, so its tools load on open.
    if (next.kind === "mcp" && next.mcp.url) {
      await nextTick();
      void tools.discover();
    }
    if (router.currentRoute.value.query.section === "tools") {
      await nextTick();
      toolPickerAnchor.value?.scrollIntoView?.({ block: "start" });
    }
  },
  { immediate: true },
);

// The presets arrive after a `?preset=` link opened the form, so it is filled once they do.
watch(
  mcpPresets,
  () => {
    const tile = appliedTile.value;
    if (!isEdit && tile && knownTile(tile) && filledTile.value !== tile) applyTile(tile);
    if (isEdit && !preset.value)
      preset.value = presetById((values.value.mcp.extra.preset as { id?: unknown })?.id);
  },
  { immediate: true },
);
watch(() => values.value.mcp.url, syncPresetParams);
// Back and Forward between the type step and a type's form fill the form for the type the URL names.
watch(
  () => router.currentRoute.value.query,
  (query) => {
    if (isEdit || query.action !== "add") return;
    const tile = tileFromQuery(query);
    if (tile === appliedTile.value) return;
    appliedTile.value = tile;
    if (!tile) pickedTile.value = filledTile.value;
    else if (knownTile(tile)) applyTile(tile);
  },
);

const toolsetDraft = useEditorDraft<ToolsetDraft>({
  kind: "ai_toolset",
  entityLabel: () => t("common.editorDraft.entities.ai_toolset"),
  entityId: () => props.editId ?? null,
  snapshot: () => toolsetDraftOf(values.value),
  apply: applyDraft,
  base: () => (props.editId ? serverDraft : undefined),
  redactBase: (base) => redactToolsetDraft(base as ToolsetDraft).data,
  save: async () => {
    const run = { saved: false };
    leaveSave = run;
    try {
      await form.handleSubmit();
    } finally {
      leaveSave = null;
    }
    return run.saved;
  },
  redact: redactToolsetDraft,
  describeRedacted: (paths, data) =>
    draftRedactedLabels(paths, data).map((label) =>
      label.kind === "header"
        ? label.name
          ? t("common.editorDraft.headerField", { name: label.name })
          : t("common.editorDraft.headersField")
        : t(DRAFT_FIELD_LABELS[label.kind]),
    ),
  // The form lives on the settings route, so Back, Cancel, a tab or `?action` change leave it.
  leaveOnRouteUpdate: (to, from) =>
    to.params.tab !== from.params.tab ||
    to.query.action !== from.query.action ||
    to.query.id !== from.query.id,
});

// A new toolset's draft starts once the presets are in, so a preset's draft reopens on its own type.
if (!isEdit) {
  const stopStart = watch(
    () => presetList.isPending.value,
    (pending) => {
      if (pending) return;
      queueMicrotask(() => stopStart());
      void toolsetDraft.start();
    },
    { immediate: true },
  );
}

const leaveGuard: LeaveGuard = {
  host: "settings",
  isDirty: () => toolsetDraft.hasUnsavedChanges(),
  name: () =>
    t("assistant.toolsets.form.leaveName", {
      name: typedName.value || t("assistant.toolsets.form.newTitle"),
      org: orgName,
    }),
};
useAssistantLeaveGuard(leaveGuard);

function close() {
  emit("done");
}

function setToolLists(lists: ToolLists) {
  form.setFieldValue("mcp.allowed_tools", lists.allowed);
  form.setFieldValue("mcp.blocked_tools", lists.blocked);
  form.setFieldValue("mcp.write_tools", lists.write);
}

/** A new type's own fields start fresh; a name or description the last preset filled goes too. */
function applyTile(tile: string) {
  if (tile === filledTile.value) return;
  const previous = preset.value;
  const current = values.value;
  if (previous && current.name === previous.id) form.setFieldValue("name", "");
  if (
    previous &&
    current.description === stripPresetName(previous.description ?? "", previous.label)
  )
    form.setFieldValue("description", "");
  filledTile.value = tile;
  preset.value = null;
  form.setFieldValue("mcp", toolsetFormDefaults().mcp);
  const chosen = presetById(tile);
  if (chosen) applyPreset(chosen);
  else form.setFieldValue("kind", tile === SKILL ? "skill" : "mcp");
}

function applyPreset(chosen: Preset) {
  preset.value = chosen;
  const params = defaultParams(chosen);
  const data = presetData(chosen, params);
  form.setFieldValue("kind", "mcp");
  if (!values.value.name) form.setFieldValue("name", chosen.id);
  form.setFieldValue("description", stripPresetName(chosen.description ?? "", chosen.label));
  form.setFieldValue("mcp.preset_params", params);
  form.setFieldValue("mcp.url", data.url);
  form.setFieldValue(
    "mcp.headers",
    (chosen.headers ?? []).map((h) => ({ key: h.name, value: "", state: "new" as const })),
  );
  const tokenUrl = chosen.auth?.type === CLIENT_CREDENTIALS ? (chosen.auth.token_url ?? "") : "";
  form.setFieldValue("mcp.auth", { ...emptyFormAuth(), token_url: tokenUrl });
  setToolLists({ allowed: data.allowed_tools, blocked: null, write: data.write_tools ?? null });
  form.setFieldValue("mcp.extra", { tool_classes: data.tool_classes, preset: data.preset });
}

/** A template field rewrites the URL only; the values are never stored apart from it. */
function setPresetParam(name: string, value: string) {
  if (!preset.value) return;
  const params = { ...values.value.mcp.preset_params, [name]: value };
  form.setFieldValue("mcp.url", renderUrl(preset.value.url_template ?? "", params));
}

/** A URL typed by hand or loaded sets the fields; one that doesn't fit the template needs none. */
function syncPresetParams() {
  const chosen = preset.value;
  if (!chosen) return;
  const { url, preset_params } = values.value.mcp;
  const template = chosen.url_template ?? "";
  if (Object.keys(preset_params).length && url === renderUrl(template, preset_params)) return;
  const defaults = defaultParams(chosen);
  form.setFieldValue(
    "mcp.preset_params",
    url === renderUrl(template, defaults) ? defaults : (paramsFromUrl(template, url) ?? {}),
  );
}

function continueToForm() {
  const tile = pickedTile.value;
  if (!tile) return;
  applyTile(tile);
  appliedTile.value = tile;
  void router.push({ query: queryWithTile(tile) });
}

function backToTypes() {
  pickedTile.value = filledTile.value;
  appliedTile.value = null;
  void router.push({ query: queryWithTile(null) });
}

/** A saved toolset's name and type are locked, so its draft never changes them. */
async function applyDraft(
  draft: ToolsetDraft,
  { notKeptPaths }: { notKeptPaths: string[] },
): Promise<void> {
  const current = values.value;
  const next = toolsetFormOfDraft(draft);
  if (isEdit) Object.assign(next, { name: current.name, kind: current.kind });
  form.reset(next);
  preset.value = presetById((next.mcp.extra.preset as { id?: unknown } | undefined)?.id);
  if (!isEdit) {
    const tile = next.kind === "skill" ? SKILL : (preset.value?.id ?? CUSTOM_MCP);
    filledTile.value = tile;
    pickedTile.value = tile;
    appliedTile.value = tile;
    if (tileFromQuery(router.currentRoute.value.query) !== tile)
      void router.replace({ query: queryWithTile(tile) });
  }
  syncPresetParams();
  // After the form's own error sweep, which runs on the reset values.
  await nextTick();
  for (const path of notKeptPaths) {
    const name = draftFieldName(path);
    const meta = name ? form.getFieldMeta(name as never) : undefined;
    if (!name || !meta) continue;
    const errorMap = { ...meta.errorMap, onSubmit: t("common.editorDraft.reenterField") };
    form.setFieldMeta(name as never, { ...meta, errorMap } as never);
  }
}

const connectionAnchor = ref<HTMLElement | null>(null);
const toolPickerAnchor = ref<HTMLElement | null>(null);

function focusConnection() {
  connectionAnchor.value?.scrollIntoView?.({ block: "start", behavior: "smooth" });
  connectionAnchor.value?.querySelector<HTMLElement>("input, button, textarea")?.focus();
}

/** Half-typed credentials can't be listed with, so Connect leads back to them. */
function connect() {
  if (readyToDiscover(values.value.mcp)) void tools.discover();
  else focusConnection();
}

function setSkill(value: string) {
  form.setFieldValue("skill.content", value);
}

/** Turns every kept secret into a required field and moves focus to the first one. */
async function requireKeptSecrets(paths: string[]) {
  for (const path of paths) {
    form.setFieldValue(`${path}.state` as never, "replacing" as never);
    form.setFieldValue(`${path}.value` as never, "" as never);
  }
  await nextTick();
  const first = document.querySelector<HTMLElement>(
    '[data-test="ai-toolset-form"] [data-state="replacing"] input',
  );
  first?.focus();
}

async function save(values: ToolsetFormValues): Promise<void> {
  formError.value = "";
  if (org !== page.org.value) return;
  const reason = reenterReason(values, loaded.value, props.mergeSecrets);
  if (reason) {
    forced.value = reason;
    await requireKeptSecrets(keptSecretPaths(values));
    return;
  }
  const data = savedData(values);
  const region_only = values.region_only;
  try {
    if (props.editId) {
      const body = { description: values.description, data, region_only };
      await update.mutateAsync({ id: props.editId, body });
      toast({ variant: "success", message: t("assistant.toolsets.form.updated") });
    } else {
      const description = values.description || undefined;
      const body = { name: values.name, kind: values.kind, description, data, region_only };
      await create.mutateAsync(body);
      toast({ variant: "success", message: t("assistant.toolsets.form.added") });
    }
    form.reset(values);
    if (leaveSave) {
      leaveSave.saved = true;
      return;
    }
    toolsetDraft.markSaved();
    emit("done");
  } catch (err) {
    await showSaveError(err, values);
  }
}

/** The lists a current discovery shows are the ones saved, with when they were listed. */
function savedData(values: ToolsetFormValues) {
  if (values.kind !== "mcp") return toolsetDataOf(values, props.mergeSecrets);
  const lists = tools.lists.value;
  const mcp = {
    ...values.mcp,
    allowed_tools: lists.allowed,
    blocked_tools: lists.blocked,
    write_tools: lists.write,
  };
  const data: Record<string, unknown> = toolsetDataOf({ ...values, mcp }, props.mergeSecrets);
  const at = tools.verifiedAt(values.mcp);
  if (at) data.tools_verified_at = at;
  return data;
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
  if (message && (field === "name" || field === "mcp.url")) {
    setServerFieldErrors(form, { [field]: raw(message) });
    return;
  }
  formError.value = message ? raw(message) : t("assistant.toolsets.form.saveFailed");
}
</script>
