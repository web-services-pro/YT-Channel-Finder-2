import express from "express";
import puppeteer from "puppeteer";
import cors from "cors";
import bodyParser from "body-parser";
import path from "path";
import { fileURLToPath } from "url";

const app = express();

// Middleware
app.use(cors());
app.use(bodyParser.json());

// For ES modules (__dirname fix)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Health check endpoint
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", message: "Server is running 🚀" });
});

// --- Enhanced extractor run inside page.evaluate ---
async function extractContactInfoFromPage(page) {
  const result = await page.evaluate(() => {
    const uniq = arr => [...new Set(arr.filter(Boolean))];

    // --- Emails ---
    const emailRegex =
      /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    const pageText = document.body ? document.body.innerText : "";
    const emails = (pageText.match(emailRegex) || []).map(e => e.toLowerCase());

    // --- Anchors ---
    const anchors = Array.from(document.querySelectorAll("a[href]"))
      .map(a => a.href)
      .filter(Boolean);

    // --- JSON-LD blocks ---
    const jsonLd = Array.from(
      document.querySelectorAll('script[type="application/ld+json"]')
    )
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

    // --- Classify links ---
    const social = {};
    const websites = [];
    const otherLinks = [];

    const classify = href => {
      try {
        const host = new URL(href).hostname.replace(/^www\./, "").toLowerCase();
        if (host.includes("instagram.com")) return "instagram";
        if (host.includes("twitter.com") || host === "x.com") return "twitter";
        if (host.includes("facebook.com")) return "facebook";
        if (host.includes("tiktok.com")) return "tiktok";
        if (host.includes("linkedin.com")) return "linkedin";
        if (host.includes("patreon.com")) return "patreon";
        if (host.includes("ko-fi.com") || host.includes("kofi.com")) return "kofi";
        if (host.includes("discord.gg")) return "discord";
        if (host.includes("twitch.tv")) return "twitch";
        // filter out youtube + image CDN
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
      otherLinks: uniq(otherLinks)
    };
  });

  return result;
}

// Puppeteer-based scrape-about route
app.get("/api/scrape-about", async (req, res) => {
  const { channelId } = req.query;

  if (!channelId) {
    return res.status(400).json({ error: "Missing channelId parameter" });
  }

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-blink-features=AutomationControlled"
      ]
    });

    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    );

    const url = `https://www.youtube.com/channel/${channelId}/about`;
    await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
    await page.waitForTimeout(3000);

    const contacts = await extractContactInfoFromPage(page);

    res.json({
      channelId,
      aboutUrl: url,
      ...contacts
    });
  } catch (err) {
    console.error("❌ Error scraping channel:", err.message);
    res.status(500).json({ error: err.message });
  } finally {
    if (browser) await browser.close();
  }
});

// --- Serve frontend --- //
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Port binding
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
