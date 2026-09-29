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

use common::infra::config::{ORG_INGESTION_TOKENS, ROOT_USER};
use config::meta::cluster::get_internal_grpc_token;
use db::{org_users::get_cached_user_org, user::is_root_user};
use http_auth_basic::Credentials;
use infra::table::org_ingestion_tokens::ORG_INGESTION_TOKEN_PREFIX;
use openobserve_core::auth::try_get_hash;
#[cfg(test)]
use openobserve_core::auth::get_hash;
use tonic::{
    Request, Status,
    metadata::{MetadataMap, MetadataValue},
};

pub fn check_auth(req: Request<()>) -> Result<Request<()>, Status> {
    check_auth_inner(req, false)
}

/// Authenticate external OTLP ingestion requests.
///
/// Org-level ingestion tokens are deliberately accepted only by the OTLP
/// logs, metrics, and traces services. Internal cluster RPCs use
/// [`check_internal_auth`], so an ingestion token cannot authorize query or node APIs.
pub fn check_otlp_auth(req: Request<()>) -> Result<Request<()>, Status> {
    check_auth_inner(req, true)
}

/// Authenticate node-to-node RPCs, which accept only the internal or super-cluster token.
pub fn check_internal_auth(req: Request<()>) -> Result<Request<()>, Status> {
    if is_internal_token(auth_token(req.metadata())?) {
        Ok(req)
    } else {
        Err(Status::unauthenticated("No valid auth token[6]"))
    }
}

fn check_auth_inner(
    req: Request<()>,
    allow_org_ingestion_token: bool,
) -> Result<Request<()>, Status> {
    let cfg = config::get_config();
    let metadata = req.metadata();
    let token = auth_token(metadata)?;
    if is_internal_token(token) {
        return Ok(req);
    }

    log::debug!("Auth token is not internal grpc token");
    let Some(org_id) = metadata.get(&cfg.grpc.org_header_key) else {
        return Err(Status::invalid_argument(format!(
            "Please specify organization id with header key '{}' ",
            cfg.grpc.org_header_key
        )));
    };
    let Ok(org_id) = org_id.to_str() else {
        return Err(Status::invalid_argument(format!(
            "Organization id in header key '{}' must be visible ASCII",
            cfg.grpc.org_header_key
        )));
    };

    let credentials = match Credentials::from_header(token.to_string()) {
        Ok(c) => c,
        Err(err) => {
            log::error!("Err authenticating {err}");
            return Err(Status::unauthenticated("No valid auth token[3]"));
        }
    };

    // A blank credential must never reach a comparison with a token that may be stored blank.
    if credentials.password.is_empty() {
        return Err(Status::unauthenticated("No valid auth token[5]"));
    }

    let user_id = credentials.user_id;
    if allow_org_ingestion_token && credentials.password.starts_with(ORG_INGESTION_TOKEN_PREFIX) {
        let cache_key = db::org_ingestion_tokens::cache_key(org_id, &credentials.password);
        if ORG_INGESTION_TOKENS.contains_key(&cache_key) {
            return attach_user_id(req, &user_id);
        }
        return Err(Status::unauthenticated("No valid auth token[5]"));
    }

    // is_root_user reads ORG_USERS, a separate cache from ROOT_USER; they can disagree transiently
    let user = if is_root_user(&user_id) {
        ROOT_USER.get("root").map(|user| user.value().clone())
    } else {
        get_cached_user_org(org_id, &user_id)
    };
    let Some(user) = user else {
        return Err(Status::unauthenticated("No valid auth token[4]"));
    };

    if user.token.eq(&credentials.password) {
        return attach_user_id(req, &user_id);
    }
    if user_id.eq(&user.email)
        && try_get_hash(&credentials.password, &user.salt).is_some_and(|h| h == user.password)
    {
        attach_user_id(req, &user_id)
    } else {
        Err(Status::unauthenticated("No valid auth token[5]"))
    }
}

