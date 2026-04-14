# SlabSense Backend

Python backend for card grading analysis with OpenCV-powered centering detection and defect analysis.

## Status

**In Development** - Core functionality working, but centering detection for card backs needs fixing.

### Working
- ✅ Perspective correction
- ✅ Front centering detection (mostly)
- ✅ Corner/edge defect detection
- ✅ TAG-style scoring algorithm
- ✅ API endpoints

### Known Issues
- ⚠️ **Back centering detection wrong** - Returns incorrect bounds for card backs
- ⚠️ Front centering slightly misaligned in some cases

## Features

- **Perspective Correction**: Automatically straightens tilted/angled card photos
- **Centering Analysis**: Calculates centering ratios (L/R, T/B) using multiple detection methods
- **Defect Detection**: Identifies corners, edges, and surface issues (tuned to reduce false positives)
- **TAG-Style Scoring**: 1000-point scoring system with grade mapping
- **Multi-Company Support**: Converts scores to PSA, BGS, CGC, SGC equivalents

## Quick Start

### Prerequisites

- Python 3.10+
- pip

### Installation

```bash
# Create virtual environment
python -m venv venv

# Activate (Windows)
venv\Scripts\activate

# Activate (Linux/Mac)
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt
```

### Configuration

```bash
# Copy example env
cp .env.example .env

# Edit .env with your settings
```

### Run Development Server

```bash
python main.py

# Or with uvicorn directly
uvicorn main:app --reload --port 8000
```

### API Documentation

Once running, visit:
- Swagger UI: http://localhost:8000/docs
- ReDoc: http://localhost:8000/redoc

## API Endpoints

### POST /api/v1/analyze

Full card analysis with centering and defect detection.

**Request:**
- `front_image`: Front card image (file upload)
- `back_image`: Back card image (file upload, optional)
- `card_type`: "tcg" or "sports"
- `apply_perspective`: Whether to apply perspective correction (default: true)

**Response:**
```json
{
  "success": true,
  "combined_result": {
    "tag_score": 945,
    "grade": 9.0,
    "grade_label": "Mint",
    "centering": {
      "front_lr": [52.5, 47.5],
      "front_tb": [51.0, 49.0],
      "centering_grade": "53/47"
    },
    "defects": [...],
    "dings": [...],
    "subgrades": {
      "frontCenter": 920,
      "backCenter": 970,
      "condition": 960
    }
  }
}
```

### POST /api/v1/centering

Lightweight centering-only analysis.

### POST /api/v1/perspective

Apply perspective correction and return corrected image.

## Project Structure

```
backend/
├── main.py              # FastAPI app entry point
├── api/
│   ├── __init__.py
│   └── routes.py        # API endpoints
├── services/
│   ├── __init__.py
│   ├── centering.py     # Border detection & centering
│   ├── perspective.py   # Perspective correction
│   ├── defects.py       # Defect detection
│   └── grading.py       # Score calculation
├── utils/
│   ├── __init__.py
│   └── image_processing.py
├── tests/
├── requirements.txt
├── Dockerfile
└── .env.example
```

## Grading Algorithm

The backend uses a TAG-style compounding algorithm:

1. **Centering Score**: Based on max offset from 50/50
   - TCG: 52/48 = Pristine, 55/45 = Gem Mint
   - Sports: 51/49 = Pristine, 55/45 = Gem Mint

2. **Condition Score**: Starts at 990, deductions for each defect
   - Front defects weighted 1.5x
   - Back defects weighted 1.0x

3. **Final Score**: `min(subgrades) × 0.75 + avg(subgrades) × 0.25`
   - Lowest subgrade dominates (compounding, not averaging)

## Deployment

### Local with ngrok

```bash
# Install ngrok
# Run backend
python main.py

# In another terminal
ngrok http 8000
```

### Docker

```bash
# Build
docker build -t slabsense-backend .

# Run
docker run -p 8000:8000 slabsense-backend
```

### Fly.io

```bash
# Install flyctl
# Login
fly auth login

# Launch
fly launch

# Deploy
fly deploy
```

## Development

### Running Tests

```bash
pytest
```

### Code Formatting

```bash
# Install dev dependencies
pip install black isort

# Format
black .
isort .
```

## Known Issues & Debugging

### Back Centering Detection Bug

**Problem:** The `_detect_card_physical_bounds()` method in `services/centering.py` returns incorrect boundaries for card backs. The overlay extends far beyond the actual card.

**Why it's hard:** Pokemon card backs have:
- No distinct border (blue swirl pattern extends edge-to-edge)
- Uniform coloring that confuses color-based detection
- Background (gray scanner bed) that may blend with card edges

**Current approach (not working):**
1. Saturation-based detection (card is colorful, background is gray)
2. Gradient-based edge finding
3. Contour detection
4. Fallback to 1% symmetric border

**What to try:**
1. Add debug logging to see actual detected values
2. Test with isolated back images to verify contour detection
3. Compare with frontend client-side detection (which works)
4. Consider simpler approach: assume card fills most of frame, use minimal borders
5. Use machine learning for card detection (future)

### Front Centering Misalignment

Minor issue - overlay is close but not perfectly aligned. Lower priority than back centering.

## License

Proprietary - SlabSense
