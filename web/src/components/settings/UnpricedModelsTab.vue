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

<!-- Models seen in a stream's spans over the last 24 h that matched no price, or
     only part of a pattern, each with a one-step fix. The parent owns the read
     (its row count labels the tab); this view owns the fixes. -->
<template>
  <div class="flex h-full min-h-0 flex-col" data-test="model-pricing-unpriced-tab">
    <OBanner
      v-if="models.length"
      variant="warning"
      icon="warning-amber"
      dense
      class="mx-page-edge mt-2 shrink-0"
      :content="t('modelPricing.unpriced.banner', { count: models.length }, models.length)"
      data-test="model-pricing-unpriced-banner"
    />
    <div class="min-h-0 flex-1 overflow-hidden">
      <OTable
        :frame="false"
        data-test="model-pricing-unpriced-table"
        :data="models"
        :columns="columns"
        row-key="model"
        :loading="loading"
        pagination="none"
        sorting="client"
        :default-columns="false"
        :show-global-filter="false"
      >
        <template #toolbar>
          <div class="flex w-full min-w-0 flex-wrap items-center gap-2">
            <div class="app-tabs-container h-9">
              <slot name="tabs" />
            </div>
            <div class="ms-auto w-64" data-test="model-pricing-unpriced-stream-select">
              <OSelect
                :model-value="stream"
                :label="t('modelPricing.unpriced.streamLabel')"
                label-position="inside"
                :options="streams"
                :disabled="!streams.length"
                class="w-full"
                @update:model-value="(v) => emit('update:stream', String(v ?? ''))"
              />
            </div>
            <OBadge
              variant="default-outline"
              icon="schedule"
              data-test="model-pricing-unpriced-window"
            >
              {{ t("modelPricing.unpriced.window") }}
            </OBadge>
          </div>
        </template>
        <template #toolbar-trailing>
          <ORefreshButton
            layout="inline"
            variant="outline"
            :last-run-at="lastRunAt"
            :loading="fetching"
            data-test="model-pricing-unpriced-refresh-btn"
            @click="emit('refresh')"
          />
        </template>

        <template #cell-model="{ row }">
          <div class="flex min-w-0 flex-col py-1" data-test="model-pricing-unpriced-row">
            <OTruncatedText as="div" class="font-medium">{{ row.model }}</OTruncatedText>
            <span class="text-text-secondary text-xs">{{ seenBy(row) }}</span>
          </div>
        </template>
        <template #cell-priced_as="{ row }">
          <OBadge v-if="!row.matched" variant="error-soft" size="sm">
            {{ t("modelPricing.unpriced.noMatch") }}
          </OBadge>
          <div v-else class="flex min-w-0 flex-col py-1">
            <div class="flex min-w-0 items-center gap-1.5">
              <OTruncatedText as="span">{{ row.matched.name }}</OTruncatedText>
              <OBadge variant="warning-soft" size="sm" class="shrink-0">
                {{ t("modelPricing.unpriced.approximate") }}
              </OBadge>
            </div>
            <span v-if="matchedPrices(row)" class="text-text-secondary text-xs">
              {{ matchedPrices(row) }}
            </span>
          </div>
        </template>
        <template #cell-tokens="{ row }">{{ formatTokens(row.tokens) }}</template>
        <template #cell-cost="{ row }">${{ formatCost(row.cost) }}</template>
        <template #cell-actions="{ row }">
          <div class="flex items-center justify-end gap-1">
            <OButton
              variant="outline"
              size="sm"
              data-test="model-pricing-unpriced-create-btn"
              @click.stop="createPrice(row)"
            >
              {{ t("modelPricing.unpriced.createPrice") }}
            </OButton>
            <OButton
              v-if="row.matched"
              variant="ghost"
              size="sm"
              :loading="pendingModel === row.model"
              :disabled="!!pendingModel"
              data-test="model-pricing-unpriced-keep-btn"
              @click.stop="keepPrices(row)"
            >
              {{ t("modelPricing.unpriced.keepPrices", { name: row.matched.name }) }}
            </OButton>
            <OButton
              v-else
              variant="ghost"
              size="sm"
              :loading="pendingModel === row.model"
              :disabled="!!pendingModel"
              data-test="model-pricing-unpriced-mute-btn"
              @click.stop="confirmMute(row)"
            >
              {{ t("modelPricing.unpriced.mute") }}
            </OButton>
          </div>
        </template>

        <template #empty>
          <OEmptyState
            v-if="streamsLoaded && !streams.length"
            size="block"
            illustration="stream-select"
            :title="t('modelPricing.unpriced.noStreamsTitle')"
            :description="t('modelPricing.unpriced.noStreamsDesc')"
            data-test="model-pricing-unpriced-no-streams"
          />
          <OEmptyState
            v-else
            size="block"
            illustration="check"
            :title="t('modelPricing.unpriced.emptyTitle')"
            data-test="model-pricing-unpriced-empty"
          />
        </template>
      </OTable>
    </div>
    <p
      class="text-text-secondary px-page-edge shrink-0 py-2 text-xs"
      data-test="model-pricing-unpriced-note"
    >
      {{ t("modelPricing.unpriced.recordedCostNote") }}
    </p>

    <ConfirmDialog
      v-model="muteDialog.show"
      :title="t('modelPricing.unpriced.muteConfirmTitle')"
      :message="muteDialog.message"
      :ok-label="t('modelPricing.unpriced.mute')"
      @update:ok="mute"
      @update:cancel="muteDialog.show = false"
    />
  </div>
</template>

