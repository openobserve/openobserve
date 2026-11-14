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
    <!-- Acts on the stored registry, not the form, so it lives in the header. -->
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
      <ConstrainedPage size="lg" align="left" :padded="false" class="min-h-0 flex-1 px-4 py-3">
        <div class="flex flex-col gap-4">
          <!-- Standard attribute is read first, then each fallback in order. -->
          <OFormSection
            variant="plain"
            :title="t('genAiAgentMapping.identity.title')"
            :description="t('genAiAgentMapping.identity.help')"
            data-test="gen-ai-identity-section"
          >
            <OSettingRow
              v-for="f in IDENTITY_FIELDS"
              :key="f.key"
              control-at="end"
              :label="t(f.label)"
              :error="shownFallbackError(f.key, identityText[f.key])"
            >
              <template #description>
                {{ t("genAiAgentMapping.alwaysAppliedStandard") }}
                <code class="text-text-body break-all">{{ f.standard }}</code>
              </template>
              <OTextarea
                v-model="identityText[f.key]"
                autogrow
                :max-rows="FALLBACK_MAX_ROWS"
                :placeholder="raw(f.placeholder)"
                :aria-label="t('llmAttribution.settings.fallbacksFor', { dim: t(f.label) })"
                :error="!!shownFallbackError(f.key, identityText[f.key])"
                :aria-invalid="!!shownFallbackError(f.key, identityText[f.key]) || undefined"
                spellcheck="false"
                :data-test="f.dataTest"
                @blur="markLeft(f.key)"
              />
            </OSettingRow>
            <p class="text-text-secondary px-4 py-3 text-xs">
              {{ t("genAiAgentMapping.fallbacksNote") }}
            </p>
          </OFormSection>

          <!-- At ingest a span without the standard attribute takes its first fallback. -->
          <div id="cost-attribution" class="scroll-mt-4">
            <OFormSection
              variant="plain"
              :title="t('llmAttribution.settings.title')"
              :description="t('llmAttribution.settings.help')"
              data-test="gen-ai-attribution-section"
            >
              <OSettingRow
                v-for="d in ATTRIBUTION_DIMS"
                :key="d"
                control-at="end"
                :label="t(`llmAttribution.dims.${d}`)"
                :error="shownFallbackError(d, attributionText[d])"
              >
                <template #description>
                  {{ t("genAiAgentMapping.alwaysAppliedStandard") }}
                  <code class="text-text-body break-all">{{ ATTRIBUTION_ATTRIBUTES[d] }}</code>
                  <span
                    v-if="coverage[d] !== undefined"
                    :data-test="`gen-ai-attribution-coverage-${d}`"
                  >
                    {{ t("genAiAgentMapping.coverageValue", { percent: coverage[d] }) }}
                  </span>
                </template>
                <OTextarea
                  v-model="attributionText[d]"
                  autogrow
                  :max-rows="FALLBACK_MAX_ROWS"
                  :placeholder="raw(ATTRIBUTION_PLACEHOLDERS[d])"
                  :aria-label="
                    t('llmAttribution.settings.fallbacksFor', {
                      dim: t(`llmAttribution.dims.${d}`),
                    })
                  "
                  :error="!!shownFallbackError(d, attributionText[d])"
                  :aria-invalid="!!shownFallbackError(d, attributionText[d]) || undefined"
                  spellcheck="false"
                  :data-test="`gen-ai-attribution-${d}`"
                  @blur="markLeft(d)"
                />
              </OSettingRow>
              <p class="text-text-secondary px-4 py-3 text-xs">
                {{ t("genAiAgentMapping.fallbacksNote") }}
                {{ t("llmAttribution.settings.note") }}
              </p>
            </OFormSection>
          </div>

          <!-- Harness text agents wrap around user requests, hidden in titles and previews. -->
          <OFormSection
            variant="plain"
            :title="t('genAiAgentMapping.sessions.title')"
            :description="t('genAiAgentMapping.sessions.help')"
            data-test="gen-ai-harness-section"
          >
            <OSettingRow
              control-at="end"
              :label="t('readableSessions.settings.titleSource')"
              :description="t('readableSessions.settings.titleSourceHelp')"
            >
              <OSelect
                v-model="sessionTitle"
                :options="sessionTitleOptions"
                :aria-label="t('readableSessions.settings.titleSource')"
                :searchable="false"
                data-test="gen-ai-session-title"
              />
            </OSettingRow>

            <OSettingRow
              control-at="end"
              :label="t('readableSessions.settings.title')"
              :description="t('readableSessions.settings.help')"
            >
              <OButton
                variant="outline"
                size="sm"
                icon-left="add"
                data-test="gen-ai-harness-add-agent"
                @click="addHarnessRule"
              >
                {{ t("readableSessions.settings.addAgent") }}
              </OButton>
            </OSettingRow>

            <div class="flex flex-col gap-3 px-4 py-3">
              <p
                v-if="harnessRules.length === 0"
                class="text-text-secondary text-xs"
                data-test="gen-ai-harness-empty"
              >
                {{ t("genAiAgentMapping.sessions.noAgents") }}
              </p>
              <div
                v-for="(rule, i) in harnessRules"
                :key="rule.id"
                class="rounded-default border-border-default flex flex-col gap-2 border p-3"
                :data-test="`gen-ai-harness-rule-${i}`"
              >
                <div class="flex items-end gap-2">
                  <OInput
                    v-model="rule.agent"
                    :label="t('readableSessions.settings.agent')"
                    :placeholder="raw('omp')"
                    class="max-w-64"
                    :error="duplicateAgents.has(rule.agent.trim())"
                    :error-message="t('readableSessions.settings.duplicateAgent')"
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
                    :loading="testing === rule.id"
                    :disabled="!rule.agent.trim()"
                    :data-test="`gen-ai-harness-test-${i}`"
                    @click="testRule(rule.id)"
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
                    @click="removeHarnessRule(rule.id)"
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
                  v-if="shownResults[rule.id]"
                  class="bg-surface-subtle rounded-default flex flex-col gap-2 p-2"
                  :data-test="`gen-ai-harness-result-${i}`"
                >
                  <span class="text-2xs text-text-secondary">
                    {{
                      t("readableSessions.settings.matches", {
                        matched: shownResults[rule.id].matched,
                        total: shownResults[rule.id].total,
                      })
                    }}
                  </span>
                  <div v-if="shownResults[rule.id].before" class="grid grid-cols-2 gap-2">
                    <div class="flex min-w-0 flex-col gap-1">
                      <span class="text-2xs text-text-secondary font-semibold">
                        {{ t("readableSessions.settings.before") }}
                      </span>
                      <pre
                        class="text-2xs text-text-body max-h-32 overflow-auto whitespace-pre-wrap"
                        >{{ shownResults[rule.id].before }}</pre>
                    </div>
                    <div class="flex min-w-0 flex-col gap-1">
                      <span class="text-2xs text-text-secondary font-semibold">
                        {{ t("readableSessions.settings.after") }}
                      </span>
                      <pre
                        class="text-2xs text-text-body max-h-32 overflow-auto whitespace-pre-wrap"
                        >{{ shownResults[rule.id].after }}</pre>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </OFormSection>
        </div>
      </ConstrainedPage>

      <!-- Field helpers change the form, so they sit with its Save, not in the header. -->
      <OSaveBar
        class="shrink-0 px-4"
        :loaded="loaded"
        :change-count="changeCount"
        :error-count="errorCount"
        :saving="saving"
        data-test="gen-ai-agent-mapping-save-bar"
        save-data-test="gen-ai-agent-mapping-save-btn"
        discard-data-test="gen-ai-agent-mapping-discard-btn"
        @save="saveConfig"
        @discard="discardChanges"
      >
        <template #start>
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
        </template>
      </OSaveBar>
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
import { useRoute } from "vue-router";
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
import { DEFAULT_HARNESS_PATTERNS } from "@/plugins/traces/harnessText";
import { messagesFromInput } from "@/plugins/traces/threadView.utils";
import { sqlLiteral } from "@/utils/query/sqlFilterBuilder";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OFormSection from "@/lib/core/FormSection/OFormSection.vue";
import OSettingRow from "@/lib/core/SettingRow/OSettingRow.vue";
import ConstrainedPage from "@/components/common/ConstrainedPage.vue";
import OSaveBar from "@/lib/forms/SaveBar/OSaveBar.vue";
import { useLeaveGuard } from "@/lib/forms/SaveBar/useLeaveGuard";
import { toast } from "@/lib/feedback/Toast/useToast";
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

