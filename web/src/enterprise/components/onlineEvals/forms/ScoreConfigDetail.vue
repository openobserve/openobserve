<template>
  <div
    class="scd-scrim tw:fixed tw:inset-0 tw:bg-[rgba(0,0,0,0.32)] tw:z-[1010] tw:flex tw:justify-end tw:[animation:scd-fade_0.18s_ease-out]"
    role="dialog"
    aria-modal="true"
    @click.self="$emit('close')"
  >
    <aside
      class="scd tw:w-[560px] tw:max-w-[92vw] tw:h-full tw:bg-(--color-card-bg) tw:border-l tw:border-(--color-dialog-header-border) tw:flex tw:flex-col tw:[animation:scd-slide_0.22s_ease-out]"
      @click.stop
      data-test="score-config-detail"
    >
      <!-- Header: eyebrow + title + status meta + close -->
      <header class="tw:flex tw:items-start tw:gap-2.5 tw:px-5 tw:pt-4 tw:pb-3.5 tw:border-b tw:border-dialog-header-border tw:bg-card-bg tw:shrink-0">
        <div class="tw:flex-1 tw:min-w-0 tw:flex tw:flex-col tw:gap-1">
          <div class="tw:flex tw:items-center tw:gap-2 tw:flex-nowrap">
            <span class="tw:font-semibold tw:text-[11px] tw:leading-[1.4] tw:tracking-[0.02em] tw:text-text-secondary">{{ t("onlineEvals.scoreConfig.detail.eyebrow") }}</span>
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
          class="scd__close tw:shrink-0 tw:bg-transparent tw:border-0 tw:p-1 tw:rounded tw:cursor-pointer tw:text-(--color-text-secondary)"
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
            class="tw:inline-flex tw:items-center tw:justify-center tw:px-1.5 tw:min-w-[1.125rem] tw:h-4 tw:rounded-full tw:text-[10px] tw:font-semibold tw:leading-none"
            :class="
              activeTab === tab.id
                ? 'tw:bg-[color-mix(in_srgb,var(--color-primary-600,#3f7994)_18%,transparent)] tw:text-[var(--color-primary-600,#3f7994)]'
                : 'tw:bg-[color-mix(in_srgb,var(--color-text-secondary)_14%,transparent)] tw:text-[var(--color-text-secondary)]'
            "
            >{{ tab.count }}</span
          >
        </OTab>
      </OTabs>

      <div class="tw:flex-1 tw:overflow-auto tw:px-5 tw:py-4.5 tw:flex tw:flex-col tw:gap-4.5 tw:min-h-0 tw:bg-card-bg">
        <!-- ─────────── OVERVIEW TAB ─────────── -->
        <template v-if="activeTab === 'overview'">
          <section v-if="row.description" class="tw:flex tw:flex-col tw:gap-2">
            <h4 class="scd-section__title tw:m-0 tw:font-semibold tw:text-[13px] tw:leading-normal tw:text-(--color-text-primary) tw:pb-1.5 tw:border-b tw:border-[color-mix(in_srgb,var(--color-text-secondary)_12%,transparent)] tw:inline-flex tw:items-center tw:gap-1.5">{{ t("onlineEvals.scoreConfig.detail.descriptionSection") }}</h4>
            <p class="tw:m-0 tw:text-[13px] tw:leading-[1.55] tw:text-(--color-text-primary)">{{ row.description }}</p>
          </section>

          <section class="tw:flex tw:flex-col tw:gap-2">
            <h4 class="scd-section__title tw:m-0 tw:font-semibold tw:text-[13px] tw:leading-normal tw:text-(--color-text-primary) tw:pb-1.5 tw:border-b tw:border-[color-mix(in_srgb,var(--color-text-secondary)_12%,transparent)] tw:inline-flex tw:items-center tw:gap-1.5">{{ t("onlineEvals.scoreConfig.detail.configurationSection") }}</h4>
            <dl class="scd-kv tw:grid tw:gap-x-3.5 tw:gap-y-1.5 tw:m-0" style="grid-template-columns: 120px 1fr;">
              <dt>{{ t("onlineEvals.scoreConfig.detail.dataTypeLabel") }}</dt>
              <dd>
                <span
                  class="tw:inline-flex tw:py-px tw:px-1.5 tw:rounded tw:text-[11px] tw:font-semibold tw:bg-[color-mix(in_srgb,#6b76e3_14%,transparent)] tw:text-[#4f5bcf]"
                  :class="{
                    'tw:bg-[color-mix(in_srgb,#9333ea_14%,transparent)]! tw:text-[#7c3aed]!': dataType === 'categorical',
                    'tw:bg-[color-mix(in_srgb,#16a34a_14%,transparent)]! tw:text-[#15803d]!': dataType === 'boolean',
                  }"
                >{{ dataType }}</span>
              </dd>

              <template v-if="dataType === 'numeric' && numericRange">
                <dt>{{ t("onlineEvals.scoreConfig.detail.rangeLabel") }}</dt>
                <dd class="tw:font-[ui-monospace,SFMono-Regular,Menlo,monospace] tw:[font-variant-numeric:tabular-nums]">{{ numericRange.min }} – {{ numericRange.max }}</dd>
              </template>

              <template v-if="dataType === 'categorical' && categories.length">
                <dt>{{ t("onlineEvals.scoreConfig.detail.categoriesLabel") }}</dt>
                <dd>
                  <span
                    v-for="cat in categories"
                    :key="cat"
                    class="tw:inline-flex tw:mr-1.5 tw:mb-1 tw:py-px tw:px-2 tw:rounded-full tw:font-semibold tw:text-[11px] tw:bg-[color-mix(in_srgb,var(--color-text-secondary)_10%,transparent)] tw:text-(--color-text-primary)"
                  >{{ cat }}</span>
                </dd>
              </template>

              <template v-if="dataType === 'boolean'">
                <dt>{{ t("onlineEvals.scoreConfig.detail.valuesLabel") }}</dt>
                <dd class="tw:font-[ui-monospace,SFMono-Regular,Menlo,monospace] tw:[font-variant-numeric:tabular-nums]">true / false</dd>
              </template>
            </dl>
          </section>

          <section class="tw:flex tw:flex-col tw:gap-2">
            <h4 class="scd-section__title tw:m-0 tw:font-semibold tw:text-[13px] tw:leading-normal tw:text-(--color-text-primary) tw:pb-1.5 tw:border-b tw:border-[color-mix(in_srgb,var(--color-text-secondary)_12%,transparent)] tw:inline-flex tw:items-center tw:gap-1.5">
              {{ t("onlineEvals.scoreConfig.detail.thresholdSection") }}
              <span
                v-if="!healthyLabel"
                class="tw:inline-flex tw:items-center tw:px-[5px] tw:py-0 tw:rounded tw:font-semibold tw:text-[10px] tw:bg-[color-mix(in_srgb,var(--color-text-secondary)_12%,transparent)] tw:text-(--color-text-secondary)"
              >
                {{ t("onlineEvals.scoreConfig.detail.noThreshold") }}
              </span>
            </h4>
            <div
              v-if="healthyLabel"
              class="tw:flex tw:items-baseline tw:gap-2 tw:p-[12px_14px] tw:border tw:border-[color-mix(in_srgb,var(--o2-status-success-text,#2e7d32)_35%,transparent)] tw:bg-[color-mix(in_srgb,var(--o2-status-success-text,#2e7d32)_8%,transparent)] tw:rounded-md"
            >
              <span class="tw:text-lg tw:font-bold tw:text-(--o2-status-success-text)">{{ thresholdSign }}</span>
              <span class="tw:font-[ui-monospace,SFMono-Regular,Menlo,monospace] tw:font-bold tw:text-sm tw:text-(--color-text-primary)">{{ healthyLabel }}</span>
              <span class="tw:ml-auto tw:text-[11px] tw:text-(--color-text-secondary)">{{ t("onlineEvals.scoreConfig.detail.thresholdHint") }}</span>
            </div>
            <p v-else class="tw:m-0 tw:text-[13px] tw:leading-[1.55] tw:text-(--color-text-secondary)">
              {{ t("onlineEvals.scoreConfig.detail.noThresholdHint") }}
            </p>
          </section>

          <section class="tw:flex tw:flex-col tw:gap-2">
            <h4 class="scd-section__title tw:m-0 tw:font-semibold tw:text-[13px] tw:leading-normal tw:text-(--color-text-primary) tw:pb-1.5 tw:border-b tw:border-[color-mix(in_srgb,var(--color-text-secondary)_12%,transparent)] tw:inline-flex tw:items-center tw:gap-1.5">{{ t("onlineEvals.scoreConfig.detail.metadataSection") }}</h4>
            <dl class="scd-kv tw:grid tw:gap-x-3.5 tw:gap-y-1.5 tw:m-0" style="grid-template-columns: 120px 1fr;">
              <dt>{{ t("onlineEvals.scoreConfig.detail.statusLabel") }}</dt>
              <dd>
                <span
                  class="tw:inline-flex tw:items-center tw:gap-[5px] tw:text-(--o2-status-success-text) tw:font-semibold"
                  :class="{ 'tw:text-(--color-text-secondary)!': !isActive }"
                >
                  <span class="tw:w-1.5 tw:h-1.5 tw:rounded-full tw:bg-current" />
                  {{ isActive
                    ? t("onlineEvals.scoreConfig.detail.statusActive")
                    : t("onlineEvals.scoreConfig.detail.statusInactive") }}
                </span>
              </dd>
              <dt>{{ t("onlineEvals.scoreConfig.detail.versionLabel") }}</dt>
              <dd class="tw:font-[ui-monospace,SFMono-Regular,Menlo,monospace] tw:[font-variant-numeric:tabular-nums]">v{{ row.version }}</dd>
              <dt v-if="createdAt">{{ t("onlineEvals.scoreConfig.detail.createdLabel") }}</dt>
              <dd v-if="createdAt" class="tw:font-[ui-monospace,SFMono-Regular,Menlo,monospace] tw:[font-variant-numeric:tabular-nums]">{{ formatTimestamp(createdAt) }}</dd>
              <dt v-if="updatedAt">{{ t("onlineEvals.scoreConfig.detail.updatedLabel") }}</dt>
              <dd v-if="updatedAt" class="tw:font-[ui-monospace,SFMono-Regular,Menlo,monospace] tw:[font-variant-numeric:tabular-nums]">{{ formatTimestamp(updatedAt) }}</dd>
            </dl>
          </section>
        </template>

        <!-- ─────────── VERSIONS TAB ─────────── -->
        <template v-else-if="activeTab === 'versions'">
          <p class="tw:m-0 tw:text-xs tw:leading-normal tw:text-(--color-text-secondary)">{{ t("onlineEvals.scoreConfig.detail.versionsIntro") }}</p>
          <ul class="tw:list-none tw:m-0 tw:p-0 tw:flex tw:flex-col tw:gap-2">
            <li
              class="tw:p-[12px_14px] tw:bg-(--color-card-bg) tw:border tw:border-[color-mix(in_srgb,var(--color-primary-600,#3F7994)_30%,transparent)] tw:bg-[color-mix(in_srgb,var(--color-primary-600,#3F7994)_5%,var(--color-card-bg))]! tw:rounded-md"
            >
              <div class="tw:flex tw:items-center tw:gap-2">
                <span class="tw:font-[ui-monospace,SFMono-Regular,Menlo,monospace] tw:[font-variant-numeric:tabular-nums] tw:font-bold tw:text-[13px] tw:text-(--color-text-primary)">v{{ row.version }}</span>
                <span class="tw:inline-flex tw:py-px tw:px-[7px] tw:rounded tw:font-semibold tw:text-[10px] tw:leading-none tw:bg-[color-mix(in_srgb,var(--o2-status-success-text,#2e7d32)_14%,transparent)] tw:text-(--o2-status-success-text)">{{ t("onlineEvals.scoreConfig.detail.activeVersionChip") }}</span>
              </div>
              <div v-if="updatedAt" class="tw:mt-1.5 tw:text-[11.5px] tw:text-(--color-text-secondary)">
                {{ t("onlineEvals.scoreConfig.detail.lastUpdated") }}
                <span class="tw:font-[ui-monospace,SFMono-Regular,Menlo,monospace] tw:[font-variant-numeric:tabular-nums]">{{ formatTimestamp(updatedAt) }}</span>
              </div>
            </li>
          </ul>
        </template>

        <!-- ─────────── USED BY TAB ─────────── -->
        <template v-else-if="activeTab === 'usedBy'">
          <p class="tw:m-0 tw:text-xs tw:leading-normal tw:text-(--color-text-secondary)">{{ t("onlineEvals.scoreConfig.detail.usedByIntro") }}</p>
          <div
            v-if="usedByScorers.length === 0"
            class="tw:inline-flex tw:items-center tw:gap-1.5 tw:p-[8px_10px] tw:bg-[color-mix(in_srgb,var(--color-text-secondary)_6%,transparent)] tw:rounded-[5px] tw:text-xs tw:text-(--color-text-secondary)"
          >
            <OIcon name="info" size="xs" />
            <span>{{ t("onlineEvals.scoreConfig.detail.usedByEmpty") }}</span>
          </div>
          <ul v-else class="tw:list-none tw:m-0 tw:p-0 tw:flex tw:flex-col tw:gap-2">
            <li v-for="scorer in usedByScorers" :key="scorer.id">
              <OButton
                variant="ghost"
                class="scd-used-card tw:w-full tw:bg-(--color-card-bg)! tw:border! tw:border-[color-mix(in_srgb,var(--color-text-secondary)_16%,transparent)]! tw:rounded-md! tw:transition-[border-color,background] tw:duration-150"
                :data-test="`score-config-detail-used-by-item-${scorer.name}`"
                @click="emit('view-scorer', scorer)"
              >
                <div class="tw:flex-1 tw:min-w-0">
                  <div class="tw:flex tw:items-center tw:gap-2">
                    <span class="tw:font-[ui-monospace,SFMono-Regular,Menlo,monospace] tw:[font-variant-numeric:tabular-nums] tw:font-bold tw:text-[13px] tw:text-(--color-text-primary)">{{ scorer.name }}</span>
                    <span
                      class="tw:inline-flex tw:py-px tw:px-[7px] tw:rounded tw:font-semibold tw:text-[10px] tw:leading-none tw:bg-[color-mix(in_srgb,#6b76e3_14%,transparent)] tw:text-[#4f5bcf]"
                      :class="`scd-used-card__type--${scorerTypeOf(scorer)}`"
                    >
                      {{ scorerTypeLabel(scorerTypeOf(scorer)) }}
                    </span>
                    <span class="tw:text-[11px] tw:text-(--color-text-secondary) tw:[font-variant-numeric:tabular-nums]">v{{ scorer.version }}</span>
                  </div>
                </div>
                <OIcon name="chevron-right" size="sm" class="scd-used-card__chevron tw:shrink-0 tw:text-(--color-text-secondary) tw:opacity-50" />
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

<style>
@keyframes scd-fade {
  from { background: rgba(0, 0, 0, 0); }
  to   { background: rgba(0, 0, 0, 0.32); }
}

@keyframes scd-slide {
  from { transform: translateX(100%); }
  to   { transform: translateX(0); }
}

.scd__close:hover {
  background: color-mix(in srgb, var(--color-text-primary) 8%, transparent);
  color: var(--color-text-primary, currentColor);
}

/* scd-kv dt/dd — descendant selectors, cannot inline */
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

/* OButton internals — child selector targeting component internals */
.scd-used-card button {
  height: auto !important;
  padding: 0.75rem 0.875rem !important;
  gap: 0.625rem;
  justify-content: flex-start;
  text-align: left;
}

.scd-used-card:hover {
  border-color: color-mix(in srgb, var(--color-primary-600, #3F7994) 35%, transparent) !important;
  background: color-mix(in srgb, var(--color-primary-600, #3F7994) 4%, var(--color-card-bg)) !important;
}

.scd-used-card__type--remote {
  background: color-mix(in srgb, #b25400 14%, transparent);
  color: #b25400;
}

.scd-used-card:hover .scd-used-card__chevron {
  color: var(--color-primary-600, #3F7994);
  opacity: 1;
}
</style>
