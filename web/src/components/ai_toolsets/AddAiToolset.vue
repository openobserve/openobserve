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
    class="min-h-[inherit]"
    :title="isEditing ? t('aiToolset.update') : t('aiToolset.add')"
    :back="{
      label: t('aiToolset.header'),
      onClick: closeEditor,
      dataTest: 'ai-toolset-back-btn',
    }"
    bleed
  >
    <!-- Inline page form. The form is created in setup() via useOForm (headless)
         so this owner can read `kind`/arrays/skill content reactively to drive
         the v-if/v-for below; it's handed to <OForm :form="form">. The Save
         button lives inside <OForm> as type="submit", so Enter + click both
         submit natively (no form-id). -->
    <OForm id="add-ai-toolset-form" :form="form" v-slot="{ isSubmitting }">
      <!-- eslint-disable-next-line local/no-hardcoded-px -- mixed with vh/vw — vh tracks the window while rem tracks font-size; keep the expression unit-consistent -->
      <div style="height: calc(100vh - 120px)" class="overflow-auto">
        <div class="mx-4 mt-4 max-w-2xl">
          <!-- Name -->
          <div class="o2-input mb-4">
            <OFormInput
              data-test="ai-toolset-name-input"
              name="name"
              :label="t('aiToolset.name')"
              required
              class="showLabelOnTop w-full"
              :readonly="isEditing"
              :disabled="isEditing"
            />
          </div>

          <!-- Kind -->
          <div class="o2-input mb-4">
            <OFormSelect
              data-test="ai-toolset-kind-select"
              name="kind"
              :label="t('aiToolset.kind')"
              required
              :options="kindOptions"
              labelKey="label"
              valueKey="value"
              class="showLabelOnTop w-full"
              :disabled="isEditing"
            />
          </div>

          <!-- Description -->
          <div class="o2-input mb-4">
            <OFormTextarea
              data-test="ai-toolset-description-input"
              name="description"
              :label="t('aiToolset.description')"
              class="showLabelOnTop w-full"
            />
          </div>
          <div v-if="superCluster" class="mb-4">
            <OFormSwitch
              name="region_only"
              :label="t('aiToolset.regionOnly')"
              data-test="ai-toolset-region-only"
            />
            <div class="text-text-secondary text-xs">{{ t("aiToolset.regionOnlyHint") }}</div>
          </div>

          <!-- MCP fields -->
          <template v-if="selectedKind === 'mcp'">
            <div class="mb-3 text-base font-medium font-semibold">
              {{ t("aiToolset.mcpConfig") }}
            </div>
            <template v-if="mcpPreset">
              <div v-for="param in mcpPreset.params ?? []" :key="param.name" class="o2-input mb-4">
                <label class="mb-1 block text-sm">{{ param.label }}</label>
                <select
                  v-if="param.options?.length"
                  class="border-border-default rounded-default w-full border px-2 py-1"
                  :value="presetParams[param.name]"
                  :data-test="`ai-toolset-preset-param-${param.name}`"
                  @change="setPresetParam(param.name, ($event.target as HTMLSelectElement).value)"
                >
                  <option v-for="option in param.options" :key="option" :value="option">
                    {{ option }}
                  </option>
                </select>
                <input
                  v-else
                  class="border-border-default rounded-default w-full border px-2 py-1"
                  :placeholder="param.placeholder"
                  :value="presetParams[param.name]"
                  :data-test="`ai-toolset-preset-param-${param.name}`"
                  @input="setPresetParam(param.name, ($event.target as HTMLInputElement).value)"
                />
              </div>
              <div v-if="mcpPreset.help" class="text-text-secondary mb-4 text-xs">
                {{ mcpPreset.help }}
              </div>
            </template>
            <div class="o2-input mb-4">
              <OFormInput
                :placeholder="raw('https://api.example.com/mcp/')"
                data-test="ai-toolset-mcp-url"
                name="mcp.url"
                :label="t('aiToolset.mcpUrl')"
                required
                class="showLabelOnTop w-full"
              />
            </div>
            <div class="o2-input mb-4">
              <OFormInput
                data-test="ai-toolset-mcp-timeout"
                name="mcp.timeout_seconds"
                :label="t('aiToolset.timeoutSeconds')"
                class="showLabelOnTop w-full"
                type="number"
                min="1"
              />
            </div>
            <!-- Headers — form-owned dynamic array-field (mcp.headers[i].*) -->
            <div class="mb-2 text-sm font-medium">{{ t("aiToolset.headers") }}</div>
            <div v-for="(header, idx) in mcpHeaders" :key="idx" class="mb-2 flex items-end gap-2">
              <OFormInput
                :name="`mcp.headers[${idx}].key`"
                :label="t('aiToolset.headerKey')"
                class="o2-input flex-1"
              />
              <OFormInput
                :name="`mcp.headers[${idx}].value`"
                :label="t('aiToolset.headerValue')"
                class="o2-input flex-1"
                :type="header.visible ? 'text' : 'password'"
              >
                <template #icon-right>
                  <OIcon
                    :name="header.visible ? 'visibility-off' : 'visibility'"
                    size="sm"
                    class="cursor-pointer"
                    @click="toggleHeaderVisible(idx)"
                  />
                </template>
              </OFormInput>
              <OButton
                :aria-label="t('common.delete')"
                variant="ghost-destructive"
                size="icon-xs-sq"
                @click="removeHeader(idx)"
              >
                <OIcon name="delete" size="xs" />
              </OButton>
            </div>
            <OButton variant="outline" size="sm" class="mb-4" @click="addHeader" icon-left="add">
              {{ t("aiToolset.addHeader") }}
            </OButton>
            <div ref="toolPickerAnchor">
              <AiToolsetToolPicker
                :lists="toolLists"
                :tools="discoveredTools"
                :status="discoveryStatus"
                :error="discoveryError"
                :preset-tools="mcpPreset ? (toolLists.allowed ?? []).length : undefined"
                @update:lists="setToolLists"
                @refresh="discoverTools"
              />
            </div>
            <div class="mb-2 text-sm font-medium">{{ t("aiToolset.limits") }}</div>
            <div class="mb-4 grid grid-cols-2 gap-3">
              <OFormInput
                data-test="ai-toolset-mcp-max-calls"
                name="mcp.max_calls_per_turn"
                :label="t('aiToolset.maxCallsPerTurn')"
                :placeholder="raw('40')"
                class="o2-input showLabelOnTop"
                type="number"
                min="1"
              />
              <OFormInput
                data-test="ai-toolset-mcp-max-result"
                name="mcp.max_result_kib"
                :label="t('aiToolset.maxResultKib')"
                :placeholder="raw('1024')"
                class="o2-input showLabelOnTop"
                type="number"
                min="1"
              />
              <OFormInput
                data-test="ai-toolset-mcp-rate-calls"
                name="mcp.rate_calls"
                :label="t('aiToolset.rateCalls')"
                :placeholder="raw('200')"
                class="o2-input showLabelOnTop"
                type="number"
                min="1"
              />
              <OFormInput
                data-test="ai-toolset-mcp-rate-seconds"
                name="mcp.rate_seconds"
                :label="t('aiToolset.rateSeconds')"
                :placeholder="raw('60')"
                class="o2-input showLabelOnTop"
                type="number"
                min="1"
              />
            </div>
            <div class="text-text-secondary -mt-2 mb-4 text-xs">
              {{ t("aiToolset.rateLimitHelp") }}
            </div>
          </template>

          <!-- CLI fields -->
          <template v-if="selectedKind === 'cli'">
            <div class="mb-4 flex items-center gap-3">
              <div class="text-base font-medium font-semibold">
                {{ t("aiToolset.cliConfig") }}
              </div>
              <div class="flex items-center gap-1">
                <span class="text-text-muted text-xs">{{ t("aiToolset.presets") }}:</span>
                <OTag
                  v-for="preset in cliPresets"
                  :key="preset.id"
                  type="cliPreset"
                  :value="preset.id"
                  clickable
                  class="cursor-pointer"
                  :data-test="`cli-preset-${preset.id}`"
                  @click="applyPreset(preset)"
                >
                  {{ preset.label }}
                </OTag>
              </div>
            </div>
            <div class="o2-input mb-4">
              <OFormInput
                :placeholder="raw('kubectl')"
                data-test="ai-toolset-cli-command"
                name="cli.command"
                :label="t('aiToolset.cliCommand')"
                required
                class="showLabelOnTop w-full"
              />
            </div>
            <div class="o2-input mb-4">
              <OFormInput
                :placeholder="raw('get, describe, logs')"
                name="cli.allowed_subcommands_raw"
                :label="t('aiToolset.allowedSubcommands')"
                :helpText="t('aiToolset.subcommandsHint')"
                class="showLabelOnTop w-full"
              />
            </div>
            <div class="mb-4 flex gap-4">
              <div class="o2-input flex-1">
                <OFormInput
                  name="cli.timeout_seconds"
                  :label="t('aiToolset.timeoutSeconds')"
                  class="showLabelOnTop w-full"
                  type="number"
                  min="1"
                />
              </div>
              <div class="o2-input flex-1">
                <OFormInput
                  name="cli.max_output_bytes"
                  :label="t('aiToolset.maxOutputBytes')"
                  class="showLabelOnTop w-full"
                  type="number"
                  min="1"
                />
              </div>
            </div>
            <div class="mb-4">
              <OFormSwitch
                name="cli.requires_confirmation"
                :label="t('aiToolset.requiresConfirmation')"
              />
            </div>
            <!-- Env vars — form-owned dynamic array-field (cli.env[i].*) -->
            <div class="mb-2 text-sm font-medium">{{ t("aiToolset.envVars") }}</div>
            <div
              v-for="(env, idx) in cliEnvVars"
              :key="'env-' + idx"
              class="mb-2 flex items-end gap-2"
            >
              <OFormInput
                :name="`cli.env[${idx}].key`"
                :label="t('aiToolset.envKey')"
                class="o2-input flex-1"
              />
              <OFormInput
                :name="`cli.env[${idx}].value`"
                :label="t('aiToolset.envValue')"
                class="o2-input flex-1"
                :type="env.visible ? 'text' : 'password'"
              >
                <template #icon-right>
                  <OIcon
                    :name="env.visible ? 'visibility-off' : 'visibility'"
                    size="sm"
                    class="cursor-pointer"
                    @click="toggleEnvVisible(idx)"
                  />
                </template>
              </OFormInput>
              <OButton
                :aria-label="t('common.delete')"
                variant="ghost-destructive"
                size="icon-xs-sq"
                @click="removeEnvVar(idx)"
              >
                <OIcon name="delete" size="xs" />
              </OButton>
            </div>
            <OButton variant="outline" size="sm" class="mb-4" @click="addEnvVar" icon-left="add">
              {{ t("aiToolset.addEnvVar") }}
            </OButton>

            <!-- Credential files — form-owned array-field. `key` is an OFormInput
                 (cli.credFiles[i].key); `value` is a Monaco editor (no OForm*
                 equivalent) bridged into the form via setCredValue. -->
            <div class="mb-2 text-sm font-medium">
              {{ t("aiToolset.credentialFiles") }}
            </div>
            <div v-for="(cred, idx) in cliCredFiles" :key="'cred-' + idx" class="mb-4">
              <div class="mb-1 flex items-center gap-2">
                <OFormInput
                  :name="`cli.credFiles[${idx}].key`"
                  :label="t('aiToolset.credEnvVar')"
                  :helpText="t('aiToolset.credEnvVarHint', { example: 'KUBECONFIG' })"
                  class="o2-input w-48"
                />
                <OButton
                  variant="ghost-destructive"
                  size="icon-xs-sq"
                  :title="t('common.delete')"
                  @click="removeCredFile(idx)"
                >
                  <OIcon name="delete" size="xs" />
                </OButton>
              </div>
              <div class="text-text-secondary mb-1 text-xs">
                {{ t("aiToolset.credContentHint") }}
              </div>
              <QueryEditor
                :editor-id="`cred-file-editor-${idx}`"
                class="rounded-default border-card-glass-border min-h-50! w-full resize-y overflow-auto border"
                language="yaml"
                :query="cred.value"
                @update:query="(v: string) => setCredValue(idx, v)"
              />
              <div
                v-if="pendingCredFileRows.has(idx)"
                class="text-status-error-text mt-1 text-xs"
                :data-test="`ai-toolset-cred-file-reenter-${idx}`"
              >
                {{ t("common.editorDraft.reenterField") }}
              </div>
            </div>
            <OButton variant="outline" size="sm" class="mb-4" @click="addCredFile" icon-left="add">
              {{ t("aiToolset.addCredFile") }}
            </OButton>
          </template>

          <!-- Skill fields — the Monaco editor (no OForm* equivalent) is bridged
               into the form (skill.content); its required rule lives in the
               schema and the error shows after the first submit (R3). -->
          <template v-if="selectedKind === 'skill'">
            <div class="mb-2 text-base font-medium font-semibold">
              {{ t("aiToolset.skillConfig") }}
            </div>
            <div class="text-text-muted mb-1 text-xs">{{ t("aiToolset.skillContent") }} *</div>
            <QueryEditor
              data-test="ai-toolset-skill-content"
              editor-id="skill-content-editor"
              class="rounded-default border-card-glass-border mb-3 min-h-100! w-full resize-y overflow-auto border"
              language="markdown"
              :query="skillContent"
              @update:query="(v: string) => setSkillContent(v)"
            />
            <div v-if="skillContentError" class="text-error-500 -mt-3 mb-4 text-xs">
              {{ t("aiToolset.skillContentRequired") }}
            </div>
          </template>
        </div>

        <!-- Footer -->
        <div
          class="border-border-default sticky bottom-0 flex items-center justify-end gap-2 border-t px-4 py-3"
          :class="'bg-surface-base'"
        >
          <OButton
            data-test="ai-toolset-cancel-btn"
            variant="outline"
            size="sm-action"
            :disabled="isSubmitting"
            @click="closeEditor"
          >
            {{ t("common.cancel") }}
          </OButton>
          <OButton
            data-test="ai-toolset-save-btn"
            variant="primary"
            size="sm-action"
            type="submit"
            :loading="isSubmitting"
          >
            {{ isEditing ? t("common.update") : t("common.save") }}
          </OButton>
        </div>
      </div>
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
  onBeforeUnmount,
  nextTick,
  shallowRef,
  watch,
} from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import aiToolsetsService from "@/services/ai_toolsets";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
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
import { defaultParams, paramsFromUrl, presetData, renderUrl, type Preset } from "./presets";
import { aiToolsetPresetsQuery } from "@/services/ai_toolsets.queries";
import { queryClient } from "@/composables/query/queryClient";
import {
  makeAddAiToolsetSchema,
  addAiToolsetDefaults,
  type AddAiToolsetForm,
} from "./AddAiToolset.schema";

