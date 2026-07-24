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
  <div class="org-storage-settings h-full">
    <OPageLayout
      v-if="currentAction === 'list'"
      :title="t('storage_settings.title')"
      icon="cloud"
      :subtitle="t('settings.orgStorageSettings.subtitle')"
      bleed
      scroll
    >
      <!-- Loading state -->
      <div
        v-if="loading"
        class="flex min-h-[calc(100vh-var(--navbar-height)-7.5rem)] items-center justify-center"
      >
        <OSpinner size="md" data-test="org-storage-settings-loading-indicator" />
      </div>

      <!-- Cloud: storage not enabled -->
      <div v-else-if="isCloud && !orgStorageEnabled" class="text-text-secondary py-3 text-sm">
        {{ t("storage_settings.notEnabled") }}
      </div>

      <!-- ========== NOT CONFIGURED: cloud hero ========== -->
      <div
        v-else-if="!isConfigured && isCloud"
        class="hero-page flex min-h-[calc(100vh-var(--navbar-height)-6.25rem)] flex-col"
      >
        <div class="hero-page__body flex flex-1 items-center justify-between gap-14 px-20 py-18">
          <!-- left -->
          <div class="hero-page__left max-w-120 flex-1">
            <div
              class="hero-page__headline text-text-heading mb-4.5 text-4xl leading-tight font-bold tracking-tight"
            >
              {{ t("storage_settings.heroHeadline") }}
              <span class="hero-page__brand-text text-theme-accent">{{
                t("storage_settings.heroBrand")
              }}</span>
            </div>

            <div class="hero-page__sub text-text-secondary mb-9 max-w-100 text-base leading-[1.7]">
              {{ t("storage_settings.heroSub") }}
            </div>

            <div class="hero-page__actions mb-7">
              <OButton
                data-test="storage-settings-configure-btn"
                variant="primary"
                class="no-border o2-primary-button hero-cta-btn h-11 px-7 text-base font-semibold"
                @click="navigateToCreate"
              >
                {{ t("storage_settings.configureStorage") }}
              </OButton>
            </div>

            <!-- supported infrastructure -->
            <div class="hero-page__inline-providers flex items-center gap-3">
              <span
                class="hero-page__inline-label text-text-muted text-compact font-medium whitespace-nowrap"
                >{{ t("storage_settings.supportedProviders") }}</span
              >
              <div class="hero-page__inline-logos flex items-center gap-2.5">
                <div
                  v-for="p in availableProviders"
                  :key="p.value"
                  class="hero-page__inline-logo-wrap flex h-7 w-7 shrink-0 cursor-default items-center justify-center opacity-70 transition-opacity duration-150 hover:opacity-100"
                >
                  <img
                    :src="p.image"
                    :alt="p.label"
                    class="hero-page__inline-logo block h-7 max-h-7 w-7 max-w-7 object-contain"
                  />
                  <OTooltip :content="p.label" />
                </div>
              </div>
            </div>
          </div>

          <!-- right: feature cards -->
          <div class="hero-page__right flex w-85 shrink-0 flex-col gap-3.5">
            <div
              v-for="feature in features"
              :key="feature.title"
              class="feature-card rounded-default border-border-default bg-surface-base flex items-start gap-4 border px-5.5 py-5 shadow-md transition-all duration-200 hover:-translate-y-px hover:shadow-lg"
            >
              <div
                class="feature-card__icon-box rounded-default flex h-10 w-10 shrink-0 items-center justify-center bg-[color-mix(in_srgb,var(--color-theme-accent)_8%,transparent)]"
              >
                <OIcon
                  :name="feature.icon"
                  size="md"
                  class="feature-card__icon text-theme-accent opacity-85"
                />
              </div>
              <div class="feature-card__content flex-1 pt-0.5">
                <div class="feature-card__title text-text-heading mb-1.25 text-sm font-bold">
                  {{ feature.title }}
                </div>
                <div class="feature-card__desc text-text-secondary text-compact leading-[1.55]">
                  {{ feature.desc }}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- ========== NOT CONFIGURED: enterprise empty state ========== -->
      <div
        v-else-if="!isConfigured && !isCloud"
        class="min-h-[calc(100vh-var(--navbar-height)-10rem)] w-full"
      >
        <OEmptyState
          size="hero"
          preset="no-storage-config"
          data-test="org-storage-settings-empty-state"
          @action="(id) => id === 'configure' && navigateToCreate()"
        >
          <template #extra>
            <!-- key fact chips -->
            <div class="flex flex-wrap items-center justify-center gap-2">
              <span
                class="text-text-secondary bg-surface-subtle border-border-default inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium"
              >
                <OIcon name="corporate-fare" size="xs" />
                {{ t("storage_settings.perOrgIsolation") }}
              </span>
              <span
                class="text-text-secondary bg-surface-subtle border-border-default inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium"
              >
                <OIcon name="bolt" size="xs" />
                {{ t("storage_settings.appliesImmediately") }}
              </span>
              <span
                class="text-text-secondary bg-surface-subtle border-border-default inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium"
              >
                <OIcon name="lock" size="xs" />
                {{ t("storage_settings.usesOrgCredentials") }}
              </span>
            </div>

            <!-- supported providers -->
            <div class="flex items-center gap-3">
              <span class="text-text-disabled text-xs font-medium whitespace-nowrap">{{
                t("storage_settings.supportedProviders")
              }}</span>
              <div class="flex items-center gap-2.5">
                <div
                  v-for="p in providerDefinitions"
                  :key="p.value"
                  class="flex h-7 w-7 shrink-0 cursor-default items-center justify-center opacity-65 transition-opacity duration-150 hover:opacity-100"
                >
                  <img
                    :src="p.image"
                    :alt="p.label"
                    class="block h-7 max-h-7 w-7 max-w-7 object-contain"
                  />
                  <OTooltip :content="p.label" />
                </div>
              </div>
            </div>
          </template>
        </OEmptyState>
      </div>

      <!-- ========== CONFIGURED ========== -->
      <div v-else>
        <div class="p-3">
          <OCard class="storage-card rounded-default bg-surface-base max-w-170">
            <!-- Card header: logo + name + badge | update button -->
            <OCardSection role="header">
              <div class="flex flex-1 flex-nowrap items-center gap-3.5">
                <img
                  :src="configuredProviderImage"
                  :alt="configuredProviderLabel"
                  class="h-11 w-11 shrink-0 object-contain"
                />
                <div>
                  <div class="text-base leading-tight font-bold">
                    {{ configuredProviderLabel }}
                  </div>
                  <OTag type="activeFlag" class="mt-1" />
                </div>
              </div>
              <OButton
                data-test="storage-settings-update-btn"
                variant="primary"
                size="sm"
                class="no-border o2-primary-button"
                @click="navigateToEdit"
              >
                {{ t("storage_settings.updateStorage") }}
              </OButton>
            </OCardSection>

            <OSeparator />

            <!-- Field grid -->
            <OCardSection role="body">
              <div class="storage-detail-grid grid grid-cols-2 gap-x-8 gap-y-5">
                <div v-if="storageData.bucket_name" class="storage-field">
                  <div
                    class="storage-field__label text-text-label mb-0.75 text-xs font-medium capitalize"
                  >
                    {{ t("storage_settings.bucketName") }}
                  </div>
                  <div class="storage-field__value text-text-body text-sm break-all">
                    {{ storageData.bucket_name }}
                  </div>
                </div>
                <div v-if="storageData.region" class="storage-field">
                  <div
                    class="storage-field__label text-text-label mb-0.75 text-xs font-medium capitalize"
                  >
                    {{ t("storage_settings.region") }}
                  </div>
                  <div class="storage-field__value text-text-body text-sm break-all">
                    {{ storageData.region }}
                  </div>
                </div>
                <div v-if="storageData.server_url && !isCloud" class="storage-field">
                  <div
                    class="storage-field__label text-text-label mb-0.75 text-xs font-medium capitalize"
                  >
                    {{ t("storage_settings.serverUrl") }}
                  </div>
                  <div class="storage-field__value text-text-body text-sm break-all">
                    {{ storageData.server_url }}
                  </div>
                </div>
                <div v-if="storageData.access_key" class="storage-field">
                  <div
                    class="storage-field__label text-text-label mb-0.75 text-xs font-medium capitalize"
                  >
                    {{ t("storage_settings.accessKey") }}
                  </div>
                  <div class="storage-field__value text-text-body text-sm break-all">
                    {{ storageData.access_key }}
                  </div>
                </div>
                <div v-if="storageData.secret_key" class="storage-field">
                  <div
                    class="storage-field__label text-text-label mb-0.75 text-xs font-medium capitalize"
                  >
                    {{ t("storage_settings.secretKey") }}
                  </div>
                  <div class="storage-field__value text-text-body text-sm break-all">
                    {{ storageData.secret_key }}
                  </div>
                </div>
                <div v-if="storageData.role_arn" class="storage-field">
                  <div
                    class="storage-field__label text-text-label mb-0.75 text-xs font-medium capitalize"
                  >
                    {{ t("storage_settings.roleArn") }}
                  </div>
                  <div class="storage-field__value text-text-body text-sm break-all">
                    {{ storageData.role_arn }}
                  </div>
                </div>
              </div>
            </OCardSection>

            <OSeparator v-if="configTimestamps" />

            <!-- Timestamps -->
            <OCardSection v-if="configTimestamps">
              <div class="flex gap-10">
                <div v-if="configTimestamps.created_at" class="flex items-center gap-1.5">
                  <span
                    class="storage-field__label text-text-label mb-0 text-xs font-medium capitalize"
                    >{{ t("storage_settings.createdAt") }}</span
                  >
                  <span class="text-sm">{{ configTimestamps.created_at }}</span>
                </div>
                <div v-if="configTimestamps.updated_at" class="flex items-center gap-1.5">
                  <span
                    class="storage-field__label text-text-label mb-0 text-xs font-medium capitalize"
                    >{{ t("storage_settings.updatedAt") }}</span
                  >
                  <span class="text-sm">{{ configTimestamps.updated_at }}</span>
                </div>
              </div>
            </OCardSection>
          </OCard>
        </div>
      </div>
    </OPageLayout>
    <OrgStorageEditor
      v-else
      :action="currentAction"
      @cancel="currentAction = 'list'"
      @saved="onEditorSaved"
    />
  </div>
