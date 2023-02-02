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
