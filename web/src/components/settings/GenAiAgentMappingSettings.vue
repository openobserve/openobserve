<template>
  <OPageLayout
    overflow-first
    data-test="gen-ai-agent-mapping-settings"
    :subtitle="t('genAiAgentMapping.subtitle')"
    icon="account-tree"
    bleed
  >
    <template #title>
      <span data-test="gen-ai-agent-mapping-page-title">{{ t("genAiAgentMapping.title") }}</span>
    </template>
    <!-- Page-level action on the stored registry, not the form: it stays in
         the header, like LLM Providers' "New Provider". -->
    <template #actions>
      <OButton
        data-test="gen-ai-agent-registry-clear-btn"
        variant="outline-destructive"
        size="sm"
        :loading="clearingRegistry"
        :disabled="!loaded || loadingDefaults || saving"
        @click="openClearRegistryDialog"
      >
        {{ t("genAiAgentMapping.clearRegistry") }}
      </OButton>
    </template>

    <div v-if="loading" class="flex flex-1 items-center justify-center">
      <OSpinner size="md" />
    </div>

    <div v-else-if="forbidden" class="flex flex-1 items-center justify-center">
      <OEmptyState size="hero" preset="no-access" data-test="gen-ai-agent-mapping-forbidden" />
    </div>

    <!-- No form on a failed load: saving what an empty form holds would wipe the stored mapping. -->
    <div v-else-if="loadError" class="flex flex-1 items-center justify-center">
      <OEmptyState
        size="hero"
        preset="load-error"
        data-test="gen-ai-agent-mapping-load-error"
        @action="loadConfig()"
      />
    </div>

    <template v-else>
      <!-- Scrollable form body -->
      <div class="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div class="grid grid-cols-1 gap-5">
          <!-- Agent identity: the same table as cost attribution below. The
               standard attribute is read first, then each fallback in order. -->
          <section class="flex flex-col gap-3" data-test="gen-ai-identity-section">
            <div class="flex flex-col">
              <span class="text-text-heading text-sm font-semibold">
                {{ t("genAiAgentMapping.identity.title") }}
              </span>
              <span class="text-text-secondary text-xs">
                {{ t("genAiAgentMapping.identity.help") }}
              </span>
            </div>
            <div :class="FIELD_GRID">
              <span class="text-2xs text-text-secondary font-semibold">{{
                t("llmAttribution.settings.field")
              }}</span>
              <span class="text-2xs text-text-secondary font-semibold">{{
                t("llmAttribution.settings.standard")
              }}</span>
              <span class="text-2xs text-text-secondary font-semibold">{{
                t("llmAttribution.settings.fallbacks")
              }}</span>
              <span />
              <template v-for="f in IDENTITY_FIELDS" :key="f.key">
                <span class="text-text-body">{{ t(f.label) }}</span>
                <code class="text-2xs text-text-body break-all">{{ f.standard }}</code>
                <OInput
                  v-model="identityText[f.key]"
                  :placeholder="raw(f.placeholder)"
                  :aria-label="t('llmAttribution.settings.fallbacksFor', { dim: t(f.label) })"
                  spellcheck="false"
                  :data-test="f.dataTest"
                />
                <span />
              </template>
            </div>
          </section>

          <!-- AIO-27: the span contract for cost attribution. The standard
               attribute is read first; at ingest a span without it takes the
               first fallback it carries. Coverage is the share of the past
               24 hours' traces in the agent streams that have a value. -->
          <section
            id="cost-attribution"
            class="border-border-default flex scroll-mt-4 flex-col gap-3 border-t pt-4"
            data-test="gen-ai-attribution-section"
          >
            <div class="flex flex-col">
              <span class="text-text-heading text-sm font-semibold">
                {{ t("llmAttribution.settings.title") }}
              </span>
              <span class="text-text-secondary text-xs">
                {{ t("llmAttribution.settings.help") }}
              </span>
            </div>
            <div :class="FIELD_GRID">
              <span class="text-2xs text-text-secondary font-semibold">{{
                t("llmAttribution.settings.field")
              }}</span>
              <span class="text-2xs text-text-secondary font-semibold">{{
                t("llmAttribution.settings.standard")
              }}</span>
              <span class="text-2xs text-text-secondary font-semibold">{{
                t("llmAttribution.settings.fallbacks")
              }}</span>
              <span class="text-2xs text-text-secondary font-semibold">{{
                t("llmAttribution.settings.coverage")
              }}</span>
              <template v-for="d in ATTRIBUTION_DIMS" :key="d">
                <span class="text-text-body">{{ t(`llmAttribution.dims.${d}`) }}</span>
                <code class="text-2xs text-text-body break-all">{{
                  ATTRIBUTION_ATTRIBUTES[d]
                }}</code>
                <OInput
                  v-model="attributionText[d]"
                  :placeholder="raw(ATTRIBUTION_PLACEHOLDERS[d])"
                  :aria-label="
                    t('llmAttribution.settings.fallbacksFor', {
                      dim: t(`llmAttribution.dims.${d}`),
                    })
                  "
                  :data-test="`gen-ai-attribution-${d}`"
                />
                <span class="text-text-secondary" :data-test="`gen-ai-attribution-coverage-${d}`">
                  {{ coverage[d] === undefined ? `—` : `${coverage[d]}%` }}
                </span>
              </template>
            </div>
            <span class="text-2xs text-text-secondary">{{
              t("llmAttribution.settings.note")
            }}</span>
          </section>

          <!-- AIO-22: harness text each agent wraps around its user's request,
               hidden in session titles, first messages and turn previews. -->
          <section
            class="border-border-default flex flex-col gap-3 border-t pt-4"
            data-test="gen-ai-harness-section"
          >
            <div class="flex items-center justify-between gap-2">
              <div class="flex flex-col">
                <span class="text-text-heading text-sm font-semibold">
                  {{ t("readableSessions.settings.title") }}
                </span>
                <span class="text-text-secondary text-xs">
                  {{ t("readableSessions.settings.help") }}
                </span>
              </div>
              <OButton
                variant="outline"
                size="sm"
                icon-left="add"
                data-test="gen-ai-harness-add-agent"
                @click="harnessRules.push({ agent: '', patternsText: '' })"
              >
                {{ t("readableSessions.settings.addAgent") }}
              </OButton>
            </div>

            <div
              v-for="(rule, i) in harnessRules"
              :key="i"
              class="rounded-default border-border-default flex flex-col gap-2 border p-3"
              :data-test="`gen-ai-harness-rule-${i}`"
            >
              <div class="flex items-end gap-2">
                <OInput
                  v-model="rule.agent"
                  :label="t('readableSessions.settings.agent')"
                  :placeholder="raw('omp')"
                  class="max-w-64"
                  :data-test="`gen-ai-harness-agent-${i}`"
                />
                <OButton
                  variant="outline"
                  size="sm"
                  :data-test="`gen-ai-harness-defaults-${i}`"
                  @click="rule.patternsText = DEFAULT_HARNESS_PATTERNS.join('\n')"
                >
                  {{ t("readableSessions.settings.codingAgentDefaults") }}
                </OButton>
                <OButton
                  variant="outline"
                  size="sm"
                  :loading="testing === i"
                  :disabled="!rule.agent.trim()"
                  :data-test="`gen-ai-harness-test-${i}`"
                  @click="testRule(i)"
                >
                  {{ t("readableSessions.settings.test") }}
                </OButton>
                <span class="flex-1" />
                <OButton
                  variant="ghost"
                  size="sm"
                  icon-left="delete"
                  :aria-label="t('readableSessions.settings.remove')"
                  :data-test="`gen-ai-harness-remove-${i}`"
                  @click="harnessRules.splice(i, 1)"
                />
              </div>
              <OTextarea
                v-model="rule.patternsText"
                :label="t('readableSessions.settings.patterns')"
                :help-text="t('readableSessions.settings.patternsHelp')"
                :placeholder="raw('tag system-reminder\ntag job\nregex ^Caveat:.*$')"
                :rows="4"
                spellcheck="false"
                :data-test="`gen-ai-harness-patterns-${i}`"
              />
              <!-- Before / after on recent sessions of this agent, with the draft patterns. -->
              <div
                v-if="testResults[i]"
                class="bg-surface-subtle rounded-default flex flex-col gap-2 p-2"
                :data-test="`gen-ai-harness-result-${i}`"
              >
                <span class="text-2xs text-text-secondary">
                  {{
                    t("readableSessions.settings.matches", {
                      matched: testResults[i].matched,
                      total: testResults[i].total,
                    })
                  }}
                </span>
                <div v-if="testResults[i].before" class="grid grid-cols-2 gap-2">
                  <div class="flex min-w-0 flex-col gap-1">
                    <span class="text-2xs text-text-secondary font-semibold">
                      {{ t("readableSessions.settings.before") }}
                    </span>
                    <pre
                      class="text-2xs text-text-body max-h-32 overflow-auto whitespace-pre-wrap"
                      >{{ testResults[i].before }}</pre>
                  </div>
                  <div class="flex min-w-0 flex-col gap-1">
                    <span class="text-2xs text-text-secondary font-semibold">
                      {{ t("readableSessions.settings.after") }}
                    </span>
                    <pre
                      class="text-2xs text-text-body max-h-32 overflow-auto whitespace-pre-wrap"
                      >{{ testResults[i].after }}</pre>
                  </div>
                </div>
              </div>
            </div>

            <OSelect
              v-model="sessionTitle"
              :options="sessionTitleOptions"
              :label="t('readableSessions.settings.titleSource')"
              :help-text="t('readableSessions.settings.titleSourceHelp')"
              width="sm"
              data-test="gen-ai-session-title"
            />
          </section>
        </div>
      </div>

      <!-- Sticky footer action bar (mirrors AddAlert): primary Save pinned at
           the bottom-right while the body scrolls. The field helpers fill or
           clear the form, so they sit with its Save, not in the page header. -->
      <div class="border-border-default flex shrink-0 items-center gap-2 border-t px-4 py-2.5">
        <OButton
          data-test="gen-ai-agent-mapping-apply-defaults-btn"
          variant="outline"
          size="sm-action"
          :loading="loadingDefaults"
          @click="applyDefaults"
        >
          {{ t("genAiAgentMapping.applyDefaults") }}
        </OButton>
        <OButton
          data-test="gen-ai-agent-mapping-reset-empty-btn"
          variant="outline"
          size="sm-action"
          @click="resetToEmpty"
        >
          {{ t("genAiAgentMapping.resetToEmpty") }}
        </OButton>
        <OButton
          data-test="gen-ai-agent-mapping-save-btn"
          variant="primary"
          size="sm-action"
          class="ms-auto"
          :loading="saving"
          :disabled="!isDirty"
          @click="saveConfig"
        >
          {{ t("common.save") }}
        </OButton>
      </div>
    </template>

    <ODialog
      v-model:open="clearRegistryDialogOpen"
      data-test="gen-ai-agent-registry-clear-dialog"
      size="sm"
      :title="t('genAiAgentMapping.clearRegistryTitle')"
      :secondary-button-label="t('confirmDialog.cancel')"
      :primary-button-label="t('genAiAgentMapping.clearRegistryConfirm')"
      primary-button-variant="destructive"
      :primary-button-loading="clearingRegistry"
      @click:secondary="clearRegistryDialogOpen = false"
      @click:primary="clearAgentRegistry"
    >
      <p class="text-text-body text-sm">
        {{ t("genAiAgentMapping.clearRegistryDescription") }}
      </p>
    </ODialog>
  </OPageLayout>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeMount, ref } from "vue";