// Standard attributes are checked first by the resolver, mirroring agent_registry.rs.
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
// Patterns stay as typed and are parsed on read, so a trailing newline survives while typing.
type HarnessRow = { id: number; agent: string; patternsText: string };
let nextHarnessRowId = 0;
const harnessRow = (agent = "", patternsText = ""): HarnessRow => ({
  id: nextHarnessRowId++,
  agent,
  patternsText,
});
const harnessRules = ref<HarnessRow[]>([]);
const addHarnessRule = () => {
  harnessRules.value.push(harnessRow());
};
const removeHarnessRule = (id: number) => {
  harnessRules.value = harnessRules.value.filter((r) => r.id !== id);
  const { [id]: _removed, ...rest } = testResults.value;
  testResults.value = rest;
};
// Save refuses duplicate agents, as the server does.
const duplicateAgents = computed(() => {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const r of harnessRules.value) {
    const agent = r.agent.trim();
    if (agent && seen.has(agent)) duplicates.add(agent);
    seen.add(agent);
  }
  return duplicates;
});
const sessionTitle = ref<GenAiAgentMappingConfig["session_title"]>("off");
const sessionTitleOptions = [
  { value: "off", label: t("readableSessions.settings.titleOff") },
  { value: "first_request", label: t("readableSessions.settings.titleFirstRequest") },
];
const ATTRIBUTION_DIMS: AttributionDim[] = ["user", "tenant", "feature"];
const ATTRIBUTION_PLACEHOLDERS: Record<AttributionDim, string> = {
  user: "enduser.id",
  feature: "app.route",
  tenant: "customer.org",
};
const attributionText = ref<Record<AttributionDim, string>>({ user: "", feature: "", tenant: "" });
const coverage = ref<Partial<Record<AttributionDim, number>>>({});
const { getStream } = useStreams(t);
const FALLBACK_MAX_ROWS = 6;
const listToText = (fields: string[]) => fields.join(", ");
// The wrapping control takes Enter, so a line break separates fields like a comma does.
const textToList = (text: string) =>
  text
    .split(/[,\n]/)
    .map((field) => field.trim())
    .filter(Boolean);
