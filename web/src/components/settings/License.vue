<template>
  <!-- Page gutter is owned by the Settings shell's ConstrainedPage. -->
  <div>
    <LicensePeriod @renew="redirectToGetLicense()"></LicensePeriod>

    <div v-if="loading" class="flex flex-col items-center justify-center p-3">
      <OSpinner size="md" />
      <div class="mt-3">{{ t("about.loading_license_info") }}</div>
    </div>
    <div v-else class="grid grid-cols-1 items-start gap-4 pb-4">
      <div class="col-span-1 min-h-0">
        <div v-if="licenseData.license === null || !licenseData.license">
          <OFormSection variant="plain" class="mb-4" :title="t('about.no_license_found')">
            <div class="pb-2">
              <div class="text-sm">
                {{ t("about.installation_id") }}:
                <strong>{{ licenseData.installation_id || raw("N/A") }}</strong>
              </div>
              <div
                class="mt-2 text-sm"
                v-html="DOMPurify.sanitize(t('about.contact_admin_license'))"
              ></div>
              <OButton
                data-test="no-license-get-license-btn"
                variant="outline"
                size="sm-action"
                class="mt-3"
                @click="redirectToGetLicense()"
              >
                {{ t("about.get_license") }}
              </OButton>
            </div>
          </OFormSection>

          <OFormSection variant="plain" :title="t('about.enter_license_key')">
            <div class="pt-2 pb-2">
              <OForm ref="noLicenseForm" :form="noLicenseDraft" v-slot="{ isSubmitting }">
                <OFormTextarea
                  data-test="no-license-key-input"
                  name="licenseKey"
                  :disabled="updating"
                  :rows="8"
                  :placeholder="t('about.paste_license_placeholder')"
                  class="min-h-50"
                />
                <OBanner
                  v-if="isLicenseKeyAutoFilled"
                  variant="success"
                  icon="check-circle"
                  class="mt-2 mb-3"
                  :content="t('about.license_auto_filled')"
                />
                <LicenseKeyCheck :result="result" :refusal="refusal" />
                <OBanner
                  v-if="checkError"
                  variant="error-soft"
                  icon="cancel"
                  class="my-3"
                  data-test="license-key-check-error"
                  >{{ t("about.key_check_failed", { message: checkError }) }}</OBanner
                >
                <OButton
                  data-test="check-no-license-btn"
                  variant="outline"
                  size="sm-action"
                  class="me-2 mt-2"
                  :loading="checking"
                  :disabled="isSubmitting || updating"
                  @click="checkLicense(false)"
                  >{{ t("about.check_license_key") }}</OButton
                >
                <OButton
                  data-test="no-license-update-btn"
                  :variant="noLicenseKey.trim() ? 'primary' : 'outline'"
                  size="sm-action"
                  class="mt-2"
                  type="submit"
                  :loading="isSubmitting"
                  :disabled="checking || updating"
                >
                  {{ t("about.update_license") }}
                </OButton>
              </OForm>
            </div>
          </OFormSection>
        </div>

        <div v-else>
          <LicenseStatusCard
            v-if="licenseData.license && licenseData.decision"
            :decision="licenseData.decision"
            :base="licenseData.base"
            :waivers="licenseData.waivers"
            :env-key-active="!!licenseData.env_key_active"
            :env-key-in-use="licenseData.env_key_in_use"
            :evaluated-at="licenseData.evaluated_at"
            :rev-hwm-warning="licenseData.rev_hwm_warning"
            :can-update-license="licenseData.can_update_license === true"
            @add-license-key="showUpdateFormAndFocus"
            @boundary="refetchAtBoundary"
          />
          <LicenseOnlineRefreshCard
            v-if="licenseData.refresh"
            :refresh="licenseData.refresh"
            :license-expires-at="licenseData.license.expires_at"
            :can-update="licenseData.can_update_license === true"
            :env-key-active="!!licenseData.env_key_active"
            :is-root="!!licenseData.refresh.key_id || !!licenseData.refresh.stored_key"
            @add-license-key="showUpdateFormAndFocus"
            @refreshed="reloadLicenseData"
          />
          <OFormSection variant="plain" class="mb-4" :title="t('about.license_info')">
            <template v-if="licenseData.can_update_license" #actions>
              <OButton
                variant="outline"
                size="sm-action"
                @click="redirectToGetLicense()"
                data-test="request-new-license-btn"
              >
                {{ t("about.request_new_license") }}
              </OButton>
              <OButton
                v-if="!licenseData.refresh && licenseData.can_update_license === true"
                data-test="refresh-license-limits-btn"
                variant="outline"
                size="sm-action"
                :loading="refreshingLimits"
                @click="refreshLimitsOnOldNode"
              >
                {{ t("about.refresh_license_limits") }}
              </OButton>
              <OButton
                data-test="add-license-key-btn"
                :variant="showUpdateForm ? 'outline' : 'primary'"
                size="sm-action"
                @click="showUpdateFormAndFocus"
              >
                {{ t("about.add_new_license_key") }}
              </OButton>
            </template>
            <OSettingRow control-at="end" :label="t('about.installation_id')">
              <span class="text-sm break-all">{{ licenseData.installation_id }}</span>
            </OSettingRow>
            <OSettingRow control-at="end" :label="t('about.license_id')">
              <span class="text-sm break-all">{{ licenseData.license.license_id }}</span>
            </OSettingRow>
            <OSettingRow control-at="end" :label="t('about.status_lbl')">
              <OBadge :variant="licenseData?.expired ? 'error' : 'success'">
                {{ licenseData?.expired ? t("about.expired_lbl") : t("about.active_lbl") }}
              </OBadge>
            </OSettingRow>
            <OSettingRow control-at="end" :label="t('about.create_at_lbl')">
              <span class="text-sm">{{ formatDate(licenseData.license.created_at) }}</span>
            </OSettingRow>
            <OSettingRow control-at="end" :label="t('about.expires_at_lbl')">
              <span class="text-sm">{{ formatDate(licenseData.license.expires_at) }}</span>
            </OSettingRow>
            <OSettingRow control-at="end" :label="t('about.company')">
              <span class="text-sm wrap-break-word">{{ licenseData.license.company }}</span>
            </OSettingRow>
            <OSettingRow v-if="licenseData.key" control-at="end" :label="t('about.license_key')">
              <div class="flex min-w-0 flex-wrap items-center gap-2">
                <span class="min-w-0 text-sm break-all">{{ getMaskedLicenseKey() }}</span>
                <OButton
                  :aria-label="t('common.reveal')"
                  variant="ghost"
                  size="icon"
                  class="shrink-0"
                  data-test="show-license-key-btn"
                  @click="showLicenseKeyModal = true"
                >
                  <OIcon name="visibility" size="xs" />
                </OButton>
              </div>
            </OSettingRow>
            <OSettingRow
              v-if="licenseData.license.contact_name"
              control-at="end"
              :label="t('about.contact_name')"
            >
              <span class="text-sm wrap-break-word">{{ licenseData.license.contact_name }}</span>
            </OSettingRow>
            <OSettingRow
              v-if="licenseData.license.contact_email"
              control-at="end"
              :label="t('about.contact_email')"
            >
              <span class="text-sm break-all">{{ licenseData.license.contact_email }}</span>
            </OSettingRow>
            <OSettingRow
              v-if="licenseData.license.environment_type"
              control-at="end"
              :label="t('about.environment_type')"
            >
              <span class="text-sm capitalize">{{ licenseData.license.environment_type }}</span>
            </OSettingRow>
          </OFormSection>

          <OFormSection
            variant="plain"
            class="text-sm"
            :title="t('about.features')"
            data-test="settings-license-features"
          >
            <LicenseFeatures
              :license="licenseData.license"
              :evaluated-at="licenseData.evaluated_at"
              @request-access="redirectToGetLicense()"
            />
          </OFormSection>

          <LicenseWaiversCard
            :waivers="licenseData.waivers"
            :can-update="licenseData.can_update_license === true"
            @boundary="refetchAtBoundary"
          />

          <OFormSection
            v-show="showUpdateForm"
            variant="plain"
            class="mt-4"
            :title="t('about.update_license_key')"
          >
            <div class="pt-2 pb-2">
              <OForm ref="updateLicenseForm" :form="updateLicenseDraft" v-slot="{ isSubmitting }">
                <OFormTextarea
                  data-test="update-license-key-input"
                  name="licenseKey"
                  :disabled="updating"
                  :rows="6"
                  :placeholder="t('about.paste_new_license_placeholder')"
                  class="min-h-37.5"
                />
                <OBanner
                  v-if="isLicenseKeyAutoFilled"
                  variant="success"
                  icon="check-circle"
                  class="mt-2 mb-3"
                  :content="t('about.license_auto_filled')"
                />
                <LicenseKeyCheck :result="result" :refusal="refusal" />
                <OBanner
                  v-if="checkError"
                  variant="error-soft"
                  icon="cancel"
                  class="my-3"
                  data-test="license-key-check-error"
                  >{{ t("about.key_check_failed", { message: checkError }) }}</OBanner
                >
                <div class="flex flex-wrap gap-2">
                  <OButton
                    data-test="cancel-update-license-btn"
                    variant="outline"
                    size="sm-action"
                    type="button"
                    :disabled="isSubmitting"
                    @click="
                      showUpdateForm = false;
                      resetLicenseDrafts();
                    "
                  >
                    {{ t("common.cancel") }}
                  </OButton>
                  <OButton
                    data-test="check-update-license-btn"
                    variant="outline"
                    size="sm-action"
                    :loading="checking"
                    :disabled="isSubmitting || updating"
                    @click="checkLicense(true)"
                    >{{ t("about.check_license_key") }}</OButton
                  >
                  <OButton
                    data-test="confirm-update-license-btn"
                    :variant="updateLicenseKey.trim() ? 'primary' : 'outline'"
                    size="sm-action"
                    type="submit"
                    :loading="isSubmitting"
                    :disabled="checking || updating"
                  >
                    {{ t("about.update_license") }}
                  </OButton>
                </div>
              </OForm>
            </div>
          </OFormSection>
        </div>
      </div>

      <div class="col-span-1 self-start">
        <OFormSection variant="plain" :title="t('about.usage_information')">
          <div class="flex flex-col gap-3 pt-2 pb-2">
            <div class="text-sm" data-test="license-usage-summary">
              <!-- Line 1: License Info -->
              <div class="mb-2 flex items-center gap-2">
                <OIcon name="info" size="sm" class="flex-shrink-0" />
                <span v-if="isIngestionUnlimited">
                  {{ t("about.license_allows_unlimited_ingestion") }}
                </span>
                <span
                  v-else-if="!licenseData.license"
                  v-html="
                    DOMPurify.sanitize(
                      t('about.no_license_ingestion_limit', { limit: ingestionLimitText }),
                    )
                  "
                ></span>
                <span
                  v-else
                  v-html="
                    DOMPurify.sanitize(
                      t('about.license_allows_ingestion', { limit: ingestionLimitText }),
                    )
                  "
                ></span>
              </div>

              <!-- Line 2: Exceeded Status -->
              <div v-if="!isIngestionUnlimited" class="flex items-center gap-2">
                <OIcon
                  v-if="licenseData?.ingestion_exceeded && pausedOverLimit"
                  name="warning"
                  size="sm"
                  class="text-status-error-text flex-shrink-0"
                />
                <OIcon
                  v-else-if="licenseData?.ingestion_exceeded && licenseData?.ingestion_exceeded > 0"
                  name="warning"
                  size="sm"
                  class="text-status-warning-text flex-shrink-0"
                />
                <OIcon
                  v-else
                  name="check-circle"
                  size="sm"
                  class="text-status-positive flex-shrink-0"
                />
                <span>
                  <span
                    v-if="licenseData?.ingestion_exceeded && licenseData?.ingestion_exceeded > 0"
                  >
                    <span
                      v-html="
                        DOMPurify.sanitize(
                          t(
                            'about.limit_exceeded_days',
                            {
                              colorClass:
                                licenseData?.ingestion_exceeded > 30
                                  ? 'text-status-error-text'
                                  : 'text-status-warning-text',
                              days: licenseData?.ingestion_exceeded,
                            },
                            licenseData?.ingestion_exceeded,
                          ),
                        )
                      "
                    ></span
                    ><span
                      v-if="pausedOverLimit"
                      class="inline-flex items-center font-semibold text-inherit"
                      v-html="
                        DOMPurify.sanitize(
                          t(
                            'about.limit_exceeded_warning',
                            { max: limitBreachAllowedCount },
                            limitBreachAllowedCount,
                          ),
                        )
                      "
                    ></span
                    ><span
                      v-else
                      class="ms-1 text-xs italic opacity-80"
                      v-html="
                        DOMPurify.sanitize(
                          t(
                            'about.limit_exceeded_info',
                            {
                              remaining: Math.max(
                                0,
                                limitBreachAllowedCount - licenseData?.ingestion_exceeded,
                              ),
                              max: limitBreachAllowedCount,
                            },
                            Math.max(0, limitBreachAllowedCount - licenseData?.ingestion_exceeded),
                          ),
                        )
                      "
                    ></span
                    >.
                  </span>
                  <span v-else>
                    {{
                      t("about.no_limit_exceedances", {
                        max: limitBreachAllowedCount,
                      })
                    }}
                  </span>
                </span>
              </div>
            </div>

            <!-- Chart -->
            <div v-if="usageDashboardData">
              <div class="chart-wrapper relative">
                <div class="usage-chart-container mx-auto w-full overflow-visible p-0">
                  <RenderDashboardCharts
                    :key="dashboardRenderKey"
                    :dashboardData="usageDashboardData"
                    :currentTimeObj="currentTimeObj"
                    :viewOnly="true"
                    :allowAlertCreation="false"
                    searchType="dashboards"
                  />
                </div>
                <div
                  v-if="isIngestionUnlimited"
                  class="text-text-secondary mt-1 text-center text-xs"
                  style="font-size: var(--text-3xs)"
                >
                  {{ t("about.usage_shows_zero_unlimited") }}
                </div>
              </div>
            </div>
          </div>
        </OFormSection>
      </div>
    </div>

    <!-- License Key Modal -->
    <ODialog
      data-test="license-key-modal-dialog"
      v-model:open="showLicenseKeyModal"
      persistent
      size="md"
      :title="t('about.license_key')"
      :secondary-button-label="t('common.cancel')"
      :primary-button-label="t('about.copy_key')"
      :primary-button-disabled="!licenseData.key"
      @click:secondary="showLicenseKeyModal = false"
      @click:primary="copyLicenseKey"
    >
      <div class="mb-3 text-sm">
        {{ t("about.your_complete_license_key") }}
      </div>
      <OTextarea
        data-test="modal-license-key-display"
        v-model="licenseData.key"
        readonly
        :rows="8"
        style="font-family: var(--font-mono); font-size: var(--text-xs)"
      />
    </ODialog>
  </div>
