"""
Card Detection Service using Replicate AI
Uses YOLO-World for fast, cheap card detection (~$0.001/image, ~1 sec)

Flow:
1. User uploads card image
2. YOLO-World detects card boundaries
3. Perspective correct and crop to clean card image
4. Return flattened card for collection/grading
"""

import os
import cv2
import numpy as np
import base64
import httpx
from typing import Optional, Dict, Tuple
import tempfile

# Replicate API - set via environment variable
REPLICATE_API_TOKEN = os.getenv("REPLICATE_API_TOKEN")
REPLICATE_API_URL = "https://api.replicate.com/v1/predictions"

# YOLO-World model for open-vocabulary detection
YOLO_WORLD_MODEL = "zsxkib/yolo-world:93b74202cd9d7677fdff31c5987a85f72993c9886469a60710d4e665e77939db"


class CardDetector:
    """
    Detects and crops trading cards from images using AI.
    """

    def __init__(self, api_token: str = None):
        self.api_token = api_token or REPLICATE_API_TOKEN
        if not self.api_token:
            raise ValueError("REPLICATE_API_TOKEN not set. Get one at replicate.com/account/api-tokens")

    async def detect_card(self, image_data: bytes) -> Dict:
        """
        Detect a trading card in the image and return bounding box.

        Args:
            image_data: Raw image bytes (JPEG/PNG)

        Returns:
            Dict with detection results and cropped card
        """
        # Convert image to base64 data URI
        base64_image = base64.b64encode(image_data).decode('utf-8')
        data_uri = f"data:image/jpeg;base64,{base64_image}"

        # Call YOLO-World via Replicate
        async with httpx.AsyncClient(timeout=60.0) as client:
            # Start prediction
            response = await client.post(
                REPLICATE_API_URL,
                headers={
                    "Authorization": f"Token {self.api_token}",
                    "Content-Type": "application/json",
                },
                json={
                    "version": YOLO_WORLD_MODEL.split(":")[1],
                    "input": {
                        "image": data_uri,
                        "query": "trading card, playing card, pokemon card, sports card",
                        "confidence_threshold": 0.3,
                    }
                }
            )

            if response.status_code != 201:
                return {"error": f"API error: {response.status_code}", "details": response.text}

            prediction = response.json()
            prediction_url = prediction.get("urls", {}).get("get")

            # Poll for completion
            result = await self._wait_for_prediction(client, prediction_url)

            if "error" in result:
                return result

            return result

    async def _wait_for_prediction(self, client: httpx.AsyncClient, url: str, max_attempts: int = 30) -> Dict:
        """Poll Replicate API until prediction completes."""
        import asyncio

        for _ in range(max_attempts):
            response = await client.get(
                url,
                headers={"Authorization": f"Token {self.api_token}"}
            )

            data = response.json()
            status = data.get("status")

            if status == "succeeded":
                return {"success": True, "output": data.get("output")}
            elif status == "failed":
                return {"error": "Prediction failed", "details": data.get("error")}
            elif status in ("starting", "processing"):
                await asyncio.sleep(1)
            else:
                return {"error": f"Unknown status: {status}"}

        return {"error": "Timeout waiting for prediction"}

    def crop_and_flatten(self, image_data: bytes, bbox: Dict) -> bytes:
        """
        Crop the detected card region and apply perspective correction.

        Args:
            image_data: Original image bytes
            bbox: Bounding box from detection {"x1": ..., "y1": ..., "x2": ..., "y2": ...}

        Returns:
            Cropped and flattened card image as JPEG bytes
        """
        # Decode image
        nparr = np.frombuffer(image_data, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

        if img is None:
            raise ValueError("Could not decode image")

        h, w = img.shape[:2]

        # Extract bounding box coordinates
        x1 = int(bbox.get("x1", 0) * w) if bbox.get("x1", 0) <= 1 else int(bbox.get("x1", 0))
        y1 = int(bbox.get("y1", 0) * h) if bbox.get("y1", 0) <= 1 else int(bbox.get("y1", 0))
        x2 = int(bbox.get("x2", w) * w) if bbox.get("x2", 1) <= 1 else int(bbox.get("x2", w))
        y2 = int(bbox.get("y2", h) * h) if bbox.get("y2", 1) <= 1 else int(bbox.get("y2", h))

        # Add small padding
        padding = 5
        x1 = max(0, x1 - padding)
        y1 = max(0, y1 - padding)
        x2 = min(w, x2 + padding)
        y2 = min(h, y2 + padding)

        # Crop to bounding box
        cropped = img[y1:y2, x1:x2]

        # Standard card aspect ratio (2.5" x 3.5" = 5:7)
        card_width = 500
        card_height = 700

        # Resize to standard card dimensions
        resized = cv2.resize(cropped, (card_width, card_height), interpolation=cv2.INTER_LANCZOS4)

        # Encode as JPEG
        _, buffer = cv2.imencode('.jpg', resized, [cv2.IMWRITE_JPEG_QUALITY, 95])
        return buffer.tobytes()


# Synchronous wrapper for non-async contexts
def detect_and_crop_card(image_data: bytes, api_token: str = None) -> Dict:
    """
    Synchronous function to detect and crop a card from an image.

    Args:
        image_data: Raw image bytes
        api_token: Replicate API token (or set REPLICATE_API_TOKEN env var)

    Returns:
        Dict with:
        - success: bool
        - cropped_card: base64-encoded JPEG of the cropped card
        - bbox: detected bounding box
        - cost_estimate: estimated API cost
    """
    import asyncio

    detector = CardDetector(api_token)

    # Run detection
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        result = loop.run_until_complete(detector.detect_card(image_data))
    finally:
        loop.close()

    if "error" in result:
        return result

    # Parse YOLO output to get bounding box
    output = result.get("output", {})

    # YOLO-World returns detections in various formats, handle common ones
    detections = []
    if isinstance(output, dict) and "detections" in output:
        detections = output["detections"]
    elif isinstance(output, list):
        detections = output

    if not detections:
        return {"error": "No card detected in image", "suggestion": "Ensure the card is clearly visible"}

    # Take the highest confidence detection
    best_detection = max(detections, key=lambda d: d.get("confidence", 0)) if detections else None

    if not best_detection:
        return {"error": "No card detected"}

    # Get bounding box
    bbox = {
        "x1": best_detection.get("x1", best_detection.get("bbox", [0])[0] if "bbox" in best_detection else 0),
        "y1": best_detection.get("y1", best_detection.get("bbox", [0, 0])[1] if "bbox" in best_detection else 0),
        "x2": best_detection.get("x2", best_detection.get("bbox", [0, 0, 1])[2] if "bbox" in best_detection else 1),
        "y2": best_detection.get("y2", best_detection.get("bbox", [0, 0, 0, 1])[3] if "bbox" in best_detection else 1),
    }

    # Crop and flatten
    try:
        cropped_bytes = detector.crop_and_flatten(image_data, bbox)
        cropped_b64 = base64.b64encode(cropped_bytes).decode('utf-8')
    except Exception as e:
        return {"error": f"Failed to crop card: {str(e)}"}

    return {
        "success": True,
        "cropped_card": cropped_b64,
        "bbox": bbox,
        "confidence": best_detection.get("confidence", 0),
        "cost_estimate": 0.001,  # ~$0.001 per YOLO-World call
    }


# Test function
if __name__ == "__main__":
    import sys

    if len(sys.argv) < 2:
        print("Usage: python card_detection.py <image_path>")
        print("Set REPLICATE_API_TOKEN environment variable first")
        sys.exit(1)

    image_path = sys.argv[1]

    with open(image_path, "rb") as f:
        image_data = f.read()

    print(f"Processing {image_path}...")
    result = detect_and_crop_card(image_data)

    if result.get("success"):
        print(f"Card detected with {result['confidence']:.1%} confidence")
        print(f"Bounding box: {result['bbox']}")
        print(f"Estimated cost: ${result['cost_estimate']:.4f}")

        # Save cropped card
        output_path = image_path.rsplit(".", 1)[0] + "_cropped.jpg"
        with open(output_path, "wb") as f:
            f.write(base64.b64decode(result["cropped_card"]))
        print(f"Saved cropped card to: {output_path}")
    else:
        print(f"Error: {result.get('error')}")
        if result.get("suggestion"):
            print(f"Suggestion: {result['suggestion']}")
