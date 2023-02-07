use ::datafusion::arrow::ipc;
use ahash::AHashMap as HashMap;
use std::sync::Arc;
use tracing::{info_span, Instrument};

use crate::handler::grpc::cluster_rpc;
use crate::infra::config::CONFIG;
use crate::meta::StreamType;

#[tracing::instrument(name = "service:search:exec", skip(req))]
pub async fn search(
    req: &cluster_rpc::SearchRequest,
) -> Result<cluster_rpc::SearchResponse, anyhow::Error> {
    let start = std::time::Instant::now();

    let sql = super::sql::Sql::new(req).await;
    if sql.is_err() {
        return Err(sql.err().unwrap());
    }
    let sql = Arc::new(sql.unwrap());
    let stream_type: StreamType = StreamType::from(req.stream_type.as_str());
    let session_id = req.job.as_ref().unwrap().session_id.to_string();
    let session_id = Arc::new(session_id);

    // result
    let mut results = HashMap::new();
    let mut file_count = 0;
    let mut scan_size = 0;

    let span1 = info_span!("service:search:exec:in_cache");

    // search in cache
    let session_id1 = session_id.clone();
    let sql1 = sql.clone();
    let task1 = tokio::task::spawn(
        async move {
            match super::cache::search(&session_id1, sql1, stream_type).await {
                Ok(res) => Ok(res),
                Err(err) => Err(err),
            }
        }
        .instrument(span1),
    );

    let span2 = info_span!("service:search:exec:in_storage");

    // search in object storage
    let req_stype = req.stype;
    let session_id2 = session_id.clone();
    let sql2 = sql.clone();
    let file_list = req.file_list.to_owned();
    let task2 = tokio::task::spawn(
        async move {
            if req_stype == cluster_rpc::SearchType::CacheOnly as i32 {
                Ok((HashMap::new(), 0, 0))
            } else {
                match super::storage::search(&session_id2, sql2, file_list.as_slice(), stream_type)
                    .await
                {
                    Ok(res) => Ok(res),
                    Err(err) => Err(err),
                }
            }
        }
        .instrument(span2),
    );

    // merge local cache
    let (batches1, file_count1, scan_size1) = match task1.await {
        Ok(result) => match result {
            Ok((search_result, file_count, scan_size)) => (search_result, file_count, scan_size),
            Err(err) => return Err(err),
        },
        Err(err) => return Err(anyhow::anyhow!(err)),
    };

    if !batches1.is_empty() {
        for (key, batch) in batches1 {
            if !batch.is_empty() {
                let value = results.entry(key).or_insert_with(Vec::new);
                value.push(batch);
            }
        }
    }
    file_count += file_count1;
    scan_size += scan_size1;

    // merge object storage search
    let (batches2, file_count2, scan_size2) = match task2.await {
        Ok(result) => match result {
            Ok((search_result, file_count, scan_size)) => (search_result, file_count, scan_size),
            Err(err) => return Err(err),
        },
        Err(err) => return Err(anyhow::anyhow!(err)),
    };

    if !batches2.is_empty() {
        for (key, batch) in batches2 {
            if !batch.is_empty() {
                let value = results.entry(key).or_insert_with(Vec::new);
                value.push(batch);
            }
        }
    }
    file_count += file_count2;
    scan_size += scan_size2;

    let span3 = info_span!("service:search:exec:merge");
    let guard3 = span3.enter();

    // merge all batches
    let (offset, limit) = if CONFIG.common.local_mode {
        (sql.meta.offset, sql.meta.limit)
    } else {
        (0, sql.meta.offset + sql.meta.limit)
    };
    for (name, batches) in results.iter_mut() {
        let merge_sql = if name.eq("query") {
            sql.origin_sql.clone()
        } else {
            sql.aggs
                .get(name.strip_prefix("agg_").unwrap())
                .unwrap()
                .0
                .clone()
        };
        *batches =
            match super::datafusion::exec::merge(&sql.org_id, offset, limit, &merge_sql, batches)
                .await
            {
                Ok(res) => res,
                Err(err) => return Err(anyhow::anyhow!(err)),
            };
    }

    // clear session data
    super::datafusion::storage::file_list::clear(&session_id)
        .await
        .unwrap();

    drop(guard3);
    let span4 = info_span!("service:search:exec:response");
    let _guard4 = span4.enter();

    // final result
    let mut hits_buf = Vec::new();
    let result_query = match results.get("query") {
        Some(batches) => batches.to_owned(),
        None => Vec::new(),
    };
    if !result_query.is_empty() && !result_query[0].is_empty() {
        let schema = result_query[0][0].schema();
        let ipc_options = ipc::writer::IpcWriteOptions::default();
        let ipc_options = ipc_options
            .try_with_compression(Some(ipc::CompressionType::ZSTD))
            .unwrap();
        let mut writer =
            ipc::writer::FileWriter::try_new_with_options(hits_buf, &schema, ipc_options).unwrap();
        for batch in result_query {
            for item in batch {
                writer.write(&item).unwrap();
            }
        }
        writer.finish().unwrap();
        hits_buf = writer.into_inner().unwrap();
    }

    // finally aggs result
    let mut aggs_buf = Vec::new();
    for (key, batches) in results {
        if key.eq("query") || batches.is_empty() {
            continue;
        }
        let mut buf = Vec::new();
        let schema = batches[0][0].schema();
        let ipc_options = ipc::writer::IpcWriteOptions::default();
        let ipc_options = ipc_options
            .try_with_compression(Some(ipc::CompressionType::ZSTD))
            .unwrap();
        let mut writer =
            ipc::writer::FileWriter::try_new_with_options(buf, &schema, ipc_options).unwrap();
        for batch in batches {
            for item in batch {
                writer.write(&item).unwrap();
            }
        }
        writer.finish().unwrap();
        buf = writer.into_inner().unwrap();
        aggs_buf.push(cluster_rpc::SearchAggResponse {
            name: key.strip_prefix("agg_").unwrap().to_string(),
            hits: buf,
        });
    }

    let scan_size = scan_size / 1024 / 1024; // MB
    let result = cluster_rpc::SearchResponse {
        job: req.job.clone(),
        took: start.elapsed().as_millis() as i32,
        from: sql.meta.offset as i32,
        size: sql.meta.limit as i32,
        total: 0,
        file_count: file_count as i32,
        scan_size: scan_size as i32,
        hits: hits_buf,
        aggs: aggs_buf,
    };

    Ok(result)
}
