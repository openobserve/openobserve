// Copyright 2022 Zinc Labs Inc. and Contributors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

use ahash::AHashMap;
use arrow::array::StructArray;
use arrow_schema::Field;
use datafusion::{
    arrow::{
        array::{Array, ArrayRef, StringArray},
        datatypes::DataType,
    },
    logical_expr::{ScalarFunctionImplementation, ScalarUDF, Volatility},
    physical_plan::functions::make_scalar_function,
    prelude::create_udf,
};
use std::collections::BTreeMap;
use std::sync::Arc;
use vector_enrichment::TableRegistry;
use vrl::compiler::{runtime::Runtime, CompilationResult, Program};
use vrl::compiler::{TargetValueRef, VrlRuntime};

use crate::{
    common::json,
    infra::config::QUERY_FUNCTIONS,
    service::{ingestion::compile_vrl_function, logs::get_value},
};

fn create_user_df(
    fn_name: &str,
    num_args: u8,
    pow_scalar: ScalarFunctionImplementation,
    mut output_cols: Vec<String>,
) -> ScalarUDF {
    let mut input_vec = vec![];
    for _i in 0..num_args {
        input_vec.push(DataType::Utf8);
    }
    if output_cols.is_empty() {
        create_udf(
            fn_name,
            input_vec,
            Arc::new(DataType::Utf8),
            Volatility::Immutable,
            pow_scalar,
        )
    } else {
        let mut output_type: Vec<Field> = vec![];
        output_cols.sort();
        for col in output_cols {
            output_type.push(Field::new(col, DataType::Utf8, false));
        }
        create_udf(
            fn_name,
            input_vec,
            Arc::new(DataType::Struct(output_type)),
            Volatility::Immutable,
            pow_scalar,
        )
    }
}

pub async fn get_all_transform(org_id: &str) -> Vec<datafusion::logical_expr::ScalarUDF> {
    let mut udf;
    let mut udf_list = Vec::new();
    for transform in QUERY_FUNCTIONS.iter() {
        let key = transform.key();
        //do not register ingest_time transforms
        if key.contains(org_id) {
            udf = get_udf_vrl(
                transform.name.to_owned(),
                transform.function.to_owned().as_str(),
                &transform.params,
                transform.num_args,
                org_id,
            );

            udf_list.push(udf);
        }
    }
    udf_list
}

fn get_udf_vrl(
    fn_name: String,
    func: &str,
    params: &str,
    num_args: u8,
    org_id: &str,
) -> datafusion::logical_expr::ScalarUDF {
    let local_fn_name = fn_name;
    let local_func = func.trim().to_owned();
    let local_fn_params = params.to_owned();
    let local_org_id = org_id.to_owned();

    //pre computation stage
    let in_params = local_fn_params.split(',').collect::<Vec<&str>>();
    let mut in_obj_str = String::from("");
    for param in in_params {
        in_obj_str.push_str(&format!(" {} = \"{}\" \n", param, ""));
    }
    in_obj_str.push_str(&format!(" \n {}", &local_func));
    let res_cols = match compile_vrl_function(&in_obj_str, &local_org_id) {
        Ok(res) => res.fields,
        Err(_) => vec![],
    };
    // end pre computation stage

    let pow_calc = move |args: &[ArrayRef]| {
        let len = args[0].len();
        let in_params = local_fn_params.split(',').collect::<Vec<&str>>();
        let mut is_multi_value = false;
        let mut res_data_vec = vec![];
        let mut runtime = crate::common::functions::init_vrl_runtime();
        let mut col_val_map: AHashMap<String, Vec<String>> = AHashMap::new();

        for i in 0..len {
            let mut obj_str = String::from("");
            for (j, arg) in args.iter().enumerate() {
                let col = arg
                    .as_any()
                    .downcast_ref::<StringArray>()
                    .expect("cast failed");
                obj_str.push_str(&format!(
                    " {} = \"{}\" \n",
                    in_params.get(j).unwrap(),
                    col.value(i)
                ));
            }
            obj_str.push_str(&format!(" \n {}", &local_func));
            if let Ok(mut res) = compile_vrl_function(&obj_str, &local_org_id) {
                let registry = res.config.get_custom::<TableRegistry>().unwrap();
                registry.finish_load();
                let result = apply_vrl_fn(&mut runtime, res.program);
                if result != json::Value::Null {
                    if result.is_object() {
                        is_multi_value = true;
                        let res_map = result.as_object().unwrap();
                        res.fields.sort();
                        for col in res.fields {
                            let field_builder =
                                col_val_map.entry(col.to_string()).or_insert_with(Vec::new);
                            if res_map.contains_key(&col) {
                                field_builder.insert(i, get_value(res_map.get(&col).unwrap()));
                            } else {
                                field_builder.insert(i, "".to_string());
                            }
                        }
                    } else {
                        res_data_vec.insert(i, get_value(&result));
                    }
                }
            }
        }
        if is_multi_value {
            let mut data_vec = vec![];
            for (k, v) in col_val_map {
                data_vec.push((
                    Field::new(k, DataType::Utf8, false),
                    Arc::new(StringArray::from(v)) as ArrayRef,
                ));
            }
            data_vec.sort_by(|a, b| a.0.name().cmp(b.0.name()));

            let result = StructArray::from(data_vec);
            Ok(Arc::new(result) as ArrayRef)
        } else {
            let result = StringArray::from(res_data_vec);
            Ok(Arc::new(result) as ArrayRef)
        }

        // `Ok` because no error occurred during the calculation (we should add one if exponent was [0, 1[ and the base < 0 because that panics!)
        // `Arc` because arrays are immutable, thread-safe, trait objects.
    };
    // the function above expects an `ArrayRef`, but DataFusion may pass a scalar to a UDF.
    // thus, we use `make_scalar_function` to decorare the closure so that it can handle both Arrays and Scalar values.
    let pow_scalar = make_scalar_function(pow_calc);

    // Next:
    // * give it a name so that it shows nicely when the plan is printed
    // * declare what input it expects
    // * declare its return type

    let pow_udf = create_user_df(local_fn_name.as_str(), num_args, pow_scalar, res_cols);
    pow_udf
}

