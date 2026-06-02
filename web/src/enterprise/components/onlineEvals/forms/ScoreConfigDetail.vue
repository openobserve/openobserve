<template>
  <div class="scd-scrim" role="dialog" aria-modal="true" @click.self="$emit('close')">
    <aside class="scd" @click.stop data-test="score-config-detail">
      <header class="scd__header">
        <span class="scd__title">
          <OIcon name="rule" size="sm" />
          <span class="scd__title-text">{{ row.name }}</span>
          <span class="scd__title-version">v{{ row.version }}</span>
        </span>
        <span class="scd__type-pill" :class="`scd__type-pill--${dataType}`">
          {{ dataType }}
        </span>
        <div class="scd__header-spacer" />
        <button
          type="button"
          class="scd__close"
          :aria-label="t('onlineEvals.scoreConfig.detail.close')"
          data-test="score-config-detail-close-btn"
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

      <div class="scd__body">
        <!-- Description -->
        <section v-if="row.description" class="scd-section">
          <h4 class="scd-section__title">{{ t("onlineEvals.scoreConfig.detail.descriptionSection") }}</h4>
          <p class="scd-section__text">{{ row.description }}</p>
        </section>

        <!-- Configuration -->
        <section class="scd-section">
          <h4 class="scd-section__title">{{ t("onlineEvals.scoreConfig.detail.configurationSection") }}</h4>

          <dl class="scd-kv">
            <dt>{{ t("onlineEvals.scoreConfig.detail.dataTypeLabel") }}</dt>
            <dd>
              <span class="scd-type-chip" :class="`scd-type-chip--${dataType}`">{{ dataType }}</span>
            </dd>

            <template v-if="dataType === 'numeric' && numericRange">
              <dt>{{ t("onlineEvals.scoreConfig.detail.rangeLabel") }}</dt>
              <dd class="scd-mono">{{ numericRange.min }} – {{ numericRange.max }}</dd>
            </template>

            <template v-if="dataType === 'categorical' && categories.length">
              <dt>{{ t("onlineEvals.scoreConfig.detail.categoriesLabel") }}</dt>
              <dd>
                <span v-for="cat in categories" :key="cat" class="scd-tag">{{ cat }}</span>
              </dd>
            </template>

            <template v-if="dataType === 'boolean'">
              <dt>{{ t("onlineEvals.scoreConfig.detail.valuesLabel") }}</dt>
              <dd class="scd-mono">true / false</dd>
            </template>
          </dl>
        </section>

        <!-- Healthy Threshold -->
        <section class="scd-section">
          <h4 class="scd-section__title">
            {{ t("onlineEvals.scoreConfig.detail.thresholdSection") }}
            <span v-if="!healthyLabel" class="scd-section__chip">
              {{ t("onlineEvals.scoreConfig.detail.noThreshold") }}
            </span>
          </h4>
          <div v-if="healthyLabel" class="scd-threshold">
            <span class="scd-threshold__sign">{{ thresholdSign }}</span>
            <span class="scd-threshold__value">{{ healthyLabel }}</span>
            <span class="scd-threshold__hint">{{ t("onlineEvals.scoreConfig.detail.thresholdHint") }}</span>
          </div>
          <p v-else class="scd-section__text scd-section__text--muted">
            {{ t("onlineEvals.scoreConfig.detail.noThresholdHint") }}
          </p>
        </section>

        <!-- Used by -->
        <section class="scd-section">
          <h4 class="scd-section__title">
            {{ t("onlineEvals.scoreConfig.detail.usedBySection") }}
            <span class="scd-section__chip">{{ usedByScorers.length }}</span>
          </h4>
          <div v-if="usedByScorers.length === 0" class="scd-empty">
            <OIcon name="info" size="xs" />
            <span>{{ t("onlineEvals.scoreConfig.detail.usedByEmpty") }}</span>
          </div>
          <ul v-else class="scd-used-list">
            <li
              v-for="scorer in usedByScorers"
              :key="scorer.id"
              class="scd-used-list__item"
              data-test="score-config-detail-used-by-item"
            >
              <OIcon name="grading" size="xs" />
              <span class="scd-mono">{{ scorer.name }}</span>
              <span class="scd-used-list__meta">v{{ scorer.version }}</span>
            </li>
          </ul>
        </section>

        <!-- Metadata -->
        <section class="scd-section">
          <h4 class="scd-section__title">{{ t("onlineEvals.scoreConfig.detail.metadataSection") }}</h4>
          <dl class="scd-kv">
            <dt>{{ t("onlineEvals.scoreConfig.detail.versionLabel") }}</dt>
            <dd class="scd-mono">v{{ row.version }}</dd>
            <dt v-if="createdAt">{{ t("onlineEvals.scoreConfig.detail.createdLabel") }}</dt>
            <dd v-if="createdAt" class="scd-mono">{{ formatTimestamp(createdAt) }}</dd>
            <dt v-if="updatedAt">{{ t("onlineEvals.scoreConfig.detail.updatedLabel") }}</dt>
            <dd v-if="updatedAt" class="scd-mono">{{ formatTimestamp(updatedAt) }}</dd>
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
import type { ScoreConfig, Scorer } from "@/services/online-evals.service";
import {
  dataTypeOf,
  entityId,
} from "../utils/evalEntity";

