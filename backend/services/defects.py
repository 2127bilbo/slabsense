"""
Defect Detection Service
Analyzes card images for corners, edges, and surface defects
"""

import cv2
import numpy as np
from typing import List, Dict, Optional
from dataclasses import dataclass


@dataclass
class Defect:
    """Represents a detected defect"""
    type: str           # CORNER, EDGE, SURFACE
    location: str       # TOP_LEFT, TOP_RIGHT, BOTTOM_LEFT, BOTTOM_RIGHT, TOP, BOTTOM, LEFT, RIGHT, CENTER
    side: str           # FRONT or BACK
    severity: int       # 1-5 (1=minor, 5=severe)
    description: str
    confidence: float   # 0-1
    bbox: Optional[tuple] = None  # (x, y, w, h) if applicable

    def to_dict(self) -> dict:
        return {
            "type": self.type,
            "location": self.location,
            "side": self.side,
            "severity": self.severity,
            "description": self.description,
            "confidence": self.confidence,
            "bbox": self.bbox
        }


class DefectDetector:
    """
    Detects defects on trading cards:
    - Corner wear (whitening, rounding, fraying)
    - Edge damage (chipping, whitening, nicks)
    - Surface issues (scratches, print lines, stains)
    """

    def __init__(self):
        self.corner_size_ratio = 0.12  # Corner region is 12% of each dimension
        self.edge_width_ratio = 0.05   # Edge region is 5% of dimension
        self.min_confidence = 0.75     # Only report defects above this confidence
        self.holofoil_tolerance = True # Reduce sensitivity for holofoil cards

    def detect(self, image: np.ndarray, side: str = "front") -> List[Dict]:
        """
        Detect all defects in card image.

        Args:
            image: RGB numpy array
            side: "front" or "back"

        Returns:
            List of defect dictionaries
        """
        defects = []

        # Analyze corners
        corner_defects = self._analyze_corners(image, side)
        defects.extend(corner_defects)

        # Analyze edges
        edge_defects = self._analyze_edges(image, side)
        defects.extend(edge_defects)

        # Analyze surface
        surface_defects = self._analyze_surface(image, side)
        defects.extend(surface_defects)

        return [d.to_dict() for d in defects]

    def _analyze_corners(self, image: np.ndarray, side: str) -> List[Defect]:
        """
        Analyze all four corners for wear.
        """
        h, w = image.shape[:2]
        corner_h = int(h * self.corner_size_ratio)
        corner_w = int(w * self.corner_size_ratio)

        corners = {
            "TOP_LEFT": image[0:corner_h, 0:corner_w],
            "TOP_RIGHT": image[0:corner_h, w - corner_w:w],
            "BOTTOM_LEFT": image[h - corner_h:h, 0:corner_w],
            "BOTTOM_RIGHT": image[h - corner_h:h, w - corner_w:w],
        }

        defects = []

        for location, corner_img in corners.items():
            # Check for whitening (light pixels at corner)
            whitening = self._detect_corner_whitening(corner_img, location)
            if whitening:
                defects.append(Defect(
                    type="CORNER_WHITENING",
                    location=location,
                    side=side,
                    severity=whitening["severity"],
                    description=f"Corner whitening detected at {location.replace('_', ' ').lower()}",
                    confidence=whitening["confidence"]
                ))

            # Check for rounding/softness
            sharpness = self._detect_corner_sharpness(corner_img, location)
            if sharpness and sharpness["is_soft"]:
                defects.append(Defect(
                    type="CORNER_SOFT",
                    location=location,
                    side=side,
                    severity=sharpness["severity"],
                    description=f"Soft/rounded corner at {location.replace('_', ' ').lower()}",
                    confidence=sharpness["confidence"]
                ))

        return defects

    def _detect_corner_whitening(self, corner: np.ndarray, location: str) -> Optional[Dict]:
        """
        Detect whitening at corner.
        Enhanced to avoid false positives on colored card borders (yellow, gold, etc.)
        """
        h, w = corner.shape[:2]

        # Check if corner has a consistent color (card border)
        # Colored borders shouldn't trigger whitening detection
        mean_color = np.mean(corner, axis=(0, 1))
        color_std = np.std(corner, axis=(0, 1))

        # If corner has consistent color (low std) and is colored (not gray/white)
        # then it's likely a card border, not whitening
        is_colored = np.max(mean_color) - np.min(mean_color) > 30  # Has color variation
        is_consistent = np.mean(color_std) < 40  # Consistent color

        if is_colored and is_consistent:
            # This is likely a colored border, not whitening
            return None

        # Convert to grayscale
        gray = cv2.cvtColor(corner, cv2.COLOR_RGB2GRAY)

        # Create corner mask (triangle at actual corner)
        mask = np.zeros((h, w), dtype=np.uint8)
        if "TOP" in location and "LEFT" in location:
            pts = np.array([[0, 0], [w // 2, 0], [0, h // 2]])
        elif "TOP" in location and "RIGHT" in location:
            pts = np.array([[w // 2, 0], [w, 0], [w, h // 2]])
        elif "BOTTOM" in location and "LEFT" in location:
            pts = np.array([[0, h // 2], [0, h], [w // 2, h]])
        else:  # BOTTOM_RIGHT
            pts = np.array([[w, h // 2], [w // 2, h], [w, h]])

        cv2.fillPoly(mask, [pts], 255)

        # Analyze pixels in corner region
        corner_pixels = gray[mask > 0]

        if len(corner_pixels) == 0:
            return None

        # Check for high brightness (whitening)
        mean_brightness = np.mean(corner_pixels)
        bright_pixel_ratio = np.sum(corner_pixels > 235) / len(corner_pixels)  # Higher threshold

        # Whitening detected if many very bright pixels
        if bright_pixel_ratio > 0.25:  # Higher threshold (was 0.15)
            severity = min(5, int(bright_pixel_ratio * 15) + 1)
            return {
                "severity": severity,
                "confidence": min(0.9, bright_pixel_ratio * 1.5)
            }

        return None

    def _detect_corner_sharpness(self, corner: np.ndarray, location: str) -> Optional[Dict]:
        """
        Detect if corner is sharp or soft/rounded.
        More lenient to avoid false positives on holofoil cards.
        """
        gray = cv2.cvtColor(corner, cv2.COLOR_RGB2GRAY)

        # Detect edges with higher thresholds for less noise
        edges = cv2.Canny(gray, 80, 200)

        h, w = corner.shape[:2]

        # Check for strong edge lines meeting at corner
        # A sharp corner should have two distinct edge lines
        lines = cv2.HoughLinesP(edges, 1, np.pi / 180, 30, minLineLength=15, maxLineGap=3)

        # Only flag as soft if we really can't find any corner structure
        if lines is None or len(lines) < 1:
            # Still might be a valid corner - be conservative
            return None

        # Check if edges form a reasonable corner angle
        angles = []
        for line in lines:
            x1, y1, x2, y2 = line[0]
            angle = np.arctan2(y2 - y1, x2 - x1)
            angles.append(angle)

        # Only flag if angle variance is extremely high (clear damage)
        angle_variance = np.var(angles) if len(angles) > 1 else 0

        if angle_variance > 1.0:  # Raised threshold - only clear damage
            return {
                "is_soft": True,
                "severity": 2,
                "confidence": 0.7
            }

        return None

    def _analyze_edges(self, image: np.ndarray, side: str) -> List[Defect]:
        """
        Analyze all four edges for damage.
        """
        h, w = image.shape[:2]
        edge_w = int(w * self.edge_width_ratio)
        edge_h = int(h * self.edge_width_ratio)
        corner_h = int(h * self.corner_size_ratio)
        corner_w = int(w * self.corner_size_ratio)

        edges = {
            "TOP": image[0:edge_h, corner_w:w - corner_w],
            "BOTTOM": image[h - edge_h:h, corner_w:w - corner_w],
            "LEFT": image[corner_h:h - corner_h, 0:edge_w],
            "RIGHT": image[corner_h:h - corner_h, w - edge_w:w],
        }

        defects = []

        for location, edge_img in edges.items():
            # Check for chipping/whitening
            damage = self._detect_edge_damage(edge_img, location)
            if damage:
                defects.append(Defect(
                    type="EDGE_DAMAGE",
                    location=location,
                    side=side,
                    severity=damage["severity"],
                    description=f"Edge damage ({damage['type']}) on {location.lower()} edge",
                    confidence=damage["confidence"]
                ))

        return defects

    def _detect_edge_damage(self, edge: np.ndarray, location: str) -> Optional[Dict]:
        """
        Detect chipping, whitening, or other edge damage.
        Enhanced to avoid false positives on colored borders.
        """
        if edge.size == 0:
            return None

        # Check if edge has a consistent color (card border)
        mean_color = np.mean(edge, axis=(0, 1))
        color_std = np.std(edge, axis=(0, 1))

        # If edge has consistent color, it's likely a clean border
        is_colored = np.max(mean_color) - np.min(mean_color) > 30
        is_consistent = np.mean(color_std) < 35

        if is_colored and is_consistent:
            # Clean colored border, no damage
            return None

        gray = cv2.cvtColor(edge, cv2.COLOR_RGB2GRAY)

        # Look for bright spots (whitening/chipping) with higher threshold
        bright_ratio = np.sum(gray > 240) / gray.size  # Higher threshold

        if bright_ratio > 0.2:  # Higher threshold (was 0.1)
            severity = min(5, int(bright_ratio * 20) + 1)
            return {
                "type": "whitening/chipping",
                "severity": severity,
                "confidence": min(0.85, bright_ratio * 2)
            }

        # Skip roughness detection - causes too many false positives
        return None

    def _analyze_surface(self, image: np.ndarray, side: str) -> List[Defect]:
        """
        Analyze card surface for scratches, print lines, stains.
        Note: Surface analysis is heavily limited to avoid false positives on
        holofoil cards and artistic/textured cards (Van Gogh, etc.)
        """
        # Surface defect detection is currently disabled due to high false positive rate
        # on modern Pokemon cards with complex artwork, holofoil patterns, and textures.
        #
        # TODO: Implement ML-based surface defect detection that can distinguish:
        # - Card artwork/texture patterns (normal)
        # - Holofoil/refractor patterns (normal)
        # - Actual surface damage (scratches, dents, creases)
        #
        # For now, rely on manual inspection for surface condition
        return []

    def _detect_scratches(self, surface: np.ndarray) -> List[Dict]:
        """
        Detect linear scratches on surface.
        Higher thresholds to avoid holofoil false positives.
        """
        gray = cv2.cvtColor(surface, cv2.COLOR_RGB2GRAY)

        # Apply high-pass filter to enhance scratches
        blurred = cv2.GaussianBlur(gray, (31, 31), 0)
        high_pass = cv2.subtract(gray, blurred)

        # Higher threshold to only catch real scratches
        _, thresh = cv2.threshold(high_pass, 50, 255, cv2.THRESH_BINARY)

        # Find lines - require longer, more distinct lines
        lines = cv2.HoughLinesP(thresh, 1, np.pi / 180, 80, minLineLength=60, maxLineGap=5)

        scratches = []
        if lines is not None:
            for line in lines:
                x1, y1, x2, y2 = line[0]
                length = np.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2)
                # Only report significant scratches
                if length > 80:
                    severity = min(5, int(length / 80) + 1)
                    confidence = min(0.9, 0.75 + (length / 400))
                    scratches.append({
                        "severity": severity,
                        "confidence": confidence,
                        "length": length
                    })

        return scratches[:2]  # Return top 2 real scratches only

    def _detect_print_lines(self, surface: np.ndarray) -> Optional[Dict]:
        """
        Detect horizontal print lines (common on holographic cards).
        """
        gray = cv2.cvtColor(surface, cv2.COLOR_RGB2GRAY)

        # Sum horizontally to detect consistent lines
        horizontal_profile = np.mean(gray, axis=1)

        # Look for periodic pattern (print lines)
        fft = np.fft.fft(horizontal_profile)
        magnitudes = np.abs(fft[1:len(fft) // 2])

        # High frequency content indicates print lines
        high_freq_ratio = np.sum(magnitudes[len(magnitudes) // 2:]) / np.sum(magnitudes)

        if high_freq_ratio > 0.3:
            return {
                "severity": 2,
                "confidence": min(0.8, high_freq_ratio)
            }

        return None

    def _detect_stains(self, surface: np.ndarray) -> List[Dict]:
        """
        Detect stains or spots on surface.
        Higher thresholds to avoid false positives from card art.
        """
        # Convert to LAB color space for better color difference detection
        lab = cv2.cvtColor(surface, cv2.COLOR_RGB2LAB)

        # Calculate local mean with larger kernel
        kernel_size = 51
        local_mean = cv2.blur(lab[:, :, 0], (kernel_size, kernel_size))

        # Find areas that differ significantly from local mean
        diff = np.abs(lab[:, :, 0].astype(float) - local_mean.astype(float))

        # Much higher threshold to only catch real stains
        _, thresh = cv2.threshold(diff.astype(np.uint8), 40, 255, cv2.THRESH_BINARY)

        # Find contours of potential stains
        contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        stains = []
        for contour in contours:
            area = cv2.contourArea(contour)
            # Much larger minimum size - real stains are usually visible
            if area > 500:
                x, y, w, h = cv2.boundingRect(contour)
                # Check aspect ratio - real stains are usually blobby, not linear
                aspect = max(w, h) / (min(w, h) + 1)
                if aspect < 4:  # Not a line
                    severity = min(5, int(area / 1000) + 1)
                    confidence = min(0.85, 0.7 + (area / 5000))
                    stains.append({
                        "severity": severity,
                        "confidence": confidence,
                        "bbox": (x, y, w, h)
                    })

        return stains[:2]  # Return top 2 real stains only
