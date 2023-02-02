use dotenv_config::EnvConfig;

#[derive(Debug, EnvConfig)]
struct Config {
    #[env_config(default = "192.168.2.1")]
    server_addr: String,
    server_mode: bool,
    #[env_config(name = "ZINC_FOO", default = true)]
    foo: bool,
    #[env_config(name = "ZINC_BAR", default = 123456)]
    bar: Option<i64>,
    rr: Redis,
}

#[derive(Debug, EnvConfig)]
struct Redis {
    addr: String,
    port: String,
    auth: String,
    #[env_config(name = "ZINC_REDIS_TIMEOUT", default = 30)]
    timeout: i32,
}

fn main() {
    let cfg = Config::init().unwrap();
    println!("{:#?}", cfg);
    println!("{}", cfg.server_addr);
    println!("{}", cfg.server_mode);
    println!("{}", cfg.foo);
    println!("{:?}", cfg.bar);
    println!("{:?}", cfg.rr.addr);
    println!("{:?}", cfg.rr.port);
    println!("{:?}", cfg.rr.auth);
    println!("{:?}", cfg.rr.timeout);
}
