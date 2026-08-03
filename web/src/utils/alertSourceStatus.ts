export type AlertSourceStatus = "receiving" | "stale" | "not_connected";

const STALE_THRESHOLD_MICROS = 15 * 60 * 1_000_000; // 15 minutes

export function getAlertSourceStatus(
  lastReceivedAt: number | null | undefined,
  nowMicros: number,
): AlertSourceStatus {
  if (lastReceivedAt === null || lastReceivedAt === undefined) {
    return "not_connected";
  }
  const age = nowMicros - lastReceivedAt;
  return age < STALE_THRESHOLD_MICROS ? "receiving" : "stale";
}
