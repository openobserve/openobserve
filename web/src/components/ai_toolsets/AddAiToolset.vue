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
                  data-o2-privacy="mask"
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
                data-o2-privacy="mask"
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
            <div v-for="(header, idx) in mcpHeaders" :key="idx" class="mb-2 flex items-start gap-2">
              <OFormInput
                :name="`mcp.headers[${idx}].key`"
                :label="t('aiToolset.headerKey')"
                class="o2-input flex-1"
              />
              <OFormInput
                :name="`mcp.headers[${idx}].value`"
                :label="t('aiToolset.headerValue')"
                data-o2-privacy="mask"
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
                class="mt-6"
                @click="removeHeader(idx)"
              >
                <OIcon name="delete" size="xs" />
              </OButton>
            </div>
            <OButton variant="outline" size="sm" class="mb-4" @click="addHeader" icon-left="add">
              {{ t("aiToolset.addHeader") }}
            </OButton>
            <div
              role="group"
              aria-labelledby="ai-toolset-oauth-heading"
              aria-describedby="ai-toolset-oauth-hint"
              data-test="ai-toolset-oauth"
            >
              <div id="ai-toolset-oauth-heading" class="mb-2 text-sm font-medium">
                {{ t("aiToolset.oauthClientCredentials") }}
              </div>
              <div id="ai-toolset-oauth-hint" class="text-text-secondary mb-2 text-xs">
                {{ t("aiToolset.oauthHint") }}
              </div>
              <div class="o2-input mb-4">
                <OFormInput
                  data-test="ai-toolset-token-url"
                  data-o2-privacy="mask"
                  name="mcp.auth.token_url"
                  :label="t('aiToolset.tokenUrl')"
                  class="showLabelOnTop w-full"
                />
              </div>
              <div class="o2-input mb-4">
                <OFormInput
                  data-test="ai-toolset-client-id"
                  name="mcp.auth.client_id"
                  :label="t('aiToolset.clientId')"
                  class="showLabelOnTop w-full"
                  autocomplete="off"
                />
              </div>
              <div class="o2-input mb-4">
                <OFormInput
                  data-test="ai-toolset-client-secret"
                  data-o2-privacy="mask"
                  name="mcp.auth.client_secret"
                  :label="t('aiToolset.clientSecret')"
                  class="showLabelOnTop w-full"
                  type="password"
                  revealable
                  autocomplete="new-password"
                />
              </div>
              <div class="o2-input mb-4">
                <OFormInput
                  data-test="ai-toolset-scope"
                  name="mcp.auth.scope"
                  :label="t('aiToolset.scope')"
                  class="showLabelOnTop w-full"
                />
              </div>
            </div>
            <div ref="toolPickerAnchor">
              <AiToolsetToolPicker
                :lists="toolLists"
                :tools="discoveredTools"
                :status="discoveryStatus"
                :error="discoveryError"
                :preset-tools="mcpPreset ? (toolLists.allowed ?? []).length : undefined"
                @update:lists="setToolLists"
                @remove="removeOtherEntry"
                @refresh="discoverTools"
              />
            </div>
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
import {
  prefillFromDiscovery,
  removeEntry,
  type DiscoveredTool,
  type OtherEntry,
  type ToolLists,
} from "./toolPicker";
import { defaultParams, paramsFromUrl, presetData, renderUrl, type Preset } from "./presets";
import {
  authFromData,
  authPayload,
  authReady,
  CLIENT_CREDENTIALS,
  emptyAuth,
  isAuthorizationHeader,
  sameOrigin,
  sentHeaderRows,
  usesClientCredentials,
  type ToolsetAuth,
} from "./toolsetAuth";
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
  mcp: Omit<AddAiToolsetForm["mcp"], "headers" | "auth"> & {
    headers: SecretPair[];
    auth: ToolsetAuth;
  };
}

