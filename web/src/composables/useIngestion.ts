// Copyright 2026 OpenObserve Inc.
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

export type WebServer = "nginx" | "apache" | "iis";

export interface WebServerGuide {
  /** Display name, also the guide name on the status bar. */
  label: string;
  /** Comma-separated tail paths. */
  logPaths: string;
  configPath: string;
  restartCommand: string;
  /** Install command; undefined where Fluent Bit ships as an installer (Windows). */
  installCommand?: string;
  installDocUrl?: string;
}

export interface IngestionEndpoint {
  host: string;
  port: string;
  tls: string;
}

const LINUX_FLUENT_BIT_INSTALL =
  "curl https://raw.githubusercontent.com/fluent/fluent-bit/master/install.sh | sh";

export const WEB_SERVER_GUIDES: Record<WebServer, WebServerGuide> = {
  nginx: {
    label: "nginx",
    logPaths: "/var/log/nginx/access.log,/var/log/nginx/error.log",
    configPath: "/etc/fluent-bit/fluent-bit.conf",
    restartCommand: "sudo systemctl restart fluent-bit",
    installCommand: LINUX_FLUENT_BIT_INSTALL,
  },
  apache: {
    label: "Apache",
    logPaths: "/var/log/apache2/*.log,/var/log/httpd/*_log",
    configPath: "/etc/fluent-bit/fluent-bit.conf",
    restartCommand: "sudo systemctl restart fluent-bit",
    installCommand: LINUX_FLUENT_BIT_INSTALL,
  },
  iis: {
    label: "IIS",
    logPaths: "C:\\inetpub\\logs\\LogFiles\\W3SVC*\\*.log",
    configPath: "C:\\Program Files\\fluent-bit\\conf\\fluent-bit.conf",
    restartCommand: "Restart-Service fluent-bit",
    installDocUrl: "https://docs.fluentbit.io/manual/installation/windows",
  },
};

/** Fluent Bit config that tails the server's logs into the stream named after it; [EMAIL] and [PASSCODE] are filled by CredentialCodeBlock. */
export function webServerFluentBitContent(
  server: WebServer,
  org: string,
  endpoint: IngestionEndpoint,
  timestampColumn = "_timestamp",
): string {
  return `[INPUT]
    Name              tail
    Path              ${WEB_SERVER_GUIDES[server].logPaths}
    Tag               ${server}

[OUTPUT]
    Name              http
    Match             ${server}
    Host              ${endpoint.host}
    Port              ${endpoint.port}
    tls               ${endpoint.tls}
    URI               /api/${org}/${server}/_json
    Format            json
    Json_date_key     ${timestampColumn}
    Json_date_format  iso8601
    HTTP_User         [EMAIL]
    HTTP_Passwd       [PASSCODE]`;
}

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

  const aiContent = `OPENOBSERVE_URL=${endpoint.value.url}
OPENOBSERVE_ORG=${store.state.selectedOrganization.identifier}
OPENOBSERVE_AUTH_TOKEN=Basic [BASIC_PASSCODE]`;

  const webServerContent = (server: WebServer) =>
    webServerFluentBitContent(
      server,
      store.state.selectedOrganization.identifier,
      endpoint.value,
      store.state.zoConfig?.timestamp_column || "_timestamp",
    );

  return {
    endpoint,
    webServerContent,
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
    aiContent,
  };
};

export default useIngestion;
