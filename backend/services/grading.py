"""
Grading Calculation Service
Calculates TAG-style 1000-point scores and maps to grades

Based on research from docs/grading-research/TAG_DEFECT_WEIGHTS.md
"""

from typing import Dict, List, Optional


# TAG Score to Grade mapping
GRADE_THRESHOLDS = [
    (990, 10.0, "Pristine"),
    (950, 10.0, "Gem Mint"),
    (900, 9.0, "Mint"),
    (850, 8.5, "NM-MT+"),
    (800, 8.0, "NM-MT"),
    (750, 7.5, "NM+"),
    (700, 7.0, "NM"),
    (650, 6.5, "EX-MT+"),
    (600, 6.0, "EX-MT"),
    (550, 5.5, "EX+"),
    (500, 5.0, "EX"),
    (450, 4.5, "VG-EX+"),
    (400, 4.0, "VG-EX"),
    (350, 3.5, "VG+"),
    (300, 3.0, "VG"),
    (250, 2.5, "Good+"),
    (200, 2.0, "Good"),
    (150, 1.5, "Fair"),
    (100, 1.0, "Poor"),
]

# Centering thresholds for TCG cards (front)
TCG_FRONT_CENTERING = [
    (52, 995),   # Pristine
    (55, 970),   # Gem Mint
    (60, 920),   # Mint
    (62.5, 860), # NM-MT+
    (65, 825),   # NM-MT
    (67.5, 775), # NM+
    (70, 725),   # NM
    (72.5, 675), # EX-MT+
    (75, 625),   # EX-MT
    (80, 525),   # EX
]

# Centering thresholds for TCG cards (back) - more lenient
TCG_BACK_CENTERING = [
    (52, 995),   # Pristine
    (65, 970),   # Gem Mint
    (75, 920),   # Mint
    (85, 825),   # NM-MT
]

# Centering thresholds for Sports cards (front)
SPORTS_FRONT_CENTERING = [
    (51, 995),   # Pristine
    (55, 970),   # Gem Mint
    (57, 920),   # Mint
    (62.5, 860), # NM-MT+
    (65, 825),   # NM-MT
    (67.5, 775), # NM+
    (70, 725),   # NM
    (75, 625),   # EX-MT
    (80, 525),   # EX
    (90, 350),   # VG
]

# Sports cards back centering - more lenient
SPORTS_BACK_CENTERING = [
    (54.5, 995), # Pristine
    (70, 970),   # Gem Mint
    (75, 920),   # Mint
    (95, 700),   # NM and below
]

# Defect severity deductions (points)
DEFECT_DEDUCTIONS = {
    # Corner defects
    "CORNER_WHITENING": {1: 30, 2: 60, 3: 100, 4: 150, 5: 200},
    "CORNER_SOFT": {1: 20, 2: 50, 3: 80, 4: 120, 5: 180},
    "CORNER_FRAYING": {1: 40, 2: 80, 3: 130, 4: 180, 5: 250},

    # Edge defects
    "EDGE_DAMAGE": {1: 25, 2: 50, 3: 90, 4: 140, 5: 200},
    "EDGE_WHITENING": {1: 30, 2: 60, 3: 100, 4: 150, 5: 200},
    "EDGE_CHIPPING": {1: 35, 2: 70, 3: 120, 4: 170, 5: 230},

    # Surface defects
    "SURFACE_SCRATCH": {1: 40, 2: 80, 3: 140, 4: 200, 5: 300},
    "SURFACE_STAIN": {1: 50, 2: 100, 3: 160, 4: 220, 5: 320},
    "PRINT_LINE": {1: 20, 2: 40, 3: 70, 4: 100, 5: 150},
    "SURFACE_CREASE": {1: 150, 2: 250, 3: 350, 4: 450, 5: 550},

    # Centering is handled separately
}

# Front defects weighted 1.5x more than back
FRONT_MULTIPLIER = 1.5
BACK_MULTIPLIER = 1.0


def get_grade_from_score(score: int) -> tuple:
    """
    Convert TAG score (0-1000) to grade and label.

    Returns:
        (grade_number, grade_label)
    """
    for threshold, grade, label in GRADE_THRESHOLDS:
        if score >= threshold:
            return (grade, label)
    return (1.0, "Poor")


def centering_to_score(max_offset: float, centering_table: list) -> int:
    """
    Convert centering offset to score using lookup table.
    """
    for threshold, score in centering_table:
        if max_offset <= threshold:
            return score
    return 400  # Below lowest threshold


