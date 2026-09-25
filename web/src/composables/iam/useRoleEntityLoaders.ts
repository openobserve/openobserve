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

import { queryClient } from "@/composables/query/queryClient";
import type { Resource, Entity } from "@/ts/interfaces";
import { destinationsQuery } from "@/services/alert_destination.queries";
import { templatesQuery } from "@/services/alert_templates.queries";
import pipelineService from "@/services/pipelines";
import alertService from "@/services/alerts";
import reportService from "@/services/reports";
import jsTransformService from "@/services/jstransform";
import organizationsService from "@/services/organizations";
import savedviewsService from "@/services/saved_views";
import dashboardService from "@/services/dashboards";
import serviceAccountService from "@/services/service_accounts";
import { getGroups, getRoles } from "@/services/iam";
import cipherKeysService from "@/services/cipher_keys";
import RePatternsService from "@/services/regex_pattern";
import commonService from "@/services/common";
import syntheticsService from "@/services/synthetics";
import type { SyntheticsEnvironment } from "@/types/synthetics";
import workflowService from "@/services/workflows";
import onlineEvalsService from "@/services/online-evals.service";
import llmQueuesService from "@/services/llm-queues.service";
import llmDatasetsService from "@/services/llm-datasets.service";

type RowBuilders = {
  updateResourceEntities: (
    resourceName: string,
    keys: string[],
    entities: any[],
    hasEntities?: boolean,
    displayNameKey?: string,
    childName?: string,
  ) => void;
  updateEntityEntities: (
    entity: any,
    keys: string[],
    entities: any[],
    hasEntities?: boolean,
    displayNameKey?: string,
  ) => void;
  updateResourceResource: (
    resourceName: string,
    parentResourceName: string,
    entityNameKeys: string[],
    data: any[],
    hasEntities?: boolean,
    displayNameKey?: string,
  ) => void;
};

type LoaderDeps = RowBuilders & {
  store: any;
  getStreams: (type: string, schema: boolean) => Promise<any>;
  t: (key: string) => string;
};

