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
  <OPageLayout
    :title="t('oncallSlackApp.title')"
    :subtitle="t('oncallSlackApp.subtitle')"
    icon="slack"
    title-data-test="slack-app-settings-title"
    scroll
  >
    <div class="flex max-w-208 flex-col gap-4 py-3">
      <div v-if="read.isPending.value" class="flex justify-center py-10">
        <OSpinner size="md" data-test="slack-app-settings-loading" />
      </div>

      <OBanner v-else-if="!manifest" variant="error" data-test="slack-app-settings-failed">
        {{ t("oncallSlackApp.loadFailed") }}
      </OBanner>

      <template v-else>
        <ol class="text-text-body m-0 flex list-decimal flex-col gap-4 ps-5 text-sm">
          <li>
            <OText variant="body-strong" as="span">{{ t("oncallSlackApp.copyStep") }}</OText>
            {{ t("oncallSlackApp.copyStepHelp") }}
            <div class="pt-2">
              <OCodeBlock
                :code="manifestJson"
                lang="json"
                chrome="editor"
                :filename="MANIFEST_FILENAME"
                :max-lines="16"
                data-test="slack-app-settings-manifest"
              />
            </div>
          </li>
          <li>
            <span class="flex flex-wrap items-center gap-2">
              <OText variant="body-strong" as="span">
                {{ t("oncallSlackApp.createStep", { host: SLACK_HOST }) }}
              </OText>
              <OButton
                as="a"
                :href="newAppUrl"
                target="_blank"
                rel="noopener noreferrer"
                variant="outline"
                size="sm-action"
                icon-right="open-in-new"
                data-test="slack-app-settings-open-slack"
              >
                {{ t("oncallSlackApp.openSlack") }}
              </OButton>
            </span>
          </li>
          <li data-test="slack-app-settings-distribute">
            <OText variant="body-strong" as="span">
              {{ t("oncallSlackApp.distributeStep") }}
            </OText>
            <OBanner variant="info" dense icon="info" class="mt-2">
              {{ t("oncallSlackApp.distributeWhy") }}
            </OBanner>
          </li>
          <li data-test="slack-app-settings-env">
            <OText variant="body-strong" as="span">
              {{ t("oncallSlackApp.envStep", { product: PRODUCT }) }}
            </OText>
            <dl class="mt-2 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2">
              <template v-for="row in envRows" :key="row.name">
                <dt>
                  <OCode>{{ row.name }}</OCode>
                </dt>
                <dd class="text-text-secondary m-0">{{ row.meaning }}</dd>
              </template>
            </dl>
            <OText variant="meta" as="p" class="mt-2 mb-0">
              {{
                t("oncallSlackApp.envRules", {
                  https: HTTPS_PREFIX,
                  masterKey: MASTER_KEY_VAR,
                })
              }}
            </OText>
          </li>
        </ol>
        <OText variant="meta" as="p" class="m-0">{{ t("oncallSlackApp.then") }}</OText>
      </template>
    </div>
  </OPageLayout>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useStore } from "vuex";
import { useQuery } from "@tanstack/vue-query";

import OButton from "@/lib/core/Button/OButton.vue";
import OCode from "@/lib/core/Code/OCode.vue";
import OCodeBlock from "@/lib/core/Code/OCodeBlock.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import { slackManifestUrlsQuery } from "@/services/oncall.queries";
import type { I18nText } from "@/types/i18n";
import { raw, useI18nTyped } from "@/types/i18n";
import {
  buildOncallSlackManifest,
  DEFAULT_ONCALL_SLACK_APP_NAME,
  slackNewAppUrl,
} from "@/utils/slackManifest";

// Names and values with one correct form worldwide, so never translated.
const SLACK_HOST = raw("api.slack.com");
const PRODUCT = raw("OpenObserve");
const HTTPS_PREFIX = raw("https://");
const MASTER_KEY_VAR = raw("O2_MASTER_ENCRYPTION_KEY");
const MANIFEST_FILENAME = "manifest.json";

const { t } = useI18nTyped();
const store = useStore();
const orgId = computed<string>(() => store.state.selectedOrganization.identifier);

const read = useQuery(() => slackManifestUrlsQuery(orgId.value));

const manifest = computed(() =>
  read.data.value ? buildOncallSlackManifest(DEFAULT_ONCALL_SLACK_APP_NAME, read.data.value) : null,
);
const manifestJson = computed(() => JSON.stringify(manifest.value, null, 2));
const newAppUrl = computed(() => slackNewAppUrl(manifest.value ?? {}));

// The three settings IN-1 reads; the operator copies the names verbatim.
const envRows = computed<{ name: I18nText; meaning: I18nText }[]>(() => [
  { name: raw("O2_ONCALL_SLACK_CLIENT_ID"), meaning: t("oncallSlackApp.clientId") },
  { name: raw("O2_ONCALL_SLACK_CLIENT_SECRET"), meaning: t("oncallSlackApp.clientSecret") },
  { name: raw("O2_ONCALL_SLACK_SIGNING_SECRET"), meaning: t("oncallSlackApp.signingSecret") },
]);
</script>