def calculate_tag_score(
    front_centering: Dict,
    back_centering: Optional[Dict],
    defects: List[Dict],
    card_type: str = "tcg"
) -> Dict:
    """
    Calculate TAG-style 1000-point score.

    Uses compounding algorithm where:
    - Final score ≈ min(subgrades) × 0.75 + avg(subgrades) × 0.25
    - Front defects weighted 1.5x more than back

    Args:
        front_centering: Front centering analysis result
        back_centering: Back centering analysis result (optional)
        defects: List of detected defects
        card_type: "tcg" or "sports"

    Returns:
        Dictionary with score, grade, and breakdown
    """
    # Select centering tables based on card type
    if card_type == "sports":
        front_table = SPORTS_FRONT_CENTERING
        back_table = SPORTS_BACK_CENTERING
    else:
        front_table = TCG_FRONT_CENTERING
        back_table = TCG_BACK_CENTERING

    # Calculate centering subscores
    front_max_offset = front_centering.get("max_offset", 50)
    front_center_score = centering_to_score(front_max_offset, front_table)

    back_center_score = 990  # Default if no back image
    if back_centering:
        back_max_offset = back_centering.get("max_offset", 50)
        back_center_score = centering_to_score(back_max_offset, back_table)

    # Calculate condition score from defects
    condition_score = 990  # Start near perfect
    total_deduction = 0
    max_total_deduction = 400  # Cap total deductions to prevent over-penalizing

    front_defects = []
    back_defects = []

    # Filter to only high-confidence defects
    high_confidence_defects = [d for d in defects if d.get("confidence", 0) >= 0.75]

    for defect in high_confidence_defects:
        defect_type = defect.get("type", "UNKNOWN")
        severity = defect.get("severity", 1)
        side = defect.get("side", "FRONT")
        confidence = defect.get("confidence", 0.75)

        # Get base deduction
        base_deduction = DEFECT_DEDUCTIONS.get(defect_type, {}).get(severity, 30)

        # Scale by confidence (higher confidence = full deduction)
        base_deduction = int(base_deduction * confidence)

        # Apply side multiplier
        if side == "FRONT":
            multiplier = FRONT_MULTIPLIER
            front_defects.append(defect)
        else:
            multiplier = BACK_MULTIPLIER
            back_defects.append(defect)

        deduction = int(base_deduction * multiplier)
        total_deduction += deduction

    # Apply capped deduction
    total_deduction = min(total_deduction, max_total_deduction)
    condition_score -= total_deduction

    # Ensure reasonable minimum score
    condition_score = max(500, condition_score)  # Raised floor to 500

    # Calculate subgrade scores
    subgrades = {
        "front_centering": front_center_score,
        "back_centering": back_center_score,
        "condition": condition_score,
    }

    # Apply compounding algorithm
    # TAG rule: Final score dominated by lowest subgrade
    min_subgrade = min(subgrades.values())
    avg_subgrade = sum(subgrades.values()) / len(subgrades)

    # Weighted combination: 75% min, 25% average
    tag_score = int(min_subgrade * 0.75 + avg_subgrade * 0.25)
    tag_score = max(100, min(1000, tag_score))

    # Get final grade
    grade, label = get_grade_from_score(tag_score)

    # Build DINGS list (defects that affected the grade)
    dings = []

    # Add centering DING if it's the limiting factor
    if front_center_score == min_subgrade and front_center_score < 970:
        dings.append({
            "type": "CENTERING",
            "location": "FRONT",
            "description": f"Front centering {front_centering.get('lr_string', 'N/A')} / {front_centering.get('tb_string', 'N/A')}"
        })

    if back_center_score == min_subgrade and back_center_score < 970:
        lr = back_centering.get('lr_string', 'N/A') if back_centering else 'N/A'
        tb = back_centering.get('tb_string', 'N/A') if back_centering else 'N/A'
        dings.append({
            "type": "CENTERING",
            "location": "BACK",
            "description": f"Back centering {lr} / {tb}"
        })

    # Add significant defects to DINGS
    for defect in defects:
        if defect.get("severity", 1) >= 2:  # Only include moderate+ defects
            dings.append({
                "type": defect.get("type"),
                "location": f"{defect.get('side', 'FRONT')}_{defect.get('location', 'CENTER')}",
                "description": defect.get("description", "Defect detected")
            })

    return {
        "tag_score": tag_score,
        "grade": grade,
        "grade_label": label,
        "centering": {
            "front_lr": front_centering.get("lr_ratio", (50, 50)),
            "front_tb": front_centering.get("tb_ratio", (50, 50)),
            "back_lr": back_centering.get("lr_ratio", (50, 50)) if back_centering else None,
            "back_tb": back_centering.get("tb_ratio", (50, 50)) if back_centering else None,
            "front_max_offset": front_max_offset,
            "back_max_offset": back_centering.get("max_offset") if back_centering else None,
            "centering_grade": front_centering.get("lr_string", "50/50"),
        },
        "defects": high_confidence_defects,  # Only return high-confidence defects
        "dings": dings,
        "subgrades": {
            "frontCenter": front_center_score,
            "backCenter": back_center_score,
            "condition": condition_score,
        },
        "processing_time_ms": 0,  # Will be set by caller
    }