fn auth_token(metadata: &MetadataMap) -> Result<&str, Status> {
    let Some(token) = metadata.get("authorization").and_then(|v| v.to_str().ok()) else {
        return Err(Status::unauthenticated("No valid auth token[1]"));
    };
    if token.is_empty() {
        if get_internal_grpc_token().is_empty() {
            log::error!("Internal grpc token is not set");
        } else {
            log::error!("Internal grpc token is set, but auth token is empty");
        }
        return Err(Status::unauthenticated("No valid auth token[2]"));
    }
    Ok(token)
}

fn is_internal_token(token: &str) -> bool {
    // get_grpc_token falls back to the instance id, so honor it only with super-cluster on
    #[cfg(feature = "enterprise")]
    let super_cluster_token = o2_enterprise::enterprise::common::config::get_config()
        .super_cluster
        .enabled
        .then(o2_enterprise::enterprise::super_cluster::kv::cluster::get_grpc_token);
    #[cfg(not(feature = "enterprise"))]
    let super_cluster_token: Option<String> = None;
    token_matches(
        token,
        &get_internal_grpc_token(),
        super_cluster_token.as_deref(),
    )
}

fn token_matches(token: &str, internal_token: &str, super_cluster_token: Option<&str>) -> bool {
    token == internal_token || super_cluster_token.is_some_and(|t| t == token)
}

fn attach_user_id(mut req: Request<()>, user_id: &str) -> Result<Request<()>, Status> {
    let Ok(user_id) = MetadataValue::try_from(user_id) else {
        return Err(Status::invalid_argument(
            "user id is not a valid metadata value",
        ));
    };
    req.metadata_mut().insert("user_id", user_id);
    Ok(req)
}

#[cfg(test)]
pub(crate) mod tests {
    use common::infra::config::{ORG_INGESTION_TOKENS, ORG_USERS, USERS};
    use config::{
        cache_instance_id, get_config,
        meta::user::{User, UserRole, UserType},
        utils::base64,
    };
    use infra::table::{org_users::OrgUserRecord, users::UserRecord};
    use tonic::metadata::AsciiMetadataValue;

    use super::*;

    const ROOT_PASSWORD: &str = "Complexpass#123";
    const ROOT_SALT: &str = "Complexpass#123";

    fn seed_root() {
        cache_instance_id("instance");
        ROOT_USER.insert(
            "root".to_string(),
            User {
                email: "root@example.com".to_string(),
                password: get_hash(ROOT_PASSWORD, ROOT_SALT),
                role: config::meta::user::UserRole::Root,
                salt: ROOT_SALT.to_string(),
                first_name: "root".to_owned(),
                last_name: "".to_owned(),
                token: "token".to_string(),
                rum_token: Some("rum_token".to_string()),
                org: "default".to_owned(),
                is_external: false,
                password_ext: Some("Complexpass#123".to_string()),
            },
        );
    }

    /// Caches a non-root member of `org_id` whose password is `password` and API token is `token`.
    pub(crate) fn seed_org_user(org_id: &str, email: &str, password: &str, token: &str) {
        cache_instance_id("instance");
        let salt = "grpc-auth-test-salt";
        USERS.insert(
            email.to_string(),
            UserRecord {
                email: email.to_string(),
                first_name: "".to_string(),
                last_name: "".to_string(),
                password: get_hash(password, salt),
                salt: salt.to_string(),
                is_root: false,
                password_ext: None,
                user_type: UserType::Internal,
                created_at: 0,
                updated_at: 0,
                must_reset_password: false,
                password_reset_reason: None,
                flagged_at: None,
                password_updated_at: None,
            },
        );
        ORG_USERS.insert(
            format!("{org_id}/{email}"),
            OrgUserRecord {
                role: UserRole::Admin,
                token: token.to_string(),
                rum_token: None,
                org_id: org_id.to_string(),
                email: email.to_string(),
                created_at: 0,
                allow_static_token: true,
            },
        );
    }

