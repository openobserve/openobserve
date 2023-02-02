use boa_engine::Context;
use mlua::Lua;

#[tokio::main]
async fn main() {
    let num_recs = 100000;
    let log = r#"[2022-10-16T09:36:43Z INFO actix_web::middleware::logger] 10.1.10.35 "POST /api/zinc_next/_bulk HTTP/1.1" 200 80 "-" "Fluent-Bit" 0.002320"#.to_string();
    use std::time::Instant;

    let now = Instant::now();
    lua_test(num_recs, log.clone()).await;
    let elapsed = now.elapsed();
    println!(" Lua Elapsed: {:.2?}", elapsed);

    let now2 = Instant::now();
    v8_test(num_recs, log.clone());
    let elapsed2 = now2.elapsed();
    println!("V8  Elapsed: {:.2?}", elapsed2);

    /*  let now1 = Instant::now();
    boa_test(num_recs, log.clone());
    let elapsed1 = now1.elapsed();
    println!("Boa Elapsed: {:.2?}", elapsed1); */
}

pub fn boa_test(num_recs: i32, log: String) {
    let mut context = Context::default();
    let script = r#"
                        function pow(data) {                 
                        let resp = {}
                        resp["ipaddress"] = /\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/.exec(data)[0];
                        //resp["timestamp"] = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z/.exec(data)[0];
                        //resp["log_level"] = /[A-Z]{4,5}/.exec(data)[0];
                        return resp["ipaddress"];
                    }
                    "#;
    context.eval(script).unwrap();
    let js_fn_str = format!("{}({:?})", "pow", log);
    for _i in 0..num_recs {
        let _value = context.eval(&js_fn_str).unwrap();
    }
    println!("exiting boa");
}

pub async fn lua_test(num_recs: i32, log: String) {
    let lua = Lua::new();
    let globals = lua.globals();

    for _i in 0..num_recs {
        globals.set("log", log.to_owned()).unwrap();
        /* lua.scope(|scope| {
            Ok({
                lua.globals().set(
                    "pow",
                    scope.create_function_mut(|_, data: String| {
                        //print!("The maximum of the two numbers is {}", data);
                        rust_val = data:match("(%d+%.%d+%.%d+%.%d+%:-%d+)")
                        Ok(())
                    })?,
                )?;
                lua.load("pow(log)").exec().unwrap();
            })
        })
        .unwrap(); */
        let _res = lua
            .load(
                r#"
                return log:match("(%d+%.%d+%.%d+%.%d+%:-%d+)")
            "#,
            )
            .eval::<String>()
            .unwrap();
        //println!("Result from lua {}", res);
    }
    println!("exiting lua");
}

pub fn v8_test(num_recs: i32, log: String) {
    let _js_fn_str = format!(
        r#"var log = '{}';{};"#,
        log, r#"/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/.exec(log)[0]"#
    );

    let js_func_script = r#"function pow(data) {  
                        console.log(data) 
                        let resp = {}
                        resp["ipaddress"] = /\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/.exec(data)[0];
                        resp["timestamp"] = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z/.exec(data)[0];
                        resp["log_level"] = /[A-Z]{4,5}/.exec(data)[0];
                        return resp["ipaddress"];
                    }"#;

    let platform = v8::new_default_platform(0, false).make_shared();
    v8::V8::initialize_platform(platform);
    v8::V8::initialize();

    // Create a new Isolate and make it the current one.
    let isolate = &mut v8::Isolate::new(v8::CreateParams::default());

    // Create a stack-allocated handle scope.
    let handle_scope = &mut v8::HandleScope::new(isolate);

    // Create a new context.
    let context = v8::Context::new(handle_scope);

    // Enter the context for compiling and running the hello world script.
    let scope = &mut v8::ContextScope::new(handle_scope, context);

    for _i in 0..num_recs {
        //let source_log = v8::String::new(scope, &log).unwrap();
        //js_func.push_str("pow(source_log)");

        let js_fn_str = format!(
            r#"var log = '{}';{};{};"#,
            log, js_func_script, r#"pow(log)"#
        );
        let source_reg = v8::String::new(scope, &js_fn_str).unwrap();
        // scope.add_context_data(context, source_log);
        let script = v8::Script::compile(scope, source_reg, None).unwrap();
        // Run the script to get the result.
        let result = script.run(scope).unwrap();
        let _result = result.to_string(scope).unwrap();
        //println!("Result from JS {}", _result.to_rust_string_lossy(scope));
    }
    println!("exiting V8");
}
