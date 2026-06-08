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
  <div class="tw:rounded-md tw:w-full tw:h-full tw:px-[0.625rem] tw:pb-[0.625rem] tw:pt-2.5">
    <div class="tw:h-full tw:overflow-auto">
      <div class="tw:flex tw:flex-col tw:gap-4">

        <!-- ── Hero Banner ─────────────────────────────────────────── -->
        <div class="tw:relative tw:bg-(--o2-card-bg) tw:rounded-xl tw:p-4 tw:overflow-hidden">
          <div class="tw:relative tw:z-1">
            <img
              :src="
                store.state.theme == 'dark'
                  ? getImageURL('images/common/openobserve_latest_dark_2.svg')
                  : getImageURL('images/common/openobserve_latest_light_2.svg')
              "
              class="tw:block tw:max-w-55"
              width="220"
            />
            <OText variant="body" class="tw:mt-1 tw:mb-0">
              {{ t("about.logoMsg") }}
            </OText>

            <!-- One-line meta bar -->
            <div class="tw:inline-flex tw:items-center tw:flex-wrap tw:gap-2 tw:mt-5">
              <!-- version -->
              <span class="tw:inline-flex tw:items-center tw:gap-1.5 tw:text-sm tw:font-semibold tw:whitespace-nowrap tw:py-2 tw:px-3.5 tw:rounded tw:border tw:text-(--o2-positive) tw:border-[color-mix(in_srgb,var(--o2-positive)_28%,transparent)] tw:bg-[color-mix(in_srgb,var(--o2-positive)_8%,var(--o2-card-bg))]">
                <OIcon name="check-circle" size="sm" class="tw:text-(--o2-positive) tw:shrink-0" />
                {{ store.state.zoConfig.version }}
              </span>
              <!-- build type -->
              <span class="tw:inline-flex tw:items-center tw:gap-1.5 tw:text-sm tw:font-semibold tw:capitalize tw:whitespace-nowrap tw:py-2 tw:px-3.5 tw:rounded tw:border tw:text-(--o2-primary-color) tw:border-[color-mix(in_srgb,var(--o2-primary-color)_28%,transparent)] tw:bg-[color-mix(in_srgb,var(--o2-primary-color)_8%,var(--o2-card-bg))]">
                <OIcon name="workspaces" size="sm" class="tw:text-(--o2-primary-color) tw:shrink-0" />
                {{ store.state.zoConfig.build_type }}
              </span>
              <!-- commit -->
              <span class="tw:inline-flex tw:items-center tw:gap-1.5 tw:text-sm tw:text-(--o2-text-heading) tw:whitespace-nowrap tw:py-2 tw:px-3.5 tw:rounded tw:border tw:border-[color-mix(in_srgb,var(--o2-info)_28%,transparent)] tw:bg-[color-mix(in_srgb,var(--o2-info)_8%,var(--o2-card-bg))]">
                <OIcon name="code" size="sm" class="tw:text-(--o2-info) tw:shrink-0" />
                <span class="tw:text-xs tw:font-semibold tw:uppercase tw:tracking-wide tw:text-(--o2-info)">{{ t("about.commit_lbl") }}</span>
                <OText variant="mono">{{ store.state.zoConfig.commit_hash }}</OText>
                <button
                  @click="copyToClipboard(store.state.zoConfig.commit_hash)"
                  class="tw:inline-flex tw:items-center tw:justify-center tw:p-0.5 tw:rounded tw:border-none tw:bg-transparent tw:cursor-pointer tw:text-(--o2-text-muted) tw:hover:text-(--o2-info) tw:transition-colors tw:duration-150"
                  title="Copy commit hash"
                >
                  <OIcon name="content-copy" size="sm" />
                </button>
              </span>
              <!-- built date -->
              <span class="tw:inline-flex tw:items-center tw:gap-1.5 tw:text-sm tw:text-(--o2-text-heading) tw:whitespace-nowrap tw:py-2 tw:px-3.5 tw:rounded tw:border tw:border-[color-mix(in_srgb,var(--o2-warning)_28%,transparent)] tw:bg-[color-mix(in_srgb,var(--o2-warning)_8%,var(--o2-card-bg))]">
                <OIcon name="event" size="sm" class="tw:text-(--o2-warning) tw:shrink-0" />
                <span class="tw:text-xs tw:font-semibold tw:uppercase tw:tracking-wide tw:text-(--o2-warning)">{{ t("about.build_lbl") }}</span>
                {{ formatDate(store.state.zoConfig.build_date) }}
              </span>
            </div>
          </div>
        </div>

        <!-- ── Info Cards Grid ─────────────────────────────────────── -->
        <div class="tw:grid tw:grid-cols-1 md:tw:grid-cols-2 tw:gap-4">

          <!-- Open Source Libraries -->
          <div class="tw:bg-(--o2-card-bg) tw:rounded-[0.625rem] tw:p-4 tw:flex tw:flex-col tw:gap-y-2">
            <div class="tw:flex tw:items-center tw:gap-3">
              <div class="tw:w-12 tw:h-12 tw:rounded-lg tw:flex tw:items-center tw:justify-center tw:shrink-0 tw:bg-[color-mix(in_srgb,var(--o2-primary-color)_12%,var(--o2-card-bg))] tw:text-(--o2-primary-color)">
                <OIcon name="code" size="md" />
              </div>
                <OText variant="panel-title" as="h2">{{ t("about.os_libraries") }}</OText>
            </div>
            <div class="tw:text-sm" style="color: var(--o2-text-secondary)">{{ t("about.os_libraries_msg") }}</div>
            <div class="tw:grid tw:grid-cols-4 tw:gap-2.5">
              <a
                href="https://github.com/openobserve/openobserve/blob/main/Cargo.toml"
                target="_blank"
                class="tw:flex tw:items-center tw:gap-3 tw:py-3 tw:px-3.5 tw:border tw:border-(--o2-border-color) tw:rounded-lg tw:bg-(--o2-card-bg) tw:no-underline tw:transition-all tw:duration-200 tw:hover:border-[color-mix(in_srgb,var(--o2-primary-color)_35%,transparent)]"
              >
                <OIcon name="settings" size="md" class="tw:text-(--o2-primary-color) tw:shrink-0" />
                <div class="tw:flex-1 tw:flex tw:flex-col tw:gap-0.5 tw:min-w-0">
                  <span class="tw:text-sm tw:font-semibold tw:font-mono tw:text-(--o2-text-heading) tw:whitespace-nowrap tw:overflow-hidden tw:text-ellipsis">Cargo.toml</span>
                  <span class="tw:text-xs tw:text-(--o2-text-muted)">Rust crates</span>
                </div>
                <OIcon name="open-in-new" size="sm" class="tw:text-(--o2-text-muted) tw:shrink-0" />
              </a>
              <a
                href="https://github.com/openobserve/openobserve/blob/main/web/package.json"
                target="_blank"
                class="tw:flex tw:items-center tw:gap-3 tw:py-3 tw:px-3.5 tw:border tw:border-(--o2-border-color) tw:rounded-lg tw:bg-(--o2-card-bg) tw:no-underline tw:transition-all tw:duration-200 tw:hover:border-[color-mix(in_srgb,var(--o2-primary-color)_35%,transparent)]"
              >
                <OIcon name="backpack" size="md" class="tw:text-(--o2-primary-color) tw:shrink-0" />
                <div class="tw:flex-1 tw:flex tw:flex-col tw:gap-0.5 tw:min-w-0">
                  <span class="tw:text-sm tw:font-semibold tw:font-mono tw:text-(--o2-text-heading) tw:whitespace-nowrap tw:overflow-hidden tw:text-ellipsis">package.json</span>
                  <span class="tw:text-xs tw:text-(--o2-text-muted)">Node packages</span>
                </div>
                <OIcon name="open-in-new" size="sm" class="tw:text-(--o2-text-muted) tw:shrink-0" />
              </a>
              <a
                href="https://npmjs.com"
                target="_blank"
                class="tw:flex tw:items-center tw:gap-3 tw:py-3 tw:px-3.5 tw:border tw:border-(--o2-border-color) tw:rounded-lg tw:bg-(--o2-card-bg) tw:no-underline tw:transition-all tw:duration-200 tw:hover:border-[color-mix(in_srgb,var(--o2-primary-color)_35%,transparent)]"
              >
                <OIcon name="javascript" size="md" class="tw:text-(--o2-primary-color) tw:shrink-0" />
                <div class="tw:flex-1 tw:flex tw:flex-col tw:gap-0.5 tw:min-w-0">
                  <span class="tw:text-sm tw:font-semibold tw:font-mono tw:text-(--o2-text-heading) tw:whitespace-nowrap tw:overflow-hidden tw:text-ellipsis">npmjs.com</span>
                  <span class="tw:text-xs tw:text-(--o2-text-muted)">JS registry</span>
                </div>
                <OIcon name="open-in-new" size="sm" class="tw:text-(--o2-text-muted) tw:shrink-0" />
              </a>
              <a
                href="https://crates.io"
                target="_blank"
                class="tw:flex tw:items-center tw:gap-3 tw:py-3 tw:px-3.5 tw:border tw:border-(--o2-border-color) tw:rounded-lg tw:bg-(--o2-card-bg) tw:no-underline tw:transition-all tw:duration-200 tw:hover:border-[color-mix(in_srgb,var(--o2-primary-color)_35%,transparent)]"
              >
                <OIcon name="inventory-2" size="md" class="tw:text-(--o2-primary-color) tw:shrink-0" />
                <div class="tw:flex-1 tw:flex tw:flex-col tw:gap-0.5 tw:min-w-0">
                  <span class="tw:text-sm tw:font-semibold tw:font-mono tw:text-(--o2-text-heading) tw:whitespace-nowrap tw:overflow-hidden tw:text-ellipsis">crates.io</span>
                  <span class="tw:text-xs tw:text-(--o2-text-muted)">Rust registry</span>
                </div>
                <OIcon name="open-in-new" size="sm" class="tw:text-(--o2-text-muted) tw:shrink-0" />
              </a>
            </div>
          </div>

          <!-- License Info (opensource or enterprise on-prem) -->
          <div
            v-if="store.state.zoConfig.build_type == 'opensource' || (store.state.zoConfig.build_type == 'enterprise' && config.isCloud == 'false')"
            class="tw:bg-(--o2-card-bg) tw:rounded-[0.625rem] tw:p-4"
          >
            <div class="tw:flex tw:items-center tw:gap-3 tw:mb-3">
              <div class="tw:w-12 tw:h-12 tw:rounded-lg tw:flex tw:items-center tw:justify-center tw:shrink-0 tw:bg-[color-mix(in_srgb,var(--o2-info)_12%,var(--o2-card-bg))] tw:text-(--o2-info)">
                <OIcon name="shield" size="md" />
              </div>
              <OText variant="page-title" as="h2" class="tw:m-0">{{ t("about.license_info") }}</OText>
            </div>
            <OText v-if="store.state.zoConfig.build_type == 'opensource'" variant="body" as="div" class="tw:leading-relaxed tw:m-0 tw:mb-4">
              {{ t("about.license_info_os_msg") }}
              <a
                href="https://github.com/openobserve/openobserve/blob/main/LICENSE"
                target="_blank"
                class="tw:text-(--o2-text-link) tw:no-underline tw:font-medium tw:border-b tw:border-[color-mix(in_srgb,var(--o2-text-link)_35%,transparent)] tw:transition-colors tw:duration-200 tw:hover:border-(--o2-text-link)"
              >GNU Affero General Public License (AGPL)</a>.
            </OText>
            <OText v-if="store.state.zoConfig.build_type == 'enterprise' && config.isCloud == 'false'" variant="body" as="div" class="tw:leading-relaxed">
              {{ t("about.license_info_msg") }}
            </OText>
            <OBanner variant="info" icon="info" class="tw:mt-2">
              {{ t("about.license_info_note") }}
            </OBanner>
          </div>

          <!-- Community Card (fallback for cloud) -->
          <div v-else class="tw:bg-(--o2-card-bg) tw:rounded-[0.625rem] tw:p-4">
            <div class="tw:flex tw:items-center tw:gap-3 tw:mb-3">
              <div class="tw:w-12 tw:h-12 tw:rounded-lg tw:flex tw:items-center tw:justify-center tw:shrink-0 tw:bg-[color-mix(in_srgb,var(--o2-primary-color)_12%,var(--o2-card-bg))] tw:text-(--o2-primary-color)">
                <OIcon name="groups" size="md" />
              </div>
              <OText variant="page-title" as="h3" class="tw:m-0">{{ t("about.community_lbl") }}</OText>
            </div>
            <OText variant="body" class="tw:leading-relaxed tw:m-0 tw:mb-4">{{ t("about.community_msg") }}</OText>
            <div class="tw:flex tw:flex-wrap tw:gap-2">
              <a
                href="https://github.com/openobserve/openobserve"
                target="_blank"
                class="tw:inline-flex tw:items-center tw:gap-1.5 tw:py-2 tw:px-3.5 tw:rounded tw:bg-[color-mix(in_srgb,var(--o2-primary-color)_8%,var(--o2-card-bg))] tw:text-(--o2-primary-color) tw:no-underline tw:text-sm tw:font-medium tw:border tw:border-[color-mix(in_srgb,var(--o2-primary-color)_18%,transparent)] tw:transition-all tw:duration-200"
              >
                <OIcon name="code" size="sm" />
                GitHub
              </a>
              <a
                href="https://openobserve.ai"
                target="_blank"
                class="tw:inline-flex tw:items-center tw:gap-1.5 tw:py-2 tw:px-3.5 tw:rounded tw:bg-[color-mix(in_srgb,var(--o2-primary-color)_8%,var(--o2-card-bg))] tw:text-(--o2-primary-color) tw:no-underline tw:text-sm tw:font-medium tw:border tw:border-[color-mix(in_srgb,var(--o2-primary-color)_18%,transparent)] tw:transition-all tw:duration-200"
              >
                <OIcon name="language" size="sm" />
                Website
              </a>
            </div>
          </div>
        </div>

        <!-- ── Enterprise License Details ──────────────────────────── -->
        <div v-if="config.isEnterprise == 'true' && config.isCloud === 'false'" class="tw:bg-(--o2-card-bg) tw:rounded-[0.625rem] tw:p-4">
          <!-- Header: eyebrow + title + manage button -->
          <div class="tw:flex tw:items-start tw:justify-between tw:mb-2">
            <div class="tw:flex tw:items-start tw:gap-3">
              <div class="tw:w-12 tw:h-12 tw:rounded-lg tw:flex tw:items-center tw:justify-center tw:shrink-0 tw:bg-[color-mix(in_srgb,var(--o2-info)_12%,var(--o2-card-bg))] tw:text-(--o2-info)">
                <OIcon name="workspace-premium" size="md" />
              </div>
              <div>
                <OText variant="label" class="tw:uppercase tw:tracking-widest tw:m-0 tw:mb-1 tw:text-(--o2-primary-color)">License &amp; Usage</OText>
                <h2 class="tw:text-xl tw:font-semibold tw:m-0 tw:text-text-heading">{{ t("about.ent_lincese_detail_lbl") }}</h2>
              </div>
            </div>
            <OButton variant="primary" size="sm" @click="navigateToLicense">
              {{ t('about.manage_license') }}
            </OButton>
          </div>
          <OText variant="body" class="tw:leading-relaxed tw:m-0 tw:mb-5 tw:ml-15">{{ t("about.license_info_msg") }}</OText>

          <div v-if="loadingLicense" class="tw:text-center tw:py-8">
            <OSpinner size="md" />
            <div class="tw:mt-3 tw:text-sm tw:text-(--o2-text-muted)">{{ t("about.loading_license_info") }}</div>
          </div>

          <div v-else-if="!licenseData || !licenseData.license" class="tw:py-2">
            <OBanner variant="warning" icon="warning">
              <div class="tw:font-semibold tw:mb-1">{{ t("about.no_license_installed_lbl") }}</div>
              <p class="tw:text-sm tw:mb-2">{{ t("about.no_license_installed_msg") }}</p>
              <div v-if="licenseData && licenseData.installation_id" class="tw:text-xs tw:flex tw:items-center tw:flex-wrap tw:gap-1">
                {{ t("about.installation_id_lbl") }}:
                <code class="tw:px-2 tw:py-0.5 tw:rounded tw:font-mono tw:border tw:border-solid tw:border-(--o2-border-color) tw:bg-(--o2-code-bg) tw:select-all">
                  {{ licenseData.installation_id }}
                </code>
              </div>
            </OBanner>
          </div>

          <div v-else class="tw:grid tw:grid-cols-2 tw:gap-4">
            <!-- License details table -->
            <div class="tw:border tw:border-(--o2-border-color) tw:rounded-lg tw:overflow-hidden">
              <table class="tw:w-full tw:border-collapse">
                <tbody>
                  <tr class="tw:border-b tw:border-(--o2-border-color) tw:last:border-b-0">
                    <td class="tw:w-2/5 tw:font-semibold tw:text-sm tw:text-(--o2-text-secondary) tw:py-2.5 tw:px-3.5 tw:border-r tw:border-(--o2-border-color) tw:whitespace-nowrap tw:bg-[color-mix(in_srgb,var(--o2-primary-color)_4%,var(--o2-card-bg))]">{{ t("about.lincese_id_lbl") }}</td>
                    <td class="tw:text-sm tw:text-(--o2-text-body) tw:py-2.5 tw:px-3.5 tw:font-mono">
                      <div class="tw:flex tw:items-center tw:gap-1.5">
                        <span>{{ licenseData.license.license_id }}</span>
                        <button
                          @click="copyToClipboard(licenseData.license.license_id)"
                          class="tw:inline-flex tw:items-center tw:justify-center tw:p-0.5 tw:rounded tw:border-none tw:bg-transparent tw:cursor-pointer tw:text-(--o2-text-muted) tw:hover:text-(--o2-primary-color) tw:transition-colors tw:duration-150"
                          title="Copy license ID"
                        >
                          <OIcon name="content-copy" size="sm" />
                        </button>
                      </div>
                    </td>
                  </tr>
                  <tr class="tw:border-b tw:border-(--o2-border-color) tw:last:border-b-0">
                    <td class="tw:w-2/5 tw:font-semibold tw:text-sm tw:text-(--o2-text-secondary) tw:py-2.5 tw:px-3.5 tw:border-r tw:border-(--o2-border-color) tw:whitespace-nowrap tw:bg-[color-mix(in_srgb,var(--o2-primary-color)_4%,var(--o2-card-bg))]">{{ t("about.status_lbl") }}</td>
                    <td class="tw:text-sm tw:text-(--o2-text-body) tw:py-2.5 tw:px-3.5">
                      <span
                        class="tw:inline-block tw:w-2 tw:h-2 tw:rounded-full tw:mr-1.5 tw:align-middle"
                        :class="licenseData?.expired ? 'tw:bg-(--o2-negative)' : 'tw:bg-(--o2-positive)'"
                      />
                      <span :class="licenseData?.expired ? 'tw:text-red-500' : 'tw:text-green-600'">
                        {{ licenseData?.expired ? t("about.expired_lbl") : t("about.active_lbl") }}
                      </span>
                    </td>
                  </tr>
                  <tr class="tw:border-b tw:border-(--o2-border-color) tw:last:border-b-0">
                    <td class="tw:w-2/5 tw:font-semibold tw:text-sm tw:text-(--o2-text-secondary) tw:py-2.5 tw:px-3.5 tw:border-r tw:border-(--o2-border-color) tw:whitespace-nowrap tw:bg-[color-mix(in_srgb,var(--o2-primary-color)_4%,var(--o2-card-bg))]">Edition</td>
                    <td class="tw:text-sm tw:text-(--o2-text-body) tw:py-2.5 tw:px-3.5">{{ t("about.value_license_enterprise") }}</td>
                  </tr>
                  <tr class="tw:border-b tw:border-(--o2-border-color) tw:last:border-b-0">
                    <td class="tw:w-2/5 tw:font-semibold tw:text-sm tw:text-(--o2-text-secondary) tw:py-2.5 tw:px-3.5 tw:border-r tw:border-(--o2-border-color) tw:whitespace-nowrap tw:bg-[color-mix(in_srgb,var(--o2-primary-color)_4%,var(--o2-card-bg))]">{{ t("about.create_at_lbl") }}</td>
                    <td class="tw:text-sm tw:text-(--o2-text-body) tw:py-2.5 tw:px-3.5">{{ formatLicenseDate(licenseData.license.created_at) }}</td>
                  </tr>
                  <tr class="tw:border-b tw:border-(--o2-border-color) tw:last:border-b-0">
                    <td class="tw:w-2/5 tw:font-semibold tw:text-sm tw:text-(--o2-text-secondary) tw:py-2.5 tw:px-3.5 tw:border-r tw:border-(--o2-border-color) tw:whitespace-nowrap tw:bg-[color-mix(in_srgb,var(--o2-primary-color)_4%,var(--o2-card-bg))]">{{ t("about.expires_at_lbl") }}</td>
                    <td class="tw:text-sm tw:text-(--o2-text-body) tw:py-2.5 tw:px-3.5">{{ formatLicenseDate(licenseData.license.expires_at) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <!-- Ingestion usage panel -->
            <div class="tw:bg-[color-mix(in_srgb,var(--o2-primary-color)_4%,var(--o2-card-bg))] tw:border tw:border-(--o2-border-color) tw:rounded-lg tw:p-5">
              <p class="tw:text-sm tw:font-semibold tw:m-0 tw:mb-1" style="color: var(--o2-text-heading)">{{ t("about.usage_limits") }}</p>
              <p class="tw:text-xs tw:m-0 tw:mb-4" style="color: var(--o2-text-muted)">
                {{ licenseData.license.limits?.Ingestion?.typ || 'PerDayCount' }}
                · limit {{ licenseData.license.limits?.Ingestion?.value || 50 }} GB / day
              </p>
              <div v-if="licenseData.ingestion_used !== undefined">
                <div class="tw:flex tw:items-baseline tw:gap-2 tw:mb-3">
                  <span
                    class="tw:text-4xl tw:font-bold tw:text-(--o2-text-heading) tw:leading-none"
                    :class="licenseData.ingestion_used > 90 ? 'tw:text-red-500' : licenseData.ingestion_used > 70 ? 'tw:text-orange-500' : ''"
                  >{{ licenseData.ingestion_used.toFixed(2) }}%</span>
                  <span class="tw:text-xs tw:text-(--o2-text-secondary)">of daily limit used today</span>
                </div>
                <div class="tw:h-1.5 tw:rounded-full tw:bg-(--o2-border-color) tw:overflow-hidden tw:mb-1.5">
                  <div
                    class="tw:h-full tw:rounded-full tw:transition-[width] tw:duration-[400ms] tw:min-w-1"
                    :class="licenseData.ingestion_used > 90 ? 'tw:bg-(--o2-negative)' : licenseData.ingestion_used > 70 ? 'tw:bg-(--o2-warning)' : 'tw:bg-(--o2-primary-color)'"
                    :style="{ width: Math.min(licenseData.ingestion_used, 100) + '%' }"
                  />
                </div>
                <div class="tw:flex tw:justify-between tw:text-xs tw:text-(--o2-text-muted) tw:mb-3.5">
                  <span>{{ ((licenseData.ingestion_used / 100) * (licenseData.license.limits?.Ingestion?.value || 50)).toFixed(0) }} GB today</span>
                  <span>{{ licenseData.license.limits?.Ingestion?.value || 50 }} GB / day</span>
                </div>
              </div>
              <div class="tw:flex tw:items-start tw:gap-1.5 tw:text-xs tw:text-(--o2-positive) tw:bg-[color-mix(in_srgb,var(--o2-positive)_8%,var(--o2-card-bg))] tw:border tw:border-[color-mix(in_srgb,var(--o2-positive)_22%,transparent)] tw:rounded tw:py-2 tw:px-3">
                <OIcon name="check-circle" size="sm" class="tw:shrink-0 tw:mt-0.5" />
                {{ t("about.feature_comparision_plan_detail") }}
              </div>
            </div>
          </div>
        </div>

        <!-- ── Feature Comparison ──────────────────────────────────── -->
        <div v-if="config.isCloud === 'false'" class="tw:bg-(--o2-card-bg) tw:rounded-[0.625rem] tw:p-4 tw:mb-5">
          <FeatureComparisonTable />
        </div>

      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, onMounted } from "vue";
import { useStore } from "vuex";
import { getImageURL } from "../utils/zincutils";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import config from "@/aws-exports";
import licenseServer from "@/services/license_server";
import FeatureComparisonTable from "@/components/about/FeatureComparisonTable.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OText from "@/lib/core/Typography/OText.vue";
import { toast } from "@/lib/feedback/Toast/useToast";

export default defineComponent({
  name: "PageAbout",
  components: {
    FeatureComparisonTable,
    OButton,
    OIcon,
    OBadge,
    OSpinner,
    OBanner,
    OText,
  },
  setup() {
    const store = useStore();
    const router = useRouter();
    const pageData = ref("Page Data");
    const { t } = useI18n();
    const licenseData = ref<any>(null);
    const loadingLicense = ref(false);

    const formatDate = (dateString: string) => {
      const date = new Date(dateString);
      return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      });
    };

    const formatLicenseDate = (timestamp: number) => {
      return new Date(timestamp / 1000).toLocaleString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
    };

    const loadLicenseData = async () => {
      try {
        loadingLicense.value = true;
        const response = await licenseServer.get_license();
        licenseData.value = response.data;
      } catch (error) {
        console.error("Error loading license data:", error);
        licenseData.value = null;
      } finally {
        loadingLicense.value = false;
      }
    };

    onMounted(() => {
      if (config.isCloud == 'false' && config.isEnterprise == 'true') {
        loadLicenseData();
      }
    });

    const copyToClipboard = (text: string) => {
      navigator.clipboard.writeText(text).then(() => {
        toast({ message: "Copied to clipboard", variant: "success" });
      });
    };

    const navigateToLicense = () => {
      const metaOrgIdentifier = store.state.zoConfig.meta_org;
      const metaOrg = store.state.organizations?.find(
        (org: any) => org.identifier === metaOrgIdentifier
      );

      if (metaOrg) {
        const metaOrgOption = {
          label: metaOrg.name,
          id: metaOrg.id,
          identifier: metaOrg.identifier,
          user_email: store.state.userInfo.email,
          ingest_threshold: metaOrg.ingest_threshold,
          search_threshold: metaOrg.search_threshold,
        };
        store.dispatch("setSelectedOrganization", metaOrgOption);
        router.push({
          name: 'license',
          query: { org_identifier: metaOrgIdentifier }
        });
      } else {
        toast({
          message: "You are not authorized to manage the license.",
          variant: "error",
        });
      }
    };

    return {
      t,
      store,
      config,
      pageData,
      getImageURL,
      formatDate,
      licenseData,
      loadingLicense,
      formatLicenseDate,
      navigateToLicense,
      copyToClipboard,
    };
  },
});
</script>

<style lang="scss" scoped>
/* intentionally empty */
</style>
