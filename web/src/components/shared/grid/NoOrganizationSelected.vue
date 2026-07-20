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
    <div
      class="w-full flex flex-col flex-center gap-2"
      style="font-size: 1.5rem"
    >
      <img
        data-test="no-organization-selected-image"
        :src="getImageURL('images/common/selectOrganization.svg')"
        style="width: 200px; height: 200px; margin-top: 20vh"
        alt=""
      />
      <div data-test="no-organization-selected-title" class="m-0 text-[18px] font-semibold">{{ t("ticket.noOrganizationSelected") }}</div>
      <div data-test="no-organization-selected-message" class="m-0 text-sm font-normal leading-5 text-[#7F7777]">{{ t("ticket.selectOrganizationForQuota") }}</div>
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
  