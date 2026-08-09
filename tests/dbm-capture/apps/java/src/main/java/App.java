/**
 * DBM capture cell: java (single app; PG + MySQL + Redis workloads in one run).
 *
 * Runs under the OpenTelemetry javaagent (version pinned in the Dockerfile).
 * Semconv mode via OTEL_SEMCONV_STABILITY_OPT_IN (unset | database/dup | database),
 * which the javaagent honors as an env var.
 *
 * Executes the canonical workload from apps/WORKLOAD.md per engine, each step
 * wrapped in a span carrying `test.step_id` (via GlobalOpenTelemetry, bridged
 * into the agent SDK). Includes S12 — the PG deadlock choreography (two
 * connections, opposite-order UPDATEs on deadlock_t behind a CyclicBarrier;
 * the victim span must error, expected SQLSTATE 40P01).
 */
import io.opentelemetry.api.GlobalOpenTelemetry;
import io.opentelemetry.api.trace.Span;
import io.opentelemetry.api.trace.Tracer;
import io.opentelemetry.context.Scope;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.concurrent.CyclicBarrier;

import redis.clients.jedis.Jedis;
import redis.clients.jedis.Pipeline;
import redis.clients.jedis.Transaction;
import redis.clients.jedis.exceptions.JedisDataException;

public class App {
  static final Tracer tracer = GlobalOpenTelemetry.getTracer("dbm-capture-workload");

  interface StepBody { void run() throws Exception; }

  static void step(String engine, String id, StepBody body) throws Exception {
    Span span = tracer.spanBuilder(id).startSpan();
    span.setAttribute("test.step_id", id);
    // engine prefix keeps the three per-engine step sequences distinguishable
    span.setAttribute("test.engine", engine);
    try (Scope ignored = span.makeCurrent()) {
      body.run();
    } finally {
      span.end();
    }
    System.out.println("[java] " + engine + " " + id + " done");
  }

