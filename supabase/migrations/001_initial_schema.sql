-- MedAxis AI — Supabase Schema
-- Run this in the Supabase SQL Editor after creating a new project.
-- All tables use a JSONB "document" column to mirror Firestore's document model,
-- with explicit indexed columns for the fields that are queried directly.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── Users ────────────────────────────────────────────────────────────────────
CREATE TABLE public.users (
    uid          TEXT PRIMARY KEY,          -- equals Supabase auth.users.id
    role         TEXT NOT NULL DEFAULT 'patient',
    email        TEXT NOT NULL UNIQUE,
    phone_number TEXT NOT NULL DEFAULT '',  -- denormalised for OTP lookup
    health_id    TEXT NOT NULL DEFAULT '',  -- denormalised for patient lookup
    hospital_id  TEXT NOT NULL DEFAULT '',  -- denormalised for doctor-hospital queries
    doctor_id    TEXT NOT NULL DEFAULT '',
    employee_id  TEXT NOT NULL DEFAULT '',
    hospital_uid TEXT NOT NULL DEFAULT '',
    document     JSONB NOT NULL DEFAULT '{}',  -- full profile (camelCase, Firestore-compatible)
    created_at   TIMESTAMPTZ DEFAULT NOW(),
    updated_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX ON public.users (role);
CREATE INDEX ON public.users (phone_number);
CREATE INDEX ON public.users (health_id);
CREATE INDEX ON public.users (hospital_id);

-- ─── Login OTPs ───────────────────────────────────────────────────────────────
CREATE TABLE public.login_otps (
    uid          TEXT PRIMARY KEY REFERENCES public.users(uid) ON DELETE CASCADE,
    otp          TEXT NOT NULL,
    expires_at   TIMESTAMPTZ NOT NULL,
    phone_number TEXT NOT NULL DEFAULT '',
    created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ─── FHIR Patients ───────────────────────────────────────────────────────────
CREATE TABLE public.fhir_patients (
    user_id    TEXT PRIMARY KEY REFERENCES public.users(uid) ON DELETE CASCADE,
    document   JSONB NOT NULL DEFAULT '{}',
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── FHIR Observations (vitals sub-collection flattened) ─────────────────────
CREATE TABLE public.fhir_observations (
    id              TEXT NOT NULL,
    user_id         TEXT NOT NULL REFERENCES public.users(uid) ON DELETE CASCADE,
    collection_type TEXT NOT NULL DEFAULT 'vitals',
    document        JSONB NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_id, id, collection_type)
);
CREATE INDEX ON public.fhir_observations (user_id);

-- ─── FHIR Reports (reports + observations sub-collections flattened) ──────────
CREATE TABLE public.fhir_reports (
    id              TEXT NOT NULL,
    user_id         TEXT NOT NULL REFERENCES public.users(uid) ON DELETE CASCADE,
    collection_type TEXT NOT NULL DEFAULT 'reports',
    document        JSONB NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_id, id, collection_type)
);
CREATE INDEX ON public.fhir_reports (user_id);
CREATE INDEX ON public.fhir_reports (collection_type);
CREATE INDEX ON public.fhir_reports (created_at DESC);

-- ─── FHIR Prescriptions ───────────────────────────────────────────────────────
CREATE TABLE public.fhir_prescriptions (
    id         TEXT NOT NULL,
    user_id    TEXT NOT NULL REFERENCES public.users(uid) ON DELETE CASCADE,
    document   JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_id, id)
);
CREATE INDEX ON public.fhir_prescriptions (user_id);
CREATE INDEX ON public.fhir_prescriptions (created_at DESC);

-- ─── Consents ─────────────────────────────────────────────────────────────────
CREATE TABLE public.consents (
    patient_uid TEXT NOT NULL REFERENCES public.users(uid) ON DELETE CASCADE,
    doctor_uid  TEXT NOT NULL REFERENCES public.users(uid) ON DELETE CASCADE,
    granted     BOOLEAN NOT NULL DEFAULT FALSE,
    timestamp   TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (patient_uid, doctor_uid)
);
CREATE INDEX ON public.consents (doctor_uid);

-- ─── High-Risk Alerts ─────────────────────────────────────────────────────────
CREATE TABLE public.alerts (
    id          TEXT PRIMARY KEY,
    patient_uid TEXT NOT NULL REFERENCES public.users(uid) ON DELETE CASCADE,
    report_id   TEXT NOT NULL DEFAULT '',
    risk_level  TEXT NOT NULL DEFAULT 'High',
    status      TEXT NOT NULL DEFAULT 'unresolved',
    resolved_at TIMESTAMPTZ,
    resolved_by TEXT NOT NULL DEFAULT '',
    document    JSONB NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX ON public.alerts (status);
CREATE INDEX ON public.alerts (patient_uid);

-- ─── Audit Logs ───────────────────────────────────────────────────────────────
CREATE TABLE public.audit_logs (
    id        TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    action    TEXT NOT NULL DEFAULT '',
    document  JSONB NOT NULL DEFAULT '{}',
    timestamp TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX ON public.audit_logs (timestamp DESC);

-- ─── Step Rewards ─────────────────────────────────────────────────────────────
CREATE TABLE public.step_rewards (
    user_id         TEXT PRIMARY KEY REFERENCES public.users(uid) ON DELETE CASCADE,
    daily_steps     JSONB NOT NULL DEFAULT '{}',
    total_points    INTEGER NOT NULL DEFAULT 0,
    rewards_claimed JSONB NOT NULL DEFAULT '[]',
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Doctor Assignments ───────────────────────────────────────────────────────
CREATE TABLE public.doctor_assignments (
    doctor_uid  TEXT NOT NULL REFERENCES public.users(uid) ON DELETE CASCADE,
    patient_uid TEXT NOT NULL REFERENCES public.users(uid) ON DELETE CASCADE,
    assigned_by TEXT NOT NULL DEFAULT '',
    status      TEXT NOT NULL DEFAULT 'active',
    assigned_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (doctor_uid, patient_uid)
);
CREATE INDEX ON public.doctor_assignments (doctor_uid);
CREATE INDEX ON public.doctor_assignments (status);

-- ─── Family Members ───────────────────────────────────────────────────────────
CREATE TABLE public.family_members (
    id          TEXT PRIMARY KEY,
    patient_uid TEXT NOT NULL REFERENCES public.users(uid) ON DELETE CASCADE,
    document    JSONB NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX ON public.family_members (patient_uid);

-- ─── Family Prescriptions ─────────────────────────────────────────────────────
CREATE TABLE public.family_prescriptions (
    id          TEXT PRIMARY KEY,
    member_id   TEXT NOT NULL REFERENCES public.family_members(id) ON DELETE CASCADE,
    patient_uid TEXT NOT NULL REFERENCES public.users(uid) ON DELETE CASCADE,
    document    JSONB NOT NULL DEFAULT '{}',
    uploaded_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX ON public.family_prescriptions (member_id);

-- ─── Disable RLS (backend uses service_role key — bypasses RLS) ───────────────
ALTER TABLE public.users               DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.login_otps          DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.fhir_patients       DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.fhir_observations   DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.fhir_reports        DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.fhir_prescriptions  DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.consents            DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.alerts              DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs          DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.step_rewards        DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.doctor_assignments  DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.family_members      DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.family_prescriptions DISABLE ROW LEVEL SECURITY;
