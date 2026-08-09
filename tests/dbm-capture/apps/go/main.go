// DBM capture cell: go-pg (database/sql + pgx stdlib + XSAM/otelsql).
//
// The cell deliberately sets otelsql.SpanOptions{DisableQuery: true} — the
// FR-2 "unknown bucket" fixture: spans must carry NO db.statement /
// db.query.text AND NO db.operation.name (otelsql puts operation on metrics,
// not spans). Semconv mode via OTEL_SEMCONV_STABILITY_OPT_IN
// (unset | database/dup | database), honored by otelsql >= 0.35.
package main

import (
	"context"
	"fmt"
	"os"
	"runtime/debug"
	"strings"
	"time"

	"github.com/XSAM/otelsql"
	_ "github.com/jackc/pgx/v5/stdlib"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.26.0"
	"go.opentelemetry.io/otel/trace"
)

var tracer trace.Tracer

func step(ctx context.Context, id string, fn func(context.Context) error) {
	sctx, span := tracer.Start(ctx, id)
	span.SetAttributes(attribute.String("test.step_id", id))
	err := fn(sctx)
	span.End()
	if err != nil {
		fmt.Printf("[go-pg] %s FAILED: %v\n", id, err)
		os.Exit(1)
	}
	fmt.Printf("[go-pg] %s done\n", id)
}