  // ------------------------------------------------------------------ SQL --
  static void sqlWorkload(String engine, Connection conn) throws Exception {
    step(engine, "S00", () -> {
      try (Statement st = conn.createStatement()) {
        st.execute("DROP TABLE IF EXISTS dbm_items");
        st.execute("CREATE TABLE dbm_items (id INT PRIMARY KEY, name VARCHAR(64), price INT, category VARCHAR(32))");
        st.execute("INSERT INTO dbm_items (id, name, price, category) VALUES "
            + "(1,'alpha',10,'a'),(2,'beta',20,'a'),(3,'gamma',30,'b'),(4,'delta',40,'b'),"
            + "(5,'epsilon',50,'c'),(6,'zeta',60,'c'),(7,'eta',70,'d'),(8,'theta',80,'d'),"
            + "(9,'iota',90,'e'),(10,'kappa',100,'e')");
        st.execute("DROP TABLE IF EXISTS deadlock_t");
        st.execute("CREATE TABLE deadlock_t (id INT PRIMARY KEY, v INT)");
        st.execute("INSERT INTO deadlock_t (id, v) VALUES (1,0),(2,0)");
      }
    });
    step(engine, "S01", () -> {
      try (PreparedStatement ps = conn.prepareStatement("SELECT id, name, price FROM dbm_items WHERE id = ?")) {
        ps.setInt(1, 3);
        ps.executeQuery().close();
      }
    });
    step(engine, "S02", () -> {
      try (PreparedStatement ps = conn.prepareStatement("SELECT id, name FROM dbm_items WHERE price > ? AND category = ?")) {
        ps.setInt(1, 25);
        ps.setString(2, "b");
        ps.executeQuery().close();
      }
    });
    int[][] arities = {{3}, {8}, {20}};
    String[] sids = {"S03", "S04", "S05"};
    for (int i = 0; i < 3; i++) {
      int arity = arities[i][0];
      String sid = sids[i];
      step(engine, sid, () -> {
        String ph = "?" + ", ?".repeat(arity - 1);
        try (PreparedStatement ps = conn.prepareStatement("SELECT id, name FROM dbm_items WHERE id IN (" + ph + ")")) {
          for (int p = 1; p <= arity; p++) ps.setInt(p, p);
          ps.executeQuery().close();
        }
      });
    }
    step(engine, "S06", () -> {
      try (PreparedStatement ps = conn.prepareStatement("INSERT INTO dbm_items (id, name, price, category) VALUES (?, ?, ?, ?)")) {
        ps.setInt(1, 101); ps.setString(2, "ins-1"); ps.setInt(3, 11); ps.setString(4, "x");
        ps.executeUpdate();
      }
    });
    step(engine, "S07", () -> {
      String ph = "(?, ?, ?, ?)" + ", (?, ?, ?, ?)".repeat(4);
      try (PreparedStatement ps = conn.prepareStatement("INSERT INTO dbm_items (id, name, price, category) VALUES " + ph)) {
        int p = 1;
        for (int i = 1; i <= 5; i++) {
          ps.setInt(p++, 110 + i); ps.setString(p++, "batch-" + i); ps.setInt(p++, 10 * i); ps.setString(p++, "y");
        }
        ps.executeUpdate();
      }
    });
    step(engine, "S08", () -> {
      // driver batch API: addBatch/executeBatch, 10 rows
      try (PreparedStatement ps = conn.prepareStatement("INSERT INTO dbm_items (id, name, price, category) VALUES (?, ?, ?, ?)")) {
        for (int i = 1; i <= 10; i++) {
          ps.setInt(1, 120 + i); ps.setString(2, "many-" + i); ps.setInt(3, 10 * i); ps.setString(4, "z");
          ps.addBatch();
        }
        ps.executeBatch();
      }
    });
    step(engine, "S09", () -> {
      conn.setAutoCommit(false);
      try (PreparedStatement ps = conn.prepareStatement("UPDATE dbm_items SET price = price + 1 WHERE id = ?")) {
        ps.setInt(1, 1);
        ps.executeUpdate();
      }
      try (Statement st = conn.createStatement()) {
        st.execute("SAVEPOINT sp1");
      }
      try (PreparedStatement ps = conn.prepareStatement("UPDATE dbm_items SET price = price + 100 WHERE id = ?")) {
        ps.setInt(1, 2);
        ps.executeUpdate();
      }
      try (Statement st = conn.createStatement()) {
        st.execute("ROLLBACK TO SAVEPOINT sp1");
      }
      conn.commit();
      conn.setAutoCommit(true);
    });
    step(engine, "S10", () -> {
      try (Statement st = conn.createStatement()) {
        st.executeQuery("SELECT 1").close();
      }
    });
    step(engine, "S11", () -> {
      try (Statement st = conn.createStatement()) {
        st.executeQuery("SELECT no_such_column FROM dbm_items");
        System.out.println("[java] " + engine + " S11 UNEXPECTEDLY SUCCEEDED");
        System.exit(1);
      } catch (SQLException e) {
        System.out.println("[java] " + engine + " S11 expected error: " + e.getSQLState());
      }
    });
  }

  // ----------------------------------------------------------- PG deadlock --
  static void pgDeadlock(String url) throws Exception {
    step("postgres", "S12", () -> {
      try (Connection c1 = DriverManager.getConnection(url);
           Connection c2 = DriverManager.getConnection(url)) {
        c1.setAutoCommit(false);
        c2.setAutoCommit(false);
        CyclicBarrier barrier = new CyclicBarrier(2);
        final SQLException[] errors = new SQLException[2];
        // capture the wrapper span context for both worker threads
        io.opentelemetry.context.Context ctx = io.opentelemetry.context.Context.current();
        Runnable mk1 = ctx.wrap(() -> {
          try {
            update(c1, 1); barrier.await(); update(c1, 2);
          } catch (SQLException e) { errors[0] = e;
          } catch (Exception e) { throw new RuntimeException(e); }
        });
        Runnable mk2 = ctx.wrap(() -> {
          try {
            update(c2, 2); barrier.await(); update(c2, 1);
          } catch (SQLException e) { errors[1] = e;
          } catch (Exception e) { throw new RuntimeException(e); }
        });
        Thread t1 = new Thread(mk1); Thread t2 = new Thread(mk2);
        t1.start(); t2.start(); t1.join(); t2.join();
        try { c1.rollback(); } catch (SQLException ignored2) { }
        try { c2.rollback(); } catch (SQLException ignored2) { }
        String state = null;
        for (SQLException e : errors) if (e != null) state = e.getSQLState();
        if (state == null) {
          System.out.println("[java] S12 NO DEADLOCK OBSERVED"); System.exit(1);
        }
        System.out.println("[java] S12 deadlock victim SQLSTATE: " + state);
      }
    });
  }

