/**
 * ONYX FLEET FAMILIES — the ten-family architecture (client-safe).
 *
 * Defines the ten Onyx AI model families and their categories. This module is
 * deliberately free of system prompts, routes and provider details so BOTH
 * server code (`src/lib/onyx/fleet.ts`, API routes) and client components
 * (catalog, picker, detail pages) can import it without leaking anything.
 *
 * Families are organizational + branding layers over deployed models —
 * a family with zero public models is a registry definition, never a
 * fake model (PRD: "Do not deploy placeholder models").
 *
 *   01 ASTRA   General-purpose intelligence
 *   02 KAIRO   Fast, everyday AI
 *   03 VEX     Lightweight and low-latency models
 *   04 LOGOS   Reasoning and analytical tasks
 *   05 CODEX   Programming and software development
 *   06 OMNIX   Multimodal and vision capabilities
 *   07 MYTHOS  Creative writing and storytelling
 *   08 AMORA   Mature-audience and adult-oriented models
 *   09 RIVEN   Experimental and specialized models
 *   10 ZENITH  Premium and flagship models
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export type FleetFamilyId =
  | "astra"
  | "kairo"
  | "vex"
  | "logos"
  | "codex"
  | "omnix"
  | "mythos"
  | "amora"
  | "riven"
  | "zenith";

export type FleetCategory =
  | "general"
  | "performance"
  | "reasoning"
  | "coding"
  | "multimodal"
  | "creative"
  | "experimental"
  | "flagship";

/** Content classification carried by family/model metadata — never inferred
 *  from a model's name (PRD §9). */
export type ContentClassification = "general" | "adult";

export interface FleetFamilyMeta {
  /** Slug used in URLs and ids ("amora" → /models/amora). */
  id: FleetFamilyId;
  /** Display wordmark ("AMORA"). */
  name: string;
  /** Two-digit family number, for display ("08"). */
  index: string;
  category: FleetCategory;
  /** One-line purpose. */
  tagline: string;
  /** Longer description for family pages. */
  description: string;
  /** The mature-audience family. Classifications stay on model entries. */
  adult: boolean;
}

// ─── The ten families (fixed order 01–10) ────────────────────────────────────

export const FLEET_FAMILIES: readonly FleetFamilyMeta[] = [
  {
    id: "astra",
    name: "ASTRA",
    index: "01",
    category: "general",
    tagline: "Balanced, general-purpose intelligence",
    description:
      "The everyday assistant line. ASTRA slots are the default daily drivers of the fleet — balanced, articulate and dependable for everything from quick drafts to deep answers.",
    adult: false,
  },
  {
    id: "kairo",
    name: "KAIRO",
    index: "02",
    category: "general",
    tagline: "Fast, everyday AI",
    description:
      "Everyday conversational AI — responsive assistance for quick chats, quick questions and quick follow-ups, tuned for snappy interactions.",
    adult: false,
  },
  {
    id: "vex",
    name: "VEX",
    index: "03",
    category: "performance",
    tagline: "Lightweight, low-latency models",
    description:
      "Compact, latency-focused engines. VEX is there when speed beats depth — featherweight first tokens and minimal fuss.",
    adult: false,
  },
  {
    id: "logos",
    name: "LOGOS",
    index: "04",
    category: "reasoning",
    tagline: "Reasoning and analytical tasks",
    description:
      "Analysis, logic and structured conclusions. LOGOS slots think the problem through — math, trade-offs, evidence and research-grade investigation.",
    adult: false,
  },
  {
    id: "codex",
    name: "CODEX",
    index: "05",
    category: "coding",
    tagline: "Programming and software development",
    description:
      "The developer line: code generation, debugging, refactors and reviews, with tool-first precision and room for long files.",
    adult: false,
  },
  {
    id: "omnix",
    name: "OMNIX",
    index: "06",
    category: "multimodal",
    tagline: "Multimodal and vision capabilities",
    description:
      "Models that see what you send. OMNIX slots accept image inputs — describing photos, reading screenshots and reasoning over visual content.",
    adult: false,
  },
  {
    id: "mythos",
    name: "MYTHOS",
    index: "07",
    category: "creative",
    tagline: "Creative writing and storytelling",
    description:
      "Fiction, roleplay and imaginative work. MYTHOS slots cover poetry and copy (Muse), long-form storytelling (Story) and character roleplay (Persona).",
    adult: false,
  },
  {
    id: "amora",
    name: "AMORA",
    index: "08",
    category: "creative",
    tagline: "Mature-audience creative AI",
    description:
      "A distinct family for adult-oriented creative applications and character interactions. AMORA slots are 18+ — every one passed a live uncensored hard-test battery before earning its classification. Adults only.",
    adult: true,
  },
  {
    id: "riven",
    name: "RIVEN",
    index: "09",
    category: "experimental",
    tagline: "Experimental and specialized models",
    description:
      "Specialized, experimental or unconventional variants. The family is defined in the registry; no public RIVEN models have been released yet.",
    adult: false,
  },
  {
    id: "zenith",
    name: "ZENITH",
    index: "10",
    category: "flagship",
    tagline: "Premium and flagship models",
    description:
      "Premium models for demanding workloads. The family is defined in the registry; no public ZENITH models have been released yet — the name is never assigned by default.",
    adult: false,
  },
];

// ─── Lookups ─────────────────────────────────────────────────────────────────

const FAMILY_BY_ID = new Map(FLEET_FAMILIES.map((f) => [f.id, f]));

/** Family metadata by id (throws only on programmer error — all ids above). */
export function fleetFamily(id: FleetFamilyId): FleetFamilyMeta {
  return FAMILY_BY_ID.get(id) as FleetFamilyMeta;
}

/** True only for the ten family slugs — used to gate /models/<family> pages. */
export function isFleetFamilySlug(raw: string): raw is FleetFamilyId {
  return typeof raw === "string" && FAMILY_BY_ID.has(raw as FleetFamilyId);
}

/** Legacy three-line group slugs from the previous catalog — they redirect. */
const LEGACY_GROUP_SLUGS = new Set(["uncensored", "general", "creative"]);

export function isLegacyFleetGroupSlug(raw: string): boolean {
  return LEGACY_GROUP_SLUGS.has(raw);
}

// ─── Category filters (catalog pills) ────────────────────────────────────────

/** Fixed filter order for the /models catalog. Suggested set from the PRD
 *  (General, Reasoning, Coding, Creative, Multimodal, Experimental, Flagship)
 *  plus Performance so the VEX family is reachable. */
export const FLEET_CATEGORIES: readonly { id: FleetCategory; label: string }[] =
  [
    { id: "general", label: "General" },
    { id: "performance", label: "Performance" },
    { id: "reasoning", label: "Reasoning" },
    { id: "coding", label: "Coding" },
    { id: "creative", label: "Creative" },
    { id: "multimodal", label: "Multimodal" },
    { id: "experimental", label: "Experimental" },
    { id: "flagship", label: "Flagship" },
  ];

const CATEGORY_LABELS = new Map(
  FLEET_CATEGORIES.map((c) => [c.id, c.label] as const),
);

/** Human label for a category ("general" → "General"). */
export function fleetCategoryLabel(category: FleetCategory): string {
  return CATEGORY_LABELS.get(category) ?? category;
}
