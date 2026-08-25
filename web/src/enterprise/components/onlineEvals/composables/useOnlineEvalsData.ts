import { evalJobsQuery } from "@/services/online-evals.service.queries";
import { scoreConfigsQuery } from "@/services/online-evals.service.queries";
import { scorersQuery } from "@/services/online-evals.service.queries";
import { providersQuery } from "@/services/online-evals.service.queries";
import { onlineEvalKeys } from "@/services/online-evals.service.querykeys";
import { queryClient } from "@/composables/query/queryClient";
import { fetchInto } from "@/composables/query/fetchInto";
import { ref } from "vue";
import { useI18nTyped } from "@/types/i18n";
import onlineEvalsService, { type EvalJob, type Provider, type ScoreConfig, type Scorer } from "@/services/online-evals.service";
import { entityId } from "../utils/evalEntity";
import { showError } from "../utils/evalFormat";

export function useOnlineEvalsData() {
  const { t } = useI18nTyped();
  const jobs = ref<EvalJob[]>([]);
  const scorers = ref<Scorer[]>([]);
  const scoreConfigs = ref<ScoreConfig[]>([]);
  const scoreConfigVersions = ref<Record<string, ScoreConfig[]>>({});
  const providers = ref<Provider[]>([]);
  const isLoading = ref(false);

  const applyScoreConfigs = (rows: ScoreConfig[]) => {
    scoreConfigs.value = rows;
    scoreConfigVersions.value = Object.fromEntries(
      rows.map((config) => [entityId(config), [config]]),
    );
  };

  async function loadAll(orgId: string, force = false) {
    if (!orgId) return;
    // `load`, not `get`: a stale entry still has rows, and `get` would block on
    // the network with the skeleton up, throwing away what the user was reading.
    // Only a genuinely cold page — nothing cached for any of the four — spins.
    isLoading.value =
      queryClient.getQueryData(onlineEvalKeys.providers(orgId)) === undefined &&
      queryClient.getQueryData(onlineEvalKeys.scoreConfigs(orgId)) === undefined &&
      queryClient.getQueryData(onlineEvalKeys.scorers(orgId)) === undefined &&
      queryClient.getQueryData(onlineEvalKeys.jobs(orgId)) === undefined;
    try {
      // The four requests still fan out in parallel, and each list settles on
      // its own so one failing endpoint cannot blank the other three.
      const [providerResult, scoreConfigResult, scorerResult, jobResult] = await Promise.allSettled(
        [
          fetchInto(providersQuery(orgId), { apply: (rows) => (providers.value = rows), force }),
          fetchInto(scoreConfigsQuery(orgId), { apply: applyScoreConfigs, force }),
          fetchInto(scorersQuery(orgId), { apply: (rows) => (scorers.value = rows), force }),
          fetchInto(evalJobsQuery(orgId), { apply: (rows) => (jobs.value = rows), force }),
        ],
      );

      if (providerResult.status === "rejected") {
        showError(providerResult.reason, t("onlineEvals.loadError"));
      }
      if (scoreConfigResult.status === "rejected") {
        showError(scoreConfigResult.reason, t("onlineEvals.loadError"));
      }
      if (scorerResult.status === "rejected") {
        showError(scorerResult.reason, t("onlineEvals.loadError"));
      }
      if (jobResult.status === "rejected") {
        showError(jobResult.reason, t("onlineEvals.loadError"));
      }
    } finally {
      isLoading.value = false;
    }
  }

  async function loadProviders(orgId: string) {
    if (!orgId) return;
    try {
      const options = providersQuery(orgId);
      await queryClient.invalidateQueries({ queryKey: options.queryKey, exact: true, refetchType: "none" });
      providers.value = await queryClient.fetchQuery(options);
    } catch (err: any) {
      showError(err, t("onlineEvals.loadError"));
    }
  }

  async function ensureScoreConfigVersions(orgId: string, entityIdValue: string) {
    if (!orgId || scoreConfigVersions.value[entityIdValue]?.length > 1) return;

    try {
      const versions = await onlineEvalsService.scoreConfigs.versions(orgId, entityIdValue);
      if (versions.length) {
        scoreConfigVersions.value = {
          ...scoreConfigVersions.value,
          [entityIdValue]: versions,
        };
      }
    } catch (err: any) {
      showError(err, t("onlineEvals.scorer.versionsLoadError"));
    }
  }

  return {
    jobs,
    scorers,
    scoreConfigs,
    scoreConfigVersions,
    providers,
    isLoading,
    loadAll,
    loadProviders,
    ensureScoreConfigVersions,
  };
}
