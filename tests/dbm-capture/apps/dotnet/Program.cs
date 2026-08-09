// DBM capture cells: dotnet-pg9 / dotnet-pg10 (Npgsql, semconv is PACKAGE-cut:
// 9.x = old-only, 10.x = new-only + db.response.status_code; the env var is
// ignored by Npgsql's native ActivitySource) and dotnet-mysql (MySqlConnector,
// honors OTEL_SEMCONV_STABILITY_OPT_IN).
//
// Executes the canonical workload from apps/WORKLOAD.md; each step wrapped in
// an Activity carrying test.step_id. PG runs include S12 (deadlock choreography:
// two connections, opposite-order UPDATEs behind a Barrier; victim errors,
// expected SQLSTATE 40P01 as db.response.status_code on Npgsql 10).
using System.Diagnostics;
using System.Data.Common;
using MySqlConnector;
using Npgsql;
using OpenTelemetry;
using OpenTelemetry.Resources;
using OpenTelemetry.Trace;

var engine = Environment.GetEnvironmentVariable("DBM_ENGINE") ?? "pg";
var service = Environment.GetEnvironmentVariable("SERVICE_NAME") ?? $"dbm-dotnet-{engine}";
var deployEnv = Environment.GetEnvironmentVariable("DEPLOY_ENV") ?? "capture-env-a";

var source = new ActivitySource("dbm-capture-workload");
using var tracerProvider = Sdk.CreateTracerProviderBuilder()
    .ConfigureResource(r => r.AddService(service).AddAttributes(new Dictionary<string, object>
    {
        ["deployment.environment.name"] = deployEnv,
    }))
    .AddSource("dbm-capture-workload")
    .AddSource("Npgsql")          // required: Npgsql native ActivitySource
    .AddSource("MySqlConnector")  // required: MySqlConnector native ActivitySource
    .AddOtlpExporter()            // endpoint/protocol from OTEL_EXPORTER_OTLP_* env
    .Build();

Console.WriteLine($"[dotnet-{engine}] service={service} " +
    $"OTEL_SEMCONV_STABILITY_OPT_IN='{Environment.GetEnvironmentVariable("OTEL_SEMCONV_STABILITY_OPT_IN") ?? ""}' " +
    $"Npgsql={typeof(NpgsqlConnection).Assembly.GetName().Version} " +
    $"MySqlConnector={typeof(MySqlConnection).Assembly.GetName().Version}");

async Task Step(string id, Func<Task> body)
{
    using (var act = source.StartActivity(id))
    {
        act?.SetTag("test.step_id", id);
        await body();
    }
    Console.WriteLine($"[dotnet-{engine}] {id} done");
}

async Task Exec(DbConnection conn, string sql, params (string name, object v)[] ps)
{
    await using var cmd = conn.CreateCommand();
    cmd.CommandText = sql;
    foreach (var (name, v) in ps)
    {
        var p = cmd.CreateParameter();
        p.ParameterName = name;
        p.Value = v;
        cmd.Parameters.Add(p);
    }
    await cmd.ExecuteNonQueryAsync();
}

async Task Query(DbConnection conn, string sql, params (string name, object v)[] ps)
{
    await using var cmd = conn.CreateCommand();
    cmd.CommandText = sql;
    foreach (var (name, v) in ps)
    {
        var p = cmd.CreateParameter();
        p.ParameterName = name;
        p.Value = v;
        cmd.Parameters.Add(p);
    }
    await using var r = await cmd.ExecuteReaderAsync();
    while (await r.ReadAsync()) { }
}

// Npgsql uses positional/named $1..$n or @name; MySqlConnector uses @name.
// We use @pN named parameters for both (Npgsql rewrites to $N on the wire in 10).
string Ph(int n) => string.Join(", ", Enumerable.Range(1, n).Select(i => $"@p{i}"));
(string, object)[] Params(int n) =>
    Enumerable.Range(1, n).Select(i => ($"@p{i}", (object)i)).ToArray();

