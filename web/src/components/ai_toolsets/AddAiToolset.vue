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

          <!-- MCP fields -->
          <template v-if="selectedKind === 'mcp'">
            <div class="mb-3 text-base font-medium font-semibold">
              {{ t("aiToolset.mcpConfig") }}
            </div>
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
                  v-for="preset in CLI_PRESETS"
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
                class="text-error-500 mt-1 text-xs"
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
          class="border-border-default sticky bottom-0 flex items-center gap-2 border-t px-4 py-3"
          :class="'bg-surface-base'"
        >
          <OButton
            data-test="ai-toolset-save-btn"
            variant="primary"
            size="sm-action"
            type="submit"
            :loading="isSubmitting"
          >
            {{ isEditing ? t("common.update") : t("common.save") }}
          </OButton>
          <OButton
            data-test="ai-toolset-cancel-btn"
            variant="outline"
            size="sm-action"
            :disabled="isSubmitting"
            @click="closeEditor"
          >
            {{ t("common.cancel") }}
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
  nextTick,
  shallowRef,
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
import EditorDraftDialogs from "@/components/common/drafts/EditorDraftDialogs.vue";
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
  },
  emits: ["cancel:hideform", "update:list"],
  setup(_, { emit }) {
    const store = useStore();
    const router = useRouter();
    const { t } = useI18nTyped();

    // Co-located Zod schema (factory keeps the messages i18n-driven).
    const addAiToolsetSchema = makeAddAiToolsetSchema(t);

    const editingId = ref<string | null>(null);
    const isEditing = ref(false);

    const kindOptions = [
      { label: t("aiToolset.kindMcp"), value: "mcp" },
      { label: t("aiToolset.kindCli"), value: "cli" },
      { label: t("aiToolset.kindSkill"), value: "skill" },
    ];

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
        return {
          url: value.mcp.url ?? "",
          headers,
          timeout_seconds: Number(value.mcp.timeout_seconds),
        };
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
          ...(allowed.length ? { allowed_subcommands: allowed } : {}),
          timeout_seconds: Number(value.cli.timeout_seconds),
          max_output_bytes: Number(value.cli.max_output_bytes),
          requires_confirmation: value.cli.requires_confirmation ?? false,
          env,
          credential_files,
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
    // Built-in CLI presets
    // -----------------------------------------------------------------------
    const CLI_PRESETS = [
      {
        id: "kubectl",
        label: "kubectl",
        command: "kubectl",
        allowed_subcommands: "get, describe, logs, top",
        env: [] as Array<{ key: string; value: string; visible: boolean }>,
        credential_files: [{ key: "KUBECONFIG", value: "" }],
      },
      {
        id: "gh",
        label: "gh",
        command: "gh",
        allowed_subcommands: "*",
        env: [{ key: "GH_TOKEN", value: "", visible: false }],
        credential_files: [] as Array<{ key: string; value: string }>,
      },
    ];

    const applyPreset = (preset: (typeof CLI_PRESETS)[number]) => {
      // Cross-field edits driven by a user action → setFieldValue (sanctioned).
      form.setFieldValue("cli.command", preset.command);
      form.setFieldValue("cli.allowed_subcommands_raw", preset.allowed_subcommands);
      // Replace the form-owned env and cred arrays — keep empty placeholders so
      // the user can see exactly which fields to fill in.
      form.setFieldValue(
        "cli.env",
        preset.env.map((e) => ({ ...e })),
      );
      form.setFieldValue(
        "cli.credFiles",
        preset.credential_files.map((c) => ({ key: c.key, value: c.value })),
      );
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
        };
        if (toolset.kind === "mcp") {
          record.mcp = {
            url: data.url || "",
            timeout_seconds: data.timeout_seconds ?? 30,
            headers: Object.entries(data.headers || {}).map(([k, v]) => ({
              key: k,
              value: v as string,
              visible: false,
            })),
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

    const formValues = form.useStore((s: { values: AddAiToolsetForm }) => s.values);
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

    // Header and env values carry auth and credential files are kubeconfigs, so no value is drafted.
    const redactToolsetDraft = (data: AiToolsetDraftData) => {
      const copy = JSON.parse(JSON.stringify(data)) as AiToolsetDraftData;
      const paths: string[] = [];
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
        const row = rowOf(path, data);
        if (!row) return [];
        if (row.list === "headers") {
          return [
            row.key
              ? t("common.editorDraft.headerField", { name: row.key })
              : t("aiToolset.headers"),
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
      // A deleted toolset still starts the draft, so a draft left for it is dropped with a notice.
      await toolsetDraft.start();
      if (loaded === "gone") emit("cancel:hideform");
    });

    return {
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
      CLI_PRESETS,
      applyPreset,
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
