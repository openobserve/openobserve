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

<template>
  <div class="flex h-full flex-col p-0">
    <OPageLayout
      :title="t('settings.organizationManagement')"
      icon="lan"
      :subtitle="t('settings.organizationManagementPage.subtitle')"
      bleed
    >
      <div class="bg-card-glass-bg mt-2.5 min-h-0 flex-1 overflow-hidden">
        <OTable
          :frame="false"
          data-test="org-management-list-table"
          :data="visibleRows"
          :columns="columns"
          row-key="id"
          pagination="client"
          :page-size="20"
          :page-size-options="[5, 10, 20, 50, 100]"
          sorting="client"
          filter-mode="client"
          :default-columns="false"
          show-index
          :enable-column-resize="true"
          :persist-columns="true"
          table-id="org-management-list"
          :show-global-filter="false"
          :loading="loading"
        >
          <template #toolbar>
            <OSearchInput
              data-test="org-management-search-input"
              v-model="filterQuery"
              class="no-border o2-search-input w-64 max-md:w-full"
              :placeholder="t('settings.searchOrgs')"
            />
          </template>
          <template #toolbar-trailing>
            <OButton
              variant="outline"
              size="icon-sm"
              icon-left="refresh"
              :loading="loading"
              data-test="org-management-list-refresh-btn"
              @click="getData"
            >
              <OTooltip
                side="bottom"
                :content="t('common.refresh')"
                shortcut-id="orgManagementRefresh"
              />
            </OButton>
          </template>
          <template #empty>
            <OEmptyState
              size="hero"
              preset="no-organizations"
              :filtered="!!filterQuery"
              :hide-action="!filterQuery"
              @action="(id) => id === 'clear-filters' && (filterQuery = '')"
            />
          </template>
          <template #cell-ai_credits_used="{ row }">
            {{ formatCredits(row.credits_used) }}
          </template>
          <template #cell-ai_credits_total="{ row }">
            {{ formatCredits(row.credits_limit) }}
          </template>
          <template #cell-browser_steps_used="{ row }">
            {{ formatCredits(row.browser_steps_used) }}
          </template>
          <template #cell-browser_steps_total="{ row }">
            {{ formatCredits(row.browser_steps_limit) }}
          </template>
          <template #cell-protocol_steps_used="{ row }">
            {{ formatCredits(row.protocol_steps_used) }}
          </template>
          <template #cell-protocol_steps_total="{ row }">
            {{ formatCredits(row.protocol_steps_limit) }}
          </template>
          <template #cell-actions="{ row }">
            <div class="flex items-center justify-center gap-1">
              <OButton
                variant="ghost"
                size="icon-xs-circle"
                icon-left="paid"
                class="max-md:hidden"
                :aria-label="t('settings.organizationManagementPage.setUsageLimits')"
                data-test="org-management-set-usage-limits-btn"
                @click.stop="toggleUsageLimitsDialog(row)"
              >
                <OTooltip :content="t('settings.organizationManagementPage.setUsageLimits')" />
              </OButton>
              <OButton
                variant="ghost"
                size="icon-xs-circle"
                icon-left="event"
                class="max-md:hidden"
                data-test="otg-management-extend-trial-btn"
                @click.stop="toggleExtendTrialDialog(row)"
              >
                <OTooltip :content="t('settings.extendTrial')" />
              </OButton>
              <OButton
                v-if="row.billing_provider === '-'"
                variant="ghost"
                size="icon-xs-circle"
                icon-left="note-add"
                class="max-md:hidden"
                data-test="org-management-add-contract-btn"
                @click.stop="toggleContractDialog(row, 'create')"
              >
                <OTooltip :content="t('settings.organizationManagementPage.addContract')" />
              </OButton>
              <OButton
                v-if="row.billing_provider === 'no_op'"
                variant="ghost"
                size="icon-xs-circle"
                icon-left="event"
                class="max-md:hidden"
                data-test="org-management-extend-contract-btn"
                @click.stop="toggleContractDialog(row, 'extend')"
              >
                <OTooltip :content="t('settings.organizationManagementPage.extendContract')" />
              </OButton>
              <OButton
                v-if="row.billing_provider === 'no_op'"
                variant="ghost-destructive"
                size="icon-xs-circle"
                icon-left="block"
                class="max-md:hidden"
                data-test="org-management-revoke-contract-btn"
                @click.stop="confirmRevokeContract(row)"
              >
                <OTooltip :content="t('settings.organizationManagementPage.revoke')" />
              </OButton>
              <OButton
                v-if="!row.org_storage_enabled"
                variant="ghost"
                size="icon-xs-circle"
                icon-left="cloud-upload"
                class="max-md:hidden"
                data-test="org-management-storage-enable-btn"
                @click.stop="toggleOrgStorage(row)"
              >
                <OTooltip :content="t('settings.organizationManagementPage.enableStorage')" />
              </OButton>
              <OButton
                v-else
                variant="ghost"
                size="icon-xs-circle"
                icon-left="cloud-done"
                disabled
                class="text-status-positive"
                data-test="org-management-storage-enabled-btn"
              >
                <OTooltip :content="t('settings.organizationManagementPage.storageEnabled')" />
              </OButton>
              <ODropdown side="bottom" align="end">
                <template #trigger>
                  <OButton
                    icon-left="more-vert"
                    variant="ghost"
                    size="icon-xs-sq"
                    class="md:hidden"
                    data-test="org-management-row-more-actions"
                    @click.stop
                  />
                </template>
                <ODropdownItem
                  icon-left="paid"
                  class="md:hidden"
                  data-test="org-management-set-usage-limits-btn-menu"
                  @select="toggleUsageLimitsDialog(row)"
                >
                  <span>{{ t("settings.organizationManagementPage.setUsageLimits") }}</span>
                </ODropdownItem>
                <ODropdownItem
                  icon-left="event"
                  class="md:hidden"
                  data-test="otg-management-extend-trial-btn-menu"
                  @select="toggleExtendTrialDialog(row)"
                >
                  <span>{{ t("settings.extendTrial") }}</span>
                </ODropdownItem>
                <ODropdownItem
                  v-if="row.billing_provider === '-'"
                  icon-left="note-add"
                  class="md:hidden"
                  data-test="org-management-add-contract-btn-menu"
                  @select="toggleContractDialog(row, 'create')"
                >
                  <span>{{ t("settings.organizationManagementPage.addContract") }}</span>
                </ODropdownItem>
                <ODropdownItem
                  v-if="row.billing_provider === 'no_op'"
                  icon-left="event"
                  class="md:hidden"
                  data-test="org-management-extend-contract-btn-menu"
                  @select="toggleContractDialog(row, 'extend')"
                >
                  <span>{{ t("settings.organizationManagementPage.extendContract") }}</span>
                </ODropdownItem>
                <ODropdownItem
                  v-if="row.billing_provider === 'no_op'"
                  icon-left="block"
                  variant="destructive"
                  class="md:hidden"
                  data-test="org-management-revoke-contract-btn-menu"
                  @select="confirmRevokeContract(row)"
                >
                  <span>{{ t("settings.organizationManagementPage.revoke") }}</span>
                </ODropdownItem>
                <ODropdownItem
                  v-if="!row.org_storage_enabled"
                  icon-left="cloud-upload"
                  class="md:hidden"
                  data-test="org-management-storage-enable-btn-menu"
                  @select="toggleOrgStorage(row)"
                >
                  <span>{{ t("settings.organizationManagementPage.enableStorage") }}</span>
                </ODropdownItem>
              </ODropdown>
            </div>
          </template>
        </OTable>
      </div>
    </OPageLayout>

    <!-- Extend Trial Dialog -->
    <ODialog
      data-test="organization-management-extend-trial-dialog"
      v-model:open="extendTrialPrompt"
      size="sm"
      :title="
        t('settings.organizationManagementPage.extendTrialTitle', {
          name: extendTrialDataRow?.name,
        })
      "
      :sub-title="t('settings.organizationManagementPage.extendTrialSubtitle')"
      :secondary-button-label="t('common.cancel')"
      :primary-button-label="
        t('settings.organizationManagementPage.extendTrialByWeeks', { n: extendedTrial })
      "
      form-id="org-extend-trial-form"
      @click:secondary="extendTrialPrompt = false"
    >
      <OForm
        id="org-extend-trial-form"
        ref="extendTrialFormRef"
        :schema="extendTrialSchema"
        :default-values="extendTrialDefaults"
        @submit="onExtendTrialSubmit"
      >
        <div class="flex flex-col gap-3">
          <div class="font-bold">{{ t("settings.organizationManagementPage.weeks") }}</div>
          <div class="flex gap-1">
            <span
              v-for="page in 4"
              :key="page"
              @click="extendedTrial = page"
              :class="[
                'border-border-default cursor-pointer border px-2 py-1',
                extendedTrial === page
                  ? 'bg-button-primary text-button-primary-foreground border-button-primary'
                  : 'bg-surface-base text-text-body border-border-default',
              ]"
            >
              {{ page }}
            </span>
          </div>
        </div>
      </OForm>
    </ODialog>

    <!-- Usage Allowance Dialog — one tab per quota pool, so a new pool becomes a
         new tab rather than another glyph in the Actions column. -->
    <ODialog
      data-test="organization-management-usage-limits-dialog"
      v-model:open="usageLimitsPrompt"
      size="sm"
      :title="usageLimitsTitle"
      :sub-title="usageLimitsSubtitle"
      :secondary-button-label="t('common.cancel')"
      :primary-button-label="usageLimitsPrimaryLabel"
      :form-id="usageLimitsFormId"
      @click:secondary="usageLimitsPrompt = false"
    >
      <div class="flex flex-col gap-3">
        <OTabs v-model="usageLimitsTab" dense bordered data-test="org-management-usage-limits-tabs">
          <OTab
            name="ai_credits"
            :label="t('settings.organizationManagementPage.aiCreditsTab')"
            data-test="org-management-set-ai-credits-btn"
          />
          <OTab
            name="synthetics_browser_steps"
            :label="t('settings.organizationManagementPage.syntheticsBrowserStepsTab')"
            data-test="org-management-set-synthetics-browser-steps-btn"
          />
          <OTab
            name="synthetics_protocol_steps"
            :label="t('settings.organizationManagementPage.syntheticsProtocolStepsTab')"
            data-test="org-management-set-synthetics-protocol-steps-btn"
          />
        </OTabs>

        <!-- One OForm per pool (own schema, own submit). v-if, so only the active
             tab's form is mounted and the dialog's form-id has a single target. -->
        <OForm
          v-if="usageLimitsTab === 'ai_credits'"
          id="org-ai-credits-form"
          :schema="aiCreditsSchema"
          :default-values="aiCreditsFormDefaults"
          @submit="submitAiCredits"
        >
          <div class="flex flex-col gap-3">
            <OFormInput
              name="creditsLimit"
              type="number"
              data-test="ai-credits-limit-input"
              :label="t('settings.organizationManagementPage.totalAiCredits')"
              required
            />
            <div class="text-text-secondary text-xs">
              {{ t("settings.organizationManagementPage.currentlyUsedLabel") }}
              {{ formatCredits(usageLimitsRow?.credits_used) }}
              {{ t("settings.organizationManagementPage.credits") }}
            </div>
          </div>
        </OForm>

        <OForm
          v-else
          id="org-synthetics-steps-form"
          :schema="syntheticsStepsSchema"
          :default-values="syntheticsStepsFormDefaults"
          @submit="submitSyntheticsSteps"
        >
          <div class="flex flex-col gap-3">
            <OFormInput
              name="stepsLimit"
              type="number"
              data-test="synthetics-steps-limit-input"
              :label="
                isBrowserStepsTab
                  ? t('settings.organizationManagementPage.totalBrowserSteps')
                  : t('settings.organizationManagementPage.totalProtocolSteps')
              "
              required
            />
            <div class="text-text-secondary text-xs">
              {{ t("settings.organizationManagementPage.currentlyUsedLabel") }}
              {{ formatCredits(stepsUsed) }}
              {{ t("settings.organizationManagementPage.steps") }}
            </div>
          </div>
        </OForm>
      </div>
    </ODialog>

    <!-- External Contract Dialog -->
    <ODialog
      data-test="organization-management-contract-dialog"
      v-model:open="contractPrompt"
      size="sm"
      :title="
        contractMode === 'create'
          ? t('settings.organizationManagementPage.createContractTitle', {
              name: contractDataRow?.name,
            })
          : t('settings.organizationManagementPage.extendContractTitle', {
              name: contractDataRow?.name,
            })
      "
      :secondary-button-label="t('common.cancel')"
      :primary-button-label="
        contractMode === 'create'
          ? t('settings.organizationManagementPage.createContract')
          : t('settings.organizationManagementPage.extendContract')
      "
      form-id="org-contract-form"
      @click:secondary="contractPrompt = false"
    >
      <OForm
        id="org-contract-form"
        :schema="contractSchema"
        :default-values="contractDefaults()"
        @submit="submitContract"
      >
        <div class="mb-3">
          <OFormInput
            name="contractEndDate"
            type="date"
            data-test="contract-end-date-input"
            :label="
              contractMode === 'create'
                ? t('settings.organizationManagementPage.endDate')
                : t('settings.organizationManagementPage.newEndDate')
            "
            required
          />
        </div>
        <div
          v-if="contractMode === 'extend' && contractDataRow?.contract_end_date"
          class="text-text-secondary text-xs"
        >
          {{
            t("settings.organizationManagementPage.currentEndDate", {
              date: formatMicrosToDate(contractDataRow.contract_end_date),
            })
          }}
        </div>
      </OForm>
    </ODialog>
  </div>
