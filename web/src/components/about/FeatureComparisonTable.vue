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
  <div class="feature-comparison-wrapper">
    <div class="feature-comparison-header tw-mb-6">
      <div class="tw-flex tw-items-center tw-gap-3 tw-mb-3">
        <div class="icon-wrapper" :class="store.state.theme === 'dark' ? 'icon-wrapper-dark' : 'icon-wrapper-light'">
          <q-icon name="compare_arrows" size="24px" />
        </div>
        <h3 class="feature-title">{{ t('about.featureComparison.title') }}</h3>
      </div>
      <div class="feature-subtitle-wrapper">
        <p
          v-if="store.state.zoConfig.build_type === 'opensource'"
          class="edition-info"
        >
          {{ t('about.featureComparison.osDescription') }}
        </p>
        <p
          v-else-if="store.state.zoConfig.build_type === 'enterprise'"
          class="edition-info"
        >
          {{ t('about.featureComparison.enterpriseDescription') }}
        </p>
        <p
          v-else
          class="feature-subtitle"
        >
          {{ t('about.featureComparison.generalDescription') }}
        </p>
        <p
          v-if="store.state.zoConfig.build_type === 'opensource'"
          class="enterprise-promotion"
        >
          <strong>{{ t('about.featureComparison.osPromotion').split(':')[0] }}:</strong> {{ t('about.featureComparison.osPromotion').split(': ')[1] }}
        </p>
        <p
          v-else-if="store.state.zoConfig.build_type === 'enterprise'"
          class="enterprise-promotion"
        >
          <strong>{{ t('about.featureComparison.enterprisePromotion').split(':')[0] }}:</strong> {{ t('about.featureComparison.enterprisePromotion').split(': ')[1] }}
        </p>
      </div>
    </div>

    <div class="table-wrapper">
      <q-table
        :rows="featureData.features"
        :columns="columns"
        row-key="name"
        :pagination="pagination"
        hide-pagination
        flat
        bordered
        dense
        class="feature-comparison-table o2-quasar-table"
      >
        <template v-slot:body="props">
          <q-tr :props="props">
            <q-td key="name" :props="props" class="feature-name-cell">
              {{ props.row.name }}
            </q-td>
            <q-td
              key="opensource"
              :props="props"
              class="feature-value-cell"
              :class="{
                'highlighted-column':
                  store.state.zoConfig.build_type === 'opensource',
              }"
            >
              <span v-if="props.row.values.opensource === true" class="status-icon status-available">
                ✅
              </span>
              <span v-else-if="props.row.values.opensource === false" class="status-icon status-unavailable">
                ❌
              </span>
              <span v-else class="status-text">
                {{ props.row.values.opensource }}
              </span>
            </q-td>
            <q-td
              key="enterprise"
              :props="props"
              class="feature-value-cell"
              :class="{
                'highlighted-column':
                  store.state.zoConfig.build_type === 'enterprise',
              }"
            >
              <span v-if="props.row.values.enterprise === true" class="status-icon status-available">
                ✅
              </span>
              <span v-else-if="props.row.values.enterprise === false" class="status-icon status-unavailable">
                ❌
              </span>
              <span v-else class="status-text">
                {{ props.row.values.enterprise }}
              </span>
            </q-td>
            <q-td key="cloud" :props="props" class="feature-value-cell">
              <span v-if="props.row.values.cloud === true" class="status-icon status-available">
                ✅
              </span>
              <span v-else-if="props.row.values.cloud === false" class="status-icon status-unavailable">
                ❌
              </span>
              <span v-else class="status-text">
                {{ props.row.values.cloud }}
              </span>
            </q-td>
          </q-tr>
        </template>
      </q-table>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import type { QTableColumn } from "quasar";

interface FeatureValue {
  opensource: boolean | string;
  enterprise: boolean | string;
  cloud: boolean | string;
}

interface Feature {
  name: string;
  values: FeatureValue;
}

interface Edition {
  id: 'opensource' | 'enterprise' | 'cloud';
  name: string;
}

interface FeatureData {
  editions: Edition[];
  features: Feature[];
}

