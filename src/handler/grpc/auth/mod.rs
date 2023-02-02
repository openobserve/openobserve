use crate::{
    common::auth::get_hash,
    infra::config::{CONFIG, USERS},
};
use http_auth_basic::Credentials;
use tonic::{Request, Status};

pub fn check_auth(req: Request<()>) -> Result<Request<()>, Status> {
    if !req.metadata().contains_key(&CONFIG.grpc.org_header_key)
        && !req.metadata().contains_key("authorization")
    {
        return Err(Status::unauthenticated("No valid auth token"));
    }

    let token = req
        .metadata()
        .get("authorization")
        .unwrap()
        .to_str()
        .unwrap()
        .to_string();
    let credentials = match Credentials::from_header(token) {
        Ok(c) => c,
        Err(_) => return Err(Status::unauthenticated("No valid auth token")),
    };

    let user = USERS.get(&CONFIG.auth.username).unwrap();
    let in_pass = get_hash(&credentials.password, &user.salt);

    if credentials.user_id.eq(&CONFIG.auth.username)
        && (user.password.eq(&credentials.password) || user.password.eq(&in_pass))
    {
        Ok(req)
    } else {
        Err(Status::unauthenticated("No valid auth token"))
    }
}