</template>

<script lang="ts" setup>
import { ref, computed, onMounted } from "vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OCard from "@/lib/core/Card/OCard.vue";
import OCardSection from "@/lib/core/Card/OCardSection.vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import config from "@/aws-exports";
import orgStorageService from "@/services/org_storage";
import { getImageURL } from "@/utils/zincutils";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OrgStorageEditor from "./OrgStorageEditor.vue";

const store = useStore();
const { t } = useI18n();

const features = [
  {
    icon: "dataset",
    title: t("storage_settings.featureOwnDataTitle"),
    desc: t("storage_settings.featureOwnDataDesc"),
  },
  {
    icon: "security",
    title: t("storage_settings.featureSecureTitle"),
    desc: t("storage_settings.featureSecureDesc"),
  },
];

const loading = ref(true);
const existingConfig = ref<any>(null);
const currentAction = ref<"list" | "add" | "edit">("list");

const isCloud = computed(() => config.isCloud === "true");

const orgStorageEnabled = computed(() => {
  return !isCloud.value || (store.state as any).zoConfig?.org_storage_enabled !== false;
});

const isConfigured = computed(() => existingConfig.value?.provider != null);

// data is already a parsed object from the API
const storageData = computed(() => existingConfig.value?.data || {});

const configuredProviderLabel = computed(() => {
  const found = providerDefinitions.find((p) => p.value === existingConfig.value?.provider);
  return found?.label || existingConfig.value?.provider || "";
});

