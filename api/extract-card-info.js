/**
 * Vercel Serverless Function - AI Card Text Extraction
 * Uses vision AI to extract card details (name, set, number, etc.)
 *
 * Cost: ~$0.01-0.02 per card (using efficient vision model)
 */

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '5mb',
    },
  },
  maxDuration: 30,
};

// LLaVA model on Replicate - good vision-language model for text extraction
const LLAVA_VERSION = '6c27e6329d8c8d97e8c499bb90f2589a1699a7e83a68ee7178a79fe21a0afbdb';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;

  if (!REPLICATE_API_TOKEN) {
    return res.status(500).json({
      error: 'Replicate API not configured',
      message: 'Server missing REPLICATE_API_TOKEN'
    });
  }

  try {
    const { image, cardType = 'pokemon' } = req.body;

    if (!image) {
      return res.status(400).json({ error: 'No image provided' });
    }

    let imageUri = image;
    if (!image.startsWith('data:')) {
      imageUri = `data:image/jpeg;base64,${image}`;
    }

    // Craft prompt based on card type
    const prompts = {
      pokemon: `Look at this Pokemon trading card image and extract the following information. Be precise and only include what you can clearly see:

1. Card Name (the Pokemon or trainer name at the top)
2. HP (hit points number, if visible)
3. Card Number (usually at bottom, format like "123/200" or "SV049")
4. Set Name or Set Symbol (if visible)
5. Rarity Symbol (circle=common, diamond=uncommon, star=rare, etc.)
6. Card Type (Pokemon, Trainer, Energy)
7. Year (copyright year if visible)

Respond in JSON format only:
{"name": "", "hp": "", "cardNumber": "", "setName": "", "rarity": "", "cardType": "", "year": ""}

If you cannot read a field clearly, use null for that field.`,

      sports: `Look at this sports trading card image and extract the following information:

1. Player Name
2. Team Name
3. Card Number
4. Set/Brand Name
5. Year
6. Position (if visible)

Respond in JSON format only:
{"name": "", "team": "", "cardNumber": "", "setName": "", "year": "", "position": ""}

If you cannot read a field clearly, use null for that field.`,

      tcg: `Look at this trading card game card and extract:

1. Card Name
2. Card Number
3. Set Name
4. Rarity
5. Card Type
6. Year

Respond in JSON format only:
{"name": "", "cardNumber": "", "setName": "", "rarity": "", "cardType": "", "year": ""}

If you cannot read a field clearly, use null for that field.`,
    };

    const prompt = prompts[cardType] || prompts.tcg;

    console.log(`[OCR] Starting extraction for ${cardType} card...`);

    // Call LLaVA on Replicate
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
          temperature: 0.1, // Low temp for more consistent extraction
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Replicate API error:', response.status, errorText);
      return res.status(500).json({
        error: 'AI extraction failed',
        details: errorText,
      });
    }

    let prediction = await response.json();

    // Poll for result
    if (prediction.status === 'starting' || prediction.status === 'processing') {
      prediction = await pollForResult(prediction.urls.get, REPLICATE_API_TOKEN);
    }

    if (prediction.error || prediction.status === 'failed') {
      return res.status(500).json({
        error: prediction.error || 'Extraction failed'
      });
    }

    // Parse the response
    let extractedText = prediction.output;

    // LLaVA returns an array of strings, join them
    if (Array.isArray(extractedText)) {
      extractedText = extractedText.join('');
    }

    console.log('[OCR] Raw response:', extractedText);

    // Try to parse JSON from the response
    let cardInfo = null;
    try {
      // Find JSON in the response (may have extra text around it)
      const jsonMatch = extractedText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        cardInfo = JSON.parse(jsonMatch[0]);
      }
    } catch (parseError) {
      console.error('[OCR] JSON parse error:', parseError);
      // Return raw text if JSON parsing fails
      cardInfo = { raw: extractedText };
    }

    return res.status(200).json({
      success: true,
      cardInfo,
      rawResponse: extractedText,
      cardType,
      cost_estimate: 0.015,
    });

  } catch (error) {
    console.error('Card extraction error:', error);
    return res.status(500).json({
      error: 'Extraction failed',
      message: error.message
    });
  }
}

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
      console.error(`Poll attempt ${i + 1} failed:`, err.message);
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  return { error: 'Timeout waiting for extraction result' };
}
