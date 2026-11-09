"""
EzySlot AI - Number Plate OCR
Accuracy-first OCR for Indian vehicle registration plates.

This module OCRs the supplied image. It does not automatically locate/crop
a plate inside a full parking-camera frame; a plate-focused crop gives best results.
"""

import re
import threading

import easyocr
import numpy as np
import cv2
from PIL import Image, ImageOps


_reader = None
_reader_lock = threading.Lock()


def get_reader():
    """Load EasyOCR once and reuse it across requests."""
    global _reader
    if _reader is None:
        with _reader_lock:
            if _reader is None:
                _reader = easyocr.Reader(["en"], gpu=False, verbose=False)
    return _reader


def normalize_plate(text: str) -> str:
    """Remove spaces and punctuation for comparison."""
    return re.sub(r"[^A-Z0-9]", "", str(text).upper())


def correct_indian_plate_ocr(text: str) -> str:
    """Apply position-based OCR corrections to common 10-character plates."""
    plate = normalize_plate(text)
    if len(plate) != 10:
        return plate

    chars = list(plate)
    letter_map = {"0": "O", "1": "I", "2": "Z", "5": "S", "8": "B"}
    for i in (0, 1):
        chars[i] = letter_map.get(chars[i], chars[i])

    digit_map = {
        "O": "0", "Q": "0", "D": "0", "I": "1", "L": "1",
        "Z": "2", "S": "5", "B": "8", "G": "6",
    }
    for i in (2, 3):
        chars[i] = digit_map.get(chars[i], chars[i])

    series_digit_map = {"0": "O", "1": "I", "2": "Z", "5": "S", "8": "B"}
    for i in (4, 5):
        chars[i] = series_digit_map.get(chars[i], chars[i])

    for i in range(6, 10):
        chars[i] = digit_map.get(chars[i], chars[i])

    return "".join(chars)


def make_image_variants(image: Image.Image):
    """Try a small set of complementary variants to improve OCR robustness."""
    rgb = np.asarray(image.convert("RGB"))
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)

    # Limit enlargement to avoid huge, slow arrays.
    width = gray.shape[1]
    scale = min(2.0, max(1.0, 1000.0 / max(width, 1)))
    if scale > 1.05:
        enlarged = cv2.resize(
            gray, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC
        )
    else:
        enlarged = gray

    contrast = cv2.convertScaleAbs(enlarged, alpha=1.45, beta=3)
    adaptive = cv2.adaptiveThreshold(
        cv2.GaussianBlur(enlarged, (3, 3), 0),
        255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY,
        31,
        9,
    )
    return [rgb, enlarged, contrast, adaptive]


def _candidate_score(item):
    """Prefer plausible common 10-character plates, then OCR confidence."""
    plate = item["raw_plate_number"]
    length = len(plate)
    confidence = item["confidence"]

    # Typical Indian private plates have 10 characters. Do not silently
    # truncate 11-character OCR output; instead prefer a clean 10-char read
    # from another image variant if one exists.
    if length == 10:
        length_bonus = 0.20
    elif length in (9, 11):
        length_bonus = 0.0
    else:
        length_bonus = -0.20
    return confidence + length_bonus


def read_number_plate(image_path: str) -> dict:
    """Read a plate-focused image and return the strongest plausible candidate."""
    try:
        with Image.open(image_path) as source:
            image = ImageOps.exif_transpose(source).convert("RGB")

        reader = get_reader()
        candidates = []
        seen = set()

        for variant_index, variant in enumerate(make_image_variants(image)):
            try:
                results = reader.readtext(
                    variant,
                    detail=1,
                    paragraph=False,
                    allowlist="ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
                )
            except Exception:
                continue

            for _bbox, text, confidence in results:
                raw = normalize_plate(text)
                if not 8 <= len(raw) <= 12:
                    continue

                corrected = correct_indian_plate_ocr(raw)
                item = {
                    "text": str(text).strip(),
                    "raw_plate_number": raw,
                    "plate_number": corrected,
                    "confidence": round(float(confidence), 3),
                    "variant": variant_index,
                }
                # Keep duplicate reads from separate variants only once per
                # raw string, retaining the strongest confidence.
                key = (raw, variant_index)
                if key not in seen:
                    seen.add(key)
                    candidates.append(item)

        if not candidates:
            return {
                "success": False,
                "plate_number": None,
                "confidence": 0.0,
                "candidates": [],
                "message": (
                    "No readable plate found. Try a closer, sharper image "
                    "containing only the number plate."
                ),
            }

        # If any common 10-character candidate exists, prefer that set.
        # This avoids choosing an 11-character read such as an extra trailing
        # digit when another variant reads the expected 10 characters.
        ten_char = [c for c in candidates if len(c["raw_plate_number"]) == 10]
        pool = ten_char if ten_char else candidates
        pool.sort(key=_candidate_score, reverse=True)
        best = pool[0]

        # Return candidates without internal ranking metadata.
        public_candidates = [
            {
                "text": c["text"],
                "raw_plate_number": c["raw_plate_number"],
                "plate_number": c["plate_number"],
                "confidence": c["confidence"],
            }
            for c in sorted(candidates, key=_candidate_score, reverse=True)[:10]
        ]

        return {
            "success": True,
            "plate_number": best["plate_number"],
            "raw_plate_number": best["raw_plate_number"],
            "confidence": best["confidence"],
            "candidates": public_candidates,
            "message": (
                "OCR completed. Verify the plate against the image "
                "before using it for access decisions."
            ),
        }

    except Exception as exc:
        return {
            "success": False,
            "plate_number": None,
            "confidence": 0.0,
            "candidates": [],
            "message": f"Number plate OCR failed: {str(exc)[:200]}",
        }
