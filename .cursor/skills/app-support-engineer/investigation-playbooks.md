# Investigation playbooks

Layer-specific evidence collection. Use only sections relevant to the incident.

---

## Frontend

**Stacks:** React, Next.js, Vue, Angular, HTML/CSS, Tailwind, TypeScript

| Check | How |
|-------|-----|
| Console errors | Browser devtools, browser MCP snapshots |
| Network failures | Failed requests, status codes, CORS, timeouts |
| Rendering / hydration | Mismatch errors, SSR vs client state |
| Routing | 404s, redirect loops, middleware blocks |
| State | Stale cache, wrong initial data, race conditions |
| Performance | Bundle size, LCP, memory leaks, unnecessary re-renders |
| Responsive / a11y | Layout breaks, focus traps |

**Common root causes:** Missing env var on client, API contract change, auth cookie not set, infinite redirect, uncaught promise rejection.

---

## Backend

**Stacks:** Node.js, Express, NestJS, Laravel, Python, Java Spring, .NET

| Check | How |
|-------|-----|
| HTTP status & body | Reproduce request, inspect response |
| Exception handling | Server logs, stack traces |
| Auth / authz | Token expiry, wrong role, middleware order |
| Validation | 400 vs 500, schema mismatches |
| Service dependencies | Downstream API, queue, cache failures |
| Business logic | Trace code path from controller to data layer |

**Common root causes:** Unhandled exception, missing middleware, wrong HTTP method, dependency timeout, idempotency bug.

---

## Database

**Systems:** PostgreSQL, MySQL, SQL Server, Oracle, MongoDB, Redis

| Check | How |
|-------|-----|
| Connection failures | Pool exhaustion, wrong host/credentials, SSL |
| Slow queries | `EXPLAIN ANALYZE`, pg_stat_statements, slow query log |
| Locks / deadlocks | `pg_locks`, deadlock graphs, transaction isolation |
| Missing data | Row counts, FK integrity, soft-delete filters |
| Duplicates | Unique constraint violations, race on insert |
| Migrations | Pending migrations, failed apply, ordering |
| Replication lag | Read replica delay |

**Actions:** Generate optimized SQL (indexes, query rewrite) when evidence supports it. Never run destructive SQL on production without explicit approval.

---

## Infrastructure

**Systems:** Linux, Windows Server, Docker, Kubernetes, Nginx, Apache, IIS

| Check | How |
|-------|-----|
| CPU / RAM / disk | `top`, `df`, container metrics |
| Processes & services | `systemctl`, `docker ps`, pod status |
| Ports | `ss -tlnp`, port conflicts, bind failures |
| Container restarts | CrashLoopBackOff, OOMKilled, exit codes |
| Reverse proxy | Nginx/Apache error logs, upstream timeouts |

---

## Cloud

**Providers:** AWS, Azure, Google Cloud

| Check | How |
|-------|-----|
| Compute | EC2/ECS/Lambda health, task failures |
| Load balancers | Target health, 502/503 from unhealthy targets |
| Storage | S3 permissions, bucket policy |
| IAM | Permission denied, role assumption |
| Networking | Security groups, VPC, NAT |
| Observability | CloudWatch alarms, log groups |

---

## Enterprise monitoring

**Tools:** Grafana, Prometheus, Kibana, Elastic, Datadog, New Relic, Splunk, Sentry

| Analyze | Look for |
|---------|----------|
| Error rate spike | New deploy correlation, specific endpoint |
| Latency p95/p99 | DB, external API, cold start |
| Traces | Slow span, missing downstream |
| Alerts | Firing rules, threshold vs real impact |
| Dashboards | CPU, memory, queue depth, cache hit ratio |

Correlate monitoring timestamps with deploy and config change timeline.

---

## Networking

| Symptom | Investigate |
|---------|-------------|
| Connection refused | Service down, wrong port, firewall |
| Timeout | Proxy, LB idle timeout, slow backend |
| SSL/TLS errors | Cert expiry, hostname mismatch, mixed content |
| DNS failures | TTL, wrong record, internal vs external DNS |
| 502/504 | Gateway timeout, upstream unavailable |

---

## Security

| Area | Review |
|------|--------|
| Authentication | JWT expiry, session fixation, refresh flow |
| Authorization | RBAC gaps, IDOR, privilege escalation |
| Injection | SQL, XSS, command injection in inputs |
| Secrets | Hardcoded keys, leaked env in logs |
| CSRF / CORS | Misconfigured origins, missing tokens |

Flag vulnerabilities with severity; separate security findings from functional bugs.

---

## Log analysis

**Formats:** Node, Spring, PHP, Docker, K8s, Nginx, Apache, Windows Event Log, syslog

**Process:**

1. Identify **first failure** in timeline (not loudest error).
2. Map **request ID / trace ID** across services.
3. Extract **stack trace** — root frame in app code, not framework wrapper.
4. Note **frequency** — one-off vs sustained.
5. Correlate with **deploy / migration / config** events.

**Auto-identify:** impacted services, probable fix category (config, code, capacity, dependency).

---

## Deployment analysis

| Check | How |
|-------|-----|
| Build failure | CI logs, TypeScript errors, test failures |
| Deploy failure | Rollout status, health checks |
| Config drift | Env diff dev vs prod |
| Missing env vars | Startup errors, undefined at runtime |
| Broken migrations | Migration log, schema version table |
| Dependency conflicts | lockfile diff, peer dependency warnings |
| Version mismatch | Runtime vs build Node version, API version |

---

## Performance analysis

| Layer | Metrics / actions |
|-------|-------------------|
| API | Response times, p95, throughput, error rate |
| Database | Query time, connections, index usage, cache hit ratio |
| Frontend | Bundle size, Lighthouse, hydration time, Core Web Vitals |
| Infrastructure | CPU, memory, thread pool, GC pauses |
| Network | Latency, payload size, compression |

Suggest **concrete** optimizations (index, cache key, code path, CDN, connection pool size) tied to measured evidence.

---

## Environment comparison

When prod fails but dev works:

1. Diff env vars (names and presence, not secret values).
2. Diff dependency versions and build flags.
3. Diff data volume and feature flags.
4. Diff infrastructure (replicas, region, SSL termination).
5. Diff migration state.
