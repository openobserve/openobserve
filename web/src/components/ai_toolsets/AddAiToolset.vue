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
  <OPageLayout
    :title="isEditing ? t('aiToolset.update') : t('aiToolset.add')"
    :back="{
      label: t('aiToolset.header'),
      onClick: closeEditor,
      dataTest: 'ai-toolset-back-btn',
    }"
    bleed
  >
    <!-- The form is created in setup() via useOForm (headless) so this owner can read
         `kind`/arrays/skill content reactively to drive the v-if/v-for below; it is
         handed to <OForm :form="form">. The OSaveBar's Save is type="submit", so
         Enter + click both submit natively. -->
    <OForm id="add-ai-toolset-form" :form="form" class="flex min-h-0 flex-1 flex-col">
      <div class="min-h-0 flex-1 overflow-auto px-4 pt-3 pb-4">
        <div class="flex w-full max-w-5xl flex-col gap-4">
          <OFormSection
            variant="plain"
            :title="t('aiToolset.details')"
            data-test="ai-toolset-section-details"
          >
            <div class="flex flex-col gap-4">
              <div class="flex gap-4">
                <div :class="presetOpened ? 'w-full' : 'w-1/2'">
                  <OFormInput
                    data-test="ai-toolset-name-input"
                    name="name"
                    :label="t('aiToolset.name')"
                    required
                    :readonly="isEditing"
                    :disabled="isEditing"
                  />
                </div>
                <div v-if="!presetOpened" class="w-1/2">
                  <OFormSelect
                    data-test="ai-toolset-kind-select"
                    name="kind"
                    :label="t('aiToolset.kind')"
                    required
                    :options="kindOptions"
                    labelKey="label"
                    valueKey="value"
                    :disabled="isEditing"
                  />
                </div>
              </div>
              <OFormTextarea
                data-test="ai-toolset-description-input"
                name="description"
                :label="t('aiToolset.description')"
              />
              <div v-if="superCluster" class="flex flex-col gap-1">
                <OFormSwitch
                  name="region_only"
                  :label="t('aiToolset.regionOnly')"
                  data-test="ai-toolset-region-only"
                  off-tone="neutral"
                  state-text
                />
                <div class="text-text-secondary text-xs">{{ t("aiToolset.regionOnlyHint") }}</div>
              </div>
            </div>
          </OFormSection>

          <!-- MCP fields -->
          <template v-if="selectedKind === 'mcp'">
            <div ref="connectionAnchor">
              <OFormSection
                variant="plain"
                :title="t('aiToolset.connection')"
                data-test="ai-toolset-section-connection"
              >
                <div class="flex flex-col gap-4">
                  <template v-if="mcpPreset">
                    <template v-for="param in mcpPreset.params ?? []" :key="param.name">
                      <OFormSelect
                        v-if="param.options?.length"
                        :name="`mcp.preset_params.${param.name}`"
                        :label="raw(param.label)"
                        required
                        :options="param.options"
                        :help-text="raw(mcpPreset.help)"
                        :data-test="`ai-toolset-preset-param-${param.name}`"
                        @update:model-value="(v: string) => setPresetParam(param.name, v)"
                      />
                      <OFormInput
                        v-else
                        :name="`mcp.preset_params.${param.name}`"
                        :label="raw(param.label)"
                        required
                        :placeholder="raw(param.placeholder)"
                        :help-text="raw(mcpPreset.help)"
                        :data-test="`ai-toolset-preset-param-${param.name}`"
                        @update:model-value="(v: string) => setPresetParam(param.name, v)"
                      />
                    </template>
                  </template>
                  <OFormInput
                    :placeholder="raw('https://api.example.com/mcp/')"
                    data-test="ai-toolset-mcp-url"
                    name="mcp.url"
                    :label="t('aiToolset.mcpUrl')"
                    required
                  />
                  <OFormInput
                    data-test="ai-toolset-mcp-timeout"
                    name="mcp.timeout_seconds"
                    :label="t('aiToolset.timeoutSeconds')"
                    type="number"
                    min="1"
                  />
                  <!-- Headers — form-owned dynamic array-field (mcp.headers[i].*) -->
                  <div class="flex flex-col gap-1">
                    <div
                      class="o-input-label text-compact text-input-label-text flex items-center leading-tight font-medium"
                    >
                      {{ t("aiToolset.headers") }}
                    </div>
                    <div class="flex flex-col gap-2">
                      <div
                        v-for="(_header, idx) in mcpHeaders"
                        :key="idx"
                        class="flex items-start gap-2"
                      >
                        <div class="w-5/12">
                          <OFormInput
                            :name="`mcp.headers[${idx}].key`"
                            :placeholder="t('aiToolset.headerKey')"
                            :aria-label="t('aiToolset.headerKey')"
                          />
                        </div>
                        <div class="w-5/12">
                          <OFormInput
                            :name="`mcp.headers[${idx}].value`"
                            type="password"
                            revealable
                            :placeholder="t('aiToolset.headerValue')"
                            :aria-label="t('aiToolset.headerValue')"
                          />
                        </div>
                        <OButton
                          variant="ghost"
                          size="icon-xs-sq"
                          icon-left="delete"
                          :aria-label="t('common.delete')"
                          :title="t('common.delete')"
                          @click="removeHeader(idx)"
                        />
                      </div>
                      <div>
                        <OButton
                          variant="outline"
                          size="sm-action"
                          icon-left="add"
                          @click="addHeader"
                        >
                          {{ t("aiToolset.addHeader") }}
                        </OButton>
                      </div>
                    </div>
                  </div>
                </div>
              </OFormSection>
            </div>

            <div ref="toolPickerAnchor">
              <OFormSection
                variant="plain"
                :title="t('aiToolset.tools')"
                data-test="ai-toolset-section-tools"
              >
                <AiToolsetToolPicker
                  :lists="toolLists"
                  :tools="discoveredTools"
                  :status="discoveryStatus"
                  :error="discoveryError"
                  :can-refresh="!!mcpUrl.trim()"
                  :preset-tools="mcpPreset ? (toolLists.allowed ?? []).length : undefined"
                  :preset-name="mcpPreset?.label"
                  @update:lists="setToolLists"
                  @refresh="discoverTools"
                  @go-connection="focusConnection"
                />
              </OFormSection>
            </div>

            <OFormSection
              variant="plain"
              :title="t('aiToolset.limits')"
              data-test="ai-toolset-section-limits"
            >
              <div class="grid grid-cols-2 items-start gap-4">
                <OFormInput
                  data-test="ai-toolset-mcp-max-calls"
                  name="mcp.max_calls_per_turn"
                  :label="t('aiToolset.maxCallsPerTurn')"
                  :placeholder="raw('40')"
                  type="number"
                  min="1"
                />
                <OFormInput
                  data-test="ai-toolset-mcp-max-result"
                  name="mcp.max_result_kib"
                  :label="t('aiToolset.maxResultKib')"
                  :placeholder="raw('1024')"
                  type="number"
                  min="1"
                />
                <OFormInput
                  data-test="ai-toolset-mcp-rate-calls"
                  name="mcp.rate_calls"
                  :label="t('aiToolset.rateCalls')"
                  :placeholder="raw('200')"
                  :help-text="t('aiToolset.rateLimitHelp')"
                  type="number"
                  min="1"
                />
                <OFormInput
                  data-test="ai-toolset-mcp-rate-seconds"
                  name="mcp.rate_seconds"
                  :label="t('aiToolset.rateSeconds')"
                  :placeholder="raw('60')"
                  type="number"
                  min="1"
                />
              </div>
            </OFormSection>
          </template>

          <!-- Skill fields — the Monaco editor (no OForm* equivalent) is bridged
               into the form (skill.content); its required rule lives in the
               schema and the error shows after the first submit (R3). -->
          <template v-if="selectedKind === 'skill'">
            <OFormSection
              variant="plain"
              required
              :title="t('aiToolset.skillDefinition')"
              data-test="ai-toolset-section-skill"
            >
              <div class="flex flex-col gap-1">
                <QueryEditor
                  data-test="ai-toolset-skill-content"
                  editor-id="skill-content-editor"
                  class="rounded-default border-card-glass-border min-h-100! w-full resize-y overflow-auto border"
                  language="markdown"
                  :query="skillContent"
                  @update:query="(v: string) => setSkillContent(v)"
                />
                <div v-if="skillContentError" class="text-input-error-text text-xs">
                  {{ t("aiToolset.skillContentRequired") }}
                </div>
              </div>
            </OFormSection>
          </template>
        </div>
      </div>

      <OSaveBar
        :mode="isEditing ? 'edit' : 'create'"
        class="shrink-0 px-4"
        :loaded="formReady"
        data-test="ai-toolset-save-bar"
        save-data-test="ai-toolset-save-btn"
        cancel-data-test="ai-toolset-cancel-btn"
        discard-data-test="ai-toolset-discard-btn"
        @cancel="closeEditor"
      />
    </OForm>
    <EditorDraftDialogs :draft="toolsetDraft" />
  </OPageLayout>
