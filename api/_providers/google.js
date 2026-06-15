/**
 * Google Gemini Provider Implementation
 *
 * Supports:
 * - Vision (image analysis)
 * - Base64 images (URLs must be converted)
 * - Multiple images (up to 16)
 *
 * Note: Gemini requires base64 images, not URLs.
 * The provider will automatically convert URLs to base64.
 */

import { GoogleGenerativeAI } from '@google/generative-ai';

// ═══════════════════════════════════════════════════════════════════════════
// MODEL CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

export const GEMINI_MODELS = {
  PRO_25: 'gemini-2.5-pro',
  PRO: 'gemini-1.5-pro',
  PRO_LATEST: 'gemini-1.5-pro-latest',
  FLASH: 'gemini-1.5-flash',
  FLASH_LATEST: 'gemini-1.5-flash-latest',
};

const DEFAULT_MODEL = GEMINI_MODELS.PRO_25;

// ═══════════════════════════════════════════════════════════════════════════
// MAIN FUNCTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Call Gemini with unified interface
 *
 * @param {object} options - Call options
 * @param {string} options.systemPrompt - System prompt (prepended to user prompt)
 * @param {string} options.userPrompt - User prompt
 * @param {string[]} options.images - Array of image URLs or base64 strings
 * @param {number} options.maxTokens - Max tokens (default 2000)
 * @param {number} options.temperature - Temperature (default 0.1)
 * @param {string} options.model - Model to use (optional)
 * @returns {Promise<object>} { success, text, parsed, usage, provider, model, error }
 */
export async function callGemini(options) {
  const {
    systemPrompt = '',
    userPrompt = '',
    images = [],
    maxTokens = 2000,
    temperature = 0.1,
    model = DEFAULT_MODEL,
  } = options;

  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) {
    return {
      success: false,
      error: 'GOOGLE_AI_API_KEY not configured',
      provider: 'gemini',
    };
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const geminiModel = genAI.getGenerativeModel({
      model: model,
      generationConfig: {
        maxOutputTokens: maxTokens,
        temperature: temperature,
      },
    });

    // Build content parts
    const parts = [];

    // Convert images to Gemini format
    for (const img of images) {
      const imageData = await convertToGeminiFormat(img);
      if (imageData) {
        parts.push({
          inlineData: {
            mimeType: imageData.mimeType,
            data: imageData.base64,
          },
        });
      }
    }

    // Combine system and user prompts (Gemini doesn't have separate system prompt)
    const combinedPrompt = systemPrompt
      ? `${systemPrompt}\n\n---\n\n${userPrompt}`
      : userPrompt;

    parts.push({ text: combinedPrompt });

    console.log(`[Gemini] Calling ${model} with ${images.length} images...`);

    const result = await geminiModel.generateContent(parts);
    const response = await result.response;
    const text = response.text();

    // Try to parse JSON from response
    let parsed = null;
    try {
      let jsonText = text.trim();
      if (jsonText.startsWith('```')) {
        jsonText = jsonText.replace(/```json?\n?/g, '').replace(/```$/g, '');
      }
      const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      }
    } catch (e) {
      // JSON parsing failed, that's OK
    }

    console.log(`[Gemini] Response: ${text.length} chars, JSON: ${parsed ? 'yes' : 'no'}`);

    return {
      success: true,
      text,
      parsed,
      usage: {
        // Gemini doesn't expose token counts in the same way
        inputTokens: 0,
        outputTokens: 0,
      },
      provider: 'gemini',
      model: model,
    };

  } catch (error) {
    console.error('[Gemini] Error:', error);

    let errorMessage = error.message || 'Unknown error';

    // Handle specific error types
    if (error.message?.includes('API key')) {
      errorMessage = 'Invalid Google AI API key';
    } else if (error.message?.includes('quota')) {
      errorMessage = 'Quota exceeded - please try again later';
    } else if (error.message?.includes('safety')) {
      errorMessage = 'Content blocked by safety filters';
    }

    return {
      success: false,
      error: errorMessage,
      provider: 'gemini',
      model: model,
      details: {
        code: error.code,
      },
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Convert image to Gemini format (base64)
 */
async function convertToGeminiFormat(img) {
  try {
    if (img.startsWith('http://') || img.startsWith('https://')) {
      // URL - need to fetch and convert to base64
      const response = await fetch(img);
      const buffer = await response.arrayBuffer();
      const base64 = Buffer.from(buffer).toString('base64');
      const mimeType = response.headers.get('content-type') || 'image/jpeg';
      return { base64, mimeType };

    } else if (img.startsWith('data:')) {
      // Data URL - extract base64 and mime type
      const matches = img.match(/^data:([^;]+);base64,(.+)$/);
      if (matches) {
        return {
          mimeType: matches[1],
          base64: matches[2],
        };
      }
    } else {
      // Raw base64 - assume JPEG
      return {
        mimeType: 'image/jpeg',
        base64: img,
      };
    }
  } catch (error) {
    console.error('[Gemini] Image conversion error:', error);
    return null;
  }

  return null;
}

export default { callGemini, GEMINI_MODELS };
