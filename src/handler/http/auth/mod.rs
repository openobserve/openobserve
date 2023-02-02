use actix_web::{
    dev::ServiceRequest,
    error::{ErrorForbidden, ErrorUnauthorized},
    Error,
};
use actix_web_httpauth::extractors::basic::BasicAuth;

use crate::common::auth::get_hash;
use crate::infra::config::CONFIG;
use crate::meta::user::Role;
use crate::service::users;

pub async fn validator(
    req: ServiceRequest,
    credentials: BasicAuth,
) -> Result<ServiceRequest, (Error, ServiceRequest)> {
    let path = req.request().path().strip_prefix("/api/").unwrap();
    match validate_credentials(
        credentials.user_id(),
        credentials.password().unwrap().trim(),
        path,
    )
    .await
    {
        Ok(res) => {
            if res {
                Ok(req)
            } else {
                Err((ErrorUnauthorized("Unauthorized Access"), req))
            }
        }
        Err(err) => Err((err, req)),
    }
}

pub async fn validate_credentials(
    user_id: &str,
    user_password: &str,
    path: &str,
) -> Result<bool, Error> {
    let mut user = match path.find('/') {
        Some(index) => {
            let org_id = &path[0..index];
            users::get_user(Some(org_id), user_id).await
        }
        None => users::get_user(None, user_id).await,
    };

    //this is only applicable for super admin user
    if user.is_none() && is_admin_user(user_id).await {
        user = users::get_user(None, user_id).await;
        if user.is_none() {
            return Ok(false);
        }
    } else {
        return Ok(false);
    }

    let user = user.unwrap();
    let in_pass = get_hash(user_password, &user.salt);
    if !user.password.eq(&in_pass) {
        return Ok(false);
    }
    if !path.contains("/user")
        || (path.contains("/user") && (user.role.eq(&Role::Admin) || user.role.eq(&Role::Root)))
    {
        Ok(true)
    } else {
        Err(ErrorForbidden("Not allowed"))
    }
}

pub async fn is_admin_user(user_id: &str) -> bool {
    user_id.eq(&CONFIG.auth.username)
}

#[cfg(test)]
mod test_utils {
    use super::*;
    #[actix_web::test]
    async fn test_validate_credentials() {
        let res = validate_credentials(&CONFIG.auth.username, &CONFIG.auth.password, "index").await;
        assert_eq!(res.is_ok(), true)
    }
}
