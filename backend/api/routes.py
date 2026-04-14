"""
SlabSense API Routes
Endpoints for card grading analysis
"""

import base64
import io
from typing import Optional
from fastapi import APIRouter, File, UploadFile, HTTPException, Form
from pydantic import BaseModel
from PIL import Image
import numpy as np

from services.centering import CenteringAnalyzer
from services.perspective import PerspectiveCorrector
from services.defects import DefectDetector
from services.card_detection import detect_and_crop_card

router = APIRouter()

# Response models
class CenteringResult(BaseModel):
    front_lr: tuple[float, float]  # Left/Right ratio
    front_tb: tuple[float, float]  # Top/Bottom ratio
    back_lr: Optional[tuple[float, float]] = None
    back_tb: Optional[tuple[float, float]] = None
    front_max_offset: float  # Max offset percentage
    back_max_offset: Optional[float] = None
    centering_grade: str  # e.g., "55/45"

class DefectResult(BaseModel):
    type: str  # CORNER, EDGE, SURFACE, CENTERING
    location: str  # e.g., "TOP_LEFT", "FRONT", "BACK"
    severity: int  # 1-5
    description: str
    confidence: float  # 0-1

class GradeResult(BaseModel):
    tag_score: int  # 0-1000
    grade: float  # 1-10
    grade_label: str  # e.g., "Gem Mint", "Mint", etc.
    centering: CenteringResult
    defects: list[DefectResult]
    subgrades: dict  # frontCenter, backCenter, corners, edges, surface
    processing_time_ms: int
    front_bounds: Optional[dict] = None  # Border pixel data for frontend overlay
    back_bounds: Optional[dict] = None

class AnalyzeResponse(BaseModel):
    success: bool
    front_result: Optional[GradeResult] = None
    back_result: Optional[GradeResult] = None
    combined_result: Optional[GradeResult] = None
    error: Optional[str] = None


def decode_base64_image(data: str) -> np.ndarray:
    """Decode base64 image string to numpy array"""
    # Remove data URL prefix if present
    if "," in data:
        data = data.split(",")[1]

    image_bytes = base64.b64decode(data)
    image = Image.open(io.BytesIO(image_bytes))

    # Convert to RGB if necessary
    if image.mode != "RGB":
        image = image.convert("RGB")

    return np.array(image)


@router.post("/analyze", response_model=AnalyzeResponse)
async def analyze_card(
    front_image: Optional[UploadFile] = File(None),
    back_image: Optional[UploadFile] = File(None),
    front_base64: Optional[str] = Form(None),
    back_base64: Optional[str] = Form(None),
    card_type: str = Form("tcg"),  # "tcg" or "sports"
    apply_perspective: bool = Form(True),
):
    """
    Analyze card images for centering and defects.

    Accepts either file uploads or base64 encoded images.
    Returns detailed grading analysis.
    """
    import time
    start_time = time.time()

    try:
        # Load front image
        front_np = None
        if front_image:
            contents = await front_image.read()
            image = Image.open(io.BytesIO(contents))
            if image.mode != "RGB":
                image = image.convert("RGB")
            front_np = np.array(image)
        elif front_base64:
            front_np = decode_base64_image(front_base64)

        # Load back image
        back_np = None
        if back_image:
            contents = await back_image.read()
            image = Image.open(io.BytesIO(contents))
            if image.mode != "RGB":
                image = image.convert("RGB")
            back_np = np.array(image)
        elif back_base64:
            back_np = decode_base64_image(back_base64)

        if front_np is None and back_np is None:
            raise HTTPException(
                status_code=400,
                detail="At least one image (front or back) is required"
            )

        # Initialize services
        perspective = PerspectiveCorrector()
        centering = CenteringAnalyzer(card_type=card_type)
        defects = DefectDetector()

        results = {}

        # Process front image
        if front_np is not None:
            # Apply perspective correction if enabled
            if apply_perspective:
                front_np = perspective.correct(front_np)

            # Analyze centering
            front_centering = centering.analyze(front_np, side="front")

            # Detect defects
            front_defects = defects.detect(front_np, side="front")

            results["front"] = {
                "centering": front_centering,
                "defects": front_defects
            }

        # Process back image
        if back_np is not None:
            if apply_perspective:
                back_np = perspective.correct(back_np)

            back_centering = centering.analyze(back_np, side="back")
            back_defects = defects.detect(back_np, side="back")

            results["back"] = {
                "centering": back_centering,
                "defects": back_defects
            }

        # Calculate combined grade
        combined = calculate_combined_grade(results, card_type)

        # Add border pixel data for frontend overlay
        if "front" in results:
            fc = results["front"]["centering"]
            combined["front_bounds"] = {
                "borders_px": fc.get("borders_px", {}),
                "image_size": fc.get("image_size", {}),
            }
        if "back" in results:
            bc = results["back"]["centering"]
            combined["back_bounds"] = {
                "borders_px": bc.get("borders_px", {}),
                "image_size": bc.get("image_size", {}),
            }

        processing_time = int((time.time() - start_time) * 1000)
        combined["processing_time_ms"] = processing_time

        return AnalyzeResponse(
            success=True,
            combined_result=GradeResult(**combined)
        )

    except HTTPException:
        raise
    except Exception as e:
        return AnalyzeResponse(
            success=False,
            error=str(e)
        )


