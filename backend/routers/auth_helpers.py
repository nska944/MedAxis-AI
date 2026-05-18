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


def _build_otp_email(to_email: str, otp_code: str, sender_email: str):
    """Build the MIME multipart email body."""
    from email.mime.text import MIMEText
    from email.mime.multipart import MIMEMultipart

    message = MIMEMultipart("alternative")
    message["Subject"] = "MedAxis AI - Your Security OTP"
    message["From"]    = f"MedAxis AI <{sender_email}>"
    message["To"]      = to_email

    text = f"Your MedAxis AI security OTP is: {otp_code}\n\nThis code is valid for 5 minutes."
    html = f"""
    <html><body style="font-family:Arial,sans-serif;background:#f4f4f4;padding:20px;">
        <div style="background:#fff;padding:30px;border-radius:12px;max-width:500px;margin:auto;border:1px solid #e0e0e0;">
            <h2 style="color:#5B6F49;text-align:center;font-family:Georgia,serif;font-weight:400;">MedAxis</h2>
            <p style="font-size:1rem;color:#333;text-align:center;">Your one-time security code:</p>
            <div style="background:#FBF9F4;border:1px dashed #5B6F49;padding:18px;text-align:center;
                        font-size:2rem;font-weight:bold;color:#3F4F33;letter-spacing:6px;margin:20px 0;">
                {otp_code}
            </div>
            <p style="font-size:0.85rem;color:#666;text-align:center;">Valid for <b>5 minutes</b>.</p>
            <p style="font-size:0.75rem;color:#999;text-align:center;margin-top:1.5rem;">If you didn't request this, ignore this email.</p>
        </div>
    </body></html>
    """
    message.attach(MIMEText(text, "plain"))
    message.attach(MIMEText(html, "html"))
    return message, text, html


def _send_via_resend(to_email: str, otp_code: str) -> tuple[bool, str] | None:
    """
    Send via Resend HTTPS API. Works on Render free tier (SMTP is blocked).
    Returns None if RESEND_API_KEY isn't set so caller can fall back to SMTP.
    """
    import requests
    api_key  = os.getenv("RESEND_API_KEY")
    if not api_key:
        return None
    sender   = os.getenv("RESEND_FROM") or os.getenv("EMAIL_SENDER") or "onboarding@resend.dev"
    _, text, html = _build_otp_email(to_email, otp_code, sender)
    try:
        resp = requests.post(
            "https://api.resend.com/emails",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={
                "from":    f"MedAxis AI <{sender}>",
                "to":      [to_email],
                "subject": "MedAxis AI - Your Security OTP",
                "html":    html,
                "text":    text,
            },
            timeout=15,
        )
        if resp.status_code in (200, 202):
            return (True, f"Email OTP sent to {to_email} via Resend (id={resp.json().get('id','?')})")
        return (False, f"Resend rejected request: HTTP {resp.status_code} — {resp.text[:200]}")
    except Exception as exc:
        return (False, f"Resend call failed: {type(exc).__name__}: {exc}")


def send_email_otp(to_email: str, otp_code: str) -> tuple[bool, str]:
    """
    Send an OTP email. Prefers Resend (HTTPS API) since Render Free blocks SMTP;
    falls back to Gmail SMTP if RESEND_API_KEY isn't set.
    """
    # 1. Try Resend (HTTPS — works on Render free)
    resend_result = _send_via_resend(to_email, otp_code)
    if resend_result is not None:
        ok, message = resend_result
        print(f"{'DEBUG' if ok else 'ERROR'}: {message}")
        return resend_result

    # 2. Fall back to Gmail SMTP (works locally, not on Render free)
    import smtplib
    sender_email    = os.getenv("EMAIL_SENDER")
    sender_password = os.getenv("EMAIL_APP_PASSWORD")
    if not sender_email or not sender_password:
        msg = f"No email backend configured. Set RESEND_API_KEY (recommended) or EMAIL_SENDER+EMAIL_APP_PASSWORD. OTP {otp_code} for {to_email} NOT sent."
        print(f"ERROR: {msg}")
        return (False, msg)

    message, _, _ = _build_otp_email(to_email, otp_code, sender_email)
    try:
        with smtplib.SMTP_SSL("smtp.gmail.com", 465, timeout=15) as server:
            server.login(sender_email, sender_password)
            server.sendmail(sender_email, to_email, message.as_string())
        ok_msg = f"Email OTP sent to {to_email} from {sender_email}"
        print(f"DEBUG: {ok_msg}")
        return (True, ok_msg)
    except smtplib.SMTPAuthenticationError as exc:
        err = f"Gmail SMTP auth failed for {sender_email} — check EMAIL_APP_PASSWORD (must be a 16-char Gmail App Password, not your login password). Detail: {exc}"
        print(f"ERROR: {err}")
        return (False, err)
    except Exception as exc:
        err = f"Failed to send email OTP to {to_email}: {type(exc).__name__}: {exc}"
        print(f"ERROR: {err}")
        return (False, err)


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
