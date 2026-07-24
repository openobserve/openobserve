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
      onClick: () => $emit('cancel:hideform'),
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
              <!-- eslint-disable vue/no-bare-strings-in-template -- example URL format, not translatable content -->
              <OFormInput
                placeholder="https://api.example.com/mcp/"
                data-test="ai-toolset-mcp-url"
                name="mcp.url"
                :label="t('aiToolset.mcpUrl')"
                required
                class="showLabelOnTop w-full"
              />
              <!-- eslint-enable vue/no-bare-strings-in-template -->
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
              <OButton variant="ghost-destructive" size="icon-xs-sq" @click="removeHeader(idx)">
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
              <!-- eslint-disable vue/no-bare-strings-in-template -- example CLI command name, not translatable content -->
              <OFormInput
                placeholder="kubectl"
                data-test="ai-toolset-cli-command"
                name="cli.command"
                :label="t('aiToolset.cliCommand')"
                required
                class="showLabelOnTop w-full"
              />
              <!-- eslint-enable vue/no-bare-strings-in-template -->
            </div>
            <div class="o2-input mb-4">
              <!-- eslint-disable vue/no-bare-strings-in-template -- example CLI subcommand names, not translatable content -->
              <OFormInput
                placeholder="get, describe, logs"
                name="cli.allowed_subcommands_raw"
                :label="t('aiToolset.allowedSubcommands')"
                :helpText="t('aiToolset.subcommandsHint')"
                class="showLabelOnTop w-full"
              />
              <!-- eslint-enable vue/no-bare-strings-in-template -->
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
              <OButton variant="ghost-destructive" size="icon-xs-sq" @click="removeEnvVar(idx)">
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
                  helpText="e.g. KUBECONFIG"
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
            @click="$emit('cancel:hideform')"
          >
            {{ t("common.cancel") }}
          </OButton>
        </div>
      </div>
    </OForm>
  </OPageLayout>
</template>

<script lang="ts">
import { defineAsyncComponent, defineComponent, ref, computed, onMounted } from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
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
import { useOForm } from "@/lib/forms/Form/useOForm";
import type { ToolsetKind } from "@/services/ai_toolsets";
import { toast } from "@/lib/feedback/Toast/useToast";
import {
  makeAddAiToolsetSchema,
  addAiToolsetDefaults,
  type AddAiToolsetForm,
} from "./AddAiToolset.schema";

const QueryEditor = defineAsyncComponent(() => import("@/components/CodeQueryEditor.vue"));

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
  },
  emits: ["cancel:hideform"],
  setup(_, { emit }) {
    const store = useStore();
    const router = useRouter();
    const { t } = useI18n();

    // Co-located Zod schema (factory keeps the messages i18n-driven).
    const addAiToolsetSchema = makeAddAiToolsetSchema(t);

    const editingId = ref<string | null>(null);
    const isEditing = ref(false);

    const kindOptions = [
      { label: "MCP Server", value: "mcp" },
      { label: "CLI Tool", value: "cli" },
      { label: "Skill", value: "skill" },
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
      const org = store.state.selectedOrganization.identifier;
      const data = buildData(value);

      try {
        if (isEditing.value && editingId.value) {
          await aiToolsetsService.update(org, editingId.value, {
            description: value.description || undefined,
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
            description: value.description || undefined,
            data,
          });
          toast({
            variant: "success",
            message: t("aiToolset.createdSuccessfully"),
          });
        }
        emit("cancel:hideform");
      } catch (err: any) {
        const msg =
          err?.response?.data?.message ||
          (isEditing.value ? t("aiToolset.updateFailed") : t("aiToolset.createFailed"));
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
    const loadForEdit = async (id: string) => {
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
      } catch {
        toast({ variant: "error", message: "Failed to load toolset" });
      }
    };

    onMounted(() => {
      const query = router.currentRoute.value.query;
      if (query.action === "edit" && query.id) {
        loadForEdit(query.id as string);
      }
    });

    return {
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
    };
  },
});
</script>