import { raw, useI18nTyped, type I18nKey } from "@/types/i18n";
import { useStore } from "vuex";
import { onBeforeRouteLeave, useRoute } from "vue-router";
import OButton from "@/lib/core/Button/OButton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OTextarea from "@/lib/forms/Input/OTextarea.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import searchService from "@/services/search";
import useStreams from "@/composables/useStreams";
import {
  ATTRIBUTION_ATTRIBUTES,
  ATTRIBUTION_COLUMNS,
  coverageSql,
  type AttributionDim,
} from "@/plugins/traces/llmAttribution";
import { DEFAULT_HARNESS_PATTERNS, stripHarness } from "@/plugins/traces/harnessText";
import { messagesFromInput } from "@/plugins/traces/threadView.utils";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import { useConfirmDialog } from "@/composables/useConfirmDialog";
import { confirmForcedSignOutDiscard, draftSignOutForced } from "@/utils/drafts/draftSession";
import genAiAgentMappingService, {
  fetchDefaultGenAiAgentMapping,
  type GenAiAgentMappingConfig,
} from "@/services/gen-ai-agent-mapping.service";
import {
  clearGenAiAgentRegistryMutation,
  saveGenAiAgentMappingMutation,
} from "@/services/gen-ai-agent-mapping.queries";
import { useMutation } from "@tanstack/vue-query";

