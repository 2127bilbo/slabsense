/**
 * Anthropic Claude Provider Implementation
 *
 * Supports:
 * - Vision (image analysis)
 * - URL-based images
 * - Base64 images
 * - Multiple images (up to 20)
 */

import Anthropic from '@anthropic-ai/sdk';

// ═══════════════════════════════════════════════════════════════════════════
// MODEL CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

export const CLAUDE_MODELS = {
  SONNET: 'claude-sonnet-4-20250514',
  OPUS: 'claude-opus-4-20250514',
  HAIKU: 'claude-3-5-haiku-20241022',
};

const DEFAULT_MODEL = CLAUDE_MODELS.SONNET;

// ═══════════════════════════════════════════════════════════════════════════
// MAIN FUNCTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Call Claude with unified interface
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
export async function callClaude(options) {
  const {
    systemPrompt = '',
    userPrompt = '',
    images = [],
    maxTokens = 2000,
    temperature = 0.1,
    model = DEFAULT_MODEL,
  } = options;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      success: false,
      error: 'ANTHROPIC_API_KEY not configured',
      provider: 'claude',
    };
  }

  try {
    const anthropic = new Anthropic({ apiKey });

    // Build message content
    const content = [];

    // Add images
    for (const img of images) {
      if (img.startsWith('http://') || img.startsWith('https://')) {
        // URL-based image
        content.push({
          type: 'image',
          source: {
            type: 'url',
            url: img,
          },
        });
      } else if (img.startsWith('data:')) {
        // Base64 data URL
        const matches = img.match(/^data:([^;]+);base64,(.+)$/);
        if (matches) {
          content.push({
            type: 'image',
            source: {
              type: 'base64',
              media_type: matches[1],
              data: matches[2],
            },
          });
        }
      } else {
        // Raw base64 (assume JPEG)
        content.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: 'image/jpeg',
            data: img,
          },
        });
      }
    }

    // Add text prompt
    content.push({
      type: 'text',
      text: userPrompt,
    });

    console.log(`[Claude] Calling ${model} with ${images.length} images...`);

    const response = await anthropic.messages.create({
      model: model,
      max_tokens: maxTokens,
      temperature: temperature,
      system: systemPrompt || undefined,
      messages: [{
        role: 'user',
        content,
      }],
    });

    // Extract text from response
    const textContent = response.content.find(c => c.type === 'text');
    const text = textContent?.text || '';

    // Try to parse JSON from response
    let parsed = null;
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      }
    } catch (e) {
      // JSON parsing failed, that's OK
    }

    console.log(`[Claude] Response: ${text.length} chars, JSON: ${parsed ? 'yes' : 'no'}`);

    return {
      success: true,
      text,
      parsed,
      usage: {
        inputTokens: response.usage?.input_tokens || 0,
        outputTokens: response.usage?.output_tokens || 0,
      },
      provider: 'claude',
      model: model,
    };

  } catch (error) {
    console.error('[Claude] Error:', error);

    // Handle specific error types
    let errorMessage = error.message || 'Unknown error';

    if (error.status === 401) {
      errorMessage = 'Invalid Anthropic API key';
    } else if (error.status === 429) {
      errorMessage = 'Rate limited - please try again';
    } else if (error.message?.includes('Could not download image')) {
      errorMessage = 'Could not access image URLs';
    }

    return {
      success: false,
      error: errorMessage,
      provider: 'claude',
      model: model,
      details: {
        status: error.status,
        code: error.code,
      },
    };
  }
}

export default { callClaude, CLAUDE_MODELS };
