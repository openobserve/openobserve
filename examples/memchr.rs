use memchr::memmem;
use std::env;
use std::time::Instant;

fn main() {
    let haystack = r##"{"Athlete":"PAHUD DE MORTANGES, Charles Ferdinand","City":"Los Angeles","Country":"NED","Discipline":"Eventing","Event":"Team","Gender":"Men","Medal":"Silver","Season":"summer","Sport":"Equestrian","Year":1932,"_timestamp":"2022-08-31T03:32:44.555229+00:00"}"##;
    let haystackb = haystack.as_bytes();

    let mode = env::args().nth(1).unwrap_or("std".to_string());
    println!("arch: {:?}, mode: {}", env::consts::ARCH, mode);
    let start_time = Instant::now();

    if mode == "memchr" {
        for _i in 1..1000000 {
            memmem::find(haystackb, b"NED");
        }
    } else {
        for _i in 1..1000000 {
            haystack.contains("NED");
        }
    }

    println!("Time elapsed is: {:?}", start_time.elapsed());
}
