/**
 * xAI Grok Provider Implementation
 *
 * Grok uses an OpenAI-compatible API with a different base URL.
 *
 * Supports:
 * - Vision (image analysis) with grok-vision-beta
 * - URL-based images
 * - Base64 images
 * - Multiple images
 */

import OpenAI from 'openai';

// ═══════════════════════════════════════════════════════════════════════════
// MODEL CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

export const GROK_MODELS = {
  GROK_BETA: 'grok-beta',
  GROK_VISION_BETA: 'grok-vision-beta',
};

const DEFAULT_MODEL = GROK_MODELS.GROK_VISION_BETA;

// xAI API endpoint
const XAI_BASE_URL = 'https://api.x.ai/v1';

// ═══════════════════════════════════════════════════════════════════════════
// MAIN FUNCTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Call Grok with unified interface
 *
 * @param {object} options - Call options
 * @param {string} options.systemPrompt - System prompt
 * @param {string} options.userPrompt - User prompt
 * @param {string[]} options.images - Array of image URLs or base64 strings
 * @param {number} options.maxTokens - Max tokens (default 2000)
 * @param {number} options.temperature - Temperature (default 0.1)
 * @param {string} options.model - Model to use (optional)
 * @returns {Promise<object>} { success, text, parsed, usage, provider, model, error }
 */
export async function callGrok(options) {
  const {
    systemPrompt = '',
    userPrompt = '',
    images = [],
    maxTokens = 2000,
    temperature = 0.1,
    model = DEFAULT_MODEL,
  } = options;

  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) {
    return {
      success: false,
      error: 'XAI_API_KEY not configured',
      provider: 'grok',
    };
  }

  try {
    // Create OpenAI client with xAI base URL
    const xai = new OpenAI({
      apiKey: apiKey,
      baseURL: XAI_BASE_URL,
    });

    // Build message content (same format as OpenAI)
    const content = [];

    // Add images
    for (const img of images) {
      if (img.startsWith('http://') || img.startsWith('https://')) {
        // URL-based image
        content.push({
          type: 'image_url',
          image_url: {
            url: img,
          },
        });
      } else if (img.startsWith('data:')) {
        // Base64 data URL
        content.push({
          type: 'image_url',
          image_url: {
            url: img,
          },
        });
      } else {
        // Raw base64 - wrap in data URL
        content.push({
          type: 'image_url',
          image_url: {
            url: `data:image/jpeg;base64,${img}`,
          },
        });
      }
    }

    // Add text prompt
    content.push({
      type: 'text',
      text: userPrompt,
    });

    // Build messages array
    const messages = [];

    if (systemPrompt) {
      messages.push({
        role: 'system',
        content: systemPrompt,
      });
    }

    messages.push({
      role: 'user',
      content: content,
    });

    console.log(`[Grok] Calling ${model} with ${images.length} images...`);

    const response = await xai.chat.completions.create({
      model: model,
      max_tokens: maxTokens,
      temperature: temperature,
      messages: messages,
    });

    // Extract text from response
    const text = response.choices[0]?.message?.content || '';

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

    console.log(`[Grok] Response: ${text.length} chars, JSON: ${parsed ? 'yes' : 'no'}`);

    return {
      success: true,
      text,
      parsed,
      usage: {
        inputTokens: response.usage?.prompt_tokens || 0,
        outputTokens: response.usage?.completion_tokens || 0,
      },
      provider: 'grok',
      model: model,
    };

  } catch (error) {
    console.error('[Grok] Error:', error);

    let errorMessage = error.message || 'Unknown error';

    // Handle specific error types
    if (error.status === 401) {
      errorMessage = 'Invalid xAI API key';
    } else if (error.status === 429) {
      errorMessage = 'Rate limited - please try again';
    } else if (error.status === 503) {
      errorMessage = 'xAI service temporarily unavailable';
    }

    return {
      success: false,
      error: errorMessage,
      provider: 'grok',
      model: model,
      details: {
        status: error.status,
        code: error.code,
      },
    };
  }
}

export default { callGrok, GROK_MODELS };
