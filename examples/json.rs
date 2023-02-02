use std::{
    env,
    fs::File,
    io::{BufRead, BufReader},
    process,
};

fn main() {
    let file = env::args().nth(1).unwrap_or_else(|| {
        eprintln!("Usage: {} <file>", env::args().next().unwrap());
        process::exit(1)
    });
    let f = File::open(file).unwrap();
    let reader = BufReader::new(f);
    for line in reader.lines() {
        let line = line.unwrap();
        let data: serde_json::Value = serde_json::from_str(&line).unwrap();
        println!("{:?}", data.is_null());
    }
}
