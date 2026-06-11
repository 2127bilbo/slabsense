/**
 * Unified Card Info Extraction
 *
 * MERGED FROM:
 * - analyze-card.js (Claude-based comprehensive analysis)
 * - extract-card-info.js (LLaVA-based quick extraction via Replicate)
 *
 * This single endpoint handles both modes based on the 'mode' parameter:
 * - mode: 'claude' → Full Claude analysis (default, recommended)
 * - mode: 'llava' → Quick LLaVA extraction via Replicate (legacy)
 *
 * FREES UP: 1 Vercel serverless function slot
 */

import Anthropic from '@anthropic-ai/sdk';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
  maxDuration: 60,
};

// LLaVA model on Replicate (legacy)
const LLAVA_VERSION = '6c27e6329d8c8d97e8c499bb90f2589a1699a7e83a68ee7178a79fe21a0afbdb';

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const {
    mode = 'claude',  // 'claude' | 'llava'
    image,
    cardType = 'pokemon',
    includeGrading = true,  // Only used in claude mode
  } = req.body;

  if (!image) {
    return res.status(400).json({ error: 'No image provided' });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CLAUDE MODE (default, recommended)
  // ═══════════════════════════════════════════════════════════════════════════
  if (mode === 'claude') {
    const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

    if (!ANTHROPIC_API_KEY) {
      return res.status(500).json({
        error: 'Anthropic API not configured',
        message: 'Server missing ANTHROPIC_API_KEY'
      });
    }

    try {
      // Extract base64 data from data URL
      let base64Data = image;
      let mediaType = 'image/jpeg';

      if (image.startsWith('data:')) {
        const matches = image.match(/^data:([^;]+);base64,(.+)$/);
        if (matches) {
          mediaType = matches[1];
          base64Data = matches[2];
        }
      }

      console.log(`[CardInfo-Unified] Claude mode: ${cardType} card`);

      const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

      const prompt = buildClaudePrompt(cardType, includeGrading);

      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mediaType,
                data: base64Data,
              },
            },
            { type: 'text', text: prompt },
          ],
        }],
      });

      const responseText = response.content[0]?.text || '';
      console.log('[CardInfo-Unified] Claude response length:', responseText.length);

      let analysisResult = null;
      try {
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          analysisResult = JSON.parse(jsonMatch[0]);
        }
      } catch (parseError) {
        console.error('[CardInfo-Unified] JSON parse error:', parseError);
        analysisResult = { raw: responseText };
      }

      return res.status(200).json({
        success: true,
        analysis: analysisResult,
        rawResponse: responseText,
        cardType,
        model: 'claude-sonnet-4-20250514',
        mode: 'claude',
        cost_estimate: 0.04,
      });

    } catch (error) {
      console.error('[CardInfo-Unified] Claude error:', error);
      return res.status(500).json({
        error: 'Analysis failed',
        message: error.message
      });
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // LLAVA MODE (legacy Replicate)
  // ═══════════════════════════════════════════════════════════════════════════
  if (mode === 'llava') {
    const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;

    if (!REPLICATE_API_TOKEN) {
      return res.status(500).json({
        error: 'Replicate API not configured',
        message: 'Server missing REPLICATE_API_TOKEN'
      });
    }

    try {
      let imageUri = image;
      if (!image.startsWith('data:')) {
        imageUri = `data:image/jpeg;base64,${image}`;
      }

      console.log(`[CardInfo-Unified] LLaVA mode: ${cardType} card`);

      const prompt = buildLLaVAPrompt(cardType);

      const response = await fetch('https://api.replicate.com/v1/predictions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${REPLICATE_API_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          version: LLAVA_VERSION,
          input: {
            image: imageUri,
            prompt: prompt,
            max_tokens: 500,
            temperature: 0.1,
          },
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return res.status(500).json({
          error: 'AI extraction failed',
          details: errorText,
        });
      }

      let prediction = await response.json();

      if (prediction.status === 'starting' || prediction.status === 'processing') {
        prediction = await pollForResult(prediction.urls.get, REPLICATE_API_TOKEN);
      }

      if (prediction.error || prediction.status === 'failed') {
        return res.status(500).json({
          error: prediction.error || 'Extraction failed'
        });
      }

      let extractedText = prediction.output;
      if (Array.isArray(extractedText)) {
        extractedText = extractedText.join('');
      }

      console.log('[CardInfo-Unified] LLaVA response:', extractedText?.substring(0, 200));

      let cardInfo = null;
      try {
        const jsonMatch = extractedText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          cardInfo = JSON.parse(jsonMatch[0]);
        }
      } catch (parseError) {
        cardInfo = { raw: extractedText };
      }

      return res.status(200).json({
        success: true,
        cardInfo,
        rawResponse: extractedText,
        cardType,
        mode: 'llava',
        cost_estimate: 0.015,
      });

    } catch (error) {
      console.error('[CardInfo-Unified] LLaVA error:', error);
      return res.status(500).json({
        error: 'Extraction failed',
        message: error.message
      });
    }
  }

  return res.status(400).json({ error: `Unknown mode: ${mode}. Use 'claude' or 'llava'` });
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

