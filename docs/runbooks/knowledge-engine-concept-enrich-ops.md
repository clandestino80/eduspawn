# Runbook: single-concept article enrich (ops)

Internal operator notes for **`POST /api/v1/knowledge-engine/concepts/:slug/enrich`**.

## Purpose

Runs deterministic article seed (if missing and taxonomy allows) plus bounded AI enrichment for one **GlobalConcept** by slug. Not a public wiki write API: **JWT auth** and **knowledge-ops allow-list** are required.

## Auth and environment

- All `/api/v1/knowledge-engine/*` routes use **`requireAuth`**.
- This **POST** additionally uses **`requireKnowledgeOps`** (deny-by-default if both lists are empty).
- Allow-list (comma-separated, whitespace trimmed after split):

```env
# JWT `sub` values (from access token payload)
KNOWLEDGE_OPS_ALLOWED_USER_IDS=uuid-one,uuid-two

# JWT email, case-insensitive match
KNOWLEDGE_OPS_ALLOWED_EMAILS=ops.user@example.com,other@example.com
```

Replace values with real operator identities in deployment config; do not commit secrets.

## Query parameters

| Query     | Values                         | Effect                                      |
| --------- | ------------------------------ | ------------------------------------------- |
| `dryRun`  | `true`, `1`, `yes` → dry run   | Preview only; default is live when omitted |
| `dryRun`  | `false`, `0` or omit (default) | Live path when flags allow writes           |

Schema: `globalConceptEnrichOpsQuerySchema` in `knowledge-engine.schema.ts`.

## HTTP outcomes (operator-facing)

| Situation                         | Status | Notes |
| --------------------------------- | ------ | ----- |
| Success (including skip outcomes) | **200** | Body: `{ success, data }` — see outcome codes below |
| Concept missing                   | **404** | `code: NOT_FOUND` |
| Not authenticated                 | **401** | Standard auth |
| Authenticated but not allow-listed | **403** | `code: KNOWLEDGE_OPS_FORBIDDEN` |

## Response `data.outcome` codes

Aligned with `SingleConceptArticleEnrichOpsOutcomeCode` in `global-concept-article-enrich-ops.service.ts`:

| `outcome`               | Typical meaning |
| ----------------------- | ----------------- |
| `enriched`              | AI enrichment applied to an existing deterministic article |
| `seeded_then_enriched`  | Seed created this request, then enrichment applied |
| `dry_run`               | Dry-run query; no writes from this request |
| `not_found`             | No `GlobalConcept` row for slug (HTTP 404) |
| `skipped_disabled`      | Article or enrichment disabled via env flags |
| `skipped_noop`          | Enrichment ran but no effective change |
| `skipped_not_eligible`  | Row not eligible (e.g. already `ai_enriched_v1`, bad taxonomy for seed) |
| `skipped_validation`    | Model output failed validation; article unchanged |
| `skipped_race`          | Row changed underfoot; enrichment not applied |
| `failed`                | Seed or enrichment failure; check logs |

## Audit logs (grep)

Single prefix for ops auth and enrich flow:

```text
[ke_ops]
```

Suggested filters:

- Allow vs deny: `"event":"auth_ok"` / `"event":"auth_denied"`
- Enrich lifecycle: `"event":"enrich_start"` → `"event":"enrich_dry_run"` or `"event":"enrich_complete"`
- By slug: `"slug":"<your-slug>"`
- By operator id when passed through: `"userId":"<jwt-sub>"` (from controller `logContext`)

Deeper pipeline detail may still appear under tags such as `[global_concept_article_enrichment_*]` when debugging the AI layer.

## Internal error / response codes (HTTP errors only)

| HTTP | `code` (AppError)           | When |
| ---- | --------------------------- | ---- |
| 400  | `VALIDATION_ERROR`          | Missing slug, slug too long, bad query |
| 401  | `AUTH_UNAUTHORIZED`         | Missing/invalid session |
| 403  | `KNOWLEDGE_OPS_FORBIDDEN`   | Not on allow-list |
| 404  | `NOT_FOUND`                 | Unknown concept slug for enrich |

Successful responses use the envelope above; skipped paths are **200** with `success: true` unless `outcome` is `failed`.

## Examples (no real tokens)

Set placeholders:

- `BASE` — API origin, e.g. `https://api.example.com`
- `SLUG` — URL-encoded concept slug
- `ACCESS_TOKEN` — short-lived JWT from your auth flow (never paste into tickets or commit)

### curl — dry run

```bash
curl -sS -X POST "$BASE/api/v1/knowledge-engine/concepts/$SLUG/enrich?dryRun=true" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json"
```

### curl — live enrich

```bash
curl -sS -X POST "$BASE/api/v1/knowledge-engine/concepts/$SLUG/enrich" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json"
```

### curl — expect 403 (forbidden)

Use a valid JWT for a user **not** on `KNOWLEDGE_OPS_ALLOWED_*`:

```bash
curl -sS -o body.txt -w "%{http_code}" -X POST "$BASE/api/v1/knowledge-engine/concepts/$SLUG/enrich?dryRun=true" \
  -H "Authorization: Bearer $ACCESS_TOKEN_NON_OPS" \
  -H "Content-Type: application/json"
```

Expect HTTP **403** and JSON containing `KNOWLEDGE_OPS_FORBIDDEN`.

### curl — expect 404 (not found)

```bash
curl -sS -o body.txt -w "%{http_code}" -X POST "$BASE/api/v1/knowledge-engine/concepts/definitely-missing-slug-xyz/enrich?dryRun=true" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json"
```

Expect HTTP **404** when no concept exists.

### PowerShell — dry run

```powershell
$Base = "https://api.example.com"
$Slug = "your-concept-slug"
$Headers = @{ Authorization = "Bearer $env:ACCESS_TOKEN" }
Invoke-RestMethod -Method Post -Uri "$Base/api/v1/knowledge-engine/concepts/$Slug/enrich?dryRun=true" -Headers $Headers
```

### PowerShell — live enrich

```powershell
Invoke-RestMethod -Method Post -Uri "$Base/api/v1/knowledge-engine/concepts/$Slug/enrich" -Headers $Headers
```

Use a secret store or CI variable for the token string; avoid literals in scripts checked into git.

## Related code

- Route: `knowledge-engine.routes.ts`
- Controller: `enrichGlobalConceptArticleBySlugController` in `knowledge-engine.controller.ts`
- Service: `runSingleConceptArticleEnrichmentBySlugForOpsV1` in `global-concept-article-enrich-ops.service.ts`
- Middleware: `knowledge-ops.middleware.ts`
- Env: `KNOWLEDGE_OPS_*` in `env.ts`
