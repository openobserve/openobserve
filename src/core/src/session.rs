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

use base64::Engine;
use sha2::{Digest, Sha256};

use super::db;

/// A sign-out follows at most this many refreshes made from one session during its grace.
const MAX_SUCCESSOR_HOPS: usize = 16;

pub async fn get_session(session_id: &str) -> Option<String> {
    db::session::get(session_id).await.ok()
}

/// Extracts JWT expiry time from a Bearer token
/// Returns expiry time in microseconds since epoch
/// If extraction fails, returns a default expiry of 24 hours from now
fn extract_jwt_expiry(access_token: &str) -> i64 {
    // Default to 24 hours from now if we can't parse the token
    let default_expiry = chrono::Utc::now().timestamp_micros() + (24 * 60 * 60 * 1_000_000);

    // JWT tokens are in format: header.payload.signature
    let parts: Vec<&str> = access_token.split('.').collect();
    if parts.len() != 3 {
        log::warn!("Invalid JWT token format, using default expiry");
        return default_expiry;
    }

    // Decode the payload (second part)
    // Use URL_SAFE to support both padded and unpadded JWT payloads
    let payload = match base64::engine::general_purpose::URL_SAFE.decode(parts[1]) {
        Ok(data) => data,
        Err(e) => {
            log::warn!("Failed to decode JWT payload: {}, using default expiry", e);
            return default_expiry;
        }
    };

    // Parse JSON to extract 'exp' claim
    let payload_str = match std::str::from_utf8(&payload) {
        Ok(s) => s,
        Err(e) => {
            log::warn!("Invalid UTF-8 in JWT payload: {}, using default expiry", e);
            return default_expiry;
        }
    };

    let payload_json: serde_json::Value = match serde_json::from_str(payload_str) {
        Ok(json) => json,
        Err(e) => {
            log::warn!(
                "Failed to parse JWT payload JSON: {}, using default expiry",
                e
            );
            return default_expiry;
        }
    };

    // Extract 'exp' claim (in seconds) and convert to microseconds
    match payload_json.get("exp").and_then(|v| v.as_i64()) {
        Some(exp_seconds) => exp_seconds * 1_000_000, // Convert seconds to microseconds
        None => {
            log::warn!("No 'exp' claim in JWT token, using default expiry");
            default_expiry
        }
    }
}

pub async fn set_session(session_id: &str, val: &str) -> Option<()> {
    let expires_at = extract_jwt_expiry(val);
    match db::session::set_with_expiry(session_id, val, expires_at).await {
        Ok(()) => Some(()),
        Err(e) => {
            log::error!("Failed to write session {} to database: {}", session_id, e);
            None
        }
    }
}

pub async fn remove_session(session_id: &str) {
    let _ = db::session::delete(session_id).await;
}

/// Keeps a rotated session valid for at most `grace_micros` more, never past its own token's
/// expiry, and records `successor` so a sign-out with the old cookie also ends the new session.
pub async fn retire_session(session_id: &str, val: &str, successor: &str, grace_micros: i64) {
    let expires_at = retired_expiry(val, chrono::Utc::now().timestamp_micros(), grace_micros);
    let key = successors_key(session_id);
    let known = db::session::get(&key).await.ok();
    let successors = with_successor(known.as_deref(), successor);
    if let Err(e) = db::session::set_with_expiry(&key, &successors, expires_at).await {
        log::error!("Failed to record the successor of rotated session {session_id}: {e}");
    }
    if let Err(e) = db::session::set_with_expiry(session_id, val, expires_at).await {
        log::error!("Failed to shorten rotated session {session_id}: {e}");
    }
}

/// Removes a signed-out session and every session refreshed from it while it was in its grace.
pub async fn remove_session_and_successors(session_id: &str) {
    let mut pending = vec![session_id.to_string()];
    let mut hops = 0;
    while let Some(id) = pending.pop() {
        let key = successors_key(&id);
        if let Ok(successors) = db::session::get(&key).await {
            let _ = db::session::delete(&key).await;
            hops += 1;
            if hops <= MAX_SUCCESSOR_HOPS {
                pending.extend(successors.split_whitespace().map(str::to_string));
            }
        }
        remove_session(&id).await;
    }
}

