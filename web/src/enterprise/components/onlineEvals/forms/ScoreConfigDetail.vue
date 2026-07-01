<template>
  <div class="scd-scrim" role="dialog" aria-modal="true" @click.self="$emit('close')">
    <aside class="scd" @click.stop data-test="score-config-detail">
      <!-- Header: eyebrow + title + status meta + close -->
      <header class="scd__header">
        <div class="scd__header-text">
          <div class="tw:flex tw:items-center tw:gap-2 tw:flex-nowrap">
            <span class="scd__eyebrow">{{ t("onlineEvals.scoreConfig.detail.eyebrow") }}</span>
            <span
              v-if="row.name"
              :class="[
                'tw:font-semibold tw:px-2 tw:py-1 tw:rounded-md tw:inline-block',
                store.state.theme === 'dark'
                  ? 'tw:text-blue-400 tw:bg-blue-900/50'
                  : 'tw:text-blue-600 tw:bg-blue-50',
              ]"
            >
              {{ row.name }}
              <OTooltip
                v-if="row.name && row.name.length > 35"
                :content="row.name"
                side="top"
              />
            </span>
          </div>
        </div>
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

      <!-- Tab strip -->
      <OTabs
        :model-value="activeTab"
        bordered
        class="tw:flex-shrink-0 tw:px-5"
        data-test="score-config-detail-tabs"
        @update:model-value="activeTab = $event as TabId"
      >
        <!-- Slot mode (no `label` prop) so each tab can carry a count badge
             alongside its label. -->
        <OTab
          v-for="tab in tabs"
          :key="tab.id"
          :name="tab.id"
          :data-test="`score-config-detail-tab-${tab.id}`"
        >
          <span>{{ tab.label }}</span>
          <span
            v-if="tab.count != null"
            class="tw:inline-flex tw:items-center tw:justify-center tw:px-[0.375rem] tw:min-w-[1.125rem] tw:h-[1rem] tw:rounded-full tw:text-[0.625rem] tw:font-semibold"
            :class="
              activeTab === tab.id
                ? 'tw:bg-[color-mix(in_srgb,var(--color-primary-600,#3f7994)_18%,transparent)] tw:text-[var(--color-primary-600,#3f7994)]'
                : 'tw:bg-[color-mix(in_srgb,var(--color-text-secondary)_14%,transparent)] tw:text-[var(--color-text-secondary)]'
            "
            >{{ tab.count }}</span
          >
        </OTab>
      </OTabs>

      <div class="scd__body">
        <!-- ─────────── OVERVIEW TAB ─────────── -->
        <template v-if="activeTab === 'overview'">
          <section v-if="row.description" class="scd-section">
            <h4 class="scd-section__title">{{ t("onlineEvals.scoreConfig.detail.descriptionSection") }}</h4>
            <p class="scd-section__text">{{ row.description }}</p>
          </section>

          <section class="scd-section">
            <h4 class="scd-section__title">{{ t("onlineEvals.scoreConfig.detail.configurationSection") }}</h4>
            <dl class="scd-kv">
              <dt>{{ t("onlineEvals.scoreConfig.detail.dataTypeLabel") }}</dt>
              <dd>
                <span class="scd-type-chip" :class="`scd-type-chip--${dataType}`">{{ dataType }}</span>
              </dd>

              <template v-if="dataType === 'numeric' && numericRange">
                <dt>{{ t("onlineEvals.scoreConfig.detail.rangeLabel") }}</dt>
                <dd>{{ numericRange.min }} – {{ numericRange.max }}</dd>
              </template>

              <template v-if="dataType === 'categorical' && categories.length">
                <dt>{{ t("onlineEvals.scoreConfig.detail.categoriesLabel") }}</dt>
                <dd>
                  <span v-for="cat in categories" :key="cat" class="scd-tag">{{ cat }}</span>
                </dd>
              </template>

              <template v-if="dataType === 'boolean'">
                <dt>{{ t("onlineEvals.scoreConfig.detail.valuesLabel") }}</dt>
                <dd>true / false</dd>
              </template>
            </dl>
          </section>

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

          <section class="scd-section">
            <h4 class="scd-section__title">{{ t("onlineEvals.scoreConfig.detail.metadataSection") }}</h4>
            <dl class="scd-kv">
              <dt>{{ t("onlineEvals.scoreConfig.detail.statusLabel") }}</dt>
              <dd>
                <span class="scd__status" :class="{ 'scd__status--inactive': !isActive }">
                  <span class="scd__status-dot" />
                  {{ isActive
                    ? t("onlineEvals.scoreConfig.detail.statusActive")
                    : t("onlineEvals.scoreConfig.detail.statusInactive") }}
                </span>
              </dd>
              <dt>{{ t("onlineEvals.scoreConfig.detail.versionLabel") }}</dt>
              <dd>v{{ row.version }}</dd>
              <dt v-if="createdAt">{{ t("onlineEvals.scoreConfig.detail.createdLabel") }}</dt>
              <dd v-if="createdAt">{{ formatTimestamp(createdAt) }}</dd>
              <dt v-if="updatedAt">{{ t("onlineEvals.scoreConfig.detail.updatedLabel") }}</dt>
              <dd v-if="updatedAt">{{ formatTimestamp(updatedAt) }}</dd>
            </dl>
          </section>
        </template>

        <!-- ─────────── VERSIONS TAB ─────────── -->
        <template v-else-if="activeTab === 'versions'">
          <p class="scd__tab-intro">{{ t("onlineEvals.scoreConfig.detail.versionsIntro") }}</p>
          <ul class="scd-versions">
            <li class="scd-versions__item scd-versions__item--active">
              <div class="scd-versions__head">
                <span class="scd-versions__label">v{{ row.version }}</span>
                <span class="scd-versions__chip">{{ t("onlineEvals.scoreConfig.detail.activeVersionChip") }}</span>
              </div>
              <div v-if="updatedAt" class="scd-versions__meta">
                {{ t("onlineEvals.scoreConfig.detail.lastUpdated") }}
                <span>{{ formatTimestamp(updatedAt) }}</span>
              </div>
            </li>
          </ul>
        </template>

        <!-- ─────────── USED BY TAB ─────────── -->
        <template v-else-if="activeTab === 'usedBy'">
          <p class="scd__tab-intro">{{ t("onlineEvals.scoreConfig.detail.usedByIntro") }}</p>
          <div v-if="usedByScorers.length === 0" class="scd-empty">
            <OIcon name="info" size="xs" />
            <span>{{ t("onlineEvals.scoreConfig.detail.usedByEmpty") }}</span>
          </div>
          <ul v-else class="scd-used-list">
            <li v-for="scorer in usedByScorers" :key="scorer.id">
              <OButton
                variant="ghost"
                class="scd-used-card"
                :data-test="`score-config-detail-used-by-item-${scorer.name}`"
                @click="emit('view-scorer', scorer)"
              >
                <div class="scd-used-card__main">
                  <div class="scd-used-card__row">
                    <span class="scd-used-card__name">{{ scorer.name }}</span>
                    <span class="scd-used-card__type" :class="`scd-used-card__type--${scorerTypeOf(scorer)}`">
                      {{ scorerTypeLabel(scorerTypeOf(scorer)) }}
                    </span>
                    <span class="scd-used-card__version">v{{ scorer.version }}</span>
                  </div>
                </div>
                <OIcon name="chevron-right" size="sm" class="scd-used-card__chevron" />
              </OButton>
            </li>
          </ul>
        </template>
      </div>
    </aside>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import type { ScoreConfig, Scorer } from "@/services/online-evals.service";