const { t } = useI18nTyped();
const store = useStore();
const route = useRoute();
const { confirm } = useConfirmDialog();

// One grid for both field tables, so their columns line up: field, the
// standard attribute, the fallbacks, and traces with a value (attribution only).
const FIELD_GRID =
  "text-compact grid grid-cols-[7rem_12rem_minmax(0,1fr)_8rem] items-center gap-x-3 gap-y-2";

// The standard attribute the resolver always checks first for each dimension
// (current OTel / GenAI semconv), mirroring agent_registry.rs, then the
// editable fallbacks (seeded with the defaults on load).
type IdentityKey = "agentName" | "agentId" | "env" | "version";
const IDENTITY_FIELDS: Array<{
  key: IdentityKey;
  label: I18nKey;
  standard: string;
  placeholder: string;
  dataTest: string;
}> = [
  {
    key: "agentName",
    label: "genAiAgentMapping.identity.agentName",
    standard: "gen_ai.agent.name",
    placeholder: "my.custom.agent_name, team.agent.label",
    dataTest: "gen-ai-agent-name-fields-input",
  },
  {
    key: "agentId",
    label: "genAiAgentMapping.identity.agentId",
    standard: "gen_ai.agent.id",
    placeholder: "my.custom.agent_id, team.agent.uid",
    dataTest: "gen-ai-agent-id-fields-input",
  },
  {
    key: "env",
    label: "genAiAgentMapping.identity.env",
    standard: "deployment.environment.name",
    placeholder: "my.custom.env, tier",
    dataTest: "gen-ai-env-fields-input",
  },
  {
    key: "version",
    label: "genAiAgentMapping.identity.version",
    standard: "gen_ai.agent.version",
    placeholder: "my.custom.version, release.tag",
    dataTest: "gen-ai-version-fields-input",
  },
];