</template>

<script lang="ts">
import {
  defineAsyncComponent,
  defineComponent,
  ref,
  computed,
  onMounted,
  nextTick,
  shallowRef,
  watch,
} from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import aiToolsetsService from "@/services/ai_toolsets";
import OSaveBar from "@/lib/forms/SaveBar/OSaveBar.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OFormSection from "@/lib/core/FormSection/OFormSection.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormTextarea from "@/lib/forms/Input/OFormTextarea.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import OFormSwitch from "@/lib/forms/Switch/OFormSwitch.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import { useOForm, type FormFieldPath } from "@/lib/forms/Form/useOForm";
import type { ToolsetKind } from "@/services/ai_toolsets";
import { toast } from "@/lib/feedback/Toast/useToast";
import { useEditorDraft, useEditorDraftIds } from "@/composables/useEditorDraft";
import { urlCarriesCredential } from "@/utils/drafts/urlCredentials";
import EditorDraftDialogs from "@/components/common/drafts/EditorDraftDialogs.vue";
import AiToolsetToolPicker from "./AiToolsetToolPicker.vue";
import { prefillFromDiscovery, type DiscoveredTool, type ToolLists } from "./toolPicker";
import {
  defaultParams,
  paramsFromUrl,
  presetData,
  renderUrl,
  stripPresetName,
  type Preset,
} from "./presets";
import { aiToolsetPresetsQuery } from "@/services/ai_toolsets.queries";
import { queryClient } from "@/composables/query/queryClient";
import {
  makeAddAiToolsetSchema,
  addAiToolsetDefaults,
  type AddAiToolsetForm,
} from "./AddAiToolset.schema";