import {
  dataTypeOf,
  entityId,
} from "../utils/evalEntity";

const store = useStore();

const props = defineProps<{
  row: ScoreConfig;
  /** All scorers in the org — used to compute the "used by" list. */
  scorers: Scorer[];
}>();

const emit = defineEmits<{
  (e: "close"): void;
  (e: "view-scorer", row: Scorer): void;
}>();

const { t } = useI18n();
type TabId = "overview" | "versions" | "usedBy";
const activeTab = ref<TabId>("overview");

function valueOf<T = any>(row: any, camel: string, snake: string): T | undefined {
  if (row == null) return undefined;
  return row[camel] ?? row[snake];
}

const dataType = computed(() => dataTypeOf(props.row));

const isActive = computed<boolean>(() => {
  const v = valueOf<boolean>(props.row, "isActive", "is_active");
  // Default to true when the field is missing — most configs in the wild
  // are returned without the flag and represent the current row.
  return v !== false;
});

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

// Versions: history endpoint isn't wired yet — assume only the current
// version exists. The count slot in the tab strip falls back to 1.
const versionsCount = computed<number>(() => 1);

const tabs = computed(() => [
  {
    id: "overview" as TabId,
    label: t("onlineEvals.scoreConfig.detail.tabs.overview"),
    count: null as number | null,
  },
  {
    id: "versions" as TabId,
    label: t("onlineEvals.scoreConfig.detail.tabs.versions"),
    count: versionsCount.value,
  },
  {
    id: "usedBy" as TabId,
    label: t("onlineEvals.scoreConfig.detail.tabs.usedBy"),
    count: usedByScorers.value.length,
  },
]);

