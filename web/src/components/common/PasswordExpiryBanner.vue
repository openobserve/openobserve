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

<!-- Once per session: a session held open across the expiry date simply meets the block. -->
<template>
  <OBanner
    v-if="daysRemaining !== null"
    bar
    variant="warning"
    icon="timer"
    data-test="password-expiry-banner"
  >
    {{ t("passwordReset.expiryBanner", { count: daysRemaining }, daysRemaining) }}

    <template #actions>
      <div class="flex flex-wrap items-center gap-3">
        <OButton
          variant="banner-dismiss"
          size="sm"
          data-test="password-expiry-banner-update"
          @click="openVoluntarily()"
        >
          {{ t("passwordReset.expiryBannerAction") }}
        </OButton>
        <OButton
          variant="banner-dismiss"
          size="sm"
          data-test="password-expiry-banner-dismiss"
          @click="dismiss"
        >
          {{ t("passwordReset.expiryBannerDismiss") }}
        </OButton>
      </div>
    </template>
  </OBanner>
</template>

<script setup lang="ts">
import { usePasswordExpiryWarning } from "@/composables/usePasswordExpiryWarning";
import { usePasswordReset } from "@/composables/usePasswordReset";
import OButton from "@/lib/core/Button/OButton.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import { useI18nTyped } from "@/types/i18n";

const { t } = useI18nTyped();
const { daysRemaining, dismiss } = usePasswordExpiryWarning();
const { openVoluntarily } = usePasswordReset();
</script>
