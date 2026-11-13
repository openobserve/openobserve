import type { I18nKey, TranslateFn } from "@/types/i18n";
import type { Place, Tracking } from "@/services/service_versions";
import { deployTimeZone as userZone } from "@/utils/deployTimeZone";

export { setDeployTimeZone } from "@/utils/deployTimeZone";

const POINT_METRICS = new Set(["error_rate", "error_view_rate"]);

export interface CompareTitle {
  baseline: string;
  compared: string;
  suffix: string;
  // Image shorts already gated by imageShort; empty when the version needs no suffix.
  baselineImage?: string;
  comparedImage?: string;
}

// Where a compare's baseline came from, named in the one baseline tag every version list shows.
export type BaselineSource = "picked" | "automatic" | "last_good";

/** The build a compare measures against and where it came from. */
export interface BaselineMark {
  version: string;
  image: string | null;
  source: BaselineSource;
}

export interface NoiseInput {
  delta?: number | null;
  lo?: number | null;
  hi?: number | null;
  straddles_zero?: boolean | null;
  b?: number | null;
}

/** The image short a version label shows: only once its version has two or more images, then on every image. */
export function imageShort(image: string | null | undefined, versionImages: number | undefined) {
  return image && (versionImages ?? 0) >= 2 ? image : "";
}

/** The one plain-text version label: "2.4.0 · img 9c1e4b7" for a rebuilt version, else the version. */
export function versionImageLabel(
  version: string,
  image: string | null | undefined,
  versionImages: number | undefined,
  t: TranslateFn,
) {
  const short = imageShort(image, versionImages);
  return short ? `${version} · ${t("serviceVersions.image.short", { image: short })}` : version;
}

/** True when two version rows name one build: the same text and the same image, a missing image matching only another. */
export function sameBuild(
  a: { version?: string | null; image?: string | null },
  b: { version?: string | null; image?: string | null },
) {
  return (a.version ?? null) === (b.version ?? null) && (a.image || null) === (b.image || null);
}

/** A baseline is picked when the user chose it, last good when it is the scope's last good build, else automatic. */
export function baselineSource(
  rule: string | null | undefined,
  baseline: { version?: string | null; image?: string | null },
  lastGood: { version?: string | null; image?: string | null } | null | undefined,
): BaselineSource {
  if (rule === "manual") return "picked";
  return lastGood?.version && sameBuild(baseline, lastGood) ? "last_good" : "automatic";
}

export function baselineSourceLabel(source: BaselineSource, t: TranslateFn) {
  return t(`serviceVersions.panel.baselineSource.${source}` as I18nKey);
}

/** A compare arm's label: two builds of one version text always name their image, else the version's image count decides. */
export function compareArmLabel(
  arms: Record<"a" | "b", { version: string; image?: string | null }>,
  side: "a" | "b",
  versionImages: number | undefined,
  t: TranslateFn,
) {
  const { a, b } = arms;
  const shared = a.version === b.version && (a.image ?? null) !== (b.image ?? null);
  return versionImageLabel(arms[side].version, arms[side].image, shared ? 2 : versionImages, t);
}

/** A build named next to one other build, as a deploy marker or last good line: its image only when both share the version text. */
export function buildLabel(
  build: { version: string; image?: string | null },
  other: { version?: string | null; image?: string | null } | null | undefined,
  t: TranslateFn,
) {
  return compareArmLabel(
    { a: build, b: { version: other?.version ?? "", image: other?.image } },
    "a",
    undefined,
    t,
  );
}

/** True for a scope with no Kubernetes location: the bare default where, or a K8s place with neither cluster nor namespace. */
export function isOutsideK8s(whereKey: string | null | undefined, where?: Place | null) {
  if (where?.kind && where.kind !== "k8s") return where.kind === "default";
  if (where?.k8s_cluster || where?.k8s_namespace) return false;
  if (whereKey?.startsWith("k8s:")) return !whereKey.slice(4).split("/").some(Boolean);
  if (where?.kind === "k8s") return !whereKey;
  return !!whereKey && !whereKey.startsWith("env:");
}

