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

/**
 * One reader for the several shapes a failed search comes back in.
 *
 * A search can fail through three different transports, and each wraps the same
 * backend error differently:
 *
 *   axios      error.response.data  { error, message, code, trace_id, error_detail }
 *   streaming  err.content          { message, error, code, trace_id }
 *   thrown     Error                { message }
 *
 * On top of that the backend often hands back its internal envelope rather than
 * a sentence:
 *
 *   Error during planning: ErrorCode# {"code":20010,"message":"Search query
 *   timed out","inner":"[PromQL] grpc search load data task timeout"}
 *
 * Shown raw, that is what the user reads on a broken panel. The sentence they
 * actually need — "Search query timed out" — is buried in the middle of it, and
 * the `trace_id` that support asks for first is dropped on the floor entirely.
 * This unwraps the envelope and keeps the trace id.
 */

/** The backend's internal error envelope, embedded in an otherwise plain string. */
const ERROR_CODE_MARKER = "ErrorCode#";

/** Long enough for any real message; short enough not to fill the screen. */
const MAX_MESSAGE_LENGTH = 300;

export interface SearchError {
  /** A sentence fit to show a user. Never empty. */
  message: string;
  /** The backend's error code, when it gave one (`20010`) or the HTTP status. */
  code?: number;
  /** The internal cause. Useful to an engineer, noise to everyone else. */
  detail?: string;
  /** Correlates with the backend logs — the first thing support asks for. */
  traceId?: string;
}

const str = (value: any): string => (typeof value === "string" && value.trim() ? value.trim() : "");

const truncate = (message: string): string =>
  message.length > MAX_MESSAGE_LENGTH ? `${message.slice(0, MAX_MESSAGE_LENGTH)} …` : message;

/**
 * Pulls the sentence out of an `ErrorCode# {...}` envelope, or `null` when the
 * string is not one (already a plain message, or malformed JSON — in which case
 * the raw string is still better than nothing).
 */
function unwrapErrorCode(raw: string): Omit<SearchError, "traceId"> | null {
  const marker = raw.indexOf(ERROR_CODE_MARKER);
  if (marker === -1) return null;

  const open = raw.indexOf("{", marker);
  const close = raw.lastIndexOf("}");
  if (open === -1 || close <= open) return null;

  let parsed: any;
  try {
    parsed = JSON.parse(raw.slice(open, close + 1));
  } catch {
    return null;
  }

  const message = str(parsed?.message);
  if (!message) return null;

  return {
    message,
    code: typeof parsed?.code === "number" ? parsed.code : undefined,
    detail: str(parsed?.inner) || undefined,
  };
}

/**
 * Normalises anything a failed search throws into something displayable.
 *
 * Never throws and never returns an empty message: a card or panel that failed
 * has to say *something*, and "" would render as a blank tooltip that looks like
 * a second bug.
 */
export function parseSearchError(error: any, fallback = "Query failed"): SearchError {
  // Already normalised upstream (the streaming path parses at the point of
  // failure, where the payload is still intact) — do not re-derive it.
  if (error?.searchError) return error.searchError as SearchError;

  if (typeof error === "string") {
    const unwrapped = unwrapErrorCode(error);
    return {
      message: truncate(unwrapped?.message || error || fallback),
      code: unwrapped?.code,
      detail: unwrapped?.detail,
    };
  }

  const body = error?.response?.data ?? error?.content ?? error ?? {};

  // A plain-text body arrives as a STRING, not an envelope — a `text/plain`
  // response, or a proxy's error page in front of us. `body.error` and
  // `body.message` are then both undefined, and the only thing left to show is
  // axios's own "Request failed with status code 500", which tells the user
  // nothing they could act on while the server's actual explanation is sitting
  // right there in the body. When the body IS the message, use it.
  const bodyText = typeof body === "string" ? body : "";

  // `error` first: on a PromQL failure that is the field carrying the envelope,
  // while `message` is often just the HTTP-level "Request failed with status…".
  const raw = str(body.error) || str(body.message) || bodyText || str(error?.message);
  const unwrapped = unwrapErrorCode(raw);

  const httpStatus = error?.response?.status ?? error?.status;
  const code =
    unwrapped?.code ??
    (typeof body.code === "number" ? body.code : undefined) ??
    (typeof httpStatus === "number" ? httpStatus : undefined);

  return {
    message: truncate(unwrapped?.message || raw || fallback),
    code,
    detail: unwrapped?.detail ?? (str(body.error_detail) || undefined),
    traceId: str(body.trace_id) || str(error?.trace_id) || undefined,
  };
}

/**
 * Attaches a parsed error to an `Error` so it survives a `reject()` without the
 * original payload having to be re-plumbed through every catch on the way up.
 */
export function toSearchErrorObject(parsed: SearchError): Error {
  return Object.assign(new Error(parsed.message), { searchError: parsed });
}
