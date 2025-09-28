// Fixed server.js scraper functions

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
        const pathname = url.pathname.toLowerCase();
        
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

// Enhanced scrape endpoint with better error handling and logging
app.get("/api/scrape-about", async (req, res) => {
  const { channelId } = req.query;
  if (!channelId) return res.status(400).json({ error: "Missing channelId" });

  let browser;
  try {
    console.log(`Starting scrape for channel: ${channelId}`);
    
    browser = await puppeteer.launch({
      headless: true,
      executablePath: executablePath(),
      args: [
        "--no-sandbox", 
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-accelerated-2d-canvas",
        "--no-first-run",
        "--no-zygote",
        "--disable-gpu"
      ]
    });

    const page = await browser.newPage();
    
    // Set a more realistic user agent
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );

    // Set viewport
    await page.setViewport({ width: 1920, height: 1080 });

    const url = `https://www.youtube.com/channel/${channelId}/about`;
    console.log(`Navigating to: ${url}`);
    
    // Navigate with longer timeout and better error handling
    await page.goto(url, { 
      waitUntil: "networkidle2", 
      timeout: 60000 
    });

    // Wait a bit for dynamic content to load
    await page.waitForTimeout(3000);

    // Check if page loaded correctly
    const title = await page.title();
    console.log(`Page title: ${title}`);
    
    if (title.includes('404') || title.includes('not found')) {
      throw new Error('Channel not found or About page not accessible');
    }

    // Extract contact information
    const contacts = await extractContactInfoFromPage(page);
    
    console.log(`Scrape results for ${channelId}:`, {
      emailsFound: contacts.emails.length,
      websitesFound: contacts.websites.length,
      socialLinksFound: contacts.socialLinksFound,
      totalLinksFound: contacts.totalLinksFound,
      hasBusinessInquiry: contacts.hasBusinessInquiry
    });

    res.json({ 
      channelId, 
      aboutUrl: url,
      success: true,
      ...contacts 
    });

  } catch (err) {
    console.error(`❌ Error scraping channel ${channelId}:`, err.message);
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
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch (closeErr) {
        console.error("Error closing browser:", closeErr.message);
      }
    }
  }
});

// Add a test endpoint to verify scraping is working
app.get("/api/test-scrape", async (req, res) => {
  const testChannelId = "UCofomcxxyhNuZ6qeHzInm3Q"; // From your test data
  
  try {
    const scrapeResp = await fetch(`${req.protocol}://${req.get('host')}/api/scrape-about?channelId=${testChannelId}`);
    const scrapeData = await scrapeResp.json();
    
    res.json({
      message: "Scraper test completed",
      testChannelId,
      scrapingWorking: scrapeResp.ok,
      results: scrapeData
    });
  } catch (err) {
    res.status(500).json({
      message: "Scraper test failed",
      error: err.message
    });
  }
});
