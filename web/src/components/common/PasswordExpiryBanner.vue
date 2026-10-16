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
  <q-banner
    v-if="daysRemaining !== null"
    dense
    inline-actions
    class="bg-warning text-black"
    data-test="password-expiry-banner"
  >
    <template #avatar>
      <q-icon name="timer" size="18px" />
    </template>
    {{
      t("passwordReset.expiryBanner", { count: daysRemaining }, daysRemaining)
    }}

    <template #action>
      <q-btn
        flat
        dense
        no-caps
        :label="t('passwordReset.expiryBannerAction')"
        data-test="password-expiry-banner-update"
        @click="openVoluntarily()"
      />
      <q-btn
        flat
        dense
        no-caps
        :label="t('passwordReset.expiryBannerDismiss')"
        data-test="password-expiry-banner-dismiss"
        @click="dismiss"
      />
    </template>
  </q-banner>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";

import { usePasswordExpiryWarning } from "@/composables/usePasswordExpiryWarning";
import { usePasswordReset } from "@/composables/usePasswordReset";

const { t } = useI18n();
const { daysRemaining, dismiss } = usePasswordExpiryWarning();
const { openVoluntarily } = usePasswordReset();
</script>