</template>
<script lang="ts">
import { ref, onMounted, watch, defineComponent, computed } from "vue";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import { timestampToTimezoneDate, getImageURL } from "@/utils/zincutils";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import OrganizationServices from "@/services/organizations";
import OButton from "@/lib/core/Button/OButton.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import { COL } from "@/lib/core/Table/OTable.types";
import orgStorageService from "@/services/org_storage";
import { toast } from "@/lib/feedback/Toast/useToast";
import { useConfirmDialog } from "@/composables/useConfirmDialog";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import { useShortcuts } from "@/lib/vue-shortcut-manager";
import { isInputFocused } from "@/utils/keyboardShortcuts";
import {
  makeContractSchema,
  aiCreditsDefaults,
  makeAiCreditsSchema,
  contractDefaults,
  makeExtendTrialSchema,
  makeSyntheticsStepsSchema,
  syntheticsStepsDefaults,
  type AiCreditsForm,
  type SyntheticsStepsForm,
  type ContractForm,
  type ExtendTrialForm,
} from "./OrganizationManagement.schema";

/** Backend TrialQuotaPool keys — also the usage-allowance dialog's tab names. */
type QuotaPool = "ai_credits" | "synthetics_browser_steps" | "synthetics_protocol_steps";

export default defineComponent({
  name: "PageAlerts",
  components: {
    OPageLayout,
    OEmptyState,
    OButton,
    ODialog,
    ODropdown,
    ODropdownItem,
    OTooltip,
    OForm,
    OFormInput,
    OSearchInput,
    OTable,
    OTab,
    OTabs,
  },
  setup() {
    const store = useStore();
    const { t } = useI18nTyped();
    const router = useRouter();
    const { confirm } = useConfirmDialog();

    const extendTrialDataRow = ref();
    const extendedTrial = ref(1);
    const loading = ref(false);
    const extendTrialPrompt = ref(false);
    const tabledata = ref<any>([]);
    const resultTotal = ref(0);
    const filterQuery = ref("");

    // Usage allowance state — one dialog for every quota pool, the active tab
    // naming the pool. Tab names are the backend TrialQuotaPool keys.
    const usageLimitsPrompt = ref(false);
    const usageLimitsRow = ref<any>({});
    const usageLimitsTab = ref<QuotaPool>("ai_credits");
    const isAiCreditsTab = computed(() => usageLimitsTab.value === "ai_credits");
    // Browser and protocol are independent grants, so the step tabs differ only in
    // which pair of row fields they read and write.
    const isBrowserStepsTab = computed(() => usageLimitsTab.value === "synthetics_browser_steps");
    const stepFields = computed(() =>
      isBrowserStepsTab.value
        ? { used: "browser_steps_used", limit: "browser_steps_limit" }
        : { used: "protocol_steps_used", limit: "protocol_steps_limit" },
    );
    const stepsUsed = computed(() => usageLimitsRow.value?.[stepFields.value.used] ?? 0);
    const aiCreditsFormDefaults = computed(() =>
      aiCreditsDefaults(usageLimitsRow.value?.credits_limit ?? 0),
    );

    // Contract management state
    const contractPrompt = ref(false);
    const contractDataRow = ref<any>({});
    const contractMode = ref<"create" | "extend">("create");

    // ── Form schemas (Options-API: MUST be returned from setup() or :schema
    //    resolves to undefined and validation silently no-ops). ───────────────
    // The contract message is mode-aware; the dialog body remounts on open
    // (reka-ui), so a freshly-mounted <OForm> always reads the current schema.
    const contractSchema = computed(() => makeContractSchema(t, contractMode.value));
    const extendTrialSchema = makeExtendTrialSchema(t);
    const aiCreditsSchema = makeAiCreditsSchema(t);

    const syntheticsStepsFormDefaults = computed(() =>
      syntheticsStepsDefaults(usageLimitsRow.value?.[stepFields.value.limit] ?? 0),
    );
    const syntheticsStepsSchema = makeSyntheticsStepsSchema(t);

    // Title, subtitle, save label and submit target all follow the active tab,
    // so each pool keeps the exact wording it had as a standalone dialog.
    const usageLimitsTitle = computed(() =>
      isAiCreditsTab.value
        ? t("settings.setAiCreditsFor", { name: usageLimitsRow.value?.name })
        : t(
            isBrowserStepsTab.value
              ? "settings.setSyntheticsBrowserStepsFor"
              : "settings.setSyntheticsProtocolStepsFor",
            { name: usageLimitsRow.value?.name },
          ),
    );
    const usageLimitsSubtitle = computed(() =>
      isAiCreditsTab.value
        ? t("settings.organizationManagementPage.setAiCreditsSubtitle")
        : t("settings.organizationManagementPage.setSyntheticsStepsSubtitle"),
    );
    const usageLimitsPrimaryLabel = computed(() =>
      isAiCreditsTab.value
        ? t("settings.organizationManagementPage.saveCredits")
        : t("settings.organizationManagementPage.saveSteps"),
    );
    const usageLimitsFormId = computed(() =>
      isAiCreditsTab.value ? "org-ai-credits-form" : "org-synthetics-steps-form",
    );

    // Extend-trial week count is bridged from the pill grid into the form below.
    // Dynamic defaults (project the current pill value) → a typed computed.
    const extendTrialFormRef = ref<any>(null);
    const extendTrialDefaults = computed((): ExtendTrialForm => ({
      extendedTrial: extendedTrial.value,
    }));

    // Keep the form's copy of the bridged pill value in sync (the pill grid is a
    // custom control, not an <input>, so it is bridged via setFieldValue — the
    // documented sanctioned exception, as CreateDestinationForm does).
    watch(extendedTrial, (v) => {
      extendTrialFormRef.value?.form?.setFieldValue("extendedTrial", Number(v));
    });

    onMounted(() => {
      if (store.state.zoConfig.meta_org == store.state.selectedOrganization.identifier) {
        getData();
      } else {
        router.replace({
          name: "general",
          query: {
            org_identifier: store.state.selectedOrganization.identifier,
          },
        });
      }
    });

    const columns: OTableColumnDef[] = [
      {
        id: "name",
        header: t("settings.org_name"),
        accessorKey: "name",
        sortable: true,
        resizable: true,
        hideable: true,
        size: COL.name,
        minSize: 200,
        meta: { align: "left", flex: true },
      },
      {
        id: "identifier",
        header: t("settings.org_identifier"),
        accessorKey: "identifier",
        resizable: true,
        hideable: true,
        size: COL.name,
        meta: { align: "left" },
      },
      {
        id: "subscription_status",
        header: t("settings.subscription_status"),
        accessorKey: "plan",
        sortable: true,
        resizable: true,
        hideable: true,
        size: COL.status,
        meta: { align: "left" },
      },
      {
        id: "billing_provider",
        header: t("settings.organizationManagementPage.provider"),
        accessorKey: "billing_provider",
        sortable: true,
        resizable: true,
        hideable: true,
        size: COL.type,
        meta: { align: "left" },
      },
      {
        id: "ai_credits_used",
        header: t("settings.organizationManagementPage.aiCreditsUsed"),
        accessorKey: "credits_used",
        sortable: true,
        resizable: true,
        hideable: true,
        size: COL.count,
        meta: { align: "right" },
      },
      {
        id: "ai_credits_total",
        header: t("settings.organizationManagementPage.aiCreditsTotal"),
        accessorKey: "credits_limit",
        sortable: true,
        resizable: true,
        hideable: true,
        size: COL.count,
        meta: { align: "right" },
      },
      {
        id: "browser_steps_used",
        header: t("settings.organizationManagementPage.browserStepsUsed"),
        accessorKey: "browser_steps_used",
        sortable: true,
        resizable: true,
        hideable: true,
        size: COL.count,
        meta: { align: "right" },
      },
      {
        id: "browser_steps_total",
        header: t("settings.organizationManagementPage.browserStepsTotal"),
        accessorKey: "browser_steps_limit",
        sortable: true,
        resizable: true,
        hideable: true,
        size: COL.count,
        meta: { align: "right" },
      },
      {
        id: "protocol_steps_used",
        header: t("settings.organizationManagementPage.protocolStepsUsed"),
        accessorKey: "protocol_steps_used",
        sortable: true,
        resizable: true,
        hideable: true,
        size: COL.count,
        meta: { align: "right" },
      },
      {
        id: "protocol_steps_total",
        header: t("settings.organizationManagementPage.protocolStepsTotal"),
        accessorKey: "protocol_steps_limit",
        sortable: true,
        resizable: true,
        hideable: true,
        size: COL.count,
        meta: { align: "right" },
      },
      {
        id: "created_on",
        header: t("settings.created_on"),
        accessorKey: "created_at",
        sortable: true,
        resizable: true,
        hideable: true,
        size: COL.date,
        meta: { align: "left" },
      },
      {
        id: "trial_expiry",
        header: t("settings.trial_expiry"),
        accessorKey: "trial_expires_at",
        sortable: true,
        resizable: true,
        hideable: true,
        size: COL.date,
        meta: { align: "left" },
      },
      {
        id: "contract_end_date",
        header: t("settings.organizationManagementPage.contractEnd"),
        accessorKey: "contract_end_date_display",
        sortable: true,
        resizable: true,
        hideable: true,
        size: COL.date,
        meta: { align: "left" },
      },
      {
        id: "actions",
        header: t("settings.actions"),
        isAction: true,
        pinned: "right",
        size: 240,
        meta: { align: "center", actionCount: 4 },
      },
    ];

    const subscriptionPlans: any = {
      "0": t("settings.organizationManagementPage.planFree"),
      "1": t("settings.organizationManagementPage.planPayAsYouGo"),
      "2": t("settings.organizationManagementPage.planEnterprise"),
      "3": t("settings.organizationManagementPage.planExternalContract"),
    };

    const formatMicrosToDate = (micros: number): string => {
      if (!micros || micros <= 0) return "-";
      return timestampToTimezoneDate(micros, "UTC", "yyyy-MM-dd");
    };

    const formatCredits = (credits: number | undefined): string =>
      Number(credits ?? 0).toLocaleString();

    const dateToMicros = (dateStr: string): number => {
      // Treat the picked date as end-of-day UTC so selecting today is still in the future.
      const d = new Date(dateStr);
      d.setUTCHours(23, 59, 59, 999);
      return d.getTime() * 1000;
    };

    const getData = () => {
      loading.value = true;
      const dismiss = toast({
        variant: "loading",
        message: t("settings.organizationManagementPage.loadingData"),
        timeout: 0,
      });

      OrganizationServices.get_admin_org(store.state.selectedOrganization.identifier)
        .then((response) => {
          const data = [];
          const responseData = response.data.data;
          for (let i = 0; i < responseData.length; i++) {
            data.push({
              id: responseData[i].id,
              name: responseData[i].name,
              identifier: responseData[i].identifier,
              plan: subscriptionPlans[responseData[i].plan],
              billing_provider: responseData[i].billing_provider || "-",
              credits_used: Number(responseData[i].credits_used ?? 0),
              credits_limit: Number(responseData[i].credits_limit ?? 0),
              browser_steps_used: Number(responseData[i].browser_steps_used ?? 0),
              browser_steps_limit: Number(responseData[i].browser_steps_limit ?? 0),
              protocol_steps_used: Number(responseData[i].protocol_steps_used ?? 0),
              protocol_steps_limit: Number(responseData[i].protocol_steps_limit ?? 0),
              created_at: timestampToTimezoneDate(responseData[i].created_at, "UTC", "yyyy-MM-dd"),
              trial_expires_at: timestampToTimezoneDate(
                responseData[i].trial_expires_at,
                "UTC",
                "yyyy-MM-dd",
              ),
              contract_end_date: responseData[i].contract_end_date || 0,
              contract_end_date_display: formatMicrosToDate(responseData[i].contract_end_date),
              org_storage_enabled: responseData[i].org_storage_enabled || false,
            });
          }

          tabledata.value = data;
          resultTotal.value = responseData.length;
          loading.value = false;
          dismiss();
        })
        .catch((error) => {
          loading.value = false;
          dismiss();
          if (error.status != 403) {
            toast({
              variant: "error",
              message:
                error.response?.data?.message ||
                t("settings.organizationManagementPage.fetchDataError"),
              timeout: 5000,
            });
          }
        });
    };

    const toggleExtendTrialDialog = (row: any) => {
      extendTrialPrompt.value = true;
      extendTrialDataRow.value = row;
    };

    const toggleUsageLimitsDialog = (row: any, pool: QuotaPool = "ai_credits") => {
      usageLimitsRow.value = row;
      usageLimitsTab.value = pool;
      usageLimitsPrompt.value = true;
    };

    // The two pools differ only in which field the form carries, which row
    // fields the response updates, and the copy. Everything else — the loading
    // toast, the request, the close, the error path — is the same, so it lives
    // here once.
    const submitUsageLimit = async (
      pool: QuotaPool,
      limit: number,
      apply: (used: number, granted: number) => void,
      copy: { pending: I18nText; success: I18nText; failure: I18nText },
    ) => {
      loading.value = true;
      const dismiss = toast({ variant: "loading", message: copy.pending, timeout: 0 });

      try {
        const response = await OrganizationServices.set_quota_usage_limit(
          store.state.selectedOrganization.identifier,
          pool,
          { org_id: usageLimitsRow.value.identifier, limit },
        );
        apply(response.data.used, response.data.limit);
        usageLimitsPrompt.value = false;
        toast({ variant: "success", message: copy.success });
      } catch (error: any) {
        toast({
          variant: "error",
          message: error.response?.data?.message || copy.failure,
          timeout: 5000,
        });
      } finally {
        loading.value = false;
        dismiss();
      }
    };

    const submitAiCredits = (value: AiCreditsForm) =>
      submitUsageLimit(
        "ai_credits",
        Number(value.creditsLimit),
        (used, granted) => {
          usageLimitsRow.value.credits_used = used;
          usageLimitsRow.value.credits_limit = granted;
        },
        {
          pending: t("toastMessages.settings.updatingAiCredits"),
          success: t("toastMessages.settings.aiCreditsUpdatedSuccessfully"),
          failure: t("settings.updateAiCreditsFailed"),
        },
      );

    const submitSyntheticsSteps = (value: SyntheticsStepsForm) =>
      submitUsageLimit(
        usageLimitsTab.value,
        Number(value.stepsLimit),
        (used, granted) => {
          // Written through the active tab's field pair: applying one grant's
          // response to the other would overstate it and strand the real one.
          usageLimitsRow.value[stepFields.value.used] = used;
          usageLimitsRow.value[stepFields.value.limit] = granted;
        },
        {
          pending: t("toastMessages.settings.updatingSyntheticsSteps"),
          success: t("toastMessages.settings.syntheticsStepsUpdatedSuccessfully"),
          failure: t("settings.updateSyntheticsStepsFailed"),
        },
      );

    const getTimestampInMicroseconds = (weeks: number) =>
      (Date.now() + weeks * 7 * 24 * 60 * 60 * 1000) * 1000;

    const toggleContractDialog = (row: any, mode: "create" | "extend") => {
      contractDataRow.value = row;
      contractMode.value = mode;
      // No contractEndDate reset needed: the dialog body remounts on open and
      // <OForm :default-values> re-seeds the field to blank.
      contractPrompt.value = true;
    };

    // @submit handler — fires only once the schema passes (contractEndDate
    // required), so the old toast required-guards are gone. Awaited by OForm, so
    // the footer Save spinner spans the POST automatically.
    const submitContract = async (value: ContractForm) => {
      const metaOrg = store.state.selectedOrganization.identifier;

      if (contractMode.value === "create") {
        const payload = {
          org_id: contractDataRow.value.identifier,
          end_date: dateToMicros(value.contractEndDate),
        };

        loading.value = true;
        const dismiss = toast({
          variant: "loading",
          message: t("settings.organizationManagementPage.creatingContract"),
          timeout: 0,
        });
        return OrganizationServices.create_external_contract(metaOrg, payload)
          .then(() => {
            toast({
              variant: "success",
              message: t("settings.organizationManagementPage.contractCreatedSuccess"),
            });
            contractPrompt.value = false;
            getData();
            loading.value = false;
            dismiss();
          })
          .catch((error) => {
            loading.value = false;
            dismiss();
            toast({
              variant: "error",
              message:
                error.response?.data?.message ||
                t("settings.organizationManagementPage.createContractError"),
              timeout: 5000,
            });
          });
      } else {
        const payload = {
          org_id: contractDataRow.value.identifier,
          new_end_date: dateToMicros(value.contractEndDate),
        };

        loading.value = true;
        const dismiss = toast({
          variant: "loading",
          message: t("settings.organizationManagementPage.extendingContract"),
          timeout: 0,
        });
        return OrganizationServices.extend_external_contract(metaOrg, payload)
          .then(() => {
            toast({
              variant: "success",
              message: t("settings.organizationManagementPage.contractExtendedSuccess"),
            });
            contractPrompt.value = false;
            getData();
            loading.value = false;
            dismiss();
          })
          .catch((error) => {
            loading.value = false;
            dismiss();
            toast({
              variant: "error",
              message:
                error.response?.data?.message ||
                t("settings.organizationManagementPage.extendContractError"),
              timeout: 5000,
            });
          });
      }
    };

    const confirmRevokeContract = async (row: any) => {
      const ok = await confirm({
        title: t("settings.organizationManagementPage.revokeConfirmTitle"),
        message: t("settings.organizationManagementPage.revokeConfirmMessage", { name: row.name }),
      });
      if (ok) {
        const metaOrg = store.state.selectedOrganization.identifier;
        loading.value = true;
        const dismiss = toast({
          variant: "loading",
          message: t("settings.organizationManagementPage.revokingContract"),
          timeout: 0,
        });
        OrganizationServices.revoke_external_contract(metaOrg, row.identifier)
          .then(() => {
            toast({
              variant: "success",
              message: t("settings.organizationManagementPage.contractRevokedSuccess"),
            });
            getData();
            loading.value = false;
            dismiss();
          })
          .catch((error) => {
            loading.value = false;
            dismiss();
            toast({
              variant: "error",
              message:
                error.response?.data?.message ||
                t("settings.organizationManagementPage.revokeContractError"),
              timeout: 5000,
            });
          });
      }
    };

    const toggleOrgStorage = async (row: any) => {
      const ok = await confirm({
        title: t("settings.organizationManagementPage.enableByobTitle"),
        message: t("settings.organizationManagementPage.enableByobMessage", { name: row.name }),
      });
      if (ok) {
        loading.value = true;
        const dismiss = toast({
          variant: "loading",
          message: t("settings.organizationManagementPage.enablingStorage"),
          timeout: 0,
        });
        orgStorageService
          .enable(row.identifier)
          .then(() => {
            toast({
              variant: "success",
              message: t("settings.organizationManagementPage.storageEnabledSuccess"),
            });
            getData();
            loading.value = false;
            dismiss();
          })
          .catch((error) => {
            loading.value = false;
            dismiss();
            toast({
              variant: "error",
              message:
                error.response?.data?.message ||
                t("settings.organizationManagementPage.enableStorageError"),
              timeout: 5000,
            });
          });
      }
    };

    const updateTrialPeriod = (org_id: string, extended_week: number) => {
      const payload = {
        new_end_date: getTimestampInMicroseconds(extended_week),
        org_id,
      };

      loading.value = true;
      const dismiss = toast({
        variant: "loading",
        message: t("settings.organizationManagementPage.processingTrialExtension"),
        timeout: 0,
      });
      return OrganizationServices.extend_trial_period(
        store.state.selectedOrganization.identifier,
        payload,
      )
        .then((response) => {
          if (response.data) {
            toast({
              variant: "success",
              message: t("settings.organizationManagementPage.trialExtendedSuccess"),
            });
            extendTrialPrompt.value = false;
            extendTrialDataRow.value = {};
            extendedTrial.value = 1;
            getData();
          }
          loading.value = false;
          dismiss();
        })
        .catch((error) => {
          loading.value = false;
          dismiss();
          if (error.status != 403) {
            toast({
              variant: "error",
              message:
                error.response?.data?.message ||
                t("settings.organizationManagementPage.extendTrialError"),
              timeout: 5000,
            });
          }
        });
    };

    // @submit handler for the extend-trial dialog — awaited by OForm so the
    // footer Save spinner spans the POST. The week count comes from the
    // schema-validated form value (bridged from the pill grid).
    const onExtendTrialSubmit = async (value: ExtendTrialForm) => {
      return updateTrialPeriod(extendTrialDataRow.value?.identifier, Number(value.extendedTrial));
    };

    const filterData = (rows: string | any[], terms: string) => {
      var filtered = [];
      terms = terms.toLowerCase();
      for (var i = 0; i < rows.length; i++) {
        if (
          rows[i]["name"].toLowerCase().includes(terms) ||
          rows[i]["identifier"].toLowerCase().includes(terms) ||
          rows[i]["plan"].toLowerCase().includes(terms)
        ) {
          filtered.push(rows[i]);
        }
      }
      return filtered;
    };

    const visibleRows = computed(() => {
      if (!filterQuery.value) return tabledata.value || [];
      return filterData(tabledata.value || [], filterQuery.value);
    });

    useShortcuts([
      {
        id: "orgManagementRefresh",
        handler: () => {
          if (!isInputFocused()) getData();
        },
      },
    ]);

    return {
      t,
      columns,
      getImageURL,
      resultTotal,
      tabledata,
      loading,
      extendedTrial,
      extendTrialPrompt,
      toggleExtendTrialDialog,
      extendTrialDataRow,
      usageLimitsPrompt,
      usageLimitsRow,
      usageLimitsTab,
      usageLimitsTitle,
      usageLimitsSubtitle,
      usageLimitsPrimaryLabel,
      usageLimitsFormId,
      toggleUsageLimitsDialog,
      aiCreditsFormDefaults,
      aiCreditsSchema,
      submitAiCredits,
      isBrowserStepsTab,
      stepsUsed,
      syntheticsStepsFormDefaults,
      syntheticsStepsSchema,
      submitSyntheticsSteps,
      updateTrialPeriod,
      getData,
      getTimestampInMicroseconds,
      contractPrompt,
      contractDataRow,
      contractMode,
      toggleContractDialog,
      submitContract,
      confirmRevokeContract,
      toggleOrgStorage,
      formatMicrosToDate,
      formatCredits,
      filterQuery,
      filterData,
      visibleRows,
      store,
      // Form wiring (Options-API: schemas/defaults MUST be returned so :schema
      // resolves and validation runs).
      contractSchema,
      contractDefaults,
      extendTrialSchema,
      extendTrialDefaults,
      extendTrialFormRef,
      onExtendTrialSubmit,
    };
  },
});
</script>
