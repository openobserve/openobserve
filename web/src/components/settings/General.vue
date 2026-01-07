<!-- Copyright 2023 OpenObserve Inc.

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
    <div class="q-px-md q-py-md">
      <div class="general-page-title">
        {{ t("settings.generalPageTitle") }}
      </div>
      <div class="general-page-subtitle">
        {{ t("settings.pageSubtitle") }}
      </div>
    </div>
    <!-- platform settings section -->
    <div class="tw:mx-4">
      <GroupHeader :title="t('settings.platformSettings')" :showIcon="false" />
      <div class="tw:w-full tw:flex tw:flex-col">
        <q-form @submit.stop="onSubmit.execute">
          <!-- scape interval section -->
          <div class="settings-grid-item">
            <span class="individual-setting-title">
              {{ t('settings.scrapintervalLabel') }}
            </span>
            <q-input
              v-model.number="scrapeIntereval"
              type="number"
              min="0"
              class="showLabelOnTop q-ml-sm"
              stack-label
              dense
              borderless
              hide-bottom-space
              data-test="general-settings-scrape-interval"
              :rules="[(val: any) => !!val || t('settings.scrapeIntervalRequired')]"
              :lazy-rules="true"
              style="width: 120px;"
            />
            <span class="individual-setting-description">
              {{ t("settings.scrapeIntervalDescription") }}
            </span>
          </div>

          <!-- Max Series Per Query section -->
          <div class="settings-grid-item">
            <span class="individual-setting-title">
              {{ t('settings.maxSeriesPerQueryLabel') }}
            </span>
            <q-input
              v-model.number="maxSeriesPerQuery"
              type="number"
              :min="1000"
              :max="1000000"
              class="showLabelOnTop q-ml-sm"
              stack-label
              dense
              borderless
              hide-bottom-space
              data-test="general-settings-max-series-per-query"
              :rules="[
                (val: any) => {
                  // Allow empty/null (user wants default)
                  if (val === null || val === undefined || val === '') return true;

                  // Validate numeric range
                  const numVal = Number(val);
                  return (numVal >= 1000 && numVal <= 1000000) || t('settings.maxSeriesPerQueryValidation');
                }
              ]"
              :lazy-rules="true"
              :placeholder="'40000 (' + t('settings.systemDefault') + ')'"
              style="width: 180px;"
            >
              <template v-slot:append>
                <q-icon
                  name="info"
                  size="xs"
                  class="cursor-pointer"
                >
                  <q-tooltip max-width="300px">
                    {{ t('settings.maxSeriesPerQueryTooltip') }}
                  </q-tooltip>
                </q-icon>
              </template>
            </q-input>
            <span class="individual-setting-description">
              {{ t("settings.maxSeriesPerQueryDescription") }}
            </span>
          </div>

          <!-- Manage Theme section -->
          <div class="settings-grid-item tw:items-start">
            <span class="individual-setting-title">
              {{ t("settings.manageTheme") }}
            </span>
            <div class="tw:flex tw:gap-2 tw:items-center" style="margin-left: -60px;">
              <!-- Light Mode Theme -->
              <div
                class="theme-color-chip"
                @click="handleThemeChipClick('light')"
                data-test="theme-light-chip"
              >
                <div class="color-circle" :style="{ backgroundColor: customLightColor }">
                  <q-icon name="palette" size="14px" color="white" class="palette-icon" />
                </div>
                <span class="chip-label">{{ t("settings.light") }}</span>
                <span class="chip-value">{{ customLightColor }}</span>
              </div>

              <!-- Dark Mode Theme -->
              <div
                class="theme-color-chip"
                @click="handleThemeChipClick('dark')"
                data-test="theme-dark-chip"
              >
                <div class="color-circle" :style="{ backgroundColor: customDarkColor }">
                  <q-icon name="palette" size="14px" color="white" class="palette-icon" />
                </div>
                <span class="chip-label">{{ t("settings.dark") }}</span>
                <span class="chip-value">{{ customDarkColor }}</span>
              </div>

              <!-- Reset Button -->
              <div
                class="theme-reset-chip"
                @click="resetThemeColors"
                data-test="reset-theme-colors-btn"
              >
                <q-icon name="refresh" size="16px" />
                <q-tooltip>{{ t("settings.resetToDefaultColors") }}</q-tooltip>
              </div>
            </div>
            <span class="individual-setting-description tw:self-start">
              {{ t("settings.themeManagementDescription") }}
            </span>
          </div>

          <span>&nbsp;</span>

          <div class="flex justify-start">
            <q-btn
              data-test="dashboard-add-submit"
              :loading="onSubmit.isLoading.value"
              :label="t('dashboard.save')"
              class="q-mb-md o2-primary-button no-border tw:h-[36px]"
              type="submit"
              no-caps
              size="md"
            />
          </div>
        </q-form>
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
      <div class="q-px-md q-py-sm">
        <GroupHeader :title="t('settings.enterpriseFeatures')" :showIcon="false" />
      </div>
      <div class="q-mx-md">
        <div class="settings-grid-item no-border-bottom">
          <span class="individual-setting-title">
            {{ t('settings.customLogoText') }}
          </span>
          <div v-if="editingText || store.state.zoConfig.custom_logo_text == ''" class="tw:flex tw:gap-3 tw:items-center">
            <q-input
              class="showLabelOnTop tw:w-[250px] tw:mr-sm"
              stack-label
              borderless
              dense
              data-test="settings_ent_logo_custom_text"
              v-model="customText"
            />
            <div class="btn-group tw:flex tw:h-[28px]">
              <q-btn
                type="button"
                class="q-mr-sm"
                no-caps
                color="red"
                icon="close"
                dense
                size="sm"
                @click="editingText = !editingText"
              ></q-btn>
              <q-btn
                data-test="settings_ent_logo_custom_text_save_btn"
                :loading="onSubmit.isLoading.value"
                icon="check"
                class="q-mr-sm "
                dense
                size="sm"
                color="primary"
                type="submit"
                no-caps
                @click="updateCustomText"
              />
            </div>
          </div>
          <div v-else class="flex items-center">
            <span class="tw:w-[190px] tw:text-center tw:truncate">{{ store.state.zoConfig.custom_logo_text || t("settings.noTextAvailable") }}
              <q-tooltip v-if="store.state.zoConfig.custom_logo_text.length > 20" class="tw:text-center tw:text-[12px] tw:max-w-[250px]">
                {{ store.state.zoConfig.custom_logo_text }}
              </q-tooltip>
            </span>
            <q-btn
              data-test="settings_ent_logo_custom_text_edit_btn"
              :loading="onSubmit.isLoading.value"
              icon="edit"
              size="sm"
              class="text-bold q-ml-sm"
              type="submit"
              @click="editingText = !editingText"
            />
          </div>
          <span class="individual-setting-description">
            {{ t("settings.customLogoTextDescription") }}
          </span>
        </div>
        <!-- Light Mode Logo -->
        <div class="settings-grid-item q-ml-xs">
          <div class="q-pt-sm individual-setting-title full-width tw:mb-5">
            {{ t("settings.customLogoTitle") }} ({{ t("settings.lightMode") }})
          </div>
          <div
            v-if="
              store.state.zoConfig.hasOwnProperty('custom_logo_img') &&
              store.state.zoConfig.custom_logo_img != null
            "
            class="full-width"
          >
            <q-img
              data-test="setting_ent_custom_logo_img"
              :src="
                `data:image; base64, ` + store.state.zoConfig.custom_logo_img
              "
              :alt="t('settings.logoLabel')"
              style="max-width: 150px; max-height: 31px"
              class="q-mx-md"
            />
            <q-btn
              icon="delete"
              data-test="setting_ent_custom_logo_img_delete_btn"
              @click="confirmDeleteLogo('light')"
              class="q-mx-md"
              size="sm"
            ></q-btn>
          </div>
          <div v-else class="tw:flex tw:items-center tw:gap-3">
            <q-file
            data-test="setting_ent_custom_logo_img_file_upload"
            v-model="filesLight"
            :label="t('settings.dragDropUpload')"
            counter
            :counter-label="counterLabelFn"
            accept=".png, .jpg, .jpeg, .gif, .bmp, .jpeg2, image/*"
            @rejected="onRejected"
            dense
            borderless
            class="q-mx-none o2-file-input tw:w-[250px] "
          >
            <template v-slot:prepend>
              <q-icon name="attach_file" />
            </template>
          </q-file>
          <div class="btn-group tw:flex tw:h-[28px] tw:mb-5">
              <q-btn
                type="button"
                class="q-mr-sm"
                no-caps
                color="red"
                icon="close"
                dense
                size="sm"
                @click="filesLight = null"
              ></q-btn>
              <q-btn
                data-test="settings_ent_logo_custom_light_save_btn"
                :loading="onSubmit.isLoading.value"
                icon="check"
                class="q-mr-sm "
                dense
                size="sm"
                color="primary"
                type="submit"
                no-caps
                @click="uploadImage(filesLight, 'light')"
              />
            </div>
          </div>
          <div class="tw:flex tw:flex-col tw:mb-5">
            <span class="individual-setting-description">
              {{ t("settings.customLogoLightDescription") }}
            </span>
          </div>
        </div>

        <!-- Dark Mode Logo -->
        <div class="settings-grid-item q-ml-xs">
          <div class="q-pt-sm individual-setting-title full-width tw:mb-5">
            {{ t("settings.customLogoTitle") }} ({{ t("settings.darkMode") }})
          </div>
          <div
            v-if="
              store.state.zoConfig.hasOwnProperty('custom_logo_dark_img') &&
              store.state.zoConfig.custom_logo_dark_img != null
            "
            class="full-width"
          >
            <q-img
              data-test="setting_ent_custom_logo_dark_img"
              :src="
                `data:image; base64, ` + store.state.zoConfig.custom_logo_dark_img
              "
              :alt="t('settings.logoLabel')"
              style="max-width: 150px; max-height: 31px"
              class="q-mx-md"
            />
            <q-btn
              icon="delete"
              data-test="setting_ent_custom_logo_dark_img_delete_btn"
              @click="confirmDeleteLogo('dark')"
              class="q-mx-md"
              size="sm"
            ></q-btn>
          </div>
          <div v-else class="tw:flex tw:items-center tw:gap-3">
            <q-file
            data-test="setting_ent_custom_logo_dark_img_file_upload"
            v-model="filesDark"
            :label="t('settings.dragDropUpload')"
            counter
            :counter-label="counterLabelFn"
            accept=".png, .jpg, .jpeg, .gif, .bmp, .jpeg2, image/*"
            @rejected="onRejected"
            dense
            borderless
            class="q-mx-none o2-file-input tw:w-[250px] "
          >
            <template v-slot:prepend>
              <q-icon name="attach_file" />
            </template>
          </q-file>
          <div class="btn-group tw:flex tw:h-[28px] tw:mb-5">
              <q-btn
                type="button"
                class="q-mr-sm"
                no-caps
                color="red"
                icon="close"
                dense
                size="sm"
                @click="filesDark = null"
              ></q-btn>
              <q-btn
                data-test="settings_ent_logo_custom_dark_save_btn"
                :loading="onSubmit.isLoading.value"
                icon="check"
                class="q-mr-sm "
                dense
                size="sm"
                color="primary"
                type="submit"
                no-caps
                @click="uploadImage(filesDark, 'dark')"
              />
            </div>
          </div>
          <div class="tw:flex tw:flex-col tw:mb-5">
            <span class="individual-setting-description">
              {{ t("settings.customLogoDarkDescription") }}
            </span>
          </div>
        </div>
      </div>
    </div>
  </div>
  <q-spinner-hourglass
    v-if="loadingState"
    class="fixed-center"
    size="lg"
    color="primary"
  ></q-spinner-hourglass>
  <q-dialog v-model="confirmDeleteImage">
    <q-card>
      <q-card-section>
        {{ t("settings.deleteLogoMessage") }}
      </q-card-section>

      <q-card-actions align="right" class="tw:flex tw:gap-1">
        <q-btn
          data-test="logs-search-bar-confirm-dialog-cancel-btn"
          :label="t('confirmDialog.cancel')"
          class="o2-secondary-button tw:h-[28px] no-border"
          flat
          no-caps
          @click="cancelConfirmDialog"
        />
        <q-btn
          data-test="logs-search-bar-confirm-dialog-ok-btn"
          :label="t('confirmDialog.ok')"
          class="o2-primary-button tw:h-[28px] no-border"
          no-caps
          flat
          @click="confirmDialogOK"
        />
      </q-card-actions>
    </q-card>
  </q-dialog>

  <!-- Color Picker Dialog -->
  <q-dialog v-model="showColorPicker" @hide="onColorPickerClose">
    <q-card style="min-width: 300px">
      <q-card-section>
        <div class="text-h6">{{ t("settings.pickCustomColor") }}</div>
      </q-card-section>
      <q-card-section>
        <q-color
          v-model="tempColor"
          @update:model-value="updateCustomColor"
        />
      </q-card-section>
      <q-card-actions align="right">
        <q-btn flat :label="t('settings.close')" color="primary" v-close-popup />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script lang="ts">
