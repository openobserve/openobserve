<template>
  <ODialog
    v-model:open="internalValue"
    persistent
    :width="50"
    data-test="test-model-match-dialog"
    :title="t('modelPricing.testMatchTitle')"
    :sub-title="t('modelPricing.testMatchSubtitle')"
    :secondary-button-label="t('modelPricing.close')"
    :primary-button-label="t('modelPricing.testMatch')"
    :primary-button-disabled="!testModelName"
    :primary-button-loading="testing"
    @click:secondary="internalValue = false"
    @click:primary="runTest"
  >
    <!-- Two-column body -->
    <div class="flex h-full min-h-0 flex-1 overflow-hidden">
      <!-- ── Left: Inputs ── -->
      <div class="flex w-85 shrink-0 flex-col gap-5 overflow-y-auto py-5 pr-5 pl-6">
        <!-- Model Name -->
        <OInput
          v-model="testModelName"
          :label="t('modelPricing.modelNameInput')"
          :help-text="t('modelPricing.modelNameHint')"
          :placeholder="
            t('settings.testModelMatchDialog.modelNamePlaceholder', {
              example: raw('gpt-4-turbo'),
            })
          "
          required
          clearable
          autofocus
          data-test="test-match-model-input"
        >
          <template #icon-left>
            <OIcon name="smart-toy" size="sm" class="shrink-0 opacity-[0.35]" />
          </template>
        </OInput>

        <!-- Optional UTC time — lets peak / off-peak tiers be tested directly -->
        <div class="flex flex-col gap-1.5">
          <OTime
            v-model="testAtTime"
            :label="t('modelPricing.testAtTimeLabel')"
            :help-text="t('modelPricing.testAtTimeHint')"
            format24
            clearable
            data-test="test-match-time-input"
          />
          <OText v-if="testAtTimeLocalHint" variant="meta" data-test="test-match-time-local-hint">
            {{ t("modelPricing.localTimeHint", { range: testAtTimeLocalHint }) }}
          </OText>
        </div>
      </div>

      <!-- ── Vertical divider ── -->
      <OSeparator vertical />

      <!-- ── Right: Live Results ── -->
      <div class="flex-1 overflow-y-auto py-5 pr-6 pl-5">
        <transition name="tmm-fade" mode="out-in">
          <!-- Empty state -->
          <div
            v-if="!testModelName"
            key="empty"
            class="flex h-full min-h-50 items-center justify-center"
            data-test="test-match-empty"
          >
            <OEmptyState
              size="inline"
              icon="manage-search"
              hide-action
              :title="t('modelPricing.enterModelName')"
            />
          </div>

          <!-- Typed but not yet tested -->
          <div
            v-else-if="testResult === null"
            key="waiting"
            class="flex h-full min-h-50 items-center justify-center"
            data-test="test-match-waiting"
          >
            <OEmptyState
              size="inline"
              icon="ads-click"
              hide-action
              :title="t('modelPricing.clickToTest')"
            />
          </div>

          <!-- No Match -->
          <div
            v-else-if="!testResult?.matched"
            key="no-match"
            class="flex flex-col gap-3"
            data-test="test-match-no-result"
          >
            <OBanner variant="error-soft" icon="error-outline" inline-actions>
              <div class="text-compact font-bold">
                {{ t("modelPricing.noMatchFound") }}
              </div>
              <div class="mt-0.5 text-xs opacity-70">
                {{
                  t("modelPricing.noMatchDesc", {
                    modelName: testModelName,
                  })
                }}
              </div>
            </OBanner>
            <div
              class="rounded-default bg-surface-panel border-card-glass-border border px-3.5 py-3"
            >
              <div class="text-2xs mb-1.5 font-semibold opacity-55">
                {{ t("modelPricing.troubleshootingTitle") }}
              </div>
              <ul class="m-0 pl-4 text-xs leading-[1.9] opacity-60">
                <li>{{ t("modelPricing.tip1") }}</li>
                <li>{{ t("modelPricing.tip2") }}</li>
                <li>{{ t("modelPricing.tip3") }}</li>
              </ul>
            </div>
          </div>

          <!-- Match Found -->
          <div v-else key="match" class="flex flex-col gap-3" data-test="test-match-result">
            <!-- Match status -->
            <OBanner variant="success" icon="check-circle" inline-actions>
              <div class="text-compact font-bold">
                {{ t("modelPricing.matchFound") }}
              </div>
              <div class="mt-0.5 text-xs opacity-70">
                <OCode truncate>{{ testResult.matched.name }}</OCode>
              </div>
              <template #actions>
                <OTag
                  type="modelSource"
                  :value="testResult.matched.source || 'org'"
                  class="text-2xs shrink-0 font-semibold"
                >
                  {{ sourceLabel(testResult.matched) }}
                </OTag>
              </template>
            </OBanner>

            <!-- Priority flow -->
            <div
              class="border-card-glass-border rounded-default bg-surface-panel border px-3.5 py-3"
            >
              <div class="text-3xs mb-2 font-semibold opacity-40">
                {{ t("modelPricing.matchPriority") }}
              </div>
              <div class="flex flex-wrap items-center gap-1.5">
                <template v-for="(step, sIdx) in matchFlowSteps" :key="step.key">
                  <div class="opacity-30" v-if="sIdx > 0">
                    <OIcon name="arrow-forward" size="xs" />
                  </div>
                  <div
                    class="rounded-default border-card-glass-border text-2xs flex items-center gap-1.25 border bg-transparent px-2.5 py-1.25 font-medium"
                    :class="{
                      'border-status-positive bg-banner-success-bg font-bold':
                        step.key === winnerSource,
                      'opacity-40': step.key !== winnerSource,
                    }"
                  >
                    <OIcon :name="step.icon" size="sm" class="opacity-60" />
                    <span>{{ step.label }}</span>
                    <OIcon
                      v-if="step.key === winnerSource"
                      name="check-circle"
                      size="xs"
                      class="text-status-success-text"
                    />
                  </div>
                </template>
              </div>
            </div>

            <!-- Tier + cost card -->
            <div class="border-card-glass-border rounded-default overflow-hidden border">
              <div class="bg-surface-panel border-card-glass-border border-b px-3.5 py-3">
                <div>
                  <div class="text-compact font-bold">
                    {{ testResult.tier || t("settings.testModelMatchDialog.defaultTier") }}
                  </div>
                  <div class="text-2xs mt-0.5 opacity-50" v-if="matchedTierDef?.condition">
                    {{ t("settings.testModelMatchDialog.condition") }}
                    <OCode
                      >{{ matchedTierDef.condition.usage_key }}
                      {{ operatorSymbol(matchedTierDef.condition.operator) }}
                      {{ matchedTierDef.condition.value }}</OCode
                    >
                  </div>
                  <div
                    class="text-2xs mt-0.5 flex items-center gap-1 opacity-50"
                    v-if="matchedTierWindows.length"
                    data-test="test-match-tier-windows"
                  >
                    <OIcon name="schedule" size="xs" />
                    <span class="font-mono">{{ formatUtcWindows(matchedTierWindows) }}</span>
                    <span v-if="matchedTierWindowsLocal" class="font-mono">{{
                      matchedTierWindowsLocal
                    }}</span>
                  </div>
                  <div
                    class="text-2xs mt-0.5 opacity-50"
                    v-if="!matchedTierDef?.condition && !matchedTierWindows.length"
                  >
                    {{ t("modelPricing.defaultPricingTier") }}
                  </div>
                </div>
              </div>

              <div class="text-xs" v-if="pricingRows.length > 0">
                <div
                  class="border-card-glass-border bg-surface-panel grid grid-cols-[1.5fr_1fr] gap-2 border-b px-3.5 py-1.75"
                >
                  <span class="text-3xs font-semibold opacity-40">{{
                    t("modelPricing.usageType")
                  }}</span>
                  <span class="text-3xs text-right font-semibold opacity-40">{{
                    t("modelPricing.pricePerMTokens")
                  }}</span>
                </div>
                <div
                  v-for="row in pricingRows"
                  :key="row.key"
                  class="tmm-cost-table-row border-border-default hover:bg-hover-gray grid grid-cols-[1.5fr_1fr] gap-2 border-b px-3.5 py-2 text-xs last:border-b-0"
                >
                  <span class="text-2xs font-mono font-semibold">{{ row.key }}</span>
                  <span class="text-right font-semibold tabular-nums"
                    >{{ t("modelPricing.currencySymbol") }}{{ formatRate(row.rate) }}</span
                  >
                </div>
              </div>
              <OEmptyState
                v-else
                size="inline"
                icon="info-outline"
                hide-action
                :title="t('modelPricing.noPricingForTier')"
              />
            </div>
          </div>
        </transition>
      </div>
    </div>
  </ODialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { raw, useI18nTyped } from "@/types/i18n";
