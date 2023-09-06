use actix_web::Error as ActixErr;
use actix_web::{
    body::MessageBody,
    dev::{ServiceRequest, ServiceResponse},
    web, FromRequest, HttpMessage,
};
use actix_web_lab::middleware::Next;
use ahash::HashMap;
use serde::{Deserialize, Serialize};
use uaparser::{Parser, UserAgentParser};

/// This is the custom data which is provided by `browser-sdk`
/// in form of query-parameters.
/// NOTE: the only condition is that the prefix of such params is `oo`.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct RumExtraData {
    pub data: HashMap<String, serde_json::Value>,
}

impl RumExtraData {
    pub async fn extractor(
        req: ServiceRequest,
        next: Next<impl MessageBody>,
    ) -> Result<ServiceResponse<impl MessageBody>, ActixErr> {
        let mut data =
            web::Query::<HashMap<String, String>>::from_query(req.query_string()).unwrap();
        data.retain(|k, _| {
            (k.starts_with("oo") || k.starts_with("batch_time")) && !k.eq("oo-api-key")
        });

        // These are the tags which come in `ootags`
        let tags: HashMap<String, serde_json::Value> = match data.get("ootags") {
            Some(tags) => tags
                .split(',')
                .map(|tag| {
                    let key_val: Vec<_> = tag.split(':').collect();
                    (key_val[0].to_string(), key_val[1].into())
                })
                .collect(),

            None => HashMap::default(),
        };

        let mut user_agent_hashmap: HashMap<String, serde_json::Value> = data
            .into_inner()
            .into_iter()
            .map(|(key, val)| (key, val.into()))
            .collect();

        // Now extend the existing hashmap with tags.
        user_agent_hashmap.extend(tags);

        {
            let headers = req.headers();
            let conn_info = req.connection_info();
            let ip_address = match headers.contains_key("X-Forwarded-For")
                || headers.contains_key("Forwarded")
            {
                true => conn_info.realip_remote_addr().unwrap(),
                false => conn_info.peer_addr().unwrap(),
            };
            user_agent_hashmap.insert("ip".into(), ip_address.into());
        }

        let user_agent = req
            .headers()
            .get("User-Agent")
            .map(|v| v.to_str().unwrap_or(""))
            .unwrap_or_default();

        let ua_parser = web::Data::<UserAgentParser>::extract(req.request())
            .await
            .unwrap();
        let parsed_user_agent = ua_parser.parse(user_agent);

        user_agent_hashmap.insert(
            "user_agent".into(),
            serde_json::to_value(&parsed_user_agent).unwrap_or_default(),
        );

        let rum_extracted_data = RumExtraData {
            data: user_agent_hashmap,
        };
        req.extensions_mut().insert(rum_extracted_data);
        next.call(req).await
    }
}
