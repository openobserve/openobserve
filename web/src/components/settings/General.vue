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

<!-- eslint-disable vue/x-invalid-end-tag -->
<template>
  <div>
    <OForm id="general-settings-form" :form="form">
      <div class="flex flex-col gap-4">
        <template v-if="!trialExpired">
          <OFormSection
            variant="plain"
            :title="t('settings.general.themeTitle')"
            :description="t('settings.general.themeDescription', { org: deleteOrgName })"
            data-test="general-settings-theme-section"
          >
            <OSettingRow
              control-at="end"
              :label="t('settings.general.accentColorLabel')"
              :loading="!settingsLoaded"
              data-test="general-settings-theme-row"
            >
              <div class="flex w-full flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  class="group/chip bg-surface-subtle border-border-default hover:bg-surface-subtle-hover hover:border-accent focus-visible:outline-focus-ring-accent inline-flex cursor-pointer items-center gap-1 rounded-full border py-1.5 ps-1.5 pe-2 transition-all duration-200 outline-none hover:-translate-y-px hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid"
                  :aria-label="t('settings.general.lightColorLabel', { color: customLightColor })"
                  data-test="theme-light-chip"
                  @click="handleThemeChipClick('light')"
                >
                  <span
                    class="color-circle relative flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full shadow-sm"
                    :style="{ backgroundColor: customLightColor }"
                  >
                    <!-- eslint-disable local/no-hardcoded-px -- optical effect, not layout — scaling it with text makes elevation bloom -->
                    <OIcon
                      name="palette"
                      size="xs"
                      class="opacity-0 filter-[drop-shadow(0_1px_1px_color-mix(in_srgb,var(--color-black)_30%,transparent))] transition-opacity duration-200 group-hover/chip:opacity-90 max-md:opacity-90"
                    />
                    <!-- eslint-enable local/no-hardcoded-px -->
                  </span>
                  <span class="chip-label text-text-body text-xs font-semibold">{{
                    t("settings.light")
                  }}</span>
                  <span class="chip-value text-text-body font-mono text-xs font-medium">{{
                    customLightColor
                  }}</span>
                </button>

                <button
                  type="button"
                  class="group/chip bg-surface-subtle border-border-default hover:bg-surface-subtle-hover hover:border-accent focus-visible:outline-focus-ring-accent inline-flex cursor-pointer items-center gap-1 rounded-full border py-1.5 ps-1.5 pe-2 transition-all duration-200 outline-none hover:-translate-y-px hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid"
                  :aria-label="t('settings.general.darkColorLabel', { color: customDarkColor })"
                  data-test="theme-dark-chip"
                  @click="handleThemeChipClick('dark')"
                >
                  <span
                    class="color-circle relative flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full shadow-sm"
                    :style="{ backgroundColor: customDarkColor }"
                  >
                    <!-- eslint-disable local/no-hardcoded-px -- optical effect, not layout — scaling it with text makes elevation bloom -->
                    <OIcon
                      name="palette"
                      size="xs"
                      class="opacity-0 filter-[drop-shadow(0_1px_1px_color-mix(in_srgb,var(--color-black)_30%,transparent))] transition-opacity duration-200 group-hover/chip:opacity-90 max-md:opacity-90"
                    />
                    <!-- eslint-enable local/no-hardcoded-px -->
                  </span>
                  <span class="chip-label text-text-body text-xs font-semibold">{{
                    t("settings.dark")
                  }}</span>
                  <span class="chip-value text-text-body font-mono text-xs font-medium">{{
                    customDarkColor
                  }}</span>
                </button>

                <button
                  type="button"
                  class="group/resetChip border-border-default hover:border-error-400 hover:bg-error-500/10 focus-visible:outline-focus-ring-accent inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-full border border-dashed bg-transparent opacity-60 transition-all duration-200 outline-none hover:-translate-y-px hover:rotate-180 hover:border-solid hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid"
                  :aria-label="t('settings.resetToDefaultColors')"
                  data-test="reset-theme-colors-btn"
                  @click="resetThemeColors"
                >
                  <OIcon
                    name="refresh"
                    size="sm"
                    class="group-hover/resetChip:text-error-500 dark:group-hover/resetChip:text-error-400"
                  />
                  <OTooltip :content="t('settings.resetToDefaultColors')" side="top" />
                </button>
              </div>
            </OSettingRow>
          </OFormSection>

          <OFormSection
            variant="plain"
            :title="t('settings.general.queryDefaultsTitle')"
            :description="t('settings.general.queryDefaultsDescription')"
            data-test="general-settings-query-defaults-section"
          >
            <OSettingRow
              control-at="end"
              name="scrape_interval"
              error-data-test="general-settings-scrape-interval-error"
              :label="t('settings.general.scrapeIntervalLabel')"
              :description="t('settings.general.scrapeIntervalHelp')"
              :loading="!settingsLoaded"
              data-test="general-settings-scrape-interval-row"
            >
              <OFormInput
                name="scrape_interval"
                :aria-label="t('settings.general.scrapeIntervalLabel')"
                type="number"
                min="0"
                :suffix="t('settings.general.unitSeconds')"
                data-test="general-settings-scrape-interval"
              />
            </OSettingRow>

            <OSettingRow
              control-at="end"
              name="max_series_per_query"
              :label="t('settings.general.maxSeriesLabel')"
              :description="t('settings.general.maxSeriesHelp', { n: defaultMaxSeries })"
              :loading="!settingsLoaded"
              data-test="general-settings-max-series-per-query-row"
            >
              <OFormInput
                name="max_series_per_query"
                type="number"
                :min="1000"
                :max="1000000"
                :placeholder="raw(defaultMaxSeries)"
                :suffix="t('settings.general.unitSeries')"
                :aria-label="t('settings.general.maxSeriesLabel')"
                data-test="general-settings-max-series-per-query"
              />
            </OSettingRow>
          </OFormSection>
        </template>

        <OFormSection
          v-if="
            !trialExpired &&
            customBrandingAccess.visible &&
            store.state.zoConfig.meta_org == store.state.selectedOrganization.identifier
          "
          id="enterpriseFeature"
          variant="plain"
          :title="t('settings.general.brandingTitle')"
          :description="t('settings.general.brandingDescription')"
          data-test="general-settings-branding-section"
        >
          <OSettingRow
            control-at="end"
            name="custom_logo_text"
            error-data-test="settings_ent_logo_custom_text_error"
            :label="t('settings.customLogoText')"
            :description="t('settings.general.logoTextHelp')"
          >
            <div
              v-if="!customBrandingAccess.allowed"
              class="flex w-full items-center gap-2"
              @click.capture="onLockedBrandingClick"
            >
              <OInput
                class="min-w-0 flex-1"
                model-value=""
                :placeholder="t('settings.noTextAvailable')"
                :aria-label="t('settings.customLogoText')"
                data-test="settings_ent_logo_custom_text_locked"
              >
                <template v-slot:icon-right>
                  <OIcon name="lock" size="sm" class="lock-chip" />
                </template>
              </OInput>
            </div>
            <OFormInput
              v-else
              name="custom_logo_text"
              :aria-label="t('settings.customLogoText')"
              data-test="settings_ent_logo_custom_text"
            />
          </OSettingRow>

          <OSettingRow
            control-at="end"
            :label="t('settings.general.logoLightLabel')"
            :description="t('settings.general.logoLightHelp')"
          >
            <div
              v-if="!customBrandingAccess.allowed"
              class="flex w-full items-center gap-2"
              @click.capture="onLockedBrandingClick"
            >
              <OFile
                data-test="setting_ent_custom_logo_img_file_upload_locked"
                accept=".png, .jpg, .jpeg, .gif, .bmp, .jpeg2, image/*"
                class="o2-file-input mx-0 min-w-0 flex-1"
              >
                <template v-slot:prepend>
                  <OIcon name="lock" size="sm" class="lock-chip" />
                </template>
              </OFile>
            </div>
            <div
              v-else-if="
                store.state.zoConfig.hasOwnProperty('custom_logo_img') &&
                store.state.zoConfig.custom_logo_img != null
              "
              class="flex w-full items-center gap-3"
            >
              <img
                data-test="setting_ent_custom_logo_img"
                :src="`data:image; base64, ` + store.state.zoConfig.custom_logo_img"
                :alt="t('settings.logoLabel')"
                class="max-h-7.75 max-w-37.5"
              />
              <OButton
                :aria-label="t('common.delete')"
                data-test="setting_ent_custom_logo_img_delete_btn"
                variant="ghost-destructive"
                size="icon-xs-sq"
                type="button"
                @click="confirmDeleteLogo('light')"
                icon-left="delete"
              />
            </div>
            <div v-else class="flex w-full items-center gap-2">
              <OFile
                data-test="setting_ent_custom_logo_img_file_upload"
                v-model="filesLight"
                :aria-label="t('settings.general.logoLightLabel')"
                accept=".png, .jpg, .jpeg, .gif, .bmp, .jpeg2, image/*"
                @rejected="onRejected"
                class="o2-file-input mx-0 min-w-0 flex-1"
              >
                <template v-slot:prepend>
                  <OIcon name="attach-file" size="sm" />
                </template>
              </OFile>
            </div>
          </OSettingRow>

          <OSettingRow
            control-at="end"
            :label="t('settings.general.logoDarkLabel')"
            :description="t('settings.general.logoDarkHelp')"
          >
            <div
              v-if="!customBrandingAccess.allowed"
              class="flex w-full items-center gap-2"
              @click.capture="onLockedBrandingClick"
            >
              <OFile
                data-test="setting_ent_custom_logo_dark_img_file_upload_locked"
                accept=".png, .jpg, .jpeg, .gif, .bmp, .jpeg2, image/*"
                class="o2-file-input mx-0 min-w-0 flex-1"
              >
                <template v-slot:prepend>
                  <OIcon name="lock" size="sm" class="lock-chip" />
                </template>
              </OFile>
            </div>
            <div
              v-else-if="
                store.state.zoConfig.hasOwnProperty('custom_logo_dark_img') &&
                store.state.zoConfig.custom_logo_dark_img != null
              "
              class="flex w-full items-center gap-3"
            >
              <img
                data-test="setting_ent_custom_logo_dark_img"
                :src="`data:image; base64, ` + store.state.zoConfig.custom_logo_dark_img"
                :alt="t('settings.logoLabel')"
                class="max-h-7.75 max-w-37.5"
              />
              <OButton
                :aria-label="t('common.delete')"
                data-test="setting_ent_custom_logo_dark_img_delete_btn"
                variant="ghost-destructive"
                size="icon-xs-sq"
                type="button"
                @click="confirmDeleteLogo('dark')"
                icon-left="delete"
              />
            </div>
            <div v-else class="flex w-full items-center gap-2">
              <OFile
                data-test="setting_ent_custom_logo_dark_img_file_upload"
                v-model="filesDark"
                :aria-label="t('settings.general.logoDarkLabel')"
                accept=".png, .jpg, .jpeg, .gif, .bmp, .jpeg2, image/*"
                @rejected="onRejected"
                class="o2-file-input mx-0 min-w-0 flex-1"
              >
                <template v-slot:prepend>
                  <OIcon name="attach-file" size="sm" />
                </template>
              </OFile>
            </div>
          </OSettingRow>
        </OFormSection>

        <!-- Visibility only: the backend's per-org RBAC check on DELETE is the real gate. -->
        <OFormSection
          v-if="canDeleteOrg"
          id="dangerZone"
          variant="plain"
          tone="danger"
          :title="t('settings.dangerZone')"
          data-test="general-settings-danger-zone"
        >
          <OSettingRow control-at="end" :label="t('settings.deleteOrganizationTitle')">
            <template #description>
              <i18n-t keypath="settings.deleteOrganizationDescription" tag="span">
                <template #name>
                  <span class="text-text-body font-semibold">{{ deleteOrgName }}</span>
                </template>
              </i18n-t>
            </template>
            <OButton
              data-test="general-settings-delete-org-btn"
              variant="outline-destructive"
              size="sm-action"
              icon-left="delete"
              type="button"
              :loading="deleting"
              @click="openDeleteOrgDialog"
            >
              {{ t("settings.deleteOrganization") }}
            </OButton>
          </OSettingRow>

          <div
            data-test="general-settings-delete-org-facts"
            class="divide-border-default grid grid-cols-4 divide-x max-md:grid-cols-1 max-md:divide-x-0"
          >
            <div
              v-for="fact in deleteOrgFacts"
              :key="fact.key"
              :data-test="`general-settings-delete-org-fact-${fact.key}`"
              class="flex flex-col gap-1 px-4 py-3"
            >
              <div class="flex items-center gap-2">
                <OIcon :name="fact.icon" size="sm" class="text-text-muted shrink-0" />
                <span class="text-text-heading text-sm font-semibold">{{ fact.title }}</span>
              </div>
              <span class="text-text-secondary text-xs">{{ fact.detail }}</span>
            </div>
          </div>
        </OFormSection>
      </div>

      <Teleport v-if="!trialExpired" defer :to="SAVE_BAR_SLOT">
        <OSaveBar
          class="px-page-edge"
          form-id="general-settings-form"
          :change-count="changeCount"
          :loaded="settingsLoaded"
          data-test="general-settings-save-bar"
          save-data-test="dashboard-add-submit"
          @discard="discardOffForm"
        />
      </Teleport>
    </OForm>
  </div>
  <OSpinner
    v-if="loadingState"
    size="md"
    class="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
    data-test="general-settings-loading-indicator"
  />
  <ODialog
    data-test="general-delete-image-dialog"
    v-model:open="confirmDeleteImage"
    size="sm"
    :title="t('settings.deleteLogoTitle')"
    :secondary-button-label="t('confirmDialog.cancel')"
    :primary-button-label="t('confirmDialog.ok')"
    primary-button-variant="destructive"
    @click:secondary="cancelConfirmDialog"
    @click:primary="confirmDialogOK"
  >
    <i18n-t keypath="settings.deleteLogoMessage" tag="p" data-test="general-delete-image-message">
      <template #name
        ><span class="text-text-heading font-semibold break-all">{{
          logoThemeToDelete === "dark" ? t("settings.darkMode") : t("settings.lightMode")
        }}</span></template
      >
    </i18n-t>
  </ODialog>

  <ODialog
    data-test="general-color-picker-dialog"
    v-model:open="showColorPicker"
    @update:open="(v) => !v && onColorPickerClose()"
    size="xs"
    :title="t('settings.pickCustomColor')"
    :primary-button-label="t('settings.general.close')"
    @click:primary="showColorPicker = false"
  >
    <OColor v-model="tempColor" @update:model-value="updateCustomColor" />
  </ODialog>

  <ODialog
    data-test="general-delete-org-dialog"
    v-model:open="confirmDeleteOrg"
    size="sm"
    :title="t('settings.deleteOrganization')"
    :secondary-button-label="t('confirmDialog.cancel')"
    :primary-button-label="t('settings.deleteOrganization')"
    primary-button-variant="destructive"
    :primary-button-disabled="!deleteConfirmMatches"
    @update:open="(v) => !v && (deleteConfirmInput = '')"
    @click:secondary="confirmDeleteOrg = false"
    @click:primary="deleteOrg"
  >
    <div class="flex flex-col gap-3">
      <!-- What will happen -->
      <p class="text-text-body text-sm">
        {{
          t("settings.deleteOrganizationConfirm", {
            name: deleteOrgName,
          })
        }}
      </p>

      <!-- Blast radius in concrete numbers. Fetched only when this dialog opens
           (see fetchOrgScope) and treated as contextual — if it fails to load the
           delete flow still works, the user just decides without the counts. -->
      <p v-if="orgScopeLoading" class="text-text-secondary text-xs">
        {{ t("settings.deleteOrganizationScopeLoading") }}
      </p>
      <p
        v-else-if="orgScope"
        data-test="general-delete-org-scope"
        class="text-text-body text-xs font-semibold"
      >
        {{ orgScope }}
      </p>

      <!-- Irreversible-action warning callout -->
      <div
        class="rounded-default border-banner-error-soft-border bg-banner-error-soft-bg flex items-start gap-2 border px-3 py-2"
      >
        <OIcon name="warning" size="sm" class="text-banner-error-soft-text mt-0.5 shrink-0" />
        <div class="flex flex-col gap-1">
          <p class="text-banner-error-soft-text text-xs">
            {{ t("settings.deleteOrganizationWarning") }}
          </p>
          <p class="text-banner-error-soft-text text-xs">
            {{ t("settings.deleteOrganizationRecoverable") }}
          </p>
        </div>
      </div>

      <!-- Type-to-confirm gate -->
      <div class="flex flex-col gap-1">
        <label class="text-text-secondary block text-xs">
          <i18n-t keypath="settings.deleteOrganizationTypeToConfirm" tag="span">
            <template #name>
              <span class="text-text-body font-semibold">{{ deleteOrgName }}</span>
            </template>
          </i18n-t>
        </label>
        <OInput
          :aria-label="t('settings.deleteOrganizationTypeToConfirm', { name: deleteOrgName })"
          data-test="general-delete-org-confirm-input"
          v-model="deleteConfirmInput"
          :placeholder="deleteOrgName"
          size="sm"
          autocomplete="off"
          @keyup.enter="deleteConfirmMatches && deleteOrg()"
        />
      </div>
    </div>
  </ODialog>
