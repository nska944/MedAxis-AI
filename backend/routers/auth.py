from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel
import random
import os
from datetime import datetime, timedelta

from supabase_config import get_supabase
from routers.auth_helpers import (
    PhoneOTPGenerateRequest,
    PhoneOTPVerifyRequest,
    normalize_phone,
    send_sms,
    send_email_otp,
    create_session_token,
)


class LoginRequest(BaseModel):
    email: str
    password: str


router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login")
def login_with_email_password(req: LoginRequest):
    """
    Validates email/password against Supabase Auth and returns a session token.
    The frontend can also call supabase.auth.signInWithPassword() directly —
    this endpoint exists for backward-compatibility and server-side validation.
    """
    supabase = get_supabase()
    try:
        # Supabase Auth sign-in (validates hashed password stored in Supabase Auth)
        response = supabase.auth.sign_in_with_password({"email": req.email, "password": req.password})
        user     = response.user
        session  = response.session
        if not user or not session:
            raise HTTPException(status_code=401, detail="Invalid email or password.")

        role = (user.app_metadata or {}).get("role", "patient")
        return {
            "success":      True,
            "access_token": session.access_token,
            "uid":          user.id,
            "role":         role,
        }
    except HTTPException:
        raise
    except Exception as exc:
        msg = str(exc)
        if "Invalid login credentials" in msg or "invalid_credentials" in msg:
            raise HTTPException(status_code=401, detail="Invalid email or password.")
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/phone/generate-otp")
def generate_phone_otp(req: PhoneOTPGenerateRequest, background_tasks: BackgroundTasks):
    """Look up user by phone, generate OTP, return immediately, dispatch SMS + email in background."""
    supabase = get_supabase()
    try:
        normalized = normalize_phone(req.phoneNumber)
        result = supabase.table("users").select("uid, email, document").eq("phone_number", normalized).limit(1).execute()
        if not result.data:
            raise HTTPException(status_code=404, detail="User with this phone number not found.")

        row       = result.data[0]
        uid       = row["uid"]
        user_data = row.get("document") or {}

        otp_code   = str(random.randint(100000, 999999))
        expires_at = (datetime.utcnow() + timedelta(minutes=5)).isoformat()

        supabase.table("login_otps").upsert({
            "uid":          uid,
            "otp":          otp_code,
            "expires_at":   expires_at,
            "phone_number": req.phoneNumber,
        }).execute()

        msg = f"Your MedAxis AI OTP is: {otp_code}. Valid for 5 minutes."
        if len(normalized) >= 10:
            background_tasks.add_task(send_sms, normalized, msg)
        user_email = row.get("email") or user_data.get("email")
        if user_email:
            background_tasks.add_task(send_email_otp, user_email, otp_code)

        return {"message": "OTP sent successfully", "success": True}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/phone/verify-otp")
def verify_phone_otp(req: PhoneOTPVerifyRequest):
    """Verify phone OTP, delete it, return a session token."""
    supabase = get_supabase()
    try:
        normalized = normalize_phone(req.phoneNumber)
        user_result = supabase.table("users").select("uid, email, role, document").eq("phone_number", normalized).limit(1).execute()
        if not user_result.data:
            raise HTTPException(status_code=404, detail="User not found.")

        row  = user_result.data[0]
        uid  = row["uid"]
        role = row.get("role", "patient")
        email = row.get("email", "")

        otp_result = supabase.table("login_otps").select("*").eq("uid", uid).maybe_single().execute()
        if not otp_result.data:
            raise HTTPException(status_code=400, detail="No active OTP found. Please request a new one.")

        otp_data   = otp_result.data
        expires_at = otp_data.get("expires_at", "")
        if isinstance(expires_at, str):
            expires_dt = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
        else:
            expires_dt = expires_at

        if datetime.utcnow().timestamp() > expires_dt.timestamp():
            supabase.table("login_otps").delete().eq("uid", uid).execute()
            raise HTTPException(status_code=400, detail="OTP expired.")

        if otp_data.get("otp") != req.otp:
            raise HTTPException(status_code=400, detail="Invalid OTP code.")

        supabase.table("login_otps").delete().eq("uid", uid).execute()

        # Mint a Supabase-compatible JWT for the frontend
        access_token = create_session_token(uid, email, role)
        return {
            "success":      True,
            "access_token": access_token,
            "uid":          uid,
            "role":         role,
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