/** The one where label: "Outside Kubernetes" for a scope with no Kubernetes location, never its "default" key. */
export function whereText(
  whereKey: string | null | undefined,
  where: Place | null | undefined,
  t: TranslateFn,
): string {
  if (isOutsideK8s(whereKey, where)) return t("serviceVersions.where.outside");
  if (where?.kind === "k8s" && (where.k8s_cluster || where.k8s_namespace))
    return [where.k8s_cluster, where.k8s_namespace].filter(Boolean).join(" · ");
  return (whereKey || "")
    .replace(/^[a-z0-9_]+:/, "")
    .split("/")
    .filter(Boolean)
    .join(" · ");
}

/** A "… in {where}" sentence, or its outside-Kubernetes wording, so no sentence reads "in Outside Kubernetes". */
export function whereSentence(
  keys: { in: I18nKey; outside: I18nKey },
  whereKey: string | null | undefined,
  where: Place | null | undefined,
  params: Record<string, unknown>,
  t: TranslateFn,
) {
  return isOutsideK8s(whereKey, where)
    ? t(keys.outside, params)
    : t(keys.in, { ...params, where: whereText(whereKey, where, t) });
}

/** Why a scope reads "Outside Kubernetes", for the surfaces that have room for a tooltip. */
export function whereOutsideReason(t: TranslateFn) {
  return t("serviceVersions.where.outsideReason");
}

/** The one compare header: baseline first, then the compared version, then what kind of change it was. */
export function compareTitle(
  input: {
    compared: string;
    baseline?: string;
    kind?: string;
    notServing?: boolean;
    comparedImage?: string;
    baselineImage?: string;
  },
  t: TranslateFn,
): CompareTitle {
  const suffix =
    input.kind === "rollback"
      ? t("serviceVersions.compare.rollbackSuffix")
      : input.notServing
        ? t("serviceVersions.compare.notServingSuffix")
        : input.kind === "redeploy"
          ? t("serviceVersions.compare.redeploySuffix")
          : "";
  return {
    baseline: input.baseline || "",
    compared: input.compared,
    suffix,
    ...(input.baselineImage ? { baselineImage: input.baselineImage } : {}),
    ...(input.comparedImage ? { comparedImage: input.comparedImage } : {}),
  };
}

/** The title as one line of text, each version with its image short when it has one. */
export function compareTitleText(title: CompareTitle, t: TranslateFn) {
  const label = (version: string, image?: string) =>
    image ? `${version} · ${t("serviceVersions.image.short", { image })}` : version;
  return {
    baseline: title.baseline ? label(title.baseline, title.baselineImage) : "",
    compared: label(title.compared, title.comparedImage),
  };
}

// Pushed by the app store rather than imported from it, because specs that mock vuex load this module; a ref so stamps re-render on change.

// An unknown zone name would throw, so the stamp falls back to the browser's zone.
function zoned(options: Intl.DateTimeFormatOptions, timeZone?: string) {
  try {
    return new Intl.DateTimeFormat(undefined, { ...options, timeZone });
  } catch {
    return new Intl.DateTimeFormat(undefined, options);
  }
}

/** One locale-aware stamp for every deploy and version time: the app's 24-hour clock, the year only when not this year. */
export function formatDeployTime(us: number, now = Date.now(), timeZone = userZone.value) {
  const date = new Date(us / 1000);
  const year = (value: Date) => zoned({ year: "numeric" }, timeZone).format(value);
  return zoned(
    {
      day: "numeric",
      month: "short",
      ...(year(date) === year(new Date(now)) ? {} : { year: "numeric" as const }),
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    },
    timeZone,
  ).format(date);
}

/** A time of day in the same clock as formatDeployTime, for windows inside one day. */
export function formatDeployClock(us: number, seconds = false, timeZone = userZone.value) {
  return zoned(
    {
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      ...(seconds ? { second: "2-digit" as const } : {}),
    },
    timeZone,
  ).format(new Date(us / 1000));
}

