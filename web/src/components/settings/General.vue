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
    <!-- Section header (title + description) is provided full-width by the
         Settings shell; this component renders only the form content. -->
    <!-- platform settings section. The page gutter is owned by the Settings
         shell's ConstrainedPage; this block adds none of its own. -->
    <div>
      <GroupHeader :title="t('settings.platformSettings')" :showIcon="false" />
      <div class="tw:w-full tw:flex tw:flex-col">
        <OForm
          :schema="generalSettingsSchema"
          :default-values="generalSettingsDefaults"
          @submit="saveGeneralSettings"
          v-slot="{ isSubmitting }"
        >
          <!-- scape interval section -->
          <div class="settings-grid-item tw:grid tw:grid-cols-3 tw:gap-4 tw:items-center tw:py-4 tw:border-b tw:border-(--o2-border-color)">
            <span class="individual-setting-title tw:text-sm tw:font-medium tw:leading-5">
              {{ t("settings.scrapintervalLabel") }}
            </span>
            <OFormInput
              name="scrape_interval"
              type="number"
              min="0"
              class="tw:ml-2"
              data-test="general-settings-scrape-interval"
              style="width: 120px"
            />
            <span class="individual-setting-description tw:text-[13px] tw:opacity-70">
              {{ t("settings.scrapeIntervalDescription") }}
            </span>
          </div>

          <!-- Max Series Per Query section -->
          <div class="settings-grid-item tw:grid tw:grid-cols-3 tw:gap-4 tw:items-center tw:py-4 tw:border-b tw:border-(--o2-border-color)">
            <span class="individual-setting-title tw:text-sm tw:font-medium tw:leading-5">
              {{ t("settings.maxSeriesPerQueryLabel") }}
            </span>
            <OFormInput
              name="max_series_per_query"
              type="number"
              :min="1000"
              :max="1000000"
              class="tw:ml-2"
              :placeholder="'40000 (' + t('settings.systemDefault') + ')'"
              data-test="general-settings-max-series-per-query"
              style="width: 180px"
            >
              <template v-slot:icon-right>
                <OIcon name="info" size="sm" class="tw:cursor-pointer">
                  <OTooltip side="top" :content="t('settings.maxSeriesPerQueryTooltip')" />
                </OIcon>
              </template>
            </OFormInput>
            <span class="individual-setting-description tw:text-[13px] tw:opacity-70">
              {{ t("settings.maxSeriesPerQueryDescription") }}
            </span>
          </div>

          <!-- Manage Theme section -->
          <div class="settings-grid-item tw:grid tw:grid-cols-3 tw:gap-4 tw:items-center tw:py-4 tw:border-b tw:border-(--o2-border-color)">
            <span class="individual-setting-title tw:text-sm tw:font-medium tw:leading-5">
              {{ t("settings.manageTheme") }}
            </span>
            <div
              class="tw:flex tw:gap-2 tw:items-center"
              style="margin-left: -60px"
            >
              <!-- Light Mode Theme -->
              <div
                class="tw:group/chip tw:inline-flex tw:items-center tw:gap-2 tw:py-[6px] tw:pr-3 tw:pl-[6px] tw:rounded-[20px] tw:cursor-pointer tw:transition-all tw:duration-200 tw:bg-[rgba(0,0,0,0.04)] tw:border tw:border-[rgba(0,0,0,0.1)] tw:hover:bg-[rgba(0,0,0,0.06)] tw:hover:border-(--o2-primary-color) tw:hover:-translate-y-px tw:hover:shadow-[0_2px_8px_rgba(0,0,0,0.1)] tw:dark:bg-[rgba(255,255,255,0.05)] tw:dark:border-[rgba(255,255,255,0.15)] tw:dark:hover:bg-[rgba(255,255,255,0.08)] tw:dark:hover:shadow-[0_2px_8px_rgba(0,0,0,0.3)]"
                @click="handleThemeChipClick('light')"
                data-test="theme-light-chip"
              >
                <div
                  class="color-circle tw:w-6 tw:h-6 tw:rounded-full tw:shrink-0 tw:flex tw:items-center tw:justify-center tw:shadow-[0_1px_3px_rgba(0,0,0,0.2)] tw:relative tw:overflow-hidden"
                  :style="{ backgroundColor: customLightColor }"
                >
                  <OIcon
                    name="palette"
                    size="xs"
                    class="tw:opacity-0 tw:transition-opacity tw:duration-200 tw:[filter:drop-shadow(0_1px_1px_rgba(0,0,0,0.3))] tw:group-hover/chip:opacity-90"
                  />
                </div>
                <span class="chip-label tw:text-[11px] tw:font-semibold tw:opacity-50 tw:tracking-[0.5px]">{{ t("settings.light") }}</span>
                <span class="chip-value tw:font-['SF_Mono','Monaco','Menlo',monospace] tw:text-[11px] tw:font-medium tw:opacity-70 tw:tracking-[-0.2px]">{{ customLightColor }}</span>
              </div>

              <!-- Dark Mode Theme -->
              <div
                class="tw:group/chip tw:inline-flex tw:items-center tw:gap-2 tw:py-[6px] tw:pr-3 tw:pl-[6px] tw:rounded-[20px] tw:cursor-pointer tw:transition-all tw:duration-200 tw:bg-[rgba(0,0,0,0.04)] tw:border tw:border-[rgba(0,0,0,0.1)] tw:hover:bg-[rgba(0,0,0,0.06)] tw:hover:border-(--o2-primary-color) tw:hover:-translate-y-px tw:hover:shadow-[0_2px_8px_rgba(0,0,0,0.1)] tw:dark:bg-[rgba(255,255,255,0.05)] tw:dark:border-[rgba(255,255,255,0.15)] tw:dark:hover:bg-[rgba(255,255,255,0.08)] tw:dark:hover:shadow-[0_2px_8px_rgba(0,0,0,0.3)]"
                @click="handleThemeChipClick('dark')"
                data-test="theme-dark-chip"
              >
                <div
                  class="color-circle tw:w-6 tw:h-6 tw:rounded-full tw:shrink-0 tw:flex tw:items-center tw:justify-center tw:shadow-[0_1px_3px_rgba(0,0,0,0.2)] tw:relative tw:overflow-hidden"
                  :style="{ backgroundColor: customDarkColor }"
                >
                  <OIcon
                    name="palette"
                    size="xs"
                    class="tw:opacity-0 tw:transition-opacity tw:duration-200 tw:[filter:drop-shadow(0_1px_1px_rgba(0,0,0,0.3))] tw:group-hover/chip:opacity-90"
                  />
                </div>
                <span class="chip-label tw:text-[11px] tw:font-semibold tw:opacity-50 tw:tracking-[0.5px]">{{ t("settings.dark") }}</span>
                <span class="chip-value tw:font-['SF_Mono','Monaco','Menlo',monospace] tw:text-[11px] tw:font-medium tw:opacity-70 tw:tracking-[-0.2px]">{{ customDarkColor }}</span>
              </div>

              <!-- Reset Button -->
              <div
                class="tw:group/resetChip tw:inline-flex tw:items-center tw:justify-center tw:w-8 tw:h-8 tw:rounded-full tw:cursor-pointer tw:transition-all tw:duration-200 tw:bg-transparent tw:border tw:border-dashed tw:border-[rgba(0,0,0,0.2)] tw:opacity-60 tw:hover:bg-[rgba(239,68,68,0.08)] tw:hover:border-[rgba(239,68,68,0.4)] tw:hover:border-solid tw:hover:opacity-100 tw:hover:-translate-y-px tw:hover:rotate-180 tw:dark:border-[rgba(255,255,255,0.25)] tw:dark:hover:bg-[rgba(239,68,68,0.15)] tw:dark:hover:border-[rgba(239,68,68,0.5)]"
                @click="resetThemeColors"
                data-test="reset-theme-colors-btn"
              >
                <OIcon name="refresh" size="sm" class="tw:group-hover/resetChip:text-[rgb(239,68,68)] tw:dark:group-hover/resetChip:text-[rgb(248,113,113)]" />
                <OTooltip :content="t('settings.resetToDefaultColors')" side="top" />
              </div>
            </div>
            <span class="individual-setting-description tw:self-start tw:text-[13px] tw:opacity-70">
              {{ t("settings.themeManagementDescription") }}
            </span>
          </div>

          <span>&nbsp;</span>

          <div class="tw:flex tw:justify-start">
            <OButton
              data-test="dashboard-add-submit"
              :loading="isSubmitting"
              variant="primary"
              size="sm-action"
              type="submit"
            >
              {{ t("dashboard.save") }}
            </OButton>
          </div>
        </OForm>
      </div>
    </div>
    <div
      id="enterpriseFeature"
      v-if="
        config.isEnterprise == 'true' &&
        store.state.zoConfig.meta_org ==
          store.state.selectedOrganization.identifier
      "
    >
      <div class="tw:py-2">
        <GroupHeader
          :title="t('settings.enterpriseFeatures')"
          :showIcon="false"
        />
      </div>
      <div>
        <div class="settings-grid-item no-border-bottom tw:grid tw:grid-cols-3 tw:gap-4 tw:items-center tw:py-4 tw:border-b tw:border-(--o2-border-color)">
          <span class="individual-setting-title tw:text-sm tw:font-medium tw:leading-5">
            {{ t("settings.customLogoText") }}
          </span>
          <div
            v-if="editingText || store.state.zoConfig.custom_logo_text == ''"
            class="tw:flex tw:gap-2 tw:items-center"
          >
            <OInput
              class="tw:w-[250px] tw:mr-sm"
              data-test="settings_ent_logo_custom_text"
              v-model="customText"
            />
            <div class="tw:flex tw:gap-x-2">
              <OButton
                type="button"
                variant="outline-destructive"
                size="icon-xs-sq"
                @click="cancelLogoText"
                icon-left="close"
              />
              <OButton
                data-test="settings_ent_logo_custom_text_save_btn"
                :loading="loadingState"
                variant="outline"
                size="icon-xs-sq"
                type="button"
                @click="updateCustomText"
                icon-left="check"
              />
            </div>
          </div>
          <div v-else class="tw:flex tw:items-center">
            <span class="tw:w-[190px] tw:text-center tw:truncate"
              >{{
                store.state.zoConfig.custom_logo_text ||
                t("settings.noTextAvailable")
              }}
              <OTooltip
                v-if="store.state.zoConfig.custom_logo_text.length > 20"
                side="top"
                align="center"
                max-width="250px"
                :content="store.state.zoConfig.custom_logo_text"
              />
            </span>
            <OButton
              data-test="settings_ent_logo_custom_text_edit_btn"
              :loading="loadingState"
              variant="outline"
              size="icon-xs-sq"
              class="tw:ml-2"
              type="button"
              @click="editingText = !editingText"
              icon-left="edit"
            />
          </div>
          <span class="individual-setting-description tw:text-[13px] tw:opacity-70">
            {{ t("settings.customLogoTextDescription") }}
          </span>
        </div>
        <!-- Light Mode Logo -->
        <div class="settings-grid-item tw:grid tw:grid-cols-3 tw:gap-4 tw:items-center tw:py-4 tw:border-b tw:border-(--o2-border-color)">
          <div class="tw:pt-2 individual-setting-title tw:text-sm tw:font-medium tw:leading-5 tw:w-full tw:mb-5">
            {{ t("settings.customLogoTitle") }} ({{ t("settings.lightMode") }})
          </div>
          <div
            v-if="
              store.state.zoConfig.hasOwnProperty('custom_logo_img') &&
              store.state.zoConfig.custom_logo_img != null
            "
            class="tw:w-full"
          >
            <img
              data-test="setting_ent_custom_logo_img"
              :src="
                `data:image; base64, ` + store.state.zoConfig.custom_logo_img
              "
              :alt="t('settings.logoLabel')"
              style="max-width: 150px; max-height: 31px"
              class="tw:mx-3"
            />
            <OButton
              data-test="setting_ent_custom_logo_img_delete_btn"
              variant="ghost-destructive"
              size="icon-xs-sq"
              class="tw:mx-3"
              @click="confirmDeleteLogo('light')"
              icon-left="delete"
            />
          </div>
          <div v-else class="tw:flex tw:items-start tw:gap-2">
            <OFile
              data-test="setting_ent_custom_logo_img_file_upload"
              v-model="filesLight"
              :label="t('settings.dragDropUpload')"
              counter
              :counter-label="counterLabelFn"
              accept=".png, .jpg, .jpeg, .gif, .bmp, .jpeg2, image/*"
              @rejected="onRejected"
              :help-text="t('settings.fileFormatConstraint')"
              class="tw:mx-0 o2-file-input"
            >
              <template v-slot:prepend>
                <OIcon name="attach-file" size="sm" />
              </template>
            </OFile>
            <div class="tw:flex tw:gap-x-2 tw:pt-5.75">
              <OButton
                type="button"
                variant="outline-destructive"
                size="icon-xs-sq"
                @click="filesLight = null"
                icon-left="close"
              />
              <OButton
                data-test="settings_ent_logo_custom_light_save_btn"
                :loading="loadingState"
                variant="outline"
                size="icon-xs-sq"
                type="button"
                @click="uploadImage(filesLight, 'light')"
                icon-left="check"
              />
            </div>
          </div>
          <span class="individual-setting-description tw:-translate-y-[5px] tw:text-[13px] tw:opacity-70">
              {{ t("settings.customLogoLightDescription") }}
            </span>
          </div>

        <!-- Dark Mode Logo -->
        <div class="settings-grid-item tw:grid tw:grid-cols-3 tw:gap-4 tw:items-center tw:py-4 tw:border-b tw:border-(--o2-border-color)">
          <div class="tw:pt-2 individual-setting-title tw:text-sm tw:font-medium tw:leading-5 tw:w-full tw:mb-5">
            {{ t("settings.customLogoTitle") }} ({{ t("settings.darkMode") }})
          </div>
          <div
            v-if="
              store.state.zoConfig.hasOwnProperty('custom_logo_dark_img') &&
              store.state.zoConfig.custom_logo_dark_img != null
            "
            class="tw:w-full"
          >
            <img
              data-test="setting_ent_custom_logo_dark_img"
              :src="
                `data:image; base64, ` +
                store.state.zoConfig.custom_logo_dark_img
              "
              :alt="t('settings.logoLabel')"
              style="max-width: 150px; max-height: 31px"
              class="tw:mx-3"
            />
            <OButton
              data-test="setting_ent_custom_logo_dark_img_delete_btn"
              variant="ghost-destructive"
              size="icon-xs-sq"
              class="tw:mx-3"
              @click="confirmDeleteLogo('dark')"
              icon-left="delete"
            />
          </div>
          <div v-else class="tw:flex tw:items-start tw:gap-2">
            <OFile
              data-test="setting_ent_custom_logo_dark_img_file_upload"
              v-model="filesDark"
              :label="t('settings.dragDropUpload')"
              counter
              :counter-label="counterLabelFn"
              accept=".png, .jpg, .jpeg, .gif, .bmp, .jpeg2, image/*"
              @rejected="onRejected"
              :help-text="t('settings.fileFormatConstraint')"
              class="tw:mx-0 o2-file-input"
            >
              <template v-slot:prepend>
                <OIcon name="attach-file" size="sm" />
              </template>
            </OFile>
            <div class="tw:flex tw:gap-x-2 tw:pt-5.75">
              <OButton
                type="button"
                variant="outline-destructive"
                size="icon-xs-sq"
                @click="filesDark = null"
                icon-left="close"
              />
              <OButton
                data-test="settings_ent_logo_custom_dark_save_btn"
                :loading="loadingState"
                variant="outline"
                size="icon-xs-sq"
                type="button"
                @click="uploadImage(filesDark, 'dark')"
                icon-left="check"
              />
            </div>
          </div>
          <span class="individual-setting-description tw:-translate-y-[5px] tw:text-[13px] tw:opacity-70">
              {{ t("settings.customLogoDarkDescription") }}
            </span>
          </div>
      </div>
    </div>
  </div>
  <OSpinner
    v-if="loadingState"
    size="md"
    class="tw:fixed tw:top-1/2 tw:left-1/2 tw:-translate-x-1/2 tw:-translate-y-1/2"
    data-test="general-settings-loading-indicator"
  />
  <ODialog data-test="general-delete-image-dialog"
    v-model:open="confirmDeleteImage"
    size="sm"
    :title="t('settings.deleteLogoTitle')"
    :secondary-button-label="t('confirmDialog.cancel')"
    :primary-button-label="t('confirmDialog.ok')"
    @click:secondary="cancelConfirmDialog"
    @click:primary="confirmDialogOK"
  >
    <p>{{ t('settings.deleteLogoMessage') }}</p>
  </ODialog>

  <ODialog data-test="general-color-picker-dialog"
    v-model:open="showColorPicker"
    @update:open="(v) => !v && onColorPickerClose()"
    size="xs"
    :title="t('settings.pickCustomColor')"
    primary-button-label="Close"
    @click:primary="showColorPicker = false"
  >
    <OColor v-model="tempColor" @update:model-value="updateCustomColor" />
  </ODialog>
