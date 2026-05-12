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

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { computed, ref } from "vue";
import useTraceDetails from "./useTraceDetails";
import { SpanStatus } from "@/ts/interfaces/traces/span.types";

describe("useTraceDetails", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ---------------------------------------------------------------------------
  // edge cases: null, undefined, empty span
  // ---------------------------------------------------------------------------
  describe("when span is null or undefined", () => {
    it("should return null for string-valued computeds", () => {
      const span = computed(() => null);
      const result = useTraceDetails(span);

      expect(result.spanStatusCode.value).toBeNull();
      expect(result.spanGrpcStatusCode.value).toBeNull();
      expect(result.spanGrpcErrorName.value).toBeNull();
      expect(result.spanGrpcErrorMessage.value).toBeNull();
      expect(result.spanErrorType.value).toBeNull();
      expect(result.spanDbResponseStatusCode.value).toBeNull();
      expect(result.spanProcessExitCode.value).toBeNull();
    });

    it("should return false for hasSpanError", () => {
      const span = computed(() => null);
      const result = useTraceDetails(span);
      expect(result.hasSpanError.value).toBe(false);
    });

    it("should return default non-null values", () => {
      const span = computed(() => null);
      const result = useTraceDetails(span);

      // parsedEvents is internal, not exported; tested indirectly below
      expect(result.hasExceptionEvents.value).toEqual([]);
      expect(result.errorBannerTitle.value).toBe("Error");
      expect(result.statusCodeTitle.value).toBe("");
      expect(result.errorBannerMessage.value).toBe("");
    });
  });

  describe("when span is empty object", () => {
    it("should return all properties with correct types", () => {
      const span = computed(() => ({}));
      const result = useTraceDetails(span);

      // parsedEvents is internal, not exported; tested indirectly below
      expect(result.hasExceptionEvents.value).toEqual([]);
      expect(result.hasSpanError.value).toBe(false);
      expect(result.spanStatusCode.value).toBeNull();
      expect(result.spanGrpcStatusCode.value).toBeNull();
      expect(result.spanGrpcErrorName.value).toBeNull();
      expect(result.spanGrpcErrorMessage.value).toBeNull();
      expect(result.spanErrorType.value).toBeNull();
      expect(result.spanDbResponseStatusCode.value).toBeNull();
      expect(result.spanProcessExitCode.value).toBeNull();
      expect(result.errorBannerTitle.value).toBe("Error");
      expect(result.statusCodeTitle.value).toBe("");
      expect(result.errorBannerMessage.value).toBe("");
    });
  });

  // ---------------------------------------------------------------------------
  // span_status
  // ---------------------------------------------------------------------------
  describe("hasSpanError with span_status", () => {
    it("should be true when span_status is SpanStatus.ERROR", () => {
      const span = computed(() => ({
        span_status: SpanStatus.ERROR,
      }));
      const result = useTraceDetails(span);
      expect(result.hasSpanError.value).toBe(true);
    });

    it("should be true when span_status is the string ERROR", () => {
      const span = computed(() => ({
        span_status: "ERROR",
      }));
      const result = useTraceDetails(span);
      expect(result.hasSpanError.value).toBe(true);
    });

    it("should be false when span_status is SpanStatus.OK", () => {
      const span = computed(() => ({
        span_status: SpanStatus.OK,
      }));
      const result = useTraceDetails(span);
      expect(result.hasSpanError.value).toBe(false);
    });

    it("should be false when span_status is SpanStatus.UNSET", () => {
      const span = computed(() => ({
        span_status: SpanStatus.UNSET,
      }));
      const result = useTraceDetails(span);
      expect(result.hasSpanError.value).toBe(false);
    });

    it("should be false for healthy span with no error indicators", () => {
      const span = computed(() => ({
        span_status: SpanStatus.OK,
        service_name: "my-service",
        operation_name: "my-op",
      }));
      const result = useTraceDetails(span);
      expect(result.hasSpanError.value).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // exception events
  // ---------------------------------------------------------------------------
  describe("hasSpanError with exception events", () => {
    it("should be true when span has exception events", () => {
      const span = computed(() => ({
        events: JSON.stringify([
          { name: "exception", "exception.type": "TypeError" },
        ]),
      }));
      const result = useTraceDetails(span);
      expect(result.hasSpanError.value).toBe(true);
    });

    it("should be false when events are present but none is an exception", () => {
      const span = computed(() => ({
        events: JSON.stringify([
          { name: "log", message: "some log" },
          { name: "info", message: "some info" },
        ]),
      }));
      const result = useTraceDetails(span);
      expect(result.hasSpanError.value).toBe(false);
    });

    it("should correctly filter hasExceptionEvents", () => {
      const span = computed(() => ({
        events: JSON.stringify([
          { name: "log", message: "some log" },
          { name: "exception", "exception.type": "Error" },
          { name: "exception", "exception.type": "TypeError" },
        ]),
      }));
      const result = useTraceDetails(span);
      expect(result.hasExceptionEvents.value).toHaveLength(2);
    });
  });

  // ---------------------------------------------------------------------------
  // parsedEvents (internal — tested indirectly via hasExceptionEvents)
  // ---------------------------------------------------------------------------
  describe("event parsing (indirect via hasExceptionEvents)", () => {
    it("should parse valid JSON events and find exceptions", () => {
      const span = computed(() => ({
        events: JSON.stringify([
          { name: "exception", "exception.type": "TypeError" },
          { name: "log", message: "hello" },
          { name: "exception", "exception.type": "Error" },
        ]),
      }));
      const result = useTraceDetails(span);
      expect(result.hasExceptionEvents.value).toHaveLength(2);
    });

    it("should return empty hasExceptionEvents when events is missing", () => {
      const span = computed(() => ({}));
      const result = useTraceDetails(span);
      expect(result.hasExceptionEvents.value).toEqual([]);
    });

    it("should return empty hasExceptionEvents when events is invalid JSON", () => {
      const span = computed(() => ({
        events: "not-valid-json",
      }));
      const result = useTraceDetails(span);
      expect(result.hasExceptionEvents.value).toEqual([]);
      expect(result.hasSpanError.value).toBe(false);
    });

    it("should return empty hasExceptionEvents when events is an empty string", () => {
      const span = computed(() => ({
        events: "",
      }));
      const result = useTraceDetails(span);
      expect(result.hasExceptionEvents.value).toEqual([]);
    });

    it("should parse [] string as empty array", () => {
      const span = computed(() => ({
        events: "[]",
      }));
      const result = useTraceDetails(span);
      expect(result.hasExceptionEvents.value).toEqual([]);
      expect(result.hasSpanError.value).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // HTTP status code
  // ---------------------------------------------------------------------------
  describe("spanStatusCode", () => {
    it("should return the code string when http_status_code >= 400", () => {
      const span = computed(() => ({
        http_status_code: 500,
      }));
      const result = useTraceDetails(span);
      expect(result.spanStatusCode.value).toBe("500");
    });

    it("should return the code string when http_response_status_code >= 400", () => {
      const span = computed(() => ({
        http_response_status_code: 404,
      }));
      const result = useTraceDetails(span);
      expect(result.spanStatusCode.value).toBe("404");
    });

    it("should prefer http_status_code over http_response_status_code", () => {
      const span = computed(() => ({
        http_status_code: 500,
        http_response_status_code: 404,
      }));
      const result = useTraceDetails(span);
      expect(result.spanStatusCode.value).toBe("500");
    });

    it("should return null when code < 400", () => {
      const span = computed(() => ({
        http_status_code: 200,
      }));
      const result = useTraceDetails(span);
      expect(result.spanStatusCode.value).toBeNull();
    });

    it("should return null when code is 399", () => {
      const span = computed(() => ({
        http_response_status_code: 399,
      }));
      const result = useTraceDetails(span);
      expect(result.spanStatusCode.value).toBeNull();
    });

    it("should return null when code is present but not numeric", () => {
      const span = computed(() => ({
        http_status_code: "abc",
      }));
      const result = useTraceDetails(span);
      expect(result.spanStatusCode.value).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // gRPC status code
  // ---------------------------------------------------------------------------
  describe("spanGrpcStatusCode", () => {
    it("should return null when grpc code is 0", () => {
      const span = computed(() => ({
        rpc_grpc_status_code: 0,
      }));
      const result = useTraceDetails(span);
      expect(result.spanGrpcStatusCode.value).toBeNull();
    });

    it("should return code string when grpc code is !== 0", () => {
      const span = computed(() => ({
        rpc_grpc_status_code: 14,
      }));
      const result = useTraceDetails(span);
      expect(result.spanGrpcStatusCode.value).toBe("14");
    });

    it("should read from grpc_status_code as fallback", () => {
      const span = computed(() => ({
        grpc_status_code: 5,
      }));
      const result = useTraceDetails(span);
      expect(result.spanGrpcStatusCode.value).toBe("5");
    });

    it("should prefer rpc_grpc_status_code over grpc_status_code", () => {
      const span = computed(() => ({
        rpc_grpc_status_code: 3,
        grpc_status_code: 5,
      }));
      const result = useTraceDetails(span);
      expect(result.spanGrpcStatusCode.value).toBe("3");
    });
  });

  // ---------------------------------------------------------------------------
  // gRPC error name / message
  // ---------------------------------------------------------------------------
  describe("spanGrpcErrorName and spanGrpcErrorMessage", () => {
    it("should return the grpc_error_name when present", () => {
      const span = computed(() => ({
        grpc_error_name: "PermissionDenied",
      }));
      const result = useTraceDetails(span);
      expect(result.spanGrpcErrorName.value).toBe("PermissionDenied");
    });

    it("should return null when grpc_error_name is absent", () => {
      const span = computed(() => ({}));
      const result = useTraceDetails(span);
      expect(result.spanGrpcErrorName.value).toBeNull();
    });

    it("should return the grpc_error_message when present", () => {
      const span = computed(() => ({
        grpc_error_message: "Insufficient permissions",
      }));
      const result = useTraceDetails(span);
      expect(result.spanGrpcErrorMessage.value).toBe(
        "Insufficient permissions",
      );
    });

    it("should return null when grpc_error_message is absent", () => {
      const span = computed(() => ({}));
      const result = useTraceDetails(span);
      expect(result.spanGrpcErrorMessage.value).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // error_type
  // ---------------------------------------------------------------------------
  describe("spanErrorType", () => {
    it("should return error_type when present", () => {
      const span = computed(() => ({
        error_type: "TimeoutError",
      }));
      const result = useTraceDetails(span);
      expect(result.spanErrorType.value).toBe("TimeoutError");
    });

    it("should return null when error_type is absent", () => {
      const span = computed(() => ({}));
      const result = useTraceDetails(span);
      expect(result.spanErrorType.value).toBeNull();
    });

    it("should trigger hasSpanError when error_type is present", () => {
      const span = computed(() => ({
        error_type: "TimeoutError",
      }));
      const result = useTraceDetails(span);
      expect(result.hasSpanError.value).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // db_response_status_code
  // ---------------------------------------------------------------------------
  describe("spanDbResponseStatusCode", () => {
    it("should return db_response_status_code when present", () => {
      const span = computed(() => ({
        db_response_status_code: "ERROR",
      }));
      const result = useTraceDetails(span);
      expect(result.spanDbResponseStatusCode.value).toBe("ERROR");
    });

    it("should return null when db_response_status_code is absent", () => {
      const span = computed(() => ({}));
      const result = useTraceDetails(span);
      expect(result.spanDbResponseStatusCode.value).toBeNull();
    });

    it("should trigger hasSpanError when db_response_status_code is present", () => {
      const span = computed(() => ({
        db_response_status_code: "DEADLINE_EXCEEDED",
      }));
      const result = useTraceDetails(span);
      expect(result.hasSpanError.value).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // process_exit_code
  // ---------------------------------------------------------------------------
  describe("spanProcessExitCode", () => {
    it("should return null when process_exit_code is 0", () => {
      const span = computed(() => ({
        process_exit_code: 0,
      }));
      const result = useTraceDetails(span);
      expect(result.spanProcessExitCode.value).toBeNull();
    });

    it("should return code string when process_exit_code !== 0", () => {
      const span = computed(() => ({
        process_exit_code: 1,
      }));
      const result = useTraceDetails(span);
      expect(result.spanProcessExitCode.value).toBe("1");
    });

    it("should return null when process_exit_code is absent", () => {
      const span = computed(() => ({}));
      const result = useTraceDetails(span);
      expect(result.spanProcessExitCode.value).toBeNull();
    });

    it("should trigger hasSpanError when process_exit_code !== 0", () => {
      const span = computed(() => ({
        process_exit_code: 255,
      }));
      const result = useTraceDetails(span);
      expect(result.hasSpanError.value).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // hasSpanError combined
  // ---------------------------------------------------------------------------
  describe("hasSpanError with HTTPS status code", () => {
    it("should be true when http_status_code >= 400", () => {
      const span = computed(() => ({
        http_status_code: 500,
      }));
      const result = useTraceDetails(span);
      expect(result.hasSpanError.value).toBe(true);
    });

    it("should be false when http_status_code < 400", () => {
      const span = computed(() => ({
        http_status_code: 200,
      }));
      const result = useTraceDetails(span);
      expect(result.hasSpanError.value).toBe(false);
    });

    it("should be true when http_response_status_code >= 400", () => {
      const span = computed(() => ({
        http_response_status_code: 403,
      }));
      const result = useTraceDetails(span);
      expect(result.hasSpanError.value).toBe(true);
    });
  });

  describe("hasSpanError with gRPC error indicators", () => {
    it("should be true when span has grpc_error_name (regardless of status code)", () => {
      const span = computed(() => ({
        rpc_grpc_status_code: 7,
        grpc_error_name: "PermissionDenied",
      }));
      const result = useTraceDetails(span);
      expect(result.hasSpanError.value).toBe(true);
    });

    it("should be true when span has grpc_error_message", () => {
      const span = computed(() => ({
        grpc_error_message: "Connection refused",
      }));
      const result = useTraceDetails(span);
      expect(result.hasSpanError.value).toBe(true);
    });

    it("should be false when grpc status code is present but no error name/message", () => {
      const span = computed(() => ({
        rpc_grpc_status_code: 14,
      }));
      const result = useTraceDetails(span);
      // hasSpanError only checks grpc_error_name/grpc_error_message, not spanGrpcStatusCode
      expect(result.hasSpanError.value).toBe(false);
    });
  });

  describe("hasSpanError with multiple error conditions", () => {
    it("should be true when span has gRPC error name but no code", () => {
      const span = computed(() => ({
        grpc_error_name: "Internal",
      }));
      const result = useTraceDetails(span);
      expect(result.hasSpanError.value).toBe(true);
    });

    it("should be true when span has gRPC error message but no code", () => {
      const span = computed(() => ({
        grpc_error_message: "Internal error occurred",
      }));
      const result = useTraceDetails(span);
      expect(result.hasSpanError.value).toBe(true);
    });

    it("should be true when span has multiple simultaneous error indicators", () => {
      const span = computed(() => ({
        span_status: SpanStatus.ERROR,
        http_status_code: 500,
        rpc_grpc_status_code: 13,
        error_type: "InternalError",
        db_response_status_code: "ERROR",
        process_exit_code: 1,
        grpc_error_name: "Internal",
        grpc_error_message: "Server error",
      }));
      const result = useTraceDetails(span);
      expect(result.hasSpanError.value).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // errorBannerTitle
  // ---------------------------------------------------------------------------
  describe("errorBannerTitle", () => {
    it("should return exception.type from first exception event", () => {
      const span = computed(() => ({
        events: JSON.stringify([
          { name: "exception", "exception.type": "TypeError", "exception.message": "x is not a function" },
        ]),
      }));
      const result = useTraceDetails(span);
      expect(result.errorBannerTitle.value).toBe("TypeError");
    });

    it("should return Exception when exception event has no exception.type", () => {
      const span = computed(() => ({
        events: JSON.stringify([
          { name: "exception", "exception.message": "something broke" },
        ]),
      }));
      const result = useTraceDetails(span);
      expect(result.errorBannerTitle.value).toBe("Exception");
    });

    it("should fall back to error_type when no exception events", () => {
      const span = computed(() => ({
        error_type: "TimeoutError",
      }));
      const result = useTraceDetails(span);
      expect(result.errorBannerTitle.value).toBe("TimeoutError");
    });

    it("should fall back to grpc_error_name when no exception events or error_type", () => {
      const span = computed(() => ({
        grpc_error_name: "PermissionDenied",
      }));
      const result = useTraceDetails(span);
      expect(result.errorBannerTitle.value).toBe("PermissionDenied");
    });

    it("should fall back to Error when no error indicators are present", () => {
      const span = computed(() => ({}));
      const result = useTraceDetails(span);
      expect(result.errorBannerTitle.value).toBe("Error");
    });

    it("should prefer exception.type over all other error fields", () => {
      const span = computed(() => ({
        events: JSON.stringify([
          { name: "exception", "exception.type": "TypeError" },
        ]),
        error_type: "InternalError",
        grpc_error_name: "PermissionDenied",
      }));
      const result = useTraceDetails(span);
      expect(result.errorBannerTitle.value).toBe("TypeError");
    });
  });

  // ---------------------------------------------------------------------------
  // statusCodeTitle
  // ---------------------------------------------------------------------------
  describe("statusCodeTitle", () => {
    it("should return gRPC status name for known grpc codes", () => {
      const span = computed(() => ({
        rpc_grpc_status_code: 14,
      }));
      const result = useTraceDetails(span);
      expect(result.statusCodeTitle.value).toBe("Unavailable");
    });

    it("should return gRPC Unknown for code 2", () => {
      const span = computed(() => ({
        rpc_grpc_status_code: 2,
      }));
      const result = useTraceDetails(span);
      expect(result.statusCodeTitle.value).toBe("Unknown");
    });

    it("should return HTTP status name for known HTTP codes", () => {
      const span = computed(() => ({
        http_status_code: 404,
      }));
      const result = useTraceDetails(span);
      expect(result.statusCodeTitle.value).toBe("Not Found");
    });

    it("should return Internal Server Error for HTTP 500", () => {
      const span = computed(() => ({
        http_response_status_code: 500,
      }));
      const result = useTraceDetails(span);
      expect(result.statusCodeTitle.value).toBe("Internal Server Error");
    });

    it("should return fallback string for unknown grpc codes", () => {
      const span = computed(() => ({
        rpc_grpc_status_code: 99,
      }));
      const result = useTraceDetails(span);
      expect(result.statusCodeTitle.value).toBe("gRPC 99");
    });

    it("should return fallback string for unknown HTTP codes", () => {
      const span = computed(() => ({
        http_status_code: 418,
      }));
      const result = useTraceDetails(span);
      expect(result.statusCodeTitle.value).toBe("HTTP 418");
    });

    it("should prefer gRPC status title over HTTP when both are present", () => {
      const span = computed(() => ({
        rpc_grpc_status_code: 5,
        http_status_code: 404,
      }));
      const result = useTraceDetails(span);
      expect(result.statusCodeTitle.value).toBe("Not Found");
    });

    it("should return HTTP title when only HTTP code is present", () => {
      const span = computed(() => ({
        http_status_code: 403,
      }));
      const result = useTraceDetails(span);
      expect(result.statusCodeTitle.value).toBe("Forbidden");
    });

    it("should return empty string when no status codes are present", () => {
      const span = computed(() => ({}));
      const result = useTraceDetails(span);
      expect(result.statusCodeTitle.value).toBe("");
    });

    it("should return empty string when grpc code is 0 and no HTTP code", () => {
      const span = computed(() => ({
        rpc_grpc_status_code: 0,
      }));
      const result = useTraceDetails(span);
      expect(result.statusCodeTitle.value).toBe("");
    });
  });

  // ---------------------------------------------------------------------------
  // errorBannerMessage
  // ---------------------------------------------------------------------------
  describe("errorBannerMessage", () => {
    it("should return exception.message from first exception event", () => {
      const span = computed(() => ({
        events: JSON.stringify([
          { name: "exception", "exception.type": "TypeError", "exception.message": "x is not a function" },
        ]),
      }));
      const result = useTraceDetails(span);
      expect(result.errorBannerMessage.value).toBe("x is not a function");
    });

    it("should return empty string when exception event has no message", () => {
      const span = computed(() => ({
        events: JSON.stringify([
          { name: "exception", "exception.type": "TypeError" },
        ]),
      }));
      const result = useTraceDetails(span);
      expect(result.errorBannerMessage.value).toBe("");
    });

    it("should fall back to status_message when no exception events", () => {
      const span = computed(() => ({
        status_message: "Request timed out",
      }));
      const result = useTraceDetails(span);
      expect(result.errorBannerMessage.value).toBe("Request timed out");
    });

    it("should fall back to grpc_error_message when no exception events or status_message", () => {
      const span = computed(() => ({
        grpc_error_message: "Connection refused",
      }));
      const result = useTraceDetails(span);
      expect(result.errorBannerMessage.value).toBe("Connection refused");
    });

    it("should return empty string when no message sources are present", () => {
      const span = computed(() => ({}));
      const result = useTraceDetails(span);
      expect(result.errorBannerMessage.value).toBe("");
    });

    it("should prefer exception.message over status_message and grpc_error_message", () => {
      const span = computed(() => ({
        events: JSON.stringify([
          { name: "exception", "exception.message": "exception text" },
        ]),
        status_message: "status text",
        grpc_error_message: "grpc text",
      }));
      const result = useTraceDetails(span);
      expect(result.errorBannerMessage.value).toBe("exception text");
    });

    it("should prefer status_message over grpc_error_message when no exception events", () => {
      const span = computed(() => ({
        status_message: "status text",
        grpc_error_message: "grpc text",
      }));
      const result = useTraceDetails(span);
      expect(result.errorBannerMessage.value).toBe("status text");
    });
  });

  // ---------------------------------------------------------------------------
  // ref vs computed input
  // ---------------------------------------------------------------------------
  describe("works with both ref and computed inputs", () => {
    it("should work with a Ref input", () => {
      const span = ref({
        span_status: SpanStatus.ERROR,
        http_status_code: 500,
      });
      const result = useTraceDetails(span);

      expect(result.hasSpanError.value).toBe(true);
      expect(result.spanStatusCode.value).toBe("500");
    });

    it("should work with a ComputedRef input", () => {
      const base = ref({
        span_status: SpanStatus.OK,
        http_status_code: 200,
      });
      const span = computed(() => base.value);
      const result = useTraceDetails(span);

      expect(result.hasSpanError.value).toBe(false);
      expect(result.spanStatusCode.value).toBeNull();

      // update the underlying ref
      base.value = {
        span_status: SpanStatus.ERROR,
        http_status_code: 500,
      };
      expect(result.hasSpanError.value).toBe(true);
      expect(result.spanStatusCode.value).toBe("500");
    });
  });

  // ---------------------------------------------------------------------------
  // numeric string handling
  // ---------------------------------------------------------------------------
  describe("handles numeric strings in status code fields", () => {
    it("should parse string http_status_code >= 400", () => {
      const span = computed(() => ({
        http_status_code: "500",
      }));
      const result = useTraceDetails(span);
      expect(result.spanStatusCode.value).toBe("500");
    });

    it("should parse string grpc status code", () => {
      const span = computed(() => ({
        rpc_grpc_status_code: "7",
      }));
      const result = useTraceDetails(span);
      expect(result.spanGrpcStatusCode.value).toBe("7");
    });

    it("should parse string process_exit_code", () => {
      const span = computed(() => ({
        process_exit_code: "1",
      }));
      const result = useTraceDetails(span);
      expect(result.spanProcessExitCode.value).toBe("1");
    });
  });

  // ---------------------------------------------------------------------------
  // boundary: exactly 400
  // ---------------------------------------------------------------------------
  describe("HTTP status code boundary at 400", () => {
    it("should treat exactly 400 as an error", () => {
      const span = computed(() => ({
        http_status_code: 400,
      }));
      const result = useTraceDetails(span);
      expect(result.spanStatusCode.value).toBe("400");
      expect(result.hasSpanError.value).toBe(true);
      expect(result.statusCodeTitle.value).toBe("Bad Request");
    });

    it("should treat 399 as non-error", () => {
      const span = computed(() => ({
        http_status_code: 399,
      }));
      const result = useTraceDetails(span);
      expect(result.spanStatusCode.value).toBeNull();
      expect(result.hasSpanError.value).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // boundary: grpc status code exactly 1 (first non-zero)
  // ---------------------------------------------------------------------------
  describe("gRPC status code boundary at 1", () => {
    it("should expose spanGrpcStatusCode for code 1", () => {
      const span = computed(() => ({
        rpc_grpc_status_code: 1,
      }));
      const result = useTraceDetails(span);
      expect(result.spanGrpcStatusCode.value).toBe("1");
      expect(result.statusCodeTitle.value).toBe("Cancelled");
    });

    it("should expose spanGrpcStatusCode as null for code 0", () => {
      const span = computed(() => ({
        rpc_grpc_status_code: 0,
      }));
      const result = useTraceDetails(span);
      expect(result.spanGrpcStatusCode.value).toBeNull();
      expect(result.hasSpanError.value).toBe(false);
    });

    it("should trigger hasSpanError when grpc error name is present alongside code", () => {
      const span = computed(() => ({
        rpc_grpc_status_code: 1,
        grpc_error_name: "Cancelled",
      }));
      const result = useTraceDetails(span);
      expect(result.spanGrpcStatusCode.value).toBe("1");
      expect(result.hasSpanError.value).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // empty events string "[]"
  // ---------------------------------------------------------------------------
  describe("empty events array string", () => {
    it("should treat [] as empty events", () => {
      const span = computed(() => ({
        events: "[]",
      }));
      const result = useTraceDetails(span);
      expect(result.hasExceptionEvents.value).toEqual([]);
      expect(result.hasSpanError.value).toBe(false);
    });
  });
});
