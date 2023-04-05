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

use datafusion::{
    arrow::{
        array::{Array, ArrayRef, StringArray},
        datatypes::DataType,
    },
    logical_expr::{ScalarFunctionImplementation, ScalarUDF, Volatility},
    physical_plan::functions::make_scalar_function,
    prelude::create_udf,
};

use crate::common::json;

use mlua::{Function, Lua, LuaSerdeExt, MultiValue};
use std::sync::Arc;
use vrl::{prelude::BTreeMap, TargetValueRef, VrlRuntime};
use vrl::{CompilationResult, Program, Runtime};

use crate::infra::config::QUERY_FUNCTIONS;

fn create_user_df(
    fn_name: &str,
    num_args: u8,
    pow_scalar: ScalarFunctionImplementation,
) -> ScalarUDF {
    let mut input_vec = vec![];
    for _i in 0..num_args {
        input_vec.push(DataType::Utf8);
    }

    create_udf(
        fn_name,
        input_vec,
        Arc::new(DataType::Utf8),
        Volatility::Immutable,
        pow_scalar,
    )
}

pub async fn get_all_transform(org_id: &str) -> Vec<datafusion::logical_expr::ScalarUDF> {
    let mut udf;
    let mut udf_list = Vec::new();
    for transform in QUERY_FUNCTIONS.iter() {
        let key = transform.key();
        //do not register ingest_time transforms
        if transform.stream_name.is_empty() && key.contains(org_id) {
            if transform.trans_type == 0 {
                udf = get_udf_lua(
                    transform.name.to_owned(),
                    transform.function.to_owned().as_str(),
                    transform.num_args,
                );
            } else {
                udf = get_udf_vrl(
                    transform.name.to_owned(),
                    transform.function.to_owned().as_str(),
                    transform.num_args,
                );
            }

            udf_list.push(udf);
        }
    }
    udf_list
}

fn get_udf_vrl(
    fn_name: String,
    js_func: &str,
    num_args: u8,
) -> datafusion::logical_expr::ScalarUDF {
    let local_fn_name = fn_name;
    let local_js_func = js_func.to_owned();

    let pow_calc = move |args: &[ArrayRef]| {
        let len = args[0].len();
        let mut data_vec = vec![];
        let state = vrl::state::Runtime::default();
        let mut runtime = vrl::Runtime::new(state);
        for i in 0..len {
            let mut obj_str = String::from("");
            for (j, arg) in args.iter().enumerate() {
                let col = arg
                    .as_any()
                    .downcast_ref::<StringArray>()
                    .expect("cast failed");
                obj_str.push_str(&format!("col{j} = \"{}\" \n", col.value(i)));
            }
            obj_str.push_str(&format!(" \n {}", &local_js_func));
            let func = compile_vrl_function(&obj_str).unwrap();
            data_vec.insert(i, apply_vrl_fn(&mut runtime, func));
        }
        let result = StringArray::from(data_vec);

        // `Ok` because no error occurred during the calculation (we should add one if exponent was [0, 1[ and the base < 0 because that panics!)
        // `Arc` because arrays are immutable, thread-safe, trait objects.
        Ok(Arc::new(result) as ArrayRef)
    };
    // the function above expects an `ArrayRef`, but DataFusion may pass a scalar to a UDF.
    // thus, we use `make_scalar_function` to decorare the closure so that it can handle both Arrays and Scalar values.
    let pow_scalar = make_scalar_function(pow_calc);

    // Next:
    // * give it a name so that it shows nicely when the plan is printed
    // * declare what input it expects
    // * declare its return type
    let pow_udf = create_user_df(local_fn_name.as_str(), num_args, pow_scalar);
    pow_udf
}

pub fn compile_vrl_function(func: &str) -> Option<Program> {
    let result = vrl::compile(func, &vrl_stdlib::all());
    match result {
        Ok(CompilationResult {
            program,
            warnings: _,
            config: _,
        }) => Some(program),
        Err(e) => {
            log::info!("Error compiling vrl {:?}", e);
            None
        }
    }
}

pub fn apply_vrl_fn(runtime: &mut Runtime, program: vrl::Program) -> String {
    let obj_str = String::from("");

    let mut metadata = vrl_value::Value::from(BTreeMap::new());
    let mut target = TargetValueRef {
        value: &mut vrl_value::Value::from(obj_str),
        metadata: &mut metadata,
        secrets: &mut vrl_value::Secrets::new(),
    };
    let timezone = vrl::TimeZone::Local;
    let result = match VrlRuntime::default() {
        VrlRuntime::Ast => runtime.resolve(&mut target, &program, &timezone),
    };
    match result {
        Ok(res) => vrl_value::Value::to_string(&res),
        Err(err) => {
            log::error!("vrl_transform execute error: {}", err);
            "".to_string()
        }
    }
}

