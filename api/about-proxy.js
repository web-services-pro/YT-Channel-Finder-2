export default async function handler(req, res) {
  try {
    const { channelId } = req.query;

    if (!channelId) {
      return res.status(400).json({ error: "Missing channelId" });
    }

    const aboutUrl = `https://www.youtube.com/channel/${channelId}/about`;
    const response = await fetch(aboutUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
      },
    });

    if (!response.ok) {
      return res
        .status(response.status)
        .json({ error: `Failed to fetch: ${response.status}` });
    }

    const html = await response.text();

    // ✅ Allow browser access
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Content-Type", "text/html; charset=utf-8");

    // ✅ Cache for 6 hours on browser & Vercel’s CDN
    res.setHeader(
      "Cache-Control",
      "public, s-maxage=21600, stale-while-revalidate=43200"
    );

    res.status(200).send(html);
  } catch (err) {
    console.error("Proxy error:", err);
    res.status(500).json({ error: "Proxy request failed" });
  }
}
