/**
 * Vercel Serverless Function - Card Detection
 * Uses YOLO-World via Replicate to detect and crop trading cards
 *
 * Cost: ~$0.001 per image
 * Speed: ~1-2 seconds
 */

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
  maxDuration: 30, // 30 second timeout
};

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
    const { image } = req.body;

    if (!image) {
      return res.status(400).json({ error: 'No image provided' });
    }

    // Ensure image is a data URI
    let imageUri = image;
    if (!image.startsWith('data:')) {
      imageUri = `data:image/jpeg;base64,${image}`;
    }

    // Call YOLO-World on Replicate
    const response = await fetch('https://api.replicate.com/v1/predictions', {
      method: 'POST',
      headers: {
        'Authorization': `Token ${REPLICATE_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        version: '93b74202cd9d7677fdff31c5987a85f72993c9886469a60710d4e665e77939db',
        input: {
          image: imageUri,
          query: 'trading card, playing card, pokemon card, sports card, game card',
          confidence_threshold: 0.25,
        },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('Replicate API error:', error);
      return res.status(500).json({ error: 'AI detection failed', details: error });
    }

    const prediction = await response.json();

    // Poll for completion
    const result = await pollForResult(prediction.urls.get, REPLICATE_API_TOKEN);

    if (result.error) {
      return res.status(500).json({ error: result.error });
    }

    // Parse detections
    const detections = parseDetections(result.output);

    if (!detections || detections.length === 0) {
      return res.status(200).json({
        success: false,
        error: 'No card detected',
        suggestion: 'Make sure the card is clearly visible and well-lit'
      });
    }

    // Get best detection (highest confidence)
    const best = detections.reduce((a, b) =>
      (b.confidence || 0) > (a.confidence || 0) ? b : a
    );

    return res.status(200).json({
      success: true,
      bbox: {
        x1: best.x1 || best.bbox?.[0] || 0,
        y1: best.y1 || best.bbox?.[1] || 0,
        x2: best.x2 || best.bbox?.[2] || 1,
        y2: best.y2 || best.bbox?.[3] || 1,
      },
      confidence: best.confidence || 0,
      label: best.label || best.class || 'card',
      cost_estimate: 0.001,
    });

  } catch (error) {
    console.error('Card detection error:', error);
    return res.status(500).json({
      error: 'Detection failed',
      message: error.message
    });
  }
}

async function pollForResult(url, token, maxAttempts = 30) {
  for (let i = 0; i < maxAttempts; i++) {
    const response = await fetch(url, {
      headers: { 'Authorization': `Token ${token}` },
    });

    const data = await response.json();

    if (data.status === 'succeeded') {
      return { output: data.output };
    } else if (data.status === 'failed') {
      return { error: data.error || 'Prediction failed' };
    }

    // Wait 1 second before polling again
    await new Promise(r => setTimeout(r, 1000));
  }

  return { error: 'Timeout waiting for result' };
}

function parseDetections(output) {
  // YOLO-World can return different formats
  if (!output) return [];

  // If it's already an array of detections
  if (Array.isArray(output)) {
    return output;
  }

  // If it's an object with detections property
  if (output.detections) {
    return output.detections;
  }

  // If it's an object with predictions property
  if (output.predictions) {
    return output.predictions;
  }

  // If output is a URL to an image (some models return annotated image)
  // In this case, we may not have bounding boxes
  if (typeof output === 'string' && output.startsWith('http')) {
    return [];
  }

  return [];
}
