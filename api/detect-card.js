/**
 * Vercel Serverless Function - AI Card Detection with SAM 2
 * Uses Segment Anything Model 2 via Replicate for perfect card segmentation
 *
 * Flow:
 * 1. SAM 2 segments the card with pixel-perfect accuracy
 * 2. Returns mask and bounding polygon
 * 3. Client uses polygon corners for perspective transform
 *
 * Cost: ~$0.02 per image
 * Speed: ~5-10 seconds
 */

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
  maxDuration: 60, // 60 second timeout for SAM
};

// SAM 2 model on Replicate
const SAM2_VERSION = 'fe97b453a6455861e3bac769b441ca1f1086110da7466dbb65cf1eecfd60dc83';

export default async function handler(req, res) {
  // Only allow POST
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
    const { image, point } = req.body;

    if (!image) {
      return res.status(400).json({ error: 'No image provided' });
    }

    // Ensure image is a data URI
    let imageUri = image;
    if (!image.startsWith('data:')) {
      imageUri = `data:image/jpeg;base64,${image}`;
    }

    // Get image dimensions from base64 (approximate center point)
    // Default to center of a typical phone photo
    const clickPoint = point || { x: 0.5, y: 0.5 };

    // Call SAM 2 on Replicate
    const response = await fetch('https://api.replicate.com/v1/predictions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${REPLICATE_API_TOKEN}`,
        'Content-Type': 'application/json',
        'Prefer': 'wait', // Wait for result instead of polling
      },
      body: JSON.stringify({
        version: SAM2_VERSION,
        input: {
          image: imageUri,
          // Point in center of image to segment the main object (card)
          point_coords: `${clickPoint.x}, ${clickPoint.y}`,
          point_labels: '1', // Positive point (include this area)
          // Use normalized coordinates (0-1)
          use_m2m: true, // Better mask quality
          multimask_output: false, // Single best mask
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

    // If we got a prediction URL (async mode), poll for result
    if (prediction.status === 'starting' || prediction.status === 'processing') {
      prediction = await pollForResult(prediction.urls.get, REPLICATE_API_TOKEN);
    }

    if (prediction.error) {
      return res.status(500).json({ error: prediction.error });
    }

    if (prediction.status === 'failed') {
      return res.status(500).json({
        error: 'SAM processing failed',
        details: prediction.error
      });
    }

    // SAM 2 returns mask URL(s)
    const output = prediction.output;

    if (!output) {
      return res.status(500).json({
        error: 'No mask generated',
        suggestion: 'Try pointing at the center of the card'
      });
    }

    // Output could be a single mask URL or combined_mask/individual_masks
    let maskUrl = null;
    if (typeof output === 'string') {
      maskUrl = output;
    } else if (output.combined_mask) {
      maskUrl = output.combined_mask;
    } else if (Array.isArray(output) && output.length > 0) {
      maskUrl = output[0];
    }

    if (!maskUrl) {
      return res.status(500).json({
        error: 'Could not extract mask from response',
        output: output
      });
    }

    return res.status(200).json({
      success: true,
      maskUrl: maskUrl,
      cost_estimate: 0.02,
      model: 'sam-2',
      // Client will:
      // 1. Fetch the mask image
      // 2. Find contours
      // 3. Get 4 corners
      // 4. Perspective transform
      // 5. Crop to card
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
    } else if (data.status === 'failed') {
      return { error: data.error || 'Prediction failed', status: 'failed' };
    } else if (data.status === 'canceled') {
      return { error: 'Prediction was canceled', status: 'canceled' };
    }

    // Wait 1 second before polling again
    await new Promise(r => setTimeout(r, 1000));
  }

  return { error: 'Timeout waiting for SAM result' };
}