def convert_to_company_grade(
    tag_score: int,
    company: str,
    centering: Dict,
    card_type: str = "tcg"
) -> Dict:
    """
    Convert TAG score to equivalent grade for other companies.

    Applies company-specific adjustments based on their grading standards.

    Args:
        tag_score: TAG 1000-point score
        company: "psa", "bgs", "cgc", "sgc"
        centering: Centering data
        card_type: "tcg" or "sports"

    Returns:
        Dictionary with company-specific grade
    """
    front_offset = centering.get("front_max_offset", 50)
    back_offset = centering.get("back_max_offset", 50) or 50

    if company == "psa":
        # PSA is more lenient on centering, no 9.5
        grade, label = get_grade_from_score(tag_score)

        # PSA centering: 55/45 front, 75/25 back for 10
        if front_offset <= 55 and back_offset <= 75:
            psa_centering_ok = True
        else:
            psa_centering_ok = False
            # Cap at 9 if centering prevents 10
            if grade == 10:
                grade = 9.0
                label = "Mint"

        # PSA doesn't have 9.5
        if grade == 9.5:
            grade = 9.0
            label = "Mint"

        return {
            "grade": grade,
            "label": f"PSA {int(grade) if grade == int(grade) else grade}",
            "company": "PSA",
            "centering_ok": psa_centering_ok,
        }

    elif company == "bgs":
        # BGS is strictest - 50/50 for perfect 10
        grade, label = get_grade_from_score(tag_score)

        # BGS subgrade calculation (simplified)
        # Uses 0.5 rule: final can only be 0.5 above lowest subgrade

        # Centering subgrade
        if front_offset <= 50 and back_offset <= 50:
            centering_subgrade = 10.0
        elif front_offset <= 55 and back_offset <= 60:
            centering_subgrade = 9.5
        elif front_offset <= 60 and back_offset <= 65:
            centering_subgrade = 9.0
        elif front_offset <= 65 and back_offset <= 75:
            centering_subgrade = 8.0
        else:
            centering_subgrade = 7.0

        # Apply 0.5 rule
        if grade > centering_subgrade + 0.5:
            grade = centering_subgrade + 0.5

        return {
            "grade": grade,
            "label": f"BGS {grade}",
            "company": "BGS",
            "centering_subgrade": centering_subgrade,
        }

    elif company == "cgc":
        # CGC is holistic, Pristine vs Gem Mint distinction
        grade, label = get_grade_from_score(tag_score)

        # CGC Pristine requires 50/50, Gem Mint allows 55/45
        is_pristine = (front_offset <= 50 and back_offset <= 50 and tag_score >= 990)

        if grade == 10:
            if is_pristine:
                label = "Pristine"
            else:
                label = "Gem Mint"

        return {
            "grade": grade,
            "label": f"CGC {grade} {label}" if grade == 10 else f"CGC {grade}",
            "company": "CGC",
            "is_pristine": is_pristine,
        }

    elif company == "sgc":
        # SGC strictest on back centering
        grade, label = get_grade_from_score(tag_score)

        # SGC: 50/50 both for Pristine, 55/45 front + 70/30 back for Gem
        is_pristine = (front_offset <= 50 and back_offset <= 50 and tag_score >= 990)
        is_gem = (front_offset <= 55 and back_offset <= 70 and tag_score >= 950)

        if grade == 10:
            if is_pristine:
                label = "Pristine"
            elif is_gem:
                label = "Gem Mint"
            else:
                # Back centering too bad for 10
                grade = 9.5
                label = "Mint+"

        return {
            "grade": grade,
            "label": f"SGC {grade}" + (f" {label}" if grade == 10 else ""),
            "company": "SGC",
            "is_pristine": is_pristine,
        }

    # Default: return TAG grade
    return {
        "grade": get_grade_from_score(tag_score)[0],
        "label": f"TAG {tag_score}",
        "company": "TAG",
    }
