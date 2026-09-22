// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

import { computed, readonly, ref } from "vue";
import paidOverage, {
  type PaidOverageFeature,
  type PaidOverageStatus,
} from "@/services/paidOverage";

export interface PaidOverageConsentErrorBody {
  error_type?: string;
  consent?: PaidOverageStatus;
}

interface ConsentRequest {
  key: string;
  orgId: string;
  feature: PaidOverageFeature;
  status: PaidOverageStatus;
  resolve: (accepted: boolean) => void;
}

interface SharedConsentRequest {
  promise: Promise<boolean>;
  subscribers: number;
  hasUncancelledCaller: boolean;
}

const activeRequest = ref<ConsentRequest | null>(null);
const pendingRequests: ConsentRequest[] = [];
const sharedRequests = new Map<string, SharedConsentRequest>();
const acknowledgementChecked = ref(false);
const isSubmitting = ref(false);
const errorMessage = ref("");

function showNextRequest() {
  activeRequest.value = pendingRequests.shift() ?? null;
  acknowledgementChecked.value = false;
  isSubmitting.value = false;
  errorMessage.value = "";
}

function finishActive(accepted: boolean) {
  const request = activeRequest.value;
  if (!request) return;
  activeRequest.value = null;
  request.resolve(accepted);
  showNextRequest();
}

function cancelRequest(key: string) {
  if (activeRequest.value?.key === key && !isSubmitting.value) {
    finishActive(false);
    return;
  }
  const pendingIndex = pendingRequests.findIndex((request) => request.key === key);
  if (pendingIndex >= 0) {
    const [request] = pendingRequests.splice(pendingIndex, 1);
    request.resolve(false);
  }
}

function withAbort(
  shared: SharedConsentRequest,
  key: string,
  signal?: AbortSignal,
): Promise<boolean> {
  if (!signal) return shared.promise;
  if (signal.aborted) return Promise.resolve(false);

  const { promise: abortable, resolve } = Promise.withResolvers<boolean>();
  const onAbort = () => {
    shared.subscribers -= 1;
    if (shared.subscribers === 0 && !shared.hasUncancelledCaller) cancelRequest(key);
    resolve(false);
  };
  signal.addEventListener("abort", onAbort, { once: true });
  void shared.promise.then((accepted) => {
    signal.removeEventListener("abort", onAbort);
    resolve(accepted);
  });
  return abortable;
}

export function isPaidOverageConsentError(
  status: number,
  body: unknown,
): body is PaidOverageConsentErrorBody & { consent: PaidOverageStatus } {
  return (
    status === 412 &&
    typeof body === "object" &&
    body !== null &&
    "error_type" in body &&
    body.error_type === "paid_overage_consent_required" &&
    "consent" in body &&
    typeof body.consent === "object" &&
    body.consent !== null
  );
}

export function usePaidOverageConsent() {
  const promptForConsent = (
    orgId: string,
    feature: PaidOverageFeature,
    status: PaidOverageStatus,
    signal?: AbortSignal,
  ): Promise<boolean> => {
    if (signal?.aborted) return Promise.resolve(false);

    const key = `${orgId}\u001f${feature}`;
    const existing = sharedRequests.get(key);
    if (existing) {
      if (signal) existing.subscribers += 1;
      else existing.hasUncancelledCaller = true;
      return withAbort(existing, key, signal);
    }

    const { promise, resolve: resolveRequest } = Promise.withResolvers<boolean>();
    const shared: SharedConsentRequest = {
      promise,
      subscribers: signal ? 1 : 0,
      hasUncancelledCaller: !signal,
    };
    const request: ConsentRequest = {
      key,
      orgId,
      feature,
      status,
      resolve: resolveRequest,
    };

    sharedRequests.set(key, shared);
    void promise.finally(() => {
      if (sharedRequests.get(key) === shared) sharedRequests.delete(key);
    });

    if (activeRequest.value) pendingRequests.push(request);
    else {
      activeRequest.value = request;
      acknowledgementChecked.value = false;
      errorMessage.value = "";
    }

    return withAbort(shared, key, signal);
  };

  const missingOrganizations = computed(() => {
    const status = activeRequest.value?.status;
    if (!status) return [];
    return [status.organization, status.payer]
      .filter((organization) => organization && !organization.enabled)
      .map((organization) => organization!);
  });

  const canEnable = computed(
    () =>
      missingOrganizations.value.length > 0 &&
      missingOrganizations.value.every((organization) => organization.can_manage),
  );

  const accept = async () => {
    const request = activeRequest.value;
    if (!request || isSubmitting.value || !acknowledgementChecked.value || !canEnable.value) {
      return;
    }

    isSubmitting.value = true;
    errorMessage.value = "";
    try {
      for (const organization of missingOrganizations.value) {
        await paidOverage.update(organization.org_id, request.feature, true);
      }
      const refreshed = (await paidOverage.get(request.orgId, request.feature)).data;
      if (!activeRequest.value || activeRequest.value.key !== request.key) return;
      activeRequest.value.status = refreshed;
      if (refreshed.effective) {
        finishActive(true);
      } else {
        errorMessage.value = "paidUsage.consentStillRequired";
      }
    } catch {
      errorMessage.value = "paidUsage.updateFailed";
    } finally {
      isSubmitting.value = false;
    }
  };

  const decline = () => {
    if (!isSubmitting.value) finishActive(false);
  };

  return {
    activeRequest: readonly(activeRequest),
    acknowledgementChecked,
    isSubmitting: readonly(isSubmitting),
    errorMessage: readonly(errorMessage),
    missingOrganizations,
    canEnable,
    promptForConsent,
    accept,
    decline,
  };
}

export default usePaidOverageConsent;
