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
  <OBanner
    v-if="feature || deniedMessage"
    variant="warning"
    bar
    icon="lock"
    role="status"
    data-test="feature-lock-banner"
  >
    <template v-if="feature">
      <i18n-t v-if="label" keypath="featureLock.bannerMessage" tag="span">
        <template #feature>
          <strong data-test="feature-lock-banner-feature">{{ label }}</strong>
        </template>
      </i18n-t>
      <span v-else data-test="feature-lock-banner-generic">{{
        t("featureLock.bannerMessageGeneric")
      }}</span>
    </template>
    <span v-if="deniedMessage" data-test="feature-lock-banner-denied">{{ deniedMessage }}</span>
    <template #actions>
      <OButton
        variant="primary"
        size="sm"
        data-test="feature-lock-banner-contact-sales"
        @click="openContactSales"
      >
        {{ t("featureLock.contactSales") }}
      </OButton>
      <OButton
        v-if="!feature"
        variant="ghost"
        size="icon-sm"
        icon-left="close"
        :aria-label="t('common.dismiss')"
        data-test="feature-lock-banner-dismiss"
        @click="dismiss"
      />
    </template>
  </OBanner>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { raw, useI18nTyped } from "@/types/i18n";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import { useFeatureLockActions, useFeatureNames } from "@/composables/useFeatureLock";
import { useLicenseDenials } from "@/composables/useUnauthorizedErrorGrouper";

const props = defineProps<{ feature: string | null }>();

const { t } = useI18nTyped();
const { openContactSales } = useFeatureLockActions();
const { featureName, featureNames } = useFeatureNames();
const { features: denied, dismiss } = useLicenseDenials();

const label = computed(() => (props.feature ? (featureName(props.feature) ?? null) : null));

const deniedMessage = computed(() => {
  if (props.feature || !denied.value) return null;
  return denied.value.length
    ? t("featureLock.toastMessage", { features: raw(featureNames(denied.value)) })
    : t("featureLock.toastMessageGeneric");
});
</script>
