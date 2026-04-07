/**
 * Vercel Serverless Function - AI Card Detection with SAM 2
 * Detects front AND back cards in a single API call for $0.02 total
 *
 * Flow:
 * 1. Receive stitched image (front + back side by side)
 * 2. SAM 2 segments both cards with two point prompts
 * 3. Returns masks for both cards
 *
 * Cost: ~$0.02 per call (covers BOTH front and back)
 * Speed: ~5-10 seconds
 */

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '15mb', // Larger for stitched image
    },
  },
  maxDuration: 60,
};

// SAM 2 model on Replicate
const SAM2_VERSION = 'fe97b453a6455861e3bac769b441ca1f1086110da7466dbb65cf1eecfd60dc83';

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
    const { image, mode = 'single', points } = req.body;

    if (!image) {
      return res.status(400).json({ error: 'No image provided' });
    }

    let imageUri = image;
    if (!image.startsWith('data:')) {
      imageUri = `data:image/jpeg;base64,${image}`;
    }

    // Configure points based on mode
    let pointCoords, pointLabels;

    if (mode === 'dual') {
      // Dual mode: front on left, back on right
      // Points at 25% and 75% horizontally (center of each card)
      pointCoords = points?.coords || '0.25,0.5,0.75,0.5';
      pointLabels = points?.labels || '1,1';
    } else {
      // Single mode: one card
      const point = points || { x: 0.5, y: 0.5 };
      pointCoords = `${point.x},${point.y}`;
      pointLabels = '1';
    }

    console.log(`SAM request - mode: ${mode}, points: ${pointCoords}`);

    // Call SAM 2 on Replicate
    const response = await fetch('https://api.replicate.com/v1/predictions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${REPLICATE_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        version: SAM2_VERSION,
        input: {
          image: imageUri,
          point_coords: pointCoords,
          point_labels: pointLabels,
          multimask_output: mode === 'dual', // Multiple masks for dual mode
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Replicate API error:', response.status, errorText);
      return res.status(500).json({
        error: 'AI detection failed',
        details: errorText,
        status: response.status
      });
    }

    let prediction = await response.json();

    // Poll if async
    if (prediction.status === 'starting' || prediction.status === 'processing') {
      prediction = await pollForResult(prediction.urls.get, REPLICATE_API_TOKEN);
    }

    if (prediction.error || prediction.status === 'failed') {
      return res.status(500).json({
        error: prediction.error || 'SAM processing failed'
      });
    }

    const output = prediction.output;

    if (!output) {
      return res.status(500).json({
        error: 'No mask generated',
        suggestion: 'Ensure cards are visible in the image'
      });
    }

    // Parse output - could be single mask URL, array of masks, or object
    let masks = [];
    if (typeof output === 'string') {
      masks = [output];
    } else if (Array.isArray(output)) {
      masks = output;
    } else if (output.combined_mask) {
      masks = [output.combined_mask];
      if (output.individual_masks) {
        masks = masks.concat(output.individual_masks);
      }
    }

    return res.status(200).json({
      success: true,
      mode: mode,
      masks: masks,
      maskUrl: masks[0], // Primary mask (combined or first)
      individualMasks: masks.slice(1), // Individual masks if available
      cost_estimate: 0.02,
      model: 'sam-2',
    });

  } catch (error) {
    console.error('Card detection error:', error);
    return res.status(500).json({
      error: 'Detection failed',
      message: error.message
    });
  }
}

async function pollForResult(url, token, maxAttempts = 60) {
  for (let i = 0; i < maxAttempts; i++) {
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
      return { error: data.error || 'Prediction failed', status: data.status };
    }

    await new Promise(r => setTimeout(r, 1000));
  }

  return { error: 'Timeout waiting for SAM result' };
}
