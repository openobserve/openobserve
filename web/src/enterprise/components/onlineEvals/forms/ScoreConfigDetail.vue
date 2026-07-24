<template>
  <ODrawer
    bleed
    :open="open"
    side="right"
    size="lg"
    :title="row?.name"
    title-data-test="score-config-detail-name-badge"
    :sub-title="t('onlineEvals.scoreConfig.detail.eyebrow')"
    data-test="score-config-detail"
    @update:open="handleOpenChange"
  >
    <!-- Body: the tab bar stays pinned; only the tab content scrolls. -->
    <div class="flex h-full min-h-0 flex-col">
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

      <div class="bg-card-bg flex min-h-0 flex-1 flex-col gap-4.5 overflow-auto px-5 py-4.5">
        <!-- ─────────── OVERVIEW TAB ─────────── -->
        <template v-if="activeTab === 'overview'">
          <section v-if="row.description" class="flex flex-col gap-2">
            <h4
              class="scd-section__title text-compact text-text-heading m-0 inline-flex items-center gap-1.5 border-b border-[color-mix(in_srgb,var(--color-text-secondary)_12%,transparent)] pb-1.5 leading-normal font-semibold"
            >
              {{ t("onlineEvals.scoreConfig.detail.descriptionSection") }}
            </h4>
            <p class="text-compact text-text-body m-0 leading-[1.55]">{{ row.description }}</p>
          </section>

          <section class="flex flex-col gap-2">
            <h4
              class="scd-section__title text-compact text-text-heading m-0 inline-flex items-center gap-1.5 border-b border-[color-mix(in_srgb,var(--color-text-secondary)_12%,transparent)] pb-1.5 leading-normal font-semibold"
            >
              {{ t("onlineEvals.scoreConfig.detail.configurationSection") }}
            </h4>
            <dl class="m-0 grid grid-cols-[7.5rem_1fr] gap-x-3.5 gap-y-1.5">
              <dt class="text-text-secondary text-xs font-semibold">
                {{ t("onlineEvals.scoreConfig.detail.dataTypeLabel") }}
              </dt>
              <dd class="text-compact text-text-body m-0">
                <OTag type="evalDataType" :value="dataType" />
              </dd>

              <template v-if="dataType === 'numeric' && numericRange">
                <dt class="text-text-secondary text-xs font-semibold">
                  {{ t("onlineEvals.scoreConfig.detail.rangeLabel") }}
                </dt>
                <dd
                  class="text-compact text-text-body m-0 font-mono [font-variant-numeric:tabular-nums]"
                >
                  {{ numericRange.min }} – {{ numericRange.max }}
                </dd>
              </template>

              <template v-if="dataType === 'categorical' && categories.length">
                <dt class="text-text-secondary text-xs font-semibold">
                  {{ t("onlineEvals.scoreConfig.detail.categoriesLabel") }}
                </dt>
                <dd class="text-compact text-text-body m-0">
                  <OTag v-for="cat in categories" :key="cat" type="fieldTag" value="soft">{{
                    cat
                  }}</OTag>
                </dd>
              </template>

              <template v-if="dataType === 'boolean'">
                <dt class="text-text-secondary text-xs font-semibold">
                  {{ t("onlineEvals.scoreConfig.detail.valuesLabel") }}
                </dt>
                <dd
                  class="text-compact text-text-body m-0 font-mono [font-variant-numeric:tabular-nums]"
                >
                  {{ t("onlineEvals.scoreConfig.booleanValues") }}
                </dd>
              </template>
            </dl>
          </section>

          <section class="flex flex-col gap-2">
            <h4
              class="scd-section__title text-compact text-text-heading m-0 inline-flex items-center gap-1.5 border-b border-[color-mix(in_srgb,var(--color-text-secondary)_12%,transparent)] pb-1.5 leading-normal font-semibold"
            >
              {{ t("onlineEvals.scoreConfig.detail.thresholdSection") }}
              <OTag v-if="!healthyLabel" type="thresholdFlag" value="notdeclared" />
            </h4>
            <div
              v-if="healthyLabel"
              class="rounded-default flex items-baseline gap-2 border border-[color-mix(in_srgb,var(--color-status-success-text)_35%,transparent)] bg-[color-mix(in_srgb,var(--color-status-success-text)_8%,transparent)] p-[12px_14px]"
            >
              <span class="text-status-success-text text-lg font-bold">{{ thresholdSign }}</span>
              <span class="text-text-body font-mono text-sm font-bold">{{ healthyLabel }}</span>
              <span class="text-2xs text-text-secondary ml-auto">{{
                t("onlineEvals.scoreConfig.detail.thresholdHint")
              }}</span>
            </div>
            <p v-else class="text-compact text-text-secondary m-0 leading-[1.55]">
              {{ t("onlineEvals.scoreConfig.detail.noThresholdHint") }}
            </p>
          </section>

          <section class="flex flex-col gap-2">
            <h4
              class="scd-section__title text-compact text-text-heading m-0 inline-flex items-center gap-1.5 border-b border-[color-mix(in_srgb,var(--color-text-secondary)_12%,transparent)] pb-1.5 leading-normal font-semibold"
            >
              {{ t("onlineEvals.scoreConfig.detail.metadataSection") }}
            </h4>
            <dl class="m-0 grid grid-cols-[7.5rem_1fr] gap-x-3.5 gap-y-1.5">
              <dt class="text-text-secondary text-xs font-semibold">
                {{ t("onlineEvals.scoreConfig.detail.statusLabel") }}
              </dt>
              <dd class="text-compact text-text-body m-0">
                <OTag type="booleanState" :value="isActive ? 'enabled' : 'disabled'">
                  {{
                    isActive
                      ? t("onlineEvals.scoreConfig.detail.statusActive")
                      : t("onlineEvals.scoreConfig.detail.statusInactive")
                  }}
                </OTag>
              </dd>
              <dt class="text-text-secondary text-xs font-semibold">
                {{ t("onlineEvals.scoreConfig.detail.versionLabel") }}
              </dt>
              <dd
                class="text-compact text-text-body m-0 font-mono [font-variant-numeric:tabular-nums]"
              >
                {{ t("onlineEvals.versionPrefix") }}{{ row.version }}
              </dd>
              <dt v-if="createdAt" class="text-text-secondary text-xs font-semibold">
                {{ t("onlineEvals.scoreConfig.detail.createdLabel") }}
              </dt>
              <dd
                v-if="createdAt"
                class="text-compact text-text-body m-0 font-mono [font-variant-numeric:tabular-nums]"
              >
                {{ formatTimestamp(createdAt) }}
              </dd>
              <dt v-if="updatedAt" class="text-text-secondary text-xs font-semibold">
                {{ t("onlineEvals.scoreConfig.detail.updatedLabel") }}
              </dt>
              <dd
                v-if="updatedAt"
                class="text-compact text-text-body m-0 font-mono [font-variant-numeric:tabular-nums]"
              >
                {{ formatTimestamp(updatedAt) }}
              </dd>
            </dl>
          </section>
        </template>

        <!-- ─────────── VERSIONS TAB ─────────── -->
        <template v-else-if="activeTab === 'versions'">
          <p class="text-text-secondary m-0 text-xs leading-normal">
            {{ t("onlineEvals.scoreConfig.detail.versionsIntro") }}
          </p>
          <ul class="m-0 flex list-none flex-col gap-2 p-0">
            <li
              class="bg-card-bg rounded-default border border-[color-mix(in_srgb,var(--color-primary-600,#3F7994)_30%,transparent)] bg-[color-mix(in_srgb,var(--color-primary-600,#3F7994)_5%,var(--color-card-bg))]! p-[12px_14px]"
            >
              <div class="flex items-center gap-2">
                <span
                  class="text-compact text-text-body font-mono font-bold [font-variant-numeric:tabular-nums]"
                  >{{ t("onlineEvals.versionPrefix") }}{{ row.version }}</span
                >
                <OTag type="activeVersionFlag" value="active" />
              </div>
              <div v-if="updatedAt" class="text-2xs text-text-secondary mt-1.5">
                {{ t("onlineEvals.scoreConfig.detail.lastUpdated") }}
                <span class="font-mono [font-variant-numeric:tabular-nums]">{{
                  formatTimestamp(updatedAt)
                }}</span>
              </div>
            </li>
          </ul>
        </template>

        <!-- ─────────── USED BY TAB ─────────── -->
        <template v-else-if="activeTab === 'usedBy'">
          <p class="text-text-secondary m-0 text-xs leading-normal">
            {{ t("onlineEvals.scoreConfig.detail.usedByIntro") }}
          </p>
          <div
            v-if="usedByScorers.length === 0"
            class="rounded-default text-text-secondary inline-flex items-center gap-1.5 bg-[color-mix(in_srgb,var(--color-text-secondary)_6%,transparent)] p-[8px_10px] text-xs"
          >
            <OIcon name="info" size="xs" />
            <span>{{ t("onlineEvals.scoreConfig.detail.usedByEmpty") }}</span>
          </div>
          <ul v-else class="m-0 flex list-none flex-col gap-2 p-0">
            <li v-for="scorer in usedByScorers" :key="scorer.id">
              <OButton
                variant="ghost"
                class="scd-used-card bg-card-bg! rounded-default! w-full border! border-[color-mix(in_srgb,var(--color-text-secondary)_16%,transparent)]! transition-[border-color,background] duration-150"
                :data-test="`score-config-detail-used-by-item-${scorer.name}`"
                @click="emit('view-scorer', scorer)"
              >
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-2">
                    <span
                      class="text-compact text-text-heading font-mono font-bold [font-variant-numeric:tabular-nums]"
                      >{{ scorer.name }}</span
                    >
                    <OTag type="scorerType" :value="scorerTypeOf(scorer)" />
                    <span class="text-2xs text-text-secondary [font-variant-numeric:tabular-nums]"
                      >{{ t("onlineEvals.versionPrefix") }}{{ scorer.version }}</span
                    >
                  </div>
                </div>
                <OIcon
                  name="chevron-right"
                  size="sm"
                  class="scd-used-card__chevron text-text-secondary shrink-0 opacity-50"
                />
              </OButton>
            </li>
          </ul>
        </template>
      </div>
    </div>
  </ODrawer>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import type { ScoreConfig, Scorer } from "@/services/online-evals.service";
import { dataTypeOf, entityId } from "../utils/evalEntity";

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

// Drawer open state — starts open (the parent mounts this only when a score
// config row is selected). ODrawer's update:open(false) — via ×, Escape, or
// overlay click — forwards `close` to the parent, which unmounts us.
const open = ref(true);
function handleOpenChange(value: boolean) {
  open.value = value;
  if (!value) emit("close");
}
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

<style scoped>
/* keep(complex-state): the "used by" card hover overrides OButton's border/bg and
   reveals its chevron; the height/padding reset targets the native <button>
   rendered inside OButton, reachable only via :deep(). */
.scd-used-card :deep(button) {
  height: auto !important;
  padding: 0.75rem 0.875rem !important;
  gap: 0.625rem;
  justify-content: flex-start;
  text-align: left;
}

.scd-used-card:hover {
  border-color: color-mix(in srgb, var(--color-primary-600) 35%, transparent) !important;
  background: color-mix(in srgb, var(--color-primary-600) 4%, var(--color-card-bg)) !important;
}

.scd-used-card:hover .scd-used-card__chevron {
  color: var(--color-primary-600);
  opacity: 1;
}
</style>
