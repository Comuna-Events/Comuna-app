// Reads one post with Claude and pulls out the events in it.
// Shared by every ingest-* function; platform code never calls Claude directly.

import Anthropic from "npm:@anthropic-ai/sdk";
import type { Source, SourcePost } from "./ingest.ts";

const MODEL = "claude-opus-5-5";

// Allowed values match the checks on public.events, so a promoted candidate never fails on these.
const RECURRENCE = ["One-off", "Daily", "Weekly", "Biweekly", "Monthly", "Seasonal / Annual"];
const PRICE_TYPE = ["Free", "Paid", "Donation / Pay-what-you-can"];
const SETTING = ["Indoor", "Outdoor", "Both"];
const AGE = ["All ages", "18+", "21+"];

export interface ExtractedEvent {
  name: string;
  description: string | null;
  category: string | null;
  tags: string[];
  start_date: string | null; // YYYY-MM-DD
  end_date: string | null;
  start_time: string | null; // HH:MM, 24h
  end_time: string | null;
  recurrence: string | null;
  recurrence_detail: string | null;
  venue: string | null;
  street_address: string | null;
  city: string | null;
  zip: string | null;
  neighborhood: string | null;
  setting: string | null;
  price_type: string | null;
  rsvp_required: boolean | null;
  ticket_url: string | null;
  age: string | null;
  host: string | null;
  confidence: number;
  notes: string | null;
}

const text = { type: "string" };
const orNull = (schema: object) => ({ anyOf: [schema, { type: "null" }] });
const oneOf = (values: string[]) => orNull({ type: "string", enum: values });

const EVENT_SCHEMA = {
  type: "object",
  properties: {
    name: text,
    description: orNull(text),
    category: orNull(text),
    tags: { type: "array", items: text },
    start_date: orNull(text),
    end_date: orNull(text),
    start_time: orNull(text),
    end_time: orNull(text),
    recurrence: oneOf(RECURRENCE),
    recurrence_detail: orNull(text),
    venue: orNull(text),
    street_address: orNull(text),
    city: orNull(text),
    zip: orNull(text),
    neighborhood: orNull(text),
    setting: oneOf(SETTING),
    price_type: oneOf(PRICE_TYPE),
    rsvp_required: orNull({ type: "boolean" }),
    ticket_url: orNull(text),
    age: oneOf(AGE),
    host: orNull(text),
    confidence: { type: "number" },
    notes: orNull(text),
  },
  required: [
    "name", "description", "category", "tags", "start_date", "end_date", "start_time", "end_time",
    "recurrence", "recurrence_detail", "venue", "street_address", "city", "zip", "neighborhood", "setting",
    "price_type", "rsvp_required", "ticket_url", "age", "host", "confidence", "notes",
  ],
  additionalProperties: false,
};

const SCHEMA = {
  type: "object",
  properties: { events: { type: "array", items: EVENT_SCHEMA } },
  required: ["events"],
  additionalProperties: false,
};

const SYSTEM = `You read social posts and event listings for Comuna, an app that helps people in Los Angeles find in-person "third space" events: community gatherings, classes, markets, run clubs, shows, meetups and the like.

Return every event the post announces. Return an empty list when it announces none: a recap of something that already happened, a promo or giveaway with no event, a menu or product post, an online-only event, or an event outside the Los Angeles area.

Fill each field only from what the post (and any flyer image) actually says; use null when it doesn't say. Never invent an address, price or time.
- Dates are YYYY-MM-DD and times are 24-hour HH:MM. Resolve "this Saturday" or "next Friday" against the date the post went up.
- For a repeating event ("every Tuesday"), set recurrence and recurrence_detail, and start_date to the next occurrence on or after today.
- Leave out events whose last date is before today.
- confidence is 0 to 1: how sure you are this is a real, public, upcoming in-person event with the date right.
- notes: one short line on anything you were unsure about or had to guess, or null.`;

export async function extractEvents(post: SourcePost, source: Source): Promise<ExtractedEvent[]> {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
  const header = [
    `Today: ${today}`,
    `Account: ${source.display_name ?? source.handle} (${source.platform})`,
    source.neighborhood ? `Usually posts about: ${source.neighborhood}` : null,
    post.postedAt ? `Posted: ${post.postedAt}` : null,
    post.url ? `Link: ${post.url}` : null,
  ].filter(Boolean).join("\n");
  const prompt = `${header}\n\nPost:\n${post.text}`;

  const images = (post.imageUrls ?? []).map((url) => ({
    type: "image" as const,
    source: { type: "url" as const, url },
  }));

  try {
    return await ask(prompt, images);
  } catch (err) {
    // An image URL Claude can't fetch (expired or private) fails the whole request; retry on the text alone.
    if (images.length && err instanceof Anthropic.BadRequestError) return await ask(prompt, []);
    throw err;
  }
}

const client = new Anthropic(); // reads ANTHROPIC_API_KEY

async function ask(
  prompt: string,
  images: { type: "image"; source: { type: "url"; url: string } }[],
): Promise<ExtractedEvent[]> {
  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default", // if Claude declines a post, the API retries it on another model
    output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
    system: SYSTEM,
    messages: [{ role: "user", content: [...images, { type: "text", text: prompt }] }],
  });

  if (response.stop_reason === "refusal") throw new Error("Claude declined to read this post");
  if (response.stop_reason === "max_tokens") throw new Error("Claude's answer was cut off");

  const json = response.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
  return (JSON.parse(json) as { events: ExtractedEvent[] }).events;
}
