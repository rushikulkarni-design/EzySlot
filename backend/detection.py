"""
EzySlot - YOLOv8 Vehicle Detection

Detects ONLY vehicles.

Detection strategy:
1. Full-image YOLO detection.
2. Tiled YOLO detection for vehicles that may be missed because
   of perspective / small object size.
3. Merge duplicate detections.
4. Return normalized coordinates.

Parking slot occupancy is handled separately by the slot polygon
matching logic.
"""

import io
import os
import threading
from typing import List, Dict, Tuple

os.environ.setdefault("OMP_NUM_THREADS", "1")
os.environ.setdefault("MKL_NUM_THREADS", "1")

from PIL import Image, ImageDraw, ImageFont


# ============================================================
# VEHICLE CLASSES - COCO
# ============================================================

VEHICLE_CLASSES = {
    1: "bicycle",
    2: "car",
    3: "motorcycle",
    5: "bus",
    7: "truck",
}


# ============================================================
# SETTINGS
# ============================================================

# Keep the configuration that was working well.
CONF_DETECTION = 0.15

# Strong detection threshold.
CONF_OCCUPIED = 0.40

# Full image inference.
IMAGE_SIZE = 960

# Tile inference.
TILE_SIZE = 640
TILE_OVERLAP = 0.20

# NMS / duplicate suppression.
DUPLICATE_IOU = 0.50

# Maximum detections returned.
MAX_DETECTIONS = 100


# ============================================================
# MODEL
# ============================================================

_model = None
_model_lock = threading.Lock()

MODEL_PATH = os.path.join(
    os.path.dirname(__file__),
    "yolov8n.pt",
)


def get_model():
    global _model

    if _model is None:
        with _model_lock:
            if _model is None:
                from ultralytics import YOLO

                path = (
                    MODEL_PATH
                    if os.path.exists(MODEL_PATH)
                    else "yolov8n.pt"
                )

                _model = YOLO(path)

    return _model


def model_ready() -> bool:
    return (
        os.path.exists(MODEL_PATH)
        or _model is not None
    )


# ============================================================
# IOU
# ============================================================

def _box_iou(
    box_a: List[float],
    box_b: List[float],
) -> float:

    ax1, ay1, ax2, ay2 = box_a
    bx1, by1, bx2, by2 = box_b

    ix1 = max(ax1, bx1)
    iy1 = max(ay1, by1)
    ix2 = min(ax2, bx2)
    iy2 = min(ay2, by2)

    if ix2 <= ix1 or iy2 <= iy1:
        return 0.0

    intersection = (
        ix2 - ix1
    ) * (
        iy2 - iy1
    )

    area_a = max(
        0.0,
        (ax2 - ax1) * (ay2 - ay1),
    )

    area_b = max(
        0.0,
        (bx2 - bx1) * (by2 - by1),
    )

    union = (
        area_a
        + area_b
        - intersection
    )

    if union <= 0:
        return 0.0

    return intersection / union


# ============================================================
# DUPLICATE SUPPRESSION
# ============================================================

def _suppress_duplicates(
    detections: List[Dict],
) -> List[Dict]:

    if not detections:
        return []

    # Highest confidence first.
    detections = sorted(
        detections,
        key=lambda d: float(
            d.get("conf", 0.0)
        ),
        reverse=True,
    )

    kept = []

    for candidate in detections:

        duplicate = False

        for existing in kept:

            # Different vehicle classes should not suppress
            # each other.
            if (
                candidate["label"]
                != existing["label"]
            ):
                continue

            iou = _box_iou(
                candidate["box"],
                existing["box"],
            )

            if iou >= DUPLICATE_IOU:
                duplicate = True
                break

        if not duplicate:
            kept.append(candidate)

        if len(kept) >= MAX_DETECTIONS:
            break

    return kept


# ============================================================
# RUN YOLO ON ONE IMAGE
# ============================================================

