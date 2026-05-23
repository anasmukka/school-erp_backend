import sys
import logging
import os
import re
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

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
UID_PATTERN = re.compile(r"^[0-9a-f]+$")


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


SERVICE_ACCOUNT_PATH = os.getenv(
    "GOOGLE_APPLICATION_CREDENTIALS",
    "/etc/secrets/serviceAccountKey.json"
)

cred = credentials.Certificate(SERVICE_ACCOUNT_PATH)
firebase_admin.initialize_app(cred)


def initialize_firestore():
    try:
        firebase_admin.get_app()
    except ValueError:
        cred = credentials.Certificate(str(SERVICE_ACCOUNT_PATH))
        firebase_admin.initialize_app(cred)

    return firestore.client()


db = initialize_firestore()

app = FastAPI()
api_router = APIRouter(prefix="/api")


class StatusCheck(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    client_name: str
    timestamp: datetime = Field(default_factory=lambda: datetime.now().astimezone())


class StatusCheckCreate(BaseModel):
    client_name: str


class RfidScanRequest(BaseModel):
    uid: str
    deviceId: str = ""
    timestamp: str = ""


class RfidCardAssign(BaseModel):
    uid: str
    studentId: str
    studentName: str = ""
    sectionId: str = ""
    grade: str = ""


class RfidCardOut(BaseModel):
    uid: str
    studentId: str
    studentName: str
    sectionId: str
    grade: str
    assignedAt: str


class AttendanceOut(BaseModel):
    studentId: str
    studentName: str
    sectionId: str
    date: str
    time: str
    status: str
    source: str


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


def get_cors_origins() -> List[str]:
    origins = [origin.strip() for origin in os.environ.get("CORS_ORIGINS", "*").split(",")]
    return [origin for origin in origins if origin] or ["*"]


def normalize_uid_value(raw_uid: Any) -> str:
    return str(raw_uid or "").strip().lower()


def is_valid_uid(uid: str) -> bool:
    return bool(uid) and bool(UID_PATTERN.fullmatch(uid))


def get_uid_error_message(uid: str, empty_message: str = "No UID provided") -> Optional[str]:
    if not uid:
        return empty_message
    if not is_valid_uid(uid):
        return "Invalid UID. Use lowercase hexadecimal characters only."
    return None


def normalize_rfid_card_record(
    data: Dict[str, Any],
    fallback_uid: str = "",
) -> Optional[Dict[str, Any]]:
    normalized = dict(data)
    normalized_uid = normalize_uid_value(normalized.get("uid") or fallback_uid)
    if not is_valid_uid(normalized_uid):
        return None

    normalized["uid"] = normalized_uid
    normalized["studentId"] = str(normalized.get("studentId", "") or "").strip()
    normalized["studentName"] = str(normalized.get("studentName", "") or "").strip()
    normalized["sectionId"] = str(normalized.get("sectionId", "") or "").strip()
    normalized["grade"] = str(normalized.get("grade", "") or "").strip()
    return normalized


def normalize_scan_time(raw_timestamp: str, fallback: datetime) -> str:
    value = (raw_timestamp or "").strip()
    if not value:
        return fallback.strftime("%H:%M:%S")

    if "T" in value:
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
            return parsed.astimezone(fallback.tzinfo).strftime("%H:%M:%S")
        except ValueError:
            return value

    return value


def write_normalized_rfid_card_document(
    uid: str,
    payload: Dict[str, Any],
    legacy_doc: Any = None,
) -> Tuple[Any, Dict[str, Any]]:
    normalized_payload = normalize_rfid_card_record(payload, uid)
    if not normalized_payload:
        raise ValueError(f"Cannot store malformed RFID UID: {uid}")

    target_ref = db.collection("rfidCards").document(normalized_payload["uid"])
    target_ref.set(normalized_payload)

    if legacy_doc and legacy_doc.id != normalized_payload["uid"]:
        legacy_doc.reference.delete()

    return target_ref.get(), normalized_payload


def migrate_rfid_cards_to_lowercase() -> None:
    migrated = 0
    skipped = 0

    for doc in db.collection("rfidCards").stream():
        raw_data = doc.to_dict() or {}
        normalized = normalize_rfid_card_record(raw_data, doc.id)
        if not normalized:
            skipped += 1
            logger.warning(
                "Skipping malformed RFID card doc id=%s uid=%s",
                doc.id,
                raw_data.get("uid", doc.id),
            )
            continue

        raw_uid = normalize_uid_value(raw_data.get("uid") or doc.id)
        needs_migration = doc.id != normalized["uid"] or raw_uid != normalized["uid"]
        if not needs_migration:
            continue

        target_ref = db.collection("rfidCards").document(normalized["uid"])
        target_doc = target_ref.get()
        if target_doc.exists and target_doc.id != doc.id:
            target_data = normalize_rfid_card_record(target_doc.to_dict() or {}, target_doc.id)
            if (
                target_data
                and target_data.get("studentId")
                and normalized.get("studentId")
                and target_data["studentId"] != normalized["studentId"]
            ):
                skipped += 1
                logger.warning(
                    "Skipping RFID UID migration for %s -> %s because the lowercase UID is already assigned to another student",
                    doc.id,
                    normalized["uid"],
                )
                continue

        write_normalized_rfid_card_document(normalized["uid"], normalized, doc)
        migrated += 1

    logger.info("RFID UID normalization complete: migrated=%s skipped=%s", migrated, skipped)


def find_rfid_card_document(uid: str) -> Tuple[Any, Optional[Dict[str, Any]]]:
    uid = normalize_uid_value(uid)
    if not is_valid_uid(uid):
        return None, None

    direct_doc = db.collection("rfidCards").document(uid).get()
    if direct_doc.exists:
        data = normalize_rfid_card_record(direct_doc.to_dict() or {}, direct_doc.id)
        if data:
            if direct_doc.id != data["uid"] or direct_doc.to_dict().get("uid") != data["uid"]:
                return write_normalized_rfid_card_document(data["uid"], data, direct_doc)
            return direct_doc, data

    matches = list(db.collection("rfidCards").where("uid", "==", uid).limit(1).stream())
    if matches:
        data = normalize_rfid_card_record(matches[0].to_dict() or {}, matches[0].id)
        if data:
            if matches[0].id != data["uid"] or matches[0].to_dict().get("uid") != data["uid"]:
                return write_normalized_rfid_card_document(data["uid"], data, matches[0])
            return matches[0], data

    for doc in db.collection("rfidCards").stream():
        data = normalize_rfid_card_record(doc.to_dict() or {}, doc.id)
        if data and data["uid"] == uid:
            return write_normalized_rfid_card_document(uid, data, doc)

    return None, None


def get_student_name(student_id: str, fallback: str = "") -> str:
    if not student_id:
        return fallback

    student_doc = db.collection("students").document(student_id).get()
    if not student_doc.exists:
        return fallback

    student_data = student_doc.to_dict() or {}
    return student_data.get("name", fallback) or fallback


@api_router.get("/")
def root():
    return {"message": "Hello World"}


@api_router.post("/status", response_model=StatusCheck)
def create_status_check(input: StatusCheckCreate):
    status_obj = StatusCheck(client_name=input.client_name)
    doc = status_obj.model_dump()
    doc["timestamp"] = status_obj.timestamp.isoformat()
    db.collection("status_checks").document(status_obj.id).set(doc)
    return status_obj


@api_router.get("/status", response_model=List[StatusCheck])
def get_status_checks():
    status_checks = []
    for doc in db.collection("status_checks").stream():
        payload = doc.to_dict() or {}
        payload["timestamp"] = parse_datetime(payload.get("timestamp"))
        status_checks.append(StatusCheck(**payload))

    status_checks.sort(key=lambda check: check.timestamp, reverse=True)
    return status_checks


@api_router.post("/rfid-scan")
def rfid_scan(body: RfidScanRequest):
    uid = normalize_uid_value(body.uid)
    uid_error = get_uid_error_message(uid)
    if uid_error:
        return {"success": False, "message": uid_error}

    try:
        _, card = find_rfid_card_document(uid)
        if not card:
            return {"success": False, "message": "Unknown card", "uid": uid}

        student_id = (card.get("studentId") or "").strip()
        if not student_id:
            return {"success": False, "message": "Card is not linked to a student", "uid": uid}

        student_name = card.get("studentName", "") or get_student_name(student_id)
        section_id = card.get("sectionId", "")
        now = get_local_now()
        today = now.date().isoformat()
        attendance_id = f"{student_id}_{today}"
        attendance_ref = db.collection("attendance").document(attendance_id)

        if attendance_ref.get().exists:
            return {
                "success": False,
                "message": "Already marked",
                "studentId": student_id,
                "studentName": student_name,
                "date": today,
            }

        record = {
            "studentId": student_id,
            "sectionId": section_id,
            "date": today,
            "time": normalize_scan_time(body.timestamp, now),
            "status": "present",
            "source": "rfid",
            "deviceId": body.deviceId.strip(),
        }
        attendance_ref.set(record)

        return {
            "success": True,
            "message": "Attendance marked",
            "studentId": student_id,
            "studentName": student_name,
            "sectionId": section_id,
            "date": record["date"],
            "time": record["time"],
        }
    except Exception:
        logger.exception("Failed to process RFID scan for uid=%s", uid)
        return {"success": False, "message": "Failed to mark attendance"}


@api_router.post("/rfid-cards")
def assign_rfid_card(body: RfidCardAssign):
    uid = normalize_uid_value(body.uid)
    student_id = body.studentId.strip()
    if not uid or not student_id:
        return {"success": False, "message": "UID and studentId are required"}
    if not is_valid_uid(uid):
        return {"success": False, "message": "Invalid UID. Use lowercase hexadecimal characters only."}

    try:
        existing_doc, existing = find_rfid_card_document(uid)
        if existing and existing.get("studentId") != student_id:
            assigned_to = existing.get("studentName") or existing.get("studentId") or "another student"
            return {
                "success": False,
                "message": f"This card is already assigned to {assigned_to}",
            }

        now = get_local_now().isoformat()
        payload = {
            "uid": uid,
            "studentId": student_id,
            "sectionId": body.sectionId.strip(),
            "studentName": body.studentName.strip(),
            "grade": body.grade.strip(),
            "assignedAt": now,
        }

        write_normalized_rfid_card_document(uid, payload, existing_doc)

        return {
            "success": True,
            "message": f"Card {uid} assigned to {body.studentName or student_id}",
        }
    except Exception:
        logger.exception("Failed to assign RFID card uid=%s", uid)
        return {"success": False, "message": "Failed to assign card"}


@api_router.delete("/rfid-cards/{uid}")
def unassign_rfid_card(uid: str):
    uid = normalize_uid_value(uid)
    uid_error = get_uid_error_message(uid, empty_message="UID is required")
    if uid_error:
        return {"success": False, "message": uid_error}

    try:
        existing_doc, _ = find_rfid_card_document(uid)
        if not existing_doc:
            return {"success": False, "message": "Card not found"}

        existing_doc.reference.delete()
        return {"success": True, "message": "Card unassigned"}
    except Exception:
        logger.exception("Failed to unassign RFID card uid=%s", uid)
        return {"success": False, "message": "Failed to unassign card"}


@api_router.get("/rfid-cards", response_model=List[RfidCardOut])
def list_rfid_cards():
    cards = []
    for doc in db.collection("rfidCards").stream():
        data = normalize_rfid_card_record(doc.to_dict() or {}, doc.id)
        if not data:
            logger.warning("Skipping malformed RFID card doc id=%s while listing cards", doc.id)
            continue
        cards.append(
            RfidCardOut(
                uid=data["uid"],
                studentId=data.get("studentId", ""),
                studentName=data.get("studentName", ""),
                sectionId=data.get("sectionId", ""),
                grade=data.get("grade", ""),
                assignedAt=str(data.get("assignedAt", "") or ""),
            )
        )

    cards.sort(key=lambda card: card.assignedAt, reverse=True)
    return cards


@api_router.get("/attendance")
def get_attendance(date: Optional[str] = None, sectionId: Optional[str] = None):
    student_name_cache: Dict[str, str] = {}
    records = []

    query_ref = db.collection("attendance")
    if date:
        query_ref = query_ref.where("date", "==", date)
    if sectionId:
        query_ref = query_ref.where("sectionId", "==", sectionId)

    for doc in query_ref.stream():
        data = doc.to_dict() or {}

        student_id = data.get("studentId", "")
        fallback_name = data.get("studentName", "")
        if student_id not in student_name_cache:
            student_name_cache[student_id] = get_student_name(student_id, fallback_name)

        records.append(
            AttendanceOut(
                studentId=student_id,
                studentName=student_name_cache.get(student_id, fallback_name),
                sectionId=data.get("sectionId", ""),
                date=data.get("date", ""),
                time=data.get("time", ""),
                status=data.get("status", "present"),
                source=data.get("source", "rfid"),
            )
        )

    records.sort(key=lambda record: (record.date, record.time), reverse=True)
    return records


@api_router.get("/attendance/today-count")
def today_attendance_count(sectionId: Optional[str] = None):
    today = get_local_now().date().isoformat()
    count = 0

    query_ref = db.collection("attendance").where("date", "==", today)
    if sectionId:
        query_ref = query_ref.where("sectionId", "==", sectionId)

    for doc in query_ref.stream():
        payload = doc.to_dict() or {}
        if payload.get("source") == "rfid":
            count += 1

    return {"date": today, "count": count}


app.include_router(api_router)


@app.on_event("startup")
def run_rfid_uid_normalization() -> None:
    try:
        migrate_rfid_cards_to_lowercase()
    except Exception:
        logger.exception("Failed to normalize existing RFID card UIDs to lowercase")

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=get_cors_origins(),
    allow_methods=["*"],
    allow_headers=["*"],
)
