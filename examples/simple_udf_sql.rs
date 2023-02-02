// Licensed to the Apache Software Foundation (ASF) under one
// or more contributor license agreements.  See the NOTICE file
// distributed with this work for additional information
// regarding copyright ownership.  The ASF licenses this file
// to you under the Apache License, Version 2.0 (the
// "License"); you may not use this file except in compliance
// with the License.  You may obtain a copy of the License at
//
//   http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
// KIND, either express or implied.  See the License for the
// specific language governing permissions and limitations
// under the License.

use datafusion::{
    arrow::{
        array::{ArrayRef, Float32Array, Float64Array},
        datatypes::DataType,
        record_batch::RecordBatch,
    },
    logical_expr::Volatility,
};

use datafusion::from_slice::FromSlice;
use datafusion::prelude::*;
use datafusion::{error::Result, physical_plan::functions::make_scalar_function};
use std::sync::Arc;

// create local execution context with an in-memory table
fn create_context() -> Result<SessionContext> {
    use datafusion::arrow::datatypes::{Field, Schema};
    use datafusion::datasource::MemTable;
    // define a schema.
    let schema = Arc::new(Schema::new(vec![
        Field::new("a", DataType::Float32, false),
        Field::new("b", DataType::Float64, false),
    ]));

    // define data.
    let batch = RecordBatch::try_new(
        schema.clone(),
        vec![
            Arc::new(Float32Array::from_slice([2.1, 3.1, 4.1, 5.1])),
            Arc::new(Float64Array::from_slice([1.0, 2.0, 3.0, 4.0])),
        ],
    )?;

    // declare a new context. In spark API, this corresponds to a new spark SQLsession
    let ctx = SessionContext::new();

    // declare a table in memory. In spark API, this corresponds to createDataFrame(...).
    let provider = MemTable::try_new(schema, vec![vec![batch]])?;
    ctx.register_table("t", Arc::new(provider))?;
    Ok(ctx)
}

/// In this example we will declare a single-type, single return type UDF that exponentiates f64, a^b
#[tokio::main]
async fn main() -> Result<()> {
    let ctx = create_context()?;

    // First, declare the actual implementation of the calculation
    let pow = |args: &[ArrayRef]| {
        // in DataFusion, all `args` and output are dynamically-typed arrays, which means that we need to:
        // 1. cast the values to the type we want
        // 2. perform the computation for every element in the array (using a loop or SIMD) and construct the result

        // this is guaranteed by DataFusion based on the function's signature.
        assert_eq!(args.len(), 2);

        // 1. cast both arguments to f64. These casts MUST be aligned with the signature or this function panics!
        let base = &args[0]
            .as_any()
            .downcast_ref::<Float64Array>()
            .expect("cast failed");
        let exponent = &args[1]
            .as_any()
            .downcast_ref::<Float64Array>()
            .expect("cast failed");

        // this is guaranteed by DataFusion. We place it just to make it obvious.
        assert_eq!(exponent.len(), base.len());

        // 2. perform the computation
        let array = base
            .iter()
            .zip(exponent.iter())
            .map(|(base, exponent)| {
                match (base, exponent) {
                    // in arrow, any value can be null.
                    // Here we decide to make our UDF to return null when either base or exponent is null.
                    (Some(base), Some(exponent)) => Some(base.powf(exponent)),
                    _ => None,
                }
            })
            .collect::<Float64Array>();

        // `Ok` because no error occurred during the calculation (we should add one if exponent was [0, 1[ and the base < 0 because that panics!)
        // `Arc` because arrays are immutable, thread-safe, trait objects.
        Ok(Arc::new(array) as ArrayRef)
    };
    // the function above expects an `ArrayRef`, but DataFusion may pass a scalar to a UDF.
    // thus, we use `make_scalar_function` to decorare the closure so that it can handle both Arrays and Scalar values.
    let pow = make_scalar_function(pow);

    // Next:
    // * give it a name so that it shows nicely when the plan is printed
    // * declare what input it expects
    // * declare its return type
    let pow = create_udf(
        "pow",
        // expects two f64
        vec![DataType::Float64, DataType::Float64],
        // returns f64
        Arc::new(DataType::Float64),
        Volatility::Immutable,
        pow,
    );

    // at this point, we can use it or register it, depending on the use-case:
    // * if the UDF is expected to be used throughout the program in different contexts,
    //   we can register it, and call it later:
    ctx.register_udf(pow.clone()); // clone is only required in this example because we show both usages

    // * if the UDF is expected to be used directly in the scope, `.call` it directly:
    // let expr = pow.call(vec![col("a"), col("b")]);

    // get a DataFrame from the context
    let df = ctx.table("t").await?;

    let df_with_all = df.with_column("_all", col("a") + col("b"))?;
    println!("Printing schema");
    println!("{}", df_with_all.schema());
    ctx.register_table("t_new", df_with_all.into_view())?;

    // println!("{:?}", ctx.tables().unwrap());
    let result = ctx
        .sql(
            "SELECT a, b , _all FROM t_new ;
        ",
        )
        .await?;

    println!("Printing results");
    // print the results
    result.show().await?;

    Ok(())
}