function scorerTypeOf(s: Scorer): "llm_judge" | "remote" {
  const raw = valueOf<string>(s, "scorerType", "scorer_type") ?? "llm_judge";
  return raw === "remote" ? "remote" : "llm_judge";
}

function scorerTypeLabel(type: "llm_judge" | "remote"): string {
  return type === "remote"
    ? t("onlineEvals.scoreConfig.detail.scorerTypeRemote")
    : t("onlineEvals.scoreConfig.detail.scorerTypeLlmJudge");
}

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
  width: 35rem;
  max-width: 92vw;
  height: 100%;
  background: var(--color-card-bg);
  border-left: 0.0625rem solid var(--color-dialog-header-border, var(--o2-border));
  display: flex;
  flex-direction: column;
  animation: scd-slide 0.22s ease-out;
}

@keyframes scd-slide {
  from { transform: translateX(100%); }
  to   { transform: translateX(0); }
}

/* — Header — */
.scd__header {
  display: flex;
  align-items: flex-start;
  gap: 0.625rem;
  padding: 1rem 1.25rem 0.875rem;
  border-bottom: 0.0625rem solid var(--color-dialog-header-border, var(--o2-border));
  background: var(--color-card-bg);
  flex-shrink: 0;
}

.scd__header-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.scd__eyebrow {
  font-size: 0.6875rem;
  font-weight: 600;
  line-height: 1.4;
  letter-spacing: 0.02em;
  color: var(--color-text-secondary, var(--o2-text-secondary));
}

.scd__status {
  display: inline-flex;
  align-items: center;
  gap: 0.3125rem;
  color: var(--o2-status-success-text, #2e7d32);
  font-weight: 600;
}

.scd__status--inactive {
  color: var(--color-text-secondary, var(--o2-text-secondary));
}

.scd__status-dot {
  width: 0.375rem;
  height: 0.375rem;
  border-radius: 50%;
  background: currentColor;
}

.scd__close {
  flex-shrink: 0;
  background: transparent;
  border: 0;
  padding: 0.25rem;
  border-radius: 0.25rem;
  cursor: pointer;
  color: var(--color-text-secondary, var(--o2-text-secondary));
}

.scd__close:hover {
  background: color-mix(in srgb, var(--color-text-primary) 8%, transparent);
  color: var(--color-text-primary, currentColor);
}

/* — Body — */
.scd__body {
  flex: 1;
  overflow: auto;
  padding: 1.125rem 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 1.125rem;
  min-height: 0;
  background: var(--color-card-bg);
}

.scd__tab-intro {
  margin: 0;
  font-size: 0.75rem;
  line-height: 1.5;
  color: var(--color-text-secondary, var(--o2-text-secondary));
}

/* — Sections (Overview tab) — */
.scd-section {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.scd-section__title {
  margin: 0;
  font-size: 0.8125rem;
  font-weight: 600;
  line-height: 1.5;
  color: var(--color-text-primary, currentColor);
  padding-bottom: 0.375rem;
  border-bottom: 0.0625rem solid color-mix(in srgb, var(--color-text-secondary) 12%, transparent);
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
}

.scd-section__chip {
  display: inline-flex;
  align-items: center;
  padding: 0 0.3125rem;
  border-radius: 0.1875rem;
  font-size: 0.625rem;
  font-weight: 600;
  background: color-mix(in srgb, var(--color-text-secondary) 12%, transparent);
  color: var(--color-text-secondary, var(--o2-text-secondary));
}

.scd-section__text {
  margin: 0;
  font-size: 0.8125rem;
  line-height: 1.55;
  color: var(--color-text-primary, currentColor);
}

.scd-section__text--muted { color: var(--color-text-secondary, var(--o2-text-secondary)); }

.scd-kv {
  display: grid;
  grid-template-columns: 7.5rem 1fr;
  gap: 0.375rem 0.875rem;
  margin: 0;
}

// Field labels follow the alert form convention (AddAlert.vue's
// `.alert-v3-inline-label`): 12px / 600 in the muted-secondary color.
.scd-kv dt {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--color-text-secondary, var(--o2-text-secondary));
}

.scd-kv dd {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--color-text-primary, currentColor);
}

.scd-type-chip {
  display: inline-flex;
  padding: 0.0625rem 0.375rem;
  border-radius: 0.1875rem;
  font-size: 0.6875rem;
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
  margin-right: 0.375rem;
  margin-bottom: 0.25rem;
  padding: 0.0625rem 0.5rem;
  border-radius: 62.4375rem;
  font-size: 0.6875rem;
  font-weight: 600;
  background: color-mix(in srgb, var(--color-text-secondary) 10%, transparent);
  color: var(--color-text-primary, currentColor);
}

