// generatePersonalizedOutreach.js
import OpenAI from "openai";

/**
 * Generate a complete 6-email personalized outreach sequence for cold email automation.
 * Supports BOTH:
 * 1. Product / Service Partnership Mode (pitching a specific digital product, SaaS, or service via Affiliate/JV/Sponsorship)
 * 2. General Creator Monetization Mode (pitching custom revenue & digital asset partnerships)
 */
export async function generatePersonalizedOutreach(channelData) {
  const {
    channelName,
    description,
    recentVideos = [],
    recentComments = [],
    ownerName,
    currentMonetization = "Unknown",
    monetizationPotential = "",
    subscribers = 0,
    engagementRate = 0,
    productContext = null,
    openaiApiKey
  } = channelData;

  const apiKey = openaiApiKey || process.env.OPENAI_API_KEY;
  const firstName = ownerName || (channelName ? channelName.split(" ")[0] : "there");
  const topVideoTitle = recentVideos.length > 0 ? recentVideos[0].title : "your recent content";

  const hasProduct = !!(productContext && productContext.name && productContext.name.trim().length > 0);

  if (!apiKey) {
    console.warn("⚠️ No OpenAI API key provided, building structured fallback sequence");
    return generateFallbackSequence(channelName, firstName, topVideoTitle, monetizationPotential, productContext);
  }

  const openai = new OpenAI({ apiKey });

  const videoTitles = recentVideos
    .slice(0, 5)
    .map(v => `- "${v.title}"`)
    .join("\n") || "No recent video titles available";

  const commentText = recentComments
    .slice(0, 20)
    .map(c => `- "${c.replace(/\n+/g, ' ').slice(0, 150)}"`)
    .join("\n") || "No specific comments mined (infer high-intent audience questions based on video topics).";

  let systemPrompt = "";
  let userPrompt = "";

  if (hasProduct) {
    // --- PRODUCT / SERVICE PARTNERSHIP & AFFILIATE PITCH PROMPT ---
    const prodName = productContext.name.trim();
    const prodCategory = productContext.category || "Digital Product / Service";
    const prodDesc = productContext.description || "A specialized solution for their audience";
    const prodPrice = productContext.price ? `$${productContext.price}` : "competitive pricing";
    const prodBuyer = productContext.buyerPersona || "their core viewers";
    const dealType = productContext.dealType || "Affiliate / Joint Venture Partnership";
    const dealTerms = productContext.commissionOrBudget || "generous revenue share";

    systemPrompt = `You are an elite creator partnerships manager and cold outreach strategist.
Write a full, high-converting 6-step cold email sequence pitching a YouTube creator on partnering to promote a specific product or service ("${prodName}") to their audience.

### Product / Service Offer Details:
- Product/Service Name: ${prodName} (${prodCategory})
- What It Is: ${prodDesc}
- Price Point: ${prodPrice}
- Ideal Buyer: ${prodBuyer}
- Partnership Structure: ${dealType} (${dealTerms})

### Sequence Strategy:
1. Email 1 (Video Observation & Viewer Pain Point Hook):
   - Subject: Very short (2-5 words), lowercase/casual, specific to a recent video.
   - Body (~55-75 words): Greet ${firstName}. Reference a specific recent video ("${topVideoTitle}"). Point out a recurring pain point or question from their viewer comments that aligns directly with why people buy "${prodName}". Ask if they ever partner with relevant tools/products that help their viewers solve that exact problem.
2. Email 2 (The Product Fit & Offer Introduction):
   - Subject: "Re: [Email 1 Subject]"
   - Body (~60-80 words): Follow up 2 days later. Introduce "${prodName}" (${prodDesc}) at ${prodPrice}. Explain why it's a seamless fit for their audience (${prodBuyer}) and share the partnership terms (${dealType} — ${dealTerms}).
3. Email 3 (Zero-Friction Sample / Demo Offer):
   - Subject: "Free access to ${prodName} for ${firstName}"
   - Body (~55-75 words): Follow up 3 days later. Offer free full access / a complimentary walkthrough of "${prodName}" so they can test it firsthand with zero pressure before ever mentioning it to their audience.
4. Email 4 (Revenue & Audience Trust Angle):
   - Subject: "Quick thought on ${channelName}"
   - Body (~50-65 words): Contrast one-off low-CPM ad reads with a high-converting partner offer (${dealTerms}) on a ${prodPrice} product their viewers actually need. Ask if they'd be open to a quick 5-minute chat.
5. Email 5 (Low-Friction 2-Line Bump):
   - Subject: "${firstName} / quick bump"
   - Body (~25-35 words): Brief check-in acknowledging their filming schedule. Ask if reviewing "${prodName}" for a potential partnership is on their radar this month.
6. Email 6 (Permission to Close File / Graceful Breakup):
   - Subject: "Permission to close file?"
   - Body (~40-50 words): Respectful breakup email granting permission to close their file. Leaves the door open if they look for new affiliate/JV partners later.

### Copywriting Rules:
- Plain text feel. NO marketing jargon, robotic intros ("I hope this email finds you well"), or pushy hype.
- Natural line breaks between thoughts.
- Return ONLY valid JSON with this exact schema:
{
  "subjectLine": "Email 1 subject",
  "firstLine": "Email 1 first sentence",
  "monetizationPotential": "Promote ${prodName} (${dealTerms})",
  "sequence": [
    { "step": 1, "title": "Observation & Viewer Pain Point", "subject": "...", "body": "..." },
    { "step": 2, "title": "Product Fit & Partner Terms", "subject": "...", "body": "..." },
    { "step": 3, "title": "Free Access / Sample Offer", "subject": "...", "body": "..." },
    { "step": 4, "title": "Revenue & Conversion Angle", "subject": "...", "body": "..." },
    { "step": 5, "title": "Low-Friction 2-Line Bump", "subject": "...", "body": "..." },
    { "step": 6, "title": "Permission to Close File", "subject": "...", "body": "..." }
  ]
}`;

    userPrompt = `Target Creator Information:
Channel Name: ${channelName}
Creator First Name: ${firstName}
Subscribers: ${subscribers}
Engagement Rate: ${engagementRate}%
Current Monetization Signals: ${currentMonetization}
Channel Description: ${description || "N/A"}

Recent Videos:
${videoTitles}

Sample Viewer Comments / Feedback:
${commentText}`;
  } else {
    // --- GENERAL MONETIZATION PARTNERSHIP PROMPT ---
    systemPrompt = `You are an elite creator partnership director and cold email copywriter.
Write a full, high-converting 6-step cold email sequence reaching out to a YouTube creator to partner on monetizing their audience.

### Sequence Strategy:
1. Email 1 (Observation & Comment Pain Point Hook):
   - Subject: Very short (2-5 words), lowercase/casual, specific to a recent video.
   - Body (~50-70 words): Greet ${firstName}. Reference a specific recent video. Point out an explicit recurring question, complaint, or unmet need from viewer comments. Ask if they have an offer addressing this or are strictly focused on video production.
2. Email 2 (The Monetization Gap):
   - Subject: "Re: [Email 1 Subject]"
   - Body (~50-60 words): Follow up 2 days later. Note their current setup (${currentMonetization}) vs. their untapped potential (${monetizationPotential || "digital products / community"}). Explain why relying solely on their current streams leaves money on the table.
3. Email 3 (The Value Asset Offer):
   - Subject: "Resource for ${firstName} / [Topic] blueprint"
   - Body (~60-80 words): Follow up 3 days later. Offer a customized 1-page outline/blueprint showing how to structure, price, and announce this asset without feeling salesy. Ask if they want the 1-page PDF.
4. Email 4 (Social Proof & Volatility Angle):
   - Subject: "Quick thought on ${channelName}"
   - Body (~45-60 words): Contrast the volatility of algorithm-driven AdSense / sponsor RPMs with the stability of an owned asset that solves their audience's top comment struggle. Ask for a brief 5-minute chat.
5. Email 5 (Low-Friction 2-Line Bump):
   - Subject: "${firstName} / quick bump"
   - Body (~25-35 words): Brief check-in acknowledging their busy filming/editing schedule. Ask if exploring audience revenue is still on their roadmap this quarter.
6. Email 6 (Permission to Close File / Graceful Breakup):
   - Subject: "Permission to close file?"
   - Body (~40-50 words): Professional, respectful breakup email granting permission to close their file. Leaves the door open if monetizing viewer demand becomes a priority down the road.

### Copywriting Rules:
- Plain text feel. NO marketing jargon, robotic setups ("I hope this email finds you well"), or pushy sales pitches.
- Natural line breaks between thoughts.
- Return ONLY valid JSON with this exact schema:
{
  "subjectLine": "Email 1 subject",
  "firstLine": "Email 1 first sentence",
  "monetizationPotential": "1-2 phrase opportunity summary",
  "sequence": [
    { "step": 1, "title": "Observation & Pain Point Hook", "subject": "...", "body": "..." },
    { "step": 2, "title": "The Monetization Gap", "subject": "...", "body": "..." },
    { "step": 3, "title": "The Value Asset Offer", "subject": "...", "body": "..." },
    { "step": 4, "title": "Social Proof & Volatility Angle", "subject": "...", "body": "..." },
    { "step": 5, "title": "Low-Friction 2-Line Bump", "subject": "...", "body": "..." },
    { "step": 6, "title": "Permission to Close File", "subject": "...", "body": "..." }
  ]
}`;

    userPrompt = `Creator Information:
Channel Name: ${channelName}
Creator First Name: ${firstName}
Subscribers: ${subscribers}
Engagement Rate: ${engagementRate}%
Current Monetization Signals: ${currentMonetization}
Target Monetization Potential: ${monetizationPotential || "Not specified (derive best fit)"}
Channel Description: ${description || "N/A"}

Recent Videos:
${videoTitles}

Sample Viewer Comments / Feedback:
${commentText}`;
  }

  try {
    console.log(`🚀 Generating 6-step outreach sequence for ${channelName} (Mode: ${hasProduct ? 'Product: ' + productContext.name : 'General'})...`);

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

    return {
      subjectLine: parsed.subjectLine || (seq[0] ? seq[0].subject : `Question on ${topVideoTitle}`),
      firstLine: parsed.firstLine || (seq[0] ? seq[0].body.split('\n')[0] : `Hey ${firstName}, loved your recent work.`),
      monetizationPotential: parsed.monetizationPotential || (hasProduct ? `Promote ${productContext.name}` : (monetizationPotential || "Digital Products & Paid Community")),
      sequence: seq,
      email1Subject: seq[0]?.subject || "",
      email1Body: seq[0]?.body || "",
      email2Subject: seq[1]?.subject || "",
      email2Body: seq[1]?.body || "",
      email3Subject: seq[2]?.subject || "",
      email3Body: seq[2]?.body || "",
      email4Subject: seq[3]?.subject || "",
      email4Body: seq[3]?.body || "",
      email5Subject: seq[4]?.subject || "",
      email5Body: seq[4]?.body || "",
      email6Subject: seq[5]?.subject || "",
      email6Body: seq[5]?.body || ""
    };
  } catch (err) {
    console.error("❌ OpenAI sequence generation failed, using fallback sequence:", err.message);
    return generateFallbackSequence(channelName, firstName, topVideoTitle, monetizationPotential, productContext);
  }
}

