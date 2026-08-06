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
use openobserve_core::auth::get_hash;
use tonic::{Request, Status, metadata::MetadataValue};

pub fn check_auth(req: Request<()>) -> Result<Request<()>, Status> {
    check_auth_inner(req, false)
}

/// Authenticate external OTLP ingestion requests.
///
/// Org-level ingestion tokens are deliberately accepted only by the OTLP
/// logs, metrics, and traces services. Internal cluster RPCs continue to use
/// [`check_auth`], so an ingestion token cannot authorize query or node APIs.
pub fn check_otlp_auth(req: Request<()>) -> Result<Request<()>, Status> {
    check_auth_inner(req, true)
}

fn check_auth_inner(
    req: Request<()>,
    allow_org_ingestion_token: bool,
) -> Result<Request<()>, Status> {
    let cfg = config::get_config();
    let metadata = req.metadata();
    if !metadata.contains_key(&cfg.grpc.org_header_key) && !metadata.contains_key("authorization") {
        return Err(Status::unauthenticated("No valid auth token[1]"));
    }

    let token = req
        .metadata()
        .get("authorization")
        .unwrap()
        .to_str()
        .unwrap()
        .to_string();
    if token.is_empty() {
        if get_internal_grpc_token().is_empty() {
            log::error!("Internal grpc token is not set");
        } else {
            log::error!("Internal grpc token is set, but auth token is empty");
        }
        return Err(Status::unauthenticated("No valid auth token[2]"));
    }

    #[cfg(feature = "enterprise")]
    let super_cluster_token =
        o2_enterprise::enterprise::super_cluster::kv::cluster::get_grpc_token();
    #[cfg(not(feature = "enterprise"))]
    let super_cluster_token = get_internal_grpc_token();
    if token.eq(get_internal_grpc_token().as_str()) || token.eq(super_cluster_token.as_str()) {
        Ok(req)
    } else {
        log::debug!("Auth token is not internal grpc token");
        let org_id = metadata.get(&cfg.grpc.org_header_key);
        if org_id.is_none() {
            return Err(Status::invalid_argument(format!(
                "Please specify organization id with header key '{}' ",
                cfg.grpc.org_header_key
            )));
        }

        let credentials = match Credentials::from_header(token) {
            Ok(c) => c,
            Err(err) => {
                log::error!("Err authenticating {err}");
                return Err(Status::unauthenticated("No valid auth token[3]"));
            }
        };

        let user_id = credentials.user_id;
        if allow_org_ingestion_token && credentials.password.starts_with(ORG_INGESTION_TOKEN_PREFIX)
        {
            let org_id = org_id.unwrap().to_str().unwrap();
            let cache_key = db::org_ingestion_tokens::cache_key(org_id, &credentials.password);
            if ORG_INGESTION_TOKENS.contains_key(&cache_key) {
                let mut req = req;
                let user_id_metadata = MetadataValue::try_from(&user_id).unwrap();
                req.metadata_mut().append("user_id", user_id_metadata);
                return Ok(req);
            }
            return Err(Status::unauthenticated("No valid auth token[5]"));
        }

        let user = if is_root_user(&user_id) {
            ROOT_USER.get("root").unwrap().to_owned()
        } else if let Some(user) = get_cached_user_org(org_id.unwrap().to_str().unwrap(), &user_id)
        {
            user
        } else {
            return Err(Status::unauthenticated("No valid auth token[4]"));
        };

        if user.token.eq(&credentials.password) {
            let mut req = req;
            let user_id_metadata = MetadataValue::try_from(&user_id).unwrap();
            req.metadata_mut().append("user_id", user_id_metadata);
            return Ok(req);
        }
        let in_pass = get_hash(&credentials.password, &user.salt);
        if user_id.eq(&user.email)
            && (credentials.password.eq(&user.password) || in_pass.eq(&user.password))
        {
            let mut req = req;
            let user_id_metadata = MetadataValue::try_from(&user_id).unwrap();
            req.metadata_mut().append("user_id", user_id_metadata);

            Ok(req)
        } else {
            Err(Status::unauthenticated("No valid auth token[5]"))
        }
    }
}

#[cfg(test)]
mod tests {
    use common::infra::config::{ORG_INGESTION_TOKENS, ORG_USERS};
    use config::{
        cache_instance_id, get_config,
        meta::user::{User, UserRole},
    };
    use infra::table::org_users::OrgUserRecord;

    use super::*;

    #[tokio::test]
    async fn test_check_no_auth() {
        cache_instance_id("instance");
        ROOT_USER.insert(
            "root".to_string(),
            User {
                email: "root@example.com".to_string(),
                password: "Complexpass#123".to_string(),
                role: config::meta::user::UserRole::Root,
                salt: "Complexpass#123".to_string(),
                first_name: "root".to_owned(),
                last_name: "".to_owned(),
                token: "token".to_string(),
                rum_token: Some("rum_token".to_string()),
                org: "dummy".to_owned(),
                is_external: false,
                password_ext: Some("Complexpass#123".to_string()),
            },
        );

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
        cache_instance_id("instance");
        ROOT_USER.insert(
            "root".to_string(),
            User {
                email: "root@example.com".to_string(),
                password: "Complexpass#123".to_string(),
                role: config::meta::user::UserRole::Root,
                salt: "Complexpass#123".to_string(),
                first_name: "root".to_owned(),
                last_name: "".to_owned(),
                token: "token".to_string(),
                rum_token: Some("rum_token".to_string()),
                org: "default".to_owned(),
                is_external: false,
                password_ext: Some("Complexpass#123".to_string()),
            },
        );

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
        cache_instance_id("instance");
        ROOT_USER.insert(
            "root".to_string(),
            User {
                email: "root@example.com".to_string(),
                password: "Complexpass#123".to_string(),
                role: config::meta::user::UserRole::Root,
                salt: "Complexpass#123".to_string(),
                first_name: "root".to_owned(),
                last_name: "".to_owned(),
                token: "token".to_string(),
                rum_token: Some("rum_token".to_string()),
                org: "dummy".to_owned(),
                is_external: false,
                password_ext: Some("Complexpass#123".to_string()),
            },
        );
        let mut request = tonic::Request::new(());
        request.set_timeout(std::time::Duration::from_secs(
            get_config().limit.query_timeout,
        ));

        let token: MetadataValue<_> = "basic cm9vdEBleGFtcGxlLmNvbTp0b2tlbjg4OA=="
            .parse()
            .unwrap();
        let meta: &mut tonic::metadata::MetadataMap = request.metadata_mut();
        meta.insert("authorization", token.clone());

        let res = check_auth(request);
        assert!(res.is_err())
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
}