const props = defineProps<{
  row: ScoreConfig;
  /** All scorers in the org — used to compute the "used by" list. */
  scorers: Scorer[];
}>();

defineEmits<{
  (e: "close"): void;
}>();

const { t } = useI18n();

function valueOf<T = any>(row: any, camel: string, snake: string): T | undefined {
  if (row == null) return undefined;
  return row[camel] ?? row[snake];
}

const dataType = computed(() => dataTypeOf(props.row));

const numericRange = computed(() => {
  const r = valueOf<any>(props.row, "numericRange", "numeric_range");
  if (!r || r.min == null || r.max == null) return null;
  return { min: r.min, max: r.max };
});

const categories = computed<string[]>(() => {
  const c = props.row.categories;
  return Array.isArray(c) ? c : [];
});

const healthyLabel = computed(() => {
  const ht = valueOf<any>(props.row, "healthyThreshold", "healthy_threshold");
  if (!ht) return "";
  const type = dataType.value;
  if (type === "numeric") {
    if (ht.value === undefined || !ht.direction) return "";
    return `${ht.value}`;
  }
  if (type === "categorical") {
    const list = ht.healthy_categories || ht.healthyCategories;
    if (!Array.isArray(list) || list.length === 0) return "";
    return list.join(", ");
  }
  const val = ht.healthy_value ?? ht.healthyValue;
  if (val === undefined || val === null) return "";
  return String(val);
});

const thresholdSign = computed(() => {
  const ht = valueOf<any>(props.row, "healthyThreshold", "healthy_threshold");
  if (!ht) return "";
  if (dataType.value === "numeric") {
    return ht.direction === "gte" ? "≥" : "≤";
  }
  if (dataType.value === "categorical") return "∈";
  return "=";
});

const usedByScorers = computed<Scorer[]>(() => {
  const myId = entityId(props.row);
  return props.scorers.filter((s) => {
    const ref = valueOf<string>(s, "producesScoreConfigId", "produces_score_config_id");
    return ref === myId;
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
  // Detect microseconds (16 digits) vs milliseconds (13 digits) by magnitude.
  const ms = microsOrMs > 1e14 ? Math.round(microsOrMs / 1000) : microsOrMs;
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return String(microsOrMs);
  }
}
</script>

<style lang="scss" scoped>
.scd-scrim {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.32);
  z-index: 1010;
  display: flex;
  justify-content: flex-end;
  animation: scd-fade 0.18s ease-out;
}

@keyframes scd-fade {
  from { background: rgba(0, 0, 0, 0); }
  to   { background: rgba(0, 0, 0, 0.32); }
}

.scd {
  width: 540px;
  max-width: 92vw;
  height: 100%;
  background: var(--color-card-bg);
  border-left: 1px solid var(--color-dialog-header-border, var(--o2-border));
  display: flex;
  flex-direction: column;
  animation: scd-slide 0.22s ease-out;
}

@keyframes scd-slide {
  from { transform: translateX(100%); }
  to   { transform: translateX(0); }
}

.scd__header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--color-dialog-header-border, var(--o2-border));
  background: var(--color-card-bg);
  flex-shrink: 0;
}

.scd__title {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  color: var(--color-text-primary, currentColor);
}