// Attribute names carry no spaces; anything else in a fallback list is a typo to catch on leave.
const FIELD_NAME = /^[\w.:/@-]+$/;
type FallbackKey = IdentityKey | AttributionDim;
const leftFields = ref(new Set<FallbackKey>());
const markLeft = (key: FallbackKey) => {
  leftFields.value = new Set(leftFields.value).add(key);
};
const savedConfig = ref("");
// A name already saved stays accepted, so an older config can still be saved without retyping it.
const savedFallbackNames = computed(() => {
  if (!savedConfig.value) return new Set<string>();
  const c: GenAiAgentMappingConfig = JSON.parse(savedConfig.value);
  return new Set([
    ...c.agent_name_fields,
    ...c.agent_id_fields,
    ...c.env_fields,
    ...c.version_fields,
    ...c.attribution_fields.user,
    ...c.attribution_fields.feature,
    ...c.attribution_fields.tenant,
  ]);
});
const isFallbackListValid = (text: string) =>
  textToList(text).every((n) => FIELD_NAME.test(n) || savedFallbackNames.value.has(n));
const shownFallbackError = (key: FallbackKey, text: string) =>
  leftFields.value.has(key) && !isFallbackListValid(text)
    ? t("genAiAgentMapping.fallbackInvalid")
    : undefined;
const fallbackTexts = (): Array<[FallbackKey, string]> => [
  ...(Object.entries(identityText.value) as Array<[IdentityKey, string]>),
  ...(Object.entries(attributionText.value) as Array<[AttributionDim, string]>),
];
const invalidFallbackKeys = computed(() =>
  fallbackTexts()
    .filter(([, text]) => !isFallbackListValid(text))
    .map(([key]) => key),
);
const errorCount = computed(
  () =>
    invalidFallbackKeys.value.filter((key) => leftFields.value.has(key)).length +
    duplicateAgents.value.size,
);
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

// The session columns a traces stream may group by, the Sessions list's first.
const SESSION_COLUMNS = ["gen_ai_conversation_id", "session_id", "llm_session_id"];
const RECENT_SESSIONS = 15;

type HarnessTestResult = {
  // What was tested, so the result hides once the row's agent or patterns change.
  agent: string;
  patterns: string;
  matched: number;
  total: number;
  before: string;
  after: string;
};
const testing = ref<number | null>(null);
// By row id.
const testResults = ref<Record<number, HarnessTestResult>>({});
const patternsKey = (text: string) => textToLines(text).join("\n");
const shownResults = computed(() => {
  const shown: Record<number, HarnessTestResult> = {};
  for (const r of harnessRules.value) {
    const result = testResults.value[r.id];
    if (result?.agent === r.agent.trim() && result.patterns === patternsKey(r.patternsText)) {
      shown[r.id] = result;
    }
  }
  return shown;
});

