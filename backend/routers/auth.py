from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from supabase_config import get_supabase


class LoginRequest(BaseModel):
    email: str
    password: str


router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login")
def login_with_email_password(req: LoginRequest):
    """
    Server-side email/password verification via Supabase Auth.
    Kept for backward-compatibility — the frontend now signs in directly
    via supabase.auth.signInWithPassword().
    """
    supabase = get_supabase()
    try:
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
