
import io
import os
import threading

from PIL import Image
from ultralytics import YOLO


MODEL_PATH = os.path.join(
    os.path.dirname(__file__),
    "models",
    "license_plate_best.pt",
)

_model = None
_model_lock = threading.Lock()


def get_plate_model():
    global _model

    if _model is None:
        with _model_lock:
            if _model is None:
                if not os.path.exists(MODEL_PATH):
                    raise FileNotFoundError(
                        f"License plate model not found: {MODEL_PATH}"
                    )

                _model = YOLO(MODEL_PATH)

    return _model


def detect_license_plates(image_bytes: bytes):
    """
    Detect license plates in a complete image.

    Returns plate bounding boxes and cropped plate images.
    Does not perform OCR or modify vehicle detection.
    """
    image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    model = get_plate_model()

    results = model.predict(
        image,
        conf=0.25,
        iou=0.45,
        imgsz=960,
        max_det=50,
        verbose=False,
        device="cpu",
    )

    detections = []

    for result in results:
        if result.boxes is None:
            continue

        for box in result.boxes:
            x1, y1, x2, y2 = [
                int(round(v))
                for v in box.xyxy[0].tolist()
            ]

            # Clamp coordinates to the image boundaries.
            x1 = max(0, min(image.width, x1))
            y1 = max(0, min(image.height, y1))
            x2 = max(0, min(image.width, x2))
            y2 = max(0, min(image.height, y2))

            if x2 <= x1 or y2 <= y1:
                continue

            plate_crop = image.crop((x1, y1, x2, y2))

            crop_buffer = io.BytesIO()
            plate_crop.save(crop_buffer, format="JPEG", quality=95)

            detections.append({
                "box": [x1, y1, x2, y2],
                "confidence": round(float(box.conf[0]), 3),
                "crop_bytes": crop_buffer.getvalue(),
            })

    return detections