    pub(crate) fn basic_request(org_id: &str, user: &str, password: &str) -> tonic::Request<()> {
        let credentials = base64::encode(&format!("{user}:{password}"));
        org_token_request(org_id, &credentials)
    }

    fn user_ids(request: &tonic::Request<()>) -> Vec<String> {
        request
            .metadata()
            .get_all("user_id")
            .iter()
            .map(|v| v.to_str().unwrap().to_string())
            .collect()
    }

    #[tokio::test]
    async fn test_check_no_auth() {
        seed_root();

        let mut request = tonic::Request::new(());
        request.set_timeout(std::time::Duration::from_secs(
            get_config().limit.query_timeout,
        ));

        let token: MetadataValue<_> = "basic cm9vdEBleGFtcGxlLmNvbTp0b2tlbg==".parse().unwrap();
        let meta: &mut tonic::metadata::MetadataMap = request.metadata_mut();
        meta.insert("authorization2", token.clone());

        let res = check_auth(request);
        assert!(res.is_err())
    }

    #[tokio::test]
    async fn test_check_auth() {
        seed_root();

        ORG_USERS.insert(
            "default/root@example.com".to_string(),
            OrgUserRecord {
                role: UserRole::Root,
                token: "token".to_string(),
                rum_token: Some("rum_token".to_string()),
                org_id: "default".to_string(),
                email: "root@example.com".to_string(),
                created_at: 0,
                allow_static_token: true,
            },
        );

        let mut request = tonic::Request::new(());
        request.set_timeout(std::time::Duration::from_secs(
            get_config().limit.query_timeout,
        ));
        let token: MetadataValue<_> = "basic cm9vdEBleGFtcGxlLmNvbTpDb21wbGV4cGFzcyMxMjM="
            .parse()
            .unwrap();
        let meta: &mut tonic::metadata::MetadataMap = request.metadata_mut();
        meta.insert("authorization", token.clone());
        meta.insert("organization", "default".parse().unwrap());

        assert!(check_auth(request).is_ok());
    }

    #[tokio::test]
    async fn test_check_err_auth() {
        seed_root();
        let mut request = tonic::Request::new(());
        request.set_timeout(std::time::Duration::from_secs(
            get_config().limit.query_timeout,
        ));

        let token: MetadataValue<_> = "basic cm9vdEBleGFtcGxlLmNvbTp0b2tlbjg4OA=="
            .parse()
            .unwrap();
        let meta: &mut tonic::metadata::MetadataMap = request.metadata_mut();
        meta.insert("authorization", token.clone());

        let status = check_auth(request).unwrap_err();
        assert_eq!(status.code(), tonic::Code::InvalidArgument);
    }

    #[test]
    fn test_check_auth_rejects_org_without_authorization() {
        let mut request = tonic::Request::new(());
        request
            .metadata_mut()
            .insert("organization", "default".parse().unwrap());

        let status = check_auth(request).unwrap_err();
        assert_eq!(status.code(), tonic::Code::Unauthenticated);
    }

    #[test]
    fn test_check_auth_rejects_non_ascii_authorization() {
        let mut request = tonic::Request::new(());
        let token = AsciiMetadataValue::try_from(b"basic \xff").unwrap();
        request.metadata_mut().insert("authorization", token);
        request
            .metadata_mut()
            .insert("organization", "default".parse().unwrap());

        let status = check_auth(request).unwrap_err();
        assert_eq!(status.code(), tonic::Code::Unauthenticated);
    }

    #[test]
    fn test_check_auth_rejects_non_ascii_organization() {
        cache_instance_id("instance");
        let mut request = tonic::Request::new(());
        request.metadata_mut().insert(
            "authorization",
            "basic cm9vdEBleGFtcGxlLmNvbTp0b2tlbg==".parse().unwrap(),
        );
        let org_id = AsciiMetadataValue::try_from(b"\xff").unwrap();
        request.metadata_mut().insert("organization", org_id);

        let status = check_auth(request).unwrap_err();
        assert_eq!(status.code(), tonic::Code::InvalidArgument);
    }