fn get_udf_lua(
    fn_name: String,
    js_func: &str,
    num_args: u8,
) -> datafusion::logical_expr::ScalarUDF {
    let local_fn_name = fn_name;
    let local_js_func = js_func.to_owned();
    let pow_calc = move |args: &[ArrayRef]| {
        //Lua
        let lua = Lua::new();
        //Register Lua Function
        let func = load_transform(&lua, local_js_func.to_string());
        let len = args[0].len();

        let mut data_vec = vec![];

        for i in 0..len {
            data_vec.insert(i, lua_transform(&lua, &func, args, i));
        }
        let result = StringArray::from(data_vec);

        // `Ok` because no error occurred during the calculation (we should add one if exponent was [0, 1[ and the base < 0 because that panics!)
        // `Arc` because arrays are immutable, thread-safe, trait objects.
        Ok(Arc::new(result) as ArrayRef)
    };
    // the function above expects an `ArrayRef`, but DataFusion may pass a scalar to a UDF.
    // thus, we use `make_scalar_function` to decorare the closure so that it can handle both Arrays and Scalar values.
    let pow_scalar = make_scalar_function(pow_calc);

    // Next:
    // * give it a name so that it shows nicely when the plan is printed
    // * declare what input it expects
    // * declare its return type
    let pow_udf = create_user_df(local_fn_name.as_str(), num_args, pow_scalar);
    pow_udf
}

fn load_transform(lua: &Lua, js_func: String) -> Function {
    lua.load(&js_func).eval().unwrap()
}

fn lua_transform(lua: &Lua, func: &Function, args: &[ArrayRef], stream: usize) -> String {
    let mut input_vec = vec![];

    for (_i, arg) in args.iter().enumerate() {
        let col = arg
            .as_any()
            .downcast_ref::<StringArray>()
            .expect("cast failed");

        input_vec.push(lua.to_value(&col.value(stream)).unwrap());
    }

    let input = MultiValue::from_vec(input_vec);
    let _res = func.call::<_, String>(input);
    match _res {
        Ok(res) => res,
        Err(err) => {
            log::error!("lua_transform execute error: {}", err);
            "".to_string()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    use datafusion::arrow::array::{Int64Array, StringArray};
    use datafusion::arrow::datatypes::{DataType, Field, Schema};
    use datafusion::arrow::record_batch::RecordBatch;
    use datafusion::datasource::MemTable;
    use datafusion::from_slice::FromSlice;
    use datafusion::prelude::SessionContext;
    use std::sync::Arc;

    #[tokio::test]
    async fn time_range() {
        //let data_time = parse_time("2021-01-01T00:00:00.000Z").unwrap();
        let sql = "select *, luaconcat(log,pod_id) as c ,vrlconcat(log,pod_id) as d from t ";

        // define a schema.
        let schema = Arc::new(Schema::new(vec![
            Field::new("log", DataType::Utf8, false),
            Field::new("pod_id", DataType::Int64, false),
        ]));

        // define data.
        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![
                Arc::new(StringArray::from_slice(&["a", "b", "c", "d"])),
                Arc::new(Int64Array::from_slice(&[1, 2, 1, 2])),
            ],
        )
        .unwrap();

        // declare a new context. In spark API, this corresponds to a new spark SQLsession
        let ctx = SessionContext::new();

        let lua_udf = get_udf_lua("luaconcat".to_string(), "function(a, b) return a..b end", 2);

        let vrl_udf = get_udf_vrl("vrlconcat".to_string(), ". = col0  + col1 \n .", 2);

        ctx.register_udf(lua_udf.clone());
        ctx.register_udf(vrl_udf.clone());
        // declare a table in memory. In spark API, this corresponds to createDataFrame(...).
        let provider = MemTable::try_new(schema, vec![vec![batch]]).unwrap();
        ctx.register_table("t", Arc::new(provider)).unwrap();

        let df = ctx.sql(sql).await.unwrap();
        let result = df.collect().await.unwrap();
        /* datafusion::assert_batches_sorted_eq!(
            vec![
                "+-----+--------+----+------+",
                "| log | pod_id | c  | d    |",
                "+-----+--------+----+------+",
                "| a   | 1      | a1 | a1   |",
                "| b   | 2      | b2 | b2   |",
                "| c   | 1      | c1 | c1   |",
                "| d   | 2      | d2 | d2   |",
                "+-----+--------+----+------+",
            ],
            &result
        ); */
        let count = result.iter().map(|batch| batch.num_rows()).sum::<usize>();
        assert_eq!(count, 4);
    }
}