const loading = ref(false);
// A 403 or a failed read: either way there is no stored mapping to edit.
const forbidden = ref(false);
const loadError = ref(false);
const loaded = ref(false);
const loadingDefaults = ref(false);
const saving = ref(false);
const clearingRegistry = ref(false);
const clearRegistryDialogOpen = ref(false);
const identityText = ref<Record<IdentityKey, string>>({
  agentName: "",
  agentId: "",
  env: "",
  version: "",
});
// AIO-22: per-agent harness patterns and the session title source. Kept out of
// setDraft: "Apply defaults" and the default seeding only cover the field lists.
// Patterns stay as typed (one per line) and are parsed on read, so a trailing
// newline or space survives while typing.
const harnessRules = ref<Array<{ agent: string; patternsText: string }>>([]);
const sessionTitle = ref<GenAiAgentMappingConfig["session_title"]>("off");
const sessionTitleOptions = [
  { value: "off", label: t("readableSessions.settings.titleOff") },
  { value: "first_request", label: t("readableSessions.settings.titleFirstRequest") },
];
// AIO-27: attribution fallbacks, comma separated in the inputs; with the read
// rules they are kept out of setDraft.
const ATTRIBUTION_DIMS: AttributionDim[] = ["user", "tenant", "feature"];
const ATTRIBUTION_PLACEHOLDERS: Record<AttributionDim, string> = {
  user: "enduser.id",
  feature: "app.route",
  tenant: "customer.org",
};
const attributionText = ref<Record<AttributionDim, string>>({ user: "", feature: "", tenant: "" });
const coverage = ref<Partial<Record<AttributionDim, number>>>({});
const { getStream } = useStreams(t);
const listToText = (fields: string[]) => fields.join(", ");
const textToList = (text: string) =>
  text
    .split(",")
    .map((field) => field.trim())
    .filter(Boolean);
