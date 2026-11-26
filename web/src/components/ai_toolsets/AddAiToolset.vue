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
        <div class="w-full max-w-5xl">
          <!-- Edit fixes the type, so step 1 is skipped and the header hidden. -->
          <div
            v-if="isEditing && !formReady"
            class="flex flex-col gap-4"
            data-test="ai-toolset-loading"
          >
            <OInlineNotice
              v-if="editLoadFailed"
              variant="error"
              :text="t('toastMessages.aitoolsets.failedToLoadToolset')"
              :action-label="t('common.retry')"
              data-test="ai-toolset-load-error"
              action-data-test="ai-toolset-load-retry"
              @action="initForm"
            />
            <template v-else>
              <OSkeleton class="rounded-default h-6 w-1/2" />
              <OSkeleton class="rounded-default h-24 w-full" />
            </template>
          </div>
          <OStepper
            v-show="!isEditing || formReady"
            v-model="step"
            animated
            :hide-header="isEditing"
          >
            <OStep
              :name="1"
              :title="t('aiToolset.chooseTypeTitle')"
              icon="edit"
              :done="step > 1"
              :navigable="isEditing ? false : step > 1"
            >
              <OFormSection variant="plain" required :title="t('aiToolset.selectType')">
                <AiToolsetTypeTiles
                  v-model="pickedTile"
                  :tiles="typeTiles"
                  :label="t('aiToolset.selectType')"
                />
              </OFormSection>
            </OStep>
            <OStep
              :name="2"
              :title="t('aiToolset.configureStepTitle')"
              icon="settings"
              :done="step > 2"
              :navigable="step > 2"
            >
              <div class="flex flex-col gap-4">
                <OFormSection
                  variant="plain"
                  :title="t('aiToolset.details')"
                  data-test="ai-toolset-section-details"
                >
                  <div class="flex flex-col gap-4">
                    <OFormInput
                      data-test="ai-toolset-name-input"
                      name="name"
                      :label="t('aiToolset.name')"
                      required
                      :readonly="isEditing"
                      :disabled="isEditing"
                    />
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
                      <div class="text-text-secondary text-xs">
                        {{ t("aiToolset.regionOnlyHint") }}
                      </div>
                    </div>
                  </div>
                </OFormSection>

                <!-- MCP fields -->
                <template v-if="selectedKind === 'mcp'">
                  <div ref="connectionAnchor">
                    <OFormSection
                      variant="plain"
                      :title="t('aiToolset.connection')"
                      :description="mcpPreset?.help ? raw(mcpPreset.help) : undefined"
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
                              :data-test="`ai-toolset-preset-param-${param.name}`"
                              @update:model-value="(v: string) => setPresetParam(param.name, v)"
                            />
                            <OFormInput
                              v-else
                              :name="`mcp.preset_params.${param.name}`"
                              :label="raw(param.label)"
                              required
                              :placeholder="raw(param.placeholder)"
                              data-o2-privacy="mask"
                              :data-test="`ai-toolset-preset-param-${param.name}`"
                              @update:model-value="(v: string) => setPresetParam(param.name, v)"
                            />
                          </template>
                        </template>
                        <OFormInput
                          :placeholder="raw('https://api.example.com/mcp/')"
                          data-test="ai-toolset-mcp-url"
                          data-o2-privacy="mask"
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
                                  data-o2-privacy="mask"
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
                        <div
                          role="group"
                          aria-labelledby="ai-toolset-oauth-heading"
                          aria-describedby="ai-toolset-oauth-hint"
                          class="flex flex-col gap-4"
                          data-test="ai-toolset-oauth"
                        >
                          <div class="flex flex-col gap-1">
                            <div
                              id="ai-toolset-oauth-heading"
                              class="o-input-label text-compact text-input-label-text flex items-center leading-tight font-medium"
                            >
                              {{ t("aiToolset.oauthClientCredentials") }}
                            </div>
                            <div id="ai-toolset-oauth-hint" class="text-text-secondary text-xs">
                              {{ t("aiToolset.oauthHint") }}
                            </div>
                          </div>
                          <OFormInput
                            data-test="ai-toolset-token-url"
                            data-o2-privacy="mask"
                            name="mcp.auth.token_url"
                            :label="t('aiToolset.tokenUrl')"
                          />
                          <div class="flex items-start gap-4 max-md:flex-col">
                            <div class="w-1/2 max-md:w-full">
                              <OFormInput
                                data-test="ai-toolset-client-id"
                                name="mcp.auth.client_id"
                                :label="t('aiToolset.clientId')"
                                autocomplete="off"
                              />
                            </div>
                            <div class="w-1/2 max-md:w-full">
                              <OFormInput
                                data-test="ai-toolset-client-secret"
                                data-o2-privacy="mask"
                                name="mcp.auth.client_secret"
                                :label="t('aiToolset.clientSecret')"
                                type="password"
                                revealable
                                autocomplete="new-password"
                              />
                            </div>
                          </div>
                          <OFormInput
                            data-test="ai-toolset-scope"
                            name="mcp.auth.scope"
                            :label="t('aiToolset.scope')"
                          />
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
                        @remove="removeOtherEntry"
                        @refresh="connect"
                        @go-connection="focusConnection"
                      />
                    </OFormSection>
                  </div>
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
                      <div
                        v-else-if="skillContentLong"
                        class="text-status-warning-text text-xs"
                        data-test="ai-toolset-skill-long"
                      >
                        {{ t("aiToolset.skillContentLong", { chars: skillContent.length }) }}
                      </div>
                    </div>
                  </OFormSection>
                </template>
              </div>
            </OStep>
          </OStepper>
        </div>
      </div>

      <OSaveBar
        v-if="step === 1"
        mode="create"
        :submit="false"
        class="shrink-0 px-4"
        :save-label="t('alerts.continue')"
        save-data-test="ai-toolset-continue-btn"
        cancel-data-test="ai-toolset-step1-cancel-btn"
        @save="continueToForm"
        @cancel="closeEditor"
      />
      <OSaveBar
        v-else
        :mode="isEditing ? 'edit' : 'create'"
        class="shrink-0 px-4"
        :loaded="formReady"
        data-test="ai-toolset-save-bar"
        save-data-test="ai-toolset-save-btn"
        cancel-data-test="ai-toolset-cancel-btn"
        discard-data-test="ai-toolset-discard-btn"
        @cancel="closeEditor"
      >
        <template v-if="!isEditing" #actions>
          <OButton
            data-test="ai-toolset-step-back-btn"
            variant="outline"
            size="sm-action"
            @click="backToTypes"
          >
            {{ t("common.back") }}
          </OButton>
        </template>
      </OSaveBar>
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
import { useRouter, type LocationQuery } from "vue-router";
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
import AiToolsetTypeTiles, { type ToolsetTypeTile } from "./AiToolsetTypeTiles.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import OInlineNotice from "@/lib/feedback/InlineNotice/OInlineNotice.vue";
import OStepper from "@/lib/navigation/Stepper/OStepper.vue";
import OStep from "@/lib/navigation/Stepper/OStep.vue";
import { getImageURL } from "@/utils/queryUtils";
import {
  prefillFromDiscovery,
  removeEntry,
  type DiscoveredTool,
  type OtherEntry,
  type ToolLists,
} from "./toolPicker";
import {
  defaultParams,
  paramsFromUrl,
  presetData,
  renderUrl,
  stripPresetName,
  type Preset,
} from "./presets";
import {
  authFromData,
  authPayload,
  authReady,
  CLIENT_CREDENTIALS,
  emptyAuth,
  isAuthorizationHeader,
  sameUrl,
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
// About 10k tokens, as much again as a normal chat turn.
const SKILL_LONG_CHARS = 40_000;

type SecretPair = { key: string; value: string };

interface AiToolsetDraftData extends Omit<AddAiToolsetForm, "mcp"> {
  mcp: Omit<AddAiToolsetForm["mcp"], "headers" | "auth" | "preset_params"> & {
    headers: SecretPair[];
    auth: ToolsetAuth;
  };
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
    AiToolsetTypeTiles,
    OStepper,
    OSkeleton,
    OInlineNotice,
    OStep,
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
    // Decided from the route at setup, so an edit never renders step 1 while the toolset loads.
    const isEditing = ref(
      router.currentRoute.value.query.action === "edit" && !!router.currentRoute.value.query.id,
    );

    // The stored URL and auth an edit started from.
    let loadedMcp: { url?: string; auth: ToolsetAuth } | null = null;

    const addAiToolsetSchema = makeAddAiToolsetSchema(
      t,
      () => isEditing.value,
      (mcp) =>
        !!loadedMcp &&
        sameUrl(mcp.url, loadedMcp.url) &&
        JSON.stringify(authPayload(mcp.auth)) === JSON.stringify(authPayload(loadedMcp.auth)),
      () => loadedMcp,
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
      // With no tile picked the type's fields are not shown, so their errors have nowhere to appear.
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
    // A warning only: the whole skill goes into every chat turn, so a long one costs every turn.
    const skillContentLong = computed(() => (skillContent.value ?? "").length > SKILL_LONG_CHARS);

    // -----------------------------------------------------------------------
    // Presets, from `GET /ai/toolsets/prebuilt` (the server's file is the only copy)
    // -----------------------------------------------------------------------
    const presets = ref<Preset[]>([]);
    // The MCP preset the form was opened with, and its URL template's fields.
    const mcpPreset = ref<Preset | null>(null);
    // Off until the saved toolset and presets are in, so the bar shows no change count early.
    const formReady = ref(false);
    // -----------------------------------------------------------------------
    // Type tiles. The URL's `preset` / `kind` names the tile, so links and Back reopen it.
    // -----------------------------------------------------------------------
    const mcpPresets = computed(() => presets.value.filter((p) => p.kind === "mcp"));
    const presetById = (id: unknown) => mcpPresets.value.find((p) => p.id === id) ?? null;
    // The server's preset has no logo field, so known ones are mapped by id.
    const logo = (file: string) => getImageURL(`images/ai_toolsets/${file}.svg`);
    const PRESET_LOGOS: Record<string, string> = {
      datadog: logo("datadog"),
      dynatrace: logo("dynatrace"),
      grafana: logo("grafana"),
    };
    const typeTiles = computed<ToolsetTypeTile[]>(() => [
      ...mcpPresets.value.map((p) => {
        const full = p.description ? stripPresetName(p.description, p.label) : "";
        const short = full.split(/(?<=\.)\s/)[0];
        return {
          id: p.id,
          name: raw(p.label),
          short: short ? raw(short) : t("aiToolset.addMcpDesc", { name: p.label }),
          tip: full ? raw(full) : t("aiToolset.addMcpDesc", { name: p.label }),
          // Without a logo the theme-coloured MCP icon stands in, so it reads in dark mode too.
          ...(PRESET_LOGOS[p.id] ? { image: PRESET_LOGOS[p.id] } : { icon: "mcp" as const }),
        };
      }),
      {
        id: "custom-mcp",
        name: t("aiToolset.addCustomMcp"),
        short: t("aiToolset.addCustomMcpDesc"),
        tip: t("aiToolset.addCustomMcpDesc"),
        icon: "mcp",
      },
      {
        id: "skill",
        name: t("aiToolset.addCustomSkill"),
        short: t("aiToolset.addSkillDesc"),
        tip: t("aiToolset.addSkillDesc"),
        icon: "menu-book",
      },
    ]);
    const tileFromQuery = (query: LocationQuery): string | null => {
      if (query.preset) return String(query.preset);
      if (query.kind === "skill") return "skill";
      return query.kind === "mcp" ? "custom-mcp" : null;
    };
    const tileQuery = (tile: string) =>
      tile === "skill" || tile === "custom-mcp"
        ? { kind: tile === "skill" ? "skill" : "mcp" }
        : { preset: tile };
    const tileOf = (kind: unknown, presetId: unknown) =>
      kind === "skill" ? "skill" : (presetById(presetId)?.id ?? "custom-mcp");
    // The tile the URL names (step 2 is open), the one the form was last filled from, and the
    // card chosen on step 1. Set in setup so the first render already opens the right step.
    const appliedTile = ref<string | null>(tileFromQuery(router.currentRoute.value.query));
    const filledTile = ref<string | null>(null);
    const pickedTile = ref<string | null>(appliedTile.value);

    // A new type's own fields start fresh; Name and Description are kept unless the
    // previous preset filled them in. Coming back to the same type keeps everything.
    const applyTile = (tile: string | null) => {
      const known = tile === "skill" || tile === "custom-mcp" || !!presetById(tile);
      appliedTile.value = known ? tile : null;
      if (!known || tile === filledTile.value) return;
      filledTile.value = tile;
      pickedTile.value = tile;
      const previous = mcpPreset.value;
      const values = form.state.values as AddAiToolsetForm;
      if (previous && values.name === previous.id) form.setFieldValue("name", "");
      if (
        previous &&
        values.description === stripPresetName(previous.description ?? "", previous.label)
      ) {
        form.setFieldValue("description", "");
      }
      mcpPreset.value = null;
      form.setFieldValue("mcp", addAiToolsetDefaults().mcp);
      const preset = presetById(tile);
      if (preset) applyMcpPreset(preset);
      else form.setFieldValue("kind", tile === "skill" ? "skill" : "mcp");
    };

    const queryWithTile = (tile: string | null) => {
      const { preset: _preset, kind: _kind, ...rest } = router.currentRoute.value.query;
      return tile ? { ...rest, ...tileQuery(tile) } : rest;
    };
    const continueToForm = () => {
      const tile = pickedTile.value;
      if (!tile) return;
      applyTile(tile);
      router.push({ query: queryWithTile(tile) });
    };
    const backToTypes = () => {
      appliedTile.value = null;
      pickedTile.value = filledTile.value;
      router.push({ query: queryWithTile(null) });
    };
    const step = computed({
      get: () => (isEditing.value || appliedTile.value ? 2 : 1),
      set: (value: number) => (value === 1 ? backToTypes() : continueToForm()),
    });
    // Back / Forward between tiles re-fills the form for the tile the URL now names.
    watch(
      () => router.currentRoute.value.query,
      (query) => {
        if (isEditing.value || !formReady.value || query.action !== "add") return;
        const tile = tileFromQuery(query);
        if (tile !== appliedTile.value) applyTile(tile);
      },
    );

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
      const params = {
        ...(form.state.values as AddAiToolsetForm).mcp.preset_params,
        [name]: value,
      };
      form.setFieldValue("mcp.url", renderUrl(preset.url_template ?? "", params));
    };

    // A URL typed by hand or restored sets the fields; one that doesn't fit the template needs none.
    const syncPresetParams = () => {
      const preset = mcpPreset.value;
      if (!preset) return;
      const { url = "", preset_params } = (form.state.values as AddAiToolsetForm).mcp;
      const template = preset.url_template ?? "";
      if (Object.keys(preset_params).length && url === renderUrl(template, preset_params)) return;
      const defaults = defaultParams(preset);
      form.setFieldValue(
        "mcp.preset_params",
        url === renderUrl(template, defaults) ? defaults : (paramsFromUrl(template, url) ?? {}),
      );
    };
    watch(() => formValues.value.mcp?.url, syncPresetParams);

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
    // Half-typed credentials can't be listed with, so Connect leads back to them.
    const connect = () =>
      readyToDiscover(formValues.value.mcp) ? discoverTools() : focusConnection();

    // Skill content (Monaco editor — no OForm* equivalent) bridged into the form.
    // Its meta is kept, so an edit of only the content counts as a change to save.
    const setSkillContent = (value: string) => form.setFieldValue("skill.content", value);

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
            preset_params: {},
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

    // View state, auth keys the form never edits and URL copies (`preset_params`) are not drafted.
    const toolsetSnapshot = (): AiToolsetDraftData => {
      const values = formValues.value;
      const { extra: _extra, ...auth } = values.mcp.auth;
      const { preset_params: _params, ...mcp } = values.mcp;
      const pairs = (rows: { key?: string; value?: string }[] | undefined) =>
        (rows ?? []).map((row) => ({ key: row.key ?? "", value: row.value ?? "" }));
      return {
        ...values,
        mcp: { ...mcp, headers: pairs(mcp.headers), auth },
        skill: { ...values.skill },
      };
    };

    const SECRET_PATH = /^\/mcp\/headers\/(\d+)\/value$/;
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

    const headerKeyOf = (path: string, data: AiToolsetDraftData): string | null => {
      const match = SECRET_PATH.exec(path);
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
    const notKeptRows = shallowRef(new Map<string, string>());

    const fieldNameFor = (path: string): FormFieldPath<AddAiToolsetForm> | null => {
      if (path === MCP_URL_PATH) return "mcp.url";
      if (path === TOKEN_URL_PATH) return "mcp.auth.token_url";
      if (path === CLIENT_SECRET_PATH) return "mcp.auth.client_secret";
      const key = notKeptRows.value.get(path);
      if (key === undefined) return null;
      const index = (formValues.value.mcp?.headers ?? []).findIndex((r) => r.key === key);
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
            : !oauth || !isAuthorizationHeader({ key: notKeptRows.value.get(path) }),
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
        // A draft from before the form had `auth` says nothing about it, so the loaded one stays.
        const loaded = (form.state.values as AddAiToolsetForm).mcp.auth;
        const auth = { ...(data.mcp.auth ?? loaded), extra: loaded.extra };
        form.reset({
          ...data,
          ...locked,
          mcp: {
            ...data.mcp,
            preset_params: {},
            headers: withHidden(data.mcp.headers),
            auth,
          },
        } as AddAiToolsetForm);
        // A new toolset's draft names its own tile, so the URL follows it.
        if (!isEditing.value) {
          const tile = tileOf(data.kind, data.mcp.extra?.preset?.id);
          mcpPreset.value = presetById(tile);
          appliedTile.value = tile;
          filledTile.value = tile;
          pickedTile.value = tile;
          if (tileFromQuery(router.currentRoute.value.query) !== tile) {
            router.replace({ query: queryWithTile(tile) });
          }
        }
        syncPresetParams();
        notKeptRows.value = new Map(
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

    const editLoadFailed = ref(false);

    const initForm = async () => {
      editLoadFailed.value = false;
      const id = editId();
      const loaded = id ? await loadForEdit(id) : "loaded";
      if (loaded === "failed") {
        editLoadFailed.value = true;
        return;
      }
      // The route's preset fills the form first, so a draft the user continues lands on top of it.
      await loadPresets();
      const query = router.currentRoute.value.query;
      const tile = tileFromQuery(query);
      // A fresh form already holds the custom defaults, so only a preset fills anything in.
      if (!id && presetById(tile)) applyTile(tile);
      else if (!id) {
        appliedTile.value = tile === "skill" || tile === "custom-mcp" ? tile : null;
        filledTile.value = appliedTile.value;
        if (tile === "skill") form.setFieldValue("kind", "skill");
      }
      // Step 1 starts on the first card, as the pipeline destination type step does.
      pickedTile.value ??= typeTiles.value[0]?.id ?? null;
      // A deleted toolset still starts the draft, so a draft left for it is dropped with a notice.
      await toolsetDraft.start();
      formReady.value = true;
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
    };

    onMounted(initForm);

    return {
      superCluster,
      editLoadFailed,
      initForm,
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
      removeOtherEntry,
      discoveredTools,
      discoveryStatus,
      discoveryError,
      discoverTools,
      toolPickerAnchor,
      formReady,
      connectionAnchor,
      focusConnection,
      connect,
      mcpUrl,
      addHeader,
      removeHeader,
      mcpPreset,
      typeTiles,
      appliedTile,
      pickedTile,
      step,
      continueToForm,
      backToTypes,
      setPresetParam,
      // Skill (Monaco content bridged into the form)
      skillContent,
      setSkillContent,
      skillContentError,
      skillContentLong,
      toolsetDraft,
      closeEditor,
    };
  },
});
</script>
