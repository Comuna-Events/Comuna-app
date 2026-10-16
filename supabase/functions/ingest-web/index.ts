// Nightly ingest: public web pages. Covers every event_sources row with platform city_calendar or
// venue_website, where handle is the page's URL (a city / library calendar, a venue's events page, a blog
// that lists events...). Everything else (AI reading, saving candidates, the run log) is in ../_shared.
//
// Works as is: it downloads the page, turns it into plain text and lets the AI find the events.
// The page is only re-read when its text changes, and events we already have are skipped.
// Improve it per site where that pays off, e.g. read a calendar's iCal / RSS feed instead of its HTML.

import { handleIngestRequest, type Source, type SourcePost } from "../_shared/ingest.ts";

async function fetchPosts(source: Source): Promise<SourcePost[]> {
  const url = source.handle;
  const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (compatible; ComunaEventBot/1.0)" } });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);

  const text = pageText(await res.text(), url);
  if (text.length < 200) {
    throw new Error("Page has almost no text; it probably loads its events with JavaScript. Look for a feed or API.");
  }
  // A new id whenever the page's text changes, so an unchanged page isn't read (or paid for) again.
  return [{ externalId: `${url}#${await shortHash(text)}`, text, url }];
}

// HTML to readable text. Keeps link targets, since event pages usually link to the details or tickets.
function pageText(html: string, baseUrl: string): string {
  return html
    .replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<a\b[^>]*href="([^"#][^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href, label) => {
      try { return `${label} (${new URL(href, baseUrl).href})`; } catch { return label; }
    })
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/article|\/section)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;|&#x27;|&rsquo;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

async function shortHash(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve((req) => handleIngestRequest(req, "web", fetchPosts, ["city_calendar", "venue_website"]));
