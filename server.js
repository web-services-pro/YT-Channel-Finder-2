import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import path from "path";
import { fileURLToPath } from "url";
import { generatePersonalizedOutreach } from "./api/generatePersonalizedOutreach.js";
import { ApifyClient } from 'apify-client';
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

// Dynamic imports for puppeteer to handle cloud deployment issues
let puppeteer;
let StealthPlugin;

try {
  const puppeteerExtra = await import("puppeteer-extra");
  const stealthPlugin = await import("puppeteer-extra-plugin-stealth");
  puppeteer = puppeteerExtra.default;
  StealthPlugin = stealthPlugin.default;
  puppeteer.use(StealthPlugin());
  console.log("✅ Puppeteer loaded successfully");
} catch (error) {
  console.warn("⚠️ Puppeteer failed to load:", error.message);
  // Try fallback to regular puppeteer
  try {
    puppeteer = await import("puppeteer");
    puppeteer = puppeteer.default;
    console.log("✅ Fallback to regular Puppeteer successful");
  } catch (fallbackError) {
    console.error("❌ All Puppeteer options failed:", fallbackError.message);
    puppeteer = null;
  }
}

// Environment variables
const YOUTUBE_API_KEYS = process.env.YOUTUBE_API_KEY 
  ? process.env.YOUTUBE_API_KEY.split(',').map(k => k.trim()).filter(k => k.length > 0)
  : [];
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';

const APIFY_API_TOKENS = process.env.APIFY_API_TOKENS 
  ? process.env.APIFY_API_TOKENS.split(',').map(k => k.trim()).filter(k => k.length > 0)
  : [];

console.log(`✅ Apify API Tokens loaded: ${APIFY_API_TOKENS.length} tokens`);

// Add rotation counter
let currentApifyTokenIndex = -1;

// Add rotation function
function getNextApifyToken() {
  if (APIFY_API_TOKENS.length === 0) return null;
  currentApifyTokenIndex = (currentApifyTokenIndex + 1) % APIFY_API_TOKENS.length;
  return APIFY_API_TOKENS[currentApifyTokenIndex];
}

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY || '';
const supabase = (SUPABASE_URL && SUPABASE_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_KEY)
  : null;

console.log(`✅ YouTube API Keys loaded: ${YOUTUBE_API_KEYS.length} keys`);
console.log(`✅ OpenAI API Key loaded: ${!!OPENAI_API_KEY}`);
console.log(`✅ Supabase Cloud Sync configured: ${!!supabase}`);

const app = express();

// Middleware
app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));

// For ES modules (__dirname fix)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Health check
app.get("/api/health", (req, res) => {
  res.json({ 
    status: "ok", 
    message: "Server is running 🚀",
    puppeteerAvailable: !!puppeteer,
    nodeVersion: process.version,
    platform: process.platform
  });
});

