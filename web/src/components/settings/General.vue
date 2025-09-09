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
  <div :class="store.state.theme == 'dark' ? 'dark-settings-theme' : 'light-settings-theme'">
    <div class="q-px-md q-py-md">
      <div class="general-page-title">
        {{ t("settings.generalPageTitle") }}
      </div>
      <div class="general-page-subtitle">
        Adjust settings for your Application
      </div>
    </div>
    <!-- platform settings section -->
    <div class="tw-mx-4">
      <GroupHeader title="Platform Settings" :showIcon="false" />
      <div class="tw-w-full tw-flex tw-flex-col">
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
              color="input-border"
              bg-color="input-bg"
              class="showLabelOnTop o2-numeric-input q-ml-sm"
              :class="store.state.theme == 'dark' ? 'o2-numeric-input-dark' : 'o2-numeric-input-light' "
              stack-label
              outlined
              filled
              dense
              hide-bottom-space
              :rules="[(val: any) => !!val || 'Scrape interval is required']"
              :lazy-rules="true"
              style="width: 120px;"
            />
            <span class="individual-setting-description">
              The scrape interval is the frequency, in seconds, at which the monitoring system collects metrics.
            </span>
          </div>
          <!-- enable web socket search section -->
          <div v-if="store.state.zoConfig.websocket_enabled" class="settings-grid-item">
            <span class="individual-setting-title">
              {{ t('settings.enableWebsocketSearch') }}
            </span>
            <q-toggle
              style="width: 120px;"
              v-model="enableWebsocketSearch"
              :label="'enabled'"
              size="lg"
              data-test="general-settings-enable-websocket"
              class=" showLabelOnTop o2-toggle-button-lg"
              :class="store.state.theme == 'dark' ? 'o2-toggle-button-lg-dark' : 'o2-toggle-button-lg-light'"
            />
            <span class="individual-setting-description">
              Websockets Search uses sockets logic to improve performance.
            </span>
          </div>
          <!-- enable search streaming section -->
          <div v-if="store.state.zoConfig.streaming_enabled" class="settings-grid-item">
            <span class="individual-setting-title">
              {{ t('settings.enableStreamingSearch') }}
            </span>
            <q-toggle
              style="width: 120px;"
              v-model="enableStreamingSearch"
              :label="'Enabled'"
              size="lg"
              data-test="general-settings-enable-streaming"
              class="showLabelOnTop o2-toggle-button-lg"
              :class="store.state.theme == 'dark' ? 'o2-toggle-button-lg-dark' : 'o2-toggle-button-lg-light'"
            />
            <span class="individual-setting-description">
              Enabling search streaming will increase performance.
            </span>
          </div>
          <!-- enable aggregation cache section -->
          <div v-if="config.isEnterprise == 'true'" class="settings-grid-item no-border-bottom">
            <span class="individual-setting-title">
              {{ t('settings.enableStreamingAggregation') }}
            </span>
            <q-toggle
              style="width: 120px;"
              v-model="enableStreamingAggregation"
              :label="'Enabled'"
              size="lg"
              data-test="general-settings-enable-streaming-aggregation"
              class="showLabelOnTop o2-toggle-button-lg"
              :class="store.state.theme == 'dark' ? 'o2-toggle-button-lg-dark' : 'o2-toggle-button-lg-light'"
            />
            <span class="individual-setting-description">
              Enabling streaming aggregates will help improve the performance of aggregate queries.
            </span>
          </div>
          <span>&nbsp;</span>

          <div class="flex justify-start">
            <q-btn
              data-test="dashboard-add-submit"
              :loading="onSubmit.isLoading.value"
              :label="t('dashboard.save')"
              class="q-mb-md o2-primary-button no-border tw-h-[36px]"
              :class="store.state.theme === 'dark' ? 'o2-primary-button-dark' : 'o2-primary-button-light'"
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
        <GroupHeader title="Enterprise Features" :showIcon="false" />
      </div>
      <div class="q-mx-md">
        <div class="settings-grid-item no-border-bottom">
          <span class="individual-setting-title">
            {{ t('settings.customLogoText') }}
          </span>
          <div v-if="editingText || store.state.zoConfig.custom_logo_text == ''" class="tw-flex tw-gap-3 tw-items-center">
            <q-input
              color="input-border"
              bg-color="input-bg"
              class="showLabelOnTop o2-text-input tw-w-[250px] tw-mr-sm"
              stack-label
              outlined
              filled
              dense
              data-test="settings_ent_logo_custom_text"
              :class="store.state.theme == 'dark' ? 'o2-text-input-dark' : 'o2-text-input-light'"
              v-model="customText"
            />
            <div class="btn-group tw-flex tw-h-[28px]">
              <q-btn
                type="button"
                class="q-mr-sm"
                :class="store.state.theme == 'dark' ? 'text-btn-border-dark' : 'text-btn-border-light'"
                no-caps
                color="red"
                icon="close"
                dense
                flat
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
                flat
                :class="store.state.theme == 'dark' ? 'text-btn-border-dark' : 'text-btn-border-light'"
                color="primary"
                type="submit"
                no-caps
                @click="updateCustomText"
              />
            </div>
          </div>
          <div v-else class="flex items-center">
            <span class="tw-w-[190px] tw-text-center tw-truncate">{{ store.state.zoConfig.custom_logo_text || "No Text Available" }}
              <q-tooltip v-if="store.state.zoConfig.custom_logo_text.length > 20" class="tw-text-center tw-text-[12px] tw-max-w-[250px]">
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
            Custom logo text is used to change the default branding text displayed in the application.
          </span>
        </div>
        <div class="settings-grid-item q-ml-xs">
          <div class="q-pt-sm individual-setting-title  full-width tw-mb-5">
            {{ t("settings.customLogoTitle") }}
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
              @click="confirmDeleteLogo()"
              class="q-mx-md"
              size="sm"
            ></q-btn>
          </div>
          <div v-else class="tw-flex tw-items-center tw-gap-3">
            <q-file
            data-test="setting_ent_custom_logo_img_file_upload"
            v-model="files"
            :label="'Drag & drop or click to upload'"
            filled
            counter
            :counter-label="counterLabelFn"
            max-file-size="20481"
            accept=".png, .jpg, .jpeg, .gif, .bmp, .jpeg2, image/*"
            @rejected="onRejected"
            dense
            class="q-mx-none o2-file-input tw-w-[250px] "
            :class="store.state.theme == 'dark' ? 'o2-text-input-dark' : 'o2-text-input-light'"
          >
            <template v-slot:prepend>
              <q-icon name="attach_file" />
            </template>
          </q-file>
          <div class="btn-group tw-flex tw-h-[28px] tw-mb-5">
              <q-btn
                type="button"
                class="q-mr-sm"
                :class="store.state.theme == 'dark' ? 'text-btn-border-dark' : 'text-btn-border-light'"
                no-caps
                color="red"
                icon="close"
                dense
                flat
                size="sm"
                @click="files = null"
              ></q-btn>
              <q-btn
                data-test="settings_ent_logo_custom_text_save_btn"
                :loading="onSubmit.isLoading.value"
                icon="check"
                class="q-mr-sm "
                dense
                size="sm"
                flat
                :class="store.state.theme == 'dark' ? 'text-btn-border-dark' : 'text-btn-border-light'"
                color="primary"
                type="submit"
                no-caps
                @click="uploadImage(files)"
              />
            </div>
          </div>
          <div class="tw-flex tw-flex-col tw-mb-5">
            <span class="individual-setting-description">
              Custom logo is used to change the default branding logo displayed in the application.
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

      <q-card-actions align="right" class="tw-flex tw-gap-1">
        <q-btn
          data-test="logs-search-bar-confirm-dialog-cancel-btn"
          :label="t('confirmDialog.cancel')"
          class="o2-secondary-button tw-h-[28px] no-border"
          flat
          no-caps
          :class="store.state.theme == 'dark' ? 'o2-secondary-button-dark' : 'o2-secondary-button-light'"
          @click="cancelConfirmDialog"
        />
        <q-btn
          data-test="logs-search-bar-confirm-dialog-ok-btn"
          :label="t('confirmDialog.ok')"
          class="o2-primary-button tw-h-[28px] no-border"
          :class="store.state.theme == 'dark' ? 'o2-primary-button-dark' : 'o2-primary-button-light'"
          no-caps
          flat
          @click="confirmDialogOK"
        />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script lang="ts">
