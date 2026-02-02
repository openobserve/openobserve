<!-- Copyright 2023 OpenObserve Inc.

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
  <q-page class="tw:w-full tw:h-full tw:px-[0.625rem] tw:pb-[0.625rem] aboutPage q-pt-xs">
    <div class="card-container tw:h-[calc(100vh-50px)] tw:overflow-auto">
      <div class="q-px-sm q-py-sm tw:h-full">
        <!-- Hero Section -->
        <div class="hero-section">
          <div class="tw:flex tw:flex-col tw:flex-row tw:items-center tw:justify-between tw:gap-8">
            <div class="tw:flex-1">
              <img
                :src="
                  store.state.theme == 'dark'
                    ? getImageURL('images/common/openobserve_latest_dark_2.svg')
                    : getImageURL('images/common/openobserve_latest_light_2.svg')
                "
                class="logo"
                width="220"
              />
              <p class="tagline tw:mt-4">{{ t("about.logoMsg") }}</p>
              <div class="tw:flex tw:gap-3 tw:mt-6">
                <div class="version-badge" :class="store.state.theme === 'dark' ? 'version-badge-dark' : 'version-badge-light'">
                  <span>{{ store.state.zoConfig.version }}</span>
                </div>
                <div class="build-badge tw:capitalize" :class="store.state.theme === 'dark' ? 'build-badge-dark' : 'build-badge-light'">
                  <q-icon name="workspaces" size="20px" />
                  <span>{{ store.state.zoConfig.build_type }}</span>
                </div>
              </div>
            </div>
            <div class="stats-grid">
              <div class="stat-card stat-card-commit" :class="store.state.theme === 'dark' ? 'stat-card-commit-dark' : 'stat-card-commit-light'">
                <q-icon name="code" size="32px" class="stat-icon" />
                <div class="stat-label">{{ t("about.commit_lbl") }}</div>
                <div class="stat-value tw:font-mono">{{ store.state.zoConfig.commit_hash }}</div>
              </div>
              <div class="stat-card stat-card-built" :class="store.state.theme === 'dark' ? 'stat-card-built-dark' : 'stat-card-built-light'">
                <q-icon name="event" size="32px" class="stat-icon" />
                <div class="stat-label">{{ t("about.build_lbl") }}</div>
                <div class="stat-value">{{ formatDate(store.state.zoConfig.build_date) }}</div>
              </div>
            </div>
          </div>
        </div>

        <!-- Features Grid -->
        <div class="tw:grid tw:grid-cols-1 md:tw:grid-cols-2 tw:gap-4">
          <!-- Open Source Libraries -->
          <div class=" feature-card">
            <div class="tw:mb-4">
              <div class="tw:flex tw:items-center tw:gap-3 tw:mb-3">
                <div class="icon-wrapper" :class="store.state.theme === 'dark' ? 'icon-wrapper-dark' : 'icon-wrapper-light'">
                  <q-icon name="code" size="24px" />
                </div>
                <h3 class="feature-title">{{ t("about.os_libraries") }}</h3>
              </div>
              <p class="feature-text">
                {{ t("about.os_libraries_msg") }}
              </p>
            </div>
            <div class="tw:flex tw:flex-wrap tw:gap-2">
              <a
                href="https://github.com/openobserve/openobserve/blob/main/Cargo.toml"
                target="_blank"
                class="link-badge"
              >
                <q-icon name="settings" size="16px" class="tw:mr-1" />
                Cargo.toml
              </a>
              <a
                href="https://github.com/openobserve/openobserve/blob/main/web/package.json"
                target="_blank"
                class="link-badge"
              >
              <q-icon name="backpack" class="tw:mr-1" />
                package.json
              </a>
              <a href="https://npmjs.com" target="_blank" class="link-badge">
                <q-icon name="javascript" size="16px" class="tw:mr-1" />
                npmjs.com
              </a>
              <a href="https://crates.io" target="_blank" class="link-badge">
                <q-icon name="inventory_2" size="16px" class="tw:mr-1" />
                crates.io
              </a>
            </div>
          </div>

          <!-- License Info -->
          <div
            v-if="store.state.zoConfig.build_type == 'opensource' || (store.state.zoConfig.build_type == 'enterprise' && config.isCloud == 'false')"
            class=" feature-card license-feature"
          >
            <div class="tw:mb-4">
              <div class="tw:flex tw:items-center tw:gap-3 tw:mb-3">
                <div class="icon-wrapper" :class="store.state.theme === 'dark' ? 'icon-wrapper-dark' : 'icon-wrapper-light'">
                  <q-icon name="shield" size="24px" />
                </div>
                <h3 class="feature-title">{{ t("about.license_info") }}</h3>
              </div>
              <p v-if="store.state.zoConfig.build_type == 'opensource'" class="feature-text">
                {{ t("about.license_info_os_msg") }} <a
                  href="https://github.com/openobserve/openobserve/blob/main/LICENSE"
                  target="_blank"
                  class="inline-link"
                >GNU Affero General Public License (AGPL)</a>.
              </p>
              <p v-if="store.state.zoConfig.build_type == 'enterprise' && config.isCloud == 'false'" class="feature-text">
                {{ t("about.license_info_msg") }}
              </p>
            </div>
            <div class="tw:mt-4 tw:p-3 tw:rounded tw:bg-opacity-10" :class="store.state.theme === 'dark' ? 'tw:bg-blue-400' : 'tw:bg-blue-500'">
              <p class="tw:text-sm tw:mb-0">
                <q-icon name="info" size="16px" class="tw:mr-1" />
                {{ t("about.license_info_note") }}
              </p>
            </div>
          </div>

          <!-- Community Card (if no license card) -->
          <div
            v-else
            class=" feature-card"
          >
            <div class="tw:mb-4" style="min-height: 120px;">
              <div class="tw:flex tw:items-center tw:gap-3 tw:mb-3">
                <div class="icon-wrapper" :class="store.state.theme === 'dark' ? 'icon-wrapper-dark' : 'icon-wrapper-light'">
                  <q-icon name="groups" size="24px" />
                </div>
                <h3 class="feature-title">{{ t("about.community_lbl") }}</h3>
              </div>
              <p class="feature-text">
                {{ t("about.community_msg") }}
              </p>
            </div>
            <div class="tw:flex tw:flex-wrap tw:gap-2">
              <a href="https://github.com/openobserve/openobserve" target="_blank" class="link-badge">
                <q-icon name="code" size="16px" class="tw:mr-1" />
                GitHub
              </a>
              <a href="https://openobserve.ai" target="_blank" class="link-badge">
                <q-icon name="language" size="16px" class="tw:mr-1" />
                Website
              </a>
            </div>
          </div>
        </div>

        <!-- Enterprise License Details Section -->
        <div v-if="config.isEnterprise == 'true' && config.isCloud === 'false'" class="tw:mt-4">
          <div class="feature-card">
            <div class="tw:flex tw:items-center tw:justify-between tw:mb-4">
              <div class="tw:flex tw:items-center tw:gap-3">
                <div class="icon-wrapper" :class="store.state.theme === 'dark' ? 'icon-wrapper-dark' : 'icon-wrapper-light'">
                  <q-icon name="workspace_premium" size="24px" />
                </div>
                <h3 class="feature-title">{{ t("about.ent_lincese_detail_lbl") }}</h3>
              </div>
              <q-btn
                no-caps
                :label="t('about.manage_license')"
                @click="navigateToLicense"
                size="sm"
                class="o2-primary-button"
              />
            </div>

            <div v-if="loadingLicense" class="tw:text-center tw:py-8">
              <q-spinner size="40px" color="primary" />
              <div class="tw:mt-3 tw:text-sm tw:opacity-70">{{ t("about.loading_license_info") }}</div>
            </div>

            <div v-else-if="!licenseData || !licenseData.license" class="tw:py-4">
              <div class="tw:flex tw:items-start tw:gap-3 tw:p-4 tw:rounded tw:bg-opacity-10" :class="store.state.theme === 'dark' ? 'tw:bg-yellow-400' : 'tw:bg-yellow-500'">
                <q-icon name="warning" size="24px" class="tw:text-yellow-500" />
                <div>
                  <div class="tw:font-semibold tw:mb-1">{{ t("about.no_license_installed_lbl") }}</div>
                  <p class="tw:text-sm tw:mb-2 tw:opacity-80">
                    {{ t("about.no_license_installed_msg") }}
                  </p>
                  <div v-if="licenseData && licenseData.installation_id" class="tw:text-xs tw:opacity-70 tw:mb-2">
                    {{ t("about.installation_id_lbl") }}: <code class="tw:px-2 tw:py-1 tw:rounded tw:bg-black tw:bg-opacity-10">{{ licenseData.installation_id }}</code>
                  </div>
                </div>
              </div>
            </div>

            <div v-else>
              <div class="tw:grid tw:grid-cols-1 md:tw:grid-cols-2 tw:gap-4">
                <div>
                  <q-markup-table flat bordered dense class="compact-table">
                    <tbody>
                      <tr>
                        <td class="tw:font-semibold">{{ t("about.lincese_id_lbl") }}</td>
                        <td>{{ licenseData.license.license_id }}</td>
                      </tr>
                      <tr>
                        <td class="tw:font-semibold">{{ t("about.status_lbl") }}</td>
                        <td>
                          <q-badge :color="licenseData?.expired ? 'red' : 'green'">
                            {{ licenseData?.expired ? t("about.expired_lbl") : t("about.active_lbl") }}
                          </q-badge>
                        </td>
                      </tr>
                      <tr>
                        <td class="tw:font-semibold">{{ t("about.create_at_lbl") }}</td>
                        <td>{{ formatLicenseDate(licenseData.license.created_at) }}</td>
                      </tr>
                      <tr>
                        <td class="tw:font-semibold">{{ t("about.expires_at_lbl") }}</td>
                        <td>
                          <div class="tw:flex tw:items-center tw:justify-start tw:gap-4">
                            <span>{{ formatLicenseDate(licenseData.license.expires_at) }}</span>
                          </div>
                        </td>
                      </tr>
                    </tbody>
                  </q-markup-table>
                </div>

                <div>
                  <q-markup-table flat bordered dense class="compact-table">
                    <thead>
                      <tr>
                        <th colspan="2" class="tw:text-center tw:font-semibold">{{ t("about.usage_limits") }}</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td class="tw:font-semibold">{{ t("about.ingestion_type") }}</td>
                        <td>{{ !licenseData?.expired && licenseData.license.limits?.Ingestion?.typ ? licenseData.license.limits.Ingestion.typ : 'PerDayCount' }}</td>
                      </tr>
                      <tr>
                        <td class="tw:font-semibold">{{ t("about.ingestion_limit") }}</td>
                        <td>{{ !licenseData?.expired && licenseData.license.limits?.Ingestion?.value ? `${licenseData.license.limits.Ingestion.value} GB / day` : '100 GB / day' }}</td>
                      </tr>
                      <tr v-if="licenseData.ingestion_used !== undefined">
                        <td class="tw:font-semibold">{{ t("about.today_usage") }}</td>
                        <td>
                          <span :class="licenseData.ingestion_used > 90 ? 'tw:text-red-500 tw:font-bold' : licenseData.ingestion_used > 70 ? 'tw:text-orange-500' : ''">
                            {{ licenseData.ingestion_used.toFixed(2) }}%
                          </span>
                        </td>
                      </tr>
                    </tbody>
                  </q-markup-table>
                </div>
              </div>
            </div>
          </div>
        </div>
        <!-- Feature Comparison Table -->
        <div class="tw:mt-6 tw:mb-[20px]" v-if="config.isCloud === 'false'">
          <FeatureComparisonTable />
        </div>
      </div>
    </div>
  </q-page>
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
import { useQuasar } from "quasar";

