import { KnowledgeRelationType } from "@prisma/client";
import { getEnv } from "../../../config/env";
import type {
  AssembleLessonPersonalMemoryContextInput,
  LessonPersonalMemoryContext,
  LessonPersonalMemoryLearningGoalMode,
} from "../knowledge-engine.types";
import { buildCategoryNormalizedKeyV1 } from "../knowledge-keys";
import * as knowledgeContextRepository from "../repositories/knowledge-context.repository";
import {
  mapLessonSignalsToTaxonomyV1,
  type CategoryTaxonomyV1Patch,
} from "./category-taxonomy.service";
import { getDnaLessonContextHints } from "./knowledge-dna.service";

const MAX_NODES_SCAN = 24;
const MAX_BULLETS = 3;
const MAX_CONTEXT_BULLETS_TOTAL = 6;
const MAX_BULLET_LEN = 140;
const TOPIC_TOKEN_MIN_LEN = 3;
/** Slice G — expand graph from this many top direct picks (by score). */
const MAX_GRAPH_ANCHORS = 2;
const MAX_NEIGHBOR_IDS = 14;
const MAX_GRAPH_HINTS = 2;
/** Slice H — small boost when stored category.domain matches current session domain bucket. */
const SAME_DOMAIN_SCORE_BOOST = 2;

/**
 * Slice B + G — deterministic memory context for lesson generation (direct + bounded 1-hop graph).
 *
 * Direct retrieval (unchanged core):
 * - Recent SESSION_LESSON + ATOMIC_CONCEPT nodes; exclude exact `session.id` as sourceId.
 * - Score by category key, metadata topic, token overlap; top picks for bullets.
 *
 * Slice G (soft, bounded graph):
 * - Top `MAX_GRAPH_ANCHORS` direct picks as anchors; load RELATED_TO + REINFORCES edges incident to them.
 * - Rank neighbor nodes by topic relevance + relation boost + anchor strength + tiny recency/confidence/DNA bumps.
 * - Emit up to `MAX_GRAPH_HINTS` compact `graphHints` lines (separate from memory bullets; same prompt block).
 * - Any graph DB failure → log and continue with direct-only context.
 *
 * No Prisma in callers; no LLM here.
 */
export async function assembleLessonPersonalMemoryContext(
  input: AssembleLessonPersonalMemoryContextInput,
): Promise<LessonPersonalMemoryContext | undefined> {
  if (!getEnv().KNOWLEDGE_CONTEXT_INJECTION_ENABLED) {
    return undefined;
  }

  const topicTrim = input.session.topic.trim();
  const curiosityTrim = input.session.curiosityPrompt.trim();
  const topicLower = topicTrim.toLowerCase();
  const normalizedKey = buildCategoryNormalizedKeyV1(topicTrim, curiosityTrim);
  const sessionTaxonomy = mapLessonSignalsToTaxonomyV1({
    topic: topicTrim,
    curiosityPrompt: curiosityTrim,
  });
  const sessionDomainBucket = sessionTaxonomy.domain ?? null;

  const rows = await knowledgeContextRepository.listRecentKnowledgeNodesForLessonContext({
    userId: input.userId,
    excludeSourceId: input.session.id,
    take: MAX_NODES_SCAN,
  });

  const dnaHints = await getDnaLessonContextHints(input.userId);
  const dnaRankingBoost = dnaHints.length > 0;

  let memoryBulletsFromNodes: string[] = [];
  let learningGoalMode: LessonPersonalMemoryLearningGoalMode = "gentle_repetition";
  let graphHints: string[] = [];

  if (rows.length > 0) {
    const topicTokens = tokenizeForOverlap(topicTrim);
    const scored = rows.map((row) => ({
      row,
      score: scoreNodeRelevance({
        row,
        normalizedKey,
        topicLower,
        topicTokens,
        sessionDomainBucket,
      }),
    }));

    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.row.updatedAt.getTime() - a.row.updatedAt.getTime();
    });

    let picks = scored.filter((s) => s.score > 0).slice(0, MAX_BULLETS);
    if (picks.length === 0) {
      picks = scored.slice(0, 1);
    }
    const maxPickScore = picks.reduce((m, p) => Math.max(m, p.score), 0);
    const pickedPositive = picks.some((p) => p.score > 0);
    learningGoalMode = resolveLearningGoalMode({
      maxPickScore,
      pickedPositive,
    });

    memoryBulletsFromNodes = picks.map((p) => formatMemoryBullet(p.row)).filter(Boolean);

    try {
      graphHints = await expandGraphNeighborHints({
        userId: input.userId,
        excludeSourceId: input.session.id,
        picks,
        normalizedKey,
        topicLower,
        topicTokens,
        sessionDomainBucket,
        dnaRankingBoost,
      });
    } catch (error) {
      console.error("[knowledge_context_graph_expand_failed]", {
        userId: input.userId,
        sessionId: input.session.id,
        error,
      });
      graphHints = [];
    }
  }

  const memoryBullets = [...dnaHints, ...memoryBulletsFromNodes].slice(0, MAX_CONTEXT_BULLETS_TOTAL);
  if (memoryBullets.length === 0 && graphHints.length === 0) {
    return undefined;
  }

  const categoryTaxonomyHint = buildCategoryTaxonomyHintLine(sessionTaxonomy);

  const out: LessonPersonalMemoryContext = {
    learningGoalMode,
    memoryBullets,
  };
  if (graphHints.length > 0) {
    out.graphHints = graphHints;
  }
  if (categoryTaxonomyHint !== undefined) {
    out.categoryTaxonomyHint = categoryTaxonomyHint;
  }
  return out;
}

