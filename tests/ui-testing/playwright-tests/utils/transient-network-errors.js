/**
 * Which low-level fetch failures are worth retrying.
 *
 * Everything here describes a connection that never carried a request to
 * completion — retrying is the correct response, not a way of hiding a failure.
 * A genuinely broken endpoint still fails after the caller's retry budget.
 *
 * The connection-refused / timed-out / DNS entries matter specifically for the
 * alpha1 cloud suite: since the shard matrix started running in parallel, the
 * ingress intermittently refuses or drops connections during the opening burst
 * when a dozen shards ingest at once. `connect ECONNREFUSED` was previously
 * classified as non-transient, so a single refused TCP connect hard-failed the
 * test on its first attempt (seen on Pipelines in run 30447620921).
 */
const TRANSIENT_NETWORK_ERROR =
  /premature close|ECONNRESET|ECONNREFUSED|ECONNABORTED|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|ENETDOWN|EAI_AGAIN|ENOTFOUND|EPIPE|socket hang up|socket disconnected|other side closed|network|fetch failed|terminated/i;

module.exports = { TRANSIENT_NETWORK_ERROR };
