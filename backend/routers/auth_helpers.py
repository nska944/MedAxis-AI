# routers/auth_helpers.py
# ─────────────────────────────────────────────────────────────────────────────
# Shared authentication dependencies and all Pydantic request models.
# Firebase Auth → Supabase Auth + PyJWT.
# ─────────────────────────────────────────────────────────────────────────────

import os
import random
import string
import uuid
from datetime import datetime, timedelta
from typing import List, Optional

import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel
from pydantic import BaseModel as PydanticBaseModel

security = HTTPBearer()


# ─── JWT Helpers ──────────────────────────────────────────────────────────────

_jwks_client: "jwt.PyJWKClient | None" = None


def _get_jwks_client() -> "jwt.PyJWKClient":
    """Cached JWKS client for Supabase ES256 user-session tokens."""
    global _jwks_client
    if _jwks_client is None:
        base = os.environ.get("SUPABASE_URL", "").rstrip("/")
        if not base:
            raise HTTPException(status_code=500, detail="SUPABASE_URL not set")
        _jwks_client = jwt.PyJWKClient(f"{base}/auth/v1/.well-known/jwks.json", cache_keys=True)
    return _jwks_client


def _decode_token(token: str) -> dict:
    """
    Verify a Supabase JWT. Tries ES256 (modern user-session tokens via JWKS) first;
    falls back to HS256 with SUPABASE_JWT_SECRET (our phone-OTP minted tokens).
    """
    # Detect algorithm from the unverified header
    try:
        header = jwt.get_unverified_header(token)
        alg    = header.get("alg", "HS256")
    except Exception as exc:
        raise HTTPException(status_code=401, detail=f"Malformed token: {exc}")

    try:
        if alg == "ES256":
            signing_key = _get_jwks_client().get_signing_key_from_jwt(token).key
            return jwt.decode(token, signing_key, algorithms=["ES256"], audience="authenticated")
        # HS256 fallback (phone-OTP session tokens we mint ourselves)
        secret = os.getenv("SUPABASE_JWT_SECRET")
        if not secret:
            raise HTTPException(status_code=500, detail="SUPABASE_JWT_SECRET not set")
        return jwt.decode(token, secret, algorithms=["HS256"], audience="authenticated")
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token has expired. Please log in again.")
    except jwt.InvalidTokenError as exc:
        raise HTTPException(status_code=401, detail=f"Invalid authentication token: {exc}")


def _get_role(payload: dict) -> str:
    """Extract the MedAxis role from a decoded JWT (stored in app_metadata.role)."""
    return (payload.get("app_metadata") or {}).get("role", "patient")


def create_session_token(uid: str, email: str, role: str) -> str:
    """
    Mint a short-lived (1 h) Supabase-compatible JWT.
    Used for phone-OTP login where we cannot call signInWithPassword from the backend.
    The frontend calls supabase.auth.setSession({ access_token, refresh_token: '' }).
    """
    secret = os.getenv("SUPABASE_JWT_SECRET", "")
    now = datetime.utcnow()
    payload = {
        "iss": "supabase",
        "aud": "authenticated",
        "sub": uid,
        "email": email,
        "role": "authenticated",
        "app_metadata": {"role": role},
        "user_metadata": {},
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(hours=1)).timestamp()),
        "jti": str(uuid.uuid4()),
    }
    return jwt.encode(payload, secret, algorithm="HS256")


# ─── ID Generation Helpers ────────────────────────────────────────────────────

def _random_digits(n: int) -> str:
    return "".join(random.choices(string.digits, k=n))


def _random_alphanum(n: int) -> str:
    return "".join(random.choices(string.ascii_uppercase + string.digits, k=n))


def normalize_phone(phone: str) -> str:
    if not phone:
        return ""
    digits = "".join(filter(str.isdigit, phone))
    return digits[-10:] if len(digits) >= 10 else digits