def _run_model(
    model,
    image,
    imgsz: int,
) -> List[Dict]:

    results = model.predict(
        image,
        imgsz=imgsz,
        conf=CONF_DETECTION,
        iou=0.50,
        max_det=100,
        verbose=False,
        device="cpu",
        augment=False,
    )

    detections = []

    for result in results:

        if result.boxes is None:
            continue

        for box in result.boxes:

            class_id = int(
                box.cls[0]
            )

            # ------------------------------------------------
            # ONLY VEHICLES
            # ------------------------------------------------

            if class_id not in VEHICLE_CLASSES:
                continue

            confidence = float(
                box.conf[0]
            )

            if confidence < CONF_DETECTION:
                continue

            x1, y1, x2, y2 = [
                float(value)
                for value in box.xyxy[0].tolist()
            ]

            detections.append(
                {
                    "class_id": class_id,
                    "label": VEHICLE_CLASSES[
                        class_id
                    ],
                    "conf": confidence,
                    "box": [
                        x1,
                        y1,
                        x2,
                        y2,
                    ],
                }
            )

    return detections


# ============================================================
# FULL IMAGE + TILED DETECTION
# ============================================================

def detect_vehicles(
    image_bytes: bytes,
) -> Tuple[List[Dict], int, int]:

    image = Image.open(
        io.BytesIO(image_bytes)
    ).convert("RGB")

    width, height = image.size

    model = get_model()

    all_detections = []

    # ========================================================
    # PASS 1 - FULL IMAGE
    # ========================================================

    full_detections = _run_model(
        model,
        image,
        IMAGE_SIZE,
    )

    all_detections.extend(
        full_detections
    )

    # ========================================================
    # PASS 2 - TILED IMAGE
    #
    # The purpose is to make vehicles such as the S14 car
    # larger relative to the model input.
    # ========================================================

    tile_w = min(
        TILE_SIZE,
        width,
    )

    tile_h = min(
        TILE_SIZE,
        height,
    )

    step_x = max(
        1,
        int(
            tile_w
            * (1.0 - TILE_OVERLAP)
        ),
    )

    step_y = max(
        1,
        int(
            tile_h
            * (1.0 - TILE_OVERLAP)
        ),
    )

    x_positions = list(
        range(
            0,
            max(
                1,
                width - tile_w + 1,
            ),
            step_x,
        )
    )

    y_positions = list(
        range(
            0,
            max(
                1,
                height - tile_h + 1,
            ),
            step_y,
        )
    )

    # Make sure the final right/bottom edge is covered.
    final_x = max(
        0,
        width - tile_w,
    )

    final_y = max(
        0,
        height - tile_h,
    )

    if final_x not in x_positions:
        x_positions.append(
            final_x
        )

    if final_y not in y_positions:
        y_positions.append(
            final_y
        )

    for y0 in y_positions:

        for x0 in x_positions:

            # Skip the full image if the tile is effectively
            # the same size as the original image.
            if (
                tile_w == width
                and tile_h == height
            ):
                continue

            tile = image.crop(
                (
                    x0,
                    y0,
                    x0 + tile_w,
                    y0 + tile_h,
                )
            )

            tile_detections = _run_model(
                model,
                tile,
                TILE_SIZE,
            )

            # ----------------------------------------------
            # Convert tile coordinates back to full-image
            # coordinates.
            # ----------------------------------------------

            for detection in tile_detections:

                tx1, ty1, tx2, ty2 = (
                    detection["box"]
                )

                x1 = tx1 + x0
                y1 = ty1 + y0
                x2 = tx2 + x0
                y2 = ty2 + y0

                # Clamp to original image.
                x1 = max(
                    0,
                    min(width, x1),
                )

                y1 = max(
                    0,
                    min(height, y1),
                )

                x2 = max(
                    0,
                    min(width, x2),
                )

                y2 = max(
                    0,
                    min(height, y2),
                )

                if (
                    x2 <= x1
                    or y2 <= y1
                ):
                    continue

                all_detections.append(
                    {
                        "class_id": detection[
                            "class_id"
                        ],
                        "label": detection[
                            "label"
                        ],
                        "conf": detection[
                            "conf"
                        ],
                        "box": [
                            x1,
                            y1,
                            x2,
                            y2,
                        ],
                    }
                )

    # ========================================================
    # MERGE DUPLICATES
    # ========================================================

    all_detections = (
        _suppress_duplicates(
            all_detections
        )
    )

    # ========================================================
    # NORMALIZE
    # ========================================================

    detections = []

    for detection in all_detections:

        x1, y1, x2, y2 = (
            detection["box"]
        )

        nx1 = x1 / width
        ny1 = y1 / height
        nx2 = x2 / width
        ny2 = y2 / height

        cx = (
            (x1 + x2) / 2
        ) / width

        cy = (
            (y1 + y2) / 2
        ) / height

        detections.append(
            {
                "label": detection[
                    "label"
                ],

                "class_id": detection[
                    "class_id"
                ],

                "conf": round(
                    float(
                        detection[
                            "conf"
                        ]
                    ),
                    3,
                ),

                "box": [
                    x1,
                    y1,
                    x2,
                    y2,
                ],

                "nbox": [
                    nx1,
                    ny1,
                    nx2,
                    ny2,
                ],

                "cx": round(
                    cx,
                    6,
                ),

                "cy": round(
                    cy,
                    6,
                ),

                "bottom_cx": round(
                    cx,
                    6,
                ),

                "bottom_cy": round(
                    ny2,
                    6,
                ),
            }
        )

    return (
        detections,
        width,
        height,
    )