</template>

<script lang="ts">
// @ts-ignore
import { configFullQuery, updateCustomLogoTextMutation } from "@/services/config.queries";
import { useMutation } from "@tanstack/vue-query";
import { queryClient } from "@/composables/query/queryClient";
import { orgSummaryQuery, updateOrgSettingsMutation } from "@/services/organizations.queries";
import {
  computed,
  defineComponent,
  nextTick,
  onActivated,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";
import { raw, useI18nTyped } from "@/types/i18n";
import { useStore } from "vuex";
import { useTheme } from "@/composables/useTheme";
import { useRouter } from "vue-router";
import organizations from "@/services/organizations";
import usersService from "@/services/users";
import settingsService from "@/services/settings";
import analytics from "@/services/product_analytics";
import config from "@/aws-exports";
import DOMPurify from "dompurify";
import { applyThemeColors, switchThemeMode } from "@/utils/theme";
import { isTrialExpired, useLocalOrganization } from "@/utils/zincutils";
import { formatSizeFromMB } from "@/utils/formatters";
import OButton from "@/lib/core/Button/OButton.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OFile from "@/lib/forms/File/OFile.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import { useOForm } from "@/lib/forms/Form/useOForm";
import OSaveBar from "@/lib/forms/SaveBar/OSaveBar.vue";
import {
  discardFormChanges,
  rebaseSavedValues,
  useFormCounts,
} from "@/lib/forms/SaveBar/formCounts";
import { useLeaveGuard } from "@/lib/forms/SaveBar/useLeaveGuard";
import OFormSection from "@/lib/core/FormSection/OFormSection.vue";
import OSettingRow from "@/lib/core/SettingRow/OSettingRow.vue";
import OColor from "@/lib/forms/Color/OColor.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import { makeGeneralSettingsSchema, type GeneralSettingsForm } from "./General.schema";
import { SAVE_BAR_SLOT } from "./saveBarSlot";
import { useLockedAffordance } from "@/composables/useLockedAffordance";
import { useEnterpriseUpgradeDialog } from "@/composables/useEnterpriseUpgradeDialog";

type LogoMode = "light" | "dark";
const LOGO_MODES: LogoMode[] = ["light", "dark"];

export default defineComponent({
  name: "PageGeneralSettings",
  methods: {
    cancelConfirmDialog() {
      this.confirmDeleteImage = false;
    },
    confirmDialogOK() {
      this.confirmDeleteImage = false;
      this.deleteLogo(this.logoThemeToDelete);
    },
    confirmDeleteLogo(theme: string) {
      this.logoThemeToDelete = theme;
      this.confirmDeleteImage = true;
    },
  },
  components: {
    OButton,
    ODialog,
    OSpinner,
    OIcon,
    OTooltip,
    OInput,
    OFile,
    OForm,
    OFormInput,
    OFormSection,
    OSettingRow,
    OSaveBar,
    OColor,
  },
  setup() {
    const { t } = useI18nTyped();

    const store = useStore();
    const { isDark } = useTheme();
    const router: any = useRouter();

    // Self-hosted-only (cloudOffers: false) — pure Cloud gets `visible: false`
    // (hidden, matching today's real behavior), OSS gets locked-but-visible.
    const customBrandingAccess = useLockedAffordance("customBranding");
    const { open: openUpgradeDialog } = useEnterpriseUpgradeDialog();
    function onLockedBrandingClick(event: MouseEvent) {
      event.preventDefault();
      event.stopPropagation();
      openUpgradeDialog();
    }

    // Built once from the component's `t` so the messages are localized.
    const generalSettingsSchema = makeGeneralSettingsSchema(t);
    const orgSettings = computed(() => store.state?.organizationData?.organizationSettings);
    const settingsLoaded = computed(() => !!orgSettings.value);
    // Held as text because a number input emits text: a retyped saved value must compare equal.
    const fieldText = (value: unknown) =>
      value === null || value === undefined ? "" : String(value);
    const savedFormValues = (): GeneralSettingsForm => ({
      scrape_interval: fieldText(orgSettings.value?.scrape_interval),
      max_series_per_query: fieldText(orgSettings.value?.max_series_per_query),
      custom_logo_text: fieldText(store.state.zoConfig?.custom_logo_text),
    });
    const form = useOForm<GeneralSettingsForm>({
      defaultValues: savedFormValues(),
      schema: generalSettingsSchema,
      validateOn: "leave",
      onSubmit: (value) => saveGeneralSettings(value),
    });
    const { changes: formChanges } = useFormCounts(form);
    const defaultMaxSeries = new Intl.NumberFormat().format(40000);

    const loadingState = ref(false);

    // Branding is instance-wide, so with no org selected it is written against the default-type org.
    const brandingOrg = () =>
      store.state.selectedOrganization?.identifier ||
      store.state.organizations?.find((o: any) => o.type == "default")?.identifier ||
      "default";
    const updateCustomLogoText = useMutation(() => updateCustomLogoTextMutation(brandingOrg()));
    const updateOrgSettings = useMutation(() =>
      updateOrgSettingsMutation(store.state?.selectedOrganization?.identifier),
    );
    // A chosen logo waits for the page's Save like any other edit.
    const filesLight = ref<File | null>(null);
    const filesDark = ref<File | null>(null);
    const logoFiles = { light: filesLight, dark: filesDark };
    const chosenLogos = computed(() => Number(!!filesLight.value) + Number(!!filesDark.value));
    const logoThemeToDelete = ref<string>("light");

    // Theme management state
    // Get default colors from Vuex store (centralized - can be updated in one place)
    const DEFAULT_LIGHT_COLOR = store.state.defaultThemeColors.light;
    const DEFAULT_DARK_COLOR = store.state.defaultThemeColors.dark;

    // Custom theme colors for light and dark modes
    // Priority: Vuex store tempThemeColors > organizationSettings (backend) > defaults
    // These refs display the current color in the UI and in the color picker
    const customLightColor = ref(
      store.state.tempThemeColors?.light ||
        store.state?.organizationData?.organizationSettings?.light_mode_theme_color ||
        DEFAULT_LIGHT_COLOR,
    );
    const customDarkColor = ref(
      store.state.tempThemeColors?.dark ||
        store.state?.organizationData?.organizationSettings?.dark_mode_theme_color ||
        DEFAULT_DARK_COLOR,
    );

    const savedLightColor = computed(
      () => orgSettings.value?.light_mode_theme_color || DEFAULT_LIGHT_COLOR,
    );
    const savedDarkColor = computed(
      () => orgSettings.value?.dark_mode_theme_color || DEFAULT_DARK_COLOR,
    );
    const changeCount = computed(
      () =>
        formChanges.value +
        chosenLogos.value +
        Number(customLightColor.value !== savedLightColor.value) +
        Number(customDarkColor.value !== savedDarkColor.value),
    );

    // Color picker dialog state
    const showColorPicker = ref(false); // Controls dialog visibility
    const currentPickerMode = ref<"light" | "dark">("light"); // Which mode is being edited
    const tempColor = ref(DEFAULT_LIGHT_COLOR); // Bound to the color picker component

    /**
     * Update theme colors from Vuex store
     * Called on component mount and when organization settings change
     * Priority: Vuex store tempThemeColors > organizationSettings > defaults
     */
    const updateFromStore = () => {
      // Get theme colors from store with priority order
      // 1. Check Vuex store for temporary preview colors (highest priority)
      // 2. Check organization settings for backend defaults
      // 3. Use application defaults
      const tempLightFromStore = store.state.tempThemeColors?.light;
      const tempDarkFromStore = store.state.tempThemeColors?.dark;

      const newLightColor =
        tempLightFromStore ||
        store.state?.organizationData?.organizationSettings?.light_mode_theme_color ||
        DEFAULT_LIGHT_COLOR;
      const newDarkColor =
        tempDarkFromStore ||
        store.state?.organizationData?.organizationSettings?.dark_mode_theme_color ||
        DEFAULT_DARK_COLOR;

      // Check if colors changed and need to be applied
      let shouldApply = false;

      if (customLightColor.value !== newLightColor) {
        customLightColor.value = newLightColor;
        shouldApply = true;
      }
      if (customDarkColor.value !== newDarkColor) {
        customDarkColor.value = newDarkColor;
        shouldApply = true;
      }

      // Apply the theme colors if they changed
      if (shouldApply) {
        const currentMode = isDark.value ? "dark" : "light";
        const color = currentMode === "light" ? newLightColor : newDarkColor;
        const isDefault = color === DEFAULT_LIGHT_COLOR || color === DEFAULT_DARK_COLOR;
        applyThemeColors(color, currentMode, isDefault);
      }
    };

    // ===== Delete organization (Danger Zone) =====
    // The current user's role in the *currently selected* org. Sourced the same
    // way IAM Users page does it: match our email in the org members list.
    const currentUserRole = ref("");
    const confirmDeleteOrg = ref(false);
    const deleting = ref(false);
    // Human members of this org, counted from the same list that resolves our role
    // (service accounts excluded — they aren't people who lose access).
    const memberCount = ref(0);
    // Formatted "N dashboards · N streams · N GB data", loaded on dialog open.
    const orgScope = ref("");
    const orgScopeLoading = ref(false);

    // Type-to-confirm gate: the destructive action is only enabled once the user
    // types the exact org name. Guards against accidental clicks on an irreversible
    // action (same pattern GitHub/Stripe use for delete-repo/close-account).
    const deleteConfirmInput = ref("");
    const deleteOrgName = computed(
      () =>
        store.state.selectedOrganization?.label ||
        store.state.selectedOrganization?.identifier ||
        "",
    );
    const deleteConfirmMatches = computed(
      () => deleteConfirmInput.value.trim() === deleteOrgName.value,
    );

    const trialExpired = computed(() =>
      isTrialExpired(store.state?.organizationData?.organizationSettings?.free_trial_expiry),
    );

    // Only cloud builds expose self-service org deletion. Backend enforces the
    // real per-org RBAC check; this only governs visibility.
    const canDeleteOrg = computed(() => {
      if (config.isCloud !== "true") return false;
      const role = currentUserRole.value?.toLowerCase();
      return role === "root" || role === "admin";
    });

    // Days a deleted org stays recoverable, from /config. A backend that predates the
    // field sends nothing, and 0 is a legal value meaning no window at all — the three
    // cases must read differently, because promising a recovery window that does not
    // exist is the one mistake this panel cannot afford.
    const recoveryWindowDays = computed<number | null>(() => {
      const days = store.state.zoConfig?.org_deletion_grace_period_days;
      return typeof days === "number" ? days : null;
    });

    const recoveryWindowFact = computed(() => {
      const days = recoveryWindowDays.value;
      if (days === 0) {
        return {
          key: "grace",
          icon: "warning",
          title: t("settings.deleteFactNoRecoveryWindow"),
          detail: t("settings.deleteFactNoRecoveryWindowDetail"),
        };
      }
      return {
        key: "grace",
        icon: "access-time",
        title: t("settings.deleteFactGracePeriod"),
        detail:
          days === null
            ? t("settings.deleteFactGracePeriodDetail")
            : t("settings.deleteFactRecoveryWindowDetail", { n: days }, days),
      };
    });

    // The consequence strip under the Danger Zone header.
    const deleteOrgFacts = computed(() => [
      recoveryWindowFact.value,
      {
        key: "scope",
        icon: "dashboard",
        title: t("settings.deleteFactEverything"),
        detail: t("settings.deleteFactEverythingDetail"),
      },
      {
        key: "members",
        icon: "group",
        title: t("settings.deleteFactMembers", { n: memberCount.value }, memberCount.value),
        detail: t("settings.deleteFactMembersDetail"),
      },
    ]);

    const fetchCurrentUserRole = async () => {
      const orgId = store.state.selectedOrganization?.identifier;
      if (!orgId || config.isCloud !== "true") return;
      try {
        const res = await usersService.orgUsers(orgId);
        const me = store.state.userInfo?.email?.toLowerCase();
        const members = res.data?.data || [];
        const mine = members.find((m: any) => m.email?.toLowerCase() === me);
        currentUserRole.value = mine?.role?.toLowerCase() || "";
        memberCount.value = members.filter((m: any) => !m.is_system).length;
      } catch {
        // On error, leave role empty -> button stays hidden.
        currentUserRole.value = "";
        memberCount.value = 0;
      }
    };

    // /summary is an expensive query (it lists every stream, runs a usage search
    // over the triggers stream, and lists pipelines, alerts, functions and
    // dashboards), so it is deferred to the moment the user actually opens the
    // confirm dialog rather than run on every General Settings visit. Cached after
    // the first successful load.
    const fetchOrgScope = async () => {
      const orgId = store.state.selectedOrganization?.identifier;
      if (!orgId || orgScope.value || orgScopeLoading.value) return;
      orgScopeLoading.value = true;
      try {
        const data: any = await queryClient.fetchQuery(orgSummaryQuery(orgId));
        orgScope.value = t("settings.deleteOrganizationScope", {
          dashboards: data?.total_dashboards ?? 0,
          streams: data?.streams?.num_streams ?? 0,
          size: formatSizeFromMB(String(data?.streams?.total_storage_size ?? 0)),
        });
      } catch {
        // Contextual only — the delete flow stays usable without the counts.
        orgScope.value = "";
      } finally {
        orgScopeLoading.value = false;
      }
    };

    const openDeleteOrgDialog = () => {
      confirmDeleteOrg.value = true;
      fetchOrgScope();
    };

    const deleteOrg = async () => {
      const org = store.state.selectedOrganization;
      const orgId = org?.identifier;
      if (!orgId) return;
      deleting.value = true;
      try {
        await organizations.delete_org(orgId);
        confirmDeleteOrg.value = false;
        deleteConfirmInput.value = "";
        toast({
          variant: "success",
          message: t("settings.deleteOrganizationInitiated"),
        });
        // The just-deleted org is now hidden/blocked by the backend, so we must
        // move the user off it. Clear the locally-remembered org and re-fetch the
        // org list (via the update_org flag MainLayout watches): its stale-org
        // guard then auto-selects a surviving org, or lands on the empty state if
        // this was the user's only org.
        // The organization is gone, so its unsaved edits have nowhere to be saved and must not hold the redirect.
        discardUnsaved();
        useLocalOrganization("");
        store.dispatch("setSelectedOrganization", {});
        router.push({
          path: "/",
          query: { update_org: Date.now().toString() },
        });
      } catch (e: any) {
        toast({
          variant: "error",
          message: e?.response?.data?.message || e?.message || t("settings.somethingWentWrong"),
        });
      } finally {
        deleting.value = false;
      }
    };

    onMounted(() => {
      fetchCurrentUserRole();
    });

    onActivated(() => {
      // Initialize from store on mount
      updateFromStore();
      fetchCurrentUserRole();
    });

    // Watch for changes in organization settings (backend config)
    // This handles when admin updates org settings while General Settings page is open
    watch(
      () => store.state.organizationData?.organizationSettings,
      () => {
        // Only update from org settings if user is NOT actively previewing a color
        // If temp colors exist in store, skip update to preserve the preview
        updateFromStore();
      },
      { deep: true, immediate: true }, // Deep watch to catch nested property changes
    );

    // A clean form follows the store (late load, another admin's save); a dirty one keeps the user's edits.
    watch(
      () => [
        orgSettings.value?.scrape_interval,
        orgSettings.value?.max_series_per_query,
        store.state.zoConfig?.custom_logo_text,
      ],
      () => {
        if (formChanges.value === 0) form.reset(savedFormValues());
      },
    );

    // Runs only once the schema passes; the number inputs emit text, so coerce at use.
    const saveGeneralSettings = async (value: GeneralSettingsForm) => {
      const maxSeriesRaw = value.max_series_per_query;
      const maxSeriesNum =
        maxSeriesRaw === null || maxSeriesRaw === undefined || maxSeriesRaw === ""
          ? null
          : Number(maxSeriesRaw);

      // Only the fields this form owns: the backend applies what is present, and Vuex may hold values another admin changed since.
      const owned = {
        scrape_interval: Number(value.scrape_interval),
        max_series_per_query: maxSeriesNum,
        light_mode_theme_color: customLightColor.value,
        dark_mode_theme_color: customDarkColor.value,
      };

      const base = form.options.defaultValues as GeneralSettingsForm;
      const textChanged = (value.custom_logo_text ?? "") !== (base.custom_logo_text ?? "");
      const text = sanitizeInput(value.custom_logo_text ?? "");
      const logos = LOGO_MODES.filter((mode) => logoFiles[mode].value);
      // A branding-only edit must not rewrite, or fail on, organization settings nobody touched.
      const brandingChanges = Number(textChanged) + logos.length;
      const sendOrg = brandingChanges === 0 || changeCount.value > brandingChanges;

      const savedOrg = store.state?.selectedOrganization?.identifier;
      const [orgSaved, textSaved, logosSaved] = await Promise.all([
        sendOrg && saveOrgPart(owned),
        textChanged && saveLogoText(text),
        saveLogos(logos),
      ]);
      // The store holds only the selected organization: a save that outlives a switch has nowhere to land.
      if (store.state?.selectedOrganization?.identifier !== savedOrg) return;
      // Stored only after the write succeeds, so a failed save leaves the bar in its changed state.
      if (orgSaved) {
        store.dispatch("setOrganizationSettings", {
          ...store.state?.organizationData?.organizationSettings,
          ...owned,
        });
        // The layout re-applies the stored theme when settings change; the saved color goes on after it.
        await nextTick();
      }
      // A switch away and back replaced this page; the form and preview colors now belong to its successor.
      if (unmounted || (!orgSaved && !textSaved && logosSaved.length === 0)) return;

      // A failed or unsent part keeps its old baseline, so its edits stay counted as unsaved.
      const orgFields = (
        from: Pick<GeneralSettingsForm, "scrape_interval" | "max_series_per_query">,
      ) => ({
        scrape_interval: from.scrape_interval,
        max_series_per_query: from.max_series_per_query,
      });
      rebaseSavedValues(
        form,
        {
          ...orgFields(
            orgSaved
              ? {
                  scrape_interval: fieldText(owned.scrape_interval),
                  max_series_per_query: fieldText(owned.max_series_per_query),
                }
              : base,
          ),
          custom_logo_text: textSaved ? text : base.custom_logo_text,
        },
        {
          ...orgFields(orgSaved ? value : base),
          custom_logo_text: textSaved ? value.custom_logo_text : base.custom_logo_text,
        },
      );

      // A color picked while the request was pending is still an unsaved preview, so it stays.
      if (
        orgSaved &&
        customLightColor.value === owned.light_mode_theme_color &&
        customDarkColor.value === owned.dark_mode_theme_color
      ) {
        const currentMode = isDark.value ? "dark" : "light";
        const color = currentMode === "light" ? customLightColor.value : customDarkColor.value;
        applyThemeColors(color, currentMode, false);
        store.commit("clearTempThemeColors");
      }

      toast({ variant: "success", message: savedMessage(!!orgSaved, !!textSaved, logosSaved) });
    };

    // One message per Save: a lone branding part is named, anything more is summed up.
    const savedMessage = (orgSaved: boolean, textSaved: boolean, logos: LogoMode[]) => {
      if (orgSaved) return t("settings.organizationSettingsUpdated");
      if (textSaved && logos.length === 0) return t("settings.logoTextUpdatedSuccessfully");
      if (!textSaved && logos.length === 1) {
        return t("settings.logoUpdatedSuccessfully", { mode: logoModeLabel(logos[0]) });
      }
      return t("settings.general.brandingUpdated");
    };

    const saveOrgPart = async (owned: Record<string, unknown>): Promise<boolean> => {
      try {
        await updateOrgSettings.mutateAsync(owned);
        analytics.track("org_general_settings_saved", {
          custom_theme:
            owned.light_mode_theme_color !== DEFAULT_LIGHT_COLOR ||
            owned.dark_mode_theme_color !== DEFAULT_DARK_COLOR,
        });
        return true;
      } catch (err: any) {
        toast({
          variant: "error",
          message: err?.message || t("settings.somethingWentWrong"),
        });
        return false;
      }
    };

    // Branding text is instance-wide with its own endpoint: a second request that fails on its own.
    const saveLogoText = async (text: string): Promise<boolean> => {
      try {
        const res: any = await updateCustomLogoText.mutateAsync(text);
        if (res?.status != 200) throw new Error(res?.message);
        store.dispatch("setConfig", {
          ...JSON.parse(JSON.stringify(store.state.zoConfig)),
          custom_logo_text: text,
        });
        return true;
      } catch (err: any) {
        toast({
          variant: "error",
          message: t("settings.general.logoTextSaveFailed", {
            reason:
              err?.response?.data?.message || err?.message || t("settings.somethingWentWrong"),
          }),
        });
        return false;
      }
    };

    const logoModeLabel = (mode: LogoMode) =>
      mode === "dark" ? t("settings.darkMode") : t("settings.lightMode");

    // Each logo is its own request and fails on its own; a failed one keeps its file chosen.
    const saveLogo = async (mode: LogoMode): Promise<boolean> => {
      const file = logoFiles[mode].value;
      if (!file) return false;
      const formData = new FormData();
      formData.append("image", file);
      try {
        const res: any = await settingsService.createLogo(brandingOrg(), formData, mode);
        if (res?.status != 200) throw new Error(res?.message);
        if (logoFiles[mode].value === file) logoFiles[mode].value = null;
        return true;
      } catch (err: any) {
        toast({
          variant: "error",
          message: t("settings.general.logoSaveFailed", {
            mode: logoModeLabel(mode),
            reason:
              err?.response?.data?.message || err?.message || t("settings.errorUploadingImage"),
          }),
        });
        return false;
      }
    };

    const saveLogos = async (modes: LogoMode[]): Promise<LogoMode[]> => {
      const done = await Promise.all(modes.map(saveLogo));
      const saved = modes.filter((_, index) => done[index]);
      if (saved.length > 0) await refreshConfig();
      return saved;
    };

    // Forced: a logo just changed, so the cached config is the one thing that must not answer here.
    const refreshConfig = async () => {
      const query = configFullQuery(brandingOrg());
      try {
        await queryClient.invalidateQueries({
          queryKey: query.queryKey,
          exact: true,
          refetchType: "none",
        });
        const fresh: any = await queryClient.fetchQuery(query);
        // Text saved by the same Save may land after this read started; the store's copy is the newer one.
        store.dispatch("setConfig", {
          ...fresh,
          custom_logo_text: store.state.zoConfig?.custom_logo_text ?? fresh?.custom_logo_text,
        });
      } catch {
        // The upload itself is stored; the next load of the config shows it.
      }
    };

    const deleteLogo = (mode: string = "light") => {
      loadingState.value = true;
      let orgIdentifier = "default";
      for (let item of store.state.organizations) {
        if (item.type == "default") {
          orgIdentifier = item.identifier;
        }
      }
      settingsService
        .deleteLogo(store.state.selectedOrganization?.identifier || orgIdentifier, mode)
        .then(async (res: any) => {
          if (res.status == 200) {
            toast({
              variant: "success",
              message: t("settings.logoDeletedSuccessfully", {
                mode: mode === "dark" ? t("settings.darkMode") : t("settings.lightMode"),
              }),
            });

            // Forced: the logo just changed, so the cached config is the one
            // thing that must not answer here.
            store.dispatch(
              "setConfig",
              await queryClient
                .invalidateQueries({
                  queryKey: configFullQuery(
                    store.state.selectedOrganization?.identifier || orgIdentifier,
                  ).queryKey,
                  exact: true,
                  refetchType: "none",
                })
                .then(() =>
                  queryClient.fetchQuery(
                    configFullQuery(store.state.selectedOrganization?.identifier || orgIdentifier),
                  ),
                ),
            );
          } else {
            toast({
              variant: "error",
              message: res?.message || t("settings.errorDeletingImage"),
            });
          }
        })
        .catch(() => {
          toast({
            variant: "error",
            message: t("settings.somethingWentWrong"),
          });
        })
        .finally(() => {
          loadingState.value = false;
        });
    };

    const sanitizeInput = (text: string): string => {
      // Limit input to 100 characters

      // Used DOMPurify for thorough sanitization
      return DOMPurify.sanitize(text);
    };

    // ========== Theme Management Functions ==========

    /**
     * Handle theme chip click - switches theme mode and opens color picker
     * This provides a unified interaction: click to switch mode, then customize color
     * @param mode - 'light' or 'dark' theme mode to switch to
     */
    const handleThemeChipClick = (mode: "light" | "dark") => {
      // First, switch the theme mode if it's different from current
      // eslint-disable-next-line no-restricted-syntax -- theme-setting guard, not a theme read: compares the current mode against the target before switching. useTheme().isDark is a boolean and cannot express "is it already this specific mode".
      if (store.state.theme !== mode) {
        toggleThemeMode(mode);
      }

      // Then open the color picker for customization
      openColorPicker(mode);
    };

    /**
     * Open color picker dialog for light or dark mode
     * @param mode - 'light' or 'dark' theme mode to edit
     */
    const openColorPicker = (mode: "light" | "dark") => {
      currentPickerMode.value = mode;
      // Initialize tempColor with current color for this mode
      tempColor.value = mode === "light" ? customLightColor.value : customDarkColor.value;
      showColorPicker.value = true;
    };

    /**
     * Handle color picker dialog close
     * Temp colors remain in Vuex store for preview until user clicks "Save"
     */
    const onColorPickerClose = () => {
      // No action needed - temp colors stay in store for continued preview
    };

    /**
     * Update custom color as user drags the color picker (live preview)
     * This function is called on every color change via @update:model-value
     *
     * Flow:
     * 1. Update local ref (customLightColor or customDarkColor)
     * 2. Save to Vuex store (tempThemeColors) so it persists across navigation
     * 3. Apply theme immediately to UI for live preview
     *
     * Note: Color is NOT saved permanently until user clicks "Save" button
     */
    const updateCustomColor = () => {
      // Update the local ref for the current mode
      if (currentPickerMode.value === "light") {
        customLightColor.value = tempColor.value;
      } else {
        customDarkColor.value = tempColor.value;
      }

      // Store temporarily in Vuex store
      // This makes the color available to App.vue and PredefinedThemes.vue
      // and prevents other watchers/observers from overriding it
      store.commit("setTempThemeColor", {
        mode: currentPickerMode.value,
        color: tempColor.value,
      });

      // Apply the theme immediately to the UI for live preview
      // isDefault=false because user is customizing the color
      applyThemeColors(tempColor.value, currentPickerMode.value, false);
    };

    const resetThemeColors = () => {
      // Reset to default colors
      customLightColor.value = DEFAULT_LIGHT_COLOR;
      customDarkColor.value = DEFAULT_DARK_COLOR;

      // Store temporarily in Vuex store
      store.commit("setTempThemeColor", {
        mode: "light",
        color: DEFAULT_LIGHT_COLOR,
      });
      store.commit("setTempThemeColor", {
        mode: "dark",
        color: DEFAULT_DARK_COLOR,
      });

      // Apply the theme immediately for current mode.
      // isDefault=false so the default theme's (O2 Signature) actual colors are
      // applied rather than reverting to the base stylesheet palette.
      const currentMode = isDark.value ? "dark" : "light";
      const color = currentMode === "light" ? DEFAULT_LIGHT_COLOR : DEFAULT_DARK_COLOR;
      applyThemeColors(color, currentMode, false);

      // Show notification
      toast({
        variant: "success",
        message: t("settings.themeColorsResetSuccess"),
      });
    };

    /**
     * Toggle between light and dark theme modes
     * Updates the store, dark mode, and applies the corresponding theme color
     * @param mode - 'light' or 'dark' theme mode to switch to
     */
    const toggleThemeMode = (mode: "light" | "dark") => {
      // Persist theme preference to localStorage
      localStorage.setItem("theme", mode);

      // Get the color for the new mode
      const color = mode === "light" ? customLightColor.value : customDarkColor.value;

      // All DOM writes of the switch run inside switchThemeMode so the mode
      // flip cross-fades as one frame.
      switchThemeMode(mode, () => {
        // Update theme mode in store
        store.dispatch("appTheme", mode);

        // Update dark mode — this is critical for proper theme application
        document.documentElement.classList.toggle("dark", mode === "dark");

        // Apply the theme color for the new mode. isDefault=false so the resolved
        // color (including the O2 Signature default) is always applied directly.
        applyThemeColors(color, mode, false);
      });
    };

    // Unsaved preview colors live in the store; left there they repaint other pages with the wrong palette.
    const restoreSavedTheme = () => {
      if (!store || !store.state) return;
      const hasTempColors = store.state.tempThemeColors?.light || store.state.tempThemeColors?.dark;
      if (!hasTempColors) return;
      store.commit("clearTempThemeColors");

      const currentMode = isDark.value ? "dark" : "light";
      const defaultLight = store.state.defaultThemeColors?.light || "#3F7994";
      const defaultDark = store.state.defaultThemeColors?.dark || "#5B9FBE";

      const savedLight =
        localStorage.getItem("customLightColor") ||
        store.state?.organizationData?.organizationSettings?.light_mode_theme_color ||
        defaultLight;
      const savedDark =
        localStorage.getItem("customDarkColor") ||
        store.state?.organizationData?.organizationSettings?.dark_mode_theme_color ||
        defaultDark;

      const color = currentMode === "light" ? savedLight : savedDark;
      const isDefault =
        (currentMode === "light" && color === defaultLight) ||
        (currentMode === "dark" && color === defaultDark);

      applyThemeColors(color, currentMode, isDefault);
    };

    const discardThemeColors = () => {
      customLightColor.value = savedLightColor.value;
      customDarkColor.value = savedDarkColor.value;
      restoreSavedTheme();
    };

    // The save bar resets the form's fields; colors and chosen files live outside the form.
    const discardOffForm = () => {
      discardThemeColors();
      filesLight.value = null;
      filesDark.value = null;
    };

    const discardUnsaved = () => {
      discardFormChanges(form);
      discardOffForm();
    };

    let unmounted = false;
    onBeforeUnmount(() => {
      unmounted = true;
      restoreSavedTheme();
    });

    // Settings pages are kept alive, so a confirmed leave must reset or the page comes back dirty.
    useLeaveGuard(() => settingsLoaded.value && changeCount.value > 0, {
      count: () => changeCount.value,
      onDiscard: discardUnsaved,
    });

    return {
      t,
      raw,
      store,
      config,
      router,
      form,
      settingsLoaded,
      changeCount,
      SAVE_BAR_SLOT,
      defaultMaxSeries,
      discardOffForm,
      saveGeneralSettings,
      filesLight,
      filesDark,
      logoThemeToDelete,
      filesImages: ref(null),
      filesMaxSize: ref(null),
      filesMaxTotalSize: ref(null),
      filesMaxNumber: ref(null),
      onRejected(rejectedEntries: string | any[]) {
        toast({
          variant: "error",
          message: t("settings.filesValidationFailed", {
            count: rejectedEntries.length,
          }),
        });
      },
      deleteLogo,
      loadingState,
      confirmDeleteImage: ref(false),
      sanitizeInput,
      // Theme management
      customLightColor,
      customDarkColor,
      showColorPicker,
      tempColor,
      handleThemeChipClick,
      onColorPickerClose,
      updateCustomColor,
      resetThemeColors,
      currentPickerMode,
      trialExpired,
      // Delete organization (Danger Zone)
      canDeleteOrg,
      confirmDeleteOrg,
      deleting,
      deleteOrg,
      deleteConfirmInput,
      deleteOrgName,
      deleteConfirmMatches,
      deleteOrgFacts,
      openDeleteOrgDialog,
      orgScope,
      orgScopeLoading,
      customBrandingAccess,
      onLockedBrandingClick,
    };
  },
});
</script>
