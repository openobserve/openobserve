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
        <h3 class="feature-title">Feature Comparison</h3>
      </div>
      <div class="feature-subtitle-wrapper">
        <p class="feature-subtitle">
          <span v-if="currentPlanName">
            You are currently on the
            <strong>{{ currentPlanName }}</strong> plan.
          </span>
          <span v-else>
            Compare features across Open Source, Enterprise, and Cloud offerings
          </span>
        </p>
        <p
          v-if="store.state.zoConfig.build_type === 'opensource'"
          class="enterprise-promotion"
        >
          Try our <strong>Enterprise plan</strong> - free for up to 200GB/day
          ingestion and search with advanced features like SSO, RBAC, and more!
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

    const columns: QTableColumn[] = [
      {
        name: 'name',
        label: 'Feature',
        field: 'name',
        align: 'left',
        sortable: false,
        style: 'width: 35%; min-width: 200px;'
      },
      {
        name: 'opensource',
        label: 'Open Source (Self hosted)',
        field: 'opensource',
        align: 'center',
        sortable: false,
        style: 'width: 21.66%; min-width: 150px;'
      },
      {
        name: 'enterprise',
        label: 'Enterprise (Self hosted)',
        field: 'enterprise',
        align: 'center',
        sortable: false,
        style: 'width: 21.66%; min-width: 150px;'
      },
      {
        name: 'cloud',
        label: 'Cloud',
        field: 'cloud',
        align: 'center',
        sortable: false,
        style: 'width: 21.66%; min-width: 150px;'
      }
    ];

    const pagination = ref({
      rowsPerPage: 0 // 0 means show all rows
    });

    const featureData: FeatureData = {
      editions: [
        { id: 'opensource', name: 'Open Source (Self hosted)' },
        { id: 'enterprise', name: 'Enterprise (Self hosted)' },
        { id: 'cloud', name: 'Cloud' }
      ],
      features: [
        { name: 'Logs', values: { opensource: true, enterprise: true, cloud: true } },
        { name: 'Metrics', values: { opensource: true, enterprise: true, cloud: true } },
        { name: 'Traces', values: { opensource: true, enterprise: true, cloud: true } },
        { name: 'RUM', values: { opensource: true, enterprise: true, cloud: true } },
        { name: 'Alerts', values: { opensource: true, enterprise: true, cloud: true } },
        { name: 'Dashboards', values: { opensource: true, enterprise: true, cloud: true } },
        { name: 'Reports', values: { opensource: true, enterprise: true, cloud: true } },
        { name: 'VRL functions', values: { opensource: true, enterprise: true, cloud: true } },
        { name: 'Pipelines', values: { opensource: true, enterprise: true, cloud: true } },
        { name: 'High Availability', values: { opensource: true, enterprise: true, cloud: true } },
        { name: 'Multitenancy (Organizations)', values: { opensource: true, enterprise: true, cloud: true } },
        { name: 'Dynamic schema and schema evolution', values: { opensource: true, enterprise: true, cloud: true } },
        { name: 'Advanced multilingual GUI', values: { opensource: true, enterprise: true, cloud: true } },
        { name: 'Single Sign On', values: { opensource: false, enterprise: true, cloud: true } },
        { name: 'Role Based Access Control (RBAC)', values: { opensource: false, enterprise: true, cloud: true } },
        { name: 'Federated search / Super cluster', values: { opensource: false, enterprise: true, cloud: false } },
        { name: 'Query management', values: { opensource: false, enterprise: true, cloud: false } },
        { name: 'Workload management (QoS)', values: { opensource: false, enterprise: true, cloud: false } },
        { name: 'Audit trail', values: { opensource: false, enterprise: true, cloud: true } },
        { name: 'Action Scripts', values: { opensource: false, enterprise: true, cloud: true } },
        { name: 'Cipher keys (HIPAA, PCI compliance)', values: { opensource: false, enterprise: true, cloud: true } },
        { name: 'Sensitive data redaction', values: { opensource: false, enterprise: true, cloud: true } },
        { name: 'Ability to influence roadmap', values: { opensource: false, enterprise: true, cloud: '✅ on enterprise plan' } },
        { name: 'License', values: { opensource: 'AGPL', enterprise: 'Enterprise', cloud: 'Cloud' } },
        { name: 'Support', values: { opensource: 'Community', enterprise: 'Enterprise', cloud: 'Cloud' } },
        { name: 'Cost', values: { opensource: 'Free', enterprise: 'If self hosted, free for up to 200 GB/Day data ingested. Paid thereafter', cloud: '14 day free trial. Paid thereafter' } },
        { name: 'Pipelines - External destinations', values: { opensource: false, enterprise: true, cloud: true } },
        { name: 'Extreme performance (100x improvement for many queries)', values: { opensource: false, enterprise: true, cloud: true } },
        { name: 'Query optimizer', values: { opensource: false, enterprise: true, cloud: true } }
      ]
    };

    const currentPlanName = computed(() => {
      const buildType = store.state.zoConfig.build_type;
      const edition = featureData.editions.find((ed) => ed.id === buildType);
      return edition ? edition.name : "";
    });

    return {
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
    width: 100%;
    
    .feature-name-cell {
      font-weight: 500;
      color: var(--q-text-color);
      padding: 0.875rem 1rem;
    }

    .feature-value-cell {
      text-align: center;
      padding: 0.875rem 1rem;

      .status-icon {
        font-size: 1.125rem;
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