export default defineComponent({
  name: "AddAiToolset",
  components: {
    OPageLayout,
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

    // The stored URL and auth an edit started from.
    let loadedMcp: { url?: string; auth: ToolsetAuth } | null = null;

    const addAiToolsetSchema = makeAddAiToolsetSchema(
      t,
      () => isEditing.value,
      (mcp) =>
        !!loadedMcp &&
        sameOrigin(mcp.url, loadedMcp.url) &&
        JSON.stringify(authPayload(mcp.auth)) === JSON.stringify(authPayload(loadedMcp.auth)),
    );

    const kindOptions = [
      { label: t("aiToolset.kindMcp"), value: "mcp" },
      { label: t("aiToolset.kindSkill"), value: "skill" },
    ];

    const discoveredTools = ref<DiscoveredTool[] | null>(null);
    const discoveryStatus = ref<"idle" | "loading" | "ok" | "failed">("idle");
    const discoveryError = ref("");
    // The request the last successful discovery made, and when it ran (microseconds).
    let verified: { key: string; at: number } | null = null;
    let discoverySeq = 0;

    const headerMap = (mcp: AddAiToolsetForm["mcp"]) => {
      const headers: Record<string, string> = {};
      sentHeaderRows(mcp.headers, mcp.auth)
        .filter((h) => (h.key ?? "").trim())
        .forEach((h) => {
          headers[(h.key ?? "").trim()] = h.value ?? "";
        });
      return headers;
    };

    const discoveryTimeout = (mcp: AddAiToolsetForm["mcp"]) => Number(mcp.timeout_seconds) || 30;

    // Every row, half-typed ones included, so typing anywhere voids a result in flight.
    const discoveryKey = (mcp: AddAiToolsetForm["mcp"]) =>
      JSON.stringify([
        mcp.url ?? "",
        discoveryTimeout(mcp),
        (mcp.headers ?? []).map((h) => [h.key ?? "", h.value ?? ""]),
        // Until a client id is typed, a token URL or scope changes nothing that is sent.
        authPayload(mcp.auth) ?? mcp.auth?.client_secret ?? "",
      ]);

    const MCP_RENDERED_KEYS = new Set([
      "schema",
      "url",
      "headers",
      "auth",
      "timeout_seconds",
      "allowed_tools",
      "blocked_tools",
      "write_tools",
      "tools_verified_at",
    ]);

    // Older preset metadata held the template's values, which can be the URL itself.
    const withoutUrlCopies = (extra: Record<string, any>) => {
      if (!extra.preset?.params) return extra;
      const { params: _params, ...preset } = extra.preset;
      return { ...extra, preset };
    };

    // `schema: 2` makes the save replace the stored config, so every key this form doesn't edit is
    // sent back from `extra`, and an absent list stays absent.
    const buildMcpData = (mcp: AddAiToolsetForm["mcp"]) => {
      const data: Record<string, any> = {
        ...(mcp.extra ?? {}),
        schema: 2,
        url: mcp.url ?? "",
        headers: headerMap(mcp),
        timeout_seconds: Number(mcp.timeout_seconds),
      };
      const auth = authPayload(mcp.auth);
      if (auth) data.auth = auth;
      const lists = shownLists(mcp);
      if (lists.allowed !== null) data.allowed_tools = lists.allowed;
      if (lists.blocked !== null) data.blocked_tools = lists.blocked;
      // An empty list would let every tool run on read-only turns, so an unknown one stays absent.
      if (lists.write !== null) data.write_tools = lists.write;
      if (verified && verified.key === discoveryKey(mcp)) data.tools_verified_at = verified.at;
      return data;
    };

    // -----------------------------------------------------------------------
    // Build the API payload from the validated submit value (single source of
    // truth — incl. the form-owned arrays and the bridged Monaco values).
    // -----------------------------------------------------------------------
    const buildData = (value: AddAiToolsetForm) => {
      const kind = value.kind;
      if (kind === "mcp") return buildMcpData(value.mcp);
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
    const presetParams = ref<Record<string, string>>({});

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
      form.setFieldValue("mcp.auth", {
        ...emptyAuth(),
        token_url: preset.auth?.type === CLIENT_CREDENTIALS ? (preset.auth.token_url ?? "") : "",
      });
      setToolLists({ allowed: data.allowed_tools, blocked: null, write: data.write_tools ?? null });
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

    // The form owns the rows: these mutate it, and the `form.useStore` read above re-renders them.
    const addHeader = () =>
      form.pushFieldValue("mcp.headers", { key: "", value: "", visible: false });
    const removeHeader = (i: number) => form.removeFieldValue("mcp.headers", i);
    const toggleHeaderVisible = (i: number) => {
      const cur = !!(form.state.values as AddAiToolsetForm).mcp?.headers?.[i]?.visible;
      form.setFieldValue(`mcp.headers[${i}].visible`, !cur, {
        dontUpdateMeta: true,
      });
    };

    // A discovery only spells out what is shown; the form's own lists change when the admin does.
    const formLists = (mcp: AddAiToolsetForm["mcp"] | undefined): ToolLists => ({
      allowed: mcp?.allowed_tools ?? null,
      blocked: mcp?.blocked_tools ?? null,
      write: mcp?.write_tools ?? null,
    });
    const shownLists = (mcp: AddAiToolsetForm["mcp"] | undefined): ToolLists => {
      const lists = formLists(mcp);
      const current = discoveredTools.value && mcp && verified?.key === discoveryKey(mcp);
      return current ? prefillFromDiscovery(lists, discoveredTools.value ?? []) : lists;
    };
    const toolLists = computed(() => shownLists(formValues.value.mcp));

    const setToolLists = (lists: ToolLists) => {
      form.setFieldValue("mcp.allowed_tools", lists.allowed);
      form.setFieldValue("mcp.blocked_tools", lists.blocked);
      form.setFieldValue("mcp.write_tools", lists.write);
    };
    const removeOtherEntry = (entry: OtherEntry) =>
      setToolLists(removeEntry(formLists(formValues.value.mcp), entry));

    // Every credential is filled in, so a discovery won't run on half-typed ones.
    const readyToDiscover = (mcp: AddAiToolsetForm["mcp"] | undefined) =>
      !!mcp?.url?.trim() &&
      authReady(mcp.auth) &&
      sentHeaderRows(mcp.headers, mcp.auth).every(
        (h) => !(h.key ?? "").trim() === !(h.value ?? ""),
      );

    // The toolset and endpoint a result belongs to; a result for anything else is dropped.
    const discoveryTarget = () => {
      const values = form.state.values as AddAiToolsetForm;
      return `${editingId.value ?? ""}|${values.kind === "mcp" ? discoveryKey(values.mcp) : ""}`;
    };

    const discoverTools = async () => {
      const values = form.state.values as AddAiToolsetForm;
      if (values.kind !== "mcp" || !readyToDiscover(values.mcp)) return;
      clearTimeout(discoveryTimer);
      const org = store.state.selectedOrganization.identifier;
      const key = discoveryKey(values.mcp);
      const target = discoveryTarget();
      const auth = authPayload(values.mcp.auth);
      const config = {
        url: values.mcp.url ?? "",
        headers: headerMap(values.mcp),
        timeout_seconds: discoveryTimeout(values.mcp),
        ...(auth ? { auth } : {}),
      };
      // An override left out keeps the stored value, so headers only is sent as such.
      const body =
        isEditing.value && editingId.value
          ? { id: editingId.value, overrides: { auth: { type: "headers" }, ...config } }
          : config;
      const seq = ++discoverySeq;
      discoveryStatus.value = "loading";
      try {
        const res = await aiToolsetsService.discover(org, body);
        if (seq !== discoverySeq || target !== discoveryTarget()) return;
        // Set before the tools, whose change is what makes the shown lists recompute.
        verified = { key, at: Date.now() * 1000 };
        discoveredTools.value = res.data?.tools ?? [];
        discoveryStatus.value = "ok";
        discoveryError.value = "";
      } catch (err: any) {
        if (seq !== discoverySeq || target !== discoveryTarget()) return;
        discoveredTools.value = null;
        discoveryStatus.value = "failed";
        discoveryError.value =
          err?.response?.data?.message || err?.message || t("aiToolset.toolsUnknownError");
        if (verified?.key === key) verified = null;
      }
    };

    // Discovery follows its request, so it also runs when an edit loads.
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
          record.mcp = {
            url: data.url || "",
            timeout_seconds: data.timeout_seconds ?? 30,
            headers: Object.entries(data.headers || {}).map(([k, v]) => ({
              key: k,
              value: v as string,
              visible: false,
            })),
            auth: authFromData(data.auth),
            allowed_tools: list(data.allowed_tools),
            blocked_tools: list(data.blocked_tools),
            write_tools: list(data.write_tools),
            extra: withoutUrlCopies(
              Object.fromEntries(
                Object.entries(data).filter(([key]) => !MCP_RENDERED_KEYS.has(key)),
              ),
            ),
          };
          loadedMcp = { url: record.mcp.url, auth: record.mcp.auth };
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

    // View state (password visibility) and auth keys the form never edits are not drafted.
    const toolsetSnapshot = (): AiToolsetDraftData => {
      const values = formValues.value;
      const { extra: _extra, ...auth } = values.mcp.auth;
      const pairs = (rows: { key?: string; value?: string }[] | undefined) =>
        (rows ?? []).map((row) => ({ key: row.key ?? "", value: row.value ?? "" }));
      return {
        ...values,
        mcp: { ...values.mcp, headers: pairs(values.mcp?.headers), auth },
        skill: { ...values.skill },
      };
    };

    const HEADER_PATH = /^\/mcp\/headers\/(\d+)\/value$/;
    const MCP_URL_PATH = "/mcp/url";
    const TOKEN_URL_PATH = "/mcp/auth/token_url";
    const CLIENT_SECRET_PATH = "/mcp/auth/client_secret";

    // Header values and the client secret carry auth and a URL can embed a token, so none is drafted.
    const redactToolsetDraft = (data: AiToolsetDraftData) => {
      const copy = JSON.parse(JSON.stringify(data)) as AiToolsetDraftData;
      const paths: string[] = [];
      if (copy.mcp?.url && urlCarriesCredential(copy.mcp.url)) {
        copy.mcp.url = "";
        paths.push(MCP_URL_PATH);
      }
      const auth = copy.mcp?.auth;
      if (auth?.token_url && urlCarriesCredential(auth.token_url)) {
        auth.token_url = "";
        paths.push(TOKEN_URL_PATH);
      }
      if (auth?.client_secret) {
        auth.client_secret = "";
        paths.push(CLIENT_SECRET_PATH);
      }
      (copy.mcp?.headers ?? []).forEach((row, index) => {
        if (!row.value) return;
        row.value = "";
        paths.push(`/mcp/headers/${index}/value`);
      });
      return { data: copy, paths };
    };

    /** The key of the header row a redacted path names; `null` for any other path. */
    const headerKeyOf = (path: string, data: AiToolsetDraftData): string | null => {
      const match = HEADER_PATH.exec(path);
      return match ? (data.mcp?.headers?.[Number(match[1])]?.key ?? "") : null;
    };

    const describeRedactedToolset = (paths: string[], data: AiToolsetDraftData): I18nText[] => {
      const fields = paths.flatMap((path): I18nText[] => {
        if (path === MCP_URL_PATH) return [t("aiToolset.mcpUrl")];
        if (path === TOKEN_URL_PATH) return [t("aiToolset.tokenUrl")];
        if (path === CLIENT_SECRET_PATH) return [t("aiToolset.clientSecret")];
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
    const notKeptHeaders = shallowRef(new Map<string, string>());

    const fieldNameFor = (path: string): FormFieldPath<AddAiToolsetForm> | null => {
      if (path === MCP_URL_PATH) return "mcp.url";
      if (path === TOKEN_URL_PATH) return "mcp.auth.token_url";
      if (path === CLIENT_SECRET_PATH) return "mcp.auth.client_secret";
      const key = notKeptHeaders.value.get(path);
      if (key === undefined) return null;
      const index = (formValues.value.mcp?.headers ?? []).findIndex((row) => row.key === key);
      return index < 0 ? null : (`mcp.headers[${index}].value` as FormFieldPath<AddAiToolsetForm>);
    };

    const flagReentries = (paths: string[], onSubmit?: I18nText) => {
      for (const path of paths) {
        const name = fieldNameFor(path);
        const meta = name ? form.getFieldMeta(name) : undefined;
        if (!name || !meta) continue;
        form.setFieldMeta(name, { ...meta, errorMap: { ...meta.errorMap, onSubmit } });
      }
    };

    // A secret the user switched away from (another kind or credential) is never sent, so it is not asked for.
    const activePendingReentries = (): string[] => {
      const oauth = usesClientCredentials(formValues.value.mcp?.auth);
      return toolsetDraft
        .pendingReentries()
        .filter((path) => path.startsWith(`/${String(selectedKind.value)}/`))
        .filter((path) =>
          path === TOKEN_URL_PATH || path === CLIENT_SECRET_PATH
            ? oauth
            : !oauth || !isAuthorizationHeader({ key: notKeptHeaders.value.get(path) }),
        );
    };

    /** A changed secret the draft could not keep must be typed again before saving. */
    const blockOnPendingReentries = (): boolean => {
      const pending = activePendingReentries();
      if (!pending.length) return false;
      flagReentries(pending, t("common.editorDraft.reenterField"));
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
        // An older draft may hold a kind or fields this form no longer has.
        const { name, description, region_only, skill } = data;
        const kind = kindOptions.some((o) => o.value === data.kind) ? data.kind : "mcp";
        // A draft from before the form had `auth` says nothing about it, so the loaded one stays.
        const loaded = (form.state.values as AddAiToolsetForm).mcp.auth;
        const auth = { ...(data.mcp.auth ?? loaded), extra: loaded.extra };
        form.reset({
          name,
          kind,
          description,
          region_only,
          ...locked,
          mcp: { ...data.mcp, headers: withHidden(data.mcp.headers), auth },
          skill,
        } as AddAiToolsetForm);
        notKeptHeaders.value = new Map(
          notKeptPaths.flatMap((path) => {
            const key = headerKeyOf(path, data);
            return key === null ? [] : [[path, key] as const];
          }),
        );
        // After the form's own error sweep, which runs on the reset values.
        await nextTick();
        flagReentries(notKeptPaths, t("common.editorDraft.reenterField"));
        unflagUnsentReentries();
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

    // A flag stays until its own field changes, so one for a secret that isn't sent would block Save.
    const unflagUnsentReentries = () => {
      const active = activePendingReentries();
      flagReentries(toolsetDraft.pendingReentries().filter((path) => !active.includes(path)));
    };
    watch(() => usesClientCredentials(formValues.value.mcp?.auth), unflagUnsentReentries);

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
      removeOtherEntry,
      discoveredTools,
      discoveryStatus,
      discoveryError,
      discoverTools,
      toolPickerAnchor,
      addHeader,
      removeHeader,
      toggleHeaderVisible,
      mcpPreset,
      presetParams,
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