# ============================================================
# ANNOTATE IMAGE
# ============================================================

def annotate_image(
    image_bytes: bytes,
    boxes: List[Dict],
) -> bytes:

    image = Image.open(
        io.BytesIO(image_bytes)
    ).convert("RGB")

    draw = ImageDraw.Draw(
        image,
        "RGBA",
    )

    try:
        font = ImageFont.truetype(
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
            16,
        )
    except Exception:
        font = ImageFont.load_default()

    for detection in boxes:

        x1, y1, x2, y2 = detection[
            "box"
        ]

        confidence = detection[
            "conf"
        ]

        if confidence >= CONF_OCCUPIED:
            color = (
                239,
                68,
                68,
            )
        else:
            color = (
                245,
                158,
                11,
            )

        draw.rectangle(
            [
                x1,
                y1,
                x2,
                y2,
            ],
            outline=color,
            width=3,
        )

        tag = (
            f"{detection['label']} "
            f"{int(confidence * 100)}%"
        )

        text_width = draw.textlength(
            tag,
            font=font,
        )

        label_y = max(
            0,
            y1 - 20,
        )

        draw.rectangle(
            [
                x1,
                label_y,
                x1 + text_width + 8,
                y1,
            ],
            fill=color + (230,),
        )

        draw.text(
            (
                x1 + 4,
                label_y + 1,
            ),
            tag,
            fill=(
                7,
                9,
                14,
            ),
            font=font,
        )

    output = io.BytesIO()

    image.save(
        output,
        format="JPEG",
        quality=88,
    )

    return output.getvalue()


# ============================================================
# POINT IN POLYGON
# ============================================================

def _point_in_polygon(
    x: float,
    y: float,
    polygon: List[List[float]],
) -> bool:

    if (
        not polygon
        or len(polygon) < 3
    ):
        return False

    inside = False
    j = len(polygon) - 1

    for i in range(
        len(polygon)
    ):

        xi, yi = polygon[i]
        xj, yj = polygon[j]

        if (
            (yi > y)
            != (yj > y)
        ) and (
            x
            <
            (
                (xj - xi)
                * (y - yi)
                /
                ((yj - yi) or 1e-9)
            )
            + xi
        ):
            inside = not inside

        j = i

    return inside


# ============================================================
# POLYGON AREA
# ============================================================

def _polygon_area(
    polygon: List[List[float]],
) -> float:

    if (
        not polygon
        or len(polygon) < 3
    ):
        return 0.0

    area = 0.0
    j = len(polygon) - 1

    for i in range(
        len(polygon)
    ):

        area += (
            polygon[j][0]
            * polygon[i][1]
            -
            polygon[i][0]
            * polygon[j][1]
        )

        j = i

    return abs(area) / 2.0


# ============================================================
# CENTROID
# ============================================================

def _poly_centroid(
    polygon: List[List[float]],
) -> Tuple[float, float]:

    if not polygon:
        return (
            0.0,
            0.0,
        )

    return (
        sum(
            p[0]
            for p in polygon
        ) / len(polygon),

        sum(
            p[1]
            for p in polygon
        ) / len(polygon),
    )


# ============================================================
# BBOX OVERLAP
# ============================================================