def send_sms(to_number: str, message: str):
    import socket
    from twilio.rest import Client

    old_getaddrinfo = socket.getaddrinfo
    def new_getaddrinfo(*args, **kwargs):
        responses = old_getaddrinfo(*args, **kwargs)
        return [r for r in responses if r[0] == socket.AF_INET]
    socket.getaddrinfo = new_getaddrinfo

    account_sid = os.getenv("TWILIO_ACCOUNT_SID")
    auth_token  = os.getenv("TWILIO_AUTH_TOKEN")
    from_number = os.getenv("TWILIO_PHONE_NUMBER")

    if not account_sid or not auth_token or not from_number:
        print(f"ERROR: Twilio credentials missing. Message: {message}")
        return False
    try:
        if len(to_number) == 10:
            to_number = f"+91{to_number}"
        client = Client(account_sid, auth_token, http_client=None)
        # Twilio's default HTTP client has no timeout — set one so a stuck
        # connection can't hang the worker indefinitely.
        from twilio.http.http_client import TwilioHttpClient
        client.http_client = TwilioHttpClient(timeout=10)
        msg = client.messages.create(body=message, from_=from_number, to=to_number)
        print(f"DEBUG: Twilio SMS sent. SID: {msg.sid}")
        return True
    except Exception as exc:
        import traceback
        print(f"ERROR: Twilio failed: {exc}")
        traceback.print_exc()
        return False


def send_email_otp(to_email: str, otp_code: str):
    import smtplib
    from email.mime.text import MIMEText
    from email.mime.multipart import MIMEMultipart

    sender_email    = os.getenv("EMAIL_SENDER")
    sender_password = os.getenv("EMAIL_APP_PASSWORD")
    if not sender_email or not sender_password:
        print(f"ERROR: Email credentials missing. OTP {otp_code} for {to_email} not sent.")
        return False

    message = MIMEMultipart("alternative")
    message["Subject"] = "MedAxis AI - Your Security OTP"
    message["From"]    = f"MedAxis AI <{sender_email}>"
    message["To"]      = to_email

    text = f"Your MedAxis AI security OTP is: {otp_code}\n\nThis code is valid for 5 minutes."
    html = f"""
    <html><body style="font-family:Arial,sans-serif;background:#f4f4f4;padding:20px;">
        <div style="background:#fff;padding:30px;border-radius:12px;max-width:500px;margin:auto;border:1px solid #e0e0e0;">
            <h2 style="color:#6366f1;text-align:center;">MedAxis AI Security</h2>
            <p style="font-size:1.1rem;color:#333;text-align:center;">Your one-time security code is:</p>
            <div style="background:#f0fdf4;border:2px dashed #10b981;padding:15px;text-align:center;
                        font-size:2rem;font-weight:bold;color:#059669;letter-spacing:5px;margin:20px 0;">
                {otp_code}
            </div>
            <p style="font-size:0.9rem;color:#666;text-align:center;">Valid for <b>5 minutes</b>.</p>
        </div>
    </body></html>
    """
    message.attach(MIMEText(text, "plain"))
    message.attach(MIMEText(html, "html"))
    try:
        with smtplib.SMTP_SSL("smtp.gmail.com", 465, timeout=10) as server:
            server.login(sender_email, sender_password)
            server.sendmail(sender_email, to_email, message.as_string())
        print(f"DEBUG: Email OTP sent to {to_email}")
        return True
    except Exception as exc:
        print(f"ERROR: Failed to send email OTP: {exc}")
        return False


def generate_unique_id(supabase, field: str, prefix: str, length: int, digits_only: bool = False) -> str:
    """Generate a prefixed ID unique within the users table. Retries up to 10 times."""
    col_map = {
        "healthId":    "health_id",
        "hospitalId":  "hospital_id",
        "doctorId":    "doctor_id",
        "employeeId":  "employee_id",
    }
    db_col = col_map.get(field, field)
    for _ in range(10):
        suffix    = _random_digits(length) if digits_only else _random_alphanum(length)
        candidate = f"{prefix}{suffix}"
        existing  = supabase.table("users").select("uid").eq(db_col, candidate).limit(1).execute()
        if not existing.data:
            return candidate
    raise RuntimeError(f"Could not generate a unique {field} after 10 attempts.")