const QueryEditor = defineAsyncComponent(() => import("@/components/CodeQueryEditor.vue"));

type SecretPair = { key: string; value: string };
type SecretRow = { key?: string; value?: string };
type SecretList = "headers" | "env" | "credFiles";
type SecretRowsSource = {
  mcp?: { headers?: SecretRow[] };
  cli?: { env?: SecretRow[]; credFiles?: SecretRow[] };
};

interface AiToolsetDraftData extends Omit<AddAiToolsetForm, "mcp" | "cli"> {
  mcp: Omit<AddAiToolsetForm["mcp"], "headers"> & { headers: SecretPair[] };
  cli: Omit<AddAiToolsetForm["cli"], "env" | "credFiles"> & {
    env: SecretPair[];
    credFiles: SecretPair[];
  };
}

export default defineComponent({
  name: "AddAiToolset",
  components: {
    OPageLayout,
    OTag,
    OButton,
    OIcon,
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
      { label: t("aiToolset.kindCli"), value: "cli" },
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
      if (kind === "cli") {
        const allowed = (value.cli.allowed_subcommands_raw ?? "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        const env: Record<string, string> = {};
        (value.cli.env ?? [])
          .filter((e) => (e.key ?? "").trim())
          .forEach((e) => {
            env[(e.key ?? "").trim()] = e.value ?? "";
          });
        const credential_files: Record<string, string> = {};
        (value.cli.credFiles ?? [])
          .filter((c) => (c.key ?? "").trim())
          .forEach((c) => {
            credential_files[(c.key ?? "").trim()] = c.value ?? "";
          });
        return {
          command: value.cli.command ?? "",
          // An omitted key keeps the stored allowlist on update, so an emptied one is sent as null.
          allowed_subcommands: allowed.length ? allowed : null,
          timeout_seconds: Number(value.cli.timeout_seconds),
          max_output_bytes: Number(value.cli.max_output_bytes),
          requires_confirmation: value.cli.requires_confirmation ?? false,
          env,
          credential_files,
          // An edit's merge keeps the stored `preset` unless a chip set a new one.
          ...(value.cli.preset ? { preset: value.cli.preset } : {}),
        };
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
    const cliEnvVars = form.useStore(
      (s: any): AddAiToolsetForm["cli"]["env"] => s.values.cli?.env ?? [],
    );
    const cliCredFiles = form.useStore(
      (s: any): AddAiToolsetForm["cli"]["credFiles"] => s.values.cli?.credFiles ?? [],
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
    const cliPresets = computed(() => presets.value.filter((p) => p.kind === "cli"));
    // The MCP preset the form was opened with, and its URL template's fields.
    const mcpPreset = ref<Preset | null>(null);
    const presetParams = ref<Record<string, string>>({});

    const applyPreset = (preset: Preset) => {
      form.setFieldValue("cli.preset", { id: preset.id, revision: preset.revision });
      form.setFieldValue("cli.command", preset.command ?? "");
      form.setFieldValue(
        "cli.allowed_subcommands_raw",
        (preset.allowed_subcommands ?? []).join(", "),
      );
      form.setFieldValue(
        "cli.env",
        (preset.env ?? []).map((key) => ({ key, value: "", visible: false })),
      );
      form.setFieldValue(
        "cli.credFiles",
        (preset.credential_files ?? []).map((key) => ({ key, value: "" })),
      );
    };

    const applyMcpPreset = (preset: Preset) => {
      mcpPreset.value = preset;
      presetParams.value = defaultParams(preset);
      const data = presetData(preset, presetParams.value);
      form.setFieldValue("kind", "mcp");
      if (!form.state.values.name) form.setFieldValue("name", preset.id);
      form.setFieldValue("description", preset.description ?? "");
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
      presetParams.value = { ...presetParams.value, [name]: value };
      form.setFieldValue("mcp.url", renderUrl(preset.url_template ?? "", presetParams.value));
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
    // Dynamic array-fields — FORM-OWNED (mcp.headers / cli.env / cli.credFiles).
    // The form is the single source of truth; add/remove/toggle mutate it via
    // the form API directly, and the `form.useStore` reads above re-render the
    // v-for rows (playbook §2).
    // -----------------------------------------------------------------------
    // MCP headers. (useOForm erases the form generic to Record<string, unknown>,
    // so TanStack's array-field paths collapse to `never` — hence the casts.)
    const addHeader = () =>
      form.pushFieldValue("mcp.headers", { key: "", value: "", visible: false });
    const removeHeader = (i: number) => form.removeFieldValue("mcp.headers", i);
    const toggleHeaderVisible = (i: number) => {
      const cur = !!(form.state.values as AddAiToolsetForm).mcp?.headers?.[i]?.visible;
      form.setFieldValue(`mcp.headers[${i}].visible`, !cur, {
        dontUpdateMeta: true,
      });
    };

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

    // Discovery follows the URL and header rows, so it also runs when an edit loads.
    let discoveryTimer: ReturnType<typeof setTimeout> | undefined;
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
      clearTimeout(discoveryTimer);
      if (key) discoveryTimer = setTimeout(discoverTools, 800);
    });
    onBeforeUnmount(() => clearTimeout(discoveryTimer));

    const toolPickerAnchor = ref<HTMLElement | null>(null);

    // CLI env vars
    const addEnvVar = () => form.pushFieldValue("cli.env", { key: "", value: "", visible: false });
    const removeEnvVar = (i: number) => form.removeFieldValue("cli.env", i);
    const toggleEnvVisible = (i: number) => {
      const cur = !!(form.state.values as AddAiToolsetForm).cli?.env?.[i]?.visible;
      form.setFieldValue(`cli.env[${i}].visible`, !cur, {
        dontUpdateMeta: true,
      });
    };

    // CLI credential files — `key` is an OFormInput; `value` is a Monaco editor
    // bridged into the form (no OForm* equivalent).
    const addCredFile = () => form.pushFieldValue("cli.credFiles", { key: "", value: "" });
    const removeCredFile = (i: number) => form.removeFieldValue("cli.credFiles", i);
    const setCredValue = (i: number, value: string) =>
      form.setFieldValue(`cli.credFiles[${i}].value`, value, {
        dontUpdateMeta: true,
      });

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
        } else if (toolset.kind === "cli") {
          record.cli = {
            command: data.command || "",
            allowed_subcommands_raw: (data.allowed_subcommands || []).join(", "),
            timeout_seconds: data.timeout_seconds ?? 30,
            max_output_bytes: data.max_output_bytes ?? 100000,
            requires_confirmation: data.requires_confirmation ?? false,
            env: Object.entries(data.env || {}).map(([k, v]) => ({
              key: k,
              value: v as string,
              visible: false,
            })),
            credFiles: Object.entries(data.credential_files || {}).map(([k, v]) => ({
              key: k,
              value: v as string,
            })),
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
        cli: {
          ...values.cli,
          env: pairs(values.cli?.env),
          credFiles: pairs(values.cli?.credFiles),
        },
        skill: { ...values.skill },
      };
    };

    const SECRET_SECTION: Record<SecretList, "mcp" | "cli"> = {
      headers: "mcp",
      env: "cli",
      credFiles: "cli",
    };
    const SECRET_PATH = /^\/(?:mcp|cli)\/(headers|env|credFiles)\/(\d+)\/value$/;

    const secretRows = (data: SecretRowsSource, list: SecretList): SecretRow[] =>
      (list === "headers" ? data.mcp?.headers : data.cli?.[list]) ?? [];

    const MCP_URL_PATH = "/mcp/url";

    // Header and env values carry auth, credential files are kubeconfigs and a URL can embed a token, so none is drafted.
    const redactToolsetDraft = (data: AiToolsetDraftData) => {
      const copy = JSON.parse(JSON.stringify(data)) as AiToolsetDraftData;
      const paths: string[] = [];
      if (copy.mcp?.url && urlCarriesCredential(copy.mcp.url)) {
        copy.mcp.url = "";
        paths.push(MCP_URL_PATH);
      }
      for (const list of Object.keys(SECRET_SECTION) as SecretList[]) {
        secretRows(copy, list).forEach((row, index) => {
          if (!row.value) return;
          row.value = "";
          paths.push(`/${SECRET_SECTION[list]}/${list}/${index}/value`);
        });
      }
      return { data: copy, paths };
    };

    const rowOf = (path: string, data: AiToolsetDraftData) => {
      const match = SECRET_PATH.exec(path);
      if (!match) return null;
      const list = match[1] as SecretList;
      return { list, key: secretRows(data, list)[Number(match[2])]?.key ?? "" };
    };

    const describeRedactedToolset = (paths: string[], data: AiToolsetDraftData): I18nText[] => {
      const fields = paths.flatMap((path): I18nText[] => {
        if (path === MCP_URL_PATH) return [t("aiToolset.mcpUrl")];
        const row = rowOf(path, data);
        if (!row) return [];
        if (row.list === "headers") {
          return [
            row.key
              ? t("common.editorDraft.headerField", { name: row.key })
              : t("common.editorDraft.headersField"),
          ];
        }
        if (!row.key) {
          return [row.list === "env" ? t("aiToolset.envVars") : t("aiToolset.credentialFiles")];
        }
        return [
          row.list === "env"
            ? t("common.editorDraft.envVarField", { name: row.key })
            : t("common.editorDraft.credentialFileField", { name: row.key }),
        ];
      });
      return [...new Set(fields)];
    };

    // A not-kept row is found again by its key, since rows may have moved since the draft was written.
    const notKeptRows = shallowRef(new Map<string, { list: SecretList; key: string }>());

    const currentRowIndex = (path: string): number => {
      const row = notKeptRows.value.get(path);
      return row ? secretRows(formValues.value, row.list).findIndex((r) => r.key === row.key) : -1;
    };

    const fieldNameFor = (path: string): FormFieldPath<AddAiToolsetForm> | null => {
      if (path === MCP_URL_PATH) return "mcp.url";
      const row = notKeptRows.value.get(path);
      if (!row) return null;
      const index = currentRowIndex(path);
      return index < 0
        ? null
        : (`${SECRET_SECTION[row.list]}.${row.list}[${index}].value` as FormFieldPath<AddAiToolsetForm>);
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

    // The credential file editors are not form fields, so their re-entry note is drawn by hand.
    const pendingCredFileRows = computed(
      () =>
        new Set(
          activePendingReentries()
            .filter((path) => notKeptRows.value.get(path)?.list === "credFiles")
            .map(currentRowIndex)
            .filter((index) => index >= 0),
        ),
    );

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
      apply: async (data, { notKeptPaths }) => {
        const withHidden = (rows: SecretPair[]) => rows.map((row) => ({ ...row, visible: false }));
        // A saved toolset's name and kind are locked, so the draft can never change them.
        const locked = isEditing.value
          ? { name: form.state.values.name, kind: form.state.values.kind }
          : {};
        form.reset({
          ...data,
          ...locked,
          mcp: { ...data.mcp, headers: withHidden(data.mcp.headers) },
          cli: { ...data.cli, env: withHidden(data.cli.env), credFiles: data.cli.credFiles },
        } as AddAiToolsetForm);
        notKeptRows.value = new Map(
          notKeptPaths.flatMap((path) => {
            const row = rowOf(path, data);
            return row ? [[path, row] as const] : [];
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
      if (opened && opened.kind === "mcp") applyMcpPreset(opened);
      if (opened && opened.kind === "cli") {
        form.setFieldValue("kind", "cli");
        applyPreset(opened);
      }
      // A deleted toolset still starts the draft, so a draft left for it is dropped with a notice.
      await toolsetDraft.start();
      if (mcpPreset.value) {
        const url = (form.state.values as AddAiToolsetForm).mcp.url ?? "";
        presetParams.value =
          paramsFromUrl(mcpPreset.value.url_template ?? "", url) ?? presetParams.value;
      }
      if (loaded === "gone") {
        emit("cancel:hideform");
        return;
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
      // Exposed for the theme-aware footer background (`store.state.theme`).
      store,
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
      addHeader,
      removeHeader,
      toggleHeaderVisible,
      // CLI env vars + credential files (form-owned array-fields)
      cliEnvVars,
      cliCredFiles,
      addEnvVar,
      removeEnvVar,
      toggleEnvVisible,
      addCredFile,
      removeCredFile,
      setCredValue,
      cliPresets,
      applyPreset,
      mcpPreset,
      presetParams,
      setPresetParam,
      // Skill (Monaco content bridged into the form)
      skillContent,
      setSkillContent,
      skillContentError,
      toolsetDraft,
      closeEditor,
      pendingCredFileRows,
    };
  },
});
</script>