// @ts-ignore
import { defineComponent, onActivated, ref, watch } from "vue";
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

export default defineComponent({
  name: "PageGeneralSettings",
  methods: {
    cancelConfirmDialog() {
      this.confirmDeleteImage = false;
    },
    confirmDialogOK() {
      this.confirmDeleteImage = false;
      this.deleteLogo();
    },
    confirmDeleteLogo() {
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

    const enableWebsocketSearch = ref(
      store.state?.organizationData?.organizationSettings
        ?.enable_websocket_search ?? false,
    );

    const enableStreamingSearch = ref(
      store.state?.organizationData?.organizationSettings
        ?.enable_streaming_search ?? false,
    );

    const enableStreamingAggregation = ref(
      store.state?.organizationData?.organizationSettings
        ?.streaming_aggregation_enabled ?? false,
    );

    const loadingState = ref(false);
    const customText = ref("");
    const editingText = ref(false);
    const files = ref(null);

    customText.value = store.state.zoConfig.custom_logo_text;

    onActivated(() => {
      scrapeIntereval.value =
        store.state?.organizationData?.organizationSettings?.scrape_interval ??
        15;

      enableWebsocketSearch.value =
        store.state?.organizationData?.organizationSettings
          ?.enable_websocket_search ?? false;

      enableStreamingSearch.value =
        store.state?.organizationData?.organizationSettings
          ?.enable_streaming_search ?? false;

      enableStreamingAggregation.value =
        store.state?.organizationData?.organizationSettings
          ?.streaming_aggregation_enabled ?? false;
    });

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
          enable_websocket_search: enableWebsocketSearch.value,
          enable_streaming_search: enableStreamingSearch.value,
          streaming_aggregation_enabled: enableStreamingAggregation.value,
        });

        //update settings in backend
        await organizations.post_organization_settings(
          store.state?.selectedOrganization?.identifier,
          store.state?.organizationData?.organizationSettings,
        );

        q.notify({
          type: "positive",
          message: "Organization settings updated",
          timeout: 2000,
        });
      } catch (err: any) {
        q.notify({
          type: "negative",
          message: err?.message || "something went wrong",
          timeout: 2000,
        });
      }
    });

    const uploadImage = (fileList: any = null) => {
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
          )
          .then(async (res) => {
            if (res.status == 200) {
              q.notify({
                type: "positive",
                message: "Logo updated successfully.",
                timeout: 2000,
              });

              await configService.get_config().then((res: any) => {
                store.dispatch("setConfig", res.data);
              });

              files.value = null;
            } else {
              q.notify({
                type: "negative",
                message: "Something went wrong.",
                timeout: 2000,
              });
            }
          })
          .catch((e) => {
            q.notify({
              type: "negative",
              message: e?.message || "Error while uploading image.",
              timeout: 2000,
            });
          })
          .finally(() => {
            loadingState.value = false;
          });
      } else if (config.isEnterprise != "true") {
        q.notify({
          type: "negative",
          message: "You are not allowed to perform this action.",
          timeout: 2000,
        });
      } else {
        q.notify({
          type: "negative",
          message: "Please select a file to upload.",
          timeout: 2000,
        });
      }
    };

    const deleteLogo = () => {
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
        )
        .then(async (res: any) => {
          if (res.status == 200) {
            q.notify({
              type: "positive",
              message: "Logo deleted successfully.",
              timeout: 2000,
            });

            await configService.get_config().then((res: any) => {
              store.dispatch("setConfig", res.data);
            });
          } else {
            q.notify({
              type: "negative",
              message: res?.message || "Error while deleting image.",
              timeout: 2000,
            });
          }
        })
        .catch(() => {
          q.notify({
            type: "negative",
            message: "Something went wrong.",
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
          message: "Text should be less than 100 characters.",
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
              message: "Logo text updated successfully.",
              timeout: 2000,
            });

            let stateConfig = JSON.parse(JSON.stringify(store.state.zoConfig));
            stateConfig.custom_logo_text = customText.value;
            store.dispatch("setConfig", stateConfig);
            editingText.value = false;
          } else {
            q.notify({
              type: "negative",
              message: res?.message || "Error while updating image.",
              timeout: 2000,
            });
          }
        })
        .catch((err) => {
          q.notify({
            type: "negative",
            message: err?.message || "Something went wrong.",
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
      enableWebsocketSearch,
      onSubmit,
      files,
      counterLabelFn(CounterLabelParams: { filesNumber: any; totalSize: any }) {
        return `(Only .png, .jpg, .jpeg, .gif, .bmp formats & size <=20kb & Max Size: 150x30px) ${CounterLabelParams.filesNumber} file | ${CounterLabelParams.totalSize}`;
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
          message: `${rejectedEntries.length} file(s) did not pass validation constraints`,
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
      enableStreamingSearch,
      enableStreamingAggregation,
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
  border-bottom: 1px solid rgba(0, 0, 0, 0.1);
}

.dark-settings-theme .settings-grid-item {
  border-bottom: 1px solid rgba(255, 255, 255, 0.15);
}
.text-btn-border-light{
  border: 1px solid #D3D5DB ;
}
.text-btn-border-dark{
  border: 1px solid #6F737A ;
}

:deep(.o2-file-input .q-field__bottom) {
  padding: 0px;
  padding-top: 8px;
}

</style>