// @ts-ignore
import { defineComponent, onActivated, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { useQuasar } from "quasar";
import { useLoading } from "@/composables/useLoading";
import organizations from "@/services/organizations";
import settingsService from "@/services/settings";
import config from "@/aws-exports";
import configService from "@/services/config";
import DOMPurify from "dompurify";
import GroupHeader from "../common/GroupHeader.vue";
import store from "@/test/unit/helpers/store";
import { applyThemeColors } from "@/utils/theme";

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
  },
  setup() {
    const { t } = useI18n();
    const q = useQuasar();
    const store = useStore();
    const router: any = useRouter();
    const scrapeIntereval = ref(
      store.state?.organizationData?.organizationSettings?.scrape_interval ??
        15,
    );
    const maxSeriesPerQuery = ref(
      store.state?.organizationData?.organizationSettings?.max_series_per_query ??
        null,
    );

    const loadingState = ref(false);
    const customText = ref("");
    const editingText = ref(false);
    const files = ref(null);
    const filesLight = ref(null);
    const filesDark = ref(null);
    const logoThemeToDelete = ref<string>('light');

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
      store.state?.organizationData?.organizationSettings?.light_mode_theme_color ||
      DEFAULT_LIGHT_COLOR
    );
    const customDarkColor = ref(
      store.state.tempThemeColors?.dark ||
      store.state?.organizationData?.organizationSettings?.dark_mode_theme_color ||
      DEFAULT_DARK_COLOR
    );

    // Color picker dialog state
    const showColorPicker = ref(false);                          // Controls dialog visibility
    const currentPickerMode = ref<"light" | "dark">("light");    // Which mode is being edited
    const tempColor = ref(DEFAULT_LIGHT_COLOR);                  // Bound to q-color component

    /**
     * Update theme colors from Vuex store
     * Called on component mount and when organization settings change
     * Priority: Vuex store tempThemeColors > organizationSettings > defaults
     */
    const updateFromStore = () => {
      // Update scrape interval setting
      scrapeIntereval.value =
        store.state?.organizationData?.organizationSettings?.scrape_interval ??
        15;

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
        const currentMode = store.state.theme === "dark" ? "dark" : "light";
        const color = currentMode === "light" ? newLightColor : newDarkColor;
        const isDefault = color === DEFAULT_LIGHT_COLOR || color === DEFAULT_DARK_COLOR;
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
      { deep: true, immediate: true }  // Deep watch to catch nested property changes
    );

    watch(
      () => editingText.value,
      (value) => {
        if (!value) {
          customText.value = store.state.zoConfig.custom_logo_text;
        }
      },
    );

    const onSubmit = useLoading(async () => {
      try {
        //set organizations settings in store
        //scrape interval will be in number
        store.dispatch("setOrganizationSettings", {
          ...store.state?.organizationData?.organizationSettings,
          scrape_interval: scrapeIntereval.value,
          max_series_per_query: maxSeriesPerQuery.value === null ||
                                maxSeriesPerQuery.value === undefined ||
                                maxSeriesPerQuery.value === ''
                                ? null
                                : maxSeriesPerQuery.value,
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
        const color = currentMode === "light" ? customLightColor.value : customDarkColor.value;
        applyThemeColors(color, currentMode, false);

        // Clear temporary theme colors from store since we're saving permanently
        store.commit('clearTempThemeColors');

        q.notify({
          type: "positive",
          message: t("settings.organizationSettingsUpdated"),
          timeout: 2000,
        });
      } catch (err: any) {
        q.notify({
          type: "negative",
          message: err?.message || t("settings.somethingWentWrong"),
          timeout: 2000,
        });
      }
    });

    const uploadImage = (fileList: any = null, theme: string = 'light') => {
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
              q.notify({
                type: "positive",
                message: t("settings.logoUpdatedSuccessfully", { mode: theme === 'dark' ? t('settings.darkMode') : t('settings.lightMode') }),
                timeout: 2000,
              });

              await configService.get_config().then((res: any) => {
                store.dispatch("setConfig", res.data);
              });

              // Clear the appropriate file ref
              if (theme === 'dark') {
                filesDark.value = null;
              } else {
                filesLight.value = null;
              }
              files.value = null;
            } else {
              q.notify({
                type: "negative",
                message: t("settings.somethingWentWrong"),
                timeout: 2000,
              });
            }
          })
          .catch((e) => {
            q.notify({
              type: "negative",
              message: e?.message || t("settings.errorUploadingImage"),
              timeout: 2000,
            });
          })
          .finally(() => {
            loadingState.value = false;
          });
      } else if (config.isEnterprise != "true") {
        q.notify({
          type: "negative",
          message: t("settings.notAllowedAction"),
          timeout: 2000,
        });
      } else {
        q.notify({
          type: "negative",
          message: t("settings.selectFileToUpload"),
          timeout: 2000,
        });
      }
    };

    const deleteLogo = (theme: string = 'light') => {
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
            q.notify({
              type: "positive",
              message: t("settings.logoDeletedSuccessfully", { mode: theme === 'dark' ? t('settings.darkMode') : t('settings.lightMode') }),
              timeout: 2000,
            });

            await configService.get_config().then((res: any) => {
              store.dispatch("setConfig", res.data);
            });
          } else {
            q.notify({
              type: "negative",
              message: res?.message || t("settings.errorDeletingImage"),
              timeout: 2000,
            });
          }
        })
        .catch(() => {
          q.notify({
            type: "negative",
            message: t("settings.somethingWentWrong"),
            timeout: 2000,
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
      store.commit('setTempThemeColor', {
        mode: currentPickerMode.value,
        color: tempColor.value
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
      store.commit('setTempThemeColor', { mode: 'light', color: DEFAULT_LIGHT_COLOR });
      store.commit('setTempThemeColor', { mode: 'dark', color: DEFAULT_DARK_COLOR });

      // Apply the theme immediately for current mode
      const currentMode = store.state.theme === "dark" ? "dark" : "light";
      const color = currentMode === "light" ? DEFAULT_LIGHT_COLOR : DEFAULT_DARK_COLOR;
      applyThemeColors(color, currentMode, true);

      // Show notification
      q.notify({
        type: "positive",
        message: t("settings.themeColorsResetSuccess"),
        timeout: 2000,
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

      // Update Quasar's dark mode - this is critical for proper theme application
      q.dark.set(mode === "dark");

      // Persist theme preference to localStorage
      localStorage.setItem("theme", mode);

      // Get the color for the new mode
      const color = mode === "light" ? customLightColor.value : customDarkColor.value;

      // Check if the color is a default color
      const isDefault = (mode === "light" && color === DEFAULT_LIGHT_COLOR) ||
                       (mode === "dark" && color === DEFAULT_DARK_COLOR);

      // Apply the theme color for the new mode
      applyThemeColors(color, mode, isDefault);
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
        q.notify({
          type: "negative",
          message: t("settings.textMaxCharacters"),
          timeout: 2000,
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
            q.notify({
              type: "positive",
              message: t("settings.logoTextUpdatedSuccessfully"),
              timeout: 2000,
            });

            let stateConfig = JSON.parse(JSON.stringify(store.state.zoConfig));
            stateConfig.custom_logo_text = customText.value;
            store.dispatch("setConfig", stateConfig);
            editingText.value = false;
          } else {
            q.notify({
              type: "negative",
              message: res?.message || t("settings.errorUpdatingImage"),
              timeout: 2000,
            });
          }
        })
        .catch((err) => {
          q.notify({
            type: "negative",
            message: err?.message || t("settings.somethingWentWrong"),
            timeout: 2000,
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

    return {
      t,
      q,
      store,
      config,
      router,
      scrapeIntereval,
      maxSeriesPerQuery,
      onSubmit,
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
        // Notify plugin needs to be installed
        // https://quasar.dev/quasar-plugins/notify#Installation
        q.notify({
          type: "negative",
          message: t("settings.filesValidationFailed", { count: rejectedEntries.length }),
        });
      },
      uploadImage,
      deleteLogo,
      loadingState,
      customText,
      editingText,
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

<style scoped lang="scss">

.general-page-title {
  font-size: 20px;
  font-weight: 700;
  line-height: 24px;
}
.general-page-subtitle{
  font-size: 14px;
  font-weight: 500;
  line-height: 20px;
}
.individual-setting-title{
  font-size: 14px;
  font-weight: 500;
  line-height: 20px;
}
.individual-setting-description{
  font-size: 13px;
  opacity: 0.7;
}

.settings-grid-item {
  display: grid;
  grid-template-columns: 1fr 1fr 2fr;
  gap: 1rem;
  align-items: center;
  padding: 1rem 0;
  border-bottom: 1px solid var(--o2-border-color);
}

.dark-settings-theme .settings-grid-item {
  border-bottom: 1px solid var(--o2-border-color) !important;
}
.text-btn-border-light{
  border: 1px solid #D3D5DB ;
}
.text-btn-border-dark{
  border: 1px solid #6F737A ;
}

// Theme management styles - Compact chip design
.theme-color-chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px 6px 6px;
  border-radius: 20px;
  cursor: pointer;
  transition: all 0.2s ease;
  background: rgba(0, 0, 0, 0.04);
  border: 1px solid rgba(0, 0, 0, 0.1);
}

.theme-color-chip:hover {
  background: rgba(0, 0, 0, 0.06);
  border-color: var(--q-primary);
  transform: translateY(-1px);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

body.body--dark .theme-color-chip {
  background: rgba(255, 255, 255, 0.05);
  border-color: rgba(255, 255, 255, 0.15);
}

body.body--dark .theme-color-chip:hover {
  background: rgba(255, 255, 255, 0.08);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
}

.color-circle {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
  position: relative;
  overflow: hidden;
}

.palette-icon {
  opacity: 0;
  transition: opacity 0.2s;
  filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.3));
}

.theme-color-chip:hover .palette-icon {
  opacity: 0.9;
}

.chip-label {
  font-size: 11px;
  font-weight: 600;
  opacity: 0.5;
  letter-spacing: 0.5px;
}

.chip-value {
  font-family: 'SF Mono', 'Monaco', 'Menlo', monospace;
  font-size: 11px;
  font-weight: 500;
  opacity: 0.7;
  letter-spacing: -0.2px;
}

.theme-reset-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  cursor: pointer;
  transition: all 0.2s ease;
  background: transparent;
  border: 1px dashed rgba(0, 0, 0, 0.2);
  opacity: 0.6;
}

.theme-reset-chip:hover {
  background: rgba(239, 68, 68, 0.08);
  border-color: rgba(239, 68, 68, 0.4);
  border-style: solid;
  opacity: 1;
  transform: translateY(-1px) rotate(180deg);
}

.theme-reset-chip:hover .q-icon {
  color: rgb(239, 68, 68);
}

body.body--dark .theme-reset-chip {
  border-color: rgba(255, 255, 255, 0.25);
}

body.body--dark .theme-reset-chip:hover {
  background: rgba(239, 68, 68, 0.15);
  border-color: rgba(239, 68, 68, 0.5);
}

body.body--dark .theme-reset-chip:hover .q-icon {
  color: rgb(248, 113, 113);
}

</style>
