// api/generatePersonalizedOutreach.js
import OpenAI from "openai";

/**
 * Generate a personalized subject line + first line for outreach
 * 
 * @param {Object} channelData
 * @param {string} channelData.channelName
 * @param {string} channelData.description - Channel "About" text
 * @param {Array} channelData.recentVideos - Array of {title, description}
 * @param {string} [channelData.ownerName] - optional pre-extracted first name
 * @param {string} [channelData.openaiApiKey] - OpenAI API key
 * 
 * @returns {Promise<{subjectLine: string, firstLine: string}>}
 */
export async function generatePersonalizedOutreach(channelData) {
  const { channelName, description, recentVideos = [], ownerName, openaiApiKey } = channelData;

  // Check for API key (prefer parameter over environment variable)
  const apiKey = openaiApiKey || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.warn("⚠️ No OpenAI API key provided");
    return {
      subjectLine: "",
      firstLine: "",
    };
  }

  const openai = new OpenAI({ apiKey });

  // Fallback first name (try ownerName, else first token of channelName)
  const firstName =
    ownerName ||
    (channelName ? channelName.split(" ")[0] : "there");

  // Gather recent video titles (only need 3 max for context)
  const videoTitles = recentVideos
    .slice(0, 3)
    .map(v => v.title)
    .filter(Boolean)
    .join("\n");

  // Construct the prompt
  const systemPrompt = `
You are an expert cold outreach copywriter.
Use the following YouTube channel data to generate personalized outreach.

### Rules:
1. Subject line: very short (max 6 words), intriguing, and specific to their recent content.
2. First line: MUST follow this template exactly:
   "Hey ${firstName}, watched some of your recent videos like the one about [2-3 word summary of a recent video title], and noticed that..."
   - After "noticed that", continue with a personalized observation based on their About section or video themes.
3. Be specific and natural. No generic compliments. Avoid sounding like AI.
4. Always return valid JSON with exactly these keys: "subjectLine" and "firstLine"

### Example:
{
  "subjectLine": "Your Dubai vlog approach",
  "firstLine": "Hey John, watched some of your recent videos like the one about Dubai vlogs, and noticed that you focus heavily on authentic experiences rather than typical tourist spots..."
}

---

Channel Name: ${channelName}
First Name: ${firstName}
About: ${description || "N/A"}
Recent Video Titles:
${videoTitles || "No recent videos available"}
`;

  try {
    console.log(`🚀 Generating outreach for ${channelName} with OpenAI...`);
    
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.7,
      max_tokens: 200,
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
    };
  } catch (err) {
    console.error("❌ OpenAI outreach generation failed:", err.message);
    
    // Fallbacks
    const fallbackSubject = recentVideos.length > 0 
      ? `Your ${recentVideos[0].title.split(' ').slice(0, 2).join(' ')} video`
      : `Your ${channelName.split(' ')[0]} content`;
      
    const fallbackFirstLine = recentVideos.length > 0
      ? `Hey ${firstName}, watched your recent video about ${recentVideos[0].title.split(' ').slice(0, 3).join(' ')}, and noticed that you have a unique approach to your content...`
      : `Hey ${firstName}, came across your channel and noticed that you create interesting content in your niche...`;
    
    return {
      subjectLine: fallbackSubject.substring(0, 50), // Ensure short
      firstLine: fallbackFirstLine,
    };
  }
}