</template>

<script lang="ts">
import { useMutation } from "@tanstack/vue-query";
import { useOForm } from "@/lib/forms/Form/useOForm";
import {
  LICENSE_BOUNDARY_DEBOUNCE_MS,
  LICENSE_BOUNDARY_RETRIES,
  LICENSE_BOUNDARY_RETRY_MS,
  isRevRefusal,
  isKeyCheckResult,
  type KeyCheckResult,
  type RevRefusal,
} from "@/utils/licenseWaivers";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import LicenseKeyCheck from "./LicenseKeyCheck.vue";
import {
  licenseQuery,
  checkLicenseMutation,
  updateLicenseMutation,
} from "@/services/license_server.queries";
import { queryClient } from "@/composables/query/queryClient";
import {
  defineComponent,
  ref,
  onMounted,
  onBeforeUnmount,
  computed,
  watch,
  defineAsyncComponent,
} from "vue";
import { useI18nTyped, raw } from "@/types/i18n";
import { useStore } from "vuex";
import DOMPurify from "dompurify";
import LicensePeriod from "@/enterprise/components/billings/LicensePeriod.vue";
import LicenseOnlineRefreshCard from "./LicenseOnlineRefreshCard.vue";
import LicenseStatusCard from "./LicenseStatusCard.vue";
import LicenseWaiversCard from "./LicenseWaiversCard.vue";
import LicenseFeatures from "./LicenseFeatures.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OTextarea from "@/lib/forms/Input/OTextarea.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormTextarea from "@/lib/forms/Input/OFormTextarea.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import OFormSection from "@/lib/core/FormSection/OFormSection.vue";
import OSettingRow from "@/lib/core/SettingRow/OSettingRow.vue";
import { useConfirmDialog } from "@/composables/useConfirmDialog";
import { copyToClipboard } from "@/utils/clipboard";
import { useLicenseRefresh } from "@/composables/useLicenseRefresh";
import { refreshMessage } from "@/utils/licenseRefresh";
import { useFeatureNames } from "@/composables/useFeatureLock";
import { makeLicenseSchema, type LicenseForm } from "./License.schema";
import {
  FREE_LIMIT_GB,
  licenseKeyLosses,
  licenseRequestUrl,
  type LicenseKeyLosses,
} from "@/utils/featureGate";
import { b64DecodeUnicode } from "@/utils/formatters";
import { formatLicenseDay } from "@/utils/licenseWaivers";