async Task SqlWorkload(DbConnection conn)
{
    await Step("S00", async () =>
    {
        await Exec(conn, "DROP TABLE IF EXISTS dbm_items");
        await Exec(conn, "CREATE TABLE dbm_items (id INT PRIMARY KEY, name VARCHAR(64), price INT, category VARCHAR(32))");
        await Exec(conn, "INSERT INTO dbm_items (id, name, price, category) VALUES " +
            "(1,'alpha',10,'a'),(2,'beta',20,'a'),(3,'gamma',30,'b'),(4,'delta',40,'b')," +
            "(5,'epsilon',50,'c'),(6,'zeta',60,'c'),(7,'eta',70,'d'),(8,'theta',80,'d')," +
            "(9,'iota',90,'e'),(10,'kappa',100,'e')");
        await Exec(conn, "DROP TABLE IF EXISTS deadlock_t");
        await Exec(conn, "CREATE TABLE deadlock_t (id INT PRIMARY KEY, v INT)");
        await Exec(conn, "INSERT INTO deadlock_t (id, v) VALUES (1,0),(2,0)");
    });
    await Step("S01", () => Query(conn, "SELECT id, name, price FROM dbm_items WHERE id = @p1", ("@p1", 3)));
    await Step("S02", () => Query(conn, "SELECT id, name FROM dbm_items WHERE price > @p1 AND category = @p2",
        ("@p1", 25), ("@p2", "b")));
    foreach (var (sid, arity) in new[] { ("S03", 3), ("S04", 8), ("S05", 20) })
    {
        await Step(sid, () => Query(conn,
            $"SELECT id, name FROM dbm_items WHERE id IN ({Ph(arity)})", Params(arity)));
    }
    await Step("S06", () => Exec(conn, "INSERT INTO dbm_items (id, name, price, category) VALUES (@p1, @p2, @p3, @p4)",
        ("@p1", 101), ("@p2", "ins-1"), ("@p3", 11), ("@p4", "x")));
    await Step("S07", async () =>
    {
        var rows = Enumerable.Range(1, 5).ToArray();
        var values = string.Join(", ", rows.Select(i => $"(@a{i}, @b{i}, @c{i}, @d{i})"));
        var ps = rows.SelectMany(i => new (string, object)[]
        {
            ($"@a{i}", 110 + i), ($"@b{i}", $"batch-{i}"), ($"@c{i}", 10 * i), ($"@d{i}", "y"),
        }).ToArray();
        await Exec(conn, $"INSERT INTO dbm_items (id, name, price, category) VALUES {values}", ps);
    });
    await Step("S08", async () =>
    {
        // driver batch API: DbBatch (supported by Npgsql and MySqlConnector)
        await using var batch = conn.CreateBatch();
        for (var i = 1; i <= 10; i++)
        {
            var cmd = batch.CreateBatchCommand();
            cmd.CommandText = "INSERT INTO dbm_items (id, name, price, category) VALUES (@p1, @p2, @p3, @p4)";
            foreach (var (name, v) in new (string, object)[]
                { ("@p1", 120 + i), ("@p2", $"many-{i}"), ("@p3", 10 * i), ("@p4", "z") })
            {
                var p = cmd.CreateParameter();
                p.ParameterName = name;
                p.Value = v;
                cmd.Parameters.Add(p);
            }
            batch.BatchCommands.Add(cmd);
        }
        await batch.ExecuteNonQueryAsync();
    });
    await Step("S09", async () =>
    {
        await using (var tx = await conn.BeginTransactionAsync())
        {
            await using (var cmd = conn.CreateCommand())
            {
                cmd.Transaction = tx;
                cmd.CommandText = "UPDATE dbm_items SET price = price + 1 WHERE id = @p1";
                var p = cmd.CreateParameter(); p.ParameterName = "@p1"; p.Value = 1; cmd.Parameters.Add(p);
                await cmd.ExecuteNonQueryAsync();
            }
            await tx.SaveAsync("sp1");
            await using (var cmd = conn.CreateCommand())
            {
                cmd.Transaction = tx;
                cmd.CommandText = "UPDATE dbm_items SET price = price + 100 WHERE id = @p1";
                var p = cmd.CreateParameter(); p.ParameterName = "@p1"; p.Value = 2; cmd.Parameters.Add(p);
                await cmd.ExecuteNonQueryAsync();
            }
            await tx.RollbackAsync("sp1");
            await tx.CommitAsync();
        }
    });
    await Step("S10", () => Query(conn, "SELECT 1"));
    await Step("S11", async () =>
    {
        try
        {
            await Query(conn, "SELECT no_such_column FROM dbm_items");
            Console.WriteLine($"[dotnet-{engine}] S11 UNEXPECTEDLY SUCCEEDED");
            Environment.Exit(1);
        }
        catch (DbException e)
        {
            Console.WriteLine($"[dotnet-{engine}] S11 expected error: {e.SqlState}");
        }
    });
}

async Task PgDeadlock(string connString)
{
    await Step("S12", async () =>
    {
        await using var c1 = new NpgsqlConnection(connString);
        await using var c2 = new NpgsqlConnection(connString);
        await c1.OpenAsync();
        await c2.OpenAsync();
        await using var t1 = await c1.BeginTransactionAsync();
        await using var t2 = await c2.BeginTransactionAsync();
        using var barrier = new Barrier(2);
        var errors = new string?[2];

        async Task Update(NpgsqlConnection c, NpgsqlTransaction t, int id)
        {
            await using var cmd = c.CreateCommand();
            cmd.Transaction = t;
            cmd.CommandText = "UPDATE deadlock_t SET v = v + 1 WHERE id = @p1";
            cmd.Parameters.AddWithValue("@p1", id);
            await cmd.ExecuteNonQueryAsync();
        }

        var task1 = Task.Run(async () =>
        {
            try { await Update(c1, t1, 1); barrier.SignalAndWait(); await Update(c1, t1, 2); }
            catch (PostgresException e) { errors[0] = e.SqlState; }
        });
        var task2 = Task.Run(async () =>
        {
            try { await Update(c2, t2, 2); barrier.SignalAndWait(); await Update(c2, t2, 1); }
            catch (PostgresException e) { errors[1] = e.SqlState; }
        });
        await Task.WhenAll(task1, task2);
        try { await t1.RollbackAsync(); } catch { }
        try { await t2.RollbackAsync(); } catch { }
        var state = errors.FirstOrDefault(e => e != null);
        if (state == null)
        {
            Console.WriteLine($"[dotnet-{engine}] S12 NO DEADLOCK OBSERVED");
            Environment.Exit(1);
        }
        Console.WriteLine($"[dotnet-{engine}] S12 deadlock victim SQLSTATE: {state}");
    });
}

if (engine == "pg")
{
    const string cs = "Host=postgres;Port=5432;Username=dbm;Password=dbm;Database=dbm";
    await using (var conn = new NpgsqlConnection(cs))
    {
        await conn.OpenAsync();
        await SqlWorkload(conn);
    }
    await PgDeadlock(cs);
}
else if (engine == "mysql")
{
    await using var conn = new MySqlConnection(
        "Server=mysql;Port=3306;User ID=dbm;Password=dbm;Database=dbm");
    await conn.OpenAsync();
    await SqlWorkload(conn);
}
else
{
    throw new Exception($"unknown DBM_ENGINE {engine}");
}

tracerProvider.ForceFlush();
Console.WriteLine($"[dotnet-{engine}] workload complete");