type ScoredPick = {
  row: knowledgeContextRepository.KnowledgeContextNodeRow;
  score: number;
};

/**
 * Slice G — one-hop neighbors via RELATED_TO / REINFORCES only; deterministic ranking; compact strings.
 */
async function expandGraphNeighborHints(input: {
  userId: string;
  excludeSourceId: string;
  picks: ScoredPick[];
  normalizedKey: string;
  topicLower: string;
  topicTokens: string[];
  sessionDomainBucket: string | null;
  dnaRankingBoost: boolean;
}): Promise<string[]> {
  const anchors = input.picks.slice(0, MAX_GRAPH_ANCHORS);
  if (anchors.length === 0) {
    return [];
  }

  const anchorIds = new Set(anchors.map((a) => a.row.id));
  const anchorMaxScore = Math.max(...anchors.map((a) => a.score), 0);

  const edges = await knowledgeContextRepository.findEdgesIncidentToNodes({
    userId: input.userId,
    nodeIds: [...anchorIds],
    relationTypes: [KnowledgeRelationType.RELATED_TO, KnowledgeRelationType.REINFORCES],
  });

  /** Neighbor node id → best relation meta seen from any anchor edge. */
  const neighborMeta = new Map<
    string,
    { relation: KnowledgeRelationType; relationBoost: number }
  >();

  for (const edge of edges) {
    let neighborId: string | null = null;
    if (anchorIds.has(edge.fromNodeId) && !anchorIds.has(edge.toNodeId)) {
      neighborId = edge.toNodeId;
    } else if (anchorIds.has(edge.toNodeId) && !anchorIds.has(edge.fromNodeId)) {
      neighborId = edge.fromNodeId;
    }
    if (!neighborId) continue;
    if (neighborId === input.excludeSourceId) continue;

    const relationBoost =
      edge.relationType === KnowledgeRelationType.REINFORCES ? 4 : 2;
    const prev = neighborMeta.get(neighborId);
    if (!prev || relationBoost > prev.relationBoost) {
      neighborMeta.set(neighborId, {
        relation: edge.relationType,
        relationBoost,
      });
    }
  }

  const directTitles = new Set(
    anchors.map((a) => a.row.title.replace(/\s+/g, " ").trim().toLowerCase()),
  );

  const neighborIds = [...neighborMeta.keys()].slice(0, MAX_NEIGHBOR_IDS);
  if (neighborIds.length === 0) {
    return [];
  }

  const neighbors = await knowledgeContextRepository.findKnowledgeContextNodesByIds({
    userId: input.userId,
    ids: neighborIds,
  });

  const ranked = neighbors
    .map((row) => {
      const meta = neighborMeta.get(row.id);
      if (!meta) return null;
      if (directTitles.has(row.title.replace(/\s+/g, " ").trim().toLowerCase())) {
        return null;
      }

      let total =
        scoreNodeRelevance({
          row,
          normalizedKey: input.normalizedKey,
          topicLower: input.topicLower,
          topicTokens: input.topicTokens,
          sessionDomainBucket: input.sessionDomainBucket,
        }) +
        meta.relationBoost +
        Math.min(5, Math.floor(anchorMaxScore * 0.25));

      if (input.dnaRankingBoost) {
        total += 0.5;
      }
      const conf = readMetadataConfidence(row.metadataJson);
      if (conf !== undefined && conf >= 0.7) {
        total += 0.5;
      }

      return { row, total, relation: meta.relation };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  ranked.sort((a, b) => {
    if (b.total !== a.total) return b.total - a.total;
    return b.row.updatedAt.getTime() - a.row.updatedAt.getTime();
  });

  return ranked
    .slice(0, MAX_GRAPH_HINTS)
    .map(({ row, relation }) => formatGraphHintBullet(row, relation));
}

function formatGraphHintBullet(
  row: knowledgeContextRepository.KnowledgeContextNodeRow,
  relation: KnowledgeRelationType,
): string {
  const title = truncateSingleLine(row.title, 64);
  const summary = row.summary
    ? truncateSingleLine(row.summary, MAX_BULLET_LEN - title.length - 24)
    : "";
  const relLabel =
    relation === KnowledgeRelationType.REINFORCES ? "lesson-linked" : "related";
  const tail = summary.length > 0 ? ` — ${summary}` : "";
  const line = `Near idea (${relLabel}): “${title}”${tail}`;
  return truncateSingleLine(line, MAX_BULLET_LEN);
}

function buildCategoryTaxonomyHintLine(patch: CategoryTaxonomyV1Patch): string | undefined {
  if (!patch.domain) {
    return undefined;
  }
  const parts = [patch.domain];
  if (patch.subdomain) {
    parts.push(patch.subdomain);
  }
  return truncateSingleLine(`Coarse topic bucket: ${parts.join(" / ")}`, 118);
}

function resolveLearningGoalMode(input: {
  maxPickScore: number;
  pickedPositive: boolean;
}): LessonPersonalMemoryLearningGoalMode {
  if (input.maxPickScore >= 5) {
    return "reinforcement";
  }
  if (input.pickedPositive) {
    return "gentle_repetition";
  }
  return "novelty";
}

function scoreNodeRelevance(input: {
  row: knowledgeContextRepository.KnowledgeContextNodeRow;
  normalizedKey: string;
  topicLower: string;
  topicTokens: string[];
  sessionDomainBucket: string | null;
}): number {
  let score = 0;
  if (input.row.category?.normalizedKey === input.normalizedKey) {
    score += 5;
  }

  const rowDomain = input.row.category?.domain?.trim();
  if (
    input.sessionDomainBucket &&
    rowDomain &&
    rowDomain === input.sessionDomainBucket
  ) {
    score += SAME_DOMAIN_SCORE_BOOST;
  }

  const metaTopic = readMetadataTopic(input.row.metadataJson);
  if (metaTopic !== undefined && metaTopic.toLowerCase() === input.topicLower) {
    score += 3;
  }

  const haystack = `${input.row.title}\n${input.row.summary ?? ""}`.toLowerCase();
  for (const token of input.topicTokens) {
    if (haystack.includes(token)) {
      score += 1;
    }
  }

  return score;
}

function readMetadataTopic(metadataJson: unknown): string | undefined {
  if (!metadataJson || typeof metadataJson !== "object" || Array.isArray(metadataJson)) {
    return undefined;
  }
  const topic = (metadataJson as Record<string, unknown>).topic;
  return typeof topic === "string" ? topic : undefined;
}

function readMetadataConfidence(metadataJson: unknown): number | undefined {
  if (!metadataJson || typeof metadataJson !== "object" || Array.isArray(metadataJson)) {
    return undefined;
  }
  const c = (metadataJson as Record<string, unknown>).confidence;
  return typeof c === "number" && Number.isFinite(c) ? c : undefined;
}

function tokenizeForOverlap(topic: string): string[] {
  const lower = topic.toLowerCase();
  const tokens = lower.match(/[\p{L}\p{N}]+/gu) ?? [];
  return tokens.filter((t) => t.length >= TOPIC_TOKEN_MIN_LEN);
}

function formatMemoryBullet(
  row: knowledgeContextRepository.KnowledgeContextNodeRow,
): string {
  const title = truncateSingleLine(row.title, 72);
  const summary = row.summary ? truncateSingleLine(row.summary, MAX_BULLET_LEN - title.length - 8) : "";
  const tail = summary.length > 0 ? ` — ${summary}` : "";
  const line = `Earlier thread: “${title}”${tail}`;
  return truncateSingleLine(line, MAX_BULLET_LEN);
}

function truncateSingleLine(text: string, max: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, max - 1))}…`;
}