// Keep-alive endpoint for UptimeRobot (pings Render + queries Supabase to prevent free-tier pausing)
app.get("/api/keep-alive", async (req, res) => {
  try {
    if (!supabase) {
      return res.status(200).json({
        status: "ok",
        supabaseActive: false,
        message: "Server awake, but Supabase is not configured",
        timestamp: new Date().toISOString()
      });
    }

    const { error } = await supabase
      .from("saved_creators")
      .select("id")
      .limit(1);

    if (error) throw error;

    res.status(200).json({
      status: "ok",
      supabaseActive: true,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error("❌ Keep-alive Supabase ping failed:", err.message);
    res.status(500).json({
      status: "error",
      supabaseActive: false,
      error: err.message
    });
  }
});

// API keys availability check
app.get("/api/keys-status", (req, res) => {
  res.json({
    youtubeKeysAvailable: YOUTUBE_API_KEYS.length > 0,
    youtubeKeysCount: YOUTUBE_API_KEYS.length,
    openaiKeyAvailable: !!OPENAI_API_KEY
  });
});

app.get("/api/apify-status", (req, res) => {
  res.json({
    apifyAvailable: APIFY_API_TOKENS.length > 0,
    apifyTokensCount: APIFY_API_TOKENS.length
  });
});

// Provide YouTube API keys for frontend
app.get("/api/youtube-keys", (req, res) => {
  if (YOUTUBE_API_KEYS.length === 0) {
    return res.status(503).json({ error: "No YouTube API keys configured" });
  }
  res.json({ keys: YOUTUBE_API_KEYS });
});

// --- Enhanced scraper helper ---
async function extractContactInfoFromPage(page) {
  const result = await page.evaluate(() => {
    const uniq = arr => [...new Set(arr.filter(Boolean))];

    // Email regex
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    const pageText = document.body ? document.body.innerText : "";
    const emails = (pageText.match(emailRegex) || []).map(e => e.toLowerCase());

    // Enhanced business inquiry detection
    const hasBusinessInquiry = (() => {
      try {
        // Check for business inquiry buttons/text
        const businessTexts = [
          'business inquir', 'business email', 'business contact',
          'press inquir', 'media inquir', 'collaboration', 'partnership',
          'sponsor', 'brand deal', 'work with me', 'business@', 'contact@'
        ];
        
        const pageTextLower = pageText.toLowerCase();
        const hasBusinessText = businessTexts.some(text => pageTextLower.includes(text));
        
        // Check for mailto links
        const mailtoLinks = Array.from(document.querySelectorAll('a[href^="mailto:"]')).length > 0;
        
        // Check for business inquiry buttons
        const businessButtons = Array.from(document.querySelectorAll("button, a, tp-yt-paper-button"))
          .some(el => {
            const text = (el.innerText || '').toLowerCase();
            return text.includes("business") || text.includes("inquiry") || text.includes("contact");
          });

        return hasBusinessText || mailtoLinks || businessButtons || emails.length > 0;
      } catch {
        return emails.length > 0; // Fallback to email presence
      }
    })();

    // Collect all links from various sources
    const allLinks = [];

    // Regular anchor links
    const anchors = Array.from(document.querySelectorAll("a[href]"))
      .map(a => a.href)
      .filter(Boolean);
    allLinks.push(...anchors);

    // External links from YouTube's custom sections
    const externalLinks = Array.from(document.querySelectorAll([
      '.yt-channel-external-link-view-model-wiz__container a',
      '[data-target-new-window="true"]',
      '.about-stats__item a',
      '.channel-header-links a'
    ].join(', ')))
      .map(a => a.href)
      .filter(Boolean);
    allLinks.push(...externalLinks);

    // JSON-LD structured data
    const jsonLd = Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
      .map(s => {
        try {
          return JSON.parse(s.textContent);
        } catch {
          return null;
        }
      })
      .filter(Boolean);

    let sameAsLinks = [];
    jsonLd.forEach(obj => {
      if (Array.isArray(obj)) {
        obj.forEach(o => {
          if (o.sameAs) sameAsLinks = sameAsLinks.concat(Array.isArray(o.sameAs) ? o.sameAs : [o.sameAs]);
        });
      } else if (obj.sameAs) {
        sameAsLinks = sameAsLinks.concat(Array.isArray(obj.sameAs) ? obj.sameAs : [obj.sameAs]);
      }
    });
    allLinks.push(...sameAsLinks);

    // Categorize links
    const social = {};
    const websites = [];
    const otherLinks = [];

    const classify = href => {
      try {
        const url = new URL(href);
        const host = url.hostname.replace(/^www\./, "").toLowerCase();
        
        // Social media classification
        if (host.includes("instagram.com") || host === "instagr.am") return "instagram";
        if (host.includes("twitter.com") || host === "x.com") return "twitter";
        if (host.includes("facebook.com") || host === "fb.com" || host === "fb.me") return "facebook";
        if (host.includes("tiktok.com")) return "tiktok";
        if (host.includes("linkedin.com")) return "linkedin";
        if (host.includes("patreon.com")) return "patreon";
        if (host.includes("ko-fi.com")) return "kofi";
        if (host.includes("buymeacoffee.com")) return "buymeacoffee";
        if (host.includes("discord.gg") || host.includes("discord.com")) return "discord";
        if (host.includes("twitch.tv")) return "twitch";
        if (host.includes("reddit.com")) return "reddit";
        if (host.includes("pinterest.com")) return "pinterest";
        if (host.includes("snapchat.com")) return "snapchat";
        if (host.includes("threads.net")) return "threads";
        if (host.includes("onlyfans.com")) return "onlyfans";
        if (host.includes("substack.com")) return "substack";
        if (host.includes("medium.com")) return "medium";
        if (host.includes("github.com")) return "github";
        if (host.includes("telegram.me") || host === "t.me") return "telegram";
        
        // Ignore YouTube and CDN links
        if (
          host.includes("youtube.com") ||
          host.includes("youtu.be") ||
          host.includes("ytimg.com") ||
          host.includes("googleusercontent.com") ||
          host.includes("ggpht.com")
        ) {
          return "ignore";
        }
        
        return "website";
      } catch {
        return "other";
      }
    };

    // Process all unique links
    const uniqueLinks = uniq(allLinks);
    uniqueLinks.forEach(href => {
      const type = classify(href);
      if (type === "ignore") return;
      if (type === "website") {
        websites.push(href);
      } else if (type === "other") {
        otherLinks.push(href);
      } else if (type && !social[type]) {
        social[type] = href; // Only set if not already found
      }
    });

    return {
      emails: uniq(emails),
      social,
      websites: uniq(websites),
      otherLinks: uniq(otherLinks),
      hasBusinessInquiry,
      totalLinksFound: uniqueLinks.length,
      socialLinksFound: Object.keys(social).length
    };
  });

  return result;
}

/**
 * Fetch recent videos for a channel
 * @param {string} channelId 
 * @param {string} apiKey 
 * @param {number} maxResults 
 */
async function fetchRecentVideos(channelId, apiKey, maxResults = 5) {
  try {
    const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${channelId}&type=video&order=date&maxResults=${maxResults}&key=${apiKey}`;
    const resp = await fetch(url);
    const data = await resp.json();

    if (!data.items) {
      console.warn(`No videos found for channel: ${channelId}`);
      return [];
    }

    return data.items;
  } catch (err) {
    console.error(`Failed to fetch videos for ${channelId}:`, err.message);
    return [];
  }
}

/**
 * Fetch top-level comments for a given video ID
 * Returns an array of comment strings; sets non-enumerable `apiFailed` flag only on quota/network errors
 */
async function fetchVideoComments(videoId, apiKey, maxComments = 20) {
  try {
    const url = `https://www.googleapis.com/youtube/v3/commentThreads?part=snippet&videoId=${videoId}&maxResults=${maxComments}&key=${apiKey}`;
    const resp = await fetch(url);
    const data = await resp.json();

    if (data.error) {
      const reason = data.error.errors?.[0]?.reason || "";
      if (reason === "commentsDisabled" || reason === "videoNotFound") {
        // Comments are turned off on YouTube; no need to waste Apify credits scraping
        return [];
      }
      console.warn(`⚠️ YouTube comment API error (${reason}) for ${videoId}`);
      const failedArr = [];
      failedArr.apiFailed = true;
      return failedArr;
    }

    if (!data.items || data.items.length === 0) {
      return [];
    }

    return data.items.map(item => 
      item.snippet.topLevelComment.snippet.textDisplay
    );
  } catch (err) {
    console.error(`❌ Failed to fetch comments for ${videoId}:`, err.message);
    const failedArr = [];
    failedArr.apiFailed = true;
    return failedArr;
  }
}

// --- New pipeline: fetch videos + comments for outreach ---
app.get("/api/channel-data", async (req, res) => {
  const { channelId } = req.query;
  if (!channelId) return res.status(400).json({ error: "Missing channelId" });
  if (YOUTUBE_API_KEYS.length === 0) return res.status(503).json({ error: "No YouTube API keys available" });

  const apiKey = YOUTUBE_API_KEYS[Math.floor(Math.random() * YOUTUBE_API_KEYS.length)];

  try {
    const videos = await fetchRecentVideos(channelId, apiKey, 5);

    const recentVideos = [];
    let recentComments = [];

    for (const v of videos) {
      recentVideos.push({
        title: v.snippet.title,
        description: v.snippet.description
      });

      const comments = await fetchVideoComments(v.id.videoId, apiKey, 10);
      recentComments.push(...comments);
    }

    // cap at 30 comments
    recentComments = recentComments.slice(0, 30);

    res.json({
      success: true,
      channelId,
      recentVideos,
      recentComments
    });
  } catch (err) {
    console.error("❌ Channel data fetch failed:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- Helper: Unwrap YouTube redirect URLs & classify links ---
function unwrapAndClassifyLinks(rawUrls = []) {
  const websites = [];
  const otherLinks = [];
  const social = {};

  const socialPatterns = {
    instagram: /instagram\.com\/([^\/\?\s]+)/i,
    twitter: /(?:twitter\.com|x\.com)\/([^\/\?\s]+)/i,
    facebook: /facebook\.com\/([^\/\?\s]+)/i,
    tiktok: /tiktok\.com\/@?([^\/\?\s]+)/i,
    linkedin: /linkedin\.com\/(?:in|company)\/([^\/\?\s]+)/i,
    discord: /(?:discord\.gg|discord\.com\/invite)\/([^\/\?\s]+)/i,
    twitch: /twitch\.tv\/([^\/\?\s]+)/i,
    patreon: /patreon\.com\/([^\/\?\s]+)/i
  };

  const linkInBioDomains = ["linktr.ee", "beacons.ai", "stan.store", "bio.link", "lnk.bio", "carrd.co", "bit.ly", "tinyurl.com"];
  const ignoredDomains = [
    "youtube.com", "youtu.be", "ytimg.com", "googleusercontent.com",
    "google.com", "gstatic.com", "ggpht.com", "googleapis.com",
    "doubleclick.net", "w3.org", "schema.org"
  ];

  const seen = new Set();

  for (let raw of rawUrls) {
    if (!raw || typeof raw !== "string") continue;
    if (/\.(?:jpg|jpeg|png|gif|webp|svg)(?:\?|$)/i.test(raw)) continue;
    
    // Unwrap YouTube redirect tracking URLs
    if (raw.includes("youtube.com/redirect")) {
      try {
        const parsed = new URL(raw.startsWith("http") ? raw : `https://www.youtube.com${raw}`);
        const target = parsed.searchParams.get("q");
        if (target) raw = decodeURIComponent(target);
      } catch {}
    }

    if (!raw.startsWith("http://") && !raw.startsWith("https://")) {
      raw = `https://${raw}`;
    }

    let parsedUrl;
    try {
      parsedUrl = new URL(raw);
    } catch {
      continue;
    }

    const host = parsedUrl.hostname.toLowerCase().replace(/^www\./, "");
    if (!host || ignoredDomains.some(d => host === d || host.endsWith(`.${d}`))) {
      continue;
    }

    const cleanHref = parsedUrl.href.replace(/\/$/, "");
    if (seen.has(cleanHref)) continue;
    seen.add(cleanHref);

    // Check if social media profile
    let matchedSocial = false;
    for (const [platform, regex] of Object.entries(socialPatterns)) {
      if (regex.test(cleanHref)) {
        if (!social[platform]) social[platform] = cleanHref;
        matchedSocial = true;
        break;
      }
    }
    if (matchedSocial) continue;

    // Check if link-in-bio aggregator vs standalone website
    if (linkInBioDomains.some(d => host === d || host.endsWith(`.${d}`))) {
      otherLinks.push(cleanHref);
    } else {
      websites.push(cleanHref);
    }
  }

  return { websites, social, otherLinks };
}

// --- Recursively collect all external URLs & emails from ytInitialData regardless of UI key renames ---
function extractFromYtInitialData(node, urlBucket = [], textBucket = [], depth = 0) {
  if (!node || depth > 25) return;

  if (typeof node === "string") {
    if (node.includes("youtube.com/redirect") || node.startsWith("http://") || node.startsWith("https://")) {
      urlBucket.push(node);
    }
    if (node.includes("@") && node.length < 300) {
      textBucket.push(node);
    }
    return;
  }

  if (Array.isArray(node)) {
    for (const item of node) {
      extractFromYtInitialData(item, urlBucket, textBucket, depth + 1);
    }
    return;
  }

  if (typeof node === "object") {
    // Capture dedicated external link view-models directly
    if (node.urlEndpoint && typeof node.urlEndpoint.url === "string") {
      urlBucket.push(node.urlEndpoint.url);
    }
    if (typeof node.url === "string" && (node.url.startsWith("http") || node.url.includes("youtube.com/redirect"))) {
      urlBucket.push(node.url);
    }
    for (const val of Object.values(node)) {
      extractFromYtInitialData(val, urlBucket, textBucket, depth + 1);
    }
  }
}

// --- Zero-Puppeteer About Page Link & Metadata Extractor (ytInitialData + Consent Bypass) ---
app.get("/api/scrape-about", async (req, res) => {
  const { channelId } = req.query;
  if (!channelId) return res.status(400).json({ error: "Missing channelId" });

  try {
    const aboutUrl = `https://www.youtube.com/channel/${channelId}/about`;
    const response = await fetch(aboutUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Cookie": "CONSENT=YES+cb.20210328-17-p0.en+FX+471; SOCS=CAESEwgDEgk0ODE3Nzk3MjQaAmVuIAEaBgiA_LyaBg"
      },
      signal: AbortSignal.timeout(6000)
    });

    if (!response.ok) {
      return res.status(200).json({
        channelId,
        success: false,
        emails: [],
        social: {},
        websites: [],
        otherLinks: [],
        hasBusinessInquiry: false
      });
    }

    const html = await response.text();
    const rawUrls = [];
    const textSnippets = [];

    // 1. Parse ytInitialData JSON safely
    const initMatch = html.match(/var ytInitialData\s*=\s*(\{[\s\S]*?\});\s*<\/script>/);
    if (initMatch && initMatch[1]) {
      try {
        const ytData = JSON.parse(initMatch[1]);
        extractFromYtInitialData(ytData, rawUrls, textSnippets);
      } catch (parseErr) {
        console.warn(`⚠️ ytInitialData JSON parse fallback for ${channelId}`);
      }
    }

    // 2. Also sweep raw HTML for any youtube.com/redirect?q= links
    const redirectMatches = html.match(/https?:\/\/www\.youtube\.com\/redirect\?[^"'\s<>\\]+/g) || [];
    rawUrls.push(...redirectMatches);

    // 3. Extract any public emails present in text snippets
    const emailRegex = /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g;
    const emails = [...new Set(
      (textSnippets.join(" ").match(emailRegex) || [])
        .filter(e => !e.endsWith(".png") && !e.endsWith(".jpg") && !e.includes("example.com"))
    )];

    const { websites, social, otherLinks } = unwrapAndClassifyLinks(rawUrls);
    const hasBusinessInquiry = /for business inquiries|view email address/i.test(html);

    console.log(`🔗 About-tab extracted for ${channelId}: ${websites.length} website(s), ${Object.keys(social).length} social(s), ${otherLinks.length} other link(s)`);

    return res.status(200).json({
      channelId,
      success: true,
      emails,
      social,
      websites,
      otherLinks,
      hasBusinessInquiry
    });
  } catch (err) {
    console.warn(`⚠️ About-tab fetch skipped for ${channelId}: ${err.message}`);
    return res.status(200).json({
      channelId,
      success: false,
      emails: [],
      social: {},
      websites: [],
      otherLinks: [],
      hasBusinessInquiry: false
    });
  }
});

// --- Zero-Quota Helper: Fetch Opening ~60s Transcript from YouTube Captions ---
async function fetchVideoOpeningTranscript(videoId) {
  if (!videoId) return "";
  try {
    const pageResp = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9"
      },
      signal: AbortSignal.timeout(4000)
    });

    if (!pageResp.ok) return "";
    const html = await pageResp.text();

    const tracksMatch = html.match(/"captionTracks":(\[.*?\])/);
    if (!tracksMatch) return "";

    const tracks = JSON.parse(tracksMatch[1]);
    if (!Array.isArray(tracks) || tracks.length === 0) return "";

    const enTrack = tracks.find(t => t.languageCode === "en" || t.languageCode?.startsWith("en")) || tracks[0];
    if (!enTrack || !enTrack.baseUrl) return "";

    const captionResp = await fetch(enTrack.baseUrl, {
      signal: AbortSignal.timeout(3500)
    });
    if (!captionResp.ok) return "";

    const xml = await captionResp.text();
    const textMatches = [...xml.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)];
    if (textMatches.length === 0) return "";

    const openingText = textMatches
      .slice(0, 28) // First ~45-60 seconds of speech
      .map(m => m[1]
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/<[^>]+>/g, "")
      )
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    return openingText.slice(0, 700);
  } catch {
    // Fail silently if captions are disabled or unavailable
    return "";
  }
}

// Updated outreach endpoint with 5-source Owner Name Discovery & Single-Subject 6-Email Sequence
app.post("/api/outreach", async (req, res) => {
  try {
    const {
      channelName,
      channelHandle,
      description,
      recentVideos,
      ownerName,
      contactEmail,
      currentMonetization,
      monetizationPotential,
      subscribers,
      engagementRate,
      productContext
    } = req.body;
    let comments = Array.isArray(req.body.recentComments) ? req.body.recentComments : [];
    let videoTranscript = "";

    console.log(`🚀 Outreach & Sequence generation request for: ${channelName}`);

    if (Array.isArray(recentVideos) && recentVideos.length > 0) {
      const topVideo = recentVideos[0];
      const videoId = topVideo.id || (topVideo.url ? topVideo.url.split("v=")[1]?.split("&")[0] : null);

      // Fetch comments (via YouTube Data API) and opening video transcript (zero-quota) in parallel
      const commentPromise = (async () => {
        if (comments.length > 0) return comments;
        let youtubeApiErrored = false;

        if (videoId && YOUTUBE_API_KEYS.length > 0) {
          const apiKey = YOUTUBE_API_KEYS[Math.floor(Math.random() * YOUTUBE_API_KEYS.length)];
          const ytComments = await fetchVideoComments(videoId, apiKey, 15);
          youtubeApiErrored = !!ytComments.apiFailed;
          if (ytComments.length > 0) return ytComments;
        }

        if (youtubeApiErrored && topVideo.url && typeof scrapeVideoCommentsWithApify === 'function') {
          console.log(`⛏️ YouTube API quota fallback: mining comments via Apify for ${topVideo.url}`);
          return await scrapeVideoCommentsWithApify(topVideo.url, 15);
        }
        return [];
      })();

      const transcriptPromise = videoId ? fetchVideoOpeningTranscript(videoId) : Promise.resolve("");

      [comments, videoTranscript] = await Promise.all([commentPromise, transcriptPromise]);
    }

    console.log(`💬 Comments fed: ${comments.length} | 📝 Transcript chars: ${videoTranscript.length}`);

    const outreach = await generatePersonalizedOutreach({
      channelName,
      channelHandle: channelHandle || "",
      description,
      recentVideos: recentVideos || [],
      recentComments: comments,
      videoTranscript,
      contactEmail: contactEmail || "",
      ownerName: ownerName || "",
      currentMonetization: currentMonetization || "Unknown",
      monetizationPotential: monetizationPotential || "",
      subscribers: subscribers || 0,
      engagementRate: engagementRate || 0,
      productContext: productContext || null,
      openaiApiKey: OPENAI_API_KEY
    });

    res.json({
      success: true,
      ownerName: outreach.ownerName || "",
      greetingName: outreach.greetingName || "",
      subjectLine: outreach.subjectLine || "",
      monetizationPotential: outreach.monetizationPotential || "",
      sequence: outreach.sequence || [],
      email1Body: outreach.email1Body || "",
      email2Body: outreach.email2Body || "",
      email3Body: outreach.email3Body || "",
      email4Body: outreach.email4Body || "",
      email5Body: outreach.email5Body || "",
      email6Body: outreach.email6Body || "",
      commentsUsed: comments.length,
      transcriptUsed: videoTranscript.length > 0
    });
  } catch (err) {
    console.error("❌ Outreach error:", err.message);
    res.status(500).json({ 
      error: err.message,
      success: false,
      ownerName: "",
      greetingName: "",
      subjectLine: "",
      monetizationPotential: "",
      sequence: []
    });
  }
});

// --- Endpoint to generate AI search queries (Supports General Niche OR Product/Service Context) ---
app.post("/api/generate-queries", async (req, res) => {
  try {
    const { niche, targetAudience, productContext } = req.body;
    const hasProduct = !!(productContext && productContext.name && productContext.name.trim().length > 0);

    if (!niche && !hasProduct) {
      return res.status(400).json({ error: "Niche or Product Context is required" });
    }

    if (!OPENAI_API_KEY) {
      console.warn("⚠️ OPENAI_API_KEY not configured, returning empty queries for client fallback");
      return res.json({ success: false, queries: [] });
    }

    const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

    let systemPrompt = "";
    let userPrompt = "";

    if (hasProduct) {
      systemPrompt = `You are an expert influencer partnership strategist and YouTube SEO specialist.
A user wants to find YouTube channels whose VIEWERS (audience) match the Ideal Buyer profile for their product or service—so they can partner with those creators via affiliate deals, joint ventures, or sponsorships.

CRITICAL STRATEGY (AUDIENCE CONGREGATION):
Do NOT just search for the product/service itself (which mostly surfaces direct competitors). Instead, generate 12 to 15 YouTube search queries targeting the ecosystems where the Ideal Buyers actively watch content:
1. Complementary, non-competing SaaS tools, software, or gear the buyers use daily (e.g., tutorials, reviews, workflows for tools used by this buyer).
2. Professional skills, operations, training, or craft channels built specifically for this buyer's role or hobby.
3. Industry associations, conferences, podcasts, and trade educators followed by these buyers.
4. Adjacent problems the buyer faces right before or after needing the user's offer.

Rules:
1. Return ONLY a valid JSON object:
   {"queries": ["query 1", "query 2", ...], "inferredNiches": ["niche 1", "niche 2", "niche 3"]}
2. Every query MUST stay anchored to the buyer's domain/identity so YouTube returns relevant creators—NEVER output detached generic phrases like "how to fix" or "best software" without the buyer's industry/context attached.
3. Keep each query between 2 and 5 words.`;

      userPrompt = `Product / Service Name: ${productContext.name}
Category: ${productContext.category || "Digital Product / Service"}
What It Is: ${productContext.description || "N/A"}
Price: $${productContext.price || "N/A"}
Who Buys It (Ideal Buyer): ${productContext.buyerPersona || targetAudience || "N/A"}
Optional Target Creator Niches: ${productContext.targetNiches || niche || "Auto-infer best non-competing niches where buyers congregate"}`;
    } else {
      systemPrompt = `You are an expert YouTube SEO specialist and audience researcher.
Generate 12 to 15 diverse, highly targeted YouTube search queries for ANY niche provided by the user.

Rules:
1. Return ONLY a valid JSON object with a "queries" array of strings, e.g. {"queries": ["query 1", "query 2", ...]}.
2. DYNAMIC ANCHOR RULE: Every query MUST explicitly retain the core subject noun from the niche input ("${niche}"). Never drop the core subject to generate detached generic terms like "how to fix", "deals & reviews", or "maintenance guide" without the subject attached, as that causes false positives across unrelated industries.
3. Target sub-categories, techniques, tools, common problems, and specific audience questions relevant to this topic.
4. Keep each query between 2 and 5 words.

Respond ONLY with JSON format: {"queries": ["query1", "query2", ...]}`;

      userPrompt = `Niche: ${niche}\nTarget Audience: ${targetAudience || "General audience"}`;
    }

    const response = await openai.chat.completions.create({
      model: "gpt-5.4-mini",
      temperature: 0.7,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      response_format: { type: "json_object" }
    });

    const content = response.choices[0].message.content;
    const parsed = JSON.parse(content);
    const queries = Array.isArray(parsed) ? parsed : (parsed.queries || parsed.searchQueries || []);
    const inferredNiches = parsed.inferredNiches || [];

    console.log(`✅ Generated ${queries.length} AI search queries (Mode: ${hasProduct ? 'Product: ' + productContext.name : 'Niche: ' + niche})`);

    res.json({
      success: true,
      queries: queries.length > 0 ? queries : [hasProduct ? productContext.name : niche],
      inferredNiches
    });
  } catch (err) {
    console.error("❌ Failed to generate AI queries:", err.message);
    res.json({ success: false, queries: [] });
  }
});

// --- Endpoint for Dynamic Batch AI Channel Relevance Evaluation (Multi-Video + Fit Reasoning) ---
app.post("/api/analyze-relevance", async (req, res) => {
  try {
    const { niche, targetAudience, productContext, channels } = req.body;

    if (!channels || !Array.isArray(channels) || channels.length === 0) {
      return res.json({ success: true, evaluations: {} });
    }

    if (!OPENAI_API_KEY) {
      console.warn("⚠️ OPENAI_API_KEY not configured, skipping AI relevance filter");
      return res.json({ success: false, evaluations: {} });
    }

    const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
    const hasProduct = !!(productContext && productContext.name && productContext.name.trim().length > 0);

    const systemPrompt = hasProduct
      ? `You are an expert creator partnership evaluator for a B2B/B2C influencer platform.
Your job is to evaluate whether each YouTube channel's AUDIENCE (viewers) matches the Ideal Buyer profile for the user's product/service, so they can form an affiliate, joint venture, or sponsorship partnership.

CRITICAL EVALUATION RULES:
1. AUDIENCE OVER CHANNEL TOPIC: Judge the channel by WHO WATCHES IT, NOT whether the channel teaches the user's product/service. For example, if Ideal Buyers are "personal injury attorneys", a channel dedicated to a complementary legal SaaS tool, trial advocacy, or law firm intake operations is a "Very High" match because PI attorneys are its primary viewers—even if the channel never mentions marketing or lead reactivation.
2. EXCLUDE DIRECT COMPETITORS: If a channel is run by a direct competitor selling the exact same core product or service (e.g., an agency selling the exact same service to the same buyers), mark it as "Low" because competitors will not promote a rival offer.
3. DISTINGUISH B2B BUYERS FROM B2C CONSUMERS: If Ideal Buyers are professionals/business owners in an industry (e.g., attorneys, doctors, contractors), channels educating those professionals are "Very High"/"High", whereas consumer-facing channels/ads aimed at retail customers/patients/victims are "Medium" or "Low".
4. INCLUDE FIT REASONING: For every channel, provide a crisp 6-10 word "reason" explaining why its viewers fit (e.g., "Legal SaaS tutorials watched by PI firm owners") or why it was disqualified (e.g., "Direct competitor selling lead reactivation").

Classification Levels:
- "Very High": Primary viewership is the exact Ideal Buyer, and the channel is non-competing (e.g., complementary SaaS/tool, industry educator, workflow/operations channel, trade podcast).
- "High": Strong overlap with the Ideal Buyer audience via closely adjacent industry topics.
- "Medium": Partial or indirect audience overlap (e.g., broad business/general niche channel or consumer-facing side of the industry).
- "Low": Direct competitor selling the same core offer, OR unrelated industry (music "- Topic" channels, news, politics, unrelated entertainment).

Return ONLY valid JSON:
{
  "evaluations": {
    "CHANNEL_ID": { "match": "Very High" | "High" | "Medium" | "Low", "reason": "6-10 word fit explanation" }
  }
}`
      : `You are an expert creator relevance filter for an influencer research platform.
Evaluate whether each YouTube channel genuinely belongs to the target Niche and serves the Target Audience, or if it is an unrelated false positive.

Classification Rules:
- "Very High": The channel's primary focus directly matches this specific niche and audience.
- "High": The channel frequently covers this niche alongside closely related topics.
- "Medium": Broadly related, adjacent, or a multi-topic channel that partially covers the niche.
- "Low": Definite false positive from an entirely different industry (including music "- Topic" channels, political campaigns, or unrelated entertainment).

Return valid JSON with an "evaluations" object mapping channel ID to match level and a concise 6-10 word reason:
{
  "evaluations": {
    "CHANNEL_ID": { "match": "Very High" | "High" | "Medium" | "Low", "reason": "6-10 word fit explanation" }
  }
}`;

    // Send up to 5 recent video titles per channel for accurate multi-video theme verification
    const candidateList = channels.map(c => ({
      id: c.id,
      name: c.name,
      description: (c.description || "").slice(0, 280),
      recentVideos: Array.isArray(c.recentVideos) && c.recentVideos.length > 0
        ? c.recentVideos.slice(0, 5)
        : (c.recentVideo ? [c.recentVideo.title] : [])
    }));

    const contextHeader = hasProduct
      ? `Ideal Buyers (Who Watches & Buys): ${productContext.buyerPersona || targetAudience || ''}\nProduct/Service Being Pitched (Exclude Direct Competitors Selling This): ${productContext.name} (${productContext.category || 'Product/Service'}) — ${productContext.description || ''}\nOptional Niche Hint: ${productContext.targetNiches || 'None'}`
      : `Target Niche: ${niche}\nTarget Audience: ${targetAudience || "General"}`;

    const userPrompt = `${contextHeader}\n\nChannels to evaluate:\n${JSON.stringify(candidateList, null, 2)}`;

    const response = await openai.chat.completions.create({
      model: "gpt-5.4-mini",
      temperature: 0.1,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      response_format: { type: "json_object" }
    });

    const parsed = JSON.parse(response.choices[0].message.content);
    const evaluations = parsed.evaluations || parsed;

    console.log(`🤖 AI evaluated relevance for ${Object.keys(evaluations).length} channels`);
    res.json({
      success: true,
      evaluations: evaluations
    });
  } catch (err) {
    console.error("❌ Relevance analysis failed:", err.message);
    res.json({ success: false, evaluations: {} });
  }
});

// --- Helper: Scrape comments for outreach using streamers/youtube-comments-scraper ---
async function scrapeVideoCommentsWithApify(videoUrl, maxComments = 15) {
  const token = getNextApifyToken();
  if (!token) return [];

  try {
    const client = new ApifyClient({ token });
    const run = await client.actor("streamers/youtube-comments-scraper").call({
      startUrls: [{ url: videoUrl }],
      maxComments: maxComments
    }, { timeout: 60 });

    const { items } = await client.dataset(run.defaultDatasetId).listItems();
    return items
      .map(item => item.textDisplay || item.text || item.comment || item.content || "")
      .filter(Boolean)
      .slice(0, maxComments);
  } catch (err) {
    console.warn("⚠️ Apify comment mining failed:", err.message);
    return [];
  }
}

// --- Reliable Bulk Email Extraction (exporter24 primary + apidojo fallback) ---
app.post("/api/extract-emails-bulk", async (req, res) => {
  const { channelUrls } = req.body;
  
  if (!channelUrls || !Array.isArray(channelUrls) || channelUrls.length === 0) {
    return res.status(400).json({ error: "No channel URLs provided" });
  }

  const token = getNextApifyToken();
  if (!token) {
    return res.status(503).json({ error: "No Apify tokens available", success: false, results: {} });
  }

  const client = new ApifyClient({ token });
  console.log(`🚀 Starting Apify bulk email extraction for ${channelUrls.length} channels...`);

  try {
    // Primary: exporter24/youtube-email-bulk-scraper (fast, reliable for batches <= 30)
    const run = await client.actor("exporter24/youtube-email-bulk-scraper").call({
      urls: channelUrls.map(url => ({ url }))
    }, { timeout: 180 });

    const { items } = await client.dataset(run.defaultDatasetId).listItems();
    const resultsMap = {};
    let totalEmailsFound = 0;

    items.forEach(item => {
      const emails = Array.isArray(item.email) ? item.email.filter(Boolean) : (item.email ? [item.email] : []);
      if (item.url) {
        resultsMap[item.url] = {
          emails,
          status: item.status || "COMPLETED"
        };
        totalEmailsFound += emails.length;
      }
    });

    console.log(`✅ Bulk email extraction complete: found ${totalEmailsFound} email(s) across ${items.length} channels.`);
    return res.json({ success: true, results: resultsMap });

  } catch (err) {
    console.warn("⚠️ Primary bulk email scraper failed, trying apidojo fallback:", err.message);

    // Fallback: apidojo/youtube-channel-information-scraper
    try {
      const fallbackRun = await client.actor("apidojo/youtube-channel-information-scraper").call({
        startUrls: channelUrls.map(url => ({ url }))
      }, { timeout: 180 });

      const { items } = await client.dataset(fallbackRun.defaultDatasetId).listItems();
      const resultsMap = {};

      items.forEach(item => {
        const key = item.channelUrl || item.url;
        const emails = Array.isArray(item.emails) ? item.emails.filter(Boolean) : (item.email ? [item.email] : []);
        if (key) {
          resultsMap[key] = {
            emails,
            status: "COMPLETED"
          };
        }
      });

      return res.json({ success: true, results: resultsMap });
    } catch (fallbackErr) {
      console.error("❌ All Apify bulk extractions failed:", fallbackErr.message);
      return res.status(500).json({ error: fallbackErr.message, success: false, results: {} });
    }
  }
});

// --- Last-Resort Premium Email Extractor (dataovercoffee/youtube-channel-business-email-scraper) ---
app.post("/api/extract-email-premium", async (req, res) => {
  const { channelUrl, channelId } = req.body;
  const target = channelUrl || channelId;

  if (!target) {
    return res.status(400).json({ error: "Missing channelUrl or channelId" });
  }

  const token = getNextApifyToken();
  if (!token) {
    return res.status(503).json({ error: "No Apify tokens available", success: false });
  }

  try {
    console.log(`⚡ Initiating premium reCAPTCHA email unlock for: ${target}`);
    const client = new ApifyClient({ token });

    // Actor requires timeout > 300 seconds in run options
    const run = await client.actor("dataovercoffee/youtube-channel-business-email-scraper").call({
      channels: [target]
    }, { timeout: 600 });

    const { items } = await client.dataset(run.defaultDatasetId).listItems();
    const result = items[0] || {};
    const email = result.email || result.business_email || (Array.isArray(result.emails) ? result.emails[0] : "");

    console.log(`✅ Premium extraction result for ${target}: ${email || "None found"}`);
    res.json({
      success: !!email,
      email: email || "",
      details: result
    });
  } catch (err) {
    console.error("❌ Premium email extraction failed:", err.message);
    res.status(500).json({ success: false, error: err.message, email: "" });
  }
});

// --- Lookalike & Niche Expansion (dataovercoffee/youtube-channel-lookalike-finder) ---
app.post("/api/channel-lookalikes", async (req, res) => {
  const { seedChannelUrl, seedChannelId, limit = 10 } = req.body;
  const seed = seedChannelUrl || seedChannelId;

  if (!seed) {
    return res.status(400).json({ error: "Missing seedChannelUrl or seedChannelId" });
  }

  const token = getNextApifyToken();
  if (!token) {
    return res.status(503).json({ error: "No Apify tokens available", success: false });
  }

  try {
    console.log(`🔍 Finding lookalike channels for seed: ${seed}`);
    const client = new ApifyClient({ token });

    // Actor requires timeout > 300 seconds in run options
    const run = await client.actor("dataovercoffee/youtube-channel-lookalike-finder").call({
      seed_channel_ids: [seed],
      limit: Math.min(limit, 15)
    }, { timeout: 600 });
    
    const { items } = await client.dataset(run.defaultDatasetId).listItems();

    const normalizedChannels = items.map(item => ({
      id: item.channel_id || item.id || "",
      name: item.channel_name || item.name || item.title || "Lookalike Channel",
      url: item.channel_url || (item.channel_id ? `https://youtube.com/channel/${item.channel_id}` : ""),
      subscribers: parseInt(item.subscribers || item.subscriber_count || 0),
      description: item.description || item.about || "",
      email: item.email || (item.emails && item.emails[0]) || "",
      emailAvailable: !!(item.email || (item.emails && item.emails.length > 0)),
      engagementRate: parseFloat(item.engagement_rate || item.engagementRate || 2.5),
      audienceMatch: "High",
      lookalikeScore: item.lookalike_score || null
    })).filter(c => c.url);

    console.log(`✅ Lookalike finder discovered ${normalizedChannels.length} similar creators`);
    res.json({
      success: true,
      channels: normalizedChannels
    });
  } catch (err) {
    console.error("❌ Lookalike finder failed:", err.message);
    res.status(500).json({ success: false, error: err.message, channels: [] });
  }
});

// --- Supabase Cross-Device Sync Endpoints ---
app.get("/api/supabase-status", (req, res) => {
  res.json({
    supabaseAvailable: !!supabase
  });
});

// Get all saved creators from Supabase
app.get("/api/saved-creators", async (req, res) => {
  if (!supabase) {
    return res.status(503).json({ success: false, error: "Supabase not configured", creators: [] });
  }

  try {
    const { data, error } = await supabase
      .from("saved_creators")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw error;

    // Reconstruct full creator objects from full_data + top-level columns
    const creators = (data || []).map(row => ({
      ...(row.full_data || {}),
      id: row.channel_id,
      name: row.channel_name,
      url: row.channel_url,
      subscribers: Number(row.subscribers || 0),
      engagementRate: Number(row.engagement_rate || 0),
      audienceMatch: row.audience_match || "Medium",
      email: row.email || "",
      emailAvailable: !!(row.email && row.email.length > 0),
      promotedProduct: row.promoted_product || "General Outreach",
      monetization: row.monetization || "Unknown",
      monetizationPotential: row.monetization_potential || "",
      ownerName: (row.full_data && row.full_data.ownerName) || "",
      greetingName: (row.full_data && row.full_data.greetingName) || "",
      subjectLine: (row.full_data && row.full_data.subjectLine) || row.ai_subject_line || "",
      email1Body: (row.full_data && row.full_data.email1Body) || row.ai_first_line || "",
      sequence: Array.isArray(row.sequence) ? row.sequence : [],
      savedAt: row.created_at
    }));

    res.json({ success: true, creators });
  } catch (err) {
    console.error("❌ Supabase fetch saved creators failed:", err.message);
    res.status(500).json({ success: false, error: err.message, creators: [] });
  }
});

// Save or upsert a creator (or batch of creators) into Supabase
app.post("/api/saved-creators", async (req, res) => {
  if (!supabase) {
    return res.status(503).json({ success: false, error: "Supabase not configured" });
  }

  try {
    const incoming = Array.isArray(req.body.creators)
      ? req.body.creators
      : (req.body.creator ? [req.body.creator] : []);

    if (incoming.length === 0) {
      return res.status(400).json({ success: false, error: "No creator data provided" });
    }

    const records = incoming.map(ch => ({
      channel_id: ch.id || ch.url,
      channel_name: ch.name || "Unknown Channel",
      channel_url: ch.url || "",
      subscribers: parseInt(ch.subscribers) || 0,
      engagement_rate: parseFloat(ch.engagementRate) || 0,
      audience_match: ch.audienceMatch || "Medium",
      email: ch.email || "",
      promoted_product: ch.promotedProduct || "General Outreach",
      monetization: ch.monetization || "Unknown",
      monetization_potential: ch.monetizationPotential || "",
      ai_subject_line: ch.subjectLine || "",
      ai_first_line: ch.email1Body || "",
      sequence: Array.isArray(ch.sequence) ? ch.sequence : [],
      full_data: ch
    }));

    const { error } = await supabase
      .from("saved_creators")
      .upsert(records, { onConflict: "channel_id" });

    if (error) throw error;

    console.log(`☁️ Synced ${records.length} creator(s) to Supabase`);
    res.json({ success: true, count: records.length });
  } catch (err) {
    console.error("❌ Supabase save creator failed:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Remove a saved creator from Supabase
app.delete("/api/saved-creators", async (req, res) => {
  if (!supabase) {
    return res.status(503).json({ success: false, error: "Supabase not configured" });
  }

  const { channelId, channelUrl } = req.body;
  const targetKey = channelId || channelUrl;

  if (!targetKey) {
    return res.status(400).json({ success: false, error: "Missing channelId or channelUrl" });
  }

  try {
    const { error } = await supabase
      .from("saved_creators")
      .delete()
      .or(`channel_id.eq.${targetKey},channel_url.eq.${targetKey}`);

    if (error) throw error;

    console.log(`🗑️ Deleted creator ${targetKey} from Supabase`);
    res.json({ success: true });
  } catch (err) {
    console.error("❌ Supabase delete creator failed:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get all saved product/service offers from Supabase
app.get("/api/saved-products", async (req, res) => {
  if (!supabase) {
    return res.status(503).json({ success: false, error: "Supabase not configured", products: [] });
  }

  try {
    const { data, error } = await supabase
      .from("saved_products")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw error;

    const products = (data || []).map(row => ({
      name: row.name,
      category: row.category || "",
      price: row.price || "",
      dealType: row.deal_type || "",
      commissionOrBudget: row.commission_or_budget || "",
      targetNiches: row.target_niches || "",
      description: row.description || "",
      buyerPersona: row.buyer_persona || ""
    }));

    res.json({ success: true, products });
  } catch (err) {
    console.error("❌ Supabase fetch saved products failed:", err.message);
    res.status(500).json({ success: false, error: err.message, products: [] });
  }
});

// Save or upsert a product/service offer in Supabase
app.post("/api/saved-products", async (req, res) => {
  if (!supabase) {
    return res.status(503).json({ success: false, error: "Supabase not configured" });
  }

  try {
    const incoming = Array.isArray(req.body.products)
      ? req.body.products
      : (req.body.product ? [req.body.product] : []);

    if (incoming.length === 0) {
      return res.status(400).json({ success: false, error: "No product data provided" });
    }

    const records = incoming.map(p => ({
      name: p.name,
      category: p.category || "",
      price: p.price || "",
      deal_type: p.dealType || "",
      commission_or_budget: p.commissionOrBudget || "",
      target_niches: p.targetNiches || "",
      description: p.description || "",
      buyer_persona: p.buyerPersona || ""
    }));

    const { error } = await supabase
      .from("saved_products")
      .upsert(records, { onConflict: "name" });

    if (error) throw error;

    console.log(`☁️ Synced ${records.length} product offer(s) to Supabase`);
    res.json({ success: true });
  } catch (err) {
    console.error("❌ Supabase save product failed:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Delete a saved product/service offer from Supabase
app.delete("/api/saved-products", async (req, res) => {
  if (!supabase) {
    return res.status(503).json({ success: false, error: "Supabase not configured" });
  }

  const { name } = req.body;
  if (!name) {
    return res.status(400).json({ success: false, error: "Missing product name" });
  }

  try {
    const { error } = await supabase
      .from("saved_products")
      .delete()
      .eq("name", name);

    if (error) throw error;

    console.log(`🗑️ Deleted product offer "${name}" from Supabase`);
    res.json({ success: true });
  } catch (err) {
    console.error("❌ Supabase delete product failed:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- Test endpoint to verify scraping is working ---
app.get("/api/test-scrape", async (req, res) => {
  const testChannelId = "UCofomcxxyhNuZ6qeHzInm3Q"; // From your test data
  
  try {
    const scrapeResp = await fetch(`${req.protocol}://${req.get('host')}/api/scrape-about?channelId=${testChannelId}`);
    const scrapeData = await scrapeResp.json();
    
    res.json({
      message: "Scraper test completed",
      testChannelId,
      scrapingWorking: scrapeResp.ok,
      puppeteerAvailable: !!puppeteer,
      results: scrapeData
    });
  } catch (err) {
    res.status(500).json({
      message: "Scraper test failed",
      error: err.message,
      puppeteerAvailable: !!puppeteer
    });
  }
});

// --- Serve frontend ---
app.use(express.static(path.join(__dirname, "public")));
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// --- Error handling middleware ---
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

// --- Start server ---
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`🔧 Puppeteer available: ${!!puppeteer}`);
  console.log(`📍 Environment: ${process.env.NODE_ENV || 'development'}`);
});