# ─── Auth Dependencies ────────────────────────────────────────────────────────

def get_current_patient_uid(credentials: HTTPAuthorizationCredentials = Depends(security)) -> str:
    payload = _decode_token(credentials.credentials)
    role = _get_role(payload)
    if role != "patient":
        raise HTTPException(status_code=403, detail="Unauthorized: Only patients can access this.")
    return payload["sub"]


def get_current_doctor_uid(credentials: HTTPAuthorizationCredentials = Depends(security)) -> str:
    payload = _decode_token(credentials.credentials)
    role = _get_role(payload)
    if role != "doctor":
        raise HTTPException(status_code=403, detail="Unauthorized: Only doctors can perform this action.")
    uid = payload["sub"]

    # Verify doctor is affiliated with a hospital
    from supabase_config import get_supabase, get_user_doc
    supabase = get_supabase()
    result = supabase.table("users").select("document, hospital_id").eq("uid", uid).maybe_single().execute()
    if not result.data:
        raise HTTPException(status_code=403, detail="Doctor profile not found.")
    if not result.data.get("hospital_id"):
        raise HTTPException(
            status_code=403,
            detail="Doctor is not affiliated with any hospital. Contact your hospital admin."
        )
    return uid


def get_current_hospital_uid(credentials: HTTPAuthorizationCredentials = Depends(security)) -> str:
    payload = _decode_token(credentials.credentials)
    role = _get_role(payload)
    if role != "hospital":
        raise HTTPException(status_code=403, detail="Unauthorized: Only hospital administrators can access this.")
    return payload["sub"]


def get_current_superadmin_uid(credentials: HTTPAuthorizationCredentials = Depends(security)) -> str:
    payload = _decode_token(credentials.credentials)
    role = _get_role(payload)
    if role != "superadmin":
        raise HTTPException(status_code=403, detail="Unauthorized: Super Admin access required.")
    return payload["sub"]


def get_any_authenticated_uid(credentials: HTTPAuthorizationCredentials = Depends(security)) -> str:
    payload = _decode_token(credentials.credentials)
    return payload["sub"]


def get_authenticated_user_info(credentials: HTTPAuthorizationCredentials = Depends(security)) -> dict:
    payload = _decode_token(credentials.credentials)
    return {"uid": payload["sub"], "role": _get_role(payload)}


# ─── Shared Request Models ────────────────────────────────────────────────────

class RegisterRequest(BaseModel):
    name: str = ""
    email: str
    password: str
    role: str = "patient"
    healthId: str = ""
    employeeId: str = ""
    phoneNumber: str = ""
    profileImage: str = ""
    height: str = ""
    weight: str = ""
    bmi: str = ""


class PatientRequest(BaseModel):
    uid: str
    firstName: Optional[str] = ""
    lastName: Optional[str] = ""
    gender: Optional[str] = ""
    birthDate: Optional[str] = ""
    healthId: Optional[str] = ""


class OTPGenerateRequest(BaseModel):
    uid: str


class OTPVerifyRequest(BaseModel):
    uid: str
    otp: str


class PhoneOTPGenerateRequest(BaseModel):
    phoneNumber: str


class PhoneOTPVerifyRequest(BaseModel):
    phoneNumber: str
    otp: str


class VitalsRequest(BaseModel):
    uid: str
    height_cm: Optional[float] = None
    weight_kg: Optional[float] = None
    heartRate: Optional[float] = None
    oxygen: Optional[float] = None


class LabValues(BaseModel):
    hemoglobin: float = None
    vitaminD: float = None
    glucose: float = None


class DiagnosticReportRequest(BaseModel):
    uid: str
    labValues: LabValues


