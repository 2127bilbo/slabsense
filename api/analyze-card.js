/**
 * Vercel Serverless Function - Claude Vision Card Analysis
 * Comprehensive AI analysis: OCR, condition assessment, grading notes
 *
 * Features:
 * - Card info extraction (name, set, number, year, rarity)
 * - Condition assessment (scratches, whitening, centering)
 * - Grading notes for user feedback
 * - Works with any card type (Pokemon, sports, TCG)
 *
 * Cost: ~$0.03-0.05 per analysis
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

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

  if (!ANTHROPIC_API_KEY) {
    return res.status(500).json({
      error: 'Anthropic API not configured',
      message: 'Server missing ANTHROPIC_API_KEY'
    });
  }

  try {
    const { image, cardType = 'pokemon', includeGrading = true } = req.body;

    if (!image) {
      return res.status(400).json({ error: 'No image provided' });
    }

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

    console.log(`[Claude Vision] Analyzing ${cardType} card...`);

    const anthropic = new Anthropic({
      apiKey: ANTHROPIC_API_KEY,
    });

    // Build the analysis prompt based on card type and options
    const prompt = buildAnalysisPrompt(cardType, includeGrading);

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [
        {
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
            {
              type: 'text',
              text: prompt,
            },
          ],
        },
      ],
    });

    // Parse the response
    const responseText = response.content[0]?.text || '';
    console.log('[Claude Vision] Raw response:', responseText.substring(0, 500));

    // Extract JSON from response
    let analysisResult = null;
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        analysisResult = JSON.parse(jsonMatch[0]);
      }
    } catch (parseError) {
      console.error('[Claude Vision] JSON parse error:', parseError);
      analysisResult = { raw: responseText };
    }

    return res.status(200).json({
      success: true,
      analysis: analysisResult,
      rawResponse: responseText,
      cardType,
      model: 'claude-sonnet-4-20250514',
      cost_estimate: 0.04,
    });

  } catch (error) {
    console.error('Card analysis error:', error);
    return res.status(500).json({
      error: 'Analysis failed',
      message: error.message
    });
  }
}

function buildAnalysisPrompt(cardType, includeGrading) {
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
  },
  "condition": {
    "overall": 9.5,
    "corners": 9.5,
    "edges": 9.5,
    "surface": 9.5,
    "centering": 9.5,
    "notes": "Brief description of overall condition and any notable issues"
  },
  "gradingNotes": {
    "positives": ["Good aspect 1", "Good aspect 2"],
    "concerns": ["Concern 1 that might lower grade", "Concern 2"],
    "estimatedGrade": "9.5",
    "confidence": "medium"
  }
}

IMPORTANT for condition scores:
- Use NUMERIC scores from 1-10 (decimals allowed like 9.5)
- 10 = Pristine/Gem Mint (factory perfect)
- 9-9.5 = Gem Mint to Mint (nearly perfect)
- 8-8.5 = Near Mint to Mint (minor issues)
- 7-7.5 = Near Mint (light wear visible)
- 6-6.5 = Excellent/Near Mint- (moderate wear)
- 5 or below = noticeable damage or heavy wear`;

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
  },
  "condition": {
    "overall": 9.5,
    "corners": 9.5,
    "edges": 9.5,
    "surface": 9.5,
    "centering": 9.5,
    "notes": "Brief description of overall condition and any notable issues"
  },
  "gradingNotes": {
    "positives": ["Good aspect 1", "Good aspect 2"],
    "concerns": ["Concern 1", "Concern 2"],
    "estimatedGrade": "9.5",
    "confidence": "medium"
  }
}

IMPORTANT for condition scores:
- Use NUMERIC scores from 1-10 (decimals allowed like 9.5)
- 10 = Pristine/Gem Mint (factory perfect)
- 9-9.5 = Gem Mint to Mint (nearly perfect)
- 8-8.5 = Near Mint to Mint (minor issues)
- 7-7.5 = Near Mint (light wear visible)
- 6-6.5 = Excellent/Near Mint- (moderate wear)
- 5 or below = noticeable damage or heavy wear`;

  const fields = cardType === 'sports' ? sportsFields : pokemonFields;

  const instructions = `

Important instructions:
- Only include information you can clearly see in the image
- Use null for any field you cannot determine
- Be specific about condition issues (location, severity)
- For centering, estimate the border ratios if visible
- Note any print defects, scratches, whitening, or damage
- Be objective and thorough in your assessment

Return ONLY the JSON object, no additional text.`;

  return basePrompt + fields + instructions;
}
