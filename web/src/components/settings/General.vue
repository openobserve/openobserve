<!-- Copyright 2023 Zinc Labs Inc.

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
      <div class="text-body1 text-bold">
        {{ t("settings.generalPageTitle") }}
      </div>
    </div>
    <q-separator />
    <div class="q-w-md q-mx-lg">
      <q-form @submit.stop="onSubmit.execute">
        <q-input
          v-model.number="scrapeIntereval"
          type="number"
          min="0"
          :label="t('settings.scrapintervalLabel')"
          color="input-border"
          bg-color="input-bg"
          class="q-py-md showLabelOnTop"
          stack-label
          outlined
          filled
          dense
          :rules="[(val: any) => !!val || 'Scrape interval is required']"
          :lazy-rules="true"
        />
        <span>&nbsp;</span>

        <div class="flex justify-start">
          <q-btn
            data-test="dashboard-add-submit"
            :loading="onSubmit.isLoading.value"
            :label="t('dashboard.save')"
            class="q-mb-md text-bold no-border"
            color="secondary"
            padding="sm xl"
            type="submit"
            no-caps
          />
        </div>
      </q-form>
    </div>
    <div id="enterpriseFeature" v-if="config.isEnterprise == 'true'">
      <div class="q-px-md q-py-md">
        <div class="text-body1 text-bold">
          {{ t("settings.enterpriseTitle") }}
        </div>
      </div>
      <q-separator />
      <div class="q-mx-lg">
        <div class="q-gutter-sm row q-mt-xs">
          <q-label class="q-pt-md">{{ t("settings.customLogoTitle") }}</q-label>
          <q-img
            v-if="
              store.state.zoConfig.hasOwnProperty('custom_logo_img') &&
              store.state.zoConfig.custom_logo_img != ''
            "
            :src="store.state.custom_logo_img"
            :alt="t('settings.logoLabel')"
            style="width: 400px"
            class="q-mx-md"
          />
          <q-file
            v-else
            v-model="files"
            :label="t('settings.logoLabel')"
            filled
            counter
            :counter-label="counterLabelFn"
            style="width: 400px"
            max-file-size="20481"
            accept=".png, .jpg, .jpeg, .svg, .jpeg2, image/*"
            @rejected="onRejected"
            @update:model-value="uploadImage"
          >
            <template v-slot:prepend>
              <q-icon name="attach_file" />
            </template>
          </q-file>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
// @ts-ignore
import { defineComponent, onActivated, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { useQuasar } from "quasar";
import { useLoading } from "@/composables/useLoading";
import organizations from "@/services/organizations";
import settingsService from "@/services/settings";
import config from "@/aws-exports";

export default defineComponent({
  name: "PageGeneralSettings",
  setup() {
    const { t } = useI18n();
    const q = useQuasar();
    const store = useStore();
    const router: any = useRouter();
    const scrapeIntereval = ref(
      store.state?.organizationData?.organizationSettings?.scrape_interval ?? 15
    );

    onActivated(() => {
      scrapeIntereval.value =
        store.state?.organizationData?.organizationSettings?.scrape_interval ??
        15;
    });

    const onSubmit = useLoading(async () => {
      try {
        //set organizations settings in store
        //scrape interval will be in number
        store.dispatch("setOrganizationSettings", {
          ...store.state?.organizationData?.organizationSettings,
          scrape_interval: scrapeIntereval.value,
        });

        //update settings in backend
        await organizations.post_organization_settings(
          store.state?.selectedOrganization?.identifier,
          store.state?.organizationData?.organizationSettings
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

    const uploadImage = (event: Event) => {
      if (config.isEnterprise == "true") {
        const formData = new FormData();
        formData.append("image", event);
        let orgIdentifier = "default";
        for (let item of store.state.organizations) {
          if (item.type == "default") {
            orgIdentifier = item.identifier;
          }
        }
        settingsService
          .createLogo(orgIdentifier, formData)
          .then((res) => {
            console.log(res);
          })
          .catch((e) => {
            q.notify({
              type: "negative",
              message: e?.message || "Error while uploading image.",
              timeout: 2000,
            });
          })
          .finally(() => {
            console.log("finally");
          });
      } else {
        q.notify({
          type: "negative",
          message: "You are not allowed to perform this action.",
          timeout: 2000,
        });
      }
    };

    return {
      t,
      q,
      store,
      config,
      router,
      scrapeIntereval,
      onSubmit,
      files: ref(null),
      counterLabelFn({ totalSize, filesNumber }) {
        return `(Only .png, .jpg, .jpeg, .svg formats & size <=20kb) ${filesNumber} file | ${totalSize}`;
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
    };
  },
});
</script>
