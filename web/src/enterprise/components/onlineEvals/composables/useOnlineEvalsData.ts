import { ref } from "vue";
import { useI18n } from "vue-i18n";
import onlineEvalsService, {
  type EvalJob,
  type Provider,
  type ScoreConfig,
  type Scorer,
} from "@/services/online-evals.service";
import { entityId } from "../utils/evalEntity";
import { showError } from "../utils/evalFormat";

export function useOnlineEvalsData() {
  const { t } = useI18n();
  const jobs = ref<EvalJob[]>([]);
  const scorers = ref<Scorer[]>([]);
  const scoreConfigs = ref<ScoreConfig[]>([]);
  const scoreConfigVersions = ref<Record<string, ScoreConfig[]>>({});
  const providers = ref<Provider[]>([]);
  const isLoading = ref(false);

  async function loadAll(orgId: string) {
    if (!orgId) return;
    isLoading.value = true;
    try {
      const [providerList, scoreConfigList, scorerList, jobList] = await Promise.all([
        onlineEvalsService.providers.list(orgId),
        onlineEvalsService.scoreConfigs.list(orgId),
        onlineEvalsService.scorers.list(orgId),
        onlineEvalsService.jobs.list(orgId),
      ]);

      providers.value = providerList;
      scoreConfigs.value = scoreConfigList;
      scoreConfigVersions.value = Object.fromEntries(
        scoreConfigList.map((config) => [entityId(config), [config]]),
      );
      scorers.value = scorerList;
      jobs.value = jobList;
    } catch (err: any) {
      showError(err, t("onlineEvals.loadError"));
    } finally {
      isLoading.value = false;
    }
  }

  async function loadProviders(orgId: string) {
    if (!orgId) return;
    try {
      providers.value = await onlineEvalsService.providers.list(orgId);
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
