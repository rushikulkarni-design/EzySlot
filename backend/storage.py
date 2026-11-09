"""Local object storage helpers for EzySlot."""

from pathlib import Path
import mimetypes

# Store uploaded files inside the backend folder
BASE_DIR = Path(__file__).resolve().parent
STORAGE_DIR = BASE_DIR / "storage_data"

# Keep the same APP_NAME used by the existing backend
APP_NAME = "EzySlot"

_storage_ready = False


def init_storage(force: bool = False):
    """
    Initialize local storage.

    Kept with the same function name as the old external-storage
    implementation so the rest of the backend does not need changes.
    """
    global _storage_ready

    if _storage_ready and not force:
        return str(STORAGE_DIR)

    STORAGE_DIR.mkdir(parents=True, exist_ok=True)
    _storage_ready = True

    return str(STORAGE_DIR)


def _safe_path(path: str) -> Path:
    """
    Convert a relative storage path into a safe local filesystem path.
    Prevents paths from escaping STORAGE_DIR.
    """
    root = STORAGE_DIR.resolve()
    target = (root / path).resolve()

    if target != root and root not in target.parents:
        raise ValueError("Invalid storage path")

    return target


def put_object(path: str, data: bytes, content_type: str) -> dict:
    """
    Save an object locally.
    """
    init_storage()

    target = _safe_path(path)
    target.parent.mkdir(parents=True, exist_ok=True)

    target.write_bytes(data)

    return {
        "path": path,
        "size": len(data),
        "content_type": content_type,
    }


def get_object(path: str):
    """
    Read an object from local storage.
    """
    init_storage()

    target = _safe_path(path)

    if not target.exists() or not target.is_file():
        raise FileNotFoundError(path)

    data = target.read_bytes()

    content_type, _ = mimetypes.guess_type(str(target))

    return (
        data,
        content_type or "application/octet-stream",
    )