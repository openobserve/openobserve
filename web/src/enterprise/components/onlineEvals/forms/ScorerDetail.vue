<template>
  <div class="sd-scrim" role="dialog" aria-modal="true" @click.self="$emit('close')">
    <aside class="sd" @click.stop data-test="scorer-detail">
      <header class="sd__header">
        <span class="sd__title">
          <OIcon name="grading" size="sm" />
          <span class="sd__title-text">{{ row.name }}</span>
          <span class="sd__title-version">v{{ row.version }}</span>
        </span>
        <span class="sd__type-pill" :class="`sd__type-pill--${scorerType}`">
          {{ scorerTypeLabel }}
        </span>
        <div class="sd__header-spacer" />
        <button
          type="button"
          class="sd__close"
          :aria-label="t('onlineEvals.scorer.detail.close')"
          data-test="scorer-detail-close-btn"
          @click="$emit('close')"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16" height="16" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" stroke-width="2"
            stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </header>

      <div class="sd__body">
        <!-- Description -->
        <section v-if="row.description" class="sd-section">
          <h4 class="sd-section__title">{{ t("onlineEvals.scorer.detail.descriptionSection") }}</h4>
          <p class="sd-section__text">{{ row.description }}</p>
        </section>

        <!-- Configuration -->
        <section class="sd-section">
          <h4 class="sd-section__title">{{ t("onlineEvals.scorer.detail.configurationSection") }}</h4>
          <dl class="sd-kv">
            <dt>{{ t("onlineEvals.scorer.detail.scorerTypeLabel") }}</dt>
            <dd>
              <span class="sd-type-chip" :class="`sd-type-chip--${scorerType}`">{{ scorerTypeLabel }}</span>
            </dd>

            <template v-if="scorerType === 'llm_judge'">
              <dt>{{ t("onlineEvals.scorer.detail.providerLabel") }}</dt>
              <dd>
                <span v-if="provider" class="sd-mono">{{ provider.name }}</span>
                <span v-else class="sd-muted">{{ t("onlineEvals.scorer.detail.providerUnknown") }}</span>
              </dd>

              <template v-if="judgeModel">
                <dt>{{ t("onlineEvals.scorer.detail.modelLabel") }}</dt>
                <dd class="sd-mono">{{ judgeModel }}</dd>
              </template>
            </template>

            <template v-if="scorerType === 'remote' && remoteEndpoint">
              <dt>{{ t("onlineEvals.scorer.detail.endpointLabel") }}</dt>
              <dd class="sd-mono">{{ remoteEndpoint }}</dd>
            </template>
          </dl>
        </section>

        <!-- Produces score config -->
        <section class="sd-section">
          <h4 class="sd-section__title">{{ t("onlineEvals.scorer.detail.producesSection") }}</h4>
          <div v-if="producesConfig" class="sd-produces" data-test="scorer-detail-produces">
            <OIcon name="rule" size="xs" />
            <span class="sd-mono sd-produces__name">{{ producesConfig.name }}</span>
            <span class="sd-produces__version">v{{ producesConfig.version }}</span>
            <span class="sd-produces__sep">·</span>
            <span class="sd-produces__type">{{ dataTypeOf(producesConfig) }}</span>
          </div>
          <div v-else class="sd-empty">
            <OIcon name="info" size="xs" />
            <span>{{ t("onlineEvals.scorer.detail.producesEmpty") }}</span>
          </div>
        </section>

        <!-- Judge prompt / request template -->
        <section v-if="row.template" class="sd-section">
          <h4 class="sd-section__title">
            {{
              scorerType === "llm_judge"
                ? t("onlineEvals.scorer.detail.promptSection")
                : t("onlineEvals.scorer.detail.requestTemplateSection")
            }}
            <span v-if="variables.length" class="sd-section__chip">
              {{ variables.length }} {{ t("onlineEvals.scorer.detail.variablesSuffix") }}
            </span>
          </h4>
          <pre class="sd-code" data-test="scorer-detail-template">{{ row.template }}</pre>
        </section>

        <!-- Output schema -->
        <section v-if="outputSchemaPretty" class="sd-section">
          <h4 class="sd-section__title">{{ t("onlineEvals.scorer.detail.outputSchemaSection") }}</h4>
          <pre class="sd-code sd-code--mono">{{ outputSchemaPretty }}</pre>
        </section>

        <!-- Used by -->
        <section class="sd-section">
          <h4 class="sd-section__title">
            {{ t("onlineEvals.scorer.detail.usedBySection") }}
            <span class="sd-section__chip">{{ usedByJobs.length }}</span>
          </h4>
          <div v-if="usedByJobs.length === 0" class="sd-empty">
            <OIcon name="info" size="xs" />
            <span>{{ t("onlineEvals.scorer.detail.usedByEmpty") }}</span>
          </div>
          <ul v-else class="sd-used-list">
            <li
              v-for="job in usedByJobs"
              :key="job.id"
              class="sd-used-list__item"
              data-test="scorer-detail-used-by-item"
            >
              <OIcon name="play-arrow" size="xs" />
              <span class="sd-mono">{{ job.name }}</span>
              <span class="sd-used-list__meta">{{ job.status }}</span>
            </li>
          </ul>
        </section>

        <!-- Metadata -->
        <section class="sd-section">
          <h4 class="sd-section__title">{{ t("onlineEvals.scorer.detail.metadataSection") }}</h4>
          <dl class="sd-kv">
            <dt>{{ t("onlineEvals.scorer.detail.versionLabel") }}</dt>
            <dd class="sd-mono">v{{ row.version }}</dd>
            <dt v-if="createdAt">{{ t("onlineEvals.scorer.detail.createdLabel") }}</dt>
            <dd v-if="createdAt" class="sd-mono">{{ formatTimestamp(createdAt) }}</dd>
            <dt v-if="updatedAt">{{ t("onlineEvals.scorer.detail.updatedLabel") }}</dt>
            <dd v-if="updatedAt" class="sd-mono">{{ formatTimestamp(updatedAt) }}</dd>
          </dl>
        </section>
      </div>
    </aside>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import type {
  EvalJob,
  Provider,
  Scorer,
  ScoreConfig,
} from "@/services/online-evals.service";
import {
  dataTypeOf,
  entityId,
} from "../utils/evalEntity";

