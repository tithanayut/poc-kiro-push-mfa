CREATE TABLE IF NOT EXISTS pushmfa.mfa_events
(
    event_time   DateTime DEFAULT now(),
    request_id   String,
    tenant_id    String,
    user_id      String,
    app_id       String,
    app_name     String,
    username     String,
    outcome      LowCardinality(String),  -- 'accepted' | 'denied' | 'timed_out' | 'push_failed'
    message      String
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(event_time)
ORDER BY (tenant_id, event_time)
TTL event_time + INTERVAL 1 YEAR;
