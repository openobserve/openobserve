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
  <div class="flex w-full flex-col items-center justify-center gap-2 text-2xl">
    <img
      class="mt-[20vh] size-50"
      data-test="no-organization-selected-image"
      :src="getImageURL('images/common/selectOrganization.svg')"
      alt=""
    />
    <div data-test="no-organization-selected-title" class="m-0 text-lg font-semibold">
      {{ t("ticket.noOrganizationSelected") }}
    </div>
    <div
      data-test="no-organization-selected-message"
      class="text-text-secondary m-0 text-sm leading-5 font-normal"
    >
      {{ t("ticket.selectOrganizationForQuota") }}
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { useI18n } from "vue-i18n";
import { getImageURL } from "../../../utils/zincutils";

export default defineComponent({
  name: "QTableNoData",
  setup() {
    const { t } = useI18n();

    return { t, getImageURL };
  },
});
</script>