const textToLines = (text: string) =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

// Traces of the past 24 hours in the agents' streams, and how many carry each column.
const loadCoverage = async () => {
  if (!orgId.value) return;
  const now = Date.now() * 1000;
  const start = now - 86_400_000_000;
  try {
    const { agents } = await genAiAgentMappingService.listAgents(orgId.value, start, now);
    const streams = [
      ...new Set(
        agents.filter((a) => a.source_stream_type === "traces").map((a) => a.source_stream),
      ),
    ];
    const totals = { traces: 0, user: 0, feature: 0, tenant: 0 };
    for (const stream of streams) {
      const schema = await getStream(stream, "traces", true).catch(() => null);
      const names = new Set((schema?.schema ?? []).map((f: any) => f.name));
      const dims = ATTRIBUTION_DIMS.filter((d) => names.has(ATTRIBUTION_COLUMNS[d]));
      const res = await searchService.search({
        org_identifier: orgId.value,
        query: {
          query: {
            sql: coverageSql(
              stream,
              dims.map((d) => ATTRIBUTION_COLUMNS[d]),
              "",
            ),
            start_time: start,
            end_time: now,
            from: 0,
            size: 1,
          },
        },
        page_type: "traces",
      });
      const row = res.data?.hits?.[0] ?? {};
      totals.traces += Number(row.traces) || 0;
      for (const d of dims) totals[d] += Number(row[ATTRIBUTION_COLUMNS[d]]) || 0;
    }
    coverage.value = totals.traces
      ? Object.fromEntries(
          ATTRIBUTION_DIMS.map((d) => [d, Math.round((100 * totals[d]) / totals.traces)]),
        )
      : {};
  } catch {
    coverage.value = {};
  }
};

const testing = ref<number | null>(null);
const testResults = ref<
  Record<number, { matched: number; total: number; before: string; after: string }>
>({});