/** Every list request behind a role's resource rows, plus the dispatch that picks one. */
export const useRoleEntityLoaders = (deps: LoaderDeps) => {
  const {
    store,
    getStreams,
    t,
    updateResourceEntities,
    updateEntityEntities,
    updateResourceResource,
  } = deps;

  // Keyed by the row itself: two rows can share a name (every folder list has a `default`).
  const entityLoads = new WeakMap<object, Promise<unknown>>();

  const getResourceEntities = (resource: Resource | Entity) => {
    if (!resource) return Promise.resolve(true);

    const listEntitiesFnMap: {
      [key: string]: (resource: Resource | Entity) => Promise<any>;
    } = {
      stream: getStreamsTypes,
      stream_type: getStreamsTypes,
      logs: getLogs,
      metrics: getMetrics,
      traces: getTraces,
      index: getIndexStreams,
      alert: getAlerts,
      template: getTemplates,
      destination: getDestinations,
      pipeline: getPipelines,
      enrichment_table: getEnrichmentTables,
      function: getFunctions,
      org: getOrgs,
      savedviews: getSavedViews,
      group: _getGroups,
      role: _getRoles,
      dfolder: getFolders,
      dashboard: getDashboards,
      metadata: getMetadataStreams,
      report: getReports,
      service_accounts: getServiceAccounts,
      cipher_keys: getCipherKeys,
      afolder: getAlertFolders,
      rfolder: getReportFolders,
      synthetic_folder: getSyntheticsFolders,
      synthetics: getSynthetics,
      synthetic_environment: getSyntheticEnvironments,
      workflow_folder: getWorkflowFolders,
      workflows: getWorkflows,
      re_patterns: getRePatterns,
      provider: getProviders,
      score_config: getScoreConfigs,
      scorer: getScorers,
      eval_job: getEvalJobs,
      annotation_queue: getAnnotationQueues,
      dataset: getDatasets,
      logs_pattern: getLogsPatternStreams,
      logs_insights: getLogsInsightsStreams,
      logs_cache: getLogsCacheStreams,
    };

    // The loaders push, so two overlapping opens of one row would list every entity twice.
    const pending = entityLoads.get(resource);
    if (pending) return pending;

    const load = new Promise((resolve, reject) => {
      (async () => {
        try {
          if (!resource.entities?.length) {
            resource.is_loading = true;
            try {
              const listEntities = resource.childName
                ? listEntitiesFnMap[resource.childName]
                : listEntitiesFnMap[resource.resourceName];

              if (listEntities) {
                await listEntities(resource);
              }
            } finally {
              resource.is_loading = false;
            }
          }

          resolve(true);
        } catch (err) {
          reject(err);
        }
      })();
    });

    entityLoads.set(resource, load);
    return load.finally(() => entityLoads.delete(resource));
  };

  const getEnrichmentTables = async () => {
    const data: any = await getStreams("enrichment_tables", false);

    updateResourceEntities("enrichment_table", ["name"], data.list);

    return new Promise((resolve) => {
      resolve(true);
    });
  };

  const getDashboards = async (resource: Entity | Resource) => {
    let dashboards: any = await dashboardService.list(
      0,
      10000,
      "name",
      false,
      "",
      store.state.selectedOrganization.identifier,
      resource.name,
      "",
    );

    updateEntityEntities(
      resource,
      ["dashboardId"],
      [
        ...dashboards.data.dashboards.map(
          (dash: any) => Object.values(dash).filter((dash) => dash)[0],
        ),
      ],
      false,
      "title",
    );

    return new Promise((resolve) => {
      resolve(true);
    });
  };

  const getOrgs = async () => {
    const orgs = await organizationsService.list(0, 100000, "name", false, "");

    updateResourceEntities("org", ["identifier"], [...orgs.data.data]);

    return new Promise((resolve) => {
      resolve(true);
    });
  };

  const getSavedViews = async () => {
    const savedViews = await savedviewsService.get(store.state.selectedOrganization.identifier);
    updateResourceEntities(
      "savedviews",
      ["view_id"],
      [...savedViews.data.views],
      false,
      "view_name",
    );

    return new Promise((resolve) => {
      resolve(true);
    });
  };

  const getFolders = async () => {
    const folders: any = await dashboardService.list_Folders(
      store.state.selectedOrganization.identifier,
    );

    let isDefaultPresent = folders.data.list.find((folder: any) => folder.folderId === "default");

    if (!isDefaultPresent) {
      folders.data.list.unshift({ folderId: "default", name: "default" });
    }

    updateResourceEntities(
      "dfolder",
      ["folderId"],
      [...folders.data.list],
      true,
      "name",
      "dashboard",
    );
    return new Promise((resolve) => {
      resolve(true);
    });
  };
  const getAlertFolders = async () => {
    //this is exaclty same as getFolders, but we are using different endpoint
    const folders: any = await commonService.list_Folders(
      store.state.selectedOrganization.identifier,
      "alerts",
    );

    let isDefaultPresent = folders.data.list.find((folder: any) => folder.folderId === "default");

    if (!isDefaultPresent) {
      folders.data.list.unshift({ folderId: "default", name: "default" });
    }

    updateResourceEntities("afolder", ["folderId"], [...folders.data.list], true, "name", "alert");
    return new Promise((resolve) => {
      resolve(true);
    });
  };
  const getSyntheticsFolders = async () => {
    // Same shape as getAlertFolders — synthetics folders live under folder type "synthetics".
    const folders: any = await commonService.list_Folders(
      store.state.selectedOrganization.identifier,
      "synthetics",
    );

    let isDefaultPresent = folders.data.list.find((folder: any) => folder.folderId === "default");

    if (!isDefaultPresent) {
      folders.data.list.unshift({ folderId: "default", name: "default" });
    }

    updateResourceEntities(
      "synthetic_folder",
      ["folderId"],
      [...folders.data.list],
      true,
      "name",
      "synthetics",
    );
    return new Promise((resolve) => {
      resolve(true);
    });
  };
  const getSynthetics = async (resource: Entity | Resource) => {
    // Monitors of one folder. Unlike alerts, synthetics FGA entities are plain
    // monitor ids (no folder prefix) — matches backend set_ownership objects.
    const res: any = await syntheticsService.listByFolderId(
      store.state.selectedOrganization.identifier,
      resource.name,
    );

    // `monitors` was renamed `checks` in the synthetics list response.
    const syntheticRows = res.data?.checks ?? res.data?.monitors ?? [];
    updateEntityEntities(resource, ["id"], [...syntheticRows], false, "name");

    return new Promise((resolve) => {
      resolve(true);
    });
  };
  const getSyntheticEnvironments = async () => {
    // Grants are written against the environment name, so the name is the entity key.
    const res = await syntheticsService.listEnvironments(
      store.state.selectedOrganization.identifier,
    );
    const environments: SyntheticsEnvironment[] = res.data ?? [];
    updateResourceEntities("synthetic_environment", ["name"], [...environments]);
    return true;
  };
  const getWorkflowFolders = async () => {
    const folders: any = await commonService.list_Folders(
      store.state.selectedOrganization.identifier,
      "workflows",
    );

    let isDefaultPresent = folders.data.list.find((folder: any) => folder.folderId === "default");

    if (!isDefaultPresent) {
      folders.data.list.unshift({ folderId: "default", name: "default" });
    }

    updateResourceEntities(
      "workflow_folder",
      ["folderId"],
      [...folders.data.list],
      true,
      "name",
      "workflows",
    );
    return new Promise((resolve) => {
      resolve(true);
    });
  };
  const getWorkflows = async (resource: Entity | Resource) => {
    // Plain workflow ids, no folder prefix — matches the objects set_ownership
    // writes, same as synthetics.
    const res: any = await workflowService.listWorkflows(
      store.state.selectedOrganization.identifier,
      resource.name,
    );

    const workflowRows = Array.isArray(res.data) ? res.data : (res.data?.list ?? []);
    updateEntityEntities(resource, ["id"], [...workflowRows], false, "name");

    return new Promise((resolve) => {
      resolve(true);
    });
  };
  const _getGroups = async () => {
    const groups = await getGroups(store.state.selectedOrganization.identifier);
    updateResourceEntities("group", [], [...groups.data]);

    return new Promise((resolve) => {
      resolve(true);
    });
  };

  const _getRoles = async () => {
    const roles = await getRoles(store.state.selectedOrganization.identifier);
    updateResourceEntities("role", [], [...roles.data]);

    return new Promise((resolve) => {
      resolve(true);
    });
  };

  const getFunctions = async () => {
    const functions = await jsTransformService.list(
      1,
      100000,
      "name",
      false,
      "",
      store.state.selectedOrganization.identifier,
    );

    updateResourceEntities("function", ["name"], [...functions.data.list]);

    return new Promise((resolve) => {
      resolve(true);
    });
  };

  const getDestinations = async () => {
    const destinations = await queryClient.fetchQuery(
      destinationsQuery(store.state.selectedOrganization.identifier),
    );

    updateResourceEntities("destination", ["name"], [...destinations]);

    return new Promise((resolve) => {
      resolve(true);
    });
  };

  const getTemplates = async () => {
    const templates = await queryClient.fetchQuery(
      templatesQuery(store.state.selectedOrganization.identifier),
    );

    updateResourceEntities("template", ["name"], [...templates]);

    return new Promise((resolve) => {
      resolve(true);
    });
  };

  const getPipelines = async () => {
    const pipelines = await pipelineService.getPipelines(
      store.state.selectedOrganization.identifier,
    );

    updateResourceEntities("pipeline", ["pipeline_id"], [...pipelines.data.list], false, "name");

    return new Promise((resolve) => {
      resolve(true);
    });
  };

  const getAlerts = async (resource: Entity | Resource) => {
    let alerts: any = await alertService.listByFolderId(
      0,
      10000,
      "name",
      false,
      "",
      store.state.selectedOrganization.identifier,
      resource.name,
      "",
    );

    updateEntityEntities(resource, ["alertId"], [...alerts.data.list], false, "name");

    return new Promise((resolve) => {
      resolve(true);
    });
  };

  const getLogs = async (resource: Resource | Entity) => {
    const logs: any = await getStreams("logs", false);

    updateEntityEntities(resource, ["name"], logs.list);

    return new Promise((resolve) => {
      resolve(true);
    });
  };

  const getLogsPatternStreams = async () => {
    const logs: any = await getStreams("logs", false);

    updateResourceEntities("logs_pattern", ["name"], logs.list);

    return new Promise((resolve) => {
      resolve(true);
    });
  };

  const getLogsInsightsStreams = async () => {
    const logs: any = await getStreams("logs", false);

    updateResourceEntities("logs_insights", ["name"], logs.list);

    return new Promise((resolve) => {
      resolve(true);
    });
  };

  const getLogsCacheStreams = async () => {
    const logs: any = await getStreams("logs", false);

    updateResourceEntities("logs_cache", ["name"], logs.list);

    return new Promise((resolve) => {
      resolve(true);
    });
  };

  const getIndexStreams = async (resource: Resource | Entity) => {
    const indices: any = await getStreams("index", false);

    updateEntityEntities(resource, ["name"], indices.list);

    return new Promise((resolve) => {
      resolve(true);
    });
  };

  const getMetrics = async (resource: Resource | Entity) => {
    const metrics: any = await getStreams("metrics", false);

    updateEntityEntities(resource, ["name"], metrics.list);

    return new Promise((resolve) => {
      resolve(true);
    });
  };

  const getTraces = async (resource: Resource | Entity) => {
    const traces: any = await getStreams("traces", false);

    updateEntityEntities(resource, ["name"], traces.list);

    return new Promise((resolve) => {
      resolve(true);
    });
  };

  const getMetadataStreams = async () => {
    const metadata: any = await getStreams("metadata", false);

    updateResourceEntities("metadata", ["name"], metadata.list);

    return new Promise((resolve) => {
      resolve(true);
    });
  };

  const getStreamsTypes = async () => {
    const streams = [
      { stream_type: "logs", name: t("common.logs") },
      { stream_type: "traces", name: t("common.traces") },
      { stream_type: "metrics", name: t("common.metrics") },
      { stream_type: "index", name: t("iam.indices") },
    ];

    streams.forEach((stream) => {
      updateResourceResource(stream.stream_type, "stream", ["stream_type"], [stream], true, "name");
    });

    return new Promise((resolve) => {
      resolve(true);
    });
  };

  const getReportFolders = async () => {
    const folders: any = await commonService.list_Folders(
      store.state.selectedOrganization.identifier,
      "reports",
    );

    let isDefaultPresent = folders.data.list.find((folder: any) => folder.folderId === "default");

    if (!isDefaultPresent) {
      folders.data.list.unshift({ folderId: "default", name: "default" });
    }

    updateResourceEntities("rfolder", ["folderId"], [...folders.data.list], true, "name", "report");

    return new Promise((resolve) => {
      resolve(true);
    });
  };

  const getReports = async (resource: Entity | Resource) => {
    const reports: any = await reportService.listByFolderId(
      store.state.selectedOrganization.identifier,
      resource.name,
    );

    updateEntityEntities(
      resource,
      ["report_id"],
      [...(reports.data.list ?? reports.data)],
      false,
      "name",
    );

    return new Promise((resolve) => {
      resolve(true);
    });
  };

  const getServiceAccounts = async () => {
    const accounts = await serviceAccountService.list(store.state.selectedOrganization.identifier);

    updateResourceEntities("service_accounts", ["email"], accounts.data.data);

    return new Promise((resolve) => {
      resolve(true);
    });
  };

  const getCipherKeys = async () => {
    const data: any = await cipherKeysService.list(store.state.selectedOrganization.identifier);

    updateResourceEntities("cipher_keys", ["name"], [...data.data.keys]);

    return new Promise((resolve) => {
      resolve(true);
    });
  };

  const getRePatterns = async () => {
    const data: any = await RePatternsService.list(store.state.selectedOrganization.identifier);

    updateResourceEntities("re_patterns", ["id"], [...data.data.patterns], false, "name");

    return new Promise((resolve) => {
      resolve(true);
    });
  };

  const getProviders = async () => {
    const providers = await onlineEvalsService.providers.list(
      store.state.selectedOrganization.identifier,
    );

    updateResourceEntities("provider", ["id"], providers, false, "name");

    return new Promise((resolve) => {
      resolve(true);
    });
  };

  const getScoreConfigs = async () => {
    const scoreConfigs = await onlineEvalsService.scoreConfigs.list(
      store.state.selectedOrganization.identifier,
    );

    updateResourceEntities(
      "score_config",
      ["entityId"],
      scoreConfigs.map((scoreConfig: any) => ({
        ...scoreConfig,
        entityId: scoreConfig.entityId ?? scoreConfig.entity_id ?? scoreConfig.id,
      })),
      false,
      "name",
    );

    return new Promise((resolve) => {
      resolve(true);
    });
  };

  const getScorers = async () => {
    const scorers = await onlineEvalsService.scorers.list(
      store.state.selectedOrganization.identifier,
    );

    updateResourceEntities(
      "scorer",
      ["entityId"],
      scorers.map((scorer: any) => ({
        ...scorer,
        entityId: scorer.entityId ?? scorer.entity_id ?? scorer.id,
      })),
      false,
      "name",
    );

    return new Promise((resolve) => {
      resolve(true);
    });
  };

  const getEvalJobs = async () => {
    const evalJobs = await onlineEvalsService.jobs.list(
      store.state.selectedOrganization.identifier,
    );

    updateResourceEntities("eval_job", ["id"], evalJobs, false, "name");

    return new Promise((resolve) => {
      resolve(true);
    });
  };

  const getAnnotationQueues = async () => {
    const queues = await llmQueuesService.list(store.state.selectedOrganization.identifier);

    updateResourceEntities("annotation_queue", ["id"], queues, false, "name");

    return new Promise((resolve) => {
      resolve(true);
    });
  };

  const getDatasets = async () => {
    const datasets = await llmDatasetsService.list(store.state.selectedOrganization.identifier);

    updateResourceEntities("dataset", ["id"], datasets, false, "name");

    return new Promise((resolve) => {
      resolve(true);
    });
  };

  return {
    entityLoads,
    getResourceEntities,
    getEnrichmentTables,
    getDashboards,
    getOrgs,
    getSavedViews,
    getFolders,
    getAlertFolders,
    getSyntheticsFolders,
    getSynthetics,
    getSyntheticEnvironments,
    getWorkflowFolders,
    getWorkflows,
    _getGroups,
    _getRoles,
    getFunctions,
    getDestinations,
    getTemplates,
    getPipelines,
    getAlerts,
    getLogs,
    getLogsPatternStreams,
    getLogsInsightsStreams,
    getLogsCacheStreams,
    getIndexStreams,
    getMetrics,
    getTraces,
    getMetadataStreams,
    getStreamsTypes,
    getReportFolders,
    getReports,
    getServiceAccounts,
    getCipherKeys,
    getRePatterns,
    getProviders,
    getScoreConfigs,
    getScorers,
    getEvalJobs,
    getAnnotationQueues,
    getDatasets,
  };
};
