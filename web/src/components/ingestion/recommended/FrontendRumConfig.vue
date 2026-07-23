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
  FrontendRumConfig — the Data Sources > RUM setup page.

  Hosts one card per platform, chosen with the Browser / React Native switch:
  setupCard/content/rum (browser: NPM / CDN) and
  setupCard/content/rumReactNative (React Native: npm / Yarn + session replay).
  They are separate cards rather than variants of one because the runtime,
  troubleshooting and endpoint shape all differ.

  Both authenticate with the org's RUM token — generated from this page's header
  (see Ingestion.vue) — so the card only appears once that token exists.
-->
<script setup lang="ts">
import { computed, ref } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import { getIngestionURL, maskText } from "@/utils/zincutils";
import SetupCardRenderer from "@/components/ingestion/setupCard/SetupCardRenderer.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import type {
  CardSubstitutions,
  RichCardContent,
} from "@/components/ingestion/setupCard/types";
import rumCard from "@/components/ingestion/setupCard/content/rum";
import rumReactNativeCard from "@/components/ingestion/setupCard/content/rumReactNative";

defineProps<{
  currOrgIdentifier?: string;
  currUserEmail?: string;
}>();

const store = useStore();
const { t } = useI18n();

const rumToken = computed<string>(
  () => store.state.organizationData?.rumToken?.rum_token ?? "",
);

// Full origin (preconnect/CSP hints) and the protocol-less `site` SDK option.
const endpoint = computed(() =>
  (getIngestionURL() as string).replace(/\/$/, ""),
);
const site = computed(() => endpoint.value.replace(/^https?:\/\//, ""));
const insecureHTTP = computed(
  () => !String(store.state.API_ENDPOINT ?? "").startsWith("https://"),
);

const org = computed(() => store.state.selectedOrganization?.identifier ?? "");

/**
 * One entry per SDK we ship a guide for. Adding iOS / Android / Flutter later is
 * a new entry here plus its card builder — the template never changes.
 * `label` is an i18n key; `build` returns that platform's whole card.
 */
const PLATFORMS: {
  id: string;
  labelKey: string;
  icon: IconName;
  build: () => RichCardContent;
}[] = [
  {
    id: "browser",
    labelKey: "ingestion.rumPlatformBrowser",
    icon: "web",
    build: () =>
      rumCard({
        site: site.value,
        endpoint: endpoint.value,
        org: org.value,
        rumToken: rumToken.value,
        rumTokenMasked: maskText(rumToken.value),
        insecureHTTP: insecureHTTP.value,
      }),
  },
  {
    id: "react-native",
    labelKey: "ingestion.rumPlatformReactNative",
    icon: "smartphone",
    build: () =>
      rumReactNativeCard({
        endpoint: endpoint.value,
        org: org.value,
        rumToken: rumToken.value,
        rumTokenMasked: maskText(rumToken.value),
        insecureHTTP: insecureHTTP.value,
      }),
  },
];

/** Which platform's setup guide is shown. */
const platform = ref<string>(PLATFORMS[0].id);

const content = computed<RichCardContent>(
  () => (PLATFORMS.find((p) => p.id === platform.value) ?? PLATFORMS[0]).build(),
);

// The renderer's subs drive detection (org) — RUM never exposes the Basic-auth
// ingestion token, so `token` stays empty (no .env download on this card).
const subs = computed<CardSubstitutions>(() => ({
  url: endpoint.value,
  org: org.value,
  token: "",
}));
</script>

<template>
  <div class="p-2">
    <SetupCardRenderer
      v-if="rumToken"
      :key="platform"
      :content="content"
      :subs="subs"
      data-test="rum-web-setup-card"
    >
      <!-- Platform switch sits inline with the card title, on the trailing
           edge — the guide it selects starts directly underneath it. -->
      <template #hero-actions>
        <OToggleGroup
          :model-value="platform"
          type="single"
          :aria-label="t('ingestion.rumPlatform')"
          data-test="rum-setup-platform-group"
          @update:model-value="(v: any) => v && (platform = v as string)"
        >
          <OToggleGroupItem
            v-for="p in PLATFORMS"
            :key="p.id"
            :value="p.id"
            size="sm"
            :data-test="`rum-setup-platform-${p.id}`"
          >
            <OIcon :name="p.icon" size="xs" class="me-1" />
            {{ t(p.labelKey) }}
          </OToggleGroupItem>
        </OToggleGroup>
      </template>
    </SetupCardRenderer>
    <p v-else class="mt-1" data-test="rum-web-no-token-message">
      {{ t("ingestion.generateRUMTokenMessage") }}
    </p>
  </div>
</template>
