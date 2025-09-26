import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY, // set in Render/ENV
});

/**
 * Generate a personalized subject line + first line for outreach
 * 
 * @param {Object} channelData
 * @param {string} channelData.channelName
 * @param {string} channelData.description - Channel "About" text
 * @param {Array} channelData.recentVideos - Array of {title, description}
 * @param {string} [channelData.ownerName] - optional pre-extracted first name
 * 
 * @returns {Promise<{subjectLine: string, firstLine: string}>}
 */
export async function generatePersonalizedOutreach(channelData) {
  const { channelName, description, recentVideos = [], ownerName } = channelData;

  // Fallback first name (try ownerName, else first token of channelName)
  const firstName =
    ownerName ||
    (channelName ? channelName.split(" ")[0] : "there");

  // Gather recent video titles (only need 5 max)
  const videoTitles = recentVideos.slice(0, 5).map(v => v.title).join("\n");

  // Construct the prompt
  const systemPrompt = `
You are an expert cold outreach copywriter.
Use the following YouTube channel data to generate personalized outreach.

### Rules:
1. Subject line: very short (max 6 words), intriguing, and specific to their recent content.
2. Extract the first name of the channel owner from the channel description or a video transcript or description or comments.
3. First line: MUST follow this template exactly:
   "Hey (First-Name), watched some of your recent videos like the one about (2-3 word summary of a recent video title), and noticed that..."
   - After "noticed that", continue with a personalized observation based on their About section or video themes. If nothing "noteworthy" can be extracted, refer to their specific monetization method (for example selling a course or affiliate products), or lack thereof.
3. Be specific and natural. No generic compliments. Avoid sounding like AI.
4. Always return valid JSON.

### Example:
{
  "subjectLine": "Your unedited videos from Dubai",
  "firstLine": "Hey John, watched some of your recent videos like the one about unedited Dubai vlogs, and noticed that you’ve been worried about their quality..."
}

---

Channel Name: ${channelName}
First Name: ${firstName}
About: ${description || "N/A"}
Recent Video Titles:
${videoTitles}
`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.7,
      messages: [
        { role: "system", content: systemPrompt },
      ],
      response_format: { type: "json_object" }
    });

    const content = response.choices[0].message.content;
    const parsed = JSON.parse(content);

    return {
      subjectLine: parsed.subjectLine || "",
      firstLine: parsed.firstLine || "",
    };
  } catch (err) {
    console.error("❌ OpenAI outreach generation failed:", err.message);
    return {
      subjectLine: "",
      firstLine: "",
    };
  }
}
