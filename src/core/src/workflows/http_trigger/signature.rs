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

//! Standard Webhooks `v1` signatures, over the body for an invoke and over `GET {path}` for a poll.

use base64::{Engine, prelude::BASE64_STANDARD};
use config::utils::str::constant_time_eq;
use hmac::{Hmac, Mac};
use sha2::Sha256;

use super::credentials::SECRET_PREFIX;

pub const TOLERANCE_SECS: i64 = 300;
pub const DUMMY_HMAC_MAX_BYTES: usize = 64 * 1024;
pub const MAX_WEBHOOK_ID_LEN: usize = 255;
const POLL_PREFIX: &[u8] = b"GET /";
const DUMMY_KEY: &[u8] = b"workflow-hook-dummy-key";

static DUMMY_BODY: [u8; DUMMY_HMAC_MAX_BYTES] = [0; DUMMY_HMAC_MAX_BYTES];

#[derive(Clone, Copy, Debug)]
pub struct WebhookHeaders<'a> {
    pub id: &'a str,
    pub timestamp: &'a str,
    pub signature: &'a str,
}

#[derive(Clone, Copy, Debug)]
pub enum SignedContent<'a> {
    Invoke(&'a [u8]),
    Poll(&'a str),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SigError {
    Missing,
    Malformed,
    StaleTimestamp,
    Mismatch,
}

pub fn decode_secret(secret: &str) -> Option<Vec<u8>> {
    let encoded = secret.strip_prefix(SECRET_PREFIX).unwrap_or(secret);
    BASE64_STANDARD
        .decode(encoded)
        .ok()
        .filter(|key| !key.is_empty())
}

pub fn sign(key: &[u8], id: &str, timestamp: i64, content: SignedContent<'_>) -> String {
    let mac = hmac(key, &signed_bytes(id, &timestamp.to_string(), content));
    format!("v1,{}", BASE64_STANDARD.encode(mac))
}

pub fn verify(
    headers: &WebhookHeaders<'_>,
    content: SignedContent<'_>,
    keys: &[&[u8]],
    now_secs: i64,
) -> Result<(), SigError> {
    if headers.id.is_empty() || headers.timestamp.is_empty() || headers.signature.is_empty() {
        return Err(SigError::Missing);
    }
    if headers.id.len() > MAX_WEBHOOK_ID_LEN || !headers.id.bytes().all(is_printable_ascii) {
        return Err(SigError::Malformed);
    }
    let timestamp: i64 = headers.timestamp.parse().map_err(|_| SigError::Malformed)?;
    if now_secs.abs_diff(timestamp) > TOLERANCE_SECS.unsigned_abs() {
        return Err(SigError::StaleTimestamp);
    }
    // Poll content is `GET {path}`; an invoke body spelling it would reuse a poll signature.
    if let SignedContent::Invoke(body) = content
        && body.starts_with(POLL_PREFIX)
    {
        return Err(SigError::Mismatch);
    }
    let presented = parse_v1_signatures(headers.signature);
    let message = signed_bytes(headers.id, headers.timestamp, content);
    let mut matched = false;
    for key in keys {
        let expected = hmac(key, &message);
        for candidate in &presented {
            matched |= constant_time_eq(&expected, candidate);
        }
    }
    if matched {
        Ok(())
    } else {
        Err(SigError::Mismatch)
    }
}

/// HMACs zeros as long as the declared body, so a miss never waits on a body that may not come.
pub fn dummy_verify(declared_len: usize) {
    let len = declared_len.min(DUMMY_HMAC_MAX_BYTES);
    std::hint::black_box(hmac(DUMMY_KEY, &DUMMY_BODY[..len]));
}

pub fn is_printable_ascii(byte: u8) -> bool {
    byte == b' ' || byte.is_ascii_graphic()
}

fn signed_bytes(id: &str, timestamp: &str, content: SignedContent<'_>) -> Vec<u8> {
    let mut bytes = format!("{id}.{timestamp}.").into_bytes();
    match content {
        SignedContent::Invoke(body) => bytes.extend_from_slice(body),
        SignedContent::Poll(path) => {
            bytes.extend_from_slice(b"GET ");
            bytes.extend_from_slice(path.as_bytes());
        }
    }
    bytes
}

fn parse_v1_signatures(header: &str) -> Vec<Vec<u8>> {
    header
        .split(' ')
        .filter_map(|entry| entry.strip_prefix("v1,"))
        .filter_map(|encoded| BASE64_STANDARD.decode(encoded).ok())
        .collect()
}

fn hmac(key: &[u8], message: &[u8]) -> Vec<u8> {
    let mut mac = <Hmac<Sha256>>::new_from_slice(key).expect("HMAC accepts any key length");
    mac.update(message);
    mac.finalize().into_bytes().to_vec()
}

#[cfg(test)]
mod tests {
    use super::*;

    const VECTOR_SECRET: &str = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";
    const VECTOR_ID: &str = "msg_p5jXN8AQM9LWM0D4loKWxJek";
    const VECTOR_TS: i64 = 1614265330;
    const VECTOR_BODY: &[u8] = br#"{"test": 2432232314}"#;
    const VECTOR_SIGNATURE: &str = "v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=";
    const POLL_PATH: &str = "/api/v2/acme/workflows/hooks/t1/runs/r1";

    fn headers<'a>(id: &'a str, ts: &'a str, signature: &'a str) -> WebhookHeaders<'a> {
        WebhookHeaders {
            id,
            timestamp: ts,
            signature,
        }
    }

    #[test]
    fn the_standard_webhooks_test_vector_verifies() {
        let key = decode_secret(VECTOR_SECRET).unwrap();
        assert_eq!(
            sign(
                &key,
                VECTOR_ID,
                VECTOR_TS,
                SignedContent::Invoke(VECTOR_BODY)
            ),
            VECTOR_SIGNATURE
        );
        let ts = VECTOR_TS.to_string();
        assert_eq!(
            verify(
                &headers(VECTOR_ID, &ts, VECTOR_SIGNATURE),
                SignedContent::Invoke(VECTOR_BODY),
                &[&key],
                VECTOR_TS + 10,
            ),
            Ok(())
        );
        assert_eq!(
            verify(
                &headers(VECTOR_ID, &ts, VECTOR_SIGNATURE),
                SignedContent::Invoke(b"{\"test\": 1}"),
                &[&key],
                VECTOR_TS,
            ),
            Err(SigError::Mismatch)
        );
    }

    #[test]
    fn a_timestamp_301_seconds_old_is_stale() {
        let key = decode_secret(VECTOR_SECRET).unwrap();
        let ts = VECTOR_TS.to_string();
        let h = headers(VECTOR_ID, &ts, VECTOR_SIGNATURE);
        let body = SignedContent::Invoke(VECTOR_BODY);
        assert_eq!(verify(&h, body, &[&key], VECTOR_TS + 300), Ok(()));
        assert_eq!(
            verify(&h, body, &[&key], VECTOR_TS + 301),
            Err(SigError::StaleTimestamp)
        );
        assert_eq!(
            verify(&h, body, &[&key], VECTOR_TS - 301),
            Err(SigError::StaleTimestamp)
        );
        assert_eq!(
            verify(
                &headers(VECTOR_ID, "soon", VECTOR_SIGNATURE),
                body,
                &[&key],
                VECTOR_TS
            ),
            Err(SigError::Malformed)
        );
    }

    #[test]
    fn any_matching_v1_entry_is_enough() {
        let key = decode_secret(VECTOR_SECRET).unwrap();
        let other = decode_secret("whsec_b3RoZXItc2VjcmV0LW9mLXRoaXJ0eS10d28tYnl0").unwrap();
        let ts = VECTOR_TS.to_string();
        let several = format!("v1,AAAA {VECTOR_SIGNATURE} v1,BBBB");
        let body = SignedContent::Invoke(VECTOR_BODY);
        assert_eq!(
            verify(&headers(VECTOR_ID, &ts, &several), body, &[&key], VECTOR_TS),
            Ok(())
        );
        assert_eq!(
            verify(
                &headers(VECTOR_ID, &ts, VECTOR_SIGNATURE),
                body,
                &[&other, &key],
                VECTOR_TS
            ),
            Ok(()),
            "any live secret may match"
        );
        assert_eq!(
            verify(
                &headers(VECTOR_ID, &ts, VECTOR_SIGNATURE),
                body,
                &[&other],
                VECTOR_TS
            ),
            Err(SigError::Mismatch)
        );
    }

    #[test]
    fn a_v1a_entry_is_ignored() {
        let key = decode_secret(VECTOR_SECRET).unwrap();
        let ts = VECTOR_TS.to_string();
        let v1a = VECTOR_SIGNATURE.replacen("v1,", "v1a,", 1);
        assert_eq!(
            verify(
                &headers(VECTOR_ID, &ts, &v1a),
                SignedContent::Invoke(VECTOR_BODY),
                &[&key],
                VECTOR_TS
            ),
            Err(SigError::Mismatch)
        );
    }

    #[test]
    fn missing_or_oversized_headers_are_refused() {
        let key = decode_secret(VECTOR_SECRET).unwrap();
        let ts = VECTOR_TS.to_string();
        let body = SignedContent::Invoke(VECTOR_BODY);
        assert_eq!(
            verify(
                &headers("", &ts, VECTOR_SIGNATURE),
                body,
                &[&key],
                VECTOR_TS
            ),
            Err(SigError::Missing)
        );
        assert_eq!(
            verify(&headers(VECTOR_ID, &ts, ""), body, &[&key], VECTOR_TS),
            Err(SigError::Missing)
        );
        let long_id = "m".repeat(MAX_WEBHOOK_ID_LEN + 1);
        assert_eq!(
            verify(
                &headers(&long_id, &ts, VECTOR_SIGNATURE),
                body,
                &[&key],
                VECTOR_TS
            ),
            Err(SigError::Malformed)
        );
        assert_eq!(decode_secret("whsec_***"), None);
    }

    #[test]
    fn a_poll_signature_never_verifies_an_invoke() {
        let key = decode_secret(VECTOR_SECRET).unwrap();
        let ts = VECTOR_TS.to_string();
        let poll = sign(&key, VECTOR_ID, VECTOR_TS, SignedContent::Poll(POLL_PATH));
        let h = headers(VECTOR_ID, &ts, &poll);
        assert_eq!(
            verify(&h, SignedContent::Poll(POLL_PATH), &[&key], VECTOR_TS),
            Ok(())
        );
        let same_bytes = format!("GET {POLL_PATH}");
        assert_eq!(
            verify(
                &h,
                SignedContent::Invoke(same_bytes.as_bytes()),
                &[&key],
                VECTOR_TS
            ),
            Err(SigError::Mismatch),
            "a body spelling the poll content must not borrow a poll signature"
        );
        assert_eq!(
            verify(&h, SignedContent::Invoke(VECTOR_BODY), &[&key], VECTOR_TS),
            Err(SigError::Mismatch)
        );
        let invoke = sign(
            &key,
            VECTOR_ID,
            VECTOR_TS,
            SignedContent::Invoke(VECTOR_BODY),
        );
        assert_eq!(
            verify(
                &headers(VECTOR_ID, &ts, &invoke),
                SignedContent::Poll(POLL_PATH),
                &[&key],
                VECTOR_TS
            ),
            Err(SigError::Mismatch)
        );
    }

    #[test]
    fn an_extreme_timestamp_is_stale_not_an_overflow() {
        let key = decode_secret(VECTOR_SECRET).unwrap();
        let body = SignedContent::Invoke(VECTOR_BODY);
        for ts in [i64::MIN.to_string(), i64::MAX.to_string()] {
            assert_eq!(
                verify(
                    &headers(VECTOR_ID, &ts, VECTOR_SIGNATURE),
                    body,
                    &[&key],
                    VECTOR_TS
                ),
                Err(SigError::StaleTimestamp),
                "{ts}"
            );
        }
        let ts = VECTOR_TS.to_string();
        let h = headers(VECTOR_ID, &ts, VECTOR_SIGNATURE);
        for now in [i64::MIN, i64::MAX] {
            assert_eq!(
                verify(&h, body, &[&key], now),
                Err(SigError::StaleTimestamp),
                "{now}"
            );
        }
    }

    #[test]
    fn dummy_hmac_reads_at_most_64_kib() {
        dummy_verify(DUMMY_HMAC_MAX_BYTES * 2);
        dummy_verify(0);
    }

    #[test]
    fn signed_bytes_follow_the_spec_layout() {
        assert_eq!(
            signed_bytes("id", "5", SignedContent::Invoke(b"{}")),
            b"id.5.{}".to_vec()
        );
        assert_eq!(
            signed_bytes("id", "5", SignedContent::Poll("/p")),
            b"id.5.GET /p".to_vec()
        );
        assert_eq!(parse_v1_signatures("v1,AAAA v2,BBBB v1,!!").len(), 1);
    }
}
