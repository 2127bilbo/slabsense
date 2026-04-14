"""
Image Processing Utilities
Common image operations for the grading backend
"""

import base64
import io
from typing import Optional, Tuple

import cv2
import numpy as np
from PIL import Image


def load_image(
    data: bytes,
    max_size: int = 2000,
    target_size: Optional[Tuple[int, int]] = None
) -> np.ndarray:
    """
    Load image from bytes and preprocess.

    Args:
        data: Image bytes (from file upload or base64)
        max_size: Maximum dimension (width or height)
        target_size: Optional (width, height) to resize to

    Returns:
        RGB numpy array
    """
    # Load with PIL
    image = Image.open(io.BytesIO(data))

    # Convert to RGB if necessary
    if image.mode != "RGB":
        image = image.convert("RGB")

    # Resize if needed
    if target_size:
        image = image.resize(target_size, Image.Resampling.LANCZOS)
    elif max(image.size) > max_size:
        ratio = max_size / max(image.size)
        new_size = (int(image.width * ratio), int(image.height * ratio))
        image = image.resize(new_size, Image.Resampling.LANCZOS)

    return np.array(image)


def resize_image(
    image: np.ndarray,
    max_size: int = 1500,
    target_size: Optional[Tuple[int, int]] = None
) -> np.ndarray:
    """
    Resize image while maintaining aspect ratio.

    Args:
        image: RGB numpy array
        max_size: Maximum dimension
        target_size: Optional exact size (width, height)

    Returns:
        Resized RGB numpy array
    """
    h, w = image.shape[:2]

    if target_size:
        return cv2.resize(image, target_size, interpolation=cv2.INTER_LANCZOS4)

    if max(h, w) <= max_size:
        return image

    ratio = max_size / max(h, w)
    new_size = (int(w * ratio), int(h * ratio))
    return cv2.resize(image, new_size, interpolation=cv2.INTER_LANCZOS4)


def encode_image(
    image: np.ndarray,
    format: str = "PNG",
    quality: int = 95
) -> str:
    """
    Encode image to base64 data URL.

    Args:
        image: RGB numpy array
        format: Output format (PNG, JPEG)
        quality: JPEG quality (1-100)

    Returns:
        Base64 data URL string
    """
    # Convert to PIL
    pil_image = Image.fromarray(image)

    # Encode to bytes
    buffer = io.BytesIO()
    if format.upper() == "JPEG":
        pil_image.save(buffer, format="JPEG", quality=quality)
        mime_type = "image/jpeg"
    else:
        pil_image.save(buffer, format="PNG")
        mime_type = "image/png"

    # Encode to base64
    base64_data = base64.b64encode(buffer.getvalue()).decode("utf-8")

    return f"data:{mime_type};base64,{base64_data}"


def detect_blur(image: np.ndarray) -> Tuple[float, bool]:
    """
    Detect if image is blurry using Laplacian variance.

    Args:
        image: RGB numpy array

    Returns:
        (variance, is_blurry)
        variance < 100 typically indicates blur
    """
    gray = cv2.cvtColor(image, cv2.COLOR_RGB2GRAY)
    variance = cv2.Laplacian(gray, cv2.CV_64F).var()

    # Threshold for blur detection
    is_blurry = variance < 100

    return float(variance), is_blurry


def enhance_image(image: np.ndarray) -> np.ndarray:
    """
    Apply basic image enhancement for better analysis.

    Args:
        image: RGB numpy array

    Returns:
        Enhanced RGB numpy array
    """
    # Convert to LAB
    lab = cv2.cvtColor(image, cv2.COLOR_RGB2LAB)

    # Apply CLAHE to L channel
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    lab[:, :, 0] = clahe.apply(lab[:, :, 0])

    # Convert back to RGB
    enhanced = cv2.cvtColor(lab, cv2.COLOR_LAB2RGB)

    return enhanced


def auto_crop(image: np.ndarray, padding: int = 10) -> np.ndarray:
    """
    Auto-crop image to card boundaries.

    Args:
        image: RGB numpy array
        padding: Pixels of padding around card

    Returns:
        Cropped RGB numpy array
    """
    gray = cv2.cvtColor(image, cv2.COLOR_RGB2GRAY)

    # Threshold
    _, thresh = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)

    # Find contours
    contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    if not contours:
        return image

    # Find largest contour
    largest = max(contours, key=cv2.contourArea)

    # Get bounding rect
    x, y, w, h = cv2.boundingRect(largest)

    # Add padding
    h_img, w_img = image.shape[:2]
    x = max(0, x - padding)
    y = max(0, y - padding)
    w = min(w_img - x, w + 2 * padding)
    h = min(h_img - y, h + 2 * padding)

    return image[y:y + h, x:x + w]