const props = defineProps<{
  row: Scorer;
  /** Providers in the org (to resolve `params.providerId` → name). */
  providers: Provider[];
  /** Score configs in the org (to resolve `producesScoreConfigId` → name). */
  scoreConfigs: ScoreConfig[];
  /** Jobs in the org (to compute "used by"). */
  jobs: EvalJob[];
}>();

defineEmits<{
  (e: "close"): void;
}>();

const { t } = useI18n();

function valueOf<T = any>(row: any, camel: string, snake: string): T | undefined {
  if (row == null) return undefined;
  return row[camel] ?? row[snake];
}

const scorerType = computed(
  () => valueOf<string>(props.row, "scorerType", "scorer_type") ?? "llm_judge",
);

const scorerTypeLabel = computed(() =>
  scorerType.value === "remote"
    ? t("onlineEvals.scorer.detail.typeRemote")
    : t("onlineEvals.scorer.detail.typeLlmJudge"),
);

const params = computed<Record<string, any>>(() => props.row.params ?? {});

const provider = computed<Provider | null>(() => {
  const providerId = params.value.provider_id ?? params.value.providerId;
  if (!providerId) return null;
  return props.providers.find((p) => p.id === providerId) ?? null;
});

const judgeModel = computed<string>(
  () => params.value.model ?? params.value.judge_model ?? "",
);

const remoteEndpoint = computed<string>(
  () => params.value.endpoint ?? params.value.url ?? "",
);

const producesId = computed(
  () =>
    valueOf<string>(props.row, "producesScoreConfigId", "produces_score_config_id") ??
    null,
);

const producesConfig = computed<ScoreConfig | null>(() => {
  if (!producesId.value) return null;
  return (
    props.scoreConfigs.find((c) => entityId(c) === producesId.value) ?? null
  );
});

const variables = computed<string[]>(() => props.row.variables ?? []);

const outputSchemaPretty = computed<string>(() => {
  const schema = valueOf<any>(props.row, "outputSchema", "output_schema");
  if (!schema) return "";
  try {
    return JSON.stringify(schema, null, 2);
  } catch {
    return "";
  }
});

const usedByJobs = computed<EvalJob[]>(() => {
  const myId = entityId(props.row);
  return props.jobs.filter((job) => {
    if (!Array.isArray(job.scorers)) return false;
    return job.scorers.some((ref) => {
      if (typeof ref === "string") return ref === myId;
      return ref?.id === myId;
    });
  });
});

const createdAt = computed<number | null>(() => {
  const v = valueOf<number>(props.row, "createdAt", "created_at");
  return typeof v === "number" ? v : null;
});

const updatedAt = computed<number | null>(() => {
  const v = valueOf<number>(props.row, "updatedAt", "updated_at");
  return typeof v === "number" ? v : null;
});

function formatTimestamp(microsOrMs: number): string {
  const ms = microsOrMs > 1e14 ? Math.round(microsOrMs / 1000) : microsOrMs;
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return String(microsOrMs);
  }
}
</script>

<style lang="scss" scoped>
.sd-scrim {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.32);
  z-index: 1010;
  display: flex;
  justify-content: flex-end;
  animation: sd-fade 0.18s ease-out;
}

@keyframes sd-fade {
  from { background: rgba(0, 0, 0, 0); }
  to   { background: rgba(0, 0, 0, 0.32); }
}

