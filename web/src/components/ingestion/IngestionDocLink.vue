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

<!--
  Standard "Click here …" documentation link for ingestion detail pages.

  Renders: Click <here> <trailing text>.
  The trailing text defaults to "to check further documentation." Pass a
  default slot to customize it (the leading space is included automatically).
-->
<template>
  <div>
    {{ t("ingestion.docLinkClick") }}
    <a
      :href="href"
      target="_blank"
      rel="noopener noreferrer"
      class="text-text-link hover:text-text-link-hover font-medium underline"
      >{{ t("ingestion.docLinkHere") }}</a
    ><slot> {{ t("ingestion.docLinkDefaultText") }}</slot>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";

const { t } = useI18n();

defineProps<{ href: string }>();
</script>
