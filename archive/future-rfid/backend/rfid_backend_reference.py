"""
REFERENCE ARCHIVE: Prestige International School ERP - RFID Attendance Backend Service
========================================================================================
Status: DEFERRED / ARCHIVED FOR FUTURE USE
Date Archived: October 2026

DESCRIPTION:
This module contains the complete backend reference implementation for RFID-based
student attendance and RFID smartcard lifecycle management originally designed
for the Prestige International School ERP.

It includes:
1. Pydantic request/response schemas for card assignments and scan events.
2. UID hexadecimal validation and case-normalization logic (lowercase hex).
3. Conflict prevention preventing the same physical card from being assigned to multiple students.
4. Edge scanner webhook handler (/api/rfid-scan) with student lookup and daily attendance recording.
5. Card inventory endpoints (/api/rfid-cards).

PREREQUISITES FOR REACTIVATION:
- Edge hardware gateway security (HMAC signature or pre-shared bearer token).
- Rate limiting / debounce protection on /api/rfid-scan to prevent scanner jitter/bounce.
- Dual-role validation (Admin-only for card assignment, Edge device token for scan ingestion).
"""

import logging
import os
import re
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from fastapi import APIRouter, HTTPException, Header, status
from pydantic import BaseModel

logger = logging.getLogger("rfid_reference")

UID_PATTERN = re.compile(r"^[0-9a-f]+$")

rfid_router = APIRouter(prefix="/api", tags=["RFID (Archived Reference)"])


# ============================================================================
# PYDANTIC SCHEMAS
# ============================================================================

class RfidScanRequest(BaseModel):
    """Payload received from IoT RFID hardware reader (e.g., ESP32 / RC522)."""
    uid: str
    deviceId: str = ""
    timestamp: str = ""


class RfidCardAssign(BaseModel):
    """Payload sent by school admin to pair an RFID card UID to a student."""
    uid: str
    studentId: str
    studentName: str = ""
    sectionId: str = ""
    grade: str = ""


class RfidCardOut(BaseModel):
    """Card assignment record returned to admin interface."""
    uid: str
    studentId: str
    studentName: str
    sectionId: str
    grade: str
    assignedAt: str


class AttendanceOut(BaseModel):
    """Attendance log representation."""
    studentId: str
    studentName: str
    sectionId: str
    date: str
    time: str
    status: str
    source: str


# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

def get_local_now() -> datetime:
    """Return timezone-aware local timestamp."""
    return datetime.now().astimezone()


def normalize_uid_value(raw_uid: Any) -> str:
    """Normalize raw UID string to stripped lowercase hexadecimal."""
    return str(raw_uid or "").strip().lower()


def is_valid_uid(uid: str) -> bool:
    """Verify UID consists exclusively of valid lowercase hexadecimal characters."""
    return bool(uid) and bool(UID_PATTERN.fullmatch(uid))


def get_uid_error_message(uid: str, empty_message: str = "No UID provided") -> Optional[str]:
    """Validate UID format and return human-readable error or None."""
    if not uid:
        return empty_message
    if not is_valid_uid(uid):
        return "Invalid UID. Use lowercase hexadecimal characters only."
    return None


def normalize_rfid_card_record(
    data: Dict[str, Any],
    fallback_uid: str = "",
) -> Optional[Dict[str, Any]]:
    """Sanitize Firestore document dictionary into a standardized RFID card record."""
    normalized = dict(data)
    normalized_uid = normalize_uid_value(normalized.get("uid") or fallback_uid)
    if not is_valid_uid(normalized_uid):
        return None

    normalized["uid"] = normalized_uid
    normalized["studentId"] = str(normalized.get("studentId") or "").strip()
    normalized["studentName"] = str(normalized.get("studentName") or "").strip()
    normalized["sectionId"] = str(normalized.get("sectionId") or "").strip()
    normalized["grade"] = str(normalized.get("grade") or "").strip()
    return normalized


def find_rfid_card_document(db, uid: str) -> Tuple[Optional[Any], Optional[Dict[str, Any]]]:
    """
    Search for an RFID card document in Firestore by document ID or internal 'uid' field.
    Handles legacy non-normalized casing gracefully.
    """
    direct_doc = db.collection("rfidCards").document(uid).get()
    if direct_doc.exists:
        payload = normalize_rfid_card_record(direct_doc.to_dict() or {}, direct_doc.id)
        if payload:
            return direct_doc, payload

    # Case-insensitive / legacy search fallback
    matches = []
    for doc_snap in db.collection("rfidCards").stream():
        candidate = normalize_rfid_card_record(doc_snap.to_dict() or {}, doc_snap.id)
        if candidate and candidate["uid"] == uid:
            matches.append((doc_snap, candidate))

    if matches:
        return matches[0]

    return None, None


def write_normalized_rfid_card_document(
    db,
    uid: str,
    payload: Dict[str, Any],
    legacy_doc: Optional[Any] = None,
) -> None:
    """Write sanitized card document using the normalized UID as the primary document ID."""
    clean_payload = normalize_rfid_card_record(payload, uid)
    if not clean_payload:
        raise ValueError(f"Cannot store malformed RFID UID: {uid}")

    target_ref = db.collection("rfidCards").document(clean_payload["uid"])
    target_ref.set(clean_payload)

    # Delete legacy document if the ID differed (e.g., uppercase hex)
    if legacy_doc and legacy_doc.id != clean_payload["uid"]:
        legacy_doc.reference.delete()