function generateFallbackSequence(channelName, firstName, topVideoTitle, monetizationPotential, productContext = null) {
  const hasProduct = !!(productContext && productContext.name);
  const opportunity = hasProduct
    ? `Promote ${productContext.name} (${productContext.commissionOrBudget || 'Partner Split'})`
    : (monetizationPotential || "paid project guides & community");

  const seq = hasProduct ? [
    {
      step: 1,
      title: "Observation & Viewer Pain Point",
      subject: `Quick question on ${topVideoTitle.slice(0, 28)}`,
      body: `Hey ${firstName},\n\nWatched your recent video on "${topVideoTitle}" and noticed viewers in the comments asking for deeper help with the exact problem our ${productContext.name} solves.\n\nDo you ever partner with relevant ${productContext.category || 'tools'} that directly help your viewers?`
    },
    {
      step: 2,
      title: "Product Fit & Partner Terms",
      subject: `Re: Quick question on ${topVideoTitle.slice(0, 28)}`,
      body: `Hey ${firstName},\n\nFollowing up on my last note. We built ${productContext.name} (${productContext.description || ''}) specifically for ${productContext.buyerPersona || 'your audience'}.\n\nWe're offering creators a ${productContext.dealType || 'partner'} structure (${productContext.commissionOrBudget || '40% commission'}) on a $${productContext.price || '49'} offer. Open to checking it out?`
    },
    {
      step: 3,
      title: "Free Access / Sample Offer",
      subject: `Free access to ${productContext.name} for ${firstName}`,
      body: `Hey ${firstName},\n\nHappy to set you up with complimentary access to ${productContext.name} so you can test it firsthand with zero obligation.\n\nWant me to send over a VIP login link?`
    },
    {
      step: 4,
      title: "Revenue & Conversion Angle",
      subject: `Partner idea for ${channelName}`,
      body: `Hey ${firstName},\n\nBecause your viewers already trust your recommendations, a relevant offer like ${productContext.name} converts significantly higher than generic sponsor reads.\n\nOpen to a quick 5-minute chat next week?`
    },
    {
      step: 5,
      title: "Low-Friction 2-Line Bump",
      subject: `${firstName} / quick bump`,
      body: `Hey ${firstName},\n\nKnow you're busy filming and editing. Is testing ${productContext.name} for a potential partnership on your radar this month?`
    },
    {
      step: 6,
      title: "Permission to Close File",
      subject: `Permission to close file?`,
      body: `Hey ${firstName},\n\nHaven't heard back, so I assume now isn't the right time—completely understand.\n\nI'll close your file for now. Feel free to reach back out anytime if you'd like to partner!`
    }
  ] : [
    {
      step: 1,
      title: "Observation & Pain Point Hook",
      subject: `Question on ${topVideoTitle.slice(0, 30)}`,
      body: `Hey ${firstName},\n\nWatched your recent video on "${topVideoTitle}" and noticed in the comments that viewers consistently ask for deeper, step-by-step guidance.\n\nAre you currently building anything to address that audience demand, or primarily focused on video creation right now?`
    },
    {
      step: 2,
      title: "The Monetization Gap",
      subject: `Re: Question on ${topVideoTitle.slice(0, 30)}`,
      body: `Hey ${firstName},\n\nFollowing up on my last note. With your subscriber base, there is clear untapped room for ${opportunity}.\n\nMost channels in your niche miss this because AdSense and brand sponsorships take up all their bandwidth. Would you be open to seeing a 3-step outline of how to turn those viewer questions into recurring revenue?`
    },
    {
      step: 3,
      title: "The Value Asset Offer",
      subject: `Blueprint for ${channelName}`,
      body: `Hey ${firstName},\n\nPut together a quick 1-page breakdown of how a ${opportunity} could be structured for ${channelName} without adding more than 2 hours/week to your production workflow.\n\nHappy to send over the PDF if you're interested?`
    },
    {
      step: 4,
      title: "Social Proof & Volatility Angle",
      subject: `Quick thought on ${channelName}`,
      body: `Hey ${firstName},\n\nRelying on sponsor deals and volatile YouTube RPMs can feel like a treadmill. Building an owned product that directly answers your viewers' top questions creates predictable monthly revenue.\n\nOpen to a brief 5-minute chat next week to share ideas?`
    },
    {
      step: 5,
      title: "Low-Friction 2-Line Bump",
      subject: `${firstName} / quick check`,
      body: `Hey ${firstName},\n\nKnow you're busy filming and editing. Are you still exploring new ways to monetize ${channelName} this quarter, or should I take a step back?`
    },
    {
      step: 6,
      title: "Permission to Close File",
      subject: `Permission to close file?`,
      body: `Hey ${firstName},\n\nHaven't heard back, so I assume this isn't a priority right now—completely understand.\n\nI'll close your file for now. If you ever want to build an owned revenue engine for your audience, feel free to reach back out anytime!`
    }
  ];

  return {
    subjectLine: seq[0].subject,
    firstLine: seq[0].body.split('\n')[0],
    monetizationPotential: opportunity,
    sequence: seq,
    email1Subject: seq[0].subject,
    email1Body: seq[0].body,
    email2Subject: seq[1].subject,
    email2Body: seq[1].body,
    email3Subject: seq[2].subject,
    email3Body: seq[2].body,
    email4Subject: seq[3].subject,
    email4Body: seq[3].body,
    email5Subject: seq[4].subject,
    email5Body: seq[4].body,
    email6Subject: seq[5].subject,
    email6Body: seq[5].body
  };
}
