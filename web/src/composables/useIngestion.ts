// Copyright 2023 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { useStore } from "vuex";
import { ref } from "vue";
import { getEndPoint, getIngestionURL } from "@/utils/zincutils";

const useIngestion = () => {
  const store = useStore();
  
  const endpoint: any = ref({
    url: "",
    host: "",
    port: "",
    protocol: "",
    tls: "",
  });
  const ingestionURL = getIngestionURL();
  endpoint.value = getEndPoint(ingestionURL);

  const databaseContent = `exporters:
  otlphttp/openobserve:
    endpoint: ${endpoint.value.url}/api/${store.state.selectedOrganization.identifier}/
    headers:
      Authorization: Basic [BASIC_PASSCODE]
      stream-name: default`;

  const databaseDocURLs = {
    sqlServer: "https://short.openobserve.ai/database/sql-server",
    postgres: "https://short.openobserve.ai/database/postgres",
    mongoDB: "https://short.openobserve.ai/database/mongodb",
    redis: "https://short.openobserve.ai/database/redis",
    couchDB: "https://short.openobserve.ai/database/couchdb",
    elasticsearch: "https://short.openobserve.ai/database/elasticsearch",
    mySQL: "https://short.openobserve.ai/database/mysql",
    sapHana: "https://short.openobserve.ai/database/sap-hana",
    snowflake: "https://short.openobserve.ai/database/snowflake",
    zookeeper: "https://short.openobserve.ai/database/zookeeper",
    cassandra: "https://short.openobserve.ai/database/cassandra",
    aerospike: "https://short.openobserve.ai/database/aerospike",
    dynamoDB: "https://short.openobserve.ai/database/dynamodb",
    databricks: "https://short.openobserve.ai/databricks",
    oracle: "https://openobserve.ai/docs/integration/database/oracle/",
  };

  const securityContent = `HTTP Endpoint: ${endpoint.value.url}/api/${store.state.selectedOrganization.identifier}/[STREAM_NAME]/_json
Access Key: [BASIC_PASSCODE]`;

  const securityDocURLs = {
    falco: "https://short.openobserve.ai/security/falco",
    osquery: "https://short.openobserve.ai/security/osquery",
    okta: "https://short.openobserve.ai/security/okta",
    jumpcloud: "https://short.openobserve.ai/security/jumpcloud",
    openvpn: "https://short.openobserve.ai/security/openvpn",
    office365: "https://short.openobserve.ai/security/office365",
    googleworkspace: "https://short.openobserve.ai/security/google-workspace",
  };

  const devopsContent = `HTTP Endpoint: ${endpoint.value.url}/api/${store.state.selectedOrganization.identifier}/[STREAM_NAME]/_json
Access Key: [BASIC_PASSCODE]`;

  const devopsDocURLs = {
    jenkins: "https://short.openobserve.ai/devops/jenkins",
    ansible: "https://short.openobserve.ai/devops/ansible",
    terraform: "https://short.openobserve.ai/devops/terraform",
    githubactions: "https://short.openobserve.ai/devops/github-actions",
  };

  const networkingContent = `HTTP Endpoint: ${endpoint.value.url}/api/${store.state.selectedOrganization.identifier}/[STREAM_NAME]/_json
Access Key: [BASIC_PASSCODE]`;

  const networkingDocURLs = {
    netflow: "https://short.openobserve.ai/network/netflow",
  };

  const serverContent = `HTTP Endpoint: ${endpoint.value.url}/api/${store.state.selectedOrganization.identifier}/[STREAM_NAME]/_json
Access Key: [BASIC_PASSCODE]`;

  const serverDocURLs = {
    nginx: "https://short.openobserve.ai/server/nginx",
    apache: "https://short.openobserve.ai/server/apache",
    iis: "https://short.openobserve.ai/server/iis",
  };

  const messageQueuesContent = `HTTP Endpoint: ${endpoint.value.url}/api/${store.state.selectedOrganization.identifier}/[STREAM_NAME]/_json
Access Key: [BASIC_PASSCODE]`;

  const messageQueuesDocURLs = {
    rabbitmq: "https://short.openobserve.ai/rabbitmq",
    kafka: "https://short.openobserve.ai/kafka",
    nats: "https://short.openobserve.ai/nats",
  };

  const languagesContent = `HTTP Endpoint: ${endpoint.value.url}/api/${store.state.selectedOrganization.identifier}/[STREAM_NAME]/_json
Access Key: [BASIC_PASSCODE]`;

  const languagesDocURLs = {
    python: "https://openobserve.ai/blog/handling-errors-with-opentelemetry-python",
    dotnettracing: "https://short.openobserve.ai/dotnet-tracing",
    dotnetlogs: "https://short.openobserve.ai/dotnet-logging",
    nodejs: "https://short.openobserve.ai/languages/nodejs",
    go: "https://short.openobserve.ai/golang",
    rust: "https://short.openobserve.ai/rust",
    java: "https://short.openobserve.ai/java",
    fastapi: "https://short.openobserve.ai/framework/fastapi",
  };

  const othersContent = `HTTP Endpoint: ${endpoint.value.url}/api/${store.state.selectedOrganization.identifier}/[STREAM_NAME]/_json
Access Key: [BASIC_PASSCODE]`;

  const othersDocURLs = {
    airflow: "https://short.openobserve.ai/others/airflow",
    airbyte: "https://short.openobserve.ai/others/airbyte",
    cribl: "https://short.openobserve.ai/cribl",
    vercel: "https://short.openobserve.ai/vercel",
    heroku: "https://short.openobserve.ai/heroku",
  };

  return {
    endpoint,
    databaseContent,
    databaseDocURLs,
    securityContent,
    securityDocURLs,
    devopsContent,
    devopsDocURLs,
    networkingContent,
    networkingDocURLs,
    serverContent,
    serverDocURLs,
    messageQueuesContent,
    messageQueuesDocURLs,
    languagesContent,
    languagesDocURLs,
    othersContent,
    othersDocURLs,
  };
};

export default useIngestion;
