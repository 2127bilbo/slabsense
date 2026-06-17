/**
 * Multi-AI Provider Abstraction Layer
 *
 * Provides a unified interface for multiple AI providers:
 * - Claude (Anthropic)
 * - Gemini (Google)
 * - GPT (OpenAI)
 * - Grok (xAI - OpenAI compatible)
 *
 * Usage:
 *   import { callProvider, PROVIDERS, MODES } from './providers/index.js';
 *
 *   const result = await callProvider('claude', {
 *     systemPrompt: '...',
 *     userPrompt: '...',
 *     images: ['https://...'],
 *     maxTokens: 2000,
 *     temperature: 0.1,
 *   });
 */

import { callClaude, CLAUDE_MODELS } from './anthropic.js';
import { callGemini, GEMINI_MODELS } from './google.js';
import { callGPT, GPT_MODELS } from './openai.js';
import { callGrok, GROK_MODELS } from './xai.js';

// ═══════════════════════════════════════════════════════════════════════════
// PROVIDER CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

export const PROVIDERS = {
  CLAUDE: 'claude',
  GEMINI: 'gemini',
  GPT: 'gpt',
  GROK: 'grok',
};

export const MODES = {
  SINGLE: 'single',           // One provider only
  PARALLEL: 'parallel',       // Two providers, average results
  SEQUENTIAL: 'sequential',   // Provider A → Provider B validates
  SYNTHESIZE: 'synthesize',   // A + B → C synthesizes
};

