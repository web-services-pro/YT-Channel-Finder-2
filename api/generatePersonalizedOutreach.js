// generatePersonalizedOutreach.js
import OpenAI from "openai";

/**
 * Resolve the channel owner's real first name from 5 sources and generate a
 * 6-step cold email sequence sharing a single master thread Subject Line.
 */
export async function generatePersonalizedOutreach(channelData) {
  const {
    channelName = "",
    channelHandle = "",
    description = "",
    recentVideos = [],
    recentComments = [],
    videoTranscript = "",
    contactEmail = "",
    ownerName = "",
    currentMonetization = "Unknown",
    monetizationPotential = "",
    subscribers = 0,
    engagementRate = 0,
    productContext = null,
    openaiApiKey
  } = channelData;

  const apiKey = openaiApiKey || process.env.OPENAI_API_KEY;
  const topVideoTitle = recentVideos.length > 0 ? recentVideos[0].title : "your recent content";
  const hasProduct = !!(productContext && productContext.name && productContext.name.trim().length > 0);

  if (!apiKey) {
    console.warn("⚠️ No OpenAI API key provided, building structured fallback sequence");
    const fallbackIdentity = detectFallbackOwnerIdentity({
      channelName,
      channelHandle,
      description,
      recentVideos,
      recentComments,
      videoTranscript,
      contactEmail,
      preSuppliedOwner: ownerName
    });
    return generateFallbackSequence(
      channelName,
      fallbackIdentity.ownerName,
      fallbackIdentity.greetingName,
      topVideoTitle,
      monetizationPotential,
      productContext
    );
  }

  const openai = new OpenAI({ apiKey });

  const videoDetails = recentVideos
    .slice(0, 5)
    .map(v => `- Title: "${v.title}"${v.description ? ` | Desc snippet: "${v.description.replace(/\n+/g, ' ').slice(0, 140)}"` : ""}`)
    .join("\n") || "No recent videos available";

  const commentText = recentComments
    .slice(0, 20)
    .map(c => `- "${c.replace(/\n+/g, ' ').slice(0, 160)}"`)
    .join("\n") || "No specific comments mined (infer high-intent audience questions based on video topics).";

  const transcriptSnippet = videoTranscript
    ? videoTranscript.replace(/\s+/g, " ").trim().slice(0, 700)
    : "No transcript available";

  const identityInstructions = `### STEP 1: IDENTIFY THE CHANNEL OWNER'S REAL NAME
Inspect ALL 5 evidence sources below to determine the real human host/creator's first name:
1. Channel Title & Handle: Look for embedded names (e.g., "The STRONG Roofer™ w/ Adam Bensman" -> "Adam", "DIY's by Carolina" -> "Carolina", "@johnmcgrath" -> "John").
2. Channel About / Description: Look for self-introductions ("Hi, I'm Ben...", "My name is Lauren...", "Hosted by Mike...", or co-hosts like "with Dan and Steve" -> "Dan & Steve").
3. Video Opening Transcript: Look for verbal intros in the first 60 seconds ("Hey everyone, Sherwood here...", "Welcome back, I'm Sarah...").
4. Viewer Comments: Look for commenters addressing the creator directly ("Great video Nathan!", "Thanks for sharing this, Gino!").
5. Video Descriptions & Email Prefix: Look for "Host: ...", personal sign-offs, or a personal first name in the email prefix (e.g., "alex@..." -> "Alex"; ignore generic prefixes like "info@", "contact@", "support@", "media@").

Name Output Rules:
- "ownerName": Return ONLY the human first name (e.g., "Adam", "Sarah") or co-hosts (e.g., "Dan & Steve"). If the channel is a faceless brand, news station, or company with NO identifiable human host, return "".
- "greetingName": If "ownerName" is found, set "greetingName" equal to "ownerName". If no human host exists (faceless brand), set "greetingName" to "${channelName} team" (e.g., "Toll Brothers team") so greetings read naturally as "Hey ${channelName} team,".`;

  let systemPrompt = "";
  let userPrompt = "";

  if (hasProduct) {
    const prodName = productContext.name.trim();
    const prodCategory = productContext.category || "Digital Product / Service";
    const prodDesc = productContext.description || "A specialized solution for their audience";
    const prodPrice = productContext.price ? `$${productContext.price}` : "competitive pricing";
    const prodBuyer = productContext.buyerPersona || "their core viewers";
    const dealType = productContext.dealType || "Affiliate / Joint Venture Partnership";
    const dealTerms = productContext.commissionOrBudget || "generous revenue share";

    systemPrompt = `You are an elite creator partnerships manager and cold outreach strategist.
First, determine the channel owner's real name. Second, write a full, high-converting 6-step cold email sequence pitching the creator on partnering to promote "${prodName}" to their audience.

${identityInstructions}

### STEP 2: 6-EMAIL THREAD SEQUENCE STRATEGY (SINGLE MASTER SUBJECT LINE)
Generate ONE master "subjectLine" for Email 1 (all follow-ups stay inside the same email thread, so follow-up steps only need a "body"):
1. Email 1 (Personalized Observation & Viewer Pain Point Hook — ~55-75 words):
   - Open with "Hey [greetingName],"
   - Reference a specific recent video ("${topVideoTitle}"). Point out a recurring pain point or question from their viewer comments (or inferred buyer struggle) that aligns with why people buy "${prodName}". Ask if they ever partner with relevant tools/products/services that help their viewers solve that exact problem.
2. Email 2 (Product Fit & Partnership Terms — ~60-80 words):
   - Open with "Hey [greetingName]," (sent 2 days later in the same thread). Introduce "${prodName}" (${prodDesc}) at ${prodPrice}. Explain why it fits their audience (${prodBuyer}) and share the partnership structure (${dealType} — ${dealTerms}).
3. Email 3 (Zero-Friction Sample / Walkthrough Offer — ~55-75 words):
   - Open with "Hey [greetingName]," (sent 3 days later). Offer complimentary access or a quick no-pressure walkthrough of "${prodName}" so they can see how it helps their audience firsthand.
4. Email 4 (Revenue & Audience Trust Angle — ~50-65 words):
   - Open with "Hey [greetingName]," Contrast one-off low-CPM ad reads with a high-converting partner offer (${dealTerms}) on a ${prodPrice} solution their viewers actively need. Ask if they'd be open to a brief 5-minute chat.
5. Email 5 (Low-Friction 2-Line Bump — ~25-35 words):
   - Open with "Hey [greetingName]," Brief check-in acknowledging their busy schedule. Ask if exploring a partnership around "${prodName}" is on their radar this month.
6. Email 6 (Permission to Close File / Graceful Breakup — ~40-50 words):
   - Open with "Hey [greetingName]," Respectful breakup email asking permission to close their file while leaving the door open down the road.

### Copywriting & JSON Rules:
- Plain text feel. NO robotic intros ("I hope this email finds you well") or pushy hype.
- Natural line breaks between paragraphs.
- Return ONLY valid JSON with this exact schema:
{
  "ownerName": "First name or empty string if brand",
  "greetingName": "First name or '[Channel Name] team'",
  "subjectLine": "Short 2-5 word master thread subject line",
  "monetizationPotential": "Promote ${prodName} (${dealTerms})",
  "sequence": [
    { "step": 1, "title": "Observation & Viewer Pain Point", "body": "..." },
    { "step": 2, "title": "Product Fit & Partner Terms", "body": "..." },
    { "step": 3, "title": "Free Access / Sample Offer", "body": "..." },
    { "step": 4, "title": "Revenue & Conversion Angle", "body": "..." },
    { "step": 5, "title": "Low-Friction 2-Line Bump", "body": "..." },
    { "step": 6, "title": "Permission to Close File", "body": "..." }
  ]
}`;

    userPrompt = `Target Creator Evidence:
Channel Name: ${channelName}
Channel Handle: ${channelHandle || "N/A"}
Contact Email: ${contactEmail || "N/A"}
Pre-detected Name Hint: ${ownerName || "None"}
Subscribers: ${subscribers}
Engagement Rate: ${engagementRate}%
Current Monetization Signals: ${currentMonetization}

Channel About / Description:
${description || "N/A"}

Latest Video Opening Transcript (First ~60s):
${transcriptSnippet}

Recent Videos:
${videoDetails}

Viewer Comments:
${commentText}`;
  } else {
    systemPrompt = `You are an elite creator partnership director and cold email copywriter.
First, determine the channel owner's real name. Second, write a full, high-converting 6-step cold email sequence reaching out to partner on monetizing their audience.

${identityInstructions}

### STEP 2: 6-EMAIL THREAD SEQUENCE STRATEGY (SINGLE MASTER SUBJECT LINE)
Generate ONE master "subjectLine" for Email 1 (all follow-ups stay inside the same email thread, so follow-up steps only need a "body"):
1. Email 1 (Observation & Comment Pain Point Hook — ~50-70 words):
   - Open with "Hey [greetingName],"
   - Reference a specific recent video. Point out a recurring question, complaint, or unmet need from viewer comments. Ask if they have an offer addressing this or are strictly focused on video production.
2. Email 2 (The Monetization Gap — ~50-60 words):
   - Open with "Hey [greetingName]," (sent 2 days later in the same thread). Note their current setup (${currentMonetization}) vs. their untapped potential (${monetizationPotential || "digital products / community"}). Explain why relying solely on current streams leaves revenue on the table.
3. Email 3 (The Value Asset Offer — ~60-80 words):
   - Open with "Hey [greetingName]," (sent 3 days later). Offer a customized 1-page outline/blueprint showing how to structure, price, and launch this asset without feeling salesy. Ask if they want the 1-page PDF.
4. Email 4 (Social Proof & Volatility Angle — ~45-60 words):
   - Open with "Hey [greetingName]," Contrast volatile AdSense / sponsor RPMs with the stability of an owned asset that solves their audience's top comment struggle. Ask for a brief 5-minute chat.
5. Email 5 (Low-Friction 2-Line Bump — ~25-35 words):
   - Open with "Hey [greetingName]," Brief check-in acknowledging their busy filming/editing schedule. Ask if exploring audience revenue is still on their roadmap this quarter.
6. Email 6 (Permission to Close File / Graceful Breakup — ~40-50 words):
   - Open with "Hey [greetingName]," Respectful breakup email asking permission to close their file while leaving the door open down the road.

### Copywriting & JSON Rules:
- Plain text feel. NO marketing jargon, robotic setups ("I hope this email finds you well"), or pushy sales pitches.
- Natural line breaks between paragraphs.
- Return ONLY valid JSON with this exact schema:
{
  "ownerName": "First name or empty string if brand",
  "greetingName": "First name or '[Channel Name] team'",
  "subjectLine": "Short 2-5 word master thread subject line",
  "monetizationPotential": "1-2 phrase opportunity summary",
  "sequence": [
    { "step": 1, "title": "Observation & Pain Point Hook", "body": "..." },
    { "step": 2, "title": "The Monetization Gap", "body": "..." },
    { "step": 3, "title": "The Value Asset Offer", "body": "..." },
    { "step": 4, "title": "Social Proof & Volatility Angle", "body": "..." },
    { "step": 5, "title": "Low-Friction 2-Line Bump", "body": "..." },
    { "step": 6, "title": "Permission to Close File", "body": "..." }
  ]
}`;

    userPrompt = `Creator Evidence:
Channel Name: ${channelName}
Channel Handle: ${channelHandle || "N/A"}
Contact Email: ${contactEmail || "N/A"}
Pre-detected Name Hint: ${ownerName || "None"}
Subscribers: ${subscribers}
Engagement Rate: ${engagementRate}%
Current Monetization Signals: ${currentMonetization}
Target Monetization Potential: ${monetizationPotential || "Not specified (derive best fit)"}

Channel About / Description:
${description || "N/A"}

Latest Video Opening Transcript (First ~60s):
${transcriptSnippet}

Recent Videos:
${videoDetails}

Viewer Comments:
${commentText}`;
  }

  try {
    console.log(`🚀 Generating 6-step outreach sequence & resolving owner name for ${channelName}...`);

    const response = await openai.chat.completions.create({
      model: "gpt-5.4-mini",
      temperature: 0.7,
      max_completion_tokens: 1500,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      response_format: { type: "json_object" }
    });

    const parsed = JSON.parse(response.choices[0].message.content);
    const seq = Array.isArray(parsed.sequence) ? parsed.sequence : [];

    const resolvedOwner = (parsed.ownerName || "").trim();
    const resolvedGreeting = (parsed.greetingName || "").trim() || (resolvedOwner || `${channelName} team`);
    const masterSubject = (parsed.subjectLine || "").trim() || `Question on ${topVideoTitle.slice(0, 30)}`;

    console.log(`👤 Resolved owner for "${channelName}": ${resolvedOwner || "(Faceless Brand -> " + resolvedGreeting + ")"}`);

    return {
      ownerName: resolvedOwner,
      greetingName: resolvedGreeting,
      subjectLine: masterSubject,
      monetizationPotential: parsed.monetizationPotential || (hasProduct ? `Promote ${productContext.name}` : (monetizationPotential || "Digital Products & Paid Community")),
      sequence: seq,
      email1Body: seq[0]?.body || "",
      email2Body: seq[1]?.body || "",
      email3Body: seq[2]?.body || "",
      email4Body: seq[3]?.body || "",
      email5Body: seq[4]?.body || "",
      email6Body: seq[5]?.body || ""
    };
  } catch (err) {
    console.error("❌ OpenAI sequence generation failed, using fallback sequence:", err.message);
    const fallbackIdentity = detectFallbackOwnerIdentity({
      channelName,
      channelHandle,
      description,
      recentVideos,
      recentComments,
      videoTranscript,
      contactEmail,
      preSuppliedOwner: ownerName
    });
    return generateFallbackSequence(
      channelName,
      fallbackIdentity.ownerName,
      fallbackIdentity.greetingName,
      topVideoTitle,
      monetizationPotential,
      productContext
    );
  }
}

