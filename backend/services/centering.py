"""
Centering Analysis Service
Detects card borders and calculates centering ratios

Uses saturation-based card detection:
1. Convert to HSV, use saturation channel (cards=colorful, background=gray)
2. Create binary mask of high-saturation areas
3. Find largest rectangular contour (the card)
4. Refine edges using gradient detection
"""

import cv2
import numpy as np
from typing import Optional, Dict, Tuple

# Debug flag - set to True to see detection values
DEBUG = True


class CenteringAnalyzer:
    """
    Analyzes card centering by detecting card boundaries.
    Uses saturation-based detection - cards are colorful, backgrounds are gray.
    """

    def __init__(self, card_type: str = "tcg"):
        """
        Initialize analyzer.

        Args:
            card_type: "tcg" for Pokemon/MTG or "sports" for sports cards
        """
        self.card_type = card_type

    def analyze(self, image: np.ndarray, side: str = "front") -> Dict:
        """
        Analyze card centering.

        Args:
            image: RGB numpy array of card image
            side: "front" or "back"

        Returns:
            Dictionary with centering ratios and analysis
        """
        h, w = image.shape[:2]

        if DEBUG:
            print(f"\n=== CENTERING ANALYSIS ({side}) ===")
            print(f"Image size: {w}x{h}")

        # Try saturation-based detection first (works for colorful cards vs gray background)
        bounds = self._find_bounds_saturation(image, w, h)

        if bounds is None:
            if DEBUG:
                print("Saturation method failed, trying edge detection...")
            bounds = self._find_bounds_edges(image, w, h)

        if bounds is None:
            if DEBUG:
                print("Edge detection failed, trying contour method...")
            bounds = self._find_bounds_contour(image, w, h)

        if bounds is None:
            if DEBUG:
                print("All methods failed, using symmetric fallback...")
            # Ultimate fallback - assume small symmetric border
            bounds = self._assume_symmetric_border(h, w, border_pct=0.02)

        if DEBUG:
            print(f"Final bounds: {bounds}")
            print(f"Border widths - L:{bounds['left']} R:{w - bounds['right']} T:{bounds['top']} B:{h - bounds['bottom']}")

        # Calculate centering ratios from bounds
        result = self._calculate_centering_result(bounds, h, w, side)

        if DEBUG:
            print(f"Centering result: LR={result['lr_ratio']}, TB={result['tb_ratio']}")
            print("=" * 40)

        return result

    def _find_bounds_saturation(self, image: np.ndarray, w: int, h: int) -> Optional[Dict]:
        """
        Detect card boundaries using saturation.
        Cards (both front and back) are colorful = high saturation.
        Gray scanner background = low saturation.
        """
        # Convert to HSV
        hsv = cv2.cvtColor(image, cv2.COLOR_RGB2HSV)
        saturation = hsv[:, :, 1]

        # Sample corners to get background saturation level
        corner_size = max(10, min(w, h) // 20)
        corners = [
            saturation[0:corner_size, 0:corner_size],  # top-left
            saturation[0:corner_size, w-corner_size:w],  # top-right
            saturation[h-corner_size:h, 0:corner_size],  # bottom-left
            saturation[h-corner_size:h, w-corner_size:w],  # bottom-right
        ]
        bg_sat = np.median([np.median(c) for c in corners])

        # Threshold: anything significantly more saturated than background is card
        # Use adaptive threshold based on background
        sat_threshold = max(bg_sat + 20, 30)

        if DEBUG:
            print(f"Saturation - bg_median: {bg_sat:.1f}, threshold: {sat_threshold:.1f}")

        # Create binary mask
        _, mask = cv2.threshold(saturation, sat_threshold, 255, cv2.THRESH_BINARY)

        # Morphological operations to clean up
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel, iterations=3)
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel, iterations=2)

        # Find contours
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        if not contours:
            if DEBUG:
                print("No contours found in saturation mask")
            return None

        # Find largest contour by area
        largest = max(contours, key=cv2.contourArea)
        area = cv2.contourArea(largest)

        # Card should be at least 50% of image area
        if area < (w * h * 0.5):
            if DEBUG:
                print(f"Largest contour too small: {area} < {w * h * 0.5}")
            return None

        # Get bounding rectangle
        x, y, bw, bh = cv2.boundingRect(largest)

        if DEBUG:
            print(f"Saturation contour - area: {area}, bbox: x={x} y={y} w={bw} h={bh}")

        # Refine edges using gradient detection
        gray = cv2.cvtColor(image, cv2.COLOR_RGB2GRAY)
        left = self._refine_edge_gradient(gray, 'left', x, max(0, x - 50), y, y + bh)
        right = self._refine_edge_gradient(gray, 'right', x + bw, min(w, x + bw + 50), y, y + bh)
        top = self._refine_edge_gradient(gray, 'top', y, max(0, y - 50), left, right)
        bottom = self._refine_edge_gradient(gray, 'bottom', y + bh, min(h, y + bh + 50), left, right)

        return {
            "left": int(left),
            "right": int(right),
            "top": int(top),
            "bottom": int(bottom),
        }

    def _find_bounds_edges(self, image: np.ndarray, w: int, h: int) -> Optional[Dict]:
        """
        Detect card boundaries using Canny edge detection.
        Find strong edges and use them to locate card boundaries.
        """
        gray = cv2.cvtColor(image, cv2.COLOR_RGB2GRAY)

        # Apply Gaussian blur to reduce noise
        blurred = cv2.GaussianBlur(gray, (5, 5), 0)

        # Canny edge detection
        edges = cv2.Canny(blurred, 50, 150)

        # Dilate edges to connect broken lines
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
        edges = cv2.dilate(edges, kernel, iterations=2)

        # Find horizontal and vertical edge concentrations
        # Sum edges along rows and columns
        row_sums = np.sum(edges, axis=1)
        col_sums = np.sum(edges, axis=0)

        # Find positions with high edge density
        row_threshold = np.max(row_sums) * 0.3
        col_threshold = np.max(col_sums) * 0.3

        # Find first and last strong edge positions
        strong_rows = np.where(row_sums > row_threshold)[0]
        strong_cols = np.where(col_sums > col_threshold)[0]

        if len(strong_rows) < 2 or len(strong_cols) < 2:
            if DEBUG:
                print("Not enough strong edges found")
            return None

        top = strong_rows[0]
        bottom = strong_rows[-1]
        left = strong_cols[0]
        right = strong_cols[-1]

        # Sanity check
        if right - left < w * 0.5 or bottom - top < h * 0.5:
            if DEBUG:
                print(f"Edge bounds too small: {right-left}x{bottom-top}")
            return None

        if DEBUG:
            print(f"Edge detection bounds: L={left} R={right} T={top} B={bottom}")

        return {
            "left": int(left),
            "right": int(right),
            "top": int(top),
            "bottom": int(bottom),
        }

    def _find_bounds_contour(self, image: np.ndarray, w: int, h: int) -> Optional[Dict]:
        """
        Detect card boundaries using contour detection on grayscale.
        Looks for the largest rectangular-ish contour.
        """
        gray = cv2.cvtColor(image, cv2.COLOR_RGB2GRAY)

        # Try adaptive thresholding
        binary = cv2.adaptiveThreshold(
            gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 21, 5
        )

        # Invert if needed (card should be white/foreground)
        if np.mean(binary[h//3:2*h//3, w//3:2*w//3]) < 128:
            binary = cv2.bitwise_not(binary)

        # Find contours
        contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        if not contours:
            return None

        # Find largest contour
        largest = max(contours, key=cv2.contourArea)
        area = cv2.contourArea(largest)

        if area < w * h * 0.3:
            return None

        # Get bounding rectangle
        x, y, bw, bh = cv2.boundingRect(largest)

        if DEBUG:
            print(f"Contour detection bounds: x={x} y={y} w={bw} h={bh}")

        return {
            "left": int(x),
            "right": int(x + bw),
            "top": int(y),
            "bottom": int(y + bh),
        }

    def _refine_edge_gradient(self, gray: np.ndarray, edge: str,
                               initial: int, search_limit: int,
                               cross_start: int, cross_end: int) -> int:
        """
        Refine edge position by finding maximum gradient (sharpest transition).
        """
        h, w = gray.shape

        # Compute gradient along the search direction
        if edge in ['left', 'right']:
            # Vertical slice, look for horizontal gradient
            start = max(0, min(initial, search_limit))
            end = max(initial, search_limit)
            end = min(end, w - 1)

            if start >= end:
                return initial

            # Sample a vertical strip and compute horizontal gradient
            strip = gray[cross_start:cross_end, start:end].astype(np.float32)
            if strip.size == 0:
                return initial

            # Compute gradient (difference between adjacent columns)
            grad = np.abs(np.diff(strip, axis=1))
            col_grads = np.mean(grad, axis=0)

            if len(col_grads) == 0:
                return initial

            # Find position of maximum gradient
            max_idx = np.argmax(col_grads)
            refined = start + max_idx + 1  # +1 because diff reduces length by 1

            if DEBUG:
                print(f"  {edge} edge: initial={initial}, refined={refined}, max_grad={col_grads[max_idx]:.1f}")

            return refined

        else:  # top or bottom
            start = max(0, min(initial, search_limit))
            end = max(initial, search_limit)
            end = min(end, h - 1)

            if start >= end:
                return initial

            # Sample a horizontal strip and compute vertical gradient
            strip = gray[start:end, cross_start:cross_end].astype(np.float32)
            if strip.size == 0:
                return initial

            # Compute gradient (difference between adjacent rows)
            grad = np.abs(np.diff(strip, axis=0))
            row_grads = np.mean(grad, axis=1)

            if len(row_grads) == 0:
                return initial

            # Find position of maximum gradient
            max_idx = np.argmax(row_grads)
            refined = start + max_idx + 1

            if DEBUG:
                print(f"  {edge} edge: initial={initial}, refined={refined}, max_grad={row_grads[max_idx]:.1f}")

            return refined

    def _assume_symmetric_border(self, h: int, w: int, border_pct: float = 0.02) -> Dict:
        """
        Assume symmetric border when detection fails.
        For tightly cropped images, assume card fills most of frame.
        """
        border_w = int(w * border_pct)
        border_h = int(h * border_pct)
        return {
            "left": border_w,
            "right": w - border_w,
            "top": border_h,
            "bottom": h - border_h,
        }

    def _calculate_centering_result(self, bounds: Dict, h: int, w: int, side: str) -> Dict:
        """
        Calculate centering ratios from detected bounds.
        """
        # Calculate border widths
        left_border = bounds["left"]
        right_border = w - bounds["right"]
        top_border = bounds["top"]
        bottom_border = h - bounds["bottom"]

        # Left/Right ratio
        total_lr = left_border + right_border
        if total_lr > 0:
            lr_left = round(left_border / total_lr * 100, 1)
            lr_right = round(100 - lr_left, 1)
        else:
            lr_left, lr_right = 50.0, 50.0

        # Top/Bottom ratio
        total_tb = top_border + bottom_border
        if total_tb > 0:
            tb_top = round(top_border / total_tb * 100, 1)
            tb_bottom = round(100 - tb_top, 1)
        else:
            tb_top, tb_bottom = 50.0, 50.0

        # Calculate max offset (how far from perfect 50/50)
        lr_offset = abs(lr_left - 50)
        tb_offset = abs(tb_top - 50)
        max_offset = max(lr_offset, tb_offset)

        # Format centering string (larger number first)
        lr_ratio = f"{max(lr_left, lr_right):.0f}/{min(lr_left, lr_right):.0f}"
        tb_ratio = f"{max(tb_top, tb_bottom):.0f}/{min(tb_top, tb_bottom):.0f}"

        return {
            "lr_ratio": (lr_left, lr_right),
            "tb_ratio": (tb_top, tb_bottom),
            "lr_string": lr_ratio,
            "tb_string": tb_ratio,
            "max_offset": round(50 + max_offset, 1),
            "side": side,
            "borders_px": bounds,
            "image_size": {"width": w, "height": h}
        }