.scd-threshold {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  padding: 0.75rem 0.875rem;
  border: 0.0625rem solid color-mix(in srgb, var(--o2-status-success-text, #2e7d32) 35%, transparent);
  background: color-mix(in srgb, var(--o2-status-success-text, #2e7d32) 8%, transparent);
  border-radius: 0.375rem;
}

.scd-threshold__sign {
  font-size: 1.125rem;
  font-weight: 700;
  color: var(--o2-status-success-text, #2e7d32);
}

.scd-threshold__value {
  font-weight: 700;
  font-size: 0.875rem;
  color: var(--color-text-primary, currentColor);
}

.scd-threshold__hint {
  margin-left: auto;
  font-size: 0.6875rem;
  color: var(--color-text-secondary, var(--o2-text-secondary));
}

.scd-empty {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.5rem 0.625rem;
  background: color-mix(in srgb, var(--color-text-secondary) 6%, transparent);
  border-radius: 0.3125rem;
  font-size: 0.75rem;
  color: var(--color-text-secondary, var(--o2-text-secondary));
}

/* — Versions tab — */
.scd-versions {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.scd-versions__item {
  padding: 0.75rem 0.875rem;
  background: var(--color-card-bg);
  border: 0.0625rem solid color-mix(in srgb, var(--color-text-secondary) 16%, transparent);
  border-radius: 0.375rem;
}

.scd-versions__item--active {
  border-color: color-mix(in srgb, var(--color-primary-600, #3F7994) 30%, transparent);
  background: color-mix(in srgb, var(--color-primary-600, #3F7994) 5%, var(--color-card-bg));
}

.scd-versions__head {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.scd-versions__label {
  font-weight: 700;
  font-size: 0.8125rem;
  color: var(--color-text-primary, currentColor);
}

.scd-versions__chip {
  display: inline-flex;
  padding: 0.0625rem 0.4375rem;
  border-radius: 0.1875rem;
  font-size: 0.625rem;
  font-weight: 600;
  background: color-mix(in srgb, var(--o2-status-success-text, #2e7d32) 14%, transparent);
  color: var(--o2-status-success-text, #2e7d32);
}

.scd-versions__meta {
  margin-top: 0.375rem;
  font-size: 0.71875rem;
  color: var(--color-text-secondary, var(--o2-text-secondary));
}

/* — Used by tab — */
.scd-used-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

/* OButton is sized for compact action buttons; the "Used by" cards need
 * natural multi-line height + card-like styling, so override its tailwind
 * height/padding via :deep() and apply our own surface. */
.scd-used-card {
  width: 100%;
  background: var(--color-card-bg) !important;
  border: 0.0625rem solid color-mix(in srgb, var(--color-text-secondary) 16%, transparent) !important;
  border-radius: 0.375rem !important;
  transition: border-color 0.15s, background 0.15s;
}

.scd-used-card:hover {
  border-color: color-mix(in srgb, var(--color-primary-600, #3F7994) 35%, transparent) !important;
  background: color-mix(in srgb, var(--color-primary-600, #3F7994) 4%, var(--color-card-bg)) !important;
}

.scd-used-card:deep(button) {
  height: auto !important;
  padding: 0.75rem 0.875rem !important;
  gap: 0.625rem;
  justify-content: flex-start;
  text-align: left;
}

.scd-used-card:hover {
  border-color: color-mix(in srgb, var(--color-primary-600, #3F7994) 35%, transparent);
  background: color-mix(in srgb, var(--color-primary-600, #3F7994) 4%, var(--color-card-bg));
}

.scd-used-card__main {
  flex: 1;
  min-width: 0;
}

.scd-used-card__row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.scd-used-card__name {
  font-weight: 700;
  font-size: 0.8125rem;
  color: var(--color-text-primary, currentColor);
}

.scd-used-card__type {
  display: inline-flex;
  padding: 0.0625rem 0.4375rem;
  border-radius: 0.1875rem;
  font-size: 0.625rem;
  font-weight: 600;
  background: color-mix(in srgb, #6b76e3 14%, transparent);
  color: #4f5bcf;
}

.scd-used-card__type--remote {
  background: color-mix(in srgb, #b25400 14%, transparent);
  color: #b25400;
}

.scd-used-card__version {
  font-size: 0.6875rem;
  color: var(--color-text-secondary, var(--o2-text-secondary));
}

.scd-used-card__chevron {
  flex-shrink: 0;
  color: var(--color-text-secondary, var(--o2-text-secondary));
  opacity: 0.5;
}

.scd-used-card:hover .scd-used-card__chevron {
  color: var(--color-primary-600, #3F7994);
  opacity: 1;
}
</style>