const QueryEditor = defineAsyncComponent(() => import("@/components/CodeQueryEditor.vue"));

type SecretPair = { key: string; value: string };

interface AiToolsetDraftData extends Omit<AddAiToolsetForm, "mcp"> {
  mcp: Omit<AddAiToolsetForm["mcp"], "headers"> & { headers: SecretPair[] };
}

export default defineComponent({
  name: "AddAiToolset",
  components: {
    OPageLayout,
    OButton,
    OSaveBar,
    OFormSection,
    OForm,
    OFormInput,
    OFormTextarea,
    OFormSelect,
    OFormSwitch,
    QueryEditor,
    EditorDraftDialogs,
    AiToolsetToolPicker,
  },
  emits: ["cancel:hideform", "update:list"],
  setup(_, { emit }) {
    const store = useStore();
    // Replication exists only on a super cluster, so the switch means nothing elsewhere.
    const superCluster = computed(() => !!store.state.zoConfig?.super_cluster_enabled);
    const router = useRouter();
    const { t } = useI18nTyped();

    // Co-located Zod schema (factory keeps the messages i18n-driven).
    const editingId = ref<string | null>(null);
    const isEditing = ref(false);

    const addAiToolsetSchema = makeAddAiToolsetSchema(t, () => isEditing.value);

    const kindOptions = [
      { label: t("aiToolset.kindMcp"), value: "mcp" },
      { label: t("aiToolset.kindSkill"), value: "skill" },
    ];

    // -----------------------------------------------------------------------
    // MCP tool discovery: the picker's tool list, and whether it was verified
    // for the URL and headers being saved.
    // -----------------------------------------------------------------------
    const discoveredTools = ref<DiscoveredTool[] | null>(null);
    const discoveryStatus = ref<"idle" | "loading" | "ok" | "failed">("idle");
    const discoveryError = ref("");
    // The URL and headers the last successful discovery used, and when it ran (microseconds).
    let verified: { key: string; at: number } | null = null;
    let discoverySeq = 0;

    const headerMap = (rows: AddAiToolsetForm["mcp"]["headers"] | undefined) => {
      const headers: Record<string, string> = {};
      (rows ?? [])
        .filter((h) => (h.key ?? "").trim())
        .forEach((h) => {
          headers[(h.key ?? "").trim()] = h.value ?? "";
        });
      return headers;
    };

    // Every row, half-typed ones included, so typing anywhere voids a result in flight.
    const discoveryKey = (mcp: AddAiToolsetForm["mcp"]) =>
      JSON.stringify([mcp.url ?? "", (mcp.headers ?? []).map((h) => [h.key ?? "", h.value ?? ""])]);

    const MCP_RENDERED_KEYS = new Set([
      "schema",
      "url",
      "headers",
      "timeout_seconds",
      "allowed_tools",
      "blocked_tools",
      "write_tools",
      "max_calls_per_turn",
      "rate_limit",
      "max_result_bytes",
      "tools_verified_at",
    ]);

    // Older preset metadata held the template's values, which can be the URL itself.
    const withoutUrlCopies = (extra: Record<string, any>) => {
      if (!extra.preset?.params) return extra;
      const { params: _params, ...preset } = extra.preset;
      return { ...extra, preset };
    };

    const blankToUndefined = (v: unknown) =>
      v === undefined || v === null || String(v).trim() === "" ? undefined : Number(v);

    // `schema: 2` makes the save replace the stored config, so every key this form doesn't edit is
    // sent back from `extra`, and an absent list stays absent.
    const buildMcpData = (mcp: AddAiToolsetForm["mcp"], headers: Record<string, string>) => {
      const data: Record<string, any> = {
        ...(mcp.extra ?? {}),
        schema: 2,
        url: mcp.url ?? "",
        headers,
        timeout_seconds: Number(mcp.timeout_seconds),
      };
      if (mcp.allowed_tools !== null) data.allowed_tools = mcp.allowed_tools;
      if (mcp.blocked_tools !== null) data.blocked_tools = mcp.blocked_tools;
      // The save stores what the picker shows, so `write_tools` is always explicit.
      data.write_tools = mcp.write_tools ?? [];
      const maxCalls = blankToUndefined(mcp.max_calls_per_turn);
      if (maxCalls !== undefined) data.max_calls_per_turn = maxCalls;
      const rateCalls = blankToUndefined(mcp.rate_calls);
      const rateSeconds = blankToUndefined(mcp.rate_seconds);
      if (rateCalls !== undefined && rateSeconds !== undefined) {
        data.rate_limit = { calls: rateCalls, per_seconds: rateSeconds };
      }
      const resultKib = blankToUndefined(mcp.max_result_kib);
      if (resultKib !== undefined) data.max_result_bytes = resultKib * 1024;
      if (verified && verified.key === discoveryKey(mcp)) data.tools_verified_at = verified.at;
      return data;
    };

    // -----------------------------------------------------------------------
    // Build the API payload from the validated submit value (single source of
    // truth — incl. the form-owned arrays and the bridged Monaco values).
    // -----------------------------------------------------------------------
    const buildData = (value: AddAiToolsetForm) => {
      const kind = value.kind;
      if (kind === "mcp") {
        const headers: Record<string, string> = {};
        (value.mcp.headers ?? [])
          .filter((h) => (h.key ?? "").trim())
          .forEach((h) => {
            headers[(h.key ?? "").trim()] = h.value ?? "";
          });
        return buildMcpData(value.mcp, headers);
      }
      if (kind === "skill") {
        return { content: value.skill.content ?? "" };
      }
      return {};
    };

    // Awaited save handler — baked into useOForm below, so OForm only calls it
    // once the whole schema passes (no manual gate). OForm awaits it → auto Save
    // spinner. `value` is the validated payload and the single source of truth.
    const saveToolset = async (value: AddAiToolsetForm) => {
      if (blockOnPendingReentries()) return;
      const org = store.state.selectedOrganization.identifier;
      const data = buildData(value);

      try {
        if (isEditing.value && editingId.value) {
          await aiToolsetsService.update(org, editingId.value, {
            description: value.description ? raw(value.description) : undefined,
            data,
            region_only: !!value.region_only,
          });
          toast({
            variant: "success",
            message: t("aiToolset.updatedSuccessfully"),
          });
        } else {
          await aiToolsetsService.create(org, {
            name: value.name,
            kind: value.kind as ToolsetKind,
            description: value.description ? raw(value.description) : undefined,
            data,
            region_only: !!value.region_only,
          });
          toast({
            variant: "success",
            message: t("aiToolset.createdSuccessfully"),
          });
        }
        if (leaveSave) {
          leaveSave.saved = true;
          emit("update:list");
          return;
        }
        toolsetDraft.markSaved();
        emit("cancel:hideform");
      } catch (err: any) {
        const msg =
          err?.response?.data?.message ||
          (isEditing.value
            ? t("aiToolset.updateFailed", { product: raw("AI Toolset") })
            : t("aiToolset.createFailed", { product: raw("AI Toolset") }));
        toast({ variant: "error", message: msg });
      }
    };

    // ── Headless form (Rule ③ fix) ────────────────────────────────────────────
    // The form is created HERE in the owner's setup (not inside <OForm>), so it
    // exists synchronously and this component can read it reactively with
    // `form.useStore` to drive the v-if/v-for below — no template ref, no store
    // subscription, no mirror. It is handed to <OForm :form="form">.
    const form = useOForm<AddAiToolsetForm>({
      defaultValues: addAiToolsetDefaults(),
      schema: addAiToolsetSchema,
      onSubmit: saveToolset,
    });

    // ── Reactive reads (REPLACE the old mirror) ───────────────────────────────
    // `form.useStore(selector)` returns a reactive Ref that re-tracks on every
    // form change — used for the section toggle, the array v-for rows, the
    // Monaco editor value, and the submit-attempt-driven skill error.
    const selectedKind = form.useStore((s: any) => s.values.kind);
    const formValues = form.useStore((s: { values: AddAiToolsetForm }) => s.values);
    // Selector returns are annotated as arrays so the template v-for index is `number`.
    const mcpHeaders = form.useStore(
      (s: any): AddAiToolsetForm["mcp"]["headers"] => s.values.mcp?.headers ?? [],
    );
    const skillContent = form.useStore((s: any) => s.values.skill?.content ?? "");
    const submitted = form.useStore((s: any) => (s.submissionAttempts ?? 0) > 0);

    // Mirror the schema's skill.content required rule for display: shown only
    // after the first submit (R3 timing), cleared live as content is typed.
    // (Monaco isn't an OForm* field that auto-renders its error.)
    const skillContentError = computed(
      () => submitted.value && selectedKind.value === "skill" && !(skillContent.value ?? "").trim(),
    );

    // -----------------------------------------------------------------------
    // Presets, from `GET /ai/toolsets/prebuilt` (the server's file is the only copy)
    // -----------------------------------------------------------------------
    const presets = ref<Preset[]>([]);
    // The MCP preset the form was opened with, and its URL template's fields.
    const mcpPreset = ref<Preset | null>(null);
    // Off until the saved toolset and presets are in, so the bar shows no change count early.
    const formReady = ref(false);
    // Opened from a preset card, so the Type select is hidden.
    const presetOpened = ref(false);

    const applyMcpPreset = (preset: Preset) => {
      mcpPreset.value = preset;
      const params = defaultParams(preset);
      form.setFieldValue("mcp.preset_params", params);
      const data = presetData(preset, params);
      form.setFieldValue("kind", "mcp");
      if (!form.state.values.name) form.setFieldValue("name", preset.id);
      form.setFieldValue("description", stripPresetName(preset.description ?? "", preset.label));
      form.setFieldValue("mcp.url", data.url);
      form.setFieldValue(
        "mcp.headers",
        (preset.headers ?? []).map((h) => ({ key: h.name, value: "", visible: false })),
      );
      setToolLists({ allowed: data.allowed_tools, blocked: null, write: data.write_tools });
      form.setFieldValue("mcp.extra", { tool_classes: data.tool_classes, preset: data.preset });
    };

    // A template field rewrites the URL only; the values are never stored apart from it.
    const setPresetParam = (name: string, value: string) => {
      const preset = mcpPreset.value;
      if (!preset) return;
      const params = {
        ...(form.state.values as AddAiToolsetForm).mcp.preset_params,
        [name]: value,
      };
      form.setFieldValue("mcp.url", renderUrl(preset.url_template ?? "", params));
    };

    const loadPresets = async () => {
      const org = store.state.selectedOrganization.identifier;
      try {
        presets.value = await queryClient.fetchQuery(aiToolsetPresetsQuery(org));
      } catch {
        presets.value = [];
      }
    };

    // -----------------------------------------------------------------------
    // Dynamic array-fields — FORM-OWNED (mcp.headers).
    // The form is the single source of truth; add/remove/toggle mutate it via
    // the form API directly, and the `form.useStore` reads above re-render the
    // v-for rows (playbook §2).
    // -----------------------------------------------------------------------
    // MCP headers. (useOForm erases the form generic to Record<string, unknown>,
    // so TanStack's array-field paths collapse to `never` — hence the casts.)
    const addHeader = () =>
      form.pushFieldValue("mcp.headers", { key: "", value: "", visible: false });
    const removeHeader = (i: number) => form.removeFieldValue("mcp.headers", i);

    const toolLists = computed<ToolLists>(() => ({
      allowed: formValues.value.mcp?.allowed_tools ?? null,
      blocked: formValues.value.mcp?.blocked_tools ?? null,
      write: formValues.value.mcp?.write_tools ?? null,
    }));

    const setToolLists = (lists: ToolLists) => {
      form.setFieldValue("mcp.allowed_tools", lists.allowed);
      form.setFieldValue("mcp.blocked_tools", lists.blocked);
      form.setFieldValue("mcp.write_tools", lists.write);
    };

    // Every header row is filled in, so a discovery won't run on half-typed credentials.
    const readyToDiscover = (mcp: AddAiToolsetForm["mcp"] | undefined) =>
      !!mcp?.url?.trim() &&
      (mcp.headers ?? []).every((h) => !(h.key ?? "").trim() === !(h.value ?? ""));

    // The toolset and endpoint a result belongs to; a result for anything else is dropped.
    const discoveryTarget = () => {
      const values = form.state.values as AddAiToolsetForm;
      return `${editingId.value ?? ""}|${values.kind === "mcp" ? discoveryKey(values.mcp) : ""}`;
    };

    const discoverTools = async () => {
      const values = form.state.values as AddAiToolsetForm;
      if (values.kind !== "mcp" || !readyToDiscover(values.mcp)) return;
      const org = store.state.selectedOrganization.identifier;
      const key = discoveryKey(values.mcp);
      const target = discoveryTarget();
      const config = {
        url: values.mcp.url ?? "",
        headers: headerMap(values.mcp.headers),
        timeout_seconds: Number(values.mcp.timeout_seconds) || 30,
      };
      const body =
        isEditing.value && editingId.value ? { id: editingId.value, overrides: config } : config;
      const seq = ++discoverySeq;
      discoveryStatus.value = "loading";
      try {
        const res = await aiToolsetsService.discover(org, body);
        if (seq !== discoverySeq || target !== discoveryTarget()) return;
        const tools: DiscoveredTool[] = res.data?.tools ?? [];
        discoveredTools.value = tools;
        discoveryStatus.value = "ok";
        discoveryError.value = "";
        verified = { key, at: Date.now() * 1000 };
        const spelled = prefillFromDiscovery(toolLists.value, tools);
        if (spelled !== toolLists.value) setToolLists(spelled);
      } catch (err: any) {
        if (seq !== discoverySeq || target !== discoveryTarget()) return;
        discoveredTools.value = null;
        discoveryStatus.value = "failed";
        discoveryError.value =
          err?.response?.data?.message || err?.message || t("aiToolset.toolsUnknownError");
        if (verified?.key === key) verified = null;
      }
    };

    const mcpEndpoint = computed(() =>
      formValues.value.kind === "mcp" ? discoveryKey(formValues.value.mcp) : "",
    );
    // Any change voids the request in flight and the tools shown, which belong to the old endpoint.
    watch(mcpEndpoint, (key, previous) => {
      if (key === previous) return;
      discoverySeq++;
      discoveredTools.value = null;
      discoveryStatus.value = "idle";
      discoveryError.value = "";
    });

    const mcpUrl = computed(() =>
      formValues.value.kind === "mcp" ? (formValues.value.mcp?.url ?? "") : "",
    );

    const toolPickerAnchor = ref<HTMLElement | null>(null);
    const connectionAnchor = ref<HTMLElement | null>(null);
    const focusConnection = () => {
      connectionAnchor.value?.scrollIntoView?.({ block: "start", behavior: "smooth" });
      connectionAnchor.value?.querySelector<HTMLElement>("input, button, textarea")?.focus();
    };

    // Skill content (Monaco editor — no OForm* equivalent) bridged into the form.
    const setSkillContent = (value: string) =>
      form.setFieldValue("skill.content", value, { dontUpdateMeta: true });

    // -----------------------------------------------------------------------
    // Load existing toolset when editing — seed via form.reset (the record
    // arrives async; `:default-values` was read once at creation).
    // -----------------------------------------------------------------------
    const toolsetDrafts = useEditorDraftIds("ai_toolset");
    const loadForEdit = async (id: string): Promise<"loaded" | "gone" | "failed"> => {
      const org = store.state.selectedOrganization.identifier;
      try {
        const res = await aiToolsetsService.get(org, id);
        const toolset = res.data;
        editingId.value = toolset.id;
        isEditing.value = true;

        const data = toolset.data || {};
        const record: AddAiToolsetForm = {
          ...addAiToolsetDefaults(),
          name: toolset.name,
          kind: toolset.kind,
          description: toolset.description || "",
          region_only: !!toolset.region_only,
        };
        if (toolset.kind === "mcp") {
          const list = (v: unknown) => (Array.isArray(v) ? (v as string[]) : null);
          const asText = (v: unknown) => (typeof v === "number" ? String(v) : "");
          record.mcp = {
            preset_params: {},
            url: data.url || "",
            timeout_seconds: data.timeout_seconds ?? 30,
            headers: Object.entries(data.headers || {}).map(([k, v]) => ({
              key: k,
              value: v as string,
              visible: false,
            })),
            allowed_tools: list(data.allowed_tools),
            blocked_tools: list(data.blocked_tools),
            write_tools: list(data.write_tools),
            max_calls_per_turn: asText(data.max_calls_per_turn),
            rate_calls: asText(data.rate_limit?.calls),
            rate_seconds: asText(data.rate_limit?.per_seconds),
            max_result_kib:
              typeof data.max_result_bytes === "number"
                ? String(Math.ceil(data.max_result_bytes / 1024))
                : "",
            extra: withoutUrlCopies(
              Object.fromEntries(
                Object.entries(data).filter(([key]) => !MCP_RENDERED_KEYS.has(key)),
              ),
            ),
          };
        } else if (toolset.kind === "skill") {
          record.skill = { content: data.content || "" };
        }

        // Async-loaded record → form.reset (NOT per-field setFieldValue). The
        // `form.useStore` reads above re-render automatically.
        form.reset(record);
        serverToolset = toolsetSnapshot();
        return "loaded";
      } catch (err: unknown) {
        const gone = (err as { response?: { status?: number } } | null)?.response?.status === 404;
        // The draft's own notice replaces the load error for a deleted toolset that has one.
        if (!gone || !toolsetDrafts.ids.has(id)) {
          toast({ variant: "error", message: t("toastMessages.aitoolsets.failedToLoadToolset") });
        }
        return gone ? "gone" : "failed";
      }
    };

    const editId = (): string | null => {
      const query = router.currentRoute.value.query;
      return query.action === "edit" && query.id ? String(query.id) : null;
    };
    // The toolset in the form's shape, so the base hash ignores what the form never shows.
    let serverToolset: AiToolsetDraftData | null = null;
    // Set while the leave dialog's Save runs, so a successful save does not close the editor itself.
    let leaveSave: { saved: boolean } | null = null;

    // The password-visibility toggles are view state, so they are neither drafted nor counted as edits.
    const toolsetSnapshot = (): AiToolsetDraftData => {
      const values = formValues.value;
      const pairs = (rows: { key?: string; value?: string }[] | undefined) =>
        (rows ?? []).map((row) => ({ key: row.key ?? "", value: row.value ?? "" }));
      return {
        ...values,
        mcp: { ...values.mcp, headers: pairs(values.mcp?.headers) },
        skill: { ...values.skill },
      };
    };

    const SECRET_PATH = /^\/mcp\/headers\/(\d+)\/value$/;
    const MCP_URL_PATH = "/mcp/url";

    // Header values carry auth and a URL can embed a token, so neither is drafted.
    const redactToolsetDraft = (data: AiToolsetDraftData) => {
      const copy = JSON.parse(JSON.stringify(data)) as AiToolsetDraftData;
      const paths: string[] = [];
      if (copy.mcp?.url && urlCarriesCredential(copy.mcp.url)) {
        copy.mcp.url = "";
        paths.push(MCP_URL_PATH);
      }
      (copy.mcp?.headers ?? []).forEach((row, index) => {
        if (!row.value) return;
        row.value = "";
        paths.push(`/mcp/headers/${index}/value`);
      });
      return { data: copy, paths };
    };

    const headerKeyOf = (path: string, data: AiToolsetDraftData): string | null => {
      const match = SECRET_PATH.exec(path);
      return match ? (data.mcp?.headers?.[Number(match[1])]?.key ?? "") : null;
    };

    const describeRedactedToolset = (paths: string[], data: AiToolsetDraftData): I18nText[] => {
      const fields = paths.flatMap((path): I18nText[] => {
        if (path === MCP_URL_PATH) return [t("aiToolset.mcpUrl")];
        const key = headerKeyOf(path, data);
        if (key === null) return [];
        return [
          key
            ? t("common.editorDraft.headerField", { name: key })
            : t("common.editorDraft.headersField"),
        ];
      });
      return [...new Set(fields)];
    };

    // A not-kept header is found again by its key, since rows may have moved since the draft was written.
    const notKeptRows = shallowRef(new Map<string, string>());

    const fieldNameFor = (path: string): FormFieldPath<AddAiToolsetForm> | null => {
      if (path === MCP_URL_PATH) return "mcp.url";
      const key = notKeptRows.value.get(path);
      if (key === undefined) return null;
      const index = (formValues.value.mcp?.headers ?? []).findIndex((r) => r.key === key);
      return index < 0 ? null : (`mcp.headers[${index}].value` as FormFieldPath<AddAiToolsetForm>);
    };

    const flagReentries = (paths: string[]) => {
      for (const path of paths) {
        const name = fieldNameFor(path);
        const meta = name ? form.getFieldMeta(name) : undefined;
        if (!name || !meta) continue;
        form.setFieldMeta(name, {
          ...meta,
          errorMap: { ...meta.errorMap, onSubmit: t("common.editorDraft.reenterField") },
        });
      }
    };

    // A secret of a kind the user switched away from is never sent, so it is not asked for.
    const activePendingReentries = (): string[] =>
      toolsetDraft
        .pendingReentries()
        .filter((path) => path.startsWith(`/${String(selectedKind.value)}/`));

    /** A changed secret the draft could not keep must be typed again before saving. */
    const blockOnPendingReentries = (): boolean => {
      const pending = activePendingReentries();
      if (!pending.length) return false;
      flagReentries(pending);
      toast({ variant: "error", message: t("common.editorDraft.reenterBeforeSave") });
      return true;
    };

    const toolsetDraft = useEditorDraft<AiToolsetDraftData>({
      kind: "ai_toolset",
      entityLabel: () => t("common.editorDraft.entities.ai_toolset"),
      entityId: editId,
      snapshot: toolsetSnapshot,
      apply: async (draft, { notKeptPaths: draftNotKeptPaths }) => {
        // A draft saved while the CLI kind existed restores as the default kind, without its CLI fields.
        const data = { ...draft } as AiToolsetDraftData & { cli?: unknown };
        delete data.cli;
        if (!kindOptions.some((option) => option.value === data.kind)) {
          data.kind = addAiToolsetDefaults().kind;
        }
        const notKeptPaths = draftNotKeptPaths.filter((path) => !path.startsWith("/cli/"));
        const withHidden = (rows: SecretPair[]) => rows.map((row) => ({ ...row, visible: false }));
        // A saved toolset's name and kind are locked, so the draft can never change them.
        const locked = isEditing.value
          ? { name: form.state.values.name, kind: form.state.values.kind }
          : {};
        form.reset({
          ...data,
          ...locked,
          mcp: { ...data.mcp, headers: withHidden(data.mcp.headers) },
        } as AddAiToolsetForm);
        notKeptRows.value = new Map(
          notKeptPaths.flatMap((path) => {
            const key = headerKeyOf(path, data);
            return key === null ? [] : [[path, key] as const];
          }),
        );
        // After the form's own error sweep, which runs on the reset values.
        await nextTick();
        flagReentries(notKeptPaths);
      },
      base: () => (editId() ? serverToolset : undefined),
      redactBase: (base) => redactToolsetDraft(base as AiToolsetDraftData).data,
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
      describeRedacted: describeRedactedToolset,
      leaveOnRouteUpdate: (to, from) =>
        to.path !== from.path ||
        to.query.action !== from.query.action ||
        to.query.id !== from.query.id,
    });

    const closeEditor = async () => {
      if (await toolsetDraft.confirmLeave()) emit("cancel:hideform");
    };

    onMounted(async () => {
      const id = editId();
      const loaded = id ? await loadForEdit(id) : "loaded";
      if (loaded === "failed") return;
      // The route's preset fills the form first, so a draft the user continues lands on top of it.
      await loadPresets();
      const query = router.currentRoute.value.query;
      if (!id && query.kind === "skill") form.setFieldValue("kind", "skill");
      const opened = !id && presets.value.find((p) => p.id === query.preset);
      presetOpened.value = !!opened;
      if (opened && opened.kind === "mcp") applyMcpPreset(opened);
      // A deleted toolset still starts the draft, so a draft left for it is dropped with a notice.
      await toolsetDraft.start();
      formReady.value = true;
      if (mcpPreset.value) {
        const url = (form.state.values as AddAiToolsetForm).mcp.url ?? "";
        const params = paramsFromUrl(mcpPreset.value.url_template ?? "", url);
        if (params) form.setFieldValue("mcp.preset_params", params);
      }
      if (loaded === "gone") {
        emit("cancel:hideform");
        return;
      }
      // A saved toolset already has its credentials, so its tools load on open; new ones wait for Connect.
      if (id && formValues.value.kind === "mcp" && mcpUrl.value) {
        await nextTick();
        discoverTools();
      }
      if (query.section === "tools") {
        await nextTick();
        toolPickerAnchor.value?.scrollIntoView?.({ block: "start" });
      }
    });

    return {
      superCluster,
      raw,
      t,
      // 🔑 Options-API: the form MUST be returned so `:form` resolves in the
      // template (else <OForm> gets no form and validation silently no-ops).
      form,
      isEditing,
      selectedKind,
      kindOptions,
      // MCP headers (form-owned array-field)
      mcpHeaders,
      // MCP tool picker
      toolLists,
      setToolLists,
      discoveredTools,
      discoveryStatus,
      discoveryError,
      discoverTools,
      toolPickerAnchor,
      formReady,
      connectionAnchor,
      focusConnection,
      mcpUrl,
      addHeader,
      removeHeader,
      mcpPreset,
      presetOpened,
      setPresetParam,
      // Skill (Monaco content bridged into the form)
      skillContent,
      setSkillContent,
      skillContentError,
      toolsetDraft,
      closeEditor,
    };
  },
});
</script>