/** Whether two moments fall on the same calendar day in the zone deploy times are printed in. */
export function sameDeployDay(us: number, now = Date.now(), timeZone = userZone.value) {
  const day = zoned({ year: "numeric", month: "numeric", day: "numeric" }, timeZone);
  return day.format(new Date(us / 1000)) === day.format(new Date(now));
}

/** The one sentence for detail rows that cannot tell New from Gone, for endpoints, pages and error types alike. */
export function detailGapText(
  subject: "endpoint" | "page" | "error",
  span: "this" | "both",
  t: TranslateFn,
) {
  return t("serviceVersions.compare.detailGap", {
    subject: t(`serviceVersions.compare.detailGapSubject.${subject}`),
    span: t(`serviceVersions.compare.detailGapSpan.${span}`),
  });
}

/** True when the API says tracking has not started for the org, or for this scope when it reports a scope flag. */
export function trackingNotStarted(tracking: Tracking | null | undefined, scopeStarted?: boolean) {
  return scopeStarted === false || (Boolean(tracking) && tracking?.epoch == null);
}

/** The one no-verdict sentence for the org banner and a version alike; warm-up wins, so nothing claims a version ran before tracking. */
export function noVerdictText(
  tracking: Tracking | null | undefined,
  t: TranslateFn,
  now = Date.now() * 1000,
  scopeStarted?: boolean,
) {
  const state = noVerdictState(tracking, now, scopeStarted);
  if (state === "warming")
    return t("serviceVersions.catalog.warmingUp", {
      time: formatDeployTime(tracking!.warmup_ends_at!),
    });
  if (state === "warmingUntimed") return t("serviceVersions.catalog.warmingUpNoEpoch");
  return state === "preExistingSince"
    ? t("serviceVersions.sentence.preExistingSince", { epoch: formatDeployTime(tracking!.epoch!) })
    : t("serviceVersions.sentence.preExisting");
}

/** The same no-verdict state as noVerdictText, worded as a baseline rule for a picker with no baseline to name. */
export function noVerdictRule(
  tracking: Tracking | null | undefined,
  t: TranslateFn,
  now = Date.now() * 1000,
  scopeStarted?: boolean,
) {
  return noVerdictState(tracking, now, scopeStarted).startsWith("warming")
    ? t("serviceVersions.compare.baselineRule.warming_up")
    : t("serviceVersions.compare.baselineRule.pre_existing");
}

/** True when a change prints as zero: tenths of a point for rates, three decimals for CLS, tenths of a percent otherwise. */
export function changeRoundsToZero(metric: string, delta: number, base?: number | null) {
  if (POINT_METRICS.has(metric) || metric === "cls_p75")
    return Math.round(Math.abs(delta) * 1000) === 0;
  return Boolean(base) && Math.round(Math.abs(delta / base!) * 1000) === 0;
}

/** The one noise judgement the tiles and the verdict banner share: a range across zero, no change, or one that prints as zero. */
export function isNoiseChange(metric: string, value: NoiseInput) {
  const straddles =
    value.straddles_zero ??
    (value.lo == null || value.hi == null || (value.lo <= 0 && value.hi >= 0));
  return straddles || !value.delta || changeRoundsToZero(metric, value.delta, value.b);
}

// Warm-up names its end only while that end is ahead; a passed end or an org without an epoch reads time-less.
function noVerdictState(
  tracking: Tracking | null | undefined,
  now: number,
  scopeStarted?: boolean,
) {
  const end = tracking?.epoch ? tracking.warmup_ends_at : null;
  const warming = end && end > now ? end : null;
  if (trackingNotStarted(tracking, scopeStarted)) return warming ? "warming" : "warmingUntimed";
  if (warming) return "warming";
  return tracking?.epoch ? "preExistingSince" : "preExisting";
}