@router.post("/centering")
async def analyze_centering_only(
    image: UploadFile = File(...),
    side: str = Form("front"),
    card_type: str = Form("tcg"),
):
    """
    Analyze centering only (lighter weight endpoint).
    Returns just centering ratios without full defect analysis.
    """
    try:
        contents = await image.read()
        img = Image.open(io.BytesIO(contents))
        if img.mode != "RGB":
            img = img.convert("RGB")
        img_np = np.array(img)

        # Apply perspective correction
        perspective = PerspectiveCorrector()
        img_np = perspective.correct(img_np)

        # Analyze centering
        centering = CenteringAnalyzer(card_type=card_type)
        result = centering.analyze(img_np, side=side)

        return {
            "success": True,
            "centering": result
        }

    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }


@router.post("/perspective")
async def correct_perspective(
    image: UploadFile = File(...),
    return_image: bool = Form(True),
):
    """
    Apply perspective correction to card image.
    Returns corrected image as base64.
    """
    try:
        contents = await image.read()
        img = Image.open(io.BytesIO(contents))
        if img.mode != "RGB":
            img = img.convert("RGB")
        img_np = np.array(img)

        # Apply perspective correction
        perspective = PerspectiveCorrector()
        corrected = perspective.correct(img_np)

        if return_image:
            # Convert back to base64
            corrected_pil = Image.fromarray(corrected)
            buffer = io.BytesIO()
            corrected_pil.save(buffer, format="PNG")
            base64_image = base64.b64encode(buffer.getvalue()).decode()

            return {
                "success": True,
                "corrected_image": f"data:image/png;base64,{base64_image}",
                "dimensions": {
                    "width": corrected.shape[1],
                    "height": corrected.shape[0]
                }
            }

        return {
            "success": True,
            "dimensions": {
                "width": corrected.shape[1],
                "height": corrected.shape[0]
            }
        }

    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }


@router.post("/detect-card")
async def detect_card(
    image: UploadFile = File(None),
    image_base64: Optional[str] = Form(None),
):
    """
    AI-powered card detection and cropping using YOLO-World via Replicate.

    Detects trading card in image and returns a perfectly cropped/flattened version.

    Cost: ~$0.001 per image (deducted from user's credits)
    Speed: ~1-2 seconds

    Returns:
        - cropped_card: Base64 JPEG of the cropped card (500x700px)
        - bbox: Detected bounding box coordinates
        - confidence: Detection confidence (0-1)
        - cost_estimate: Estimated API cost
    """
    try:
        # Get image data
        if image:
            image_data = await image.read()
        elif image_base64:
            # Remove data URL prefix if present
            if "," in image_base64:
                image_base64 = image_base64.split(",")[1]
            image_data = base64.b64decode(image_base64)
        else:
            raise HTTPException(status_code=400, detail="No image provided")

        # Run AI detection
        result = detect_and_crop_card(image_data)

        if result.get("error"):
            return {
                "success": False,
                "error": result["error"],
                "suggestion": result.get("suggestion")
            }

        return {
            "success": True,
            "cropped_card": f"data:image/jpeg;base64,{result['cropped_card']}",
            "bbox": result["bbox"],
            "confidence": result["confidence"],
            "cost_estimate": result["cost_estimate"]
        }

    except HTTPException:
        raise
    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }


def calculate_combined_grade(results: dict, card_type: str) -> dict:
    """
    Calculate combined TAG-style grade from front and back analysis.
    Uses compounding algorithm (not averaging).
    """
    from services.grading import calculate_tag_score

    # Extract centering data
    front_centering = results.get("front", {}).get("centering", {})
    back_centering = results.get("back", {}).get("centering", {})

    # Collect all defects
    all_defects = []
    if "front" in results:
        all_defects.extend(results["front"].get("defects", []))
    if "back" in results:
        all_defects.extend(results["back"].get("defects", []))

    # Calculate TAG score
    grade_result = calculate_tag_score(
        front_centering=front_centering,
        back_centering=back_centering,
        defects=all_defects,
        card_type=card_type
    )

    return grade_result