const configuredProviderImage = computed(() => {
  const found = providerDefinitions.find((p) => p.value === existingConfig.value?.provider);
  return found?.image || "";
});

const configTimestamps = computed(() => {
  const cfg = existingConfig.value;
  if (!cfg) return null;
  const format = (micros: number) => {
    if (!micros || micros <= 0) return null;
    return new Date(micros / 1000).toLocaleString();
  };
  return {
    created_at: format(cfg.created_at),
    updated_at: format(cfg.updated_at),
  };
});

const providerDefinitions = [
  {
    label: t("settings.orgStorageSettings.awsCredentials"),
    value: "AwsCredentials",
    image: getImageURL("images/org_storage/aws_plain_without_bg.png"),
  },
  {
    label: t("settings.orgStorageSettings.azureCredentials"),
    value: "AzureCredentials",
    image: getImageURL("images/org_storage/azure.png"),
  },
  // {
  //   label: "GCP Credentials",
  //   value: "GcpCredentials",
  //   image: getImageURL("images/org_storage/gcp.png"),
  // },
  {
    label: t("settings.orgStorageSettings.awsRoleArn"),
    value: "AwsRoleArn",
    image: getImageURL("images/org_storage/aws_iam.png"),
  },
];

const cloudProviders = computed(() => {
  const raw = (store.state as any).zoConfig?.org_storage_providers;
  if (!raw || !isCloud.value) return null;
  return raw.split(",").map((s: string) => s.trim());
});

const availableProviders = computed(() => {
  let providers = [...providerDefinitions];
  if (isCloud.value && cloudProviders.value) {
    providers = providers.filter((p) => cloudProviders.value!.includes(p.value));
  }
  return providers;
});
async function fetchExistingConfig() {
  loading.value = true;
  try {
    const orgId = store.state.selectedOrganization.identifier;
    const res = await orgStorageService.get(orgId);
    existingConfig.value = res.data;
  } catch {
    // 404 or other errors — treat as not configured
  } finally {
    loading.value = false;
  }
}

function navigateToCreate() {
  currentAction.value = "add";
}

function navigateToEdit() {
  currentAction.value = "edit";
}

async function onEditorSaved() {
  currentAction.value = "list";
  await fetchExistingConfig();
}

onMounted(() => {
  fetchExistingConfig();
});
</script>