def get_student_details(db, student_id: str) -> Dict[str, str]:
    """Retrieve student name, grade, section from students collection."""
    doc = db.collection("students").document(student_id).get()
    if doc.exists:
        d = doc.to_dict() or {}
        return {
            "name": d.get("name") or student_id,
            "grade": d.get("grade") or "",
            "sectionId": d.get("sectionId") or "",
        }
    return {"name": student_id, "grade": "", "sectionId": ""}


# ============================================================================
# API ENDPOINTS
# ============================================================================

@rfid_router.post("/rfid-scan")
def rfid_scan(body: RfidScanRequest, db=None):
    """
    Ingest scan from physical RFID reader at school gate or classroom entrance.
    Matches UID against assigned students and records attendance.
    """
    if db is None:
        raise HTTPException(status_code=503, detail="Database connection unavailable")

    uid = normalize_uid_value(body.uid)
    uid_error = get_uid_error_message(uid)
    if uid_error:
        return {"success": False, "message": uid_error}

    try:
        doc_snap, card = find_rfid_card_document(db, uid)
        if not card:
            return {"success": False, "message": "Unregistered card", "uid": uid}

        student_id = card.get("studentId", "").strip()
        if not student_id:
            return {"success": False, "message": "Card has no assigned student", "uid": uid}

        student = get_student_details(db, student_id)
        now_dt = get_local_now()
        today = now_dt.date().isoformat()
        current_time = now_dt.strftime("%H:%M:%S")

        # Document ID: {studentId}_{date} ensures idempotency and avoids duplicate daily scans
        attendance_doc_id = f"{student_id}_{today}"
        att_ref = db.collection("attendance").document(attendance_doc_id)
        existing_att = att_ref.get()

        if existing_att.exists:
            existing_data = existing_att.to_dict() or {}
            # Update outTime on subsequent afternoon tap
            att_ref.update({
                "outTime": current_time,
                "lastTap": current_time,
                "tapCount": (existing_data.get("tapCount") or 1) + 1,
            })
            return {
                "success": True,
                "message": f"Exit time recorded for {student['name']}",
                "studentName": student["name"],
                "status": "updated",
                "time": current_time,
            }

        # First scan of the day: mark present
        record = {
            "studentId": student_id,
            "studentName": student["name"],
            "sectionId": card.get("sectionId") or student.get("sectionId", ""),
            "grade": card.get("grade") or student.get("grade", ""),
            "date": today,
            "time": current_time,
            "inTime": current_time,
            "status": "present",
            "source": "rfid",
            "deviceId": body.deviceId,
            "uid": uid,
            "tapCount": 1,
            "createdAt": now_dt.isoformat(),
        }
        att_ref.set(record)

        return {
            "success": True,
            "message": f"Attendance recorded for {student['name']}",
            "studentName": student["name"],
            "status": "marked",
            "date": today,
            "time": current_time,
        }

    except Exception:
        logger.exception("Failed to process RFID scan for uid=%s", uid)
        return {"success": False, "message": "Failed to mark attendance"}


@rfid_router.post("/rfid-cards")
def assign_rfid_card(body: RfidCardAssign, db=None):
    """
    Associate an RFID card UID with a student profile.
    Prevents assigning a card already held by another student.
    """
    if db is None:
        raise HTTPException(status_code=503, detail="Database connection unavailable")

    uid = normalize_uid_value(body.uid)
    student_id = body.studentId.strip()

    if not uid or not student_id:
        return {"success": False, "message": "UID and studentId are required"}

    if not is_valid_uid(uid):
        return {"success": False, "message": "Invalid UID. Use lowercase hexadecimal characters only."}

    try:
        existing_doc, existing = find_rfid_card_document(db, uid)
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

        write_normalized_rfid_card_document(db, uid, payload, existing_doc)

        # Mirror UID on student document for reverse lookups
        student_ref = db.collection("students").document(student_id)
        if student_ref.get().exists:
            student_ref.update({"rfidUid": uid})

        return {
            "success": True,
            "message": f"Card {uid} assigned to {body.studentName or student_id}",
        }
    except Exception:
        logger.exception("Failed to assign RFID card uid=%s", uid)
        return {"success": False, "message": "Failed to assign card"}


@rfid_router.delete("/rfid-cards/{uid}")
def unassign_rfid_card(uid: str, db=None):
    """Unlink an RFID card and clear student's rfidUid."""
    if db is None:
        raise HTTPException(status_code=503, detail="Database connection unavailable")

    uid = normalize_uid_value(uid)
    uid_error = get_uid_error_message(uid, empty_message="UID is required")
    if uid_error:
        return {"success": False, "message": uid_error}

    try:
        existing_doc, existing = find_rfid_card_document(db, uid)
        if not existing_doc:
            return {"success": False, "message": "Card not found"}

        if existing and existing.get("studentId"):
            student_ref = db.collection("students").document(existing["studentId"])
            if student_ref.get().exists:
                student_ref.update({"rfidUid": None})

        existing_doc.reference.delete()
        return {"success": True, "message": "Card unassigned"}
    except Exception:
        logger.exception("Failed to unassign RFID card uid=%s", uid)
        return {"success": False, "message": "Failed to unassign card"}


@rfid_router.get("/rfid-cards", response_model=List[RfidCardOut])
def list_rfid_cards(db=None):
    """List all registered RFID cards in the system."""
    if db is None:
        return []

    cards = []
    for doc in db.collection("rfidCards").stream():
        data = normalize_rfid_card_record(doc.to_dict() or {}, doc.id)
        if not data:
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