export default defineComponent({
  name: "FeatureComparisonTable",
  setup() {
    const store = useStore();
    const { t } = useI18n();

    const columns = computed((): QTableColumn[] => [
      {
        name: 'name',
        label: t('about.featureComparison.columns.feature'),
        field: 'name',
        align: 'left',
        sortable: false,
        style: 'width: 250px; min-width: 200px;'
      },
      {
        name: 'opensource',
        label: t('about.featureComparison.columns.opensource'),
        field: 'opensource',
        align: 'center',
        sortable: false,
        style: 'width: 150px; max-width: 150px;'
      },
      {
        name: 'enterprise',
        label: t('about.featureComparison.columns.enterprise'),
        field: 'enterprise',
        align: 'center',
        sortable: false,
        style: 'width: 150px; max-width: 150px;'
      },
      {
        name: 'cloud',
        label: t('about.featureComparison.columns.cloud'),
        field: 'cloud',
        align: 'center',
        sortable: false,
        style: 'width: 150px; max-width: 150px;'
      }
    ]);

    const pagination = ref({
      rowsPerPage: 0 // 0 means show all rows
    });

    const featureData = computed((): FeatureData => ({
      editions: [
        { id: 'opensource', name: t('about.featureComparison.editions.opensource') },
        { id: 'enterprise', name: t('about.featureComparison.editions.enterprise') },
        { id: 'cloud', name: t('about.featureComparison.editions.cloud') }
      ],
      features: [
        { name: t('about.featureComparison.features.logs'), values: { opensource: true, enterprise: true, cloud: true } },
        { name: t('about.featureComparison.features.metrics'), values: { opensource: true, enterprise: true, cloud: true } },
        { name: t('about.featureComparison.features.traces'), values: { opensource: true, enterprise: true, cloud: true } },
        { name: t('about.featureComparison.features.rum'), values: { opensource: true, enterprise: true, cloud: true } },
        { name: t('about.featureComparison.features.alerts'), values: { opensource: true, enterprise: true, cloud: true } },
        { name: t('about.featureComparison.features.dashboards'), values: { opensource: true, enterprise: true, cloud: true } },
        { name: t('about.featureComparison.features.reports'), values: { opensource: true, enterprise: true, cloud: true } },
        { name: t('about.featureComparison.features.vrlFunctions'), values: { opensource: true, enterprise: true, cloud: true } },
        { name: t('about.featureComparison.features.pipelines'), values: { opensource: true, enterprise: true, cloud: true } },
        { name: t('about.featureComparison.features.highAvailability'), values: { opensource: true, enterprise: true, cloud: true } },
        { name: t('about.featureComparison.features.multitenancy'), values: { opensource: true, enterprise: true, cloud: true } },
        { name: t('about.featureComparison.features.dynamicSchema'), values: { opensource: true, enterprise: true, cloud: true } },
        { name: t('about.featureComparison.features.multilanguageGui'), values: { opensource: true, enterprise: true, cloud: true } },
        { name: t('about.featureComparison.features.singleSignOn'), values: { opensource: false, enterprise: t('about.featureComparison.values.availableHaMode'), cloud: true } },
        { name: t('about.featureComparison.features.rbac'), values: { opensource: false, enterprise: t('about.featureComparison.values.availableHaMode'), cloud: true } },
        { name: t('about.featureComparison.features.federatedSearch'), values: { opensource: false, enterprise: true, cloud: false } },
        { name: t('about.featureComparison.features.queryManagement'), values: { opensource: false, enterprise: true, cloud: false } },
        { name: t('about.featureComparison.features.workloadManagement'), values: { opensource: false, enterprise: true, cloud: false } },
        { name: t('about.featureComparison.features.auditTrail'), values: { opensource: false, enterprise: true, cloud: true } },
        { name: t('about.featureComparison.features.actionScripts'), values: { opensource: false, enterprise: true, cloud: false } },
        { name: t('about.featureComparison.features.dataRedaction'), values: { opensource: false, enterprise: true, cloud: true } },
        { name: t('about.featureComparison.features.roadmapInfluence'), values: { opensource: false, enterprise: true, cloud: t('about.featureComparison.values.enterprisePlan') } },
        { name: t('about.featureComparison.features.license'), values: { opensource: t('about.featureComparison.values.agplLicense'), enterprise: t('about.featureComparison.values.enterpriseLicense'), cloud: t('about.featureComparison.values.cloudLicense') } },
        { name: t('about.featureComparison.features.support'), values: { opensource: t('about.featureComparison.values.communitySupport'), enterprise: t('about.featureComparison.values.enterpriseSupport'), cloud: t('about.featureComparison.values.cloudSupport') } },
        { name: t('about.featureComparison.features.cost'), values: { opensource: t('about.featureComparison.values.freeCost'), enterprise: t('about.featureComparison.values.enterpriseCost'), cloud: t('about.featureComparison.values.cloudCost') } },
        { name: t('about.featureComparison.features.externalDestinations'), values: { opensource: false, enterprise: true, cloud: true } },
        { name: t('about.featureComparison.features.extremePerformance'), values: { opensource: false, enterprise: true, cloud: true } },
        { name: t('about.featureComparison.features.queryOptimizer'), values: { opensource: false, enterprise: true, cloud: true } }
      ]
    }));

    const currentPlanName = computed(() => {
      const buildType = store.state.zoConfig.build_type;
      const edition = featureData.value.editions.find((ed) => ed.id === buildType);
      return edition ? edition.name : "";
    });

    return {
      t,
      store,
      featureData,
      columns,
      pagination,
      currentPlanName,
    };
  }
});
</script>