const RenderDashboardCharts = defineAsyncComponent(
  () => import("@/views/Dashboards/RenderDashboardCharts.vue"),
);

export default defineComponent({
  name: "License",
  components: {
    LicensePeriod,
    LicenseStatusCard,
    LicenseOnlineRefreshCard,
    LicenseWaiversCard,
    LicenseFeatures,
    LicenseKeyCheck,
    OBanner,
    RenderDashboardCharts,
    OButton,
    ODialog,
    OSpinner,
    OIcon,
    OBadge,
    OTextarea,
    OForm,
    OFormTextarea,
    OFormSection,
    OSettingRow,
  },
  setup() {
    const { t, locale } = useI18nTyped();
    const { confirm } = useConfirmDialog();
    const { featureNames } = useFeatureNames();
    const loading = ref(false);
    const licenseData = ref<any>({});
    const licenseKey = ref("");
    const result = ref<KeyCheckResult | null>(null);
    const refusal = ref<RevRefusal | null>(null);
    const checkError = ref("");
    const checking = ref(false);
    const updating = ref(false);
    const checkMutation = useMutation(checkLicenseMutation());
    const updateMutation = useMutation(updateLicenseMutation());
    let draftVersion = 0;
    const clearKeyCheck = () => {
      draftVersion++;
      result.value = null;
      refusal.value = null;
      checkError.value = "";
    };
    const showUpdateForm = ref(false);
    const showLicenseKeyModal = ref(false);
    const isLicenseKeyAutoFilled = ref(false);
    const store = useStore();
    const { scheduleReload, refreshLicenseLimits } = useLicenseRefresh();
    const refreshingLimits = ref(false);
    const usageDashboardData = ref<any>(null);
    const dashboardRenderKey = ref(0);

    const licenseSchema = makeLicenseSchema(t);
    const noLicenseForm = ref(null);
    const updateLicenseForm = ref(null);
    const noLicenseDraft = useOForm<LicenseForm>({
      defaultValues: { licenseKey: "" },
      schema: licenseSchema,
      validateOn: "leave",
      onSubmit: (value) => updateLicense(value),
    });
    const updateLicenseDraft = useOForm<LicenseForm>({
      defaultValues: { licenseKey: "" },
      schema: licenseSchema,
      validateOn: "leave",
      onSubmit: (value) => updateLicense(value),
    });
    const noLicenseKey = noLicenseDraft.useStore((state) => state.values.licenseKey);
    const updateLicenseKey = updateLicenseDraft.useStore((state) => state.values.licenseKey);
    const licenseDefaults = computed((): LicenseForm => ({ licenseKey: licenseKey.value }));
    const resetLicenseDrafts = () => {
      clearKeyCheck();
      licenseKey.value = "";
      noLicenseDraft.reset({ licenseKey: "" });
      updateLicenseDraft.reset({ licenseKey: "" });
    };
    watch([noLicenseKey, updateLicenseKey], clearKeyCheck, { flush: "sync" });
    watch(
      licenseKey,
      (value) => {
        clearKeyCheck();
        noLicenseDraft.reset({ licenseKey: value });
        updateLicenseDraft.reset({ licenseKey: value });
      },
      { flush: "sync" },
    );

    const checkLicense = async (hasLicense: boolean) => {
      if (checking.value || updating.value) return;
      const form = hasLicense ? updateLicenseDraft : noLicenseDraft;
      const key = form.state.values.licenseKey.trim();
      if (!key) {
        await form.handleSubmit();
        return;
      }
      clearKeyCheck();
      const version = draftVersion;
      checking.value = true;
      try {
        const response = await checkMutation.mutateAsync(key);
        if (version !== draftVersion) return;
        if (!isKeyCheckResult(response.data)) throw new Error(t("about.key_check_malformed"));
        result.value = response.data;
      } catch (error) {
        if (version !== draftVersion) return;
        const failure = error as {
          response?: { status?: number; data?: { message?: string } };
          message?: string;
        };
        checkError.value =
          failure.response?.status === 403
            ? t("about.key_check_forbidden")
            : failure.response?.data?.message ||
              failure.message ||
              t("settings.licensePage.unexpectedError");
      } finally {
        checking.value = false;
      }
    };

    // Only the first load may swap the page for the spinner; later reloads would unmount the form.
    const loadLicenseData = async ({ background = false, quiet = false } = {}) => {
      try {
        if (!background) loading.value = true;
        licenseData.value = await queryClient.fetchQuery(licenseQuery());
        if (!background) checkAndAutoFillLicenseFromUrl();
        return true;
      } catch (error) {
        console.error("Error loading license data:", error);
        if (!quiet) {
          toast({
            variant: "error",
            message: t("about.failed_to_load_license_info"),
          });
        }
        return false;
      } finally {
        if (!background) loading.value = false;
      }
    };

    const reloadLicenseData = () => loadLicenseData({ background: true });

    // a node older than the online refresh sends no refresh status, so its card never renders
    const refreshLimitsOnOldNode = async () => {
      if (refreshingLimits.value) return;
      refreshingLimits.value = true;
      try {
        const outcome = await refreshLicenseLimits(async () => {
          await reloadLicenseData();
        });
        const message = refreshMessage(outcome.body, t, outcome.status);
        toast({ variant: message.variant, message: message.text });
        await reloadLicenseData();
      } finally {
        refreshingLimits.value = false;
      }
    };

    let boundaryRefetch: ReturnType<typeof setTimeout> | undefined;
    let boundaryUs = 0;
    let boundaryRetries = 0;
    let boundaryChain = 0;
    let boundaryErrorShown = false;
    let unmounted = false;
    const clearBoundaryRefetch = () => {
      if (boundaryRefetch !== undefined) clearTimeout(boundaryRefetch);
      boundaryRefetch = undefined;
    };
    const scheduleBoundaryRefetch = (chain: number, delayMs: number) => {
      clearBoundaryRefetch();
      boundaryRefetch = setTimeout(() => refetchAfterBoundary(chain), delayMs);
    };
    // the server re-evaluates on its own tick, so a decision from before the boundary is fetched again
    const refetchAfterBoundary = async (chain: number) => {
      boundaryRefetch = undefined;
      const loaded = await loadLicenseData({ background: true, quiet: boundaryErrorShown });
      if (!loaded && chain === boundaryChain) boundaryErrorShown = true;
      // a boundary that arrived during the fetch started a newer chain, which owns the timer
      if (unmounted || chain !== boundaryChain) return;
      const evaluatedAt = Number(licenseData.value?.evaluated_at ?? 0);
      if (!(evaluatedAt > 0 && evaluatedAt < boundaryUs)) return;
      if (boundaryRetries >= LICENSE_BOUNDARY_RETRIES) return;
      boundaryRetries++;
      scheduleBoundaryRefetch(chain, LICENSE_BOUNDARY_RETRY_MS);
    };
    const refetchAtBoundary = (atUs: number) => {
      boundaryUs = Math.max(boundaryUs, atUs);
      boundaryRetries = 0;
      boundaryChain++;
      boundaryErrorShown = false;
      scheduleBoundaryRefetch(boundaryChain, LICENSE_BOUNDARY_DEBOUNCE_MS);
    };
    onBeforeUnmount(() => {
      unmounted = true;
      clearBoundaryRefetch();
    });

    // The settle reload already refetched the licence query, so reuse it instead of a second request.
    const adoptRefetchedLicense = () => {
      const data = queryClient.getQueryData(licenseQuery().queryKey);
      if (data) licenseData.value = data as typeof licenseData.value;
    };

    // The payload is unverified, so a key that cannot be read skips the dialog and the server answers it.
    const pastedKeyLosses = (key: string) => {
      try {
        return licenseKeyLosses(
          licenseData.value.license,
          JSON.parse(b64DecodeUnicode(key.split(".")[1]) || ""),
          store.state.zoConfig.features ?? {},
          Date.now() * 1000,
        );
      } catch {
        return null;
      }
    };

    const limitLabel = (gb: number | null) =>
      gb === null ? t("about.license_status_unlimited") : t("about.license_limit_per_day", { gb });

    const lossLines = ({ expiredAt, lost, limit, expiry }: LicenseKeyLosses) => {
      const day = (us: number) => formatLicenseDay(us, locale.value);
      const lines = [];
      if (expiredAt) lines.push(t("about.license_downgrade_expired", { date: day(expiredAt) }));
      if (lost.length) {
        lines.push(t("about.license_downgrade_lose", { names: featureNames(lost) }));
      }
      if (limit) {
        lines.push(
          t("about.license_downgrade_limit", {
            old: limitLabel(limit.from),
            new: limitLabel(limit.to),
          }),
        );
      }
      if (expiry) {
        lines.push(
          t("about.license_downgrade_expiry", { old: day(expiry.from), new: day(expiry.to) }),
        );
      }
      return lines;
    };

    const updateLicense = async (value?: LicenseForm) => {
      if (checking.value || updating.value) return;
      clearKeyCheck();
      const version = draftVersion;
      updating.value = true;
      const key = (value?.licenseKey ?? licenseKey.value ?? "").trim();
      try {
        const losses = pastedKeyLosses(key);
        if (
          losses &&
          !(await confirm({
            title: t("about.license_downgrade_title"),
            message: t("about.license_downgrade_intro"),
            lines: lossLines(losses),
            linesDataTest: "license-key-losses",
            confirmLabel: t("about.yes_update_license"),
            cancelLabel: t("about.no_keep_current"),
            confirmVariant: "destructive",
            focusCancel: true,
          }))
        ) {
          return;
        }
        await updateMutation.mutateAsync(key);
        toast({
          variant: "success",
          message: t("about.license_updated_success"),
        });
        resetLicenseDrafts();
        isLicenseKeyAutoFilled.value = false;
        showUpdateForm.value = false;

        // Clear URL parameters after successful license update
        const url = new URL(window.location.href);
        url.searchParams.delete("installation_id");
        url.searchParams.delete("license_key");
        window.history.replaceState({}, document.title, url.toString());

        await reloadLicenseData();
        scheduleReload(adoptRefetchedLicense);
      } catch (error) {
        const e = error as { response?: { status?: number; data?: { message?: string } } };
        if (version !== draftVersion) return;
        if (e.response?.status === 409 && isRevRefusal(e.response.data)) {
          refusal.value = e.response.data;
          return;
        }
        console.error("Error updating license:", error);
        toast({
          variant: "error",
          message: raw(
            t("about.failed_to_update_license") +
              " : " +
              (e?.response?.data?.message || t("settings.licensePage.unexpectedError")),
          ),
        });
      } finally {
        updating.value = false;
      }
    };

    const showUpdateFormAndFocus = () => {
      showUpdateForm.value = true;
      setTimeout(() => {
        // Match the stable data-test hook, not the placeholder: the placeholder
        // is translated, so a text selector silently found nothing (and never
        // focused) in every non-English locale. OTextarea renders the native
        // element with `${data-test}-field`.
        const textarea = document.querySelector(
          'textarea[data-test="update-license-key-input-field"]',
        ) as HTMLTextAreaElement;
        if (textarea) {
          textarea.focus();
        }
      }, 100);
    };

    const maskKey = (key: string) => {
      if (!key) return "";
      if (key.length <= 10) return key; // If key is too short, show as is
      const start = key.substring(0, 5);
      const end = key.substring(key.length - 5);
      const masked = "*".repeat(18);
      return `${start}${masked}${end}`;
    };

    const getMaskedLicenseKey = () => {
      if (!licenseData.value.key) return "";
      return maskKey(licenseData.value.key);
    };

    const copyLicenseKey = async () => {
      if (!licenseData.value.key) return;
      const success = await copyToClipboard(licenseData.value.key, t, {
        successMessage: t("about.license_key_copied"),
        errorMessage: t("about.failed_to_copy_license"),
      });
      if (success) {
        showLicenseKeyModal.value = false;
      }
    };

    const redirectToGetLicense = () => {
      const url = licenseRequestUrl(
        store.state.zoConfig,
        licenseData.value,
        window.location.origin,
      );
      window.open(url, "_blank");
    };

    const checkAndAutoFillLicenseFromUrl = async () => {
      const urlParams = new URLSearchParams(window.location.search);
      const urlInstallationId = urlParams.get("installation_id");
      const urlLicenseKey = urlParams.get("license_key");

      if (urlInstallationId && urlLicenseKey && licenseData.value.installation_id) {
        if (urlInstallationId === licenseData.value.installation_id) {
          // Check if license is already active
          if (licenseData.value.license && licenseData.value.license.active) {
            // License is active, show dialog asking if they want to update
            const ok = await confirm({
              title: t("about.license_already_active_title"),
              message: t("about.license_already_active_msg"),
              confirmLabel: t("about.yes_update_license"),
              cancelLabel: t("about.no_keep_current"),
            });
            if (ok) {
              // User wants to update, fill the key and show update form
              licenseKey.value = urlLicenseKey;
              isLicenseKeyAutoFilled.value = true;
              showUpdateFormAndFocus();
            } else {
              // User doesn't want to update, clear URL parameters
              const url = new URL(window.location.href);
              url.searchParams.delete("installation_id");
              url.searchParams.delete("license_key");
              window.history.replaceState({}, document.title, url.toString());
            }
          } else {
            // No active license, proceed with normal auto-fill
            licenseKey.value = urlLicenseKey;
            isLicenseKeyAutoFilled.value = true;
          }
        }
      }
    };

    const formatDate = (timestamp: number) =>
      t("about.online_refreshed_at", {
        date: new Intl.DateTimeFormat(locale.value, {
          timeZone: "UTC",
          year: "numeric",
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          hourCycle: "h23",
        }).format(new Date(timestamp / 1000)),
      });

    const isIngestionUnlimited = computed(() => {
      return (
        licenseData.value.license?.limits?.Ingestion?.typ === "Unlimited" &&
        !licenseData.value.expired
      );
    });

    // For license version >= 2, use limit_breach_allowed_count from the license data.
    // For version < 2 or when version is absent (v1), fall back to 3.
    const limitBreachAllowedCount = computed(() => {
      const decided = licenseData.value.decision?.allowed_days;
      if (decided != null && licenseData.value.evaluated_at !== 0) return decided;
      const version = licenseData.value.license?.version;
      if (version !== undefined && version !== null && version >= 2) {
        return licenseData.value.license?.limit_breach_allowed_count ?? 3;
      }
      return 3;
    });

    // Only an evaluated decision names its blocks; a synthesised one (evaluated_at 0) has the counters.
    const pausedOverLimit = computed(() => {
      const decision = licenseData.value.decision;
      if (decision?.search_allowed) return false;
      if (decision && licenseData.value.evaluated_at !== 0) {
        return (decision.blocks ?? []).includes("usage_over_limit");
      }
      return licenseData.value.ingestion_exceeded > limitBreachAllowedCount.value;
    });

    const ingestionUsagePercent = computed(() => {
      if (isIngestionUnlimited.value) {
        return 0;
      }
      return Math.ceil(licenseData.value.ingestion_used * 100) / 100 || 0;
    });

    const getIngestionUsageColor = () => {
      const percent = ingestionUsagePercent.value;
      if (percent < 60) return "green";
      if (percent < 90) return "orange";
      return "red";
    };

    // Current time object for dashboard (calendar start date to current date)
    // Similar to TelemetryCorrelationDashboard, we pass microsecond timestamps to Date constructor
    const currentTimeObj = computed(() => {
      const now = new Date();
      const calendarStartDate = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);

      // Convert to microseconds (16 digits) and pass to Date constructor
      const startTimeMicros = calendarStartDate.getTime() * 1000;
      const endTimeMicros = now.getTime() * 1000;

      return {
        __global: {
          start_time: new Date(startTimeMicros),
          end_time: new Date(endTimeMicros),
        },
      };
    });

    // Get ingestion limit value for threshold
    const ingestionLimitGB = computed(() => {
      if (isIngestionUnlimited.value) {
        return null; // No limit for unlimited plans
      }
      const licensed = licenseData.value?.license?.limits?.Ingestion?.value;
      return (!licenseData.value?.expired && licensed) || FREE_LIMIT_GB;
    });

    const ingestionLimitText = computed(() =>
      ingestionLimitGB.value == null ? "" : ingestionLimitGB.value.toLocaleString(locale.value),
    );

    // Generate usage dashboard data
    const generateUsageDashboard = () => {
      const ingestionLimit = ingestionLimitGB.value;

      // Build the threshold configuration - using correct format for mark_line
      const thresholds: any[] = [];
      if (ingestionLimit !== null && ingestionLimit > 0) {
        // Add critical threshold at 100% of limit
        thresholds.push({
          type: "yAxis",
          name: t("settings.limitExceeded"),
          // sum(size) is MB, and the megabytes unit counts 1024 MB to the GB.
          value: ingestionLimit * 1024,
          label_formatter: `{b}:${ingestionLimit} GB`,
          color: "#FF0000", // Red
          lineStyle: "solid",
          width: 2,
        });
      }

      const query = `SELECT histogram(_timestamp, '1 day') AS x_axis_1, sum(size) AS y_axis_1 FROM "usage" WHERE event = 'Ingestion' GROUP BY x_axis_1 ORDER BY x_axis_1`;

      // Get timestamps in microseconds (16 digits)
      const now = new Date();
      const calendarStartDate = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
      const startTimeMicros = calendarStartDate.getTime() * 1000;
      const endTimeMicros = now.getTime() * 1000;

      const dashboard = {
        version: 8,
        dashboardId: "",
        title: t("about.usage_chart_title"),
        description: "",
        role: "",
        owner: "",
        created: new Date().toISOString(),
        tabs: [
          {
            tabId: "default",
            name: "Default",
            panels: [
              {
                id: "Panel_ID_License_Usage",
                type: "bar",
                title: t("about.usage_chart_title"),
                description: "",
                config: {
                  show_legends: false,
                  legends_position: null,
                  unit: "megabytes",
                  decimals: 0,
                  line_thickness: 1.5,
                  step_value: "0",
                  top_results_others: false,
                  axis_border_show: true,
                  label_option: {
                    rotate: 0,
                  },
                  axis_label_rotate: 0,
                  show_symbol: false,
                  line_interpolation: "smooth",
                  legend_width: {
                    unit: "px",
                  },
                  legend_height: {
                    unit: "px",
                  },
                  base_map: {
                    type: "osm",
                  },
                  map_type: {
                    type: "world",
                  },
                  map_view: {
                    zoom: 1,
                    lat: 0,
                    lng: 0,
                  },
                  map_symbol_style: {
                    size: "by Value",
                    size_by_value: {
                      min: 1,
                      max: 100,
                    },
                    size_fixed: 2,
                  },
                  drilldown: [],
                  mark_line: thresholds,
                  override_config: [],
                  connect_nulls: false,
                  no_value_replacement: "",
                  wrap_table_cells: false,
                  table_transpose: false,
                  table_dynamic_columns: false,
                  mappings: [],
                  color: {
                    mode: "palette-classic-by-series",
                    fixedColor: ["#FF0000"],
                    seriesBy: "last",
                    colorBySeries: [],
                  },
                  trellis: {
                    layout: null,
                    num_of_columns: 1,
                    group_by_y_axis: false,
                  },
                  show_gridlines: true,
                  aggregation: "last",
                  lat_label: "latitude",
                  lon_label: "longitude",
                  weight_label: "weight",
                  name_label: "name",
                  table_aggregations: ["last"],
                  promql_table_mode: "single",
                  visible_columns: [],
                  hidden_columns: [],
                  sticky_columns: [],
                },
                queryType: "sql",
                queries: [
                  {
                    query: query,
                    vrlFunctionQuery: "",
                    customQuery: true,
                    fields: {
                      stream: "usage",
                      stream_type: "logs",
                      x: [
                        {
                          label: "",
                          alias: "x_axis_1",
                          column: "x_axis_1",
                          color: null,
                          isDerived: false,
                        },
                      ],
                      y: [
                        {
                          label: "",
                          alias: "y_axis_1",
                          column: "y_axis_1",
                          isDerived: false,
                        },
                      ],
                      z: [],
                      breakdown: [],
                      filter: {
                        filterType: "group",
                        logicalOperator: "AND",
                        conditions: [],
                      },
                    },
                    config: {
                      promql_legend: "",
                      layer_type: "scatter",
                      weight_fixed: 1,
                      limit: 0,
                      min: 0,
                      max: 100,
                      time_shift: [],
                    },
                    joins: [],
                  },
                ],
                layout: {
                  x: 0,
                  y: 0,
                  w: 192,
                  h: 16,
                  i: 1,
                },
                htmlContent: "",
                markdownContent: "",
                customChartContent: "",
              },
            ],
          },
        ],
        variables: {
          list: [],
          showDynamicFilters: false,
        },
        defaultDatetimeDuration: {
          type: "absolute",
          startTime: startTimeMicros,
          endTime: endTimeMicros,
        },
      };

      usageDashboardData.value = dashboard;
      dashboardRenderKey.value++;
    };

    // The first build runs before the license loads, so the line has to follow the loaded limit.
    watch(ingestionLimitGB, generateUsageDashboard);

    onMounted(() => {
      loadLicenseData();
      generateUsageDashboard();
    });

    return {
      t,
      raw,
      store,
      loading,
      reloadLicenseData,
      refreshingLimits,
      refreshLimitsOnOldNode,
      refetchAtBoundary,
      licenseData,
      licenseKey,
      showUpdateForm,
      showLicenseKeyModal,
      updateLicense,
      checkLicense,
      clearKeyCheck,
      resetLicenseDrafts,
      result,
      refusal,
      checkError,
      checking,
      updating,
      noLicenseDraft,
      updateLicenseDraft,
      noLicenseKey,
      updateLicenseKey,
      // Form wiring (Options-API: schema/defaults MUST be returned so :schema
      // resolves and validation runs).
      licenseSchema,
      licenseDefaults,
      noLicenseForm,
      updateLicenseForm,
      formatDate,
      isIngestionUnlimited,
      ingestionUsagePercent,
      getIngestionUsageColor,
      showUpdateFormAndFocus,
      maskKey,
      getMaskedLicenseKey,
      copyLicenseKey,
      redirectToGetLicense,
      isLicenseKeyAutoFilled,
      checkAndAutoFillLicenseFromUrl,
      usageDashboardData,
      dashboardRenderKey,
      currentTimeObj,
      ingestionLimitGB,
      ingestionLimitText,
      generateUsageDashboard,
      limitBreachAllowedCount,
      pausedOverLimit,
      DOMPurify,
    };
  },
});
</script>

<style scoped>
/* keep(lib-override:gridstack): zero the gridstack item border inside the usage chart */
.usage-chart-container :deep(.grid-stack-item-content) {
  border: 0 !important;
}
</style>