export default defineComponent({
  name: "PageAbout",
  components: {
    FeatureComparisonTable,
  },
  setup() {
    const store = useStore();
    const router = useRouter();
    const pageData = ref("Page Data");
    const { t } = useI18n();
    const $q = useQuasar();
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
      //  We don't need to make license data call for cloud
      if(config.isCloud == 'false' && config.isEnterprise == 'true'){
        loadLicenseData();
      }
    });

    const navigateToLicense = () => {
      // Get meta org identifier
      const metaOrgIdentifier = store.state.zoConfig.meta_org;

      // Find the meta org from the organizations list
      const metaOrg = store.state.organizations?.find(
        (org: any) => org.identifier === metaOrgIdentifier
      );

      if (metaOrg) {
        // Create the org option object so that it will be used to switch to meta org
        const metaOrgOption = {
          label: metaOrg.name,
          id: metaOrg.id,
          identifier: metaOrg.identifier,
          user_email: store.state.userInfo.email,
          ingest_threshold: metaOrg.ingest_threshold,
          search_threshold: metaOrg.search_threshold,
        };

        // Set the selected organization using dispatch
        store.dispatch("setSelectedOrganization", metaOrgOption);

        // Navigate to license page with the meta org identifier
        router.push({
          name: 'license',
          query: { org_identifier: metaOrgIdentifier }
        });
      } else {
        // Show error notification when user doesn't have access to meta org
          $q.notify({
            message: "You are not authorized to manage the license.",
            color: 'negative',
            timeout: 5000,
          })
        // router.push({
        //   name: 'license',
        //   query: { org_identifier: metaOrgIdentifier }
        // });
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
    };
  },
});
</script>

