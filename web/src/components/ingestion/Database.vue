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
  <DataSourceSidebarLayout
    v-model="ingestTabType"
    :tabs="databaseTabs"
    :splitter-width="270"
    searchable
    search-data-test="database-list-search-input"
  >
    <div class="w-full h-full">
      <div class="card-container h-full">
        <div class="overflow-auto h-full pt-0.5">
          <router-view
            :title="tabs"
            :currOrgIdentifier="currOrgIdentifier"
            :currUserEmail="currentUserEmail"
          >
          </router-view>
        </div>
      </div>
    </div>
  </DataSourceSidebarLayout>
</template>

<script lang="ts">
import DataSourceSidebarLayout from '@/components/ingestion/DataSourceSidebarLayout.vue'
// @ts-ignore
import { defineComponent, ref, onBeforeMount, onUpdated } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { copyToClipboard } from "@/utils/clipboard";
import config from "@/aws-exports";
import { getImageURL, verifyOrganizationStatus } from "@/utils/zincutils";
import { resolveTab } from "@/utils/routeTabMaps";

export default defineComponent({
  name: "DatabasePage",
  components: { DataSourceSidebarLayout },
  props: {
    currOrgIdentifier: {
      type: String,
      default: "",
    },
  },
  setup() {
    const { t } = useI18n();
    const store = useStore();
    const router: any = useRouter();
    const tabs = ref("");
    const currentOrgIdentifier: any = ref(
      store.state.selectedOrganization.identifier,
    );

    const ingestTabType = ref(resolveTab("databases", router.currentRoute.value.name as string, "sqlserver"));

    onBeforeMount(() => {
      if (router.currentRoute.value.name === "databases") {
        router.push({
          name: "sqlserver",
          query: {
            org_identifier: store.state.selectedOrganization.identifier,
          },
        });
        return;
      }
    });

    onUpdated(() => {
      if (router.currentRoute.value.name === "databases") {
        router.push({
          name: "sqlserver",
          query: {
            org_identifier: store.state.selectedOrganization.identifier,
          },
        });
        return;
      }
    });

    const databaseTabs = [
      {
        name: "sqlserver",
        to: {
          name: "sqlserver",
          query: {
            org_identifier: store.state.selectedOrganization.identifier,
          },
        },
        icon: "img:" + getImageURL("images/ingestion/sqlserver.png"),
        label: t('ingestion.sqlserver'),
        contentClass: "tab_content",
      },
      {
        name: "postgres",
        to: {
          name: "postgres",
          query: {
            org_identifier: store.state.selectedOrganization.identifier,
          },
        },
        icon: "img:" + getImageURL("images/ingestion/postgres.png"),
        label: t("ingestion.postgres"),
        contentClass: "tab_content",
      },
      {
        name: "mongodb",
        to: {
          name: "mongodb",
          query: {
            org_identifier: store.state.selectedOrganization.identifier,
          },
        },
        icon: "img:" + getImageURL("images/ingestion/mongodb.svg"),
        label: t("ingestion.mongodb"),
        contentClass: "tab_content",
      },
      {
        name: "redis",
        to: {
          name: "redis",
          query: {
            org_identifier: store.state.selectedOrganization.identifier,
          },
        },
        icon: "img:" + getImageURL("images/ingestion/redis.svg"),
        label: t("ingestion.redis"),
        contentClass: "tab_content",
      },
      // {
      //   name: "couchdb",
      //   to: {
      //     name: "couchdb",
      //     query: {
      //       org_identifier: store.state.selectedOrganization.identifier,
      //     },
      //   },
      //   icon: "img:" + getImageURL("images/ingestion/couchdb.svg"),
      //   label: t("ingestion.couchdb"),
      //   contentClass: "tab_content",
      // },
      // {
      //   name: "elasticsearch",
      //   to: {
      //     name: "elasticsearch",
      //     query: {
      //       org_identifier: store.state.selectedOrganization.identifier,
      //     },
      //   },
      //   icon: "img:" + getImageURL("images/ingestion/elasticsearch.svg"),
      //   label: t("ingestion.elasticsearch"),
      //   contentClass: "tab_content",
      // },
      {
        name: "mysql",
        to: {
          name: "mysql",
          query: {
            org_identifier: store.state.selectedOrganization.identifier,
          },
        },
        icon: "img:" + getImageURL("images/ingestion/mysql.svg"),
        label: t("ingestion.mysql"),
        contentClass: "tab_content",
      },
      {
        name: "oracle",
        to: {
          name: "oracle",
          query: {
            org_identifier: store.state.selectedOrganization.identifier,
          },
        },
        icon: "img:" + getImageURL("images/ingestion/oracle.svg"),
        label: t("ingestion.oracle"),
        contentClass: "tab_content",
      },
      // {
      //   name: "saphana",
      //   to: {
      //     name: "saphana",
      //     query: {
      //       org_identifier: store.state.selectedOrganization.identifier,
      //     },
      //   },
      //   icon: "img:" + getImageURL("images/ingestion/saphana.png"),
      //   label: "SAP HANA",
      //   contentClass: "tab_content",
      // },
      {
        name: "snowflake",
        to: {
          name: "snowflake",
          query: {
            org_identifier: store.state.selectedOrganization.identifier,
          },
        },
        icon: "img:" + getImageURL("images/ingestion/snowflake.svg"),
        label: t("ingestion.snowflake"),
        contentClass: "tab_content",
      },
      {
        name: "zookeeper",
        to: {
          name: "zookeeper",
          query: {
            org_identifier: store.state.selectedOrganization.identifier,
          },
        },
        icon: "img:" + getImageURL("images/ingestion/zookeeper.png"),
        label: t("ingestion.zookeeper"),
        contentClass: "tab_content",
      },
      {
        name: "cassandra",
        to: {
          name: "cassandra",
          query: {
            org_identifier: store.state.selectedOrganization.identifier,
          },
        },
        icon: "img:" + getImageURL("images/ingestion/cassandra.png"),
        label: t("ingestion.cassandra"),
        contentClass: "tab_content",
      },
      {
        name: "aerospike",
        to: {
          name: "aerospike",
          query: {
            org_identifier: store.state.selectedOrganization.identifier,
          },
        },
        icon: "img:" + getImageURL("images/ingestion/aerospike.svg"),
        label: t("ingestion.aerospike"),
        contentClass: "tab_content",
      },
      {
        name: "dynamodb",
        to: {
          name: "dynamodb",
          query: {
            org_identifier: store.state.selectedOrganization.identifier,
          },
        },
        icon: "img:" + getImageURL("images/ingestion/dynamodb.png"),
        label: t("ingestion.dynamodb"),
        contentClass: "tab_content",
      },
      {
        name: "databricks",
        to: {
          name: "databricks",
          query: {
            org_identifier: store.state.selectedOrganization.identifier,
          },
        },
        icon: "img:" + getImageURL("images/ingestion/databricks.svg"),
        label: t("ingestion.databricks"),
        contentClass: "tab_content",
      }
    ];

    return {
      t,
      store,
      router,
      config,
      currentUserEmail: store.state.userInfo.email,
      currentOrgIdentifier,
      getImageURL,
      verifyOrganizationStatus,
      tabs,
      ingestTabType,
      databaseTabs,
    };
  },
});
</script>