  static void update(Connection c, int id) throws SQLException {
    try (PreparedStatement ps = c.prepareStatement("UPDATE deadlock_t SET v = v + 1 WHERE id = ?")) {
      ps.setInt(1, id);
      ps.executeUpdate();
    }
  }

  // ---------------------------------------------------------------- redis --
  static void redisWorkload(Jedis jedis) throws Exception {
    String engine = "redis";
    String[] names = {"alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta", "iota", "kappa"};
    step(engine, "S00", () -> {
      jedis.flushDB();
      for (int n = 1; n <= 10; n++) jedis.set("item:" + n, names[n - 1]);
    });
    step(engine, "S01", () -> jedis.get("item:3"));
    step(engine, "S02", () -> jedis.setex("item:tmp", 60, "scratch"));
    step(engine, "S03", () -> jedis.mget("item:1", "item:2", "item:3"));
    step(engine, "S04", () -> {
      String[] keys = new String[8];
      for (int i = 0; i < 8; i++) keys[i] = "item:" + (i + 1);
      jedis.mget(keys);
    });
    step(engine, "S05", () -> {
      String[] keys = new String[20];
      for (int i = 0; i < 20; i++) keys[i] = "item:" + (i + 1);
      jedis.mget(keys);
    });
    step(engine, "S06", () -> jedis.set("batch:1", "v1"));
    step(engine, "S07", () -> {
      Pipeline p = jedis.pipelined();
      for (int n = 1; n <= 5; n++) p.set("batch:" + n, "v" + n);
      p.sync();
    });
    step(engine, "S08", () -> {
      Pipeline p = jedis.pipelined();
      for (int n = 1; n <= 10; n++) p.set("batch:" + n, "v" + n);
      p.sync();
    });
    step(engine, "S09", () -> {
      Transaction t = jedis.multi();
      t.incr("txn:counter");
      t.incr("txn:counter");
      t.exec();
    });
    step(engine, "S10", () -> jedis.ping());
    step(engine, "S11", () -> {
      try {
        jedis.sendCommand(() -> "MEMORY".getBytes(), "DOCTOR-BOGUS");
        System.out.println("[java] redis S11 UNEXPECTEDLY SUCCEEDED");
        System.exit(1);
      } catch (JedisDataException e) {
        System.out.println("[java] redis S11 expected error: " + e.getMessage());
      }
    });
  }

  public static void main(String[] args) throws Exception {
    System.out.println("[java] OTEL_SEMCONV_STABILITY_OPT_IN='"
        + System.getenv().getOrDefault("OTEL_SEMCONV_STABILITY_OPT_IN", "") + "'");

    String pgUrl = "jdbc:postgresql://postgres:5432/dbm?user=dbm&password=dbm";
    try (Connection pg = DriverManager.getConnection(pgUrl)) {
      sqlWorkload("postgres", pg);
    }
    pgDeadlock(pgUrl);

    try (Connection my = DriverManager.getConnection("jdbc:mysql://mysql:3306/dbm?user=dbm&password=dbm")) {
      sqlWorkload("mysql", my);
    }

    try (Jedis jedis = new Jedis("redis", 6379)) {
      redisWorkload(jedis);
    }

    System.out.println("[java] workload complete");
    // give the agent's BatchSpanProcessor time to flush before exit
    Thread.sleep(6000);
  }
}