<style lang="scss" scoped>
.aboutPage {
  // Hero Section
  .hero-section {
    padding: 0.1rem;
    margin-bottom: 1rem;

    .logo {
      display: block;
    }

    .tagline {
      font-size: 1.25rem;
      font-weight: 500;
      opacity: 0.85;
      margin: 0;
      line-height: 1.6;
    }

    .version-badge,
    .build-badge {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.625rem 1.25rem;
      border-radius: 0.375rem;
      font-weight: 600;
      font-size: 0.9375rem;
      transition: all 0.3s ease;

      &:hover {
        transform: translateY(-2px);
      }
    }

    .version-badge-dark {
      background: rgba(76, 175, 80, 0.2);
      color: #81C784;
      border: 1px solid rgba(76, 175, 80, 0.3);
    }

    .version-badge-light {
      background: rgba(76, 175, 80, 0.12);
      color: #2E7D32;
      border: 1px solid rgba(76, 175, 80, 0.25);
    }

    .build-badge-dark {
      background: rgba(33, 150, 243, 0.2);
      color: #64B5F6;
      border: 1px solid rgba(33, 150, 243, 0.3);
    }

    .build-badge-light {
      background: rgba(33, 150, 243, 0.12);
      color: #1565C0;
      border: 1px solid rgba(33, 150, 243, 0.25);
    }

    .stats-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 1rem;

      .stat-card {
        padding: 1.75rem;
        text-align: center;
        transition: all 0.3s ease;
        position: relative;
        overflow: hidden;
        border-radius: 0.375rem;
        border: 1.5px solid;

        &:hover {
          transform: translateY(-4px);
        }

        .stat-icon {
          margin-bottom: 1rem;
        }

        .stat-label {
          font-size: 0.6875rem;
          text-transform: uppercase;
          letter-spacing: 1px;
          font-weight: 700;
          margin-bottom: 0.5rem;
          opacity: 0.9;
        }

        .stat-value {
          font-size: 1.125rem;
          font-weight: 600;
          letter-spacing: -0.01em;
        }
      }

      .stat-card-commit-dark {
        background: linear-gradient(135deg, rgba(156, 39, 176, 0.15) 0%, rgba(123, 31, 162, 0.1) 100%);
        border-color: rgba(156, 39, 176, 0.3);
        color: #CE93D8;

        .stat-icon {
          color: #BA68C8;
        }
      }

      .stat-card-commit-light {
        background: linear-gradient(135deg, rgba(156, 39, 176, 0.08) 0%, rgba(123, 31, 162, 0.05) 100%);
        border-color: rgba(156, 39, 176, 0.25);
        color: #6A1B9A;

        .stat-icon {
          color: #8E24AA;
        }
      }

      .stat-card-built-dark {
        background: linear-gradient(135deg, rgba(255, 152, 0, 0.15) 0%, rgba(251, 140, 0, 0.1) 100%);
        border-color: rgba(255, 152, 0, 0.3);
        color: #FFB74D;

        .stat-icon {
          color: #FFA726;
        }
      }

      .stat-card-built-light {
        background: linear-gradient(135deg, rgba(255, 152, 0, 0.08) 0%, rgba(251, 140, 0, 0.05) 100%);
        border-color: rgba(255, 152, 0, 0.25);
        color: #E65100;

        .stat-icon {
          color: #F57C00;
        }
      }
    }
  }

  // Feature Cards
  .feature-card1 {
    padding: 2rem;
    transition: all 0.3s ease;
    position: relative;
    border: 1px solid;
    border-radius: 0.375rem;

    &:hover {
      transform: translateY(-3px);
      box-shadow: 0 12px 28px rgba(0, 0, 0, 0.12);
    }
    border: 0.0625rem solid var(--o2-border-color);
  }


  .feature-card {
    .icon-wrapper {
      width: 56px;
      height: 56px;
      border-radius: 0.375rem;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.3s ease;
    }

    .icon-wrapper-dark {
      background: rgba(33, 150, 243, 0.18);
      color: #64B5F6;
    }

    .icon-wrapper-light {
      background: rgba(33, 150, 243, 0.12);
      color: #1565C0;
    }

    .feature-title {
      font-size: 1.375rem;
      font-weight: 600;
      margin: 0;
      letter-spacing: -0.02em;
    }

    .feature-text {
      font-size: 0.9375rem;
      line-height: 1.8;
      opacity: 0.8;
      margin-bottom: 0;
    }

    .link-badge {
      display: inline-flex;
      align-items: center;
      padding: 0.625rem 1.125rem;
      border-radius: 0.375rem;
      background: rgba(33, 150, 243, 0.08);
      color: var(--q-primary);
      text-decoration: none;
      font-size: 0.875rem;
      font-weight: 600;
      transition: all 0.25s ease;
      border: 1.5px solid rgba(33, 150, 243, 0.2);

      &:hover {
        background: rgba(33, 150, 243, 0.15);
        border-color: rgba(33, 150, 243, 0.35);
        transform: translateY(-2px);
        box-shadow: 0 4px 12px rgba(33, 150, 243, 0.15);
      }
    }

    .external-link {
      display: inline-flex;
      align-items: center;
      color: var(--q-primary);
      text-decoration: none;
      font-size: 0.875rem;
      opacity: 0.8;
      transition: all 0.2s ease;

      &:hover {
        opacity: 1;
        text-decoration: underline;
      }
    }

    .inline-link {
      color: var(--q-primary);
      text-decoration: none;
      font-weight: 600;
      border-bottom: 1px solid transparent;
      transition: all 0.2s ease;

      &:hover {
        border-bottom-color: var(--q-primary);
      }
    }
  }

  // Compact table styles
  .compact-table {
    td, th {
      padding: 8px 12px !important;
      line-height: 1.2;
    }
  }

  // Responsive
  @media (max-width: 768px) {
    .hero-section {
      padding: 1.5rem;

      .stats-grid {
        grid-template-columns: 1fr;
        width: 100%;
      }
    }

    .feature-card {
      padding: 1.5rem;
    }
  }
}
</style>
