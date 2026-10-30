// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { computed, type ComputedRef, type Ref } from "vue";
import { SpanStatus } from "@/ts/interfaces/traces/span.types";
import { gt, raw, type TranslateFn } from "@/types/i18n";

const GRPC_STATUS_MAP: Record<string, string> = {
  "0": raw("OK"),
  "1": raw("Cancelled"),
  "2": raw("Unknown"),
  "3": raw("Invalid Argument"),
  "4": raw("Deadline Exceeded"),
  "5": raw("Not Found"),
  "6": raw("Already Exists"),
  "7": raw("Permission Denied"),
  "8": raw("Resource Exhausted"),
  "9": raw("Failed Precondition"),
  "10": raw("Aborted"),
  "11": raw("Out of Range"),
  "12": raw("Unimplemented"),
  "13": raw("Internal"),
  "14": raw("Unavailable"),
  "15": raw("Data Loss"),
  "16": raw("Unauthenticated"),
};

const HTTP_STATUS_MAP: Record<string, string> = {
  "400": raw("Bad Request"),
  "401": raw("Unauthorized"),
  "402": raw("Payment Required"),
  "403": raw("Forbidden"),
  "404": raw("Not Found"),
  "405": raw("Method Not Allowed"),
  "408": raw("Request Timeout"),
  "409": raw("Conflict"),
  "410": raw("Gone"),
  "429": raw("Too Many Requests"),
  "500": raw("Internal Server Error"),
  "501": raw("Not Implemented"),
  "502": raw("Bad Gateway"),
  "503": raw("Service Unavailable"),
  "504": raw("Gateway Timeout"),
};

// `t` defaults to gt() so the 80+ spec call sites keep their single-argument
// form; the two production callers are .vue and pass their own translator, which
// is what makes these strings follow a runtime language switch.
const useTraceDetails = (span: Ref<any> | ComputedRef<any>, t: TranslateFn = gt) => {
  const parsedEvents = computed(() => {
    try {
      return JSON.parse(span.value?.events || "[]");
    } catch {
      return [];
    }
  });

  const hasExceptionEvents = computed(() =>
    parsedEvents.value.filter((event: any) => event.name === "exception"),
  );

  const spanStatusCode = computed(() => {
    if (!span.value) return null;
    const code = span.value["http_status_code"] ?? span.value["http_response_status_code"] ?? null;
    if (code === null || code === undefined) return null;
    const num = parseInt(String(code), 10);
    if (isNaN(num)) return null;
    return num >= 400 ? String(code) : null;
  });

  const spanGrpcStatusCode = computed(() => {
    if (!span.value) return null;
    const code = span.value["rpc_grpc_status_code"] ?? span.value["grpc_status_code"] ?? null;
    if (code === null || code === undefined) return null;
    const num = parseInt(String(code), 10);
    if (isNaN(num)) return null;
    return num !== 0 ? String(code) : null;
  });

  const spanGrpcErrorName = computed(() => span.value?.["grpc_error_name"] ?? null);

  const spanGrpcErrorMessage = computed(() => span.value?.["grpc_error_message"] ?? null);

  const spanErrorType = computed(() => span.value?.["error_type"] ?? null);

  const spanDbResponseStatusCode = computed(() => span.value?.["db_response_status_code"] ?? null);

  const spanProcessExitCode = computed(() => {
    if (!span.value) return null;
    const code = span.value["process_exit_code"] ?? null;
    if (code === null || code === undefined) return null;
    const num = parseInt(String(code), 10);
    return !isNaN(num) && num !== 0 ? String(code) : null;
  });

  const hasSpanError = computed(() => {
    const isErrorStatus =
      span.value?.span_status === SpanStatus.ERROR || span.value?.span_status === "ERROR";
    if (isErrorStatus) return true;
    if (hasExceptionEvents.value.length > 0) return true;
    if (spanErrorType.value) return true;
    if (spanGrpcErrorName.value || spanGrpcErrorMessage.value) return true;
    const httpCode = parseInt(String(spanStatusCode.value ?? ""), 10);
    if (!isNaN(httpCode) && httpCode >= 400) return true;
    if (spanDbResponseStatusCode.value) return true;
    if (spanProcessExitCode.value) return true;
    return false;
  });

  const errorBannerTitle = computed(() => {
    if (hasExceptionEvents.value.length > 0) {
      const firstExc = hasExceptionEvents.value[0];
      return firstExc["exception.type"] || t("common.exception");
    }
    if (spanErrorType.value) return spanErrorType.value;
    if (spanGrpcErrorName.value) return spanGrpcErrorName.value;
    return t("common.error");
  });

  const statusCodeTitle = computed(() => {
    if (spanGrpcStatusCode.value) {
      const desc = GRPC_STATUS_MAP[String(spanGrpcStatusCode.value)];
      return desc ? desc : `gRPC ${spanGrpcStatusCode.value}`;
    }
    if (spanStatusCode.value) {
      const desc = HTTP_STATUS_MAP[String(spanStatusCode.value)];
      return desc ? desc : `HTTP ${spanStatusCode.value}`;
    }
    return "";
  });

  const errorBannerMessage = computed(() => {
    if (hasExceptionEvents.value.length > 0) {
      const firstExc = hasExceptionEvents.value[0];
      return firstExc["exception.message"] || "";
    }
    return span.value?.status_message || spanGrpcErrorMessage.value || "";
  });

  return {
    hasSpanError,
    hasExceptionEvents,
    spanStatusCode,
    spanGrpcStatusCode,
    spanGrpcErrorName,
    spanGrpcErrorMessage,
    spanErrorType,
    spanDbResponseStatusCode,
    spanProcessExitCode,
    errorBannerTitle,
    errorBannerMessage,
    statusCodeTitle,
  };
};

export default useTraceDetails;
