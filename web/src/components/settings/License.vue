<template>
  <!-- Page gutter is owned by the Settings shell's ConstrainedPage. -->
  <div>
    <LicensePeriod @updateLicense="showUpdateFormAndFocus"></LicensePeriod>

    <div v-if="loading" class="p-3 flex flex-col items-center justify-center">
      <OSpinner size="md" />
      <div class="mt-3">{{ t("about.loading_license_info") }}</div>
    </div>
    <div
      v-else
      class="grid grid-cols-1 gap-4 items-start pb-4"
    >
      <div class="col-span-1 min-h-0">
        <div v-if="licenseData.license === null || !licenseData.license">
          <OCard class="mb-4 border border-solid border-[var(--o2-border-color)]">
            <OCardSection role="body">
              <div class="text-xl font-semibold">{{ t("about.no_license_found") }}</div>
              <div class="mt-2 text-sm">
                {{ t("about.installation_id") }}:
                <strong>{{ licenseData.installation_id || "N/A" }}</strong>
              </div>
              <div
                class="mt-3 text-sm"
                v-html="DOMPurify.sanitize(t('about.contact_admin_license'))"
              ></div>
              <OButton
                data-test="no-license-get-license-btn"
                variant="primary"
                size="sm-action"
                class="ml-2 mt-2"
                @click="redirectToGetLicense"
              >
                {{ t("about.get_license") }}
              </OButton>
            </OCardSection>
          </OCard>

          <OCard class="border border-solid border-[var(--o2-border-color)]">
            <OCardSection role="body">
              <div class="text-base font-medium mb-3">
                {{ t("about.enter_license_key") }}
              </div>
              <OForm
                ref="noLicenseForm"
                :schema="licenseSchema"
                :default-values="licenseDefaults"
                @submit="updateLicense"
                v-slot="{ isSubmitting }"
              >
                <OFormTextarea
                  data-test="no-license-key-input"
                  name="licenseKey"
                  :rows="8"
                  :placeholder="t('about.paste_license_placeholder')"
                  style="min-height: 200px"
                />
                <div v-if="isLicenseKeyAutoFilled" class="mt-2 mb-3">
                  <div class="flex items-center py-3 px-4 bg-[rgba(34,197,94,0.08)] border border-solid border-[rgba(34,197,94,0.2)] rounded-lg [backdrop-filter:blur(10px)] transition-all duration-200 dark:bg-[rgba(34,197,94,0.15)] dark:border-[rgba(34,197,94,0.3)] dark:shadow-[0_2px_8px_rgba(0,0,0,0.2)]">
                    <OIcon
                      name="check-circle"
                      class="text-green-600 mr-2"
                      size="md"
                    />
                    <span class="text-sm">{{
                      t("about.license_auto_filled")
                    }}</span>
                  </div>
                </div>
                <OButton
                  data-test="no-license-update-btn"
                  variant="primary"
                  size="sm-action"
                  class="mt-2"
                  type="submit"
                  :loading="isSubmitting"
                >
                  {{ t("about.update_license") }}
                </OButton>
              </OForm>
            </OCardSection>
          </OCard>
        </div>

        <div v-else>
          <OCard class="border border-solid border-[var(--o2-border-color)]">
            <OCardSection role="body">
              <div class="text-xl font-semibold mb-3">{{ t("about.license_info") }}</div>
              <table class="w-full border-collapse border border-solid border-[var(--color-table-header-border)]">
                <tbody>
                  <tr class="border-b border-solid border-[var(--color-table-row-divider)]">
                    <td class="font-bold px-3 py-2 leading-[1.2] border-r border-solid border-[var(--color-table-row-divider)]">
                      {{ t("about.installation_id") }}
                    </td>
                    <td class="px-3 py-2 leading-[1.2]">{{ licenseData.installation_id }}</td>
                  </tr>
                  <tr class="border-b border-solid border-[var(--color-table-row-divider)]">
                    <td class="font-bold px-3 py-2 leading-[1.2] border-r border-solid border-[var(--color-table-row-divider)]">
                      {{ t("about.license_id") }}
                    </td>
                    <td class="px-3 py-2 leading-[1.2]">{{ licenseData.license.license_id }}</td>
                  </tr>
                  <tr class="border-b border-solid border-[var(--color-table-row-divider)]">
                    <td class="font-bold px-3 py-2 leading-[1.2] border-r border-solid border-[var(--color-table-row-divider)]">
                      {{ t("about.status_lbl") }}
                    </td>
                    <td class="px-3 py-2 leading-[1.2]">
                      <OBadge :variant="licenseData?.expired ? 'error' : 'success'">
                        {{
                          licenseData?.expired
                            ? t("about.expired_lbl")
                            : t("about.active_lbl")
                        }}
                      </OBadge>
                    </td>
                  </tr>
                  <tr class="border-b border-solid border-[var(--color-table-row-divider)]">
                    <td class="font-bold px-3 py-2 leading-[1.2] border-r border-solid border-[var(--color-table-row-divider)]">
                      {{ t("about.create_at_lbl") }}
                    </td>
                    <td class="px-3 py-2 leading-[1.2]">{{ formatDate(licenseData.license.created_at) }}</td>
                  </tr>
                  <tr class="border-b border-solid border-[var(--color-table-row-divider)]">
                    <td class="font-bold px-3 py-2 leading-[1.2] border-r border-solid border-[var(--color-table-row-divider)]">
                      {{ t("about.expires_at_lbl") }}
                    </td>
                    <td class="px-3 py-2 leading-[1.2]">{{ formatDate(licenseData.license.expires_at) }}</td>
                  </tr>
                  <tr class="border-b border-solid border-[var(--color-table-row-divider)]">
                    <td class="font-bold px-3 py-2 leading-[1.2] border-r border-solid border-[var(--color-table-row-divider)]">{{ t("about.company") }}</td>
                    <td class="px-3 py-2 leading-[1.2]">{{ licenseData.license.company }}</td>
                  </tr>
                  <tr v-if="licenseData.key" class="border-b border-solid border-[var(--color-table-row-divider)]">
                    <td class="font-bold px-3 py-2 leading-[1.2] border-r border-solid border-[var(--color-table-row-divider)]">
                      {{ t("about.license_key") }}
                    </td>
                    <td class="px-3 py-2 leading-[1.2]">
                      <div class="flex items-center gap-2">
                        <span>{{ getMaskedLicenseKey() }}</span>
                        <OButton
                          variant="ghost"
                          size="icon"
                          class="ml-2"
                          data-test="show-license-key-btn"
                          @click="showLicenseKeyModal = true"
                        >
                          <OIcon name="visibility" size="xs" />
                        </OButton>
                      </div>
                    </td>
                  </tr>
                  <tr v-if="licenseData.license.contact_name" class="border-b border-solid border-[var(--color-table-row-divider)]">
                    <td class="font-bold px-3 py-2 leading-[1.2] border-r border-solid border-[var(--color-table-row-divider)]">
                      {{ t("about.contact_name") }}
                    </td>
                    <td class="px-3 py-2 leading-[1.2]">{{ licenseData.license.contact_name }}</td>
                  </tr>
                  <tr v-if="licenseData.license.contact_email" class="border-b border-solid border-[var(--color-table-row-divider)]">
                    <td class="font-bold px-3 py-2 leading-[1.2] border-r border-solid border-[var(--color-table-row-divider)]">
                      {{ t("about.contact_email") }}
                    </td>
                    <td class="px-3 py-2 leading-[1.2]">{{ licenseData.license.contact_email }}</td>
                  </tr>
                  <tr v-if="licenseData.license.environment_type">
                    <td class="font-bold px-3 py-2 leading-[1.2] border-r border-solid border-[var(--color-table-row-divider)]">
                      {{ t("about.environment_type") }}
                    </td>
                    <td class="px-3 py-2 leading-[1.2]">{{ licenseData.license.environment_type }}</td>
                  </tr>
                </tbody>
              </table>
              <div class="mt-3 flex gap-3">
                <OButton
                  variant="primary"
                  size="sm-action"
                  @click="redirectToGetLicense"
                  data-test="request-new-license-btn"
                >
                  {{ t("about.request_new_license") }}
                </OButton>
                <OButton
                  data-test="add-license-key-btn"
                  variant="primary"
                  size="sm-action"
                  @click="showUpdateFormAndFocus"
                >
                  {{ t("about.add_new_license_key") }}
                </OButton>
                <OButton
                  data-test="refresh-license-limits-btn"
                  variant="primary"
                  size="sm-action"
                  v-if="licenseData.license != null"
                  @click="triggerLimitRefresh"
                >
                  {{ t("about.refresh_license_limits") }}
                </OButton>
              </div>
            </OCardSection>
          </OCard>

          <OCard v-show="showUpdateForm" class="mt-4 border border-solid border-[var(--o2-border-color)]">
            <OCardSection role="body">
              <div class="text-base font-medium mb-2">
                {{ t("about.update_license_key") }}
              </div>
              <OForm
                ref="updateLicenseForm"
                :schema="licenseSchema"
                :default-values="licenseDefaults"
                @submit="updateLicense"
                v-slot="{ isSubmitting }"
              >
                <OFormTextarea
                  data-test="update-license-key-input"
                  name="licenseKey"
                  :rows="6"
                  :placeholder="t('about.paste_new_license_placeholder')"
                  style="min-height: 150px"
                />
                <div v-if="isLicenseKeyAutoFilled" class="mt-2 mb-3">
                  <div class="flex items-center py-3 px-4 bg-[rgba(34,197,94,0.08)] border border-solid border-[rgba(34,197,94,0.2)] rounded-lg [backdrop-filter:blur(10px)] transition-all duration-200 dark:bg-[rgba(34,197,94,0.15)] dark:border-[rgba(34,197,94,0.3)] dark:shadow-[0_2px_8px_rgba(0,0,0,0.2)]">
                    <OIcon
                      name="check-circle"
                      class="text-green-600 mr-2"
                      size="md"
                    />
                    <span class="text-sm">{{
                      t("about.license_auto_filled")
                    }}</span>
                  </div>
                </div>
                <div class="flex gap-2">
                  <OButton
                    data-test="cancel-update-license-btn"
                    variant="outline"
                    size="sm-action"
                    type="button"
                    :disabled="isSubmitting"
                    @click="
                      showUpdateForm = false;
                      licenseKey = '';
                    "
                  >
                    {{ t("common.cancel") }}
                  </OButton>
                  <OButton
                    data-test="confirm-update-license-btn"
                    variant="primary"
                    size="sm-action"
                    type="submit"
                    :loading="isSubmitting"
                  >
                    {{ t("about.update_license") }}
                  </OButton>
                </div>
              </OForm>
            </OCardSection>
          </OCard>
        </div>
      </div>

      <div class="col-span-1 self-start">
        <OCard class="futuristic-card border border-solid" :class="store.state.theme === 'dark' ? 'bg-[linear-gradient(135deg,rgba(99,102,241,0.08)_0%,rgba(168,85,247,0.08)_100%)] border-[rgba(99,102,241,0.25)]' : 'border-[var(--o2-border-color)]'">
          <OCardSection class="p-3">
            <div>
              <div :class="store.state.theme === 'dark' ? 'bg-[radial-gradient(ellipse_at_center,rgba(99,102,241,0.15)_0%,transparent_70%)]' : ''"></div>
              <div class="text-xl font-semibold relative z-10">
                {{ t("about.usage_information") }}
              </div>
            </div>

            <div class="flex flex-col gap-2 mt-3">
              <!-- Summary Message -->
              <div class="ingestion-summary-compact border border-solid rounded-lg py-3 px-[14px] [backdrop-filter:blur(10px)] relative overflow-hidden" :class="store.state.theme === 'dark' ? 'bg-[linear-gradient(135deg,rgba(99,102,241,0.1)_0%,rgba(168,85,247,0.1)_100%)] border-[rgba(99,102,241,0.3)]' : 'border-[rgba(99,102,241,0.2)]'">
                <div class="summary-text-compact text-sm leading-[1.6] text-inherit text-[13px]">
                  <!-- Line 1: License Info -->
                  <div class="flex items-center gap-2 mb-2">
                    <OIcon name="info" size="sm" class="flex-shrink-0" />
                    <span v-if="isIngestionUnlimited">
                      {{ t("about.license_allows_unlimited_ingestion") }}
                    </span>
                    <span
                      v-else
                      v-html="
                        DOMPurify.sanitize(
                          t('about.license_allows_ingestion', {
                            limit:
                              !licenseData?.expired &&
                              licenseData?.license?.limits?.Ingestion?.value
                                ? licenseData?.license?.limits?.Ingestion?.value
                                : '50',
                          }),
                        )
                      "
                    ></span>
                  </div>

                  <!-- Line 2: Exceeded Status -->
                  <div
                    v-if="!isIngestionUnlimited"
                    class="flex items-center gap-2"
                  >
                    <OIcon
                      v-if="
                        licenseData?.ingestion_exceeded &&
                        licenseData?.ingestion_exceeded >
                          limitBreachAllowedCount
                      "
                      name="warning"
                      size="sm"
                      class="text-red-500 flex-shrink-0"
                    />
                    <OIcon
                      v-else-if="
                        licenseData?.ingestion_exceeded &&
                        licenseData?.ingestion_exceeded > 0
                      "
                      name="check-circle"
                      size="sm"
                      class="text-amber-500 flex-shrink-0"
                    />
                    <OIcon
                      v-else
                      name="check-circle"
                      size="sm"
                      class="text-green-500 flex-shrink-0"
                    />
                    <span>
                      <span
                        v-if="
                          licenseData?.ingestion_exceeded &&
                          licenseData?.ingestion_exceeded > 0
                        "
                      >
                        <span
                          v-html="
                            DOMPurify.sanitize(
                              t('about.limit_exceeded_days', {
                                colorClass:
                                  licenseData?.ingestion_exceeded > 30
                                    ? 'text-red-500'
                                    : 'text-amber-500',
                                days: licenseData?.ingestion_exceeded,
                                plural:
                                  licenseData?.ingestion_exceeded > 1
                                    ? 's'
                                    : '',
                              }),
                            )
                          "
                        ></span
                        ><span
                          v-if="
                            licenseData?.ingestion_exceeded >
                            limitBreachAllowedCount
                          "
                          class="inline-flex items-center text-inherit font-semibold"
                          v-html="
                            DOMPurify.sanitize(
                              t('about.limit_exceeded_warning', {
                                max: limitBreachAllowedCount,
                                maxPlural:
                                  limitBreachAllowedCount > 1 ? 's' : '',
                              }),
                            )
                          "
                        ></span
                        ><span
                          v-else
                          class="text-[12px] opacity-80 italic"
                          v-html="
                            DOMPurify.sanitize(
                              t('about.limit_exceeded_info', {
                                remaining:
                                  limitBreachAllowedCount -
                                  licenseData?.ingestion_exceeded,
                                plural:
                                  limitBreachAllowedCount -
                                    licenseData?.ingestion_exceeded >
                                  1
                                    ? 's'
                                    : '',
                                max: limitBreachAllowedCount,
                              }),
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
              </div>

              <!-- Chart -->
              <div v-if="usageDashboardData">
                <div class="chart-wrapper relative">
                  <div class="usage-chart-container w-full overflow-visible p-0 mx-auto">
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
                    class="text-xs text-gray-400 mt-1 text-center"
                    style="font-size: 10px"
                  >
                    {{ t("about.usage_shows_zero_unlimited") }}
                  </div>
                </div>
              </div>
            </div>
          </OCardSection>
        </OCard>
      </div>
    </div>

    <!-- License Key Modal -->
    <ODialog data-test="license-key-modal-dialog"
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
      <div class="text-sm mb-3">
        {{ t('about.your_complete_license_key') }}
      </div>
      <OTextarea
        data-test="modal-license-key-display"
        v-model="licenseData.key"
        readonly
        :rows="8"
        style="font-family: monospace; font-size: 12px"
      />
    </ODialog>
  </div>
</template>

<script lang="ts">
import {
  defineComponent,
  ref,
  onMounted,
  computed,
  watch,
  defineAsyncComponent,
} from "vue";
import { useI18n } from "vue-i18n";
import licenseServer from "@/services/license_server";
import { useStore } from "vuex";
import DOMPurify from "dompurify";
import LicensePeriod from "@/enterprise/components/billings/LicensePeriod.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OTextarea from "@/lib/forms/Input/OTextarea.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormTextarea from "@/lib/forms/Input/OFormTextarea.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import OCard from "@/lib/core/Card/OCard.vue";
import OCardSection from "@/lib/core/Card/OCardSection.vue";
import { useConfirmDialog } from "@/composables/useConfirmDialog";
import { copyToClipboard } from "@/utils/clipboard";
import { makeLicenseSchema, type LicenseForm } from "./License.schema";

const RenderDashboardCharts = defineAsyncComponent(
  () => import("@/views/Dashboards/RenderDashboardCharts.vue"),
);

export default defineComponent({
  name: "License",
  components: {
    LicensePeriod,
    RenderDashboardCharts,
    OButton,
    ODialog,
    OSpinner,
    OIcon,
    OBadge,
    OTextarea,
    OForm,
    OFormTextarea,
    OCard,
    OCardSection,
},
  setup() {
    const { t } = useI18n();
    const { confirm } = useConfirmDialog();
    const loading = ref(false);
    const licenseData = ref<any>({});
    const licenseKey = ref("");
    const showUpdateForm = ref(false);
    const showLicenseKeyModal = ref(false);
    const isLicenseKeyAutoFilled = ref(false);
    const store = useStore();
    const usageDashboardData = ref<any>(null);
    const dashboardRenderKey = ref(0);

    // Schema-driven validation replaces the `:disabled="!licenseKey.trim()"`
    // gate. The same licenseKey is entered in two mutually-exclusive cards, each
    // wrapped in its own <OForm> that OWNS the field (by name). `licenseKey` is
    // only the shared INCOMING working value (auto-filled from URL, cleared on
    // save/cancel) — bridged one-way into whichever form is mounted via the
    // watch below; the typed value is read back from the submit payload, never
    // from this ref. Options-API: schema/defaults MUST be returned from setup().
    const licenseSchema = makeLicenseSchema(t);
    const noLicenseForm = ref<any>(null);
    const updateLicenseForm = ref<any>(null);
    const licenseDefaults = computed(
      (): LicenseForm => ({ licenseKey: licenseKey.value }),
    );

    // Bridge programmatic licenseKey changes (URL auto-fill, cancel/clear) into
    // whichever card's form is mounted. Use form.reset (NOT setFieldValue) so the
    // field re-seeds AND submit state resets (submissionAttempts → 0) — no
    // post-save "required" flash on the v-show'd update card when clearing to "".
    watch(licenseKey, (v) => {
      noLicenseForm.value?.form?.reset({ licenseKey: v ?? "" });
      updateLicenseForm.value?.form?.reset({ licenseKey: v ?? "" });
    });

    const loadLicenseData = async () => {
      try {
        loading.value = true;
        const response = await licenseServer.get_license();
        licenseData.value = response.data;
        checkAndAutoFillLicenseFromUrl();
      } catch (error) {
        console.error("Error loading license data:", error);
        toast({
          variant: "error",
          message: t("about.failed_to_load_license_info"),
        });
      } finally {
        loading.value = false;
      }
    };

    // @submit handler — fires only once the schema passes (licenseKey required +
    // trim), so the `:disabled` gate is gone (R3). Still callable directly with
    // no args (reads the shared working ref); OForm awaits it so the inline Save
    // button's spinner spans the request.
    const updateLicense = async (value?: LicenseForm) => {
      const key = (value?.licenseKey ?? licenseKey.value ?? "").trim();
      try {
        await licenseServer.update_license(key);
        toast({
          variant: "success",
          message: t("about.license_updated_success"),
        });
        licenseKey.value = "";
        isLicenseKeyAutoFilled.value = false;
        showUpdateForm.value = false;

        // Clear URL parameters after successful license update
        const url = new URL(window.location.href);
        url.searchParams.delete("installation_id");
        url.searchParams.delete("license_key");
        window.history.replaceState({}, document.title, url.toString());

        await loadLicenseData();
      } catch (error) {
        console.error("Error updating license:", error);
        toast({
          variant: "error",
          message:
            t("about.failed_to_update_license") +
            " : " +
            (error?.response?.data?.message || t("settings.licensePage.unexpectedError")),
        });
      }
    };

    const showUpdateFormAndFocus = () => {
      showUpdateForm.value = true;
      setTimeout(() => {
        const textarea = document.querySelector(
          'textarea[placeholder="Paste new license key here..."]',
        ) as HTMLTextAreaElement;
        if (textarea) {
          textarea.focus();
        }
      }, 100);
    };

    const triggerLimitRefresh = async () => {
      try {
        await licenseServer.refresh_license_limits();
        toast({
          variant: "success",
          message: t("about.license_refresh_success"),
        });
      }catch(error){
        console.error("Error refreshing license:", error);
        toast({
          variant: "error",
          message:
            t("about.failed_to_refresh_license") +
            " : " +
            (error?.response?.data?.message || t("settings.licensePage.unexpectedError")),
        }); 
      }
    }

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
      const success = await copyToClipboard(licenseData.value.key, {
        successMessage: t("about.license_key_copied"),
        errorMessage: t("about.failed_to_copy_license"),
      });
      if (success) {
        showLicenseKeyModal.value = false;
      }
    };

    const redirectToGetLicense = () => {
      const baseUrl = window.location.origin;
      const installationId = licenseData.value.installation_id || "";
      const licenseUrl = `${store.state.zoConfig.license_server_url}/user/request-license?base_url=${encodeURIComponent(baseUrl)}&license_id=${encodeURIComponent(installationId)}`;
      window.open(licenseUrl, "_blank");
    };

    const checkAndAutoFillLicenseFromUrl = async () => {
      const urlParams = new URLSearchParams(window.location.search);
      const urlInstallationId = urlParams.get("installation_id");
      const urlLicenseKey = urlParams.get("license_key");

      if (
        urlInstallationId &&
        urlLicenseKey &&
        licenseData.value.installation_id
      ) {
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

    const formatDate = (timestamp: number) => {
      return new Date(timestamp / 1000).toLocaleString();
    };

    const isIngestionUnlimited = computed(() => {
      return licenseData.value.license?.limits?.Ingestion?.typ === "Unlimited";
    });

    // For license version >= 2, use limit_breach_allowed_count from the license data.
    // For version < 2 or when version is absent (v1), fall back to 3.
    const limitBreachAllowedCount = computed(() => {
      const version = licenseData.value.license?.version;
      if (version !== undefined && version !== null && version >= 2) {
        return licenseData.value.license?.limit_breach_allowed_count ?? 3;
      }
      return 3;
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

    const showLicenseExpiryWarning = computed(() => {
      if (!store.state.zoConfig.license_expiry) return false;
      const now = Date.now();
      const expiryDate = store.state.zoConfig.license_expiry;
      const daysUntilExpiry = Math.ceil(
        (expiryDate - now) / (1000 * 60 * 60 * 24),
      );
      return daysUntilExpiry < 14;
    });

    const getLicenseExpiryMessage = () => {
      if (!store.state.zoConfig.license_expiry) return "";
      const now = Date.now();
      const expiryDate = store.state.zoConfig.license_expiry;
      const daysUntilExpiry = Math.ceil(
        (expiryDate - now) / (1000 * 60 * 60 * 24),
      );

      if (daysUntilExpiry > 1) {
        return t("settings.licensePage.daysRemaining", { days: daysUntilExpiry });
      } else if (daysUntilExpiry === 1) {
        return t("settings.licensePage.oneDayRemaining");
      } else {
        return t("settings.licensePage.licenseExpired");
      }
    };

    // Current time object for dashboard (calendar start date to current date)
    // Similar to TelemetryCorrelationDashboard, we pass microsecond timestamps to Date constructor
    const currentTimeObj = computed(() => {
      const now = new Date();
      const calendarStartDate = new Date(
        now.getFullYear(),
        now.getMonth(),
        1,
        0,
        0,
        0,
        0,
      );

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
      return licenseData.value?.license?.limits?.Ingestion?.value || 100;
    });

    // Generate usage dashboard data
    const generateUsageDashboard = () => {
      const ingestionLimit = ingestionLimitGB.value;

      // Build the threshold configuration - using correct format for mark_line
      const thresholds: any[] = [];
      if (ingestionLimit !== null && ingestionLimit > 0) {
        // Add critical threshold at 100% of limit
        thresholds.push({
          type: "yAxis",
          name: "Limit Exceeded",
          value: ingestionLimit,
          color: "#FF0000", // Red
          lineStyle: "solid",
          width: 2,
        });
      }

      const query = `SELECT histogram(_timestamp, '1 day') AS x_axis_1, sum(size) AS y_axis_1 FROM "usage" WHERE event = 'Ingestion' GROUP BY x_axis_1 ORDER BY x_axis_1`;

      // Get timestamps in microseconds (16 digits)
      const now = new Date();
      const calendarStartDate = new Date(
        now.getFullYear(),
        now.getMonth(),
        1,
        0,
        0,
        0,
        0,
      );
      const startTimeMicros = calendarStartDate.getTime() * 1000;
      const endTimeMicros = now.getTime() * 1000;

      const dashboard = {
        version: 8,
        dashboardId: "",
        title: "Ingestion Usage",
        description: "Daily ingestion usage with threshold limits",
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
                title: "",
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

    onMounted(() => {
      loadLicenseData();
      generateUsageDashboard();
    });

    return {
      t,
      store,
      loading,
      licenseData,
      licenseKey,
      showUpdateForm,
      showLicenseKeyModal,
      updateLicense,
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
      showLicenseExpiryWarning,
      getLicenseExpiryMessage,
      showUpdateFormAndFocus,
      triggerLimitRefresh,
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
      generateUsageDashboard,
      limitBreachAllowedCount,
      DOMPurify,
    };
  },
});
</script>

<style>
.usage-chart-container .grid-stack-item-content {
  border: 0px !important;
}

.ingestion-summary-compact::before {
  content: "";
  position: absolute;
  top: 0;
  left: 0;
  width: 3px;
  height: 100%;
  background: linear-gradient(
    180deg,
    var(--o2-menu-color) 0%,
    var(--o2-menu-color) 100%
  );
  opacity: 0.6;
}

.ingestion-summary-compact .summary-text-compact strong {
  font-weight: 700;
  background: linear-gradient(
    135deg,
    var(--o2-menu-color) 0%,
    var(--o2-menu-color) 100%
  );
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.dark .futuristic-card::before {
  background: linear-gradient(
    90deg,
    transparent 0%,
    rgba(99, 102, 241, 0.7) 20%,
    rgba(168, 85, 247, 0.7) 80%,
    transparent 100%
  );
}

.dark .ingestion-summary-compact::before {
  opacity: 0.8;
}
</style>