async function pollForResult(url, token, maxAttempts = 25) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      const data = await response.json();

      if (data.status === 'succeeded') {
        return data;
      } else if (data.status === 'failed' || data.status === 'canceled') {
        return { error: data.error || 'Extraction failed', status: data.status };
      }

      await new Promise(r => setTimeout(r, 1000));
    } catch (err) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  return { error: 'Timeout waiting for extraction result' };
}

function buildClaudePrompt(cardType, includeGrading) {
  const basePrompt = `Analyze this trading card image carefully and extract all visible information.

Return your analysis as a JSON object with the following structure:`;

  const pokemonFields = `
{
  "cardInfo": {
    "name": "Card/Pokemon name",
    "hp": "HP value if visible",
    "cardNumber": "Card number (e.g., '123/200' or 'SV049')",
    "setName": "Set name if identifiable",
    "setSymbol": "Description of set symbol if visible",
    "rarity": "Rarity (Common/Uncommon/Rare/Holo Rare/Ultra Rare/Secret Rare/etc.)",
    "cardType": "Pokemon/Trainer/Energy",
    "year": "Copyright year",
    "language": "Card language (English/Japanese/etc.)",
    "variant": "Special variant if any (Full Art/Alt Art/Rainbow/Gold/etc.)"
  }${includeGrading ? `,
  "condition": {
    "overall": 9.5,
    "corners": 9.5,
    "edges": 9.5,
    "surface": 9.5,
    "centering": 9.5,
    "notes": "Brief description of condition"
  },
  "gradingNotes": {
    "positives": ["Good aspect 1", "Good aspect 2"],
    "concerns": ["Concern 1", "Concern 2"],
    "estimatedGrade": "9.5",
    "confidence": "medium"
  }` : ''}
}`;

  const sportsFields = `
{
  "cardInfo": {
    "name": "Player name",
    "team": "Team name",
    "cardNumber": "Card number",
    "setName": "Set/brand name",
    "year": "Year",
    "position": "Player position if visible",
    "variant": "Parallel/insert type if any"
  }${includeGrading ? `,
  "condition": {
    "overall": 9.5,
    "corners": 9.5,
    "edges": 9.5,
    "surface": 9.5,
    "centering": 9.5,
    "notes": "Brief description"
  },
  "gradingNotes": {
    "positives": [],
    "concerns": [],
    "estimatedGrade": "9.5",
    "confidence": "medium"
  }` : ''}
}`;

  const fields = cardType === 'sports' ? sportsFields : pokemonFields;

  const instructions = `

Important:
- Only include information you can clearly see
- Use null for fields you cannot determine
- Be specific about condition issues
- Return ONLY the JSON object`;

  return basePrompt + fields + instructions;
}

function buildLLaVAPrompt(cardType) {
  const prompts = {
    pokemon: `Look at this Pokemon trading card and extract:
1. Card Name (Pokemon or trainer name)
2. HP (if visible)
3. Card Number (format like "123/200")
4. Set Name
5. Rarity Symbol
6. Card Type (Pokemon, Trainer, Energy)
7. Year

Respond in JSON:
{"name": "", "hp": "", "cardNumber": "", "setName": "", "rarity": "", "cardType": "", "year": ""}

Use null for unclear fields.`,

    sports: `Look at this sports card and extract:
1. Player Name
2. Team Name
3. Card Number
4. Set/Brand Name
5. Year
6. Position

Respond in JSON:
{"name": "", "team": "", "cardNumber": "", "setName": "", "year": "", "position": ""}

Use null for unclear fields.`,

    tcg: `Look at this trading card and extract:
1. Card Name
2. Card Number
3. Set Name
4. Rarity
5. Card Type
6. Year

Respond in JSON:
{"name": "", "cardNumber": "", "setName": "", "rarity": "", "cardType": "", "year": ""}

Use null for unclear fields.`,
  };

  return prompts[cardType] || prompts.tcg;
}