// The draft patterns on this agent's last day of first messages: how many match,
// and before / after for the first that does. Spans are not changed.
const testRule = async (i: number) => {
  const rule = harnessRules.value[i];
  if (!orgId.value || !rule?.agent.trim()) return;
  testing.value = i;
  try {
    const agents = await genAiAgentMappingService.listAgents(
      orgId.value,
      (Date.now() - 86_400_000) * 1000,
      Date.now() * 1000,
    );
    // Every stream the agent was seen in: the registry has a row per stream and version.
    const streams = [
      ...new Set(
        agents.agents
          .filter((a) => a.name === rule.agent.trim() && a.source_stream)
          .map((a) => a.source_stream as string),
      ),
    ];
    const now = Date.now() * 1000;
    const hits: any[] = (
      await Promise.all(
        streams.map(
          async (stream) =>
            (
              await searchService.search({
                org_identifier: orgId.value,
                query: {
                  query: {
                    sql: `SELECT gen_ai_conversation_id, FIRST_VALUE(gen_ai_input_messages ORDER BY start_time ASC) AS input FROM "${stream}" WHERE gen_ai_agent_name = '${rule.agent.trim().replace(/'/g, "''")}' AND gen_ai_input_messages IS NOT NULL AND gen_ai_conversation_id IS NOT NULL GROUP BY gen_ai_conversation_id LIMIT 15`,
                    start_time: now - 86_400_000_000,
                    end_time: now,
                    from: 0,
                    size: 15,
                  },
                },
                page_type: "traces",
              })
            ).data?.hits ?? [],
        ),
      )
    ).flat();
    const firsts = hits
      .map((h) => messagesFromInput(h.input).find((m) => m.role === "user")?.content ?? "")
      .filter(Boolean);
    const patterns = textToLines(rule.patternsText);
    const stripped = firsts.map((text) => ({ text, out: stripHarness(text, patterns) }));
    const hit = stripped.find((s) => s.out.hidden > 0);
    testResults.value = {
      ...testResults.value,
      [i]: {
        matched: stripped.filter((s) => s.out.hidden > 0).length,
        total: stripped.length,
        before: hit?.text ?? "",
        after: hit ? hit.out.text || `(${hit.out.only})` : "",
      },
    };
  } catch (error: any) {
    toast({
      variant: "error",
      message: error?.message || t("readableSessions.settings.testFailed"),
    });
  } finally {
    testing.value = null;
  }
};

const orgId = computed(() => store.state.selectedOrganization?.identifier);

// Both writes drop the agent scope; the mutations declare it beside the endpoint.
const saveMapping = useMutation(() => saveGenAiAgentMappingMutation(orgId.value));
const clearRegistry = useMutation(() => clearGenAiAgentRegistryMutation(orgId.value));

const setDraft = (config: GenAiAgentMappingConfig) => {
  identityText.value = {
    agentName: listToText(config.agent_name_fields),
    agentId: listToText(config.agent_id_fields),
    env: listToText(config.env_fields),
    version: listToText(config.version_fields),
  };
};

const draftConfig = (): GenAiAgentMappingConfig => ({
  agent_name_fields: textToList(identityText.value.agentName),
  agent_id_fields: textToList(identityText.value.agentId),
  env_fields: textToList(identityText.value.env),
  version_fields: textToList(identityText.value.version),
  harness_patterns: harnessRules.value
    .map((r) => ({ agent: r.agent.trim(), patterns: textToLines(r.patternsText) }))
    .filter((r) => r.agent && r.patterns.length),
  session_title: sessionTitle.value,
  attribution_fields: {
    user: textToList(attributionText.value.user),
    feature: textToList(attributionText.value.feature),
    tenant: textToList(attributionText.value.tenant),
  },
});

const setReadRules = (config: GenAiAgentMappingConfig) => {
  harnessRules.value = config.harness_patterns.map((r) => ({
    agent: r.agent,
    patternsText: r.patterns.join("\n"),
  }));
  sessionTitle.value = config.session_title;
  attributionText.value = {
    user: listToText(config.attribution_fields.user),
    feature: listToText(config.attribution_fields.feature),
    tenant: listToText(config.attribution_fields.tenant),
  };
};

/** True when a config has no user-set fallbacks in any list. */
const isConfigEmpty = (c: GenAiAgentMappingConfig) =>
  !c.agent_name_fields.length &&
  !c.agent_id_fields.length &&
  !c.env_fields.length &&
  !c.version_fields.length;

