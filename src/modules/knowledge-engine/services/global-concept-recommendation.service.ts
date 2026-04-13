import { withReadDbRetry } from "../../../lib/read-with-db-retry";
import { learningDnaSignalsV1Schema } from "../knowledge-engine.schema";
import type { GlobalConceptRowWithArticleAndCategoryCount } from "../repositories/global-concept-read.repository";
import * as globalConceptReadRepository from "../repositories/global-concept-read.repository";
import * as knowledgeEngineReadRepository from "../repositories/knowledge-engine-read.repository";

const CANDIDATE_POOL_SIZE = 280;

/** Stable codes for clients; pair with `recommendationReason` copy. */
export type GlobalConceptRecommendationReasonCode =
  | "matches_recent_learning"
  | "matches_favorite_topics"
  | "matches_recent_themes"
  | "featured";

export type GlobalConceptRecommendationItemDto = {
  slug: string;
  displayTitle: string;
  domain: string | null;
  subdomain: string | null;
  microTopic: string | null;
  updatedAt: string;
  article: {
    hasArticle: boolean;
    summary: string | null;
    hook: string | null;
  };
  stats: {
    linkedCategoriesCount: number;
  };
  recommendationReason: string;
  recommendationReasonCode: GlobalConceptRecommendationReasonCode;
  /** Deterministic composite rank (0–1000) for ordering and light UI hints. */
  rankScore: number;
};

type ReasonCode = GlobalConceptRecommendationReasonCode;

const REASON_COPY: Record<ReasonCode, string> = {
  matches_recent_learning: "Matches your recent learning",
  matches_favorite_topics: "Connected to your favorite topics",
  /** Domain appears in domains inferred from your category activity (stronger than DNA-only domain hints). */
  matches_recent_themes: "Aligned with your recent themes",
  featured: "Featured concept",
};

/** Same `recommendationReasonCode`; softer copy when theme overlap comes only from learning-profile domains, not category-derived domains. */
const REASON_COPY_THEME_SIGNAL_ONLY =
  "Relates to broader themes in your learning profile";

