import puppeteer from "puppeteer";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { channelId } = req.body;
    if (!channelId) {
      return res.status(400).json({ error: "Missing channelId" });
    }

    const browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"]
    });

    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Safari/537.36"
    );

    await page.goto(`https://www.youtube.com/channel/${channelId}/about`, {
      waitUntil: "networkidle2",
      timeout: 30000
    });

    // Extract contact info
    const contactInfo = await page.evaluate(() => {
      const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
      const emails = document.body.innerText.match(emailRegex) || [];

      const links = Array.from(document.querySelectorAll("a[href]")).map(a => a.href);

      const socials = {
        instagram: links.find(l => l.includes("instagram.com")) || "",
        twitter: links.find(l => l.includes("twitter.com") || l.includes("x.com")) || "",
        facebook: links.find(l => l.includes("facebook.com")) || "",
        tiktok: links.find(l => l.includes("tiktok.com")) || "",
        linkedin: links.find(l => l.includes("linkedin.com")) || "",
        patreon: links.find(l => l.includes("patreon.com")) || "",
        kofi: links.find(l => l.includes("ko-fi.com")) || ""
      };

      // Websites = non-social external links
      const websites = links.filter(href => {
        try {
          const hostname = new URL(href).hostname.toLowerCase();
          return !hostname.includes("youtube.com") &&
                 !hostname.includes("instagram.com") &&
                 !hostname.includes("twitter.com") &&
                 !hostname.includes("facebook.com") &&
                 !hostname.includes("tiktok.com") &&
                 !hostname.includes("linkedin.com") &&
                 !hostname.includes("patreon.com") &&
                 !hostname.includes("ko-fi.com");
        } catch {
          return false;
        }
      });

      return { emails, socials, websites };
    });

    await browser.close();

    res.status(200).json(contactInfo);
  } catch (err) {
    console.error("Scraping failed:", err);
    res.status(500).json({ error: "Scraping failed", details: err.message });
  }
}