/**
 * Deterministic multi-source regex fallback if OpenAI is unreachable
 */
function detectFallbackOwnerIdentity({
  channelName = "",
  description = "",
  recentComments = [],
  videoTranscript = "",
  contactEmail = "",
  preSuppliedOwner = ""
}) {
  if (preSuppliedOwner && preSuppliedOwner.trim() && preSuppliedOwner.trim().toLowerCase() !== channelName.trim().toLowerCase()) {
    const clean = preSuppliedOwner.trim();
    return { ownerName: clean, greetingName: clean };
  }

  // 1. Check Channel Name patterns ("w/ Adam Bensman", "with Sarah", "by Carolina")
  const titleMatch = channelName.match(/(?:\bw\/|\bwith|\bby)\s+([A-Z][a-z]{2,15})\b/);
  if (titleMatch) {
    return { ownerName: titleMatch[1], greetingName: titleMatch[1] };
  }

  // 2. Check Description & Transcript ("I'm Ben", "My name is Lauren", "Mike here", "Host: Alex")
  const combinedBio = `${description}\n${videoTranscript}`;
  const bioMatch = combinedBio.match(/(?:\bI['’]m|\bI am|\bMy name is|\bhosted by|\bHost:)\s+([A-Z][a-z]{2,15})\b/i)
    || combinedBio.match(/\b([A-Z][a-z]{2,15})\s+here\b/);
  if (bioMatch) {
    const name = bioMatch[1].charAt(0).toUpperCase() + bioMatch[1].slice(1).toLowerCase();
    return { ownerName: name, greetingName: name };
  }

  // 3. Check Viewer Comments ("Thanks Nathan!", "Great video Sherwood")
  const commentsBlob = recentComments.join(" ");
  const commentMatch = commentsBlob.match(/(?:\bThanks|\bThank you|\bGreat video|\bAwesome video|\bLove your videos),?\s+([A-Z][a-z]{2,15})\b/);
  if (commentMatch) {
    return { ownerName: commentMatch[1], greetingName: commentMatch[1] };
  }

  // 4. Check personal email prefix (e.g., "alex@..." -> "Alex")
  if (contactEmail && contactEmail.includes("@")) {
    const prefix = contactEmail.split("@")[0].replace(/[^a-zA-Z]/g, "");
    const genericPrefixes = new Set(["info", "contact", "support", "hello", "admin", "sales", "team", "media", "business", "inquiries", "office", "help", "pr", "press"]);
    if (prefix.length >= 3 && prefix.length <= 12 && !genericPrefixes.has(prefix.toLowerCase())) {
      const capitalized = prefix.charAt(0).toUpperCase() + prefix.slice(1).toLowerCase();
      return { ownerName: capitalized, greetingName: capitalized };
    }
  }

  // Faceless brand fallback
  return {
    ownerName: "",
    greetingName: `${channelName || "there"} team`
  };
}

function generateFallbackSequence(channelName, ownerName, greetingName, topVideoTitle, monetizationPotential, productContext = null) {
  const hasProduct = !!(productContext && productContext.name);
  const opportunity = hasProduct
    ? `Promote ${productContext.name} (${productContext.commissionOrBudget || 'Partner Split'})`
    : (monetizationPotential || "paid project guides & community");
  const masterSubject = `Question on ${topVideoTitle.slice(0, 30)}`;

  const seq = hasProduct ? [
    {
      step: 1,
      title: "Observation & Viewer Pain Point",
      body: `Hey ${greetingName},\n\nWatched your recent video on "${topVideoTitle}" and noticed viewers in the comments asking for deeper help with the exact problem our ${productContext.name} solves.\n\nDo you ever partner with relevant ${productContext.category || 'tools'} that directly help your viewers?`
    },
    {
      step: 2,
      title: "Product Fit & Partner Terms",
      body: `Hey ${greetingName},\n\nFollowing up on my last note. We built ${productContext.name} (${productContext.description || ''}) specifically for ${productContext.buyerPersona || 'your audience'}.\n\nWe're offering creators a ${productContext.dealType || 'partner'} structure (${productContext.commissionOrBudget || '40% commission'}) on a $${productContext.price || '49'} offer. Open to checking it out?`
    },
    {
      step: 3,
      title: "Free Access / Sample Offer",
      body: `Hey ${greetingName},\n\nHappy to set you up with complimentary access to ${productContext.name} so you can test it firsthand with zero obligation.\n\nWant me to send over a VIP login link?`
    },
    {
      step: 4,
      title: "Revenue & Conversion Angle",
      body: `Hey ${greetingName},\n\nBecause your viewers already trust your recommendations, a relevant offer like ${productContext.name} converts significantly higher than generic sponsor reads.\n\nOpen to a quick 5-minute chat next week?`
    },
    {
      step: 5,
      title: "Low-Friction 2-Line Bump",
      body: `Hey ${greetingName},\n\nKnow you're busy filming and editing. Is testing ${productContext.name} for a potential partnership on your radar this month?`
    },
    {
      step: 6,
      title: "Permission to Close File",
      body: `Hey ${greetingName},\n\nHaven't heard back, so I assume now isn't the right time—completely understand.\n\nI'll close your file for now. Feel free to reach back out anytime if you'd like to partner!`
    }
  ] : [
    {
      step: 1,
      title: "Observation & Pain Point Hook",
      body: `Hey ${greetingName},\n\nWatched your recent video on "${topVideoTitle}" and noticed in the comments that viewers consistently ask for deeper, step-by-step guidance.\n\nAre you currently building anything to address that audience demand, or primarily focused on video creation right now?`
    },
    {
      step: 2,
      title: "The Monetization Gap",
      body: `Hey ${greetingName},\n\nFollowing up on my last note. With your subscriber base, there is clear untapped room for ${opportunity}.\n\nMost channels in your niche miss this because AdSense and brand sponsorships take up all their bandwidth. Would you be open to seeing a 3-step outline of how to turn those viewer questions into recurring revenue?`
    },
    {
      step: 3,
      title: "The Value Asset Offer",
      body: `Hey ${greetingName},\n\nPut together a quick 1-page breakdown of how a ${opportunity} could be structured for ${channelName} without adding more than 2 hours/week to your production workflow.\n\nHappy to send over the PDF if you're interested?`
    },
    {
      step: 4,
      title: "Social Proof & Volatility Angle",
      body: `Hey ${greetingName},\n\nRelying on sponsor deals and volatile YouTube RPMs can feel like a treadmill. Building an owned product that directly answers your viewers' top questions creates predictable monthly revenue.\n\nOpen to a brief 5-minute chat next week to share ideas?`
    },
    {
      step: 5,
      title: "Low-Friction 2-Line Bump",
      body: `Hey ${greetingName},\n\nKnow you're busy filming and editing. Are you still exploring new ways to monetize ${channelName} this quarter, or should I take a step back?`
    },
    {
      step: 6,
      title: "Permission to Close File",
      body: `Hey ${greetingName},\n\nHaven't heard back, so I assume this isn't a priority right now—completely understand.\n\nI'll close your file for now. If you ever want to build an owned revenue engine for your audience, feel free to reach back out anytime!`
    }
  ];

  return {
    ownerName,
    greetingName,
    subjectLine: masterSubject,
    monetizationPotential: opportunity,
    sequence: seq,
    email1Body: seq[0].body,
    email2Body: seq[1].body,
    email3Body: seq[2].body,
    email4Body: seq[3].body,
    email5Body: seq[4].body,
    email6Body: seq[5].body
  };
}