import { useStore } from "vuex";
import modelPricingService from "@/services/model_pricing";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OCode from "@/lib/core/Code/OCode.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OTime from "@/lib/forms/Time/OTime.vue";
import {
  operatorSymbol,
  formatUtcWindows,
  formatUtcWindowsInTz,
  utcMinuteToTzHhmm,
  minuteOfDayToHhmm,
  timezoneAbbr,
} from "@/utils/formatters";

const props = defineProps({
  modelValue: { type: Boolean, default: false },
});
const emit = defineEmits(["update:modelValue"]);

const { t } = useI18nTyped();
const store = useStore();
const orgIdentifier = computed(() => store.state.selectedOrganization?.identifier || "");

const internalValue = computed({
  get: () => props.modelValue,
  set: (val) => emit("update:modelValue", val),
});

const testModelName = ref("");
// Optional `HH:MM` UTC time-of-day to test at; empty = "right now". Lets a
// peak / off-peak tier be exercised without waiting for its window.
const testAtTime = ref("");

// Reset on open. Focus is OInput's `autofocus`, not a ref call — OInput is
// `<script setup>` with no defineExpose, so it has no focus() to reach for.
watch(internalValue, (val) => {
  if (val) {
    testResult.value = null;
    testModelName.value = "";
    testAtTime.value = "";
  }
});

