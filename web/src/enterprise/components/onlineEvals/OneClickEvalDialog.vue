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

<!-- Library judges only: each maps to a catalog scorer, so there is no prompt to write. -->
<template>
  <ODialog
    :open="open"
    size="md"
    :title="
      agentLabel ? t('oneClickEval.title', { agent: agentLabel }) : t('oneClickEval.titleAll')
    "
    :sub-title="t('oneClickEval.subtitle')"
    :primary-button-label="t('oneClickEval.start')"
    :primary-button-disabled="!canStart"
    :primary-button-loading="creating"
    primary-button-data-test="one-click-eval-start"
    :neutral-button-label="t('oneClickEval.fullForm')"
    data-test="one-click-eval-dialog"
    @update:open="(v: boolean) => emit('update:open', v)"
    @click:primary="start"
    @click:neutral="openFullForm"
  >
    <div class="flex flex-col gap-3">
      <section class="flex flex-col gap-1.5">
        <span class="text-compact text-text-heading font-medium">{{ t("oneClickEval.what") }}</span>
        <OSkeleton v-if="loading" type="text" class="h-16 w-full" />
        <span v-else-if="!judges.length" class="text-2xs text-text-error">
          {{ t("oneClickEval.catalogFailed") }}
        </span>
        <OCheckbox
          v-for="judge in judges"
          :key="judge.name"
          :model-value="selected.has(judge.name)"
          :label="raw(judge.displayName || judge.name)"
          :data-test="`one-click-eval-judge-${judge.name}`"
          @update:model-value="(v: unknown) => toggle(judge.name, !!v)"
        />
      </section>

      <section class="flex flex-col gap-1">
        <span class="text-compact text-text-heading font-medium">{{
          t("oneClickEval.judge")
        }}</span>
        <div v-if="provider" class="flex items-center gap-2" data-test="one-click-eval-provider">
          <span class="text-compact text-text-body">
            {{ provider.name }} · {{ provider.defaultModel ?? provider.default_model ?? "" }}
          </span>
          <OBadge
            :variant="
              providerStatus === 'ok'
                ? 'success-soft'
                : providerStatus === 'failed'
                  ? 'error-soft'
                  : 'default-soft'
            "
            size="sm"
          >
            {{ t(`oneClickEval.provider.${providerStatus}`) }}
          </OBadge>
        </div>
        <div v-else-if="!loading" class="flex items-center gap-2">
          <span class="text-2xs text-text-secondary">{{ t("oneClickEval.noProvider") }}</span>
          <OButton
            variant="outline"
            size="sm"
            data-test="one-click-eval-add-provider"
            @click="addProvider"
          >
            {{ t("oneClickEval.addProvider") }}
          </OButton>
        </div>
        <span v-if="providerStatus === 'failed'" class="text-2xs text-text-error">
          {{ providerMessage }}
        </span>
      </section>

      <span
        v-if="!loading && !streams.length"
        class="text-2xs text-text-error"
        data-test="one-click-eval-no-stream"
      >
        {{ t("oneClickEval.noStream") }}
      </span>
      <div class="grid grid-cols-2 gap-3">
        <OSelect
          v-model="selectedStream"
          :options="streamOptions"
          :label="t('oneClickEval.stream')"
          data-test="one-click-eval-stream"
        />
        <OSelect
          v-model="rate"
          :options="RATES.map((r) => ({ value: r, label: raw(`${r * 100}%`) }))"
          :label="t('oneClickEval.sample')"
          data-test="one-click-eval-rate"
        />
      </div>
      <span class="text-2xs text-text-secondary" data-test="one-click-eval-estimate">
        <template v-if="tracesPerDay">
          {{
            t(
              "oneClickEval.estimate",
              { traces: Math.round(tracesPerDay * rate).toLocaleString() },
              Math.round(tracesPerDay * rate),
            )
          }}
        </template>
        <template v-if="!judgeUnpriced">
          {{ t("evalSpend.oneClick.budget", { amount: formatUsd(DEFAULT_DAILY_BUDGET_USD) }) }}
        </template>
      </span>
      <!-- An unpriced judge call costs nothing the budget can see, so the budget never pauses the job. -->
      <OBanner
        v-if="judgeUnpriced"
        variant="warning"
        icon="warning"
        dense
        inline-actions
        text-size="small"
        data-test="one-click-eval-unpriced"
      >
        {{
          t("evalSpend.oneClick.unpriced", {
            model: judgeModel,
            amount: formatUsd(DEFAULT_DAILY_BUDGET_USD),
          })
        }}
        <template #actions>
          <OButton
            variant="outline"
            size="xs"
            data-test="one-click-eval-set-price"
            @click="setPrice"
          >
            {{ t("evalSpend.cost.setPrice") }}
          </OButton>
        </template>
      </OBanner>

      <section class="flex flex-col gap-0.5">
        <span class="text-compact text-text-heading font-medium">{{
          t("oneClickEval.mapping")
        }}</span>
        <span class="text-2xs text-text-secondary"
          ><code>{{ MAPPING.input }}</code> · {{ t("oneClickEval.mappingInput") }}</span
        >
        <span class="text-2xs text-text-secondary"
          ><code>{{ MAPPING.output }}</code> · {{ t("oneClickEval.mappingOutput") }}</span
        >
      </section>
    </div>
  </ODialog>
