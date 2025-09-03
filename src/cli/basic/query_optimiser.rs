// Copyright 2025 OpenObserve Inc.
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

use anyhow::Error;
#[cfg(feature = "enterprise")]
use o2_enterprise::enterprise::recommendations::engine::get_recommendations;

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
    match get_recommendations(url, token, meta_token, duration, stream_name, top_x, org_id).await {
        Ok(recos) => {
            if !recos.is_empty() {
                log::info!("Query recommendations ingested successfully");
            } else {
                log::info!("No query recommendations found");
            }
        }
        Err(e) => {
            log::error!("Failed to get query recommendations: {e:?}");
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
    _top_x: usize,
    _org_id: &str,
) -> Result<(), Error> {
    println!("query_optimiser not supported");
    Ok(())
}