class DoctorCommentRequest(BaseModel):
    doctor_uid: str
    patient_uid: str
    report_id: str
    comment: str


class PrescriptionCommentRequest(BaseModel):
    doctor_uid: str
    patient_uid: str
    prescription_id: str
    comment: str


class RoleAssignRequest(BaseModel):
    assigner_uid: str
    target_uid: str
    role: str


class PatientAssignRequest(BaseModel):
    hospital_uid: str
    doctor_uid: str
    patient_uid: str


class PatientConsentRequest(BaseModel):
    doctor_uid: str
    granted: bool = True


class AlertResolveRequest(BaseModel):
    doctor_uid: str
    alert_id: str


class StepLogRequest(BaseModel):
    steps: int


class SyncStepsRequest(BaseModel):
    google_access_token: str


class MedicationItem(PydanticBaseModel):
    name: str
    dosage: str
    frequency: str
    duration: str


class PrescriptionRequest(PydanticBaseModel):
    patient_uid: str
    medications: List[MedicationItem]
    notes: Optional[str] = ""


class SuperAdminCreateUserRequest(BaseModel):
    name: str = ""
    email: str
    password: str
    role: str


class CreateDoctorRequest(BaseModel):
    name: str = ""
    email: str
    password: str


class DoctorProfileUpdateRequest(BaseModel):
    specialization: Optional[str] = None
    qualification: Optional[str] = None
    yearsOfExperience: Optional[int] = None
    bio: Optional[str] = None


# ─── Shared Constants ─────────────────────────────────────────────────────────

REWARD_TIERS = [
    (15000, 50),
    (10000, 25),
    (5000, 10),
]


# ─── Schema Standardization ───────────────────────────────────────────────────

def build_standard_user_doc(uid: str, role: str, email: str, name: str = "", created_by: str = "", **kwargs) -> dict:
    """
    Constructs a standardised user profile dict (Firestore-compatible camelCase).
    Does NOT write to the DB — callers are responsible for persistence.
    """
    doc = {
        "uid":              uid,
        "role":             role,
        "fullName":         name,
        "name":             name,
        "email":            email,
        "profileImage":     kwargs.get("profileImage", ""),
        "specialization":   kwargs.get("specialization", ""),
        "qualification":    kwargs.get("qualification", ""),
        "yearsOfExperience":kwargs.get("yearsOfExperience", 0),
        "bio":              kwargs.get("bio", ""),
        "createdBy":        created_by,
    }

    if role == "patient":
        doc["healthId"]  = kwargs.get("healthId", "")
        doc["firstName"] = kwargs.get("firstName", name.split(" ")[0] if name else "")
        doc["lastName"]  = kwargs.get("lastName", name.split(" ", 1)[1] if " " in name else "")
        doc["phoneNumber"] = kwargs.get("phoneNumber", "")
        doc["height"]    = kwargs.get("height", "")
        doc["weight"]    = kwargs.get("weight", "")
        doc["bmi"]       = kwargs.get("bmi", "")
    elif role == "doctor":
        doc["doctorId"]    = kwargs.get("doctorId", "")
        doc["employeeId"]  = kwargs.get("employeeId", "")
        doc["hospitalId"]  = kwargs.get("hospitalId", "")
        if "hospitalUid" in kwargs:
            doc["hospitalUid"] = kwargs["hospitalUid"]
    elif role == "hospital":
        if "hospitalId" in kwargs:
            doc["hospitalId"] = kwargs["hospitalId"]

    # Merge any additional caller-provided fields
    exclude = {"uid", "role", "fullName", "name", "email", "profileImage", "specialization",
               "qualification", "yearsOfExperience", "bio", "createdBy",
               "healthId", "firstName", "lastName", "phoneNumber", "height", "weight", "bmi",
               "doctorId", "employeeId", "hospitalId", "hospitalUid"}
    for k, v in kwargs.items():
        if k not in exclude:
            doc[k] = v

    return doc
