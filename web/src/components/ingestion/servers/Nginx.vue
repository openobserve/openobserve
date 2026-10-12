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

<script setup lang="ts">
import { useStore } from "vuex";
import CredentialCodeBlock from "@/components/ingestion/CredentialCodeBlock.vue";
import IngestionContent from "@/components/ingestion/IngestionContent.vue";
import IngestionDocLink from "@/components/ingestion/IngestionDocLink.vue";
import useIngestion, { WEB_SERVER_GUIDES, type WebServer } from "@/composables/useIngestion";
import { useI18nTyped } from "@/types/i18n";

const server: WebServer = "nginx";
const { t } = useI18nTyped();
const store = useStore();
const { webServerContent, serverDocURLs } = useIngestion();
const guide = WEB_SERVER_GUIDES[server];
const content = webServerContent(server);
const docURL = serverDocURLs[server];
const org = store.state.selectedOrganization.identifier;
</script>

<template>
  <IngestionContent
    signal="logs"
    :target-stream="server"
    :guide-name="guide.label"
    snippet-kind="config"
  >
    <ol class="m-0 flex list-none flex-col gap-5 p-0" :data-test="`ingestion-${server}-steps`">
      <li class="flex gap-3">
        <span
          class="border-border-default text-text-secondary flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold"
          >{{ 1 }}</span
        >
        <div class="flex min-w-0 flex-1 flex-col gap-2">
          <div class="text-text-heading font-semibold">
            {{ t("ingestion.webServerGuide.installTitle", { server: guide.label }) }}
          </div>
          <CredentialCodeBlock
            v-if="guide.installCommand"
            :slug="`${server}-install`"
            :content="guide.installCommand"
            chrome="terminal"
            lang="bash"
          />
          <p v-else class="text-text-secondary m-0">
            {{ t("ingestion.webServerGuide.installWindows") }}
            <a
              :href="guide.installDocUrl"
              target="_blank"
              rel="noopener noreferrer"
              class="text-text-link hover:underline"
              :data-test="`ingestion-${server}-install-link`"
              >{{ t("ingestion.webServerGuide.installWindowsLink") }}</a
            >
          </p>
        </div>
      </li>
      <li class="flex gap-3">
        <span
          class="border-border-default text-text-secondary flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold"
          >{{ 2 }}</span
        >
        <div class="flex min-w-0 flex-1 flex-col gap-2">
          <div class="text-text-heading font-semibold">
            {{ t("ingestion.webServerGuide.configTitle", { path: guide.configPath }) }}
          </div>
          <p class="text-text-secondary m-0">
            {{
              t("ingestion.webServerGuide.configDescription", {
                server: guide.label,
                stream: server,
                org,
              })
            }}
          </p>
          <CredentialCodeBlock
            :slug="`${server}-config`"
            :content="content"
            chrome="editor"
            filename="fluent-bit.conf"
          />
          <p
            class="text-text-secondary m-0 text-xs"
            :data-test="`ingestion-${server}-restart-hint`"
          >
            {{ t("ingestion.webServerGuide.restartHint", { command: guide.restartCommand }) }}
          </p>
        </div>
      </li>
      <li class="flex gap-3">
        <span
          class="border-border-default text-text-secondary flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold"
          >{{ 3 }}</span
        >
        <div class="text-text-heading font-semibold">
          {{ t("ingestion.webServerGuide.verifyTitle") }}
        </div>
      </li>
    </ol>
    <IngestionDocLink :href="docURL" />
  </IngestionContent>
</template>