</template>

<script lang="ts" setup>
import { computed, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import { raw, useI18nTyped } from "@/types/i18n";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import modelPricing from "@/services/model_pricing";
import { exactModelPattern } from "@/components/settings/unpricedModelPricing";
import { toast } from "@/lib/feedback/Toast/useToast";
import useStreams from "@/composables/useStreams";
import onlineEvalsService, {
  type EvalTargetScope,
  type Provider,
  type ScoreConfig,
  type Scorer,
} from "@/services/online-evals.service";
import {
  fetchOnlineEvalsCatalog,
  type CatalogScoreConfig,
  type CatalogScorer,
} from "@/services/online-evals-catalog.service";
import { entityId, providerTypeOf } from "./utils/evalEntity";
import { extractTemplateVariables } from "./utils/evalFormat";
import { TRACE_COMPLETION_WINDOW_DEFAULTS } from "./utils/completionWindow";
import {
  buildOneClickJob,
  ONE_CLICK_JUDGES,
  ONE_CLICK_MAPPING,
  oneClickWhere,
} from "./utils/oneClickEval";
import { DEFAULT_DAILY_BUDGET_USD, formatUsd } from "./utils/evalSpend";
import { useJobSpendEstimate } from "./composables/useJobSpendEstimate";

const props = defineProps<{
  open: boolean;
  /** The agent to evaluate; none = every trace on the stream. */
  agent?: string | null;
  stream?: string;
}>();
const emit = defineEmits<{
  (e: "update:open", value: boolean): void;
  (e: "created", configId: string): void;
}>();

const RATES = [0.01, 0.05, 0.1, 0.25, 1];
const MAPPING = {
  input: `input ← ${ONE_CLICK_MAPPING.input}`,
  output: `output ← ${ONE_CLICK_MAPPING.output}`,
};

const { t } = useI18nTyped();
const store = useStore();
const router = useRouter();
const { getStreams } = useStreams(t);
const org = () => store.state.selectedOrganization?.identifier ?? "";

const loading = ref(false);
const creating = ref(false);
const judges = ref<CatalogScorer[]>([]);
const catalogConfigs = ref<CatalogScoreConfig[]>([]);
const selected = ref<Set<string>>(new Set(["hallucination"]));
const provider = ref<Provider | null>(null);
const providerStatus = ref<"testing" | "ok" | "failed">("testing");
const providerMessage = ref("");
const judgeModel = computed(
  () => provider.value?.defaultModel ?? provider.value?.default_model ?? "",
);
// No pricing rule covers the judge model: its calls carry no cost, so the budget cannot pause the job.
const judgeUnpriced = ref(false);
const streams = ref<string[]>([]);
const selectedStream = ref("");
const rate = ref(0.1);

const agentLabel = computed(() => props.agent || selectedStream.value);
const streamOptions = computed(() => streams.value.map((s) => ({ value: s, label: raw(s) })));
// Traces a day on the selected stream at the job's filter, as the job form estimates it.
const { estimate } = useJobSpendEstimate({
  stream: selectedStream,
  where: computed(() => oneClickWhere(props.agent ?? null)),
  ready: computed(() => props.open),
  scope: computed<EvalTargetScope>(() => "trace"),
  fields: computed<string[]>(() => []),
  judgeIds: computed<string[]>(() => []),
  rate,
});
const tracesPerDay = computed(() => estimate.value.matchedPerDay);
const canStart = computed(
  () => providerStatus.value === "ok" && selected.value.size > 0 && !!selectedStream.value,
);

function toggle(name: string, on: boolean) {
  const next = new Set(selected.value);
  if (on) next.add(name);
  else next.delete(name);
  selected.value = next;
}

// The provider is checked on open with the same call as Test Connection.
async function testProvider(p: Provider) {
  providerStatus.value = "testing";
  try {
    await onlineEvalsService.providers.testConfig(
      org(),
      {
        name: p.name,
        providerType: providerTypeOf(p),
        endpoint: p.endpoint ?? null,
        defaultModel: p.defaultModel ?? p.default_model ?? "",
        availableModels: p.availableModels ?? p.available_models ?? [],
        authConfig: { api_key: "" },
        isDefault: false,
      },
      p.id,
    );
    providerStatus.value = "ok";
  } catch (e: any) {
    providerStatus.value = "failed";
    providerMessage.value = e?.response?.data?.message ?? String(e?.message ?? e);
  }
}

async function load() {
  loading.value = true;
  judgeUnpriced.value = false;
  try {
    const [providers, catalog, traceStreams] = await Promise.all([
      onlineEvalsService.providers.list(org()).catch(() => [] as Provider[]),
      fetchOnlineEvalsCatalog().catch(() => ({ scorers: [], scoreConfigs: [] })),
      getStreams("traces", false, false).catch(() => ({ list: [] })),
    ]);
    judges.value = ONE_CLICK_JUDGES.map((name) =>
      catalog.scorers.find((s: CatalogScorer) => s.name === name),
    ).filter((s): s is CatalogScorer => !!s);
    catalogConfigs.value = catalog.scoreConfigs;
    streams.value = ((traceStreams as any)?.list ?? [])
      .filter((s: any) => s?.settings?.is_llm_stream !== false && !s.name.startsWith("_"))
      .map((s: any) => s.name);
    selectedStream.value =
      props.stream && streams.value.includes(props.stream)
        ? props.stream
        : (streams.value[0] ?? "");
    provider.value =
      providers.find((p: any) => p.isDefault || p.is_default) ?? providers[0] ?? null;
  } finally {
    loading.value = false;
  }
  if (provider.value) await Promise.all([testProvider(provider.value), checkPricing()]);
  else providerStatus.value = "failed";
}

// A failed lookup leaves pricing unknown, which is not unpriced.
async function checkPricing() {
  if (!judgeModel.value) return;
  try {
    const res = await modelPricing.test(org(), { model_name: judgeModel.value });
    judgeUnpriced.value = !res.data?.matched;
  } catch {
    // unknown: keep the budget line
  }
}

function setPrice() {
  emit("update:open", false);
  router.push({
    name: "modelPricingEditor",
    query: {
      org_identifier: org(),
      name: judgeModel.value,
      match_pattern: exactModelPattern(judgeModel.value),
    },
  });
}

// Reuse same-named configs (and read back on 409) so a second click does not fail on a name clash.
async function ensureScoreConfig(name: string): Promise<ScoreConfig> {
  const find = async () =>
    (await onlineEvalsService.scoreConfigs.list(org())).find((c: ScoreConfig) => c.name === name);
  const existing = await find();
  if (existing) return existing;
  const entry = catalogConfigs.value.find((c) => c.name === name);
  if (!entry) throw new Error(t("onlineEvals.catalogScoreConfigNotFound", { name }));
  try {
    return await onlineEvalsService.scoreConfigs.create(org(), {
      name: entry.name,
      dataType: entry.dataType,
      ...(entry.description ? { description: entry.description } : {}),
      ...(entry.numericRange !== undefined ? { numericRange: entry.numericRange } : {}),
      ...(entry.categories !== undefined ? { categories: entry.categories } : {}),
    });
  } catch (e: any) {
    const raced = e?.response?.status === 409 ? await find() : undefined;
    if (raced) return raced;
    throw e;
  }
}

async function ensureScorer(judge: CatalogScorer, configId: string): Promise<Scorer> {
  const find = async () =>
    (await onlineEvalsService.scorers.list(org())).find((s: Scorer) => s.name === judge.name);
  const existing = await find();
  if (existing) return existing;
  try {
    return await onlineEvalsService.scorers.create(org(), {
      name: judge.name,
      description: judge.description,
      scorer: {
        type: judge.scorer.type,
        producesScoreConfigId: configId,
        template: judge.scorer.template,
        params: { ...judge.scorer.params, provider_id: provider.value!.id },
      },
    });
  } catch (e: any) {
    const raced = e?.response?.status === 409 ? await find() : undefined;
    if (raced) return raced;
    throw e;
  }
}

async function start() {
  if (!canStart.value) return;
  creating.value = true;
  try {
    const picked = judges.value.filter((j) => selected.value.has(j.name));
    const scorers: { id: string; variables: string[] }[] = [];
    let firstConfigId = "";
    for (const judge of picked) {
      const config = await ensureScoreConfig(judge.requiredScoreConfigName);
      firstConfigId ||= entityId(config);
      const scorer = await ensureScorer(judge, entityId(config));
      scorers.push({
        id: entityId(scorer),
        variables: scorer.variables ?? extractTemplateVariables(judge.scorer.template),
      });
    }
    const job = await onlineEvalsService.jobs.create(
      org(),
      buildOneClickJob({
        agent: props.agent ?? null,
        stream: selectedStream.value,
        scorers,
        judgeNames: picked.map((j) => j.name),
        rate: rate.value,
        completion: TRACE_COMPLETION_WINDOW_DEFAULTS,
      }),
    );
    await onlineEvalsService.jobs.activate(org(), String(job.id));
    toast({ variant: "success", message: t("oneClickEval.created", { name: job.name }) });
    emit("created", firstConfigId);
    emit("update:open", false);
    router.push({
      name: "aiEvaluations",
      query: {
        org_identifier: org(),
        tab: "quality",
        config: firstConfigId,
        ...(props.agent ? { type: "agent", agent: props.agent } : {}),
      },
    });
  } catch (e: any) {
    toast({
      variant: "error",
      message: t("oneClickEval.failed", {
        reason: e?.response?.data?.message ?? String(e?.message ?? e),
      }),
    });
  } finally {
    creating.value = false;
  }
}

function openFullForm() {
  emit("update:open", false);
  router.push({
    name: "aiEvaluations",
    query: { org_identifier: org(), tab: "jobs", action: "add" },
  });
}

function addProvider() {
  emit("update:open", false);
  const back = router.resolve({
    path: router.currentRoute.value.path,
    query: { ...router.currentRoute.value.query, one_click: "1" },
  }).fullPath;
  router.push({
    name: "llmProviders",
    query: { org_identifier: org(), action: "add", return_to: back },
  });
}

watch(
  () => props.open,
  (open) => {
    if (open) void load();
  },
  { immediate: true },
);
</script>
