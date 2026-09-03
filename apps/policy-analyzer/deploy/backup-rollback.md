# Backup, restore, and rollback

No destructive production recovery test is authorized.

## Database backup

Use the staging project's point-in-time or daily backup from the isolated Supabase project. Confirm a backup exists before the first migration apply. Restore is performed only onto that same isolated project or a disposable clone.

## Storage objects

Private `policy-files` objects follow the staging project's object lifecycle. Deleted objects are recoverable only within the provider's retention window. Application rollback does not recreate purged files.

## Migration rollback

Fix #7 adds `20260903220000_fix7_staging_ops.sql`. It is additive: a schema-version key and service-role ops functions. Rolling the application back to Fix #6 does not require dropping those objects. Do not edit or replay accepted Fix #5 or Fix #6 migrations.

If the Fix #7 functions must be removed from an isolated staging database:

```sql
drop function if exists analyzer_ops_snapshot();
drop function if exists analyzer_schema_version();
delete from analyzer_runtime_config
 where config_key in ('schema_version', 'fix7_staging_ops');
```

## Application and worker rollback

1. Stop the newer worker.
2. Deploy the accepted Fix #6 image/SHA `60d3de8d952cdd059c26d333876f8557dbf6cb4d` for web and worker.
3. Keep staging uploads disabled until readiness passes on the rolled-back pair.
4. Restart one worker and confirm it claims only leased or queued jobs.

## Secret rotation

Rotate the staging service-role key, anon key, and ops token in the platform secret store, then restart web and worker separately. Do not print the new values.

## Failed deployment

Leave the previous image running until the new image passes liveness and authenticated readiness. If the new worker fails configuration, it exits nonzero and does not claim jobs.

## Job recovery after worker restart

In-flight jobs remain `processing` until the lease expires. Another worker reclaims them within `max_job_attempts`. Cancellation and checksum failures stay terminal.

## Newer-version jobs after rollback

A job enqueued by Fix #7 remains a normal durable row. The Fix #6 worker can claim it. If the payload is malformed for the older parser, lease recovery and the attempt ceiling apply; no report is published.
