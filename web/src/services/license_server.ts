import http from "./http";
import { defineGlobalQuery } from "@/composables/query/queryClient";

const licenseServer = {
  get_license: () => {
    const url = `/api/license`;
    return http().get(url);
  },
  update_license: (licenseKey: string) => {
    const url = `/api/license`;
    return http().post(url, { key: licenseKey });
  },
  refresh_license_limits: () => {
    const url = `/api/license/refresh`;
    return http().post(url, {});
  },
};

export default licenseServer;

/**
 * VOLATILE, not SESSION_STATIC: the payload carries live ingestion-usage
 * counters and the key is replaceable from the settings page, so anything longer
 * would freeze the usage bars and show the old entitlement after an update. The
 * win here is in-flight dedup between the settings page and the upgrade dialog.
 */
export const licenseQuery = defineGlobalQuery<[], any>({
  key: ["license"],
  fetch: async () => (await licenseServer.get_license()).data,
  tier: "VOLATILE",
  scope: ["license"],
});