    fn org_token_request(org_id: &str, encoded_credentials: &str) -> tonic::Request<()> {
        let mut request = tonic::Request::new(());
        request.metadata_mut().insert(
            "authorization",
            format!("basic {encoded_credentials}").parse().unwrap(),
        );
        request
            .metadata_mut()
            .insert("organization", org_id.parse().unwrap());
        request
    }

    #[test]
    fn test_otlp_auth_accepts_org_ingestion_token() {
        let cache_key = db::org_ingestion_tokens::cache_key("default", "o2oi_valid_token");
        ORG_INGESTION_TOKENS.insert(cache_key.clone(), "collector-token".to_string());

        let request = org_token_request(
            "default",
            "Y29sbGVjdG9yQGV4YW1wbGUuY29tOm8yb2lfdmFsaWRfdG9rZW4=",
        );
        let request = check_otlp_auth(request).unwrap();

        assert_eq!(
            request.metadata().get("user_id").unwrap().to_str().unwrap(),
            "collector@example.com"
        );
        ORG_INGESTION_TOKENS.remove(&cache_key);
    }

    #[test]
    fn test_internal_auth_rejects_org_ingestion_token() {
        let cache_key = db::org_ingestion_tokens::cache_key("default", "o2oi_internal_token");
        ORG_INGESTION_TOKENS.insert(cache_key.clone(), "collector-token".to_string());

        let request = org_token_request(
            "default",
            "Y29sbGVjdG9yQGV4YW1wbGUuY29tOm8yb2lfaW50ZXJuYWxfdG9rZW4=",
        );

        assert!(check_auth(request).is_err());
        ORG_INGESTION_TOKENS.remove(&cache_key);
    }

    #[test]
    fn test_otlp_auth_rejects_missing_org_ingestion_token() {
        let request = org_token_request(
            "default",
            "Y29sbGVjdG9yQGV4YW1wbGUuY29tOm8yb2lfbWlzc2luZ190b2tlbg==",
        );

        let status = check_otlp_auth(request).unwrap_err();
        assert_eq!(status.code(), tonic::Code::Unauthenticated);
    }

    #[test]
    fn test_otlp_auth_rejects_org_ingestion_token_with_invalid_user_id() {
        cache_instance_id("instance");
        let cache_key = db::org_ingestion_tokens::cache_key("auth-invalid-user-id", "o2oi_x");
        ORG_INGESTION_TOKENS.insert(cache_key.clone(), "collector-token".to_string());

        let request = org_token_request("auth-invalid-user-id", "dXMKZXI6bzJvaV94");
        let status = check_otlp_auth(request).unwrap_err();

        assert_eq!(status.code(), tonic::Code::InvalidArgument);
        ORG_INGESTION_TOKENS.remove(&cache_key);
    }

    #[test]
    fn test_internal_auth_rejects_valid_user_credentials() {
        seed_org_user(
            "auth-internal",
            "member@example.com",
            "Memberpass#123",
            "member-token",
        );
        assert!(
            check_auth(basic_request(
                "auth-internal",
                "member@example.com",
                "Memberpass#123"
            ))
            .is_ok()
        );

        for password in ["Memberpass#123", "member-token"] {
            let request = basic_request("auth-internal", "member@example.com", password);
            let status = check_internal_auth(request).unwrap_err();
            assert_eq!(status.code(), tonic::Code::Unauthenticated);
        }
    }

