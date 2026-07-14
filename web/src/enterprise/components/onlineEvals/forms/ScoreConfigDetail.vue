<template>
  <div
    class="scd-scrim fixed inset-0 bg-[rgba(0,0,0,0.32)] z-[1010] flex justify-end [animation:scd-fade_0.18s_ease-out]"
    role="dialog"
    aria-modal="true"
    @click.self="$emit('close')"
  >
    <aside
      class="scd w-[560px] max-w-[92vw] h-full bg-(--color-card-bg) border-l border-(--color-dialog-header-border) flex flex-col [animation:scd-slide_0.22s_ease-out]"
      @click.stop
      data-test="score-config-detail"
    >
      <!-- Header: eyebrow + title + status meta + close -->
      <header class="flex items-start gap-2.5 px-5 pt-4 pb-3.5 border-b border-dialog-header-border bg-card-bg shrink-0">
        <div class="flex-1 min-w-0 flex flex-col gap-1">
          <div class="flex items-center gap-2 flex-nowrap">
            <span class="font-semibold text-[11px] leading-[1.4] tracking-[0.02em] text-text-secondary">{{ t("onlineEvals.scoreConfig.detail.eyebrow") }}</span>
            <span
              v-if="row.name"
              :class="[
                'font-semibold px-2 py-1 rounded-md inline-block',
                store.state.theme === 'dark'
                  ? 'text-blue-400 bg-blue-900/50'
                  : 'text-blue-600 bg-blue-50',
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
          class="scd__close shrink-0 bg-transparent border-0 p-1 rounded cursor-pointer text-(--color-text-secondary)"
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
        class="flex-shrink-0 px-5"
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
          <OTag
            v-if="tab.count != null"
            type="countChip"
            :value="activeTab === tab.id ? 'primary' : 'neutral'"
            >{{ tab.count }}</OTag
          >
        </OTab>
      </OTabs>

      <div class="flex-1 overflow-auto px-5 py-4.5 flex flex-col gap-4.5 min-h-0 bg-card-bg">
        <!-- ─────────── OVERVIEW TAB ─────────── -->
        <template v-if="activeTab === 'overview'">
          <section v-if="row.description" class="flex flex-col gap-2">
            <h4 class="scd-section__title m-0 font-semibold text-[13px] leading-normal text-(--color-text-primary) pb-1.5 border-b border-[color-mix(in_srgb,var(--color-text-secondary)_12%,transparent)] inline-flex items-center gap-1.5">{{ t("onlineEvals.scoreConfig.detail.descriptionSection") }}</h4>
            <p class="m-0 text-[13px] leading-[1.55] text-(--color-text-primary)">{{ row.description }}</p>
          </section>

          <section class="flex flex-col gap-2">
            <h4 class="scd-section__title m-0 font-semibold text-[13px] leading-normal text-(--color-text-primary) pb-1.5 border-b border-[color-mix(in_srgb,var(--color-text-secondary)_12%,transparent)] inline-flex items-center gap-1.5">{{ t("onlineEvals.scoreConfig.detail.configurationSection") }}</h4>
            <dl class="scd-kv grid gap-x-3.5 gap-y-1.5 m-0" style="grid-template-columns: 120px 1fr;">
              <dt>{{ t("onlineEvals.scoreConfig.detail.dataTypeLabel") }}</dt>
              <dd>
                <OTag type="evalDataType" :value="dataType" />
              </dd>

              <template v-if="dataType === 'numeric' && numericRange">
                <dt>{{ t("onlineEvals.scoreConfig.detail.rangeLabel") }}</dt>
                <dd class="font-[ui-monospace,SFMono-Regular,Menlo,monospace] [font-variant-numeric:tabular-nums]">{{ numericRange.min }} – {{ numericRange.max }}</dd>
              </template>

              <template v-if="dataType === 'categorical' && categories.length">
                <dt>{{ t("onlineEvals.scoreConfig.detail.categoriesLabel") }}</dt>
                <dd>
                  <OTag v-for="cat in categories" :key="cat" type="fieldTag" value="soft">{{ cat }}</OTag>
                </dd>
              </template>

              <template v-if="dataType === 'boolean'">
                <dt>{{ t("onlineEvals.scoreConfig.detail.valuesLabel") }}</dt>
                <dd class="font-[ui-monospace,SFMono-Regular,Menlo,monospace] [font-variant-numeric:tabular-nums]">true / false</dd>
              </template>
            </dl>
          </section>

          <section class="flex flex-col gap-2">
            <h4 class="scd-section__title m-0 font-semibold text-[13px] leading-normal text-(--color-text-primary) pb-1.5 border-b border-[color-mix(in_srgb,var(--color-text-secondary)_12%,transparent)] inline-flex items-center gap-1.5">
              {{ t("onlineEvals.scoreConfig.detail.thresholdSection") }}
              <OTag v-if="!healthyLabel" type="thresholdFlag" value="notdeclared" />
            </h4>
            <div
              v-if="healthyLabel"
              class="flex items-baseline gap-2 p-[12px_14px] border border-[color-mix(in_srgb,var(--color-status-success-text)_35%,transparent)] bg-[color-mix(in_srgb,var(--color-status-success-text)_8%,transparent)] rounded-md"
            >
              <span class="text-lg font-bold text-(--color-status-success-text)">{{ thresholdSign }}</span>
              <span class="font-[ui-monospace,SFMono-Regular,Menlo,monospace] font-bold text-sm text-(--color-text-primary)">{{ healthyLabel }}</span>
              <span class="ml-auto text-[11px] text-(--color-text-secondary)">{{ t("onlineEvals.scoreConfig.detail.thresholdHint") }}</span>
            </div>
            <p v-else class="m-0 text-[13px] leading-[1.55] text-(--color-text-secondary)">
              {{ t("onlineEvals.scoreConfig.detail.noThresholdHint") }}
            </p>
          </section>

          <section class="flex flex-col gap-2">
            <h4 class="scd-section__title m-0 font-semibold text-[13px] leading-normal text-(--color-text-primary) pb-1.5 border-b border-[color-mix(in_srgb,var(--color-text-secondary)_12%,transparent)] inline-flex items-center gap-1.5">{{ t("onlineEvals.scoreConfig.detail.metadataSection") }}</h4>
            <dl class="scd-kv grid gap-x-3.5 gap-y-1.5 m-0" style="grid-template-columns: 120px 1fr;">
              <dt>{{ t("onlineEvals.scoreConfig.detail.statusLabel") }}</dt>
              <dd>
                <OTag type="booleanState" :value="isActive ? 'enabled' : 'disabled'">
                  {{ isActive
                    ? t("onlineEvals.scoreConfig.detail.statusActive")
                    : t("onlineEvals.scoreConfig.detail.statusInactive") }}
                </OTag>
              </dd>
              <dt>{{ t("onlineEvals.scoreConfig.detail.versionLabel") }}</dt>
              <dd class="font-[ui-monospace,SFMono-Regular,Menlo,monospace] [font-variant-numeric:tabular-nums]">v{{ row.version }}</dd>
              <dt v-if="createdAt">{{ t("onlineEvals.scoreConfig.detail.createdLabel") }}</dt>
              <dd v-if="createdAt" class="font-[ui-monospace,SFMono-Regular,Menlo,monospace] [font-variant-numeric:tabular-nums]">{{ formatTimestamp(createdAt) }}</dd>
              <dt v-if="updatedAt">{{ t("onlineEvals.scoreConfig.detail.updatedLabel") }}</dt>
              <dd v-if="updatedAt" class="font-[ui-monospace,SFMono-Regular,Menlo,monospace] [font-variant-numeric:tabular-nums]">{{ formatTimestamp(updatedAt) }}</dd>
            </dl>
          </section>
        </template>

        <!-- ─────────── VERSIONS TAB ─────────── -->
        <template v-else-if="activeTab === 'versions'">
          <p class="m-0 text-xs leading-normal text-(--color-text-secondary)">{{ t("onlineEvals.scoreConfig.detail.versionsIntro") }}</p>
          <ul class="list-none m-0 p-0 flex flex-col gap-2">
            <li
              class="p-[12px_14px] bg-(--color-card-bg) border border-[color-mix(in_srgb,var(--color-primary-600,#3F7994)_30%,transparent)] bg-[color-mix(in_srgb,var(--color-primary-600,#3F7994)_5%,var(--color-card-bg))]! rounded-md"
            >
              <div class="flex items-center gap-2">
                <span class="font-[ui-monospace,SFMono-Regular,Menlo,monospace] [font-variant-numeric:tabular-nums] font-bold text-[13px] text-(--color-text-primary)">v{{ row.version }}</span>
                <OTag type="activeVersionFlag" value="active" />
              </div>
              <div v-if="updatedAt" class="mt-1.5 text-[11.5px] text-(--color-text-secondary)">
                {{ t("onlineEvals.scoreConfig.detail.lastUpdated") }}
                <span class="font-[ui-monospace,SFMono-Regular,Menlo,monospace] [font-variant-numeric:tabular-nums]">{{ formatTimestamp(updatedAt) }}</span>
              </div>
            </li>
          </ul>
        </template>

        <!-- ─────────── USED BY TAB ─────────── -->
        <template v-else-if="activeTab === 'usedBy'">
          <p class="m-0 text-xs leading-normal text-(--color-text-secondary)">{{ t("onlineEvals.scoreConfig.detail.usedByIntro") }}</p>
          <div
            v-if="usedByScorers.length === 0"
            class="inline-flex items-center gap-1.5 p-[8px_10px] bg-[color-mix(in_srgb,var(--color-text-secondary)_6%,transparent)] rounded-[5px] text-xs text-(--color-text-secondary)"
          >
            <OIcon name="info" size="xs" />
            <span>{{ t("onlineEvals.scoreConfig.detail.usedByEmpty") }}</span>
          </div>
          <ul v-else class="list-none m-0 p-0 flex flex-col gap-2">
            <li v-for="scorer in usedByScorers" :key="scorer.id">
              <OButton
                variant="ghost"
                class="scd-used-card w-full bg-(--color-card-bg)! border! border-[color-mix(in_srgb,var(--color-text-secondary)_16%,transparent)]! rounded-md! transition-[border-color,background] duration-150"
                :data-test="`score-config-detail-used-by-item-${scorer.name}`"
                @click="emit('view-scorer', scorer)"
              >
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2">
                    <span class="font-[ui-monospace,SFMono-Regular,Menlo,monospace] [font-variant-numeric:tabular-nums] font-bold text-[13px] text-(--color-text-primary)">{{ scorer.name }}</span>
                    <OTag type="scorerType" :value="scorerTypeOf(scorer)" />
                    <span class="text-[11px] text-(--color-text-secondary) [font-variant-numeric:tabular-nums]">v{{ scorer.version }}</span>
                  </div>
                </div>
                <OIcon name="chevron-right" size="sm" class="scd-used-card__chevron shrink-0 text-(--color-text-secondary) opacity-50" />
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
import OTag from "@/lib/core/Badge/OTag.vue";
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