// ── Backend test API ──────────────────────────────────────────────────────────

const testResult = ref<any>(null);

// The instant the backend resolves `valid_from` and any recurring UTC window
// (peak / off-peak rates) against: today at the chosen UTC time, or "right now"
// when no time is picked. Without it a peak-hour tier could never be shown.
function testTimestampMicros(): number {
  const m = /^(\d{2}):(\d{2})/.exec(testAtTime.value || "");
  if (!m) return Date.now() * 1000;
  const now = new Date();
  return (
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      Number(m[1]),
      Number(m[2]),
    ) * 1000
  );
}

async function callTestApi() {
  if (!testModelName.value) {
    testResult.value = null;
    return;
  }
  try {
    const res = await modelPricingService.test(orgIdentifier.value, {
      model_name: testModelName.value,
      usage: undefined,
      timestamp: testTimestampMicros(),
    });
    testResult.value = res.data;
  } catch {
    testResult.value = null;
  }
}

const testing = ref(false);

async function runTest() {
  if (!testModelName.value) return;
  testing.value = true;
  await callTestApi();
  testing.value = false;
}

watch(testModelName, (val) => {
  if (!val) testResult.value = null;
});

// A shown result answers "what applies at the tested time" — keep it honest by
// re-running when that time changes rather than displaying a stale tier.
watch(testAtTime, () => {
  if (testResult.value !== null && testModelName.value) callTestApi();
});

// ── Derived display values ────────────────────────────────────────────────────

const PRICE_KEY_ORDER = ["input", "output"];
function sortedPriceEntries(prices: Record<string, number>): [string, number][] {
  return Object.entries(prices).sort(([a], [b]) => {
    const ai = PRICE_KEY_ORDER.indexOf(a);
    const bi = PRICE_KEY_ORDER.indexOf(b);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return a.localeCompare(b);
  });
}

const winnerSource = computed(() => testResult.value?.matched?.source || null);

const matchFlowSteps = computed(() => [
  { key: "org", label: t("settings.testModelMatchDialog.stepYourOrg"), icon: "person" },
  { key: "meta_org", label: t("settings.testModelMatchDialog.stepGlobal"), icon: "corporate-fare" },
  { key: "built_in", label: t("settings.testModelMatchDialog.stepBuiltIn"), icon: "auto-awesome" },
]);

const matchedTierDef = computed(() => {
  const result = testResult.value;
  if (!result?.matched) return null;
  const tiers: any[] = result.matched.tiers || [];
  return tiers.find((t: any) => (t.name || "Default") === result.tier) || tiers[0] || null;
});

const pricingRows = computed(() => {
  if (!testResult.value?.matched) return [];
  const tierPrices = matchedTierDef.value?.prices || {};
  return sortedPriceEntries(tierPrices).map(([key, pricePerToken]) => ({
    key,
    rate: pricePerToken * 1_000_000,
  }));
});

const matchedTierWindows = computed<Array<{ start_minute: number; end_minute: number }>>(
  () => matchedTierDef.value?.utc_windows ?? [],
);

// "· 06:30–09:30, 11:30–15:30 IST" — the matched tier's hours in the user's
// timezone. Empty when the user's timezone is UTC (nothing to convert).
const matchedTierWindowsLocal = computed(() => {
  const local = formatUtcWindowsInTz(matchedTierWindows.value, store.state.timezone);
  return local ? `· ${local}` : "";
});

/** The chosen test time shown in the user's timezone (empty when unset, or when
 *  the timezone matches UTC and the conversion would just repeat the input). */
const testAtTimeLocalHint = computed(() => {
  const m = /^(\d{2}):(\d{2})/.exec(testAtTime.value || "");
  if (!m) return "";
  const tz = store.state.timezone;
  const minute = Number(m[1]) * 60 + Number(m[2]);
  const local = utcMinuteToTzHhmm(minute, tz);
  if (!local || local === minuteOfDayToHhmm(minute)) return "";
  return `${local} ${timezoneAbbr(tz)}`;
});

function sourceLabel(model: any) {
  if (!model.source || model.source === "org")
    return t("settings.testModelMatchDialog.sourceYourOrg");
  if (model.source === "meta_org") return t("settings.testModelMatchDialog.sourceGlobal");
  return t("settings.testModelMatchDialog.sourceBuiltIn");
}

function formatRate(rate: number) {
  if (rate === 0) return "0.00";
  if (rate < 0.01) return rate.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
  return rate.toFixed(2);
}
</script>

<style scoped>
/* keep(complex-state): the enter/leave classes Vue applies for
   <Transition name="tmm-fade"> — Vue adds them itself, mid-transition, so no
   template utility can express them. Scoped is correct: every transitioned
   element is this component's own template child. */
.tmm-fade-enter-active,
.tmm-fade-leave-active {
  transition: all 0.18s ease;
}

.tmm-fade-enter-from {
  opacity: 0;
  transform: translateY(0.3125rem);
}

.tmm-fade-leave-to {
  opacity: 0;
}
</style>
