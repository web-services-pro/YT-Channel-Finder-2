import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import path from "path";
import { fileURLToPath } from "url";
import { generatePersonalizedOutreach } from "./api/generatePersonalizedOutreach.js";

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

console.log(`✅ YouTube API Keys loaded: ${YOUTUBE_API_KEYS.length} keys`);
console.log(`✅ OpenAI API Key loaded: ${!!OPENAI_API_KEY}`);

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

// API keys availability check
app.get("/api/keys-status", (req, res) => {
  res.json({
    youtubeKeysAvailable: YOUTUBE_API_KEYS.length > 0,
    youtubeKeysCount: YOUTUBE_API_KEYS.length,
    openaiKeyAvailable: !!OPENAI_API_KEY
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

// --- Enhanced Scrape About Page ---
app.get("/api/scrape-about", async (req, res) => {
  const { channelId } = req.query;
  if (!channelId) return res.status(400).json({ error: "Missing channelId" });

  // Check if puppeteer is available
  if (!puppeteer) {
    return res.status(503).json({ 
      error: "Puppeteer not available in this environment",
      channelId,
      success: false,
      emails: [],
      social: {},
      websites: [],
      otherLinks: [],
      hasBusinessInquiry: false
    });
  }

  let browser;
  try {
    console.log(`Starting scrape for channel: ${channelId}`);
    
    // Cloud-optimized browser launch with Chromium executable detection
    const launchOptions = {
      headless: "new",
      args: [
        "--no-sandbox", 
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-accelerated-2d-canvas",
        "--no-first-run",
        "--no-zygote",
        "--disable-gpu",
        "--disable-background-timer-throttling",
        "--disable-backgrounding-occluded-windows",
        "--disable-renderer-backgrounding",
        "--disable-features=TranslateUI",
        "--disable-ipc-flooding-protection"
      ],
      timeout: 60000
    };

    // Try to find Chromium - CHECK PUPPETEER CACHE FIRST
    const possiblePaths = [
      // Puppeteer's cache locations (most likely on Render)
      '/opt/render/.cache/puppeteer/chrome/linux-127.0.6533.88/chrome-linux64/chrome',
      '/opt/render/.cache/puppeteer/chrome/linux-131.0.6778.87/chrome-linux64/chrome',
      // System Chrome installations
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium',
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      process.env.PUPPETEER_EXECUTABLE_PATH
    ].filter(Boolean);

    // Always check for executablePath in cloud environments
    const fs = await import('fs');
    for (const path of possiblePaths) {
      try {
        if (fs.existsSync(path)) {
          launchOptions.executablePath = path;
          console.log(`✅ Found Chromium at: ${path}`);
          break;
        }
      } catch (e) {
        console.warn(`Failed to check path ${path}:`, e.message);
      }
    }

    // If still no executable found, log all checked paths
    if (!launchOptions.executablePath) {
      console.error('❌ No Chromium executable found. Checked paths:', possiblePaths);
      throw new Error('Chromium executable not found. Please ensure build command ran successfully.');
    }

    browser = await puppeteer.launch(launchOptions);
    
    const page = await browser.newPage();
    
    // Set realistic user agent and viewport
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );
    await page.setViewport({ width: 1920, height: 1080 });

    const url = `https://www.youtube.com/channel/${channelId}/about`;
    console.log(`Navigating to: ${url}`);
    
    // Navigate with timeout
    await page.goto(url, { 
      waitUntil: "networkidle2", 
      timeout: 30000 
    });

    // Wait for dynamic content
    await page.waitForTimeout(2000);

    // Check if page loaded correctly
    const title = await page.title();
    console.log(`Page title: ${title}`);
    
    if (title.includes('404') || title.includes('not found')) {
      throw new Error('Channel not found or About page not accessible');
    }

    // Extract contact information
    const contacts = await extractContactInfoFromPage(page);
    
    console.log(`✅ Scrape results for ${channelId}:`, {
      emailsFound: contacts.emails.length,
      websitesFound: contacts.websites.length,
      socialLinksFound: contacts.socialLinksFound,
      totalLinksFound: contacts.totalLinksFound,
      hasBusinessInquiry: contacts.hasBusinessInquiry
    });

    await browser.close();

    res.json({ 
      channelId, 
      aboutUrl: url,
      success: true,
      ...contacts 
    });

  } catch (err) {
    console.error(`❌ Error scraping channel ${channelId}:`, err.message);
    
    if (browser) {
      try {
        await browser.close();
      } catch (closeErr) {
        console.error("Error closing browser:", closeErr.message);
      }
    }

    res.status(500).json({ 
      error: err.message, 
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

// --- AI Outreach Generation ---
app.post("/api/outreach", async (req, res) => {
  try {
    const { channelName, description, recentVideos, ownerName } = req.body;

    console.log(`🚀 Outreach request for: ${channelName}`);
    console.log(`Using server-side OpenAI key: ${!!OPENAI_API_KEY}`);

    const outreach = await generatePersonalizedOutreach({
      channelName,
      description,
      recentVideos: recentVideos || [],
      ownerName: ownerName || "",
      openaiApiKey: OPENAI_API_KEY  // Use server-side key
    });

    console.log(`✅ Outreach result for ${channelName}:`, outreach);

    res.json({
      success: true,
      aiSubjectLine: outreach.subjectLine,
      aiFirstLine: outreach.firstLine
    });
  } catch (err) {
    console.error("❌ Outreach error:", err.message);
    res.status(500).json({ 
      error: err.message,
      success: false,
      aiSubjectLine: "",
      aiFirstLine: ""
    });
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
