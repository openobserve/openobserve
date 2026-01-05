// Copyright 2025 OpenObserve Inc.
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

use super::db;

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
    db::session::set_with_expiry(session_id, val, expires_at)
        .await
        .ok()
}

pub async fn remove_session(session_id: &str) {
    let _ = db::session::delete(session_id).await;
}
