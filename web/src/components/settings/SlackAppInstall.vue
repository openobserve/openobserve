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
  <!-- Section header comes full-width from the Settings shell; this is a
       CONSTRAINED section, so ConstrainedPage owns the gutter and the scroll. -->
  <div data-test="settings-slack-app-install">
    <p class="text-text-secondary mb-4 text-sm">
      {{ t("settings.slackAppPage.intro", { product: raw("OpenObserve") }) }}
    </p>

    <div class="mb-2 text-sm font-semibold">
      {{ t("settings.slackAppPage.permissionsTitle") }}
    </div>
    <ul
      class="text-text-secondary mb-6 list-disc space-y-1 ps-5 text-sm"
      data-test="settings-slack-app-install-permissions"
    >
      <li>{{ t("settings.slackAppPage.permissionHistory") }}</li>
      <li>{{ t("settings.slackAppPage.permissionWrite") }}</li>
      <li>{{ t("settings.slackAppPage.permissionCommands") }}</li>
    </ul>

    <!-- Slack requires their unmodified button artwork as the install affordance,
         so this one control is an anchor rather than an OButton. -->
    <a
      :href="installUrl"
      target="_blank"
      rel="noopener noreferrer"
      class="inline-block"
      data-test="settings-slack-app-install-button"
    >
      <img :alt="raw('Add to Slack')" :src="buttonSrc" :srcset="buttonSrcSet" class="h-10 w-auto" />
    </a>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { raw, useI18nTyped } from "@/types/i18n";
import { buildSlackInstallUrl } from "@/utils/slackAppInstall";
import { getImageURL } from "@/utils/zincutils";

const { t } = useI18nTyped();

const installUrl = computed(() => buildSlackInstallUrl());
const buttonSrc = computed(() => getImageURL("images/common/add_to_slack.png"));
const buttonSrcSet = computed(
  () => `${buttonSrc.value} 1x, ${getImageURL("images/common/add_to_slack@2x.png")} 2x`,
);
</script>