fn retired_expiry(val: &str, now: i64, grace_micros: i64) -> i64 {
    extract_jwt_expiry(val).min(now + grace_micros)
}

/// The sessions table keys rows by 36 characters, and a token can never resolve from this one.
fn successors_key(session_id: &str) -> String {
    let digest = Sha256::digest(format!("session-successors:{session_id}").as_bytes());
    let hex: String = digest.iter().map(|b| format!("{b:02x}")).collect();
    hex[..36].to_string()
}

fn with_successor(known: Option<&str>, successor: &str) -> String {
    let mut ids: Vec<&str> = known.unwrap_or_default().split_whitespace().collect();
    if !ids.contains(&successor) {
        ids.push(successor);
    }
    ids.join(" ")
}

#[cfg(test)]
mod tests {
    use base64::Engine;

    use super::*;

    fn create_jwt_token(exp_seconds: i64) -> String {
        let header = r#"{"alg":"HS256","typ":"JWT"}"#;
        let payload = format!(r#"{{"sub":"test","exp":{}}}"#, exp_seconds);

        // Use URL_SAFE to match what extract_jwt_expiry expects
        let header_b64 = base64::engine::general_purpose::URL_SAFE.encode(header);
        let payload_b64 = base64::engine::general_purpose::URL_SAFE.encode(payload);

        format!("{}.{}.fake_signature", header_b64, payload_b64)
    }

    #[test]
    fn test_a_retired_session_keeps_every_successor_once() {
        assert_eq!(with_successor(None, "b"), "b");
        assert_eq!(with_successor(Some("b"), "c"), "b c");
        assert_eq!(with_successor(Some("b c"), "b"), "b c");
        let key = successors_key("0199e7b2-6f0c-7a3e-a1b2-c3d4e5f6aaaa");
        assert_eq!(key.len(), 36);
        assert_ne!(key, successors_key("0199e7b2-6f0c-7a3e-a1b2-c3d4e5f6bbbb"));
    }

    #[test]
    fn test_retired_session_ends_at_the_grace_or_its_token_expiry() {
        let now = chrono::Utc::now().timestamp_micros();
        let late = create_jwt_token(now / 1_000_000 + 3600);
        assert_eq!(retired_expiry(&late, now, 60_000_000), now + 60_000_000);
        let soon = create_jwt_token(now / 1_000_000 + 10);
        assert_eq!(
            retired_expiry(&soon, now, 60_000_000),
            (now / 1_000_000 + 10) * 1_000_000
        );
    }

    #[test]
    fn test_extract_jwt_expiry_valid_token() {
        // Create a token that expires in 1 hour (3600 seconds from now)
        let future_exp_seconds = chrono::Utc::now().timestamp() + 3600;
        let token = create_jwt_token(future_exp_seconds);

        let expiry_micros = extract_jwt_expiry(&token);
        let expected_micros = future_exp_seconds * 1_000_000;

        // Should extract the expiry time correctly (within 1 second tolerance for test execution
        // time)
        let diff = (expiry_micros - expected_micros).abs();
        assert!(
            diff < 1_000_000,
            "Expiry should match within 1 second: got {}, expected {}",
            expiry_micros,
            expected_micros
        );
    }

    #[test]
    fn test_extract_jwt_expiry_expired_token() {
        // Create a token that expired 1 hour ago
        let past_exp = chrono::Utc::now().timestamp() - 3600;
        let token = create_jwt_token(past_exp);

        let expiry = extract_jwt_expiry(&token);
        let expected_micros = past_exp * 1_000_000;

        // Should still extract the expiry time (validation happens elsewhere)
        assert_eq!(expiry, expected_micros);
    }

    #[test]
    fn test_extract_jwt_expiry_invalid_format() {
        let token = "not.a.valid.jwt.token";
        let before = chrono::Utc::now().timestamp_micros();
        let expiry = extract_jwt_expiry(token);
        let after = chrono::Utc::now().timestamp_micros();

        // Should return default expiry (24 hours from now)
        let expected_min = before + (23 * 60 * 60 * 1_000_000); // 23 hours
        let expected_max = after + (25 * 60 * 60 * 1_000_000); // 25 hours
        assert!(
            expiry >= expected_min && expiry <= expected_max,
            "Expiry should be approximately 24 hours from now"
        );
    }

    #[test]
    fn test_extract_jwt_expiry_invalid_base64() {
        let token = "invalid_header.invalid_payload.signature";
        let before = chrono::Utc::now().timestamp_micros();
        let expiry = extract_jwt_expiry(token);
        let after = chrono::Utc::now().timestamp_micros();

        // Should return default expiry
        let expected_min = before + (23 * 60 * 60 * 1_000_000);
        let expected_max = after + (25 * 60 * 60 * 1_000_000);
        assert!(
            expiry >= expected_min && expiry <= expected_max,
            "Should return default expiry for invalid base64"
        );
    }

    #[test]
    fn test_extract_jwt_expiry_invalid_json() {
        let header = r#"{"alg":"HS256","typ":"JWT"}"#;
        let invalid_json = "not valid json";

        let header_b64 = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(header);
        let payload_b64 = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(invalid_json);
        let token = format!("{}.{}.signature", header_b64, payload_b64);

        let before = chrono::Utc::now().timestamp_micros();
        let expiry = extract_jwt_expiry(&token);
        let after = chrono::Utc::now().timestamp_micros();

        // Should return default expiry
        let expected_min = before + (23 * 60 * 60 * 1_000_000);
        let expected_max = after + (25 * 60 * 60 * 1_000_000);
        assert!(
            expiry >= expected_min && expiry <= expected_max,
            "Should return default expiry for invalid JSON"
        );
    }

    #[test]
    fn test_extract_jwt_expiry_missing_exp_claim() {
        let header = r#"{"alg":"HS256","typ":"JWT"}"#;
        let payload = r#"{"sub":"test","iat":1234567890}"#; // No 'exp' claim

        let header_b64 = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(header);
        let payload_b64 = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(payload);
        let token = format!("{}.{}.signature", header_b64, payload_b64);

        let before = chrono::Utc::now().timestamp_micros();
        let expiry = extract_jwt_expiry(&token);
        let after = chrono::Utc::now().timestamp_micros();

        // Should return default expiry
        let expected_min = before + (23 * 60 * 60 * 1_000_000);
        let expected_max = after + (25 * 60 * 60 * 1_000_000);
        assert!(
            expiry >= expected_min && expiry <= expected_max,
            "Should return default expiry when 'exp' claim is missing"
        );
    }

    #[test]
    fn test_extract_jwt_expiry_exp_as_string() {
        let header = r#"{"alg":"HS256","typ":"JWT"}"#;
        let payload = r#"{"sub":"test","exp":"not_a_number"}"#; // exp is string, not number

        let header_b64 = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(header);
        let payload_b64 = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(payload);
        let token = format!("{}.{}.signature", header_b64, payload_b64);

        let before = chrono::Utc::now().timestamp_micros();
        let expiry = extract_jwt_expiry(&token);
        let after = chrono::Utc::now().timestamp_micros();

        // Should return default expiry
        let expected_min = before + (23 * 60 * 60 * 1_000_000);
        let expected_max = after + (25 * 60 * 60 * 1_000_000);
        assert!(
            expiry >= expected_min && expiry <= expected_max,
            "Should return default expiry when 'exp' is not a number"
        );
    }

    #[test]
    fn test_extract_jwt_expiry_with_padding() {
        // Test with URL_SAFE encoding (with padding)
        let future_exp = chrono::Utc::now().timestamp() + 7200; // 2 hours
        let header = r#"{"alg":"HS256","typ":"JWT"}"#;
        let payload = format!(r#"{{"sub":"test","exp":{}}}"#, future_exp);

        let header_b64 = base64::engine::general_purpose::URL_SAFE.encode(header);
        let payload_b64 = base64::engine::general_purpose::URL_SAFE.encode(payload);
        let token = format!("{}.{}.signature", header_b64, payload_b64);

        let expiry = extract_jwt_expiry(&token);
        let expected_micros = future_exp * 1_000_000;

        // Should handle padded base64 correctly
        assert_eq!(expiry, expected_micros);
    }

    #[test]
    fn test_extract_jwt_expiry_zero_expiry() {
        // Edge case: exp = 0 (expired at epoch)
        let token = create_jwt_token(0);
        let expiry = extract_jwt_expiry(&token);

        // Should return 0 microseconds
        assert_eq!(expiry, 0);
    }

    #[test]
    fn test_extract_jwt_expiry_large_expiry() {
        // Edge case: very far future expiry
        let far_future_exp = i64::MAX / 1_000_000; // Max value that won't overflow
        let token = create_jwt_token(far_future_exp);
        let expiry = extract_jwt_expiry(&token);

        // Should handle large values correctly
        assert_eq!(expiry, far_future_exp * 1_000_000);
    }

    #[test]
    fn test_extract_jwt_expiry_negative_expiry() {
        // Negative expiry (before epoch) should be handled correctly
        let negative_exp = -3600; // 1 hour before epoch
        let token = create_jwt_token(negative_exp);
        let expiry = extract_jwt_expiry(&token);

        // Should return negative microseconds (before epoch)
        assert_eq!(expiry, negative_exp * 1_000_000);
    }

    #[test]
    fn test_extract_jwt_expiry_real_jwt_format() {
        // Test with a more realistic JWT payload structure
        let future_exp = chrono::Utc::now().timestamp() + 1800; // 30 minutes
        let header = r#"{"alg":"RS256","typ":"JWT","kid":"abc123"}"#;
        let payload = format!(
            r#"{{"iss":"https://auth.example.com","sub":"user123","aud":"api","exp":{},"iat":{},"nbf":{}}}"#,
            future_exp,
            future_exp - 60,
            future_exp - 60
        );

        let header_b64 = base64::engine::general_purpose::URL_SAFE.encode(header);
        let payload_b64 = base64::engine::general_purpose::URL_SAFE.encode(payload);
        let token = format!("{}.{}.signature", header_b64, payload_b64);

        let expiry = extract_jwt_expiry(&token);
        let expected_micros = future_exp * 1_000_000;

        assert_eq!(expiry, expected_micros);
    }

    #[test]
    fn test_extract_jwt_expiry_float_exp_in_json() {
        // JWT with float exp value falls back to default expiry because as_i64() doesn't parse
        // floats
        let future_exp_int = 1800000000; // Fixed timestamp
        let header = r#"{"alg":"HS256","typ":"JWT"}"#;
        let payload = format!(r#"{{"sub":"test","exp":{}.0}}"#, future_exp_int); // Float format

        let header_b64 = base64::engine::general_purpose::URL_SAFE.encode(header);
        let payload_b64 = base64::engine::general_purpose::URL_SAFE.encode(payload);
        let token = format!("{}.{}.signature", header_b64, payload_b64);

        let before = chrono::Utc::now().timestamp_micros();
        let expiry = extract_jwt_expiry(&token);
        let after = chrono::Utc::now().timestamp_micros();

        // Float values can't be parsed by as_i64(), so it returns default expiry (24 hours)
        let expected_min = before + (23 * 60 * 60 * 1_000_000);
        let expected_max = after + (25 * 60 * 60 * 1_000_000);
        assert!(
            expiry >= expected_min && expiry <= expected_max,
            "Float exp should fall back to default expiry"
        );
    }
}
