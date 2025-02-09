tonic_build::configure()
    .build_server(true)
    .compile(
        &[
            "proto/continuous-profiling/service.proto",
        ],
        &["proto"],
    )?; 