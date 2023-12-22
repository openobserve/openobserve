#[cfg(feature = "enterprise")]
use {
    crate::{
        common::{
            infra::{config::USERS, errors::JwtError},
            meta::user::{DBUser, RoleOrg, TokenValidationResponse, UserOrg},
        },
        service::{db, users},
    },
    o2_enterprise::enterprise::common::infra::config::O2_CONFIG,
};
#[cfg(feature = "enterprise")]
use {
    jsonwebtoken::{
        decode, decode_header,
        jwk::{self, AlgorithmParameters},
        Algorithm, DecodingKey, TokenData, Validation,
    },
    serde_json::Value,
    std::{collections::HashMap, str::FromStr},
};

#[cfg(feature = "enterprise")]
pub(crate) async fn verify_decode_token(
    token: &str,
    jwks: &str,
    aud: &str,
    get_decode_token: bool,
) -> Result<
    (
        TokenValidationResponse,
        Option<TokenData<HashMap<String, Value>>>,
    ),
    anyhow::Error,
> {
    let jwks: jwk::JwkSet = serde_json::from_str(jwks).unwrap();
    let header = decode_header(token)?;
    let kid = match header.kid {
        Some(k) => k,
        None => return Err(JwtError::MissingAttribute("`kid` header".to_owned()).into()),
    };

    if let Some(j) = jwks.find(&kid) {
        match &j.algorithm {
            AlgorithmParameters::RSA(rsa) => {
                let decoding_key = DecodingKey::from_rsa_components(&rsa.n, &rsa.e).unwrap();

                let mut validation = Validation::new(
                    Algorithm::from_str(j.common.key_algorithm.unwrap().to_string().as_str())
                        .unwrap(),
                );
                validation.validate_exp = true;
                validation.set_audience(&[aud]);
                let decoded_token = decode::<HashMap<String, serde_json::Value>>(
                    token,
                    &decoding_key,
                    &validation,
                )?;

                let user_email = decoded_token.claims.get("email").unwrap().as_str().unwrap();

                Ok((
                    TokenValidationResponse {
                        is_valid: true,
                        user_email: user_email.to_owned(),
                    },
                    if get_decode_token {
                        Some(decoded_token)
                    } else {
                        None
                    },
                ))
            }
            _ => Err(JwtError::ValidationFailed().into()),
        }
    } else {
        Err(JwtError::KeyNotExists().into())
    }
}

#[cfg(feature = "enterprise")]
pub async fn process_token(
    res: (
        TokenValidationResponse,
        Option<TokenData<HashMap<String, Value>>>,
    ),
) {
    let dec_token = res.1.unwrap();
    let groups = dec_token.claims.get("groups").unwrap().as_array().unwrap();
    let name = dec_token.claims.get("name").unwrap().as_str().unwrap();
    let user_email = res.0.user_email.to_owned();
    let mut source_orgs: Vec<UserOrg> = vec![];
    for group in groups {
        let role_org = parse_dn(group.as_str().unwrap()).unwrap();

        source_orgs.push(UserOrg {
            role: role_org.role,
            name: role_org.org,
            ..UserOrg::default()
        });
    }
    // Check if the user exists in the database
    let db_user = db::user::get_user_by_email(&user_email).await;
    let updated_db_user = if db_user.is_none() {
        log::info!("User does not exist in the database");
        DBUser {
            email: user_email.to_owned(),
            first_name: name.to_owned(),
            last_name: "".to_owned(),
            password: "".to_owned(),
            salt: "".to_owned(),
            organizations: source_orgs,
            is_external: true,
        }
    } else {
        log::info!("User exists in the database perform check for role change");
        let existing_db_user = db_user.unwrap();
        let mut existing_orgs = existing_db_user.organizations;

        // Find and remove users from cache
        for org in existing_orgs.iter() {
            if !source_orgs.iter().any(|src_org| src_org.name == org.name) {
                USERS.remove(&format!("{}/{}", org.name, user_email));
            }
        }

        // 1. Remove organizations not in source_orgs
        existing_orgs.retain(|org| source_orgs.iter().any(|src_org| src_org.name == org.name));
        // 2. Update roles for existing organizations
        for org in existing_orgs.iter_mut() {
            if let Some(src_org) = source_orgs.iter().find(|src_org| src_org.name == org.name) {
                org.role = src_org.role.clone();
            }
        }
        // 3. Add new organizations from source_orgs
        for src_org in source_orgs {
            if !existing_orgs.iter().any(|org| org.name == src_org.name) {
                existing_orgs.push(src_org.clone());
            }
        }

        DBUser {
            email: user_email.to_owned(),
            first_name: name.to_owned(),
            last_name: "".to_owned(),
            password: existing_db_user.password,
            salt: existing_db_user.salt,
            organizations: existing_orgs,
            is_external: true,
        }
    };
    let _ = users::update_db_user(updated_db_user).await;
}

#[cfg(feature = "enterprise")]
fn parse_dn(dn: &str) -> Option<RoleOrg> {
    let mut org = "";
    let mut role = "";

    for part in dn.split(',') {
        let parts: Vec<&str> = part.split('=').collect();
        if parts.len() == 2 {
            if parts[0].eq(&O2_CONFIG.dex.group_attribute) && org.is_empty() {
                org = parts[1];
            }
            if parts[0].eq(&O2_CONFIG.dex.role_attribute) && role.is_empty() {
                role = parts[1];
            }
        }
    }
    let role = if role.contains("admin") {
        crate::common::meta::user::UserRole::Admin
    } else {
        crate::common::meta::user::UserRole::Member
    };
    if org.is_empty() {
        org = &O2_CONFIG.dex.default_org;
    }
    Some(RoleOrg {
        role,
        org: org.to_owned(),
    })
}
