use std::sync::Arc;

use datafusion::arrow::array::Int32Array;
use datafusion::arrow::array::StringArray;
use datafusion::arrow::datatypes::{DataType, Field, Schema};
use datafusion::arrow::record_batch::RecordBatch;
use datafusion::datasource::MemTable;
use datafusion::error::Result;
use datafusion::from_slice::FromSlice;
use datafusion::prelude::{cast, col, SessionContext};

/// This example demonstrates how to use the DataFrame API against in-memory data.
#[tokio::main]
async fn main() -> Result<()> {
    // define a schema.
    let schema = Arc::new(Schema::new(vec![Field::new("f", DataType::Int32, false)]));
    // define data.
    let batch = RecordBatch::try_new(
        schema.clone(),
        vec![Arc::new(Int32Array::from_slice([1, 10, 10, 100]))],
    )?;

    let schema2 = Arc::new(Schema::new(vec![Field::new("f", DataType::Utf8, false)]));
    let batch2 = RecordBatch::try_new(
        schema2.clone(),
        vec![Arc::new(StringArray::from_slice(["2", "20", "20", "200"]))],
    )?;

    // declare a new context. In spark API, this corresponds to a new spark SQLsession
    let ctx = SessionContext::new();

    // declare a table in memory. In spark API, this corresponds to createDataFrame(...).
    let provider = MemTable::try_new(schema.clone(), vec![vec![batch]])?;
    ctx.register_table("t", Arc::new(provider))?;
    let df = ctx.table("t").await?;
    let df1 = df.select(vec![cast(col("f"), DataType::Utf8)])?;

    let provider2 = MemTable::try_new(schema2.clone(), vec![vec![batch2]])?;
    ctx.register_table("t2", Arc::new(provider2))?;
    let df2 = ctx.table("t2").await?;

    let new_df = df1.union(df2.clone())?;
    ctx.register_table("final", new_df.into_view())?;

    let result = ctx.sql("select * from final").await?;
    println!("{:?}", result.schema());
    result.show().await.unwrap();

    Ok(())
}
