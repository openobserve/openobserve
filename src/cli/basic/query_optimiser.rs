use anyhow::Error;
#[cfg(feature = "enterprise")]
use o2_enterprise::enterprise::recomendations::engine::get_recomendations;

#[cfg(feature = "enterprise")]
pub async fn query_optimiser(
    url: &str,
    token: &str,
    meta_token: &Option<String>,
    duration: i64,
    stream_name: &Option<String>,
    top_x: usize,
    org_id: &str,
) -> Result<(), Error> {
    log::info!("Query Optimiser Start");

    let meta_token = match meta_token {
        Some(meta_token) => meta_token,
        None => token,
    };
    match get_recomendations(url, token, meta_token, duration, stream_name, top_x, org_id).await {
        Ok(recos) => {
            if !recos.is_empty() {
                log::info!("Query recommendations ingested successfully");
            } else {
                log::info!("No query recommendations found");
            }
        }
        Err(e) => {
            log::error!("Failed to get query recommendations: {:?}", e);
        }
    }

    Ok(())
}

#[cfg(not(feature = "enterprise"))]
pub async fn query_optimiser(
    _url: &str,
    _token: &str,
    _meta_token: &Option<String>,
    _duration: i64,
    _stream_name: &Option<String>,
) -> Result<(), Error> {
    println!("query_optimiser not supported");
    Ok(())
}
