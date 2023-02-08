use std::error::Error as StdError;
pub async fn send_notification(
    url: &str,
    payload: serde_json::Value,
) -> Result<(), Box<dyn StdError>> {
    let client = reqwest::Client::new();
    let loc_url = url::Url::parse(url).unwrap();
    let req = client
        .post(loc_url)
        .header("Content-type", "application/json")
        .json(&payload);

    let _ = req.send().await.unwrap();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[actix_web::test]
    async fn test_send_notification() {
        let obj = json!({"key": "value", "nested_key": {"key": "value", "foo": "bar"}});
        let res = send_notification("https://httpbin.org/post", obj).await;
        assert!(res.is_ok());
    }
}
