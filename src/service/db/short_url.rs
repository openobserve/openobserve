use anyhow::anyhow;

use crate::common::infra::config::URL_MAP;

pub async fn get(short_id: &str) -> Result<String, anyhow::Error> {
    match URL_MAP.get(short_id) {
        Some(val) => Ok(val.to_string()),
        None => {
            // TODO: get short url from db
            Err(anyhow!("Short URL not found"))
        }
    }
}

pub async fn set(short_id: &str, original_url: &str) -> Result<(), anyhow::Error> {
    // TODO: Set at db as well
    URL_MAP.insert(short_id.to_string(), original_url.to_string());
    Ok(())
}

pub async fn get_by_original_url(original_url: &str) -> Option<String> {
    let val = URL_MAP.iter().find_map(|entry| {
        let (k, v) = entry.pair();
        if v == original_url {
            return Some(k.clone());
        }
        None
    });

    if val.is_none() {
        // TODO: check in db
    }

    val
}