func main() {
	ctx := context.Background()
	deployEnv := os.Getenv("DEPLOY_ENV")
	if deployEnv == "" {
		deployEnv = "capture-env-a"
	}
	res, err := resource.Merge(resource.Default(), resource.NewSchemaless(
		semconv.ServiceName("dbm-go-pg"),
		attribute.String("deployment.environment.name", deployEnv),
	))
	if err != nil {
		panic(err)
	}
	exp, err := otlptracehttp.New(ctx) // endpoint from OTEL_EXPORTER_OTLP_ENDPOINT
	if err != nil {
		panic(err)
	}
	tp := sdktrace.NewTracerProvider(
		sdktrace.WithBatcher(exp),
		sdktrace.WithResource(res),
	)
	otel.SetTracerProvider(tp)
	tracer = otel.Tracer("dbm-capture-workload")

	fmt.Printf("[go-pg] OTEL_SEMCONV_STABILITY_OPT_IN=%q\n", os.Getenv("OTEL_SEMCONV_STABILITY_OPT_IN"))
	if bi, ok := debug.ReadBuildInfo(); ok {
		for _, dep := range bi.Deps {
			if strings.Contains(dep.Path, "otelsql") || strings.Contains(dep.Path, "pgx") ||
				dep.Path == "go.opentelemetry.io/otel" {
				fmt.Printf("[go-pg] pin: %s %s\n", dep.Path, dep.Version)
			}
		}
	}

	dsn := "postgres://dbm:dbm@postgres:5432/dbm"
	db, err := otelsql.Open("pgx", dsn,
		otelsql.WithSpanOptions(otelsql.SpanOptions{DisableQuery: true}),
		otelsql.WithAttributes(semconv.DBSystemPostgreSQL),
	)
	if err != nil {
		panic(err)
	}
	defer db.Close()

	step(ctx, "S00", func(c context.Context) error {
		stmts := []string{
			"DROP TABLE IF EXISTS dbm_items",
			"CREATE TABLE dbm_items (id INT PRIMARY KEY, name VARCHAR(64), price INT, category VARCHAR(32))",
			"INSERT INTO dbm_items (id, name, price, category) VALUES " +
				"(1,'alpha',10,'a'),(2,'beta',20,'a'),(3,'gamma',30,'b'),(4,'delta',40,'b')," +
				"(5,'epsilon',50,'c'),(6,'zeta',60,'c'),(7,'eta',70,'d'),(8,'theta',80,'d')," +
				"(9,'iota',90,'e'),(10,'kappa',100,'e')",
			"DROP TABLE IF EXISTS deadlock_t",
			"CREATE TABLE deadlock_t (id INT PRIMARY KEY, v INT)",
			"INSERT INTO deadlock_t (id, v) VALUES (1,0),(2,0)",
		}
		for _, s := range stmts {
			if _, err := db.ExecContext(c, s); err != nil {
				return err
			}
		}
		return nil
	})
	step(ctx, "S01", func(c context.Context) error {
		rows, err := db.QueryContext(c, "SELECT id, name, price FROM dbm_items WHERE id = $1", 3)
		if err != nil {
			return err
		}
		return rows.Close()
	})
	step(ctx, "S02", func(c context.Context) error {
		rows, err := db.QueryContext(c, "SELECT id, name FROM dbm_items WHERE price > $1 AND category = $2", 25, "b")
		if err != nil {
			return err
		}
		return rows.Close()
	})
	for _, sa := range []struct {
		sid   string
		arity int
	}{{"S03", 3}, {"S04", 8}, {"S05", 20}} {
		sa := sa
		step(ctx, sa.sid, func(c context.Context) error {
			ph := make([]string, sa.arity)
			args := make([]any, sa.arity)
			for i := 0; i < sa.arity; i++ {
				ph[i] = fmt.Sprintf("$%d", i+1)
				args[i] = i + 1
			}
			rows, err := db.QueryContext(c,
				"SELECT id, name FROM dbm_items WHERE id IN ("+strings.Join(ph, ", ")+")", args...)
			if err != nil {
				return err
			}
			return rows.Close()
		})
	}
	step(ctx, "S06", func(c context.Context) error {
		_, err := db.ExecContext(c,
			"INSERT INTO dbm_items (id, name, price, category) VALUES ($1, $2, $3, $4)",
			101, "ins-1", 11, "x")
		return err
	})
	step(ctx, "S07", func(c context.Context) error {
		var sb strings.Builder
		args := []any{}
		sb.WriteString("INSERT INTO dbm_items (id, name, price, category) VALUES ")
		for i := 1; i <= 5; i++ {
			if i > 1 {
				sb.WriteString(", ")
			}
			base := (i - 1) * 4
			sb.WriteString(fmt.Sprintf("($%d, $%d, $%d, $%d)", base+1, base+2, base+3, base+4))
			args = append(args, 110+i, fmt.Sprintf("batch-%d", i), 10*i, "y")
		}
		_, err := db.ExecContext(c, sb.String(), args...)
		return err
	})
	step(ctx, "S08", func(c context.Context) error {
		// database/sql has no executemany/addBatch: 10 sequential INSERTs
		for i := 1; i <= 10; i++ {
			if _, err := db.ExecContext(c,
				"INSERT INTO dbm_items (id, name, price, category) VALUES ($1, $2, $3, $4)",
				120+i, fmt.Sprintf("many-%d", i), 10*i, "z"); err != nil {
				return err
			}
		}
		return nil
	})
	step(ctx, "S09", func(c context.Context) error {
		tx, err := db.BeginTx(c, nil)
		if err != nil {
			return err
		}
		if _, err := tx.ExecContext(c, "UPDATE dbm_items SET price = price + 1 WHERE id = $1", 1); err != nil {
			return err
		}
		if _, err := tx.ExecContext(c, "SAVEPOINT sp1"); err != nil {
			return err
		}
		if _, err := tx.ExecContext(c, "UPDATE dbm_items SET price = price + 100 WHERE id = $1", 2); err != nil {
			return err
		}
		if _, err := tx.ExecContext(c, "ROLLBACK TO SAVEPOINT sp1"); err != nil {
			return err
		}
		return tx.Commit()
	})
	step(ctx, "S10", func(c context.Context) error {
		rows, err := db.QueryContext(c, "SELECT 1")
		if err != nil {
			return err
		}
		return rows.Close()
	})
	step(ctx, "S11", func(c context.Context) error {
		_, err := db.QueryContext(c, "SELECT no_such_column FROM dbm_items")
		if err == nil {
			fmt.Println("[go-pg] S11 UNEXPECTEDLY SUCCEEDED")
			os.Exit(1)
		}
		fmt.Printf("[go-pg] S11 expected error: %v\n", err)
		return nil
	})

	// S12 — deadlock: NOT run in this cell (Java×PG / .NET×PG only per spec)

	flushCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	if err := tp.Shutdown(flushCtx); err != nil {
		panic(err)
	}
	fmt.Println("[go-pg] workload complete")
}