</template>

<script lang="ts">
// @ts-ignore
import { computed, defineComponent, onActivated, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import organizations from "@/services/organizations";
import settingsService from "@/services/settings";
import config from "@/aws-exports";
import configService from "@/services/config";
import DOMPurify from "dompurify";
import GroupHeader from "../common/GroupHeader.vue";
import store from "@/test/unit/helpers/store";
import { applyThemeColors } from "@/utils/theme";
import OButton from "@/lib/core/Button/OButton.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OFile from "@/lib/forms/File/OFile.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OColor from "@/lib/forms/Color/OColor.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import {
  makeGeneralSettingsSchema,
  type GeneralSettingsForm,
} from "./General.schema";

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
    GroupHeader,
    OButton,
    ODialog,
    OSpinner,
    OIcon,
    OTooltip,
    OInput,
    OFile,
    OForm,
    OFormInput,
    OColor,
},
  setup() {
    const { t } = useI18n();

    const store = useStore();
    const router: any = useRouter();

    // Schema-driven validation replaces the manual scrapeIntervalError /
    // maxSeriesError refs + the imperative if-checks in onSubmit.
    // Built once from the component's `t` so the messages are localized.
    const generalSettingsSchema = makeGeneralSettingsSchema(t);
    // Dynamic defaults (edit-prefill from the store) → a typed computed.
    const generalSettingsDefaults = computed((): GeneralSettingsForm => ({
      scrape_interval:
        store.state?.organizationData?.organizationSettings?.scrape_interval ??
        15,
      max_series_per_query:
        store.state?.organizationData?.organizationSettings
          ?.max_series_per_query ?? null,
    }));

    const loadingState = ref(false);
    const customText = ref("");
    const editingText = ref(false);
    const files = ref(null);
    const filesLight = ref(null);
    const filesDark = ref(null);
    const logoThemeToDelete = ref<string>("light");

    customText.value = store.state.zoConfig.custom_logo_text;

    // Theme management state
    // Get default colors from Vuex store (centralized - can be updated in one place)
    const DEFAULT_LIGHT_COLOR = store.state.defaultThemeColors.light;
    const DEFAULT_DARK_COLOR = store.state.defaultThemeColors.dark;

    // Custom theme colors for light and dark modes
    // Priority: Vuex store tempThemeColors > organizationSettings (backend) > defaults
    // These refs display the current color in the UI and in the color picker
    const customLightColor = ref(
      store.state.tempThemeColors?.light ||
        store.state?.organizationData?.organizationSettings
          ?.light_mode_theme_color ||
        DEFAULT_LIGHT_COLOR,
    );
    const customDarkColor = ref(
      store.state.tempThemeColors?.dark ||
        store.state?.organizationData?.organizationSettings
          ?.dark_mode_theme_color ||
        DEFAULT_DARK_COLOR,
    );

    // Color picker dialog state
    const showColorPicker = ref(false); // Controls dialog visibility
    const currentPickerMode = ref<"light" | "dark">("light"); // Which mode is being edited
    const tempColor = ref(DEFAULT_LIGHT_COLOR); // Bound to q-color component

    /**
     * Update theme colors from Vuex store
     * Called on component mount and when organization settings change
     * Priority: Vuex store tempThemeColors > organizationSettings > defaults
     */
    const updateFromStore = () => {
      // (scrape_interval is now form-owned via :default-values — no ref to sync.)

      // Get theme colors from store with priority order
      // 1. Check Vuex store for temporary preview colors (highest priority)
      // 2. Check organization settings for backend defaults
      // 3. Use application defaults
      const tempLightFromStore = store.state.tempThemeColors?.light;
      const tempDarkFromStore = store.state.tempThemeColors?.dark;

      const newLightColor =
        tempLightFromStore ||
        store.state?.organizationData?.organizationSettings
          ?.light_mode_theme_color ||
        DEFAULT_LIGHT_COLOR;
      const newDarkColor =
        tempDarkFromStore ||
        store.state?.organizationData?.organizationSettings
          ?.dark_mode_theme_color ||
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
        const currentMode = store.state.theme === "dark" ? "dark" : "light";
        const color = currentMode === "light" ? newLightColor : newDarkColor;
        const isDefault =
          color === DEFAULT_LIGHT_COLOR || color === DEFAULT_DARK_COLOR;
        applyThemeColors(color, currentMode, isDefault);
      }
    };

    onActivated(() => {
      // Initialize from store on mount
      updateFromStore();
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

    watch(
      () => editingText.value,
      (value) => {
        if (!value) {
          customText.value = store.state.zoConfig.custom_logo_text;
        }
      },
    );

    // @submit handler — fires only once the schema passes (scrape_interval
    // required + ≥0; max_series_per_query optional range). The <input
    // type="number"> emits a string, so coerce at use. Awaited by OForm so the
    // inline Save button's spinner spans the POST (no useLoading wrapper).
    const saveGeneralSettings = async (value: GeneralSettingsForm) => {
      const maxSeriesRaw = value.max_series_per_query;
      const maxSeriesNum =
        maxSeriesRaw === null || maxSeriesRaw === undefined || maxSeriesRaw === ""
          ? null
          : Number(maxSeriesRaw);

      try {
        //set organizations settings in store
        //scrape interval will be in number
        store.dispatch("setOrganizationSettings", {
          ...store.state?.organizationData?.organizationSettings,
          scrape_interval: Number(value.scrape_interval),
          max_series_per_query: maxSeriesNum,
          light_mode_theme_color: customLightColor.value,
          dark_mode_theme_color: customDarkColor.value,
        });

        //update settings in backend
        await organizations.post_organization_settings(
          store.state?.selectedOrganization?.identifier,
          store.state?.organizationData?.organizationSettings,
        );

        // Apply the current mode's theme
        const currentMode = store.state.theme === "dark" ? "dark" : "light";
        const color =
          currentMode === "light"
            ? customLightColor.value
            : customDarkColor.value;
        applyThemeColors(color, currentMode, false);

        // Clear temporary theme colors from store since we're saving permanently
        store.commit("clearTempThemeColors");

        toast({
          variant: "success",
          message: t("settings.organizationSettingsUpdated"),
        });
      } catch (err: any) {
        toast({
          variant: "error",
          message: err?.message || t("settings.somethingWentWrong"),
        });
      }
    };

    const uploadImage = (fileList: any = null, theme: string = "light") => {
      const selectedFiles = fileList || files.value;
      // Handle single file or file array
      //but mostly we will support single file because we only show one image at a time right
      let fileToUpload = null;
      if (selectedFiles) {
        if (Array.isArray(selectedFiles)) {
          fileToUpload = selectedFiles[0];
        } else {
          fileToUpload = selectedFiles;
        }
      }

      if (config.isEnterprise == "true" && fileToUpload) {
        loadingState.value = true;
        const formData = new FormData();
        formData.append("image", fileToUpload);
        let orgIdentifier = "default";
        for (let item of store.state.organizations) {
          if (item.type == "default") {
            orgIdentifier = item.identifier;
          }
        }
        settingsService
          .createLogo(
            store.state.selectedOrganization?.identifier || orgIdentifier,
            formData,
            theme,
          )
          .then(async (res) => {
            if (res.status == 200) {
              toast({
                variant: "success",
                message: t("settings.logoUpdatedSuccessfully", {
                  mode:
                    theme === "dark"
                      ? t("settings.darkMode")
                      : t("settings.lightMode"),
                }),
              });

              await configService.get_config().then((res: any) => {
                store.dispatch("setConfig", res.data);
              });

              // Clear the appropriate file ref
              if (theme === "dark") {
                filesDark.value = null;
              } else {
                filesLight.value = null;
              }
              files.value = null;
            } else {
              toast({
                variant: "error",
                message: t("settings.somethingWentWrong"),
              });
            }
          })
          .catch((e) => {
            toast({
              variant: "error",
              message: e?.message || t("settings.errorUploadingImage"),
            });
          })
          .finally(() => {
            loadingState.value = false;
          });
      } else if (config.isEnterprise != "true") {
        toast({
          variant: "error",
          message: t("settings.notAllowedAction"),
        });
      } else {
        toast({
          variant: "error",
          message: t("settings.selectFileToUpload"),
        });
      }
    };

    const deleteLogo = (theme: string = "light") => {
      loadingState.value = true;
      let orgIdentifier = "default";
      for (let item of store.state.organizations) {
        if (item.type == "default") {
          orgIdentifier = item.identifier;
        }
      }
      settingsService
        .deleteLogo(
          store.state.selectedOrganization?.identifier || orgIdentifier,
          theme,
        )
        .then(async (res: any) => {
          if (res.status == 200) {
            toast({
              variant: "success",
              message: t("settings.logoDeletedSuccessfully", {
                mode:
                  theme === "dark"
                    ? t("settings.darkMode")
                    : t("settings.lightMode"),
              }),
            });

            await configService.get_config().then((res: any) => {
              store.dispatch("setConfig", res.data);
            });
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
      tempColor.value =
        mode === "light" ? customLightColor.value : customDarkColor.value;
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
      const currentMode = store.state.theme === "dark" ? "dark" : "light";
      const color =
        currentMode === "light" ? DEFAULT_LIGHT_COLOR : DEFAULT_DARK_COLOR;
      applyThemeColors(color, currentMode, false);

      // Show notification
      toast({
        variant: "success",
        message: t("settings.themeColorsResetSuccess"),
      });
    };

    /**
     * Toggle between light and dark theme modes
     * Updates the store, Quasar dark mode, and applies the corresponding theme color
     * @param mode - 'light' or 'dark' theme mode to switch to
     */
    const toggleThemeMode = (mode: "light" | "dark") => {
      // Update theme mode in store
      store.dispatch("appTheme", mode);

      // Update dark mode — this is critical for proper theme application
      document.documentElement.classList.toggle("dark", mode === "dark");

      // Persist theme preference to localStorage
      localStorage.setItem("theme", mode);

      // Get the color for the new mode
      const color =
        mode === "light" ? customLightColor.value : customDarkColor.value;

      // Apply the theme color for the new mode. isDefault=false so the resolved
      // color (including the O2 Signature default) is always applied directly.
      applyThemeColors(color, mode, false);
    };

    const cancelLogoText = () => {
      editingText.value = false;
      customText.value = store.state.zoConfig.custom_logo_text;
    };

    const updateCustomText = () => {
      loadingState.value = true;
      let orgIdentifier = "default";
      for (let item of store.state.organizations) {
        if (item.type == "default") {
          orgIdentifier = item.identifier;
        }
      }

      customText.value = sanitizeInput(customText.value);
      if (customText.value.length > 100) {
        toast({
          variant: "error",
          message: t("settings.textMaxCharacters"),
        });
        loadingState.value = false;
        return;
      }

      settingsService
        .updateCustomText(
          store.state.selectedOrganization?.identifier || orgIdentifier,
          "custom_logo_text",
          customText.value,
        )
        .then(async (res: any) => {
          if (res.status == 200) {
            toast({
              variant: "success",
              message: t("settings.logoTextUpdatedSuccessfully"),
            });

            let stateConfig = JSON.parse(JSON.stringify(store.state.zoConfig));
            stateConfig.custom_logo_text = customText.value;
            store.dispatch("setConfig", stateConfig);
            editingText.value = false;
          } else {
            toast({
              variant: "error",
              message: res?.message || t("settings.errorUpdatingImage"),
            });
          }
        })
        .catch((err) => {
          toast({
            variant: "error",
            message: err?.message || t("settings.somethingWentWrong"),
          });
        })
        .finally(() => {
          loadingState.value = false;
        });
    };

    interface CounterLabelParams {
      totalSize: string;
      filesNumber: number;
    }

    /**
     * When navigating away from General Settings without saving, clear temp preview
     * colors and restore the correct colors for the current mode.
     *
     * Without this, tempThemeColors persists in the Vuex store and can cause
     * App.vue's initializeThemeColors() to apply stale/wrong CSS variables
     * when the user switches theme modes on other pages.
     */
    onBeforeUnmount(() => {
      if (!store || !store.state) return;
      const hasTempColors =
        store.state.tempThemeColors?.light || store.state.tempThemeColors?.dark;
      if (hasTempColors) {
        // Clear the unsaved preview colors from the store
        store.commit("clearTempThemeColors");

        // Re-apply the correct (saved) colors for the current mode so the rest
        // of the app doesn't remain stuck with the preview's CSS variables.
        const currentMode = store.state.theme === "dark" ? "dark" : "light";
        const defaultLight = store.state.defaultThemeColors?.light || "#3F7994";
        const defaultDark = store.state.defaultThemeColors?.dark || "#5B9FBE";

        const savedLight =
          localStorage.getItem("customLightColor") ||
          store.state?.organizationData?.organizationSettings
            ?.light_mode_theme_color ||
          defaultLight;
        const savedDark =
          localStorage.getItem("customDarkColor") ||
          store.state?.organizationData?.organizationSettings
            ?.dark_mode_theme_color ||
          defaultDark;

        const color = currentMode === "light" ? savedLight : savedDark;
        const isDefault =
          (currentMode === "light" && color === defaultLight) ||
          (currentMode === "dark" && color === defaultDark);

        applyThemeColors(color, currentMode, isDefault);
      }
    });

    return {
      t,
      store,
      config,
      router,
      // Form wiring (Options-API: schema + defaults MUST be returned so :schema
      // resolves and validation runs).
      generalSettingsSchema,
      generalSettingsDefaults,
      saveGeneralSettings,
      files,
      filesLight,
      filesDark,
      logoThemeToDelete,
      counterLabelFn(CounterLabelParams: { filesNumber: any; totalSize: any }) {
        return `${t("settings.fileFormatConstraint")} ${CounterLabelParams.filesNumber} file | ${CounterLabelParams.totalSize}`;
      },
      filesImages: ref(null),
      filesMaxSize: ref(null),
      filesMaxTotalSize: ref(null),
      filesMaxNumber: ref(null),
      onRejected(rejectedEntries: string | any[]) {
        //  plugin needs to be installed
        // https://quasar.dev/quasar-plugins/notify#Installation
        toast({
          variant: "error",
          message: t("settings.filesValidationFailed", {
            count: rejectedEntries.length,
          }),
        });
      },
      uploadImage,
      deleteLogo,
      loadingState,
      customText,
      editingText,
      cancelLogoText,
      updateCustomText,
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
    };
  },
});
</script>

<style>
/* The theme chips' dark background/border are set via `tw:dark:*` utilities,
   which don't apply in this app (dark mode is toggled by `body.body--dark`,
   not the OS media query Tailwind's `dark:` variant targets). Restore them
   with class-based rules so the chips keep their fill + border in dark mode. */
.body--dark [data-test="theme-light-chip"],
.body--dark [data-test="theme-dark-chip"] {
  background: rgba(255, 255, 255, 0.05);
  border-color: rgba(255, 255, 255, 0.15);
}
.body--dark [data-test="reset-theme-colors-btn"] {
  border-color: rgba(255, 255, 255, 0.25);
}
</style>
