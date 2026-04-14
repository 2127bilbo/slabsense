"""
Perspective Correction Service
Detects and corrects perspective distortion in card images
"""

import cv2
import numpy as np
from typing import Optional, Tuple, List


class PerspectiveCorrector:
    """
    Corrects perspective distortion in card images.

    Uses contour detection to find card boundaries and applies
    perspective transform to flatten the image.
    """

    # Standard card dimensions (aspect ratio)
    CARD_ASPECT_RATIO = 2.5 / 3.5  # Standard trading card

    def __init__(self, target_width: int = 750, target_height: int = 1050):
        """
        Initialize corrector.

        Args:
            target_width: Output image width
            target_height: Output image height
        """
        self.target_width = target_width
        self.target_height = target_height

    def correct(self, image: np.ndarray) -> np.ndarray:
        """
        Apply perspective correction to card image.

        Args:
            image: RGB numpy array

        Returns:
            Corrected RGB numpy array
        """
        # Find card corners
        corners = self._find_card_corners(image)

        if corners is None:
            # If can't find corners, try to detect and crop card region
            cropped = self._smart_crop(image)
            if cropped is not None:
                return cropped
            # Return original if nothing works
            return image

        # Order corners: top-left, top-right, bottom-right, bottom-left
        ordered = self._order_corners(corners)

        # Apply perspective transform
        corrected = self._apply_transform(image, ordered)

        return corrected

    def _find_card_corners(self, image: np.ndarray) -> Optional[np.ndarray]:
        """
        Find the four corners of the card.
        """
        h, w = image.shape[:2]

        # Convert to grayscale
        gray = cv2.cvtColor(image, cv2.COLOR_RGB2GRAY)

        # Apply bilateral filter to reduce noise while keeping edges sharp
        filtered = cv2.bilateralFilter(gray, 11, 17, 17)

        # Try multiple edge detection methods
        corners = None

        # Method 1: Canny edge detection
        edges = cv2.Canny(filtered, 30, 200)
        corners = self._find_quadrilateral(edges, h, w)

        if corners is None:
            # Method 2: Adaptive threshold
            thresh = cv2.adaptiveThreshold(
                filtered, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                cv2.THRESH_BINARY, 11, 2
            )
            corners = self._find_quadrilateral(thresh, h, w)

        if corners is None:
            # Method 3: Otsu threshold
            _, thresh = cv2.threshold(filtered, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
            corners = self._find_quadrilateral(thresh, h, w)

        return corners

    def _find_quadrilateral(self, edges: np.ndarray, h: int, w: int) -> Optional[np.ndarray]:
        """
        Find the largest quadrilateral in the edge image.
        """
        # Find contours
        contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        if not contours:
            return None

        # Sort by area (largest first)
        contours = sorted(contours, key=cv2.contourArea, reverse=True)

        for contour in contours[:5]:  # Check top 5 largest
            # Approximate contour to polygon
            peri = cv2.arcLength(contour, True)
            approx = cv2.approxPolyDP(contour, 0.02 * peri, True)

            # Check if it's a quadrilateral
            if len(approx) == 4:
                # Verify it's a reasonable card shape
                area = cv2.contourArea(approx)
                if area > (h * w * 0.1):  # At least 10% of image
                    return approx.reshape(4, 2)

        return None

    def _order_corners(self, corners: np.ndarray) -> np.ndarray:
        """
        Order corners: top-left, top-right, bottom-right, bottom-left.
        """
        # Sum of coordinates: smallest = top-left, largest = bottom-right
        s = corners.sum(axis=1)
        # Difference of coordinates: smallest = top-right, largest = bottom-left
        d = np.diff(corners, axis=1)

        ordered = np.zeros((4, 2), dtype=np.float32)
        ordered[0] = corners[np.argmin(s)]      # top-left
        ordered[1] = corners[np.argmin(d)]      # top-right
        ordered[2] = corners[np.argmax(s)]      # bottom-right
        ordered[3] = corners[np.argmax(d)]      # bottom-left

        return ordered

    def _apply_transform(self, image: np.ndarray, corners: np.ndarray) -> np.ndarray:
        """
        Apply perspective transform using the detected corners.
        """
        # Calculate output dimensions maintaining aspect ratio
        # Use the max of width/height to determine scale
        width_a = np.linalg.norm(corners[0] - corners[1])
        width_b = np.linalg.norm(corners[2] - corners[3])
        height_a = np.linalg.norm(corners[0] - corners[3])
        height_b = np.linalg.norm(corners[1] - corners[2])

        max_width = int(max(width_a, width_b))
        max_height = int(max(height_a, height_b))

        # Enforce card aspect ratio
        expected_height = int(max_width / self.CARD_ASPECT_RATIO)
        if abs(max_height - expected_height) < max_height * 0.2:
            # Close enough to expected ratio, use standard dimensions
            out_width = self.target_width
            out_height = self.target_height
        else:
            # Keep detected dimensions
            out_width = max_width
            out_height = max_height

        # Destination points
        dst = np.array([
            [0, 0],
            [out_width - 1, 0],
            [out_width - 1, out_height - 1],
            [0, out_height - 1]
        ], dtype=np.float32)

        # Compute perspective transform matrix
        M = cv2.getPerspectiveTransform(corners.astype(np.float32), dst)

        # Apply transform
        corrected = cv2.warpPerspective(image, M, (out_width, out_height))

        return corrected

    def _smart_crop(self, image: np.ndarray) -> Optional[np.ndarray]:
        """
        Fallback: Try to detect and crop card region without full perspective correction.
        """
        h, w = image.shape[:2]

        # Convert to grayscale
        gray = cv2.cvtColor(image, cv2.COLOR_RGB2GRAY)

        # Detect edges
        edges = cv2.Canny(gray, 50, 150)

        # Find contours
        contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        if not contours:
            return None

        # Find largest contour
        largest = max(contours, key=cv2.contourArea)
        area = cv2.contourArea(largest)

        # Check if it's a reasonable size
        if area < h * w * 0.3:  # Less than 30% of image
            return None

        # Get bounding rectangle
        x, y, rect_w, rect_h = cv2.boundingRect(largest)

        # Add small padding
        padding = 5
        x = max(0, x - padding)
        y = max(0, y - padding)
        rect_w = min(w - x, rect_w + 2 * padding)
        rect_h = min(h - y, rect_h + 2 * padding)

        # Crop and return
        cropped = image[y:y + rect_h, x:x + rect_w]

        return cropped

    def detect_rotation(self, image: np.ndarray) -> float:
        """
        Detect rotation angle of card.

        Returns:
            Rotation angle in degrees (positive = counterclockwise)
        """
        gray = cv2.cvtColor(image, cv2.COLOR_RGB2GRAY)
        edges = cv2.Canny(gray, 50, 150)

        # Use Hough lines to detect dominant angle
        lines = cv2.HoughLines(edges, 1, np.pi / 180, 100)

        if lines is None:
            return 0.0

        # Analyze line angles
        angles = []
        for line in lines:
            rho, theta = line[0]
            angle = np.degrees(theta)
            # Normalize to -45 to 45 range
            while angle > 45:
                angle -= 90
            while angle < -45:
                angle += 90
            angles.append(angle)

        if not angles:
            return 0.0

        # Return median angle
        return float(np.median(angles))

    def deskew(self, image: np.ndarray) -> np.ndarray:
        """
        Correct small rotation (deskew) of card image.
        """
        angle = self.detect_rotation(image)

        if abs(angle) < 0.5:  # Less than 0.5 degrees, don't bother
            return image

        h, w = image.shape[:2]
        center = (w // 2, h // 2)

        # Rotate
        M = cv2.getRotationMatrix2D(center, angle, 1.0)
        rotated = cv2.warpAffine(image, M, (w, h), borderMode=cv2.BORDER_REPLICATE)

        return rotated