function shortSummary(text: string | null | undefined, max = 320): string | null {
  if (!text?.trim()) return null;
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1).replace(/\s+\S*$/, "").trim()}…`;
}

function recencyBoost(updatedAt: Date): number {
  const days = (Date.now() - updatedAt.getTime()) / 86_400_000;
  return Math.max(0, 36 - Math.min(days, 36));
}

const ENRICHED_ARTICLE_SOURCE = "ai_enriched_v1";
const DETERMINISTIC_SEED_SOURCE = "deterministic_seed_v1";

function relatedQuestionCountFromJson(json: unknown): number {
  if (!Array.isArray(json)) return 0;
  return json.filter((x): x is string => typeof x === "string" && x.trim().length > 0).length;
}

/**
 * Deterministic article “readiness” for ranking: length/completeness and provenance, not semantics.
 * Capped so it stays a tie-breaker tier relative to user-relevance boosts.
 */
function articleQualityScore(row: GlobalConceptRowWithArticleAndCategoryCount): number {
  const a = row.article;
  if (!a) return 0;

  let score = 20;
  const hook = a.hook?.trim() ?? "";
  if (hook.length >= 12) score += 26;
  if (hook.length >= 48) score += 10;

  const summary = (a.summary ?? "").replace(/\s+/g, " ").trim();
  if (summary.length >= 72) score += 18;
  if (summary.length >= 180) score += 16;
  if (summary.length >= 360) score += 12;
  if (summary.length >= 720) score += 10;

  const rq = relatedQuestionCountFromJson(a.relatedQuestionsJson);
  if (rq >= 5) score += 26;
  else if (rq === 4) score += 22;
  else if (rq === 3) score += 18;
  else if (rq === 2) score += 12;
  else if (rq === 1) score += 6;

  const st = (a.sourceType ?? "").trim();
  if (st === ENRICHED_ARTICLE_SOURCE) score += 34;
  else if (st === DETERMINISTIC_SEED_SOURCE) score += 8;

  return Math.min(score, 168);
}

function baseCatalogScore(row: GlobalConceptRowWithArticleAndCategoryCount): number {
  const cats = row._count.categories;
  return articleQualityScore(row) + Math.min(cats * 8, 88) + recencyBoost(row.updatedAt);
}

function catalogScoreTieBreak(row: GlobalConceptRowWithArticleAndCategoryCount): number {
  return articleQualityScore(row) * 1_000_000 + row._count.categories * 1_000 + row.updatedAt.getTime() / 1000;
}

type ThemeReasonTone = "default" | "signal_only";

function normalizeReason(
  code: ReasonCode,
  themeTone: ThemeReasonTone = "default",
): Pick<GlobalConceptRecommendationItemDto, "recommendationReason" | "recommendationReasonCode"> {
  if (code === "matches_recent_themes" && themeTone === "signal_only") {
    return {
      recommendationReasonCode: code,
      recommendationReason: REASON_COPY_THEME_SIGNAL_ONLY,
    };
  }
  return {
    recommendationReasonCode: code,
    recommendationReason: REASON_COPY[code],
  };
}

function pickPrimaryReasonCode(input: {
  linked: boolean;
  favorite: boolean;
  theme: boolean;
  /** Domain matched a category-derived domain set (tighter than DNA-only recent domains). */
  themeFromCategories: boolean;
  mode: "user" | "featured";
}): { code: ReasonCode; themeTone: ThemeReasonTone } {
  if (input.mode === "featured") {
    return { code: "featured", themeTone: "default" };
  }
  if (input.linked) return { code: "matches_recent_learning", themeTone: "default" };
  if (input.favorite) return { code: "matches_favorite_topics", themeTone: "default" };
  if (input.theme) {
    return {
      code: "matches_recent_themes",
      themeTone: input.themeFromCategories ? "default" : "signal_only",
    };
  }
  return { code: "featured", themeTone: "default" };
}

function toRankScore(internal: number): number {
  return Math.min(1000, Math.max(0, Math.round(internal)));
}

function mapRowToDto(
  row: GlobalConceptRowWithArticleAndCategoryCount,
  code: ReasonCode,
  internalScore: number,
  themeTone: ThemeReasonTone = "default",
): GlobalConceptRecommendationItemDto {
  const hasArticle = Boolean(row.article);
  const r = normalizeReason(code, themeTone);
  return {
    slug: row.slug,
    displayTitle: row.displayTitle,
    domain: row.domain,
    subdomain: row.subdomain,
    microTopic: row.microTopic,
    updatedAt: row.updatedAt.toISOString(),
    article: {
      hasArticle,
      summary: hasArticle ? shortSummary(row.article?.summary ?? null) : null,
      hook: hasArticle ? (row.article?.hook?.trim() || null) : null,
    },
    stats: {
      linkedCategoriesCount: row._count.categories,
    },
    ...r,
    rankScore: toRankScore(internalScore),
  };
}

/**
 * Bounded second pass: keep score ordering as the primary signal, but cap how many
 * concepts may share the same domain or (domain, subdomain) pair before we dip into
 * slightly lower-ranked alternatives. A final spill fills from the global ranking if
 * the pool is small (deterministic, no randomness).
 */
function diversifyRankedCandidates<T extends { row: GlobalConceptRowWithArticleAndCategoryCount }>(
  ranked: readonly T[],
  limit: number,
): T[] {
  if (limit <= 0) return [];
  if (ranked.length === 0) return [];

  const poolSize = Math.min(ranked.length, Math.max(limit + 28, limit * 6));
  const pool = ranked.slice(0, poolSize);

  const maxPerDomain = Math.min(limit, Math.max(2, Math.ceil(limit * 0.38)));
  const maxPerPair = Math.max(1, Math.floor(limit / 4));

  const domainKey = (r: GlobalConceptRowWithArticleAndCategoryCount) =>
    (r.domain ?? "").trim().toLowerCase() || "—";
  const pairKey = (r: GlobalConceptRowWithArticleAndCategoryCount) =>
    `${domainKey(r)}\x1f${(r.subdomain ?? "").trim().toLowerCase() || "—"}`;

  const domainCounts = new Map<string, number>();
  const pairCounts = new Map<string, number>();
  const picked: T[] = [];
  const pickedSlugs = new Set<string>();
  const deferred: T[] = [];

  for (const item of pool) {
    if (picked.length >= limit) break;
    const dk = domainKey(item.row);
    const pk = pairKey(item.row);
    const dc = domainCounts.get(dk) ?? 0;
    const pc = pairCounts.get(pk) ?? 0;
    if (dc < maxPerDomain && pc < maxPerPair) {
      picked.push(item);
      pickedSlugs.add(item.row.slug);
      domainCounts.set(dk, dc + 1);
      pairCounts.set(pk, pc + 1);
    } else {
      deferred.push(item);
    }
  }

  for (const item of deferred) {
    if (picked.length >= limit) break;
    if (pickedSlugs.has(item.row.slug)) continue;
    picked.push(item);
    pickedSlugs.add(item.row.slug);
  }

  if (picked.length < limit) {
    for (const item of ranked) {
      if (picked.length >= limit) break;
      if (pickedSlugs.has(item.row.slug)) continue;
      picked.push(item);
      pickedSlugs.add(item.row.slug);
    }
  }

  return picked.slice(0, limit);
}

function favoriteTopicHit(
  row: GlobalConceptRowWithArticleAndCategoryCount,
  topics: readonly string[],
): boolean {
  if (topics.length === 0) return false;
  const slug = row.slug.toLowerCase();
  const title = row.displayTitle.toLowerCase();
  const domain = row.domain?.toLowerCase() ?? "";
  const sub = row.subdomain?.toLowerCase() ?? "";
  const micro = row.microTopic?.toLowerCase() ?? "";
  for (const raw of topics) {
    const t = raw.trim().toLowerCase();
    if (t.length < 2) continue;
    if (title.includes(t) || slug.includes(t.replace(/\s+/g, "-"))) return true;
    if (domain.includes(t) || sub.includes(t) || micro.includes(t)) return true;
  }
  return false;
}

export async function listRecommendedGlobalConceptsForReadApi(input: {
  userId: string;
  limit: number;
  domain?: string;
  subdomain?: string;
  mode: "user" | "featured";
}): Promise<GlobalConceptRecommendationItemDto[]> {
  const limit = Math.min(Math.max(1, input.limit), 30);

  const rows = await withReadDbRetry(
    "global_concept_recommendation_pool",
    () =>
      globalConceptReadRepository.findGlobalConceptsForRecommendationCandidates({
        take: CANDIDATE_POOL_SIZE,
        domain: input.domain,
        subdomain: input.subdomain,
      }),
    {
      pool: CANDIDATE_POOL_SIZE,
      domain: input.domain ?? null,
      subdomain: input.subdomain ?? null,
    },
  );

  if (input.mode === "featured") {
    const scored = rows
      .map((row) => {
        const internal = baseCatalogScore(row);
        return { row, internal };
      })
      .sort(
        (a, b) =>
          b.internal - a.internal ||
          b.row.updatedAt.getTime() - a.row.updatedAt.getTime() ||
          catalogScoreTieBreak(b.row) - catalogScoreTieBreak(a.row) ||
          a.row.slug.localeCompare(b.row.slug),
      );

    const diversified = diversifyRankedCandidates(scored, limit);
    return diversified.map((s) => mapRowToDto(s.row, "featured", s.internal));
  }

  const [dnaRow, categoryRows] = await Promise.all([
    withReadDbRetry("global_concept_recommendation_dna", () =>
      knowledgeEngineReadRepository.findLearningDnaRowForUser(input.userId),
    { userId: input.userId }),
    withReadDbRetry("global_concept_recommendation_categories", () =>
      knowledgeEngineReadRepository.findUserCategorySignalsForConceptRecommendations(input.userId),
    { userId: input.userId }),
  ]);

  const linkedConceptIds = new Set<string>();
  const categoryDomains = new Set<string>();
  for (const c of categoryRows) {
    if (c.globalConceptId) {
      linkedConceptIds.add(c.globalConceptId);
    }
    if (c.domain?.trim()) {
      categoryDomains.add(c.domain.trim());
    }
  }

  const signalsParsed = dnaRow?.signalsJson
    ? learningDnaSignalsV1Schema.safeParse(dnaRow.signalsJson)
    : null;
  const signalDomains = new Set<string>();
  if (signalsParsed?.success) {
    for (const d of signalsParsed.data.recentTaxonomyDomains ?? []) {
      if (d.trim()) signalDomains.add(d.trim());
    }
  }
  const themeDomains = new Set<string>([...categoryDomains, ...signalDomains]);

  const favoriteTopics = (dnaRow?.favoriteTopics ?? []).map((t) => t.trim()).filter(Boolean);

  const scored = rows
    .map((row) => {
      const linked = linkedConceptIds.has(row.id);
      const favorite = favoriteTopicHit(row, favoriteTopics);
      const dom = row.domain?.trim();
      const theme = Boolean(dom) && themeDomains.has(dom);
      const themeFromCategories = Boolean(dom) && categoryDomains.has(dom);
      let internal = baseCatalogScore(row);
      if (linked) internal += 520;
      if (favorite) internal += 200;
      if (theme) internal += 140;
      return { row, internal, linked, favorite, theme, themeFromCategories };
    })
    .sort(
      (a, b) =>
        b.internal - a.internal ||
        b.row.updatedAt.getTime() - a.row.updatedAt.getTime() ||
        catalogScoreTieBreak(b.row) - catalogScoreTieBreak(a.row) ||
        a.row.slug.localeCompare(b.row.slug),
    );

  const diversified = diversifyRankedCandidates(scored, limit);
  return diversified.map((s) => {
    const { code, themeTone } = pickPrimaryReasonCode({
      linked: s.linked,
      favorite: s.favorite,
      theme: s.theme,
      themeFromCategories: s.themeFromCategories,
      mode: "user",
    });
    return mapRowToDto(s.row, code, s.internal, themeTone);
  });
}
