// The fixed list of vibes an event can have, and what each one means to the AI.
// Kept short and fixed so the tags stay consistent and can be counted. The same names are checked by
// public.events (events.sql) and searched by the app (VIBE_WORDS in index.html): change all three together.

export const VIBES: Record<string, string> = {
  "spooky": "Halloween, horror, haunted houses, ghost tours, scary movies, costume parties",
  "festive": "tied to a holiday or season: Halloween, Día de los Muertos, Lunar New Year, Pride, the 4th of July, the winter holidays",
  "date night": "a good plan for a couple: intimate shows, wine or dinner, something romantic",
  "family-friendly": "good to bring kids of any age to",
  "solo-friendly": "easy to go alone and meet people: meetups, clubs, group classes, mixers",
  "late night": "goes on past 10 PM",
  "live music": "live musicians play (not only a DJ or background playlist)",
  "dance": "dancing is the point: dance parties, socials, dance classes",
  "chill": "relaxed and low-key: quiet, slow-paced, unwinding",
  "creative": "you make something: art, crafts, writing, cooking you do yourself",
  "cultural": "celebrates or teaches a culture, heritage or tradition",
  "dog-friendly": "dogs are welcome",
};

export const VIBE_NAMES = Object.keys(VIBES);

export const VIBE_GUIDE = `vibes: pick only from this list, and only the ones that clearly fit (often none, rarely more than three):
${VIBE_NAMES.map((name) => `  - ${name}: ${VIBES[name]}`).join("\n")}`;

/** Keeps only names from the list, each once, in the list's order. */
export const cleanVibes = (vibes: unknown): string[] =>
  Array.isArray(vibes) ? VIBE_NAMES.filter((name) => vibes.includes(name)) : [];