    #[test]
    fn test_internal_auth_accepts_internal_token() {
        cache_instance_id("instance");
        let mut request = tonic::Request::new(());
        request
            .metadata_mut()
            .insert("authorization", get_internal_grpc_token().parse().unwrap());
        assert!(check_internal_auth(request).is_ok());

        let mut request = tonic::Request::new(());
        request
            .metadata_mut()
            .insert("authorization", "not-the-token".parse().unwrap());
        assert!(check_internal_auth(request).is_err());
    }

    #[test]
    fn test_otlp_auth_still_accepts_user_credentials() {
        seed_org_user(
            "auth-otlp",
            "otlp@example.com",
            "Otlppass#123",
            "otlp-token",
        );
        for password in ["Otlppass#123", "otlp-token"] {
            let request = basic_request("auth-otlp", "otlp@example.com", password);
            let request = check_otlp_auth(request).unwrap();
            assert_eq!(user_ids(&request), ["otlp@example.com"]);
        }
    }

    #[test]
    fn test_super_cluster_token_only_counts_when_given() {
        assert!(token_matches("internal", "internal", None));
        assert!(token_matches("peer", "internal", Some("peer")));
        assert!(!token_matches("peer", "internal", None));
        assert!(!token_matches("other", "internal", Some("peer")));
    }

    #[test]
    fn test_client_seeded_user_id_is_replaced() {
        seed_org_user(
            "auth-seeded",
            "real@example.com",
            "Realpass#123",
            "real-token",
        );
        for check in [check_auth, check_otlp_auth] {
            let mut request = basic_request("auth-seeded", "real@example.com", "Realpass#123");
            request
                .metadata_mut()
                .insert("user_id", "victim@example.com".parse().unwrap());
            let request = check(request).unwrap();
            assert_eq!(user_ids(&request), ["real@example.com"]);
        }
    }

    #[test]
    fn test_stored_password_hash_is_not_a_password() {
        seed_org_user(
            "auth-hash",
            "hash@example.com",
            "Hashpass#123",
            "hash-token",
        );
        let stored = USERS.get("hash@example.com").unwrap().password.clone();

        let status =
            check_auth(basic_request("auth-hash", "hash@example.com", &stored)).unwrap_err();
        assert_eq!(status.code(), tonic::Code::Unauthenticated);
        assert!(
            check_auth(basic_request(
                "auth-hash",
                "hash@example.com",
                "Hashpass#123"
            ))
            .is_ok()
        );
        assert!(check_auth(basic_request("auth-hash", "hash@example.com", "hash-token")).is_ok());
    }

    #[test]
    fn test_empty_password_does_not_match_empty_token() {
        seed_org_user("auth-empty-token", "empty-token@example.com", "Pass#123", "");

        let status =
            check_auth(basic_request("auth-empty-token", "empty-token@example.com", ""))
                .unwrap_err();
        assert_eq!(status.code(), tonic::Code::Unauthenticated);
    }

    #[test]
    fn test_sso_user_with_empty_salt_does_not_panic() {
        cache_instance_id("instance");
        USERS.insert(
            "sso@example.com".to_string(),
            UserRecord {
                email: "sso@example.com".to_string(),
                first_name: "".to_string(),
                last_name: "".to_string(),
                password: "".to_string(),
                salt: "".to_string(),
                is_root: false,
                password_ext: None,
                user_type: UserType::Internal,
                created_at: 0,
                updated_at: 0,
                must_reset_password: false,
                password_reset_reason: None,
                flagged_at: None,
                password_updated_at: None,
            },
        );
        ORG_USERS.insert(
            "auth-sso/sso@example.com".to_string(),
            OrgUserRecord {
                role: UserRole::Admin,
                token: "".to_string(),
                rum_token: None,
                org_id: "auth-sso".to_string(),
                email: "sso@example.com".to_string(),
                created_at: 0,
                allow_static_token: true,
            },
        );

        let status = check_auth(basic_request("auth-sso", "sso@example.com", "anything"))
            .unwrap_err();
        assert_eq!(status.code(), tonic::Code::Unauthenticated);
    }
}
