import { GlobalTopicSourceType, GlobalTopicStatus } from "@prisma/client";
import type { GlobalTopicInventoryInsertRow } from "../repositories/global-topic-inventory.repository";
import { buildGlobalTopicNormalizedKey } from "./topic-inventory-normalization";

/**
 * ≥50 (domain, subdomain) pairs for variety intent across bootstrap/replenish templates.
 * Editorial refinement is deferred; structure + dedupe matter for Slice C.
 */
export const DOMAIN_SUBDOMAIN_PAIRS: readonly { domain: string; subdomain: string }[] = (() => {
  const pairs: { domain: string; subdomain: string }[] = [];
  const add = (domain: string, subs: readonly string[]) => {
    for (const subdomain of subs) {
      pairs.push({ domain, subdomain });
    }
  };
  add("STEM", [
    "Physics",
    "Chemistry",
    "Biology",
    "Earth Science",
    "Computer Science",
    "Mathematics",
    "Statistics",
    "Astronomy",
    "Materials Science",
    "Engineering Basics",
  ]);
  add("Humanities", [
    "History",
    "Philosophy",
    "Literature",
    "Languages",
    "Art History",
    "Cultural Studies",
    "Ethics",
    "Rhetoric",
    "Mythology",
    "Archaeology",
  ]);
  add("Life Sciences", [
    "Neuroscience",
    "Genetics",
    "Ecology",
    "Immunology",
    "Microbiology",
    "Physiology",
    "Public Health",
    "Nutrition",
    "Psychology",
  ]);
  add("Social Sciences", [
    "Economics",
    "Sociology",
    "Political Science",
    "Anthropology",
    "Geography",
    "Education",
    "Law Basics",
    "Urban Studies",
  ]);
  add("Professional Skills", [
    "Communication",
    "Leadership",
    "Project Management",
    "Data Literacy",
    "Research Methods",
    "Critical Thinking",
    "Collaboration",
    "Presentation Skills",
    "Time Management",
    "Decision Making",
  ]);
  add("Creativity & Design", [
    "Visual Design",
    "Music Theory",
    "Creative Writing",
    "Game Design",
    "Photography",
    "Film Studies",
    "Architecture Basics",
    "Fashion",
    "Craft",
    "Storytelling",
  ]);
  return pairs;
})();

const TITLE_FRAGMENTS = [
  "Core ideas",
  "Guided exploration",
  "Concept map",
  "Foundational questions",
  "Practice lenses",
  "Big picture",
  "Connections",
  "Skill transfer",
  "Mental models",
  "Guided curiosity",
] as const;

const CURIOSITY_HOOKS = [
  "What are the first principles worth anchoring here?",
  "Where do beginners usually misunderstand this area?",
  "What examples make this idea feel concrete?",
  "How does this connect to adjacent fields?",
  "What questions unlock deeper exploration?",
  "What would an expert revisit first?",
  "How can you sanity-check your understanding quickly?",
  "What tradeoffs show up in real applications?",
  "What vocabulary matters most for clarity?",
  "What sequence of steps builds confidence?",
] as const;

export function buildTemplateInventoryRow(
  slot: number,
  sourceType: GlobalTopicSourceType,
): GlobalTopicInventoryInsertRow {
  const pair = DOMAIN_SUBDOMAIN_PAIRS[slot % DOMAIN_SUBDOMAIN_PAIRS.length]!;
  const title = `${TITLE_FRAGMENTS[slot % TITLE_FRAGMENTS.length]} — ${pair.subdomain}`;
  const curiosity = CURIOSITY_HOOKS[slot % CURIOSITY_HOOKS.length]!;
  const shortSummary = `Reusable browsing-first starter for ${pair.subdomain} within ${pair.domain} (template slot ${slot}).`;
  const normalizedKey = buildGlobalTopicNormalizedKey({
    domain: pair.domain,
    subdomain: pair.subdomain,
    title,
    curiosityHook: curiosity,
  });
  return {
    normalizedKey,
    title,
    curiosityHook: curiosity,
    shortSummary,
    domain: pair.domain,
    subdomain: pair.subdomain,
    microTopic: `seed-template-${slot}`,
    categoryLabel: pair.domain,
    sourceType,
    status: GlobalTopicStatus.ACTIVE,
    qualityScore: 34,
    reuseEligible: true,
    freshnessBucket: "template_v1",
  };
}
