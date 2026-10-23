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
  <ODialog
    :open="features !== null"
    size="sm"
    :title="t('featureLock.toastTitle')"
    :secondary-button-label="t('featureLock.contactSales')"
    :primary-button-label="t('common.ok')"
    data-test="license-denied-dialog"
    @click:primary="close"
    @click:secondary="openContactSales"
    @update:open="(open: boolean) => !open && close()"
  >
    <div class="flex flex-col gap-2 text-sm">
      <p class="text-text-body" data-test="license-denied-dialog-message">
        {{
          features?.length
            ? t("featureLock.toastMessage", { features: raw(features.join(", ")) })
            : t("featureLock.toastMessageGeneric")
        }}
      </p>
      <p class="text-text-secondary">{{ t("featureLock.dialogScope") }}</p>
    </div>
  </ODialog>
</template>

<script setup lang="ts">
import { raw, useI18nTyped } from "@/types/i18n";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import { useLicenseDeniedDialog } from "@/composables/useUnauthorizedErrorGrouper";
import { siteURL } from "@/constants/config";

const { t } = useI18nTyped();
const { features, close } = useLicenseDeniedDialog();

const openContactSales = () => {
  window.open(siteURL.contactSales, "_blank", "noopener");
};
</script>
