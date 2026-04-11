"""
DAG: tenant_mfa_analytics
Runs every 5 minutes. Queries ClickHouse for MFA event stats per tenant
over the last 5-minute window and publishes a summary message per tenant
to the Kafka topic `mfa-analytics`.
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timedelta

import requests
from airflow import DAG
from airflow.operators.python import PythonOperator

CLICKHOUSE_URL = os.getenv("CLICKHOUSE_URL", "http://clickhouse:8123")
CLICKHOUSE_USER = os.getenv("CLICKHOUSE_USER", "pushmfa")
CLICKHOUSE_PASSWORD = os.getenv("CLICKHOUSE_PASSWORD", "secret")
CLICKHOUSE_DB = os.getenv("CLICKHOUSE_DB", "pushmfa")
KAFKA_BOOTSTRAP_SERVERS = os.getenv("KAFKA_BOOTSTRAP_SERVERS", "redpanda:9092")
KAFKA_TOPIC = os.getenv("KAFKA_TOPIC", "mfa-analytics")


def _query_clickhouse(sql: str) -> list[dict]:
    response = requests.post(
        f"{CLICKHOUSE_URL}/",
        params={"database": CLICKHOUSE_DB, "default_format": "JSONEachRow"},
        data=sql,
        auth=(CLICKHOUSE_USER, CLICKHOUSE_PASSWORD),
        timeout=30,
    )
    response.raise_for_status()
    rows = []
    for line in response.text.strip().splitlines():
        if line:
            rows.append(json.loads(line))
    return rows


def _build_report_text(row: dict, window_start: str, window_end: str) -> str:
    active_users = row.get("active_users", [])
    if isinstance(active_users, str):
        active_users = json.loads(active_users)
    user_list = ", ".join(active_users[:10])
    if len(active_users) > 10:
        user_list += f" ... (+{len(active_users) - 10} more)"

    return "\n".join([
        "=" * 60,
        "  Push MFA — Tenant Analytics Summary",
        f"  Window  : {window_start} → {window_end} UTC",
        f"  Tenant  : {row['tenant_id']}",
        "-" * 60,
        f"  Total challenges : {row['total']}",
        f"  Accepted         : {row['accepted']}",
        f"  Denied           : {row['denied']}",
        f"  Timed out        : {row['timed_out']}",
        f"  Push failed      : {row['push_failed']}",
        f"  Acceptance rate  : {row['acceptance_rate_pct']}%",
        f"  Active users     : {user_list or '—'}",
        "=" * 60,
    ])


def publish_tenant_summaries(**context) -> None:
    from confluent_kafka import Producer
    from confluent_kafka.admin import AdminClient, NewTopic

    execution_dt: datetime = context["data_interval_end"]
    window_end = execution_dt.replace(tzinfo=None)
    window_start = window_end - timedelta(minutes=5)
    window_start_str = window_start.strftime("%Y-%m-%d %H:%M:%S")
    window_end_str = window_end.strftime("%Y-%m-%d %H:%M:%S")

    # Ensure topic exists
    admin = AdminClient({"bootstrap.servers": KAFKA_BOOTSTRAP_SERVERS})
    existing = admin.list_topics(timeout=10).topics
    if KAFKA_TOPIC not in existing:
        admin.create_topics([NewTopic(KAFKA_TOPIC, num_partitions=1, replication_factor=1)])

    sql = f"""
        SELECT
            tenant_id,
            count()                                                   AS total,
            countIf(outcome = 'accepted')                             AS accepted,
            countIf(outcome = 'denied')                               AS denied,
            countIf(outcome = 'timed_out')                            AS timed_out,
            countIf(outcome = 'push_failed')                          AS push_failed,
            round(countIf(outcome = 'accepted') / count() * 100, 1)  AS acceptance_rate_pct,
            groupArray(DISTINCT username)                             AS active_users
        FROM mfa_events
        WHERE event_time >= toDateTime('{window_start_str}')
          AND event_time <  toDateTime('{window_end_str}')
        GROUP BY tenant_id
        ORDER BY total DESC
    """

    rows = _query_clickhouse(sql)

    producer = Producer({"bootstrap.servers": KAFKA_BOOTSTRAP_SERVERS})

    if not rows:
        # Publish a heartbeat so consumers know the window ran with no events
        payload = {
            "window_start": window_start_str,
            "window_end": window_end_str,
            "tenant_id": None,
            "report": f"No MFA events in window {window_start_str} → {window_end_str} UTC",
        }
        producer.produce(
            KAFKA_TOPIC,
            key="heartbeat",
            value=json.dumps(payload),
        )
    else:
        for row in rows:
            report_text = _build_report_text(row, window_start_str, window_end_str)
            payload = {
                "window_start": window_start_str,
                "window_end": window_end_str,
                "tenant_id": row["tenant_id"],
                "total": int(row["total"]),
                "accepted": int(row["accepted"]),
                "denied": int(row["denied"]),
                "timed_out": int(row["timed_out"]),
                "push_failed": int(row["push_failed"]),
                "acceptance_rate_pct": float(row["acceptance_rate_pct"]),
                "report": report_text,
            }
            producer.produce(
                KAFKA_TOPIC,
                key=row["tenant_id"],   # partition by tenant
                value=json.dumps(payload),
            )
            print(report_text)

    producer.flush()
    print(f"Published {len(rows) or 1} message(s) to topic '{KAFKA_TOPIC}'")


with DAG(
    dag_id="tenant_mfa_analytics",
    description="Per-tenant MFA analytics summary every 5 minutes → Kafka",
    schedule_interval="*/1 * * * *",
    start_date=datetime(2026, 1, 1),
    catchup=False,
    default_args={
        "retries": 1,
        "retry_delay": timedelta(minutes=1),
    },
    tags=["analytics", "mfa", "kafka"],
) as dag:
    PythonOperator(
        task_id="publish_tenant_summaries",
        python_callable=publish_tenant_summaries,
    )
