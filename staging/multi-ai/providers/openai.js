/**
 * OpenAI GPT Provider Implementation
 *
 * Supports:
 * - Vision (image analysis) with GPT-4o
 * - URL-based images
 * - Base64 images
 * - Multiple images (up to 10)
 */

import OpenAI from 'openai';

// ═══════════════════════════════════════════════════════════════════════════
// MODEL CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

export const GPT_MODELS = {
  GPT4O: 'gpt-4o',
  GPT4O_MINI: 'gpt-4o-mini',
  GPT4_TURBO: 'gpt-4-turbo',
  GPT4: 'gpt-4',
};

const DEFAULT_MODEL = GPT_MODELS.GPT4O;

// ═══════════════════════════════════════════════════════════════════════════
// MAIN FUNCTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Call GPT with unified interface
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
export async function callGPT(options) {
  const {
    systemPrompt = '',
    userPrompt = '',
    images = [],
    maxTokens = 2000,
    temperature = 0.1,
    model = DEFAULT_MODEL,
  } = options;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return {
      success: false,
      error: 'OPENAI_API_KEY not configured',
      provider: 'gpt',
    };
  }

  try {
    const openai = new OpenAI({ apiKey });

    // Build message content
    const content = [];

    // Add images
    for (const img of images) {
      if (img.startsWith('http://') || img.startsWith('https://')) {
        // URL-based image
        content.push({
          type: 'image_url',
          image_url: {
            url: img,
            detail: 'high',  // Use high detail for card grading
          },
        });
      } else if (img.startsWith('data:')) {
        // Base64 data URL
        content.push({
          type: 'image_url',
          image_url: {
            url: img,
            detail: 'high',
          },
        });
      } else {
        // Raw base64 - wrap in data URL
        content.push({
          type: 'image_url',
          image_url: {
            url: `data:image/jpeg;base64,${img}`,
            detail: 'high',
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

    console.log(`[GPT] Calling ${model} with ${images.length} images...`);

    const response = await openai.chat.completions.create({
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

    console.log(`[GPT] Response: ${text.length} chars, JSON: ${parsed ? 'yes' : 'no'}`);

    return {
      success: true,
      text,
      parsed,
      usage: {
        inputTokens: response.usage?.prompt_tokens || 0,
        outputTokens: response.usage?.completion_tokens || 0,
      },
      provider: 'gpt',
      model: model,
    };

  } catch (error) {
    console.error('[GPT] Error:', error);

    let errorMessage = error.message || 'Unknown error';

    // Handle specific error types
    if (error.status === 401 || error.code === 'invalid_api_key') {
      errorMessage = 'Invalid OpenAI API key';
    } else if (error.status === 429) {
      errorMessage = 'Rate limited - please try again';
    } else if (error.code === 'context_length_exceeded') {
      errorMessage = 'Input too large for model';
    } else if (error.code === 'content_policy_violation') {
      errorMessage = 'Content blocked by policy';
    }

    return {
      success: false,
      error: errorMessage,
      provider: 'gpt',
      model: model,
      details: {
        status: error.status,
        code: error.code,
      },
    };
  }
}

export default { callGPT, GPT_MODELS };
