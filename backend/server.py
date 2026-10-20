import sys
import logging
import os
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

ROOT_DIR = Path(__file__).parent
VENDOR_DIR = ROOT_DIR / ".vendor"
CURRENT_PYTHON_TAG = f"cp{sys.version_info.major}{sys.version_info.minor}"


def add_compatible_vendor_dir():
    if not VENDOR_DIR.exists():
        return

    compiled_pydantic_core = next(
        VENDOR_DIR.glob("pydantic_core/_pydantic_core.cp*-win_amd64.pyd"),
        None,
    )
    if compiled_pydantic_core and CURRENT_PYTHON_TAG not in compiled_pydantic_core.name:
        return

    sys.path.insert(0, str(VENDOR_DIR))


add_compatible_vendor_dir()

try:
    import firebase_admin
    from dotenv import load_dotenv
    from fastapi import APIRouter, FastAPI
    from firebase_admin import credentials, firestore
    from pydantic import BaseModel, ConfigDict, Field
    from starlette.middleware.cors import CORSMiddleware
except ModuleNotFoundError as exc:
    common_backend_modules = {
        "dotenv",
        "fastapi",
        "firebase_admin",
        "pydantic",
        "pydantic_core._pydantic_core",
        "starlette",
    }
    if exc.name in common_backend_modules:
        raise RuntimeError(
            "Backend dependencies are missing for the Python interpreter running this "
            "server. Install them with the same interpreter, for example "
            "'py -m pip install -r requirements.txt', or run the backend with Python "
            "3.12 if you want to reuse packages from backend/.vendor."
        ) from exc
    raise

load_dotenv(ROOT_DIR / ".env")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)

DEFAULT_SERVICE_ACCOUNT_PATH = ROOT_DIR / "serviceAccountKey.json"
SERVICE_ACCOUNT_ENV_VARS = (
    "FIREBASE_SERVICE_ACCOUNT_PATH",
    "GOOGLE_APPLICATION_CREDENTIALS",
)


def resolve_service_account_path() -> Path:
    invalid_configured_paths = []

    for env_var in SERVICE_ACCOUNT_ENV_VARS:
        raw_value = os.environ.get(env_var, "").strip()
        if not raw_value:
            continue

        candidate = Path(raw_value).expanduser()
        if not candidate.is_absolute():
            candidate = (ROOT_DIR / candidate).resolve()

        if candidate.exists():
            return candidate

        invalid_configured_paths.append(f"{env_var}={candidate}")

    if DEFAULT_SERVICE_ACCOUNT_PATH.exists():
        return DEFAULT_SERVICE_ACCOUNT_PATH

    configured_hint = ""
    if invalid_configured_paths:
        configured_hint = " Invalid configured path(s): " + ", ".join(invalid_configured_paths) + "."

    raise RuntimeError(
        "Missing Firebase service account key. Put it at "
        f"'{DEFAULT_SERVICE_ACCOUNT_PATH}', or set FIREBASE_SERVICE_ACCOUNT_PATH / "
        f"GOOGLE_APPLICATION_CREDENTIALS to a valid JSON file path.{configured_hint}"
    )


def initialize_firestore():
    try:
        firebase_admin.get_app()
    except ValueError:
        try:
            service_account = resolve_service_account_path()
            cred = credentials.Certificate(str(service_account))
            firebase_admin.initialize_app(cred)
        except Exception as e:
            logger.warning("Could not initialize Firebase Admin SDK: %s", e)
            return None

    return firestore.client()


db = initialize_firestore()

app = FastAPI(title="Prestige ERP Backend Gateway")
api_router = APIRouter(prefix="/api")


class StatusCheck(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    client_name: str
    timestamp: datetime = Field(default_factory=lambda: datetime.now().astimezone())


class StatusCheckCreate(BaseModel):
    client_name: str


def get_local_now() -> datetime:
    return datetime.now().astimezone()


def parse_datetime(value: Any) -> datetime:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=get_local_now().tzinfo)

    if isinstance(value, str):
        normalized = value.replace("Z", "+00:00")
        parsed = datetime.fromisoformat(normalized)
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=get_local_now().tzinfo)

    return get_local_now()


DEFAULT_ALLOWED_ORIGINS = [
    "http://localhost:3000",
    "http://localhost:5173",
    "https://prestige-erp.web.app",
    "https://prestige-erp.firebaseapp.com",
]


def get_cors_origins() -> List[str]:
    raw_origins = os.environ.get("CORS_ORIGINS", "")
    if not raw_origins or raw_origins.strip() == "*":
        return DEFAULT_ALLOWED_ORIGINS
    origins = [origin.strip() for origin in raw_origins.split(",") if origin.strip() and origin.strip() != "*"]
    return origins or DEFAULT_ALLOWED_ORIGINS


@api_router.get("/")
def root():
    return {
        "status": "operational",
        "service": "Prestige International School ERP API Gateway",
        "attendanceMode": "manual_class_teacher",
        "rfidStatus": "deferred",
        "timestamp": get_local_now().isoformat(),
    }


@api_router.post("/status", response_model=StatusCheck)
def create_status_check(input: StatusCheckCreate):
    status_obj = StatusCheck(client_name=input.client_name)
    if db is not None:
        doc = status_obj.model_dump()
        doc["timestamp"] = status_obj.timestamp.isoformat()
        db.collection("status_checks").document(status_obj.id).set(doc)
    return status_obj


@api_router.get("/status", response_model=List[StatusCheck])
def get_status_checks():
    if db is None:
        return []
    status_checks = []
    for doc in db.collection("status_checks").stream():
        payload = doc.to_dict() or {}
        payload["timestamp"] = parse_datetime(payload.get("timestamp"))
        status_checks.append(StatusCheck(**payload))

    status_checks.sort(key=lambda check: check.timestamp, reverse=True)
    return status_checks


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=get_cors_origins(),
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
)