<script lang="ts" setup>
import { computed, ref } from "vue";
import { useMutation } from "@tanstack/vue-query";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import type { UnpricedModel } from "@/services/model_pricing";
import { saveModelPricingMutation } from "@/services/model_pricing.queries";
import {
  buildKeepPricesPayload,
  buildMutePayload,
  defaultTier,
  exactModelPattern,
} from "@/components/settings/unpricedModelPricing";
import { formatCost, formatTokens } from "@/utils/llmUtils";
import { isAxiosError } from "axios";
import { toast } from "@/lib/feedback/Toast/useToast";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import ORefreshButton from "@/lib/core/RefreshButton/ORefreshButton.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";

defineProps<{
  models: UnpricedModel[];
  /** Cold read with nothing to show yet: the table skeleton. */
  loading: boolean;
  /** Any read in flight: the refresh button's spinner. */
  fetching: boolean;
  lastRunAt: number;
  streams: string[];
  streamsLoaded: boolean;
  stream: string;
}>();

const emit = defineEmits<{
  "update:stream": [stream: string];
  refresh: [];
}>();

const { t } = useI18nTyped();
const store = useStore();
const router = useRouter();

const orgIdentifier = computed(() => store.state.selectedOrganization?.identifier || "");
// The save invalidates the whole model-pricing scope, so the rows here and the
// price list both refetch after Keep or Mute with no wiring of their own.
const saveModelPricing = useMutation(() => saveModelPricingMutation(orgIdentifier.value));
const pendingModel = ref("");

const columns: OTableColumnDef<UnpricedModel>[] = [
  {
    id: "model",
    header: t("modelPricing.unpriced.colModel"),
    accessorKey: "model",
    sortable: true,
    minSize: 180,
    meta: { align: "left", flex: true },
  },
  {
    id: "priced_as",
    header: t("modelPricing.unpriced.colPricedAs"),
    accessorFn: (row) => row.matched?.name ?? "",
    sortable: true,
    minSize: 180,
    meta: { align: "left", flex: true },
  },
  {
    id: "tokens",
    header: t("modelPricing.unpriced.colTokens"),
    accessorKey: "tokens",
    sortable: true,
    size: 100,
    meta: { align: "right" },
  },
  {
    id: "cost",
    header: t("modelPricing.unpriced.colCost"),
    accessorKey: "cost",
    sortable: true,
    size: 120,
    meta: { align: "right" },
  },
  {
    id: "actions",
    header: t("modelPricing.unpriced.colActions"),
    isAction: true,
    pinned: "right",
    // Fits "Create price" next to "Keep <model name> prices" for a typical model name.
    size: 330,
    meta: { align: "right", actionCount: 2 },
  },
];

/** "research-agent · 1,870 spans": who sends the model, and how often. */
function seenBy(row: UnpricedModel): I18nText {
  const spans = t("modelPricing.unpriced.spans", { count: row.spans.toLocaleString() }, row.spans);
  return row.agents.length ? raw(`${row.agents.join(", ")} · ${spans}`) : spans;
}

function perMillion(pricePerToken: number | undefined): string {
  return `$${((pricePerToken ?? 0) * 1_000_000).toFixed(2)}`;
}

/** The input/output prices of the default tier the model is priced at today. */
function matchedPrices(row: UnpricedModel): I18nText | "" {
  const prices = row.matched ? defaultTier(row.matched.tiers)?.prices : undefined;
  if (!prices || (prices.input === undefined && prices.output === undefined)) return "";
  return t("modelPricing.unpriced.defaultTierPrices", {
    input: perMillion(prices.input),
    output: perMillion(prices.output),
  });
}

function createPrice(row: UnpricedModel) {
  router.push({
    name: "modelPricingEditor",
    query: {
      org_identifier: orgIdentifier.value,
      name: row.model,
      match_pattern: exactModelPattern(row.model),
    },
  });
}

function notifySaveError(e: unknown) {
  // 403s already raise the global no-access banner.
  if (isAxiosError(e) && e.response?.status === 403) return;
  const msg =
    (isAxiosError(e) && e.response?.data?.message) ||
    (e instanceof Error && e.message) ||
    t("modelPricing.errUnknown");
  toast({
    variant: "error",
    message: t("toastMessages.settings.message", {
      prefix: t("modelPricing.unpriced.errSave"),
      message: msg,
    }),
    timeout: 5000,
  });
}

async function keepPrices(row: UnpricedModel) {
  if (!row.matched) return;
  pendingModel.value = row.model;
  try {
    await saveModelPricing.mutateAsync({ data: buildKeepPricesPayload(row.model, row.matched) });
    toast({
      variant: "success",
      message: t("modelPricing.unpriced.keptNotif", { model: row.model, name: row.matched.name }),
    });
  } catch (e) {
    notifySaveError(e);
  } finally {
    pendingModel.value = "";
  }
}

const muteDialog = ref<{ show: boolean; model: string; message: I18nText }>({
  show: false,
  model: "",
  message: raw(""),
});

function confirmMute(row: UnpricedModel) {
  muteDialog.value = {
    show: true,
    model: row.model,
    message: t("modelPricing.unpriced.muteConfirmMessage", {
      model: row.model,
      name: buildMutePayload(row.model).name,
    }),
  };
}

async function mute() {
  const model = muteDialog.value.model;
  muteDialog.value.show = false;
  pendingModel.value = model;
  try {
    await saveModelPricing.mutateAsync({ data: buildMutePayload(model) });
    toast({ variant: "success", message: t("modelPricing.unpriced.mutedNotif", { model }) });
  } catch (e) {
    notifySaveError(e);
  } finally {
    pendingModel.value = "";
  }
}
</script>