.sd {
  width: 580px;
  max-width: 92vw;
  height: 100%;
  background: var(--color-card-bg);
  border-left: 1px solid var(--color-dialog-header-border, var(--o2-border));
  display: flex;
  flex-direction: column;
  animation: sd-slide 0.22s ease-out;
}

@keyframes sd-slide {
  from { transform: translateX(100%); }
  to   { transform: translateX(0); }
}

.sd__header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--color-dialog-header-border, var(--o2-border));
  background: var(--color-card-bg);
  flex-shrink: 0;
}

.sd__title {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  color: var(--color-text-primary, currentColor);
}

.sd__title-text {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-weight: 700;
  font-size: 14px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sd__title-version {
  font-size: 11px;
  color: var(--color-text-secondary, var(--o2-text-secondary));
  font-variant-numeric: tabular-nums;
}

.sd__type-pill {
  display: inline-flex;
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  background: color-mix(in srgb, #6b76e3 14%, transparent);
  color: #4f5bcf;
}

.sd__type-pill--remote {
  background: color-mix(in srgb, #b25400 14%, transparent);
  color: #b25400;
}

.sd__header-spacer { flex: 1; }

.sd__close {
  background: transparent;
  border: 0;
  padding: 4px;
  border-radius: 4px;
  cursor: pointer;
  color: var(--color-text-secondary, var(--o2-text-secondary));
}

.sd__close:hover {
  background: color-mix(in srgb, var(--color-text-primary) 8%, transparent);
  color: var(--color-text-primary, currentColor);
}

.sd__body {
  flex: 1;
  overflow: auto;
  padding: 18px 20px;
  display: flex;
  flex-direction: column;
  gap: 18px;
  min-height: 0;
  background: var(--color-card-bg);
}

.sd-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.sd-section__title {
  margin: 0;
  font: 600 13px/1.5 var(--o2-font);
  color: var(--color-text-primary, currentColor);
  padding-bottom: 6px;
  border-bottom: 1px solid color-mix(in srgb, var(--color-text-secondary) 12%, transparent);
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.sd-section__chip {
  display: inline-flex;
  align-items: center;
  padding: 0 5px;
  border-radius: 3px;
  font: 600 10px var(--o2-font);
  text-transform: none;
  letter-spacing: 0;
  background: color-mix(in srgb, var(--color-text-secondary) 12%, transparent);
  color: var(--color-text-secondary, var(--o2-text-secondary));
}

.sd-section__text {
  margin: 0;
  font-size: 13px;
  line-height: 1.55;
  color: var(--color-text-primary, currentColor);
}

.sd-kv {
  display: grid;
  grid-template-columns: 120px 1fr;
  gap: 6px 14px;
  margin: 0;
}

.sd-kv dt {
  font-size: 11px;
  color: var(--color-text-secondary, var(--o2-text-secondary));
}

.sd-kv dd {
  margin: 0;
  font-size: 13px;
  color: var(--color-text-primary, currentColor);
}

.sd-mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-variant-numeric: tabular-nums;
}

.sd-muted {
  color: var(--color-text-secondary, var(--o2-text-secondary));
  font-style: italic;
}

.sd-type-chip {
  display: inline-flex;
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 11px;
  font-weight: 600;
  background: color-mix(in srgb, #6b76e3 14%, transparent);
  color: #4f5bcf;
}

.sd-type-chip--remote {
  background: color-mix(in srgb, #b25400 14%, transparent);
  color: #b25400;
}

.sd-produces {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 12px;
  background: color-mix(in srgb, var(--color-primary-600, #3F7994) 8%, transparent);
  border: 1px solid color-mix(in srgb, var(--color-primary-600, #3F7994) 30%, transparent);
  border-radius: 5px;
  font-size: 12px;
  color: var(--color-text-primary, currentColor);
}

.sd-produces__name { font-weight: 700; }

.sd-produces__version,
.sd-produces__sep,
.sd-produces__type {
  color: var(--color-text-secondary, var(--o2-text-secondary));
  font-size: 11px;
}

.sd-empty {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  background: color-mix(in srgb, var(--color-text-secondary) 6%, transparent);
  border-radius: 5px;
  font-size: 12px;
  color: var(--color-text-secondary, var(--o2-text-secondary));
}

.sd-code {
  margin: 0;
  padding: 12px;
  background: color-mix(in srgb, var(--color-text-primary) 5%, transparent);
  border: 1px solid color-mix(in srgb, var(--color-text-secondary) 14%, transparent);
  border-radius: 6px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  line-height: 1.55;
  color: var(--color-text-primary, currentColor);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 280px;
  overflow: auto;
}

.sd-code--mono { white-space: pre; }

.sd-used-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.sd-used-list__item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  background: color-mix(in srgb, var(--color-text-secondary) 5%, transparent);
  border-radius: 5px;
  font-size: 12px;
}

.sd-used-list__meta {
  margin-left: auto;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--color-text-secondary, var(--o2-text-secondary));
}
</style>
