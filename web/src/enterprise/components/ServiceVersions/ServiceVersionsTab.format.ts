import { formatDeployClock, formatDeployTime, sameDeployDay } from "@/utils/serviceVersionsCopy";
import { formatRelativeTime } from "@/utils/dashboard/saveConflict";

export function dateTime(us: number, now = Date.now()) {
  return formatDeployTime(us, now);
}

export function clockTime(us: number, now = Date.now()) {
  return sameDeployDay(us, now) ? formatDeployClock(us) : formatDeployTime(us, now);
}

export function ago(us: number, locale: string, now = Date.now()) {
  return formatRelativeTime(us / 1000, locale, now, "narrow");
}