// Provider capabilities
export const PROVIDER_CAPS = {
  [PROVIDERS.CLAUDE]: {
    supportsVision: true,
    supportsUrlImages: true,
    supportsBase64Images: true,
    maxImages: 20,
    models: CLAUDE_MODELS,
    defaultModel: 'claude-sonnet-4-20250514',
  },
  [PROVIDERS.GEMINI]: {
    supportsVision: true,
    supportsUrlImages: false,  // Requires base64 or file upload
    supportsBase64Images: true,
    maxImages: 16,
    models: GEMINI_MODELS,
    defaultModel: 'gemini-2.5-pro',
  },
  [PROVIDERS.GPT]: {
    supportsVision: true,
    supportsUrlImages: true,
    supportsBase64Images: true,
    maxImages: 10,
    models: GPT_MODELS,
    defaultModel: 'gpt-4o',
  },
  [PROVIDERS.GROK]: {
    supportsVision: true,
    supportsUrlImages: true,
    supportsBase64Images: true,
    maxImages: 10,
    models: GROK_MODELS,
    defaultModel: 'grok-vision-beta',
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// MAIN INTERFACE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Call a provider with unified interface
 *
 * @param {string} provider - Provider name ('claude', 'gemini', 'gpt', 'grok')
 * @param {object} options - Call options
 * @param {string} options.systemPrompt - System prompt (role instructions)
 * @param {string} options.userPrompt - User prompt (the question/task)
 * @param {string[]} options.images - Array of image URLs or base64 strings
 * @param {number} options.maxTokens - Max tokens for response (default 2000)
 * @param {number} options.temperature - Temperature 0-1 (default 0.1)
 * @param {string} options.model - Specific model to use (optional)
 * @returns {Promise<object>} { success, text, parsed, usage, provider, model, error }
 */
export async function callProvider(provider, options) {
  const {
    systemPrompt = '',
    userPrompt = '',
    images = [],
    maxTokens = 2000,
    temperature = 0.1,
    model = null,
  } = options;

  // Validate provider
  if (!Object.values(PROVIDERS).includes(provider)) {
    return {
      success: false,
      error: `Unknown provider: ${provider}. Available: ${Object.values(PROVIDERS).join(', ')}`,
      provider,
    };
  }

  // Check required env vars
  const envCheck = checkProviderEnv(provider);
  if (!envCheck.configured) {
    return {
      success: false,
      error: envCheck.error,
      provider,
    };
  }

  // Build options object, only including model if explicitly provided
  const providerOpts = { systemPrompt, userPrompt, images, maxTokens, temperature };
  if (model) {
    providerOpts.model = model;
  }

  // Call the appropriate provider
  try {
    switch (provider) {
      case PROVIDERS.CLAUDE:
        return await callClaude(providerOpts);

      case PROVIDERS.GEMINI:
        return await callGemini(providerOpts);

      case PROVIDERS.GPT:
        return await callGPT(providerOpts);

      case PROVIDERS.GROK:
        return await callGrok(providerOpts);

      default:
        return {
          success: false,
          error: `Provider ${provider} not implemented`,
          provider,
        };
    }
  } catch (error) {
    console.error(`[Provider:${provider}] Error:`, error);
    return {
      success: false,
      error: error.message || 'Unknown error',
      provider,
      details: error.status || error.code,
    };
  }
}

/**
 * Check if a provider's environment variables are configured
 */
export function checkProviderEnv(provider) {
  const checks = {
    [PROVIDERS.CLAUDE]: {
      key: 'ANTHROPIC_API_KEY',
      name: 'Anthropic',
    },
    [PROVIDERS.GEMINI]: {
      key: 'GOOGLE_AI_API_KEY',
      name: 'Google AI',
    },
    [PROVIDERS.GPT]: {
      key: 'OPENAI_API_KEY',
      name: 'OpenAI',
    },
    [PROVIDERS.GROK]: {
      key: 'XAI_API_KEY',
      name: 'xAI',
    },
  };

  const check = checks[provider];
  if (!check) {
    return { configured: false, error: `Unknown provider: ${provider}` };
  }

  if (!process.env[check.key]) {
    return {
      configured: false,
      error: `${check.name} API key not configured (${check.key})`,
    };
  }

  return { configured: true };
}

/**
 * Get list of configured providers
 */
export function getConfiguredProviders() {
  return Object.values(PROVIDERS).filter(p => checkProviderEnv(p).configured);
}

// ═══════════════════════════════════════════════════════════════════════════
// MULTI-PROVIDER ORCHESTRATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Run grading with multiple providers based on mode
 *
 * @param {string} mode - Mode from MODES constant
 * @param {object} config - Configuration
 * @param {string} config.primary - Primary provider
 * @param {string} config.secondary - Secondary provider (for parallel/sequential)
 * @param {string} config.synthesizer - Synthesizer provider (for synthesize mode)
 * @param {object} options - Same options as callProvider
 * @returns {Promise<object>} Combined result based on mode
 */
export async function runMultiProvider(mode, config, options) {
  const { primary, secondary, synthesizer } = config;

  switch (mode) {
    case MODES.SINGLE:
      return await callProvider(primary, options);

    case MODES.PARALLEL:
      return await runParallel(primary, secondary, options);

    case MODES.SEQUENTIAL:
      return await runSequential(primary, secondary, options);

    case MODES.SYNTHESIZE:
      return await runSynthesize(primary, secondary, synthesizer, options);

    default:
      return {
        success: false,
        error: `Unknown mode: ${mode}`,
      };
  }
}

/**
 * Run two providers in parallel and combine results
 */
async function runParallel(provider1, provider2, options) {
  console.log(`[Multi] Parallel mode: ${provider1} + ${provider2}`);

  const [result1, result2] = await Promise.all([
    callProvider(provider1, options),
    callProvider(provider2, options),
  ]);

  return {
    success: result1.success || result2.success,
    mode: 'parallel',
    results: {
      [provider1]: result1,
      [provider2]: result2,
    },
    // Caller should implement averaging logic based on their needs
  };
}

/**
 * Run first provider, then second provider with first's output
 */
async function runSequential(provider1, provider2, options) {
  console.log(`[Multi] Sequential mode: ${provider1} → ${provider2}`);

  // First pass
  const result1 = await callProvider(provider1, options);

  if (!result1.success) {
    return {
      success: false,
      mode: 'sequential',
      error: `First provider (${provider1}) failed: ${result1.error}`,
      results: { [provider1]: result1 },
    };
  }

  // Second pass - include first provider's output in prompt
  const enhancedPrompt = `${options.userPrompt}

## PREVIOUS AI ASSESSMENT (from ${provider1}):
${result1.text}

## YOUR TASK:
1. First, analyze the card images independently
2. Then, compare your findings with the previous assessment
3. Provide your final grade, noting any agreements or disagreements`;

  const result2 = await callProvider(provider2, {
    ...options,
    userPrompt: enhancedPrompt,
  });

  return {
    success: result2.success,
    mode: 'sequential',
    results: {
      [provider1]: result1,
      [provider2]: result2,
    },
    finalResult: result2,
  };
}

/**
 * Run two providers in parallel, then synthesize with third
 */
async function runSynthesize(provider1, provider2, synthesizerProvider, options) {
  console.log(`[Multi] Synthesize mode: ${provider1} + ${provider2} → ${synthesizerProvider}`);

  // First, run both primary providers
  const [result1, result2] = await Promise.all([
    callProvider(provider1, options),
    callProvider(provider2, options),
  ]);

  if (!result1.success && !result2.success) {
    return {
      success: false,
      mode: 'synthesize',
      error: 'Both primary providers failed',
      results: { [provider1]: result1, [provider2]: result2 },
    };
  }

  // Synthesize - no images needed, just text
  const synthesisPrompt = `You are a card grading expert synthesizing two AI assessments.

## ASSESSMENT 1 (${provider1}):
${result1.success ? result1.text : 'FAILED: ' + result1.error}

## ASSESSMENT 2 (${provider2}):
${result2.success ? result2.text : 'FAILED: ' + result2.error}

## YOUR TASK:
1. Compare both assessments
2. Identify agreements and disagreements
3. Provide a final synthesized grade that resolves any conflicts
4. Weight the more accurate-seeming assessment higher

Return the same JSON format as the original assessments, with:
- Your final synthesized grades
- Notes explaining any disagreements and how you resolved them`;

  const synthesisResult = await callProvider(synthesizerProvider, {
    systemPrompt: options.systemPrompt,
    userPrompt: synthesisPrompt,
    images: [],  // No images for synthesis
    maxTokens: options.maxTokens,
    temperature: options.temperature,
  });

  return {
    success: synthesisResult.success,
    mode: 'synthesize',
    results: {
      [provider1]: result1,
      [provider2]: result2,
      synthesizer: synthesisResult,
    },
    finalResult: synthesisResult,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Parse JSON from AI response text
 */
export function parseJsonFromResponse(text) {
  if (!text) return null;

  try {
    // Try to find JSON in the response
    let jsonText = text.trim();

    // Remove markdown code blocks if present
    if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/```json?\n?/g, '').replace(/```$/g, '');
    }

    // Find JSON object
    const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }

    return null;
  } catch (e) {
    console.error('[Provider] JSON parse error:', e.message);
    return null;
  }
}

/**
 * Convert image URL to base64 (for providers that don't support URLs)
 */
export async function urlToBase64(url) {
  try {
    const response = await fetch(url);
    const buffer = await response.arrayBuffer();
    const base64 = Buffer.from(buffer).toString('base64');
    const mimeType = response.headers.get('content-type') || 'image/jpeg';
    return { base64, mimeType };
  } catch (error) {
    console.error('[Provider] URL to base64 error:', error);
    throw error;
  }
}

export default {
  callProvider,
  runMultiProvider,
  checkProviderEnv,
  getConfiguredProviders,
  parseJsonFromResponse,
  urlToBase64,
  PROVIDERS,
  MODES,
  PROVIDER_CAPS,
};