<style lang="scss" scoped>
.feature-comparison-wrapper {
  padding: 0.1rem;

  .feature-comparison-header {
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

    .feature-subtitle-wrapper {
      .feature-subtitle {
        font-size: 0.9375rem;
        line-height: 1.8;
        opacity: 0.8;
        margin-bottom: 0;

        strong {
          font-weight: 600;
          opacity: 1;
        }
      }

      .edition-info {
        font-size: 0.9375rem;
        line-height: 1.8;
        opacity: 0.9;
        margin-bottom: 0;
      }

      .enterprise-promotion {
        font-size: 0.9375rem;
        line-height: 1.8;
        margin-top: 0.5rem;
        margin-bottom: 0;
        padding: 0.75rem 1rem;
        background: linear-gradient(
          135deg,
          rgba(76, 175, 80, 0.1),
          rgba(33, 150, 243, 0.1)
        );
        border-left: 3px solid #4caf50;
        border-radius: 0.375rem;

        strong {
          font-weight: 600;
          color: #4caf50;
        }
      }
    }
  }

  .table-wrapper {
    overflow-x: auto;
    border-radius: 0.5rem;
  }

  .feature-comparison-table {
    width: auto;
    margin: auto;
    max-width: 800px;
    
    .feature-name-cell {
      font-weight: 500;
      color: var(--q-text-color);
      padding: 0.875rem 1rem;
    }

    .feature-value-cell {
      text-align: center;
      padding: 0.875rem 1rem;
      word-wrap: break-word;
      white-space: normal;

      .status-icon {
        font-size: 0.9rem;
        display: inline-block;

        &.status-available {
          color: #4caf50;
        }

        &.status-unavailable {
          color: #f44336;
        }
      }

      .status-text {
        font-size: 0.875rem;
        color: var(--q-text-color);
        display: block;
        padding: 0 0.5rem;
        word-wrap: break-word;
        white-space: normal;
      }

      &.highlighted-column {
        background-color: color-mix(in srgb, var(--o2-theme-color) 15%, var(--o2-theme-mode) 85%);
        font-weight: 500;
        position: relative;

        &::before {
          content: "";
          position: absolute;
          left: 0;
          top: 0;
          bottom: 0;
          width: 3px;
        }
      }
    }
  }

  // Dark theme adjustments
  :deep(.body--dark) {
    .feature-comparison-table tbody tr:nth-child(even) {
      background: rgba(255, 255, 255, 0.03);

      &:hover {
        background: rgba(33, 150, 243, 0.08);
      }
    }
  }

  // Responsive design
  @media (max-width: 768px) {
    padding: 1rem;

    .feature-comparison-table {
      font-size: 0.8125rem;

      :deep(thead tr th) {
        padding: 0.75rem 0.5rem;
        font-size: 0.875rem;
      }

      .feature-name-cell,
      .feature-value-cell {
        padding: 0.625rem 0.5rem;
      }

      .feature-value-cell .status-text {
        font-size: 0.8125rem;
      }
    }
  }
}
</style>
