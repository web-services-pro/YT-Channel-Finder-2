import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import path from "path";
import { fileURLToPath } from "url";
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { executablePath } from "puppeteer";
import { generatePersonalizedOutreach } from "./api/generatePersonalizedOutreach.js";

puppeteer.use(StealthPlugin());

const app = express();

// Middleware
app.use(cors());
app.use(bodyParser.json());

// For ES modules (__dirname fix)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", message: "Server is running 🚀" });
});

// --- Scraper helpers ---
async function extractContactInfoFromPage(page) {
  const result = await page.evaluate(() => {
    const uniq = arr => [...new Set(arr.filter(Boolean))];

    // Email regex
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    const pageText = document.body ? document.body.innerText : "";
    const emails = (pageText.match(emailRegex) || []).map(e => e.toLowerCase());

    // Detect "business inquiry"
    const hasBusinessInquiry = (() => {
      try {
        const btn = Array.from(document.querySelectorAll("tp-yt-paper-button, button, a"))
          .find(el =>
            (el.innerText || "").toLowerCase().includes("business inquiry") ||
            (el.innerText || "").toLowerCase().includes("business inquiries")
          );
        if (btn) return true;

        const mailAnchor = Array.from(document.querySelectorAll('a[href^="mailto:"]')).length > 0;
        if (mailAnchor) return true;
      } catch {
        // ignore
      }
      return false;
    })();

    // Collect anchor links
    const anchors = Array.from(document.querySelectorAll("a[href]"))
      .map(a => a.href)
      .filter(Boolean);

    // Collect links from JSON-LD
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
          if (o.sameAs) sameAsLinks = sameAsLinks.concat(o.sameAs);
        });
      } else if (obj.sameAs) {
        if (Array.isArray(obj.sameAs)) {
          sameAsLinks = sameAsLinks.concat(obj.sameAs);
        } else {
          sameAsLinks.push(obj.sameAs);
        }
      }
    });

    const allLinks = anchors.concat(sameAsLinks);

    // Social link detection
    const social = {};
    const websites = [];
    const otherLinks = [];

    const classify = href => {
      try {
        const host = new URL(href).hostname.replace(/^www\./, "").toLowerCase();
        if (host.includes("instagram.com")) return "instagram";
        if (host.includes("twitter.com") || host.includes("x.com")) return "twitter";
        if (host.includes("facebook.com")) return "facebook";
        if (host.includes("tiktok.com")) return "tiktok";
        if (host.includes("linkedin.com")) return "linkedin";
        if (host.includes("patreon.com")) return "patreon";
        if (host.includes("discord.gg") || host.includes("discord.com")) return "discord";
        if (host.includes("twitch.tv")) return "twitch";
        // ignore YT + image/CDN
        if (
          host.includes("youtube.com") ||
          host.includes("youtu.be") ||
          host.includes("ytimg.com") ||
          host.includes("googleusercontent.com")
        ) {
          return "ignore";
        }
        return "website";
      } catch {
        return "other";
      }
    };

    allLinks.forEach(href => {
      const type = classify(href);
      if (type === "ignore") return;
      if (type === "website") websites.push(href);
      else if (type === "other") otherLinks.push(href);
      else social[type] = social[type] || href;
    });

    return {
      emails: uniq(emails),
      social,
      websites: uniq(websites),
      otherLinks: uniq(otherLinks),
      hasBusinessInquiry
    };
  });

  // Competitor-style scraping of visible external links
  const socialLinks = await page.$$eval(
    ".yt-channel-external-link-view-model-wiz__container a",
    links => links.map(link => link.href)
  );

  if (socialLinks && socialLinks.length > 0) {
    socialLinks.forEach(href => {
      if (href.includes("instagram.com")) result.social.instagram = href;
      else if (href.includes("twitter.com") || href.includes("x.com")) result.social.twitter = href;
      else if (href.includes("facebook.com")) result.social.facebook = href;
      else if (href.includes("tiktok.com")) result.social.tiktok = href;
      else if (href.includes("linkedin.com")) result.social.linkedin = href;
      else result.otherLinks.push(href);
    });
  }

  return result;
}

// --- Scrape About Page ---
app.get("/api/scrape-about", async (req, res) => {
  const { channelId } = req.query;
  if (!channelId) return res.status(400).json({ error: "Missing channelId" });

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      executablePath: executablePath(),
      args: ["--no-sandbox", "--disable-setuid-sandbox"]
    });

    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    );

    const url = `https://www.youtube.com/channel/${channelId}/about`;
    await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });

    const contacts = await extractContactInfoFromPage(page);

    res.json({ channelId, aboutUrl: url, ...contacts });
  } catch (err) {
    console.error("❌ Error scraping channel:", err.message);
    res.status(500).json({ error: err.message });
  } finally {
    if (browser) await browser.close();
  }
});

// --- AI Outreach ---
app.post("/api/outreach", async (req, res) => {
  try {
    const { channelName, description, recentVideos, ownerName } = req.body;

    const outreach = await generatePersonalizedOutreach({
      channelName,
      description,
      recentVideos: recentVideos || [],
      ownerName: ownerName || ""
    });

    res.json({
      success: true,
      aiSubjectLine: outreach.subjectLine,
      aiFirstLine: outreach.firstLine
    });
  } catch (err) {
    console.error("❌ Outreach error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- Serve frontend ---
app.use(express.static(path.join(__dirname, "public")));
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// --- Start server ---
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