const recentFirstMessages = async (stream: string, agent: string, start: number, end: number) => {
  const schema = await getStream(stream, "traces", true).catch(() => null);
  const names = new Set((schema?.schema ?? []).map((f: { name: string }) => f.name));
  const sessionColumn = SESSION_COLUMNS.find((c) => names.has(c));
  if (!sessionColumn) return [];
  const res = await searchService.search({
    org_identifier: orgId.value,
    query: {
      query: {
        sql: `SELECT FIRST_VALUE(gen_ai_input_messages ORDER BY start_time ASC) AS input, MAX(start_time) AS last_start FROM "${stream}" WHERE gen_ai_agent_name = ${sqlLiteral(agent)} AND gen_ai_input_messages IS NOT NULL AND gen_ai_input_messages != '' AND "${sessionColumn}" IS NOT NULL GROUP BY "${sessionColumn}" ORDER BY MAX(start_time) DESC LIMIT ${RECENT_SESSIONS}`,
        start_time: start,
        end_time: end,
        from: 0,
        size: RECENT_SESSIONS,
      },
    },
    page_type: "traces",
  });
  return (res.data?.hits ?? []) as Array<{ input: unknown; last_start: number }>;
};

const testRule = async (id: number) => {
  const rule = harnessRules.value.find((r) => r.id === id);
  const agent = rule?.agent.trim();
  if (!orgId.value || !rule || !agent) return;
  const patterns = patternsKey(rule.patternsText);
  testing.value = id;
  try {
    const now = Date.now() * 1000;
    const start = now - 86_400_000_000;
    const agents = await genAiAgentMappingService.listAgents(orgId.value, start, now);
    // Every stream the agent was seen in: the registry has a row per stream and version.
    const streams = [
      ...new Set(
        agents.agents
          .filter((a) => a.name === agent && a.source_stream)
          .map((a) => a.source_stream as string),
      ),
    ];
    const hits = (await Promise.all(streams.map((s) => recentFirstMessages(s, agent, start, now))))
      .flat()
      .sort((a, b) => Number(b.last_start) - Number(a.last_start))
      .slice(0, RECENT_SESSIONS);
    const firsts = hits
      .map((h) => messagesFromInput(h.input).find((m) => m.role === "user")?.content ?? "")
      .filter(Boolean);
    // The server runs the patterns, so the result matches the Sessions list.
    const results = firsts.length
      ? await genAiAgentMappingService.stripHarness(orgId.value, textToLines(patterns), firsts)
      : [];
    const stripped = firsts.map((text, k) => ({ text, out: results[k] }));
    const hit = stripped.find((s) => s.out.hidden > 0);
    // The row was removed while the test ran.
    if (!harnessRules.value.some((r) => r.id === id)) return;
    testResults.value = {
      ...testResults.value,
      [id]: {
        agent,
        patterns,
        matched: stripped.filter((s) => s.out.hidden > 0).length,
        total: stripped.length,
        before: hit?.text ?? "",
        after: hit ? hit.out.text || `(${hit.out.only})` : "",
      },
    };
  } catch (error: any) {
    // A failed run must not leave the previous pattern's result on screen.
    const { [id]: _stale, ...rest } = testResults.value;
    testResults.value = rest;
    toast({
      variant: "error",
      message:
        error?.response?.data?.message ||
        error?.message ||
        t("readableSessions.settings.testFailed"),
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
  harnessRules.value = config.harness_patterns.map((r) =>
    harnessRow(r.agent, r.patterns.join("\n")),
  );
  testResults.value = {};
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
  if (!orgId.value || duplicateAgents.value.size) return;
  if (invalidFallbackKeys.value.length) {
    leftFields.value = new Set(invalidFallbackKeys.value);
    return;
  }

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

const markSaved = () => {
  savedConfig.value = JSON.stringify(draftConfig());
};
// The parts the bar counts: each fallback list, the session title and the harness rules.
const configParts = (c: GenAiAgentMappingConfig) =>
  [
    c.agent_name_fields,
    c.agent_id_fields,
    c.env_fields,
    c.version_fields,
    c.attribution_fields.user,
    c.attribution_fields.feature,
    c.attribution_fields.tenant,
    c.session_title,
    c.harness_patterns,
  ].map((part) => JSON.stringify(part));
const changeCount = computed(() => {
  if (!loaded.value || !savedConfig.value) return 0;
  const saved = configParts(JSON.parse(savedConfig.value));
  return configParts(draftConfig()).filter((part, i) => part !== saved[i]).length;
});
const isDirty = computed(() => changeCount.value > 0);

const discardChanges = () => {
  const saved: GenAiAgentMappingConfig = JSON.parse(savedConfig.value);
  setDraft(saved);
  setReadRules(saved);
  leftFields.value = new Set();
};

useLeaveGuard(() => isDirty.value, {
  count: () => changeCount.value,
  onDiscard: discardChanges,
});

onBeforeMount(() => {
  loadConfig();
  loadCoverage();
});
</script>
