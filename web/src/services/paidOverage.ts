// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

import http from "./http";

export type PaidOverageFeature = "ai_credits";
export type PaidOverageBillingStatus =
  "eligible" | "subscription_required" | "additional_credits_required";

export interface PaidOverageOrganizationStatus {
  org_id: string;
  enabled: boolean;
  can_manage: boolean;
}

export interface PaidOverageStatus {
  feature: PaidOverageFeature;
  organization: PaidOverageOrganizationStatus;
  payer: PaidOverageOrganizationStatus | null;
  effective: boolean;
  billing_status: PaidOverageBillingStatus;
}

const paidOverage = {
  get(orgIdentifier: string, feature: PaidOverageFeature = "ai_credits") {
    return http().get<PaidOverageStatus>(`/api/${orgIdentifier}/quota/${feature}/paid_overage`);
  },

  update(orgIdentifier: string, feature: PaidOverageFeature, enabled: boolean) {
    return http().put<PaidOverageStatus>(`/api/${orgIdentifier}/quota/${feature}/paid_overage`, {
      enabled,
    });
  },
};

export default paidOverage;