def _bbox_overlap_ratio(
    polygon: List[List[float]],
    detection: Dict,
) -> float:

    if not polygon:
        return 0.0

    px = [
        p[0]
        for p in polygon
    ]

    py = [
        p[1]
        for p in polygon
    ]

    slot_x1 = min(px)
    slot_y1 = min(py)
    slot_x2 = max(px)
    slot_y2 = max(py)

    x1, y1, x2, y2 = detection[
        "nbox"
    ]

    ix1 = max(
        slot_x1,
        x1,
    )

    iy1 = max(
        slot_y1,
        y1,
    )

    ix2 = min(
        slot_x2,
        x2,
    )

    iy2 = min(
        slot_y2,
        y2,
    )

    if (
        ix2 <= ix1
        or iy2 <= iy1
    ):
        return 0.0

    intersection = (
        ix2 - ix1
    ) * (
        iy2 - iy1
    )

    vehicle_area = max(
        (x2 - x1)
        * (y2 - y1),
        1e-9,
    )

    return (
        intersection
        /
        vehicle_area
    )


# ============================================================
# SLOT STATUS
# ============================================================

def compute_slot_status(
    slots: List[Dict],
    boxes: List[Dict],
) -> Dict[str, Dict]:

    result = {}

    for slot in slots:

        polygon = slot[
            "polygon"
        ]

        best = None

        for detection in boxes:

            # ONLY VEHICLES
            if (
                detection.get("label")
                not in
                VEHICLE_CLASSES.values()
            ):
                continue

            confidence = float(
                detection.get(
                    "conf",
                    0,
                )
            )

            if confidence < CONF_DETECTION:
                continue

            cx = float(
                detection.get(
                    "cx",
                    0,
                )
            )

            cy = float(
                detection.get(
                    "cy",
                    0,
                )
            )

            bottom_cx = float(
                detection.get(
                    "bottom_cx",
                    cx,
                )
            )

            bottom_cy = float(
                detection.get(
                    "bottom_cy",
                    detection[
                        "nbox"
                    ][3],
                )
            )

            # ------------------------------------------------
            # CENTER
            # ------------------------------------------------

            center_inside = (
                _point_in_polygon(
                    cx,
                    cy,
                    polygon,
                )
            )

            # ------------------------------------------------
            # BOTTOM CENTER
            # ------------------------------------------------

            bottom_inside = (
                _point_in_polygon(
                    bottom_cx,
                    bottom_cy,
                    polygon,
                )
            )

            # ------------------------------------------------
            # OVERLAP
            # ------------------------------------------------

            overlap = (
                _bbox_overlap_ratio(
                    polygon,
                    detection,
                )
            )

            matched = False
            match_type = "NONE"

            if center_inside:

                matched = True
                match_type = "CENTER"

            elif bottom_inside:

                matched = True
                match_type = "BOTTOM_CENTER"

            elif (
                confidence >= 0.30
                and overlap >= 0.35
            ):

                matched = True
                match_type = "OVERLAP"

            elif (
                confidence >= 0.15
                and overlap >= 0.55
            ):

                matched = True
                match_type = "STRONG_OVERLAP"

            if not matched:
                continue

            priority = {
                "CENTER": 4,
                "BOTTOM_CENTER": 3,
                "OVERLAP": 2,
                "STRONG_OVERLAP": 1,
            }.get(
                match_type,
                0,
            )

            score = (
                priority * 100
                + confidence * 20
                + overlap * 10
            )

            candidate = {
                "status": "OCCUPIED",

                "conf": round(
                    confidence,
                    3,
                ),

                "box": detection.get(
                    "nbox"
                ),

                "vehicle": detection.get(
                    "label"
                ),

                "match_type": match_type,

                "overlap": round(
                    overlap,
                    3,
                ),

                "score": score,
            }

            if (
                best is None
                or score >
                best["score"]
            ):
                best = candidate

        # ----------------------------------------------------
        # FINAL STATUS
        # ----------------------------------------------------

        if best is None:

            result[
                slot["id"]
            ] = {
                "status": "FREE",
                "conf": 0.0,
                "box": None,
                "vehicle": None,
                "match_type": None,
                "overlap": 0.0,
            }

        else:

            best.pop(
                "score",
                None,
            )

            result[
                slot["id"]
            ] = best

    return result