.scd__title-text {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-weight: 700;
  font-size: 14px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.scd__title-version {
  font-size: 11px;
  color: var(--color-text-secondary, var(--o2-text-secondary));
  font-variant-numeric: tabular-nums;
}

.scd__type-pill {
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

.scd__type-pill--categorical {
  background: color-mix(in srgb, #9333ea 14%, transparent);
  color: #7c3aed;
}

.scd__type-pill--boolean {
  background: color-mix(in srgb, #16a34a 14%, transparent);
  color: #15803d;
}

.scd__header-spacer { flex: 1; }

.scd__close {
  background: transparent;
  border: 0;
  padding: 4px;
  border-radius: 4px;
  cursor: pointer;
  color: var(--color-text-secondary, var(--o2-text-secondary));
}

.scd__close:hover {
  background: color-mix(in srgb, var(--color-text-primary) 8%, transparent);
  color: var(--color-text-primary, currentColor);
}

.scd__body {
  flex: 1;
  overflow: auto;
  padding: 18px 20px;
  display: flex;
  flex-direction: column;
  gap: 18px;
  min-height: 0;
  background: var(--color-card-bg);
}

.scd-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.scd-section__title {
  margin: 0;
  font: 600 13px/1.5 var(--o2-font);
  color: var(--color-text-primary, currentColor);
  padding-bottom: 6px;
  border-bottom: 1px solid color-mix(in srgb, var(--color-text-secondary) 12%, transparent);
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.scd-section__chip {
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

.scd-section__text {
  margin: 0;
  font-size: 13px;
  line-height: 1.55;
  color: var(--color-text-primary, currentColor);
}

.scd-section__text--muted { color: var(--color-text-secondary, var(--o2-text-secondary)); }

.scd-kv {
  display: grid;
  grid-template-columns: 120px 1fr;
  gap: 6px 14px;
  margin: 0;
}

.scd-kv dt {
  font-size: 11px;
  color: var(--color-text-secondary, var(--o2-text-secondary));
}

.scd-kv dd {
  margin: 0;
  font-size: 13px;
  color: var(--color-text-primary, currentColor);
}

.scd-mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-variant-numeric: tabular-nums;
}

.scd-type-chip {
  display: inline-flex;
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 11px;
  font-weight: 600;
  background: color-mix(in srgb, #6b76e3 14%, transparent);
  color: #4f5bcf;
}

.scd-type-chip--categorical {
  background: color-mix(in srgb, #9333ea 14%, transparent);
  color: #7c3aed;
}

.scd-type-chip--boolean {
  background: color-mix(in srgb, #16a34a 14%, transparent);
  color: #15803d;
}

.scd-tag {
  display: inline-flex;
  margin-right: 6px;
  margin-bottom: 4px;
  padding: 1px 8px;
  border-radius: 999px;
  font: 600 11px var(--o2-font);
  background: color-mix(in srgb, var(--color-text-secondary) 10%, transparent);
  color: var(--color-text-primary, currentColor);
}

.scd-threshold {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 12px 14px;
  border: 1px solid color-mix(in srgb, var(--o2-status-success-text, #2e7d32) 35%, transparent);
  background: color-mix(in srgb, var(--o2-status-success-text, #2e7d32) 8%, transparent);
  border-radius: 6px;
}

.scd-threshold__sign {
  font-size: 18px;
  font-weight: 700;
  color: var(--o2-status-success-text, #2e7d32);
}

.scd-threshold__value {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-weight: 700;
  font-size: 14px;
  color: var(--color-text-primary, currentColor);
}

.scd-threshold__hint {
  margin-left: auto;
  font-size: 11px;
  color: var(--color-text-secondary, var(--o2-text-secondary));
}

.scd-empty {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  background: color-mix(in srgb, var(--color-text-secondary) 6%, transparent);
  border-radius: 5px;
  font-size: 12px;
  color: var(--color-text-secondary, var(--o2-text-secondary));
}

.scd-used-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.scd-used-list__item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  background: color-mix(in srgb, var(--color-text-secondary) 5%, transparent);
  border-radius: 5px;
  font-size: 12px;
}

.scd-used-list__meta {
  margin-left: auto;
  font-size: 11px;
  color: var(--color-text-secondary, var(--o2-text-secondary));
}

</style>
