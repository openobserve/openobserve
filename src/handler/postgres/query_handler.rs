use std::sync::Arc;
use async_trait::async_trait;
use futures::{stream, StreamExt};
use pgwire::api::{ClientInfo, METADATA_DATABASE};
use pgwire::api::portal::Portal;
use pgwire::api::query::{ExtendedQueryHandler, SimpleQueryHandler, StatementOrPortal};
use pgwire::api::results::{DataRowEncoder, DescribeResponse, FieldFormat, FieldInfo, QueryResponse, Response};
use pgwire::api::stmt::NoopQueryParser;
use pgwire::api::store::MemPortalStore;
use pgwire::error::{ErrorInfo, PgWireResult};
use crate::common::meta;
use crate::common::meta::StreamType;
use crate::handler::grpc::cluster_rpc;
use crate::handler::postgres::types::{into_pg_type, encode_value};
use crate::service::search as SearchService;
use crate::service::search::sql;
use datafusion::arrow::record_batch::RecordBatch;

pub struct PostgresQueryHandler {
}

#[async_trait]
impl SimpleQueryHandler for PostgresQueryHandler {
    async fn do_query<'a, C>(&self, client: &C, query: &'a str) -> PgWireResult<Vec<Response<'a>>>
        where
            C: ClientInfo + Unpin + Send + Sync,
    {
        let org_id = client.metadata().get(METADATA_DATABASE).unwrap();
        let query = meta::search::Query {
            sql: query.to_string(),
            from: 0,
            size: 0,
            start_time: 0,
            end_time: 0,
            sort_by: None,
            sql_mode: "full".to_string(),
            query_type: "logs".to_string(),
            track_total_hits: false,
            query_context: None,
            uses_zo_fn: false,
            query_fn: None,
        };
        let req = meta::search::Request {
            query,
            aggs: Default::default(),
            encoding: meta::search::RequestEncoding::Empty,
            timeout: 0,
        };

        let mut req: cluster_rpc::SearchRequest = req.to_owned().into();
        req.org_id = org_id.to_string();
        req.stype = cluster_rpc::SearchType::User as i32;
        req.stream_type = StreamType::Logs.to_string();

        let sql = sql::Sql::new(&req).await;
        if sql.is_err() {
            return Ok(vec![Response::Error(Box::new(ErrorInfo::new(
                "ERROR".to_owned(),
                "XX000".to_owned(),
                "server error".to_owned(),
            )))])
        }

        let sql = Arc::new(sql.unwrap());


        match SearchService::search_by_grpc(&req, sql.clone()).await {
            Ok(mut res) => {
                match res.0.remove("query") {
                    Some(data) => {
                        let record_batch = data.into_iter().next();
                        if record_batch.is_none() {
                            return Ok(vec![Response::EmptyQuery])
                        }
                        let res = encode_data(record_batch.unwrap())?;
                        Ok(vec![Response::Query(res)])
                    }
                    None => {
                        Ok(vec![Response::EmptyQuery])
                    }
                }
            }
            Err(e) => {
                log::error!("server error: {:?}", e);
                Ok(vec![Response::Error(Box::new(ErrorInfo::new(
                    "ERROR".to_owned(),
                    "XX000".to_owned(),
                    "server error".to_owned(),
                )))])
            }
        }
    }
}

fn encode_data<'a>(record_batch: Vec<RecordBatch>) -> PgWireResult<QueryResponse<'a>> {
    let schema = record_batch[0].schema();
    let fields = Arc::new(
        schema
            .fields()
            .iter()
            .map(|f| {
                let pg_type = into_pg_type(f.data_type())?;
                Ok(FieldInfo::new(
                    f.name().into(),
                    None,
                    None,
                    pg_type,
                    FieldFormat::Text,
                ))
            })
            .collect::<PgWireResult<Vec<FieldInfo>>>()?,
    );

    let fields_ref = fields.clone();
    let pg_row_stream = stream::iter(record_batch.into_iter())
        .map(move |rb| {
            let rows = rb.num_rows();
            let cols = rb.num_columns();

            let fields = fields_ref.clone();

            let row_stream = (0..rows).into_iter().map(move |row| {
                let mut encoder = DataRowEncoder::new(fields.clone());
                for col in 0..cols {
                    let array = rb.column(col);
                    if array.is_null(row) {
                        encoder.encode_field(&None::<i8>).unwrap();
                    } else {
                        encode_value(&mut encoder, array, row).unwrap();
                    }
                }
                encoder.finish()
            });

            stream::iter(row_stream)
        })
        .flatten();

    Ok(QueryResponse::new(fields, pg_row_stream))
}

#[async_trait]
impl ExtendedQueryHandler for PostgresQueryHandler {
    type Statement = String;
    type QueryParser = NoopQueryParser;
    type PortalStore = MemPortalStore<Self::Statement>;

    fn portal_store(&self) -> Arc<Self::PortalStore> {
        unimplemented!("Extended Query is not implemented on this server.")
    }

    fn query_parser(&self) -> Arc<Self::QueryParser> {
        unimplemented!("Extended Query is not implemented on this server.")
    }

    async fn do_describe<C>(&self, _client: &mut C, _target: StatementOrPortal<'_, Self::Statement>) -> PgWireResult<DescribeResponse> where C: ClientInfo + Unpin + Send + Sync {
        unimplemented!("Extended Query is not implemented on this server.")
    }

    async fn do_query<'a, 'b: 'a, C>(&'b self, _client: &mut C, _portal: &'a Portal<Self::Statement>, _max_rows: usize) -> PgWireResult<Response<'a>> where C: ClientInfo + Unpin + Send + Sync {
        unimplemented!("Extended Query is not implemented on this server.")
    }
}