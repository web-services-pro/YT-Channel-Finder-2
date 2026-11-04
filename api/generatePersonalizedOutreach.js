// generatePersonalizedOutreach.js
import OpenAI from "openai";

/**
 * Generate a personalized subject line + first line for outreach
 * Optionally includes audience "pain points" extracted from YouTube comments.
 *
 * @param {Object} channelData
 * @param {string} channelData.channelName
 * @param {string} channelData.description - Channel "About" text
 * @param {Array} channelData.recentVideos - Array of {title, description}
 * @param {Array} [channelData.recentComments] - Optional array of raw comment strings
 * @param {string} [channelData.ownerName] - Optional pre-extracted first name
 * @param {string} [channelData.openaiApiKey] - OpenAI API key (overrides env var if provided)
 *
 * @returns {Promise<{subjectLine: string, firstLine: string}>}
 */
export async function generatePersonalizedOutreach(channelData) {
  const {
    channelName,
    description,
    recentVideos = [],
    recentComments = [],
    ownerName,
    currentMonetization = "Unknown",
    subscribers = 0,
    engagementRate = 0,
    openaiApiKey
  } = channelData;

  // Check for API key (prefer parameter over environment variable)
  const apiKey = openaiApiKey || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.warn("No OpenAI API key provided");
    return {
      subjectLine: "",
      firstLine: "",
      monetizationPotential: "Digital Products & Paid Community"
    };
  }

  const openai = new OpenAI({ apiKey });

  // Fallback first name (try ownerName, else first token of channelName)
  const firstName =
    ownerName ||
    (channelName ? channelName.split(" ")[0] : "there");

  // Gather recent video titles (max 5)
  const videoTitles = recentVideos
    .slice(0, 5)
    .map(v => v.title)
    .filter(Boolean)
    .join("\n");

  // Gather recent comments (optional)
  const commentText = recentComments
    .slice(0, 20) // cap for token sanity
    .join("\n");

  // Construct the outreach prompt
  const systemPrompt = `
You are an expert cold outreach copywriter and creator business strategist.
Use the following YouTube channel data to generate personalized outreach AND identify their single biggest untapped monetization opportunity.

### Rules:
1. Subject line: very short (max 6 words), intriguing, and specific to their recent content.
2. First line: MUST follow this template exactly:
   "Hey ${firstName}, watched some of your recent videos like the one about [2-3 word summary of a recent video title], and noticed that..."
   - After "noticed that", continue with:
     • A personalized observation based on their About section or video themes
     • If available, highlight recurring pain points, frustrations, or challenges mentioned in multiple YouTube comments.
       - Examples: "noticed your audience often asks about lead gen problems like wasted revenue and unqualified leads..."
       - Or: "noticed a number of contractors in the comments mention struggling with budgeting and customer acquisition..."
3. If no clear recurring pain points appear in the comments, pivot naturally by asking if their audience struggles with specific problems related to the channel’s theme.
   Example: "Do any of your subscribers say that they need to fix XYZ or solve XYZ problems?"
4. Monetization Potential:
   - Analyze what they currently monetize: "${currentMonetization}".
   - Compare with their channel scale: ${subscribers} subscribers and ${engagementRate}% engagement rate.
   - Propose 1 to 2 high-leverage monetization streams they are currently MISSING or could easily scale (e.g., "Paid Skool community & project blueprints", "High-ticket 1-on-1 consulting funnel", "Curated affiliate tool stack & brand deals", "Custom merch & membership tier").
   - Keep this under 10 words, punchy, and realistic.
5. Always return valid JSON with exactly these keys: "subjectLine", "firstLine", and "monetizationPotential".

### Example:
{
  "subjectLine": "Your Dubai vlog approach",
  "firstLine": "Hey John, watched some of your recent videos like the one about Dubai vlogs, and noticed that you focus heavily on authentic experiences rather than typical tourist spots...",
  "monetizationPotential": "Curated Travel Guides & Paid Community"
}

---

Channel Name: ${channelName}
First Name: ${firstName}
Subscribers: ${subscribers}
Engagement Rate: ${engagementRate}%
Current Monetization: ${currentMonetization}
About: ${description || "N/A"}
Recent Video Titles:
${videoTitles || "No recent videos available"}

Recent Comments (if any):
${commentText || "No relevant comments available"}
`;

  try {
    console.log(`🚀 Generating outreach & monetization analysis for ${channelName} with OpenAI...`);

    const response = await openai.chat.completions.create({
      model: "gpt-5.4-mini",
      temperature: 0.7,
      max_completion_tokens: 350,
      messages: [
        { role: "system", content: systemPrompt },
      ],
      response_format: { type: "json_object" }
    });

    const content = response.choices[0].message.content;
    console.log(`✅ OpenAI response for ${channelName}:`, content);

    const parsed = JSON.parse(content);

    return {
      subjectLine: parsed.subjectLine || "",
      firstLine: parsed.firstLine || "",
      monetizationPotential: parsed.monetizationPotential || "Digital Products & Consulting"
    };
  } catch (err) {
    console.error("❌ OpenAI outreach generation failed:", err.message);

    const fallbackSubject = recentVideos.length > 0
      ? `Your ${recentVideos[0].title.split(" ").slice(0, 2).join(" ")} video`
      : `Your ${channelName.split(" ")[0]} content`;

    const fallbackFirstLine = recentVideos.length > 0
      ? `Hey ${firstName}, watched your recent video about ${recentVideos[0].title.split(" ").slice(0, 3).join(" ")}, and noticed that you have a unique approach to your content...`
      : `Hey ${firstName}, came across your channel and noticed that you create interesting content in your niche...`;

    return {
      subjectLine: fallbackSubject.substring(0, 50),
      firstLine: fallbackFirstLine,
      monetizationPotential: "Digital Products & Community"
    };
  }
}