const loadConfig = async () => {
  if (!orgId.value) return;

  loading.value = true;
  forbidden.value = false;
  loadError.value = false;
  loaded.value = false;
  try {
    // Show what's actually IN EFFECT, seeded into the editable fields: the org's
    // saved fallbacks if it has customized them, otherwise the defaults — so a
    // fresh org sees the real default fields in the boxes (not empty
    // placeholders) and can edit + save them to org settings. Mirrors the
    // correlation settings pattern (server value → editable field → save → DB).
    const saved = await genAiAgentMappingService.get(orgId.value);
    setReadRules(saved);
    if (isConfigEmpty(saved)) {
      try {
        setDraft(await fetchDefaultGenAiAgentMapping());
      } catch {
        setDraft(saved);
      }
    } else {
      setDraft(saved);
    }
    markSaved();
    loaded.value = true;
  } catch (error) {
    const status = (error as { response?: { status?: number } } | undefined)?.response?.status;
    if (status === 403) forbidden.value = true;
    else loadError.value = true;
  } finally {
    loading.value = false;
  }
  // Insights' Cost by links here: open on the section, below the agent fields.
  if (loaded.value && route.hash === "#cost-attribution") {
    await nextTick();
    document.getElementById("cost-attribution")?.scrollIntoView({ block: "start" });
  }
};

const applyDefaults = async () => {
  loadingDefaults.value = true;
  try {
    setDraft(await fetchDefaultGenAiAgentMapping());
  } catch (error: any) {
    toast({
      variant: "error",
      message: error?.message || t("genAiAgentMapping.defaultsLoadFailed"),
    });
  } finally {
    loadingDefaults.value = false;
  }
};

const resetToEmpty = () => {
  setDraft(genAiAgentMappingService.emptyConfig());
};

const openClearRegistryDialog = () => {
  clearRegistryDialogOpen.value = true;
};

const clearAgentRegistry = async () => {
  if (!orgId.value) {
    clearRegistryDialogOpen.value = false;
    return;
  }

  clearingRegistry.value = true;
  try {
    const result = await clearRegistry.mutateAsync();
    clearRegistryDialogOpen.value = false;
    toast({
      variant: "success",
      message: t("genAiAgentMapping.clearRegistrySuccess", {
        deletedCount: result.deleted_count,
        bufferCount: result.cleared_buffer_count,
      }),
    });
  } catch (error: any) {
    toast({
      variant: "error",
      message:
        error?.response?.data?.message ||
        error?.response?.data?.error ||
        error?.message ||
        t("genAiAgentMapping.clearRegistryFailed"),
    });
  } finally {
    clearingRegistry.value = false;
  }
};

const saveConfig = async () => {
  if (!orgId.value) return;

  saving.value = true;
  try {
    const saved = await saveMapping.mutateAsync(draftConfig());
    setDraft(saved);
    setReadRules(saved);
    markSaved();
    toast({
      variant: "success",
      message: t("genAiAgentMapping.saved"),
    });
  } catch (error: any) {
    toast({
      variant: "error",
      message:
        error?.response?.data?.message ||
        error?.response?.data?.error ||
        error?.message ||
        t("genAiAgentMapping.saveFailed"),
    });
  } finally {
    saving.value = false;
  }
};

// Save, and leaving, compare the form with what was last read or saved — the
// same rule as the other Settings forms (PasswordPolicy, CorrelationSettings).
const savedConfig = ref("");
const markSaved = () => {
  savedConfig.value = JSON.stringify(draftConfig());
};
const isDirty = computed(() => loaded.value && JSON.stringify(draftConfig()) !== savedConfig.value);

onBeforeRouteLeave(async () => {
  if (!isDirty.value) return true;
  if (draftSignOutForced.value) return confirmForcedSignOutDiscard(confirm, t);
  return confirm({
    title: t("common.unsavedChanges"),
    message: t("genAiAgentMapping.unsavedConfirm"),
    confirmLabel: t("common.discardChanges"),
    cancelLabel: t("common.cancel"),
  });
});

onBeforeMount(() => {
  loadConfig();
  loadCoverage();
});
</script>
