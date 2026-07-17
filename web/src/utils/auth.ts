// Copyright 2026 OpenObserve Inc.

import config from "../aws-exports";
import { useStore } from "vuex";
import userService from "@/services/users";
import organizationService from "@/services/organizations";
import {
  b64DecodeUnicode,
  b64EncodeStandard,
  b64DecodeStandard,
} from "@/utils/formatters";
import { useLocalUserInfo } from "@/utils/storage";
import { getUUID, getUUIDv7 } from "@/utils/uuid";

// Exact paths that stay reachable when the org has ingested nothing yet. The
// empty-data redirect exists to push people toward ingestion rather than show
// them empty data views, and that still applies to most of Settings — but an org
// with nothing ingested is precisely the one an admin is most likely to want to
// delete, and the Danger Zone lives on /settings/general. "/settings" is included
// because the nav's Settings entry lands there before redirecting to general.
// Matched exactly, not by prefix, so the rest of the Settings tree stays gated.
export const emptyDataAllowedPaths = ["/settings", "/settings/general"];

// "/settings/general/" and "/settings/general" are the same page; an exact match
// must not hinge on a trailing slash.
const normalizePath = (path: string) =>
  path !== "/" && path.endsWith("/") ? path.slice(0, -1) : path;

export const trialPeriodAllowedPath = [
  "iam",
  "users",
  "organizations",
  "invitations",
];

export const getUserInfo = (loginString: string) => {
  try {
    let decToken = null;
    const tokens = loginString.substring(1).split("&");
    for (const token of tokens) {
      const propArr = token.split("=");
      if (propArr[0] === "id_token") {
        const tokenString = propArr[1];
        const parts = tokenString.split(".");
        if (parts.length === 3) {
          try {
            const payload = JSON.parse(b64DecodeUnicode(parts[1]) || "");
            if (!payload || typeof payload !== "object") return null;
            payload["family_name"] = payload["name"] || "";
            payload["given_name"] = payload["given_name"] || "";
            const encodedSessionData: any = b64EncodeStandard(
              JSON.stringify(payload),
            );
            useLocalUserInfo(encodedSessionData);
            decToken = payload;
          } catch (error) {
            console.error("Invalid JWT token");
            return null;
          }
        } else {
          decToken = getDecodedAccessToken(propArr[1]);
          const encodedSessionData: any = b64EncodeStandard(
            JSON.stringify(decToken),
          );
          useLocalUserInfo(encodedSessionData);
        }
      }
    }

    return decToken;
  } catch (e) {
    console.log("Error in getUserInfo util");
  }
};

export const invalidateLoginData = () => {
  userService.logout().then(() => {});
};

export const getDecodedAccessToken = (token: string) => {
  try {
    const decodedString = b64DecodeStandard(token.split(".")[1]);
    if (typeof decodedString === "string") {
      return JSON.parse(decodedString);
    } else {
      return "";
    }
  } catch (e) {
    console.log("error decoding token");
  }
};

export const getDecodedUserInfo = () => {
  try {
    if (useLocalUserInfo() !== null) {
      const userinfo: any = useLocalUserInfo();
      return b64DecodeStandard(userinfo);
    } else {
      return null;
    }
  } catch (e) {
    console.log("Error: Error while pull sessionstorage value.");
    return undefined;
  }
};

export const getBasicAuth = (username: string, password: string) => {
  const token = username + ":" + password;
  const hash = window.btoa(token);
  return "Basic " + hash;
};

export const getDueDays = (microTimestamp: number): number => {
  const timestampMs = Math.floor(microTimestamp / 1000);
  const givenDate = new Date(timestampMs);
  const currentDate = new Date();
  const timeDiffMs = givenDate.getTime() - currentDate.getTime();
  const dueDays = Math.floor(timeDiffMs / (1000 * 60 * 60 * 24));
  return dueDays;
};

export const routeGuard = async (to: any, from: any, next: any) => {
  const store = useStore();
  if (config.isCloud) {
    if (
      store.state.organizationData?.organizationSettings?.free_trial_expiry !==
      ""
    ) {
      const trialDueDays = getDueDays(
        store.state.organizationData?.organizationSettings?.free_trial_expiry,
      );
      if (trialDueDays <= 0 && trialPeriodAllowedPath.indexOf(to.name) === -1) {
        next({
          name: "plans",
          query: {
            org_identifier: store.state.selectedOrganization.identifier,
          },
        });
        return;
      }
    }
  }

  if (
    to.path.indexOf("/ingestion") === -1 &&
    to.path.indexOf("/iam") === -1 &&
    to.name !== "iam" &&
    emptyDataAllowedPaths.indexOf(normalizePath(to.path)) === -1 &&
    trialPeriodAllowedPath.indexOf(to.name) === -1 &&
    Object.prototype.hasOwnProperty.call(
      store.state.zoConfig,
      "restricted_routes_on_empty_data"
    ) &&
    store.state.zoConfig.restricted_routes_on_empty_data === true &&
    store.state.organizationData.isDataIngested === false
  ) {
    try {
      const orgIdentifier = store.state.selectedOrganization.identifier;
      if (!orgIdentifier) {
        next();
        return;
      }
      const response = await organizationService.get_organization_summary(
        orgIdentifier,
      );
      if (!response.data?.streams?.num_streams) {
        store.dispatch("setIsDataIngested", false);
        next({ path: "/ingestion" });
      } else {
        store.dispatch("setIsDataIngested", true);
        next();
      }
    } catch (error) {
      console.warn("Failed to fetch organization summary:", error);
      store.dispatch("setIsDataIngested", true);
      next();
    }
  } else {
    next();
  }
};

export const verifyOrganizationStatus = (_Organizations: any, _Router: any) => {};

export const generateTraceContext = () => {
  const traceId = getUUIDv7(true);
  const spanId = getUUID().replace(/-/g, "").slice(0, 16);

  return {
    traceparent: `00-${traceId}-${spanId}-01`,
    traceId,
    spanId,
  };
};

export function checkCallBackValues(url: string, key: string) {
  const params = new URLSearchParams(url.startsWith("#") ? url.slice(1) : url);
  return params.get(key) ?? undefined;
}