pub fn _compile_vrl_function(func: &str) -> Option<(Program, Vec<String>)> {
    let mut fields = vec![];
    let result = vrl::compiler::compile(func, &vrl::stdlib::all());
    match result {
        Ok(CompilationResult {
            program,
            warnings: _,
            config: _,
        }) => {
            let state = program.initial_type_state();
            if let Some(ext) = state.external.target_kind().as_object() {
                for k in ext.known().keys() {
                    fields.push(k.to_string());
                }
            }
            Some((program, fields))
        }
        Err(e) => {
            log::info!("Error compiling vrl {:?}", e);
            None
        }
    }
}

pub fn apply_vrl_fn(runtime: &mut Runtime, program: vrl::compiler::Program) -> json::Value {
    let obj_str = String::from("");

    let mut metadata = vrl::value::Value::from(BTreeMap::new());
    let mut target = TargetValueRef {
        value: &mut vrl::value::Value::from(obj_str),
        metadata: &mut metadata,
        secrets: &mut vrl::value::Secrets::new(),
    };
    let timezone = vrl::compiler::TimeZone::Local;
    let result = match VrlRuntime::default() {
        VrlRuntime::Ast => runtime.resolve(&mut target, &program, &timezone),
    };
    match result {
        Ok(res) => res.try_into().unwrap(),
        Err(err) => {
            log::error!("vrl_transform execute error: {}", err);
            json::Value::Null
        }
    }
}

#[cfg(test)]
mod tests {
    use crate::service::search::datafusion::transform_udf::get_udf_vrl;
    use datafusion::arrow::array::{Int64Array, StringArray};
    use datafusion::arrow::datatypes::{DataType, Field, Schema};
    use datafusion::arrow::record_batch::RecordBatch;
    use datafusion::datasource::MemTable;
    use datafusion::from_slice::FromSlice;
    use datafusion::prelude::SessionContext;
    use std::sync::Arc;

    #[tokio::test]
    async fn vrl_udf_test() {
        //let sql = "select temp.d['account_id'] as acc , temp.pod_id ,temp.lua_test from (select *, vrltest(log) ,luaconcat(log,pod_id) as lua_test from t) as temp";
        // let sql = "select vrltest(log)['account_id']  from (select *, vrltest(log) ,luaconcat(log,pod_id) as lua_test from t) as temp";

        // !!!TODO: fix this test
        let sql = "select * from t";

        // define a schema.
        let schema = Arc::new(Schema::new(vec![
            Field::new("log", DataType::Utf8, false),
            Field::new("pod_id", DataType::Int64, false),
        ]));

        // define data.
        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![
                Arc::new(StringArray::from_slice(&["2 123456789010 eni-1235b8ca123456789 - - - - - - - 1431280876 1431280934 - NODATA", "2 123456789010 eni-1235b8ca123456789 - - - - - - - 1431280876 1431280934 - NODATA", "2 123456789010 eni-1235b8ca123456789 - - - - - - - 1431280876 1431280934 - NODATA", "2 123456789010 eni-1235b8ca123456789 - - - - - - - 1431280876 1431280934 - NODATA"])),
                Arc::new(Int64Array::from_slice(&[1, 2, 1, 2])),
            ],
        )
        .unwrap();

        let vrl_udf = get_udf_vrl(
            "vrltest".to_string(),
            " . = parse_aws_vpc_flow_log!(col1) \n .http_code=200 \n .",
            "col1",
            1,
            "org1",
        );

        // declare a new context. In spark API, this corresponds to a new spark SQLsession
        let ctx = SessionContext::new();
        ctx.register_udf(vrl_udf.clone());
        let provider = MemTable::try_new(schema, vec![vec![batch]]).unwrap();
        ctx.register_table("t", Arc::new(provider)).unwrap();

        let df = ctx.sql(sql).await.unwrap();
        df.clone().show().await.unwrap();
        df.schema().fields().iter().for_each(|f| {
            println!("field: {:?}", f);
        });
        let result = df.collect().await.unwrap();
        let count = result.iter().map(|batch| batch.num_rows()).sum::<usize>();
        assert_eq!(count, 4);
    }
}
