import type { I18nKey, I18nText, TranslateFn } from "@/types/i18n";
import type { RefreshBody } from "@/ts/interfaces/licenseRefresh";
export type { RefreshBody, RefreshStatus } from "@/ts/interfaces/licenseRefresh";

export interface RefreshMessage {
  variant: "success" | "warning" | "error" | "info";
  text: I18nText;
  hint?: I18nText;
}

const ERROR_KEYS: Record<string, I18nKey> = {
  unreachable: "about.online_error_unreachable",
  timeout: "about.online_error_timeout",
  blocked: "about.online_error_blocked",
  superseded: "about.online_error_superseded",
  key_conflict: "about.online_error_key_conflict",
  refused_by_env: "about.online_error_refused_by_env",
  rev_ignored: "about.online_error_rev_ignored",
  rev_conflict: "about.online_error_rev_conflict",
  disabled: "about.online_error_disabled",
  airgapped: "about.online_error_airgapped",
  not_v2: "about.online_error_not_v2",
  not_online: "about.online_error_not_online",
  no_license: "about.online_error_no_license",
  licence_inactive: "about.online_error_licence_inactive",
  licence_expired: "about.online_error_licence_expired",
  rate_limited: "about.online_error_rate_limited",
  unsupported_server: "about.online_error_unsupported_server",
  invalid_response: "about.online_error_invalid_response",
  rejected: "about.online_error_rejected",
  validator_rejected: "about.online_error_validator_rejected",
  instance_key_unreadable: "about.online_error_instance_key_unreadable",
  lock_unavailable: "about.online_error_lock_unavailable",
  internal: "about.online_error_internal",
};
const STATUS_KEYS: Record<string, I18nKey> = {
  registered: "about.online_registered",
  not_registered: "about.online_not_registered",
  key_conflict: "about.online_not_registered",
  blocked: "about.online_blocked",
  disabled: "about.online_disabled",
  airgapped: "about.online_not_used",
  not_v2: "about.online_not_used",
  no_license: "about.online_not_used",
  updated: "about.online_updated_status",
  renewed: "about.online_renewed_status",
  unchanged: "about.online_unchanged",
};

export function isOldNodeBody(body: unknown): body is "" {
  return body === "";
}

export function statusLabel(status: string | null, t: TranslateFn): I18nText {
  return t(
    Object.hasOwn(STATUS_KEYS, status ?? "")
      ? STATUS_KEYS[status ?? ""]
      : "about.online_status_unknown",
  );
}

export function refreshMessage(
  body: RefreshBody | undefined,
  t: TranslateFn,
  status?: number,
): RefreshMessage {
  if (status === 403) return { variant: "error", text: t("about.refresh_needs_permission") };
  if (isOldNodeBody(body)) return { variant: "info", text: t("about.online_old_node") };
  if (body?.reason === "refresh_in_progress")
    return { variant: "info", text: t("about.online_busy") };
  if (body?.error) {
    if (body.error === "refused_by_env" && body.successor_available)
      return { variant: "warning", text: t("about.online_env_renewal") };
    const variant = ["disabled", "airgapped", "not_online", "not_v2"].includes(body.error)
      ? "info"
      : ["unreachable", "timeout", "rate_limited", "refused_by_env", "rev_ignored"].includes(
            body.error,
          )
        ? "warning"
        : "error";
    return {
      variant,
      text: t(
        Object.hasOwn(ERROR_KEYS, body.error)
          ? ERROR_KEYS[body.error]
          : "about.online_error_internal",
        {
          seconds: body.retry_after_s ?? 30,
          limits: body.limits_refreshed === true ? t("about.online_limits_refreshed") : "",
        },
      ),
      ...(["timeout", "unreachable"].includes(body.error)
        ? { hint: t("about.online_proxy_hint") }
        : {}),
    };
  }
  if (body?.outcome === "updated") {
    return {
      variant: "success",
      text: t("about.online_updated", {
        added: t(
          "about.online_waivers_added",
          { count: body.waivers_added ?? 0 },
          body.waivers_added ?? 0,
        ),
        removed: body.waivers_removed ?? 0,
      }),
    };
  }
  if (body?.outcome === "renewed") {
    const date = body.renewed
      ? new Intl.DateTimeFormat(undefined, {
          timeZone: "UTC",
          month: "short",
          day: "numeric",
          year: "numeric",
        }).format(body.renewed.expires_at / 1000)
      : null;
    return {
      variant: "success",
      text: date ? t("about.online_renewed_date", { date }) : t("about.online_renewed"),
    };
  }
  if (body?.outcome === "unchanged")
    return { variant: "success", text: t("about.online_unchanged") };
  return { variant: "error", text: t("about.online_error_internal") };
}
