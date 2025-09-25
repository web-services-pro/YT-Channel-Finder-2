import express from "express";
import puppeteer from "puppeteer";
import cors from "cors";
import bodyParser from "body-parser";

const app = express();

// Middleware
app.use(cors());
app.use(bodyParser.json());

// Health check endpoint
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", message: "Server is running 🚀" });
});

// Utility: extract contacts from page HTML
function extractContactInfo(html) {
  const emails = [];
  const websites = [];
  const socialMedia = {};

  // --- Email regex ---
  const emailRegex =
    /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const foundEmails = html.match(emailRegex) || [];
  foundEmails.forEach((e) => {
    if (!emails.includes(e.toLowerCase())) {
      emails.push(e.toLowerCase());
    }
  });

  // --- Links parsing ---
  const linkRegex = /https?:\/\/[^\s"']+/g;
  const links = html.match(linkRegex) || [];

  links.forEach((href) => {
    const url = href.toLowerCase();

    if (url.includes("instagram.com")) socialMedia.instagram = href;
    else if (url.includes("twitter.com") || url.includes("x.com"))
      socialMedia.twitter = href;
    else if (url.includes("facebook.com")) socialMedia.facebook = href;
    else if (url.includes("tiktok.com")) socialMedia.tiktok = href;
    else if (url.includes("linkedin.com")) socialMedia.linkedin = href;
    else if (url.includes("patreon.com")) socialMedia.patreon = href;
    else if (url.includes("ko-fi.com")) socialMedia.kofi = href;
    else if (url.includes("discord.gg")) socialMedia.discord = href;
    else if (url.includes("twitch.tv")) socialMedia.twitch = href;
    else {
      // treat as a "website" if not YouTube/social
      if (
        !url.includes("youtube.com") &&
        !url.includes("youtu.be") &&
        !websites.includes(href)
      ) {
        websites.push(href);
      }
    }
  });

  return { emails, websites, socialMedia };
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

    // Navigate to About page
    const url = `https://www.youtube.com/channel/${channelId}/about`;
    await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });

    // Give it a bit of breathing room
    await page.waitForTimeout(3000);

    // Extract raw HTML
    const content = await page.content();

    // Extract contact info
    const contacts = extractContactInfo(content);

    res.json({
      channelId,
      aboutUrl: url,
      ...contacts,
      rawHtml: content
    });
  } catch (err) {
    console.error("❌ Error scraping channel:", err.message);
    res.status(500).json({ error: err.message });
  } finally {
    if (browser) {
      await browser.close();
    }
  }
});

// Port binding (Render uses process.env.PORT)
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
