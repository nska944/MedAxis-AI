import React, { useState, useEffect } from 'react';
import { supabase } from '../supabase/supabaseClient';
import { useAuth } from '../context/AuthContext';
import { useNavigate, Link } from 'react-router-dom';
import { HeartPulse, CheckCircle, Camera, ShieldCheck } from 'lucide-react';
import * as faceapi from 'face-api.js';
import Webcam from 'react-webcam';

const Login = () => {
    const [email, setEmail]       = useState('');
    const [password, setPassword] = useState('');
    const [error, setError]       = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

    const { userRole, currentUser, loading, patientAuthStep, setPatientAuthStep } = useAuth();

    const [authStep, setAuthStepLocal] = useState(1);
    const setAuthStep = (step) => { setAuthStepLocal(step); setPatientAuthStep(step); };

    const navigate = useNavigate();
    const [selectedRole, setSelectedRole]             = useState(null);
    const [patientUid, setPatientUid]                 = useState(null);
    const [storedFaceDescriptor, setStoredFaceDescriptor] = useState(null);
    const [modelsLoaded, setModelsLoaded]             = useState(false);
    const webcamRef = React.useRef(null);

    const [loginMethod, setLoginMethod] = useState('email');
    const [phoneNumber, setPhoneNumber] = useState('');
    const [otp, setOtp]                 = useState('');
    const [isOtpSent, setIsOtpSent]     = useState(false);
    const [resendTimer, setResendTimer] = useState(0);

    // Redirect once fully authenticated
    useEffect(() => {
        if (!loading && currentUser && userRole) {
            if (userRole === 'patient') {
                if (authStep === 4) navigate(`/dashboard/${userRole}`);
            } else {
                navigate(`/dashboard/${userRole}`);
            }
        }
    }, [currentUser, userRole, loading, navigate, authStep]);

    // Load Face-API models for step 3
    useEffect(() => {
        const loadModels = async () => {
            try {
                const MODEL_URL = 'https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@master/weights';
                await Promise.all([
                    faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL),
                    faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
                    faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
                ]);
                setModelsLoaded(true);
            } catch (err) {
                setError(`Failed to load face models: ${err.message || 'Network Error'}`);
            }
        };
        if (authStep === 3 && !modelsLoaded) loadModels();
    }, [authStep, modelsLoaded]);

    // Resend timer
    useEffect(() => {
        if (resendTimer <= 0) return;
        const id = setInterval(() => setResendTimer(t => t - 1), 1000);
        return () => clearInterval(id);
    }, [resendTimer]);

    // ── Email / Password Login (Layer 1) ──────────────────────────────────────
    const handleLogin = async (e) => {
        e.preventDefault();
        setError('');
        setIsSubmitting(true);
        try {
            const { data, error: authError } = await supabase.auth.signInWithPassword({ email, password });
            if (authError) throw new Error(authError.message);

            const user = data.user;
            const role = user.app_metadata?.role || 'patient';
            setSelectedRole(role);

            if (role === 'patient') {
                // Fetch face data from backend
                const token = data.session.access_token;
                setPatientUid(user.id);
                const meRes = await fetch(`${API_BASE_URL}/patient/me`, {
                    headers: { 'Authorization': `Bearer ${token}` },
                });
                if (meRes.ok) {
                    const meData = await meRes.json();
                    setStoredFaceDescriptor(meData.faceData || null);
                }
                await generateBackendOTP(user.id, token);
                setAuthStep(2);
            } else {
                setAuthStep(4);
            }
        } catch (err) {
            setError(err.message);
        } finally {
            setIsSubmitting(false);
        }
    };

    const generateBackendOTP = async (uid, token, resend = false) => {
        const res = await fetch(`${API_BASE_URL}/patient/generate-otp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ uid }),
        });
        if (!resend) setResendTimer(30);
        if (!res.ok) {
            const d = await res.json();
            throw new Error(d.detail || 'Failed to generate OTP');
        }
    };

    const handleVerifyBackendOTP = async (e) => {
        e.preventDefault();
        if (!otp) return;
        setError('');
        setIsSubmitting(true);
        try {
            const { data: { session } } = await supabase.auth.getSession();
            const token = session?.access_token;
            const res = await fetch(`${API_BASE_URL}/patient/verify-otp`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ uid: patientUid, otp }),
            });
            if (!res.ok) {
                const d = await res.json();
                throw new Error(d.detail || 'Invalid OTP');
            }
            setAuthStep(3);
        } catch (err) {
            setError(err.message);
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleFaceAuthentication = async () => {
        if (!webcamRef.current) return;
        setError('');
        setIsSubmitting(true);
        try {
            const video = webcamRef.current.video;
            const detection = await faceapi.detectSingleFace(video).withFaceLandmarks().withFaceDescriptor();
            if (!detection) throw new Error('Could not detect a face. Ensure good lighting and look at the camera.');

            if (storedFaceDescriptor) {
                const stored   = new Float32Array(storedFaceDescriptor);
                const distance = faceapi.euclideanDistance(stored, detection.descriptor);
                if (distance < 0.5) {
                    setAuthStep(4);
                } else {
                    throw new Error(`Face match failed (similarity: ${((1 - distance) * 100).toFixed(0)}%). Please try again.`);
                }
            } else {
                // First login — save face descriptor
                const { data: { session } } = await supabase.auth.getSession();
                const token      = session?.access_token;
                const descriptor = Array.from(detection.descriptor);
                await fetch(`${API_BASE_URL}/patient/face-data`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                    body: JSON.stringify({ faceData: descriptor }),
                });
                setStoredFaceDescriptor(descriptor);
                setAuthStep(4);
            }
        } catch (err) {
            setError(err.message);
        } finally {
            setIsSubmitting(false);
        }
    };

    // ── Google Login ──────────────────────────────────────────────────────────
    const handleGoogleLogin = async () => {
        setError('');
        setIsSubmitting(true);
        try {
            const { error: oauthError } = await supabase.auth.signInWithOAuth({
                provider: 'google',
                options: {
                    redirectTo: window.location.origin,
                    scopes: 'https://www.googleapis.com/auth/fitness.activity.read',
                },
            });
            if (oauthError) throw new Error(oauthError.message);
            // Redirect handled by Supabase; onAuthStateChange fires on return
        } catch (err) {
            setError(err.message);
            setIsSubmitting(false);
        }
    };

    // ── Phone OTP Login ───────────────────────────────────────────────────────
    const handleSendOtp = async (e) => {
        e.preventDefault();
        setError('');
        setIsSubmitting(true);
        try {
            const formatted = phoneNumber.startsWith('+') ? phoneNumber : `+91${phoneNumber}`;
            const res = await fetch(`${API_BASE_URL}/auth/phone/generate-otp`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phoneNumber: formatted }),
            });
            const d = await res.json();
            if (!res.ok) throw new Error(d.detail || 'Failed to send OTP');
            setIsOtpSent(true);
            setResendTimer(30);
        } catch (err) {
            setError(err.message);
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleVerifyOtp = async (e) => {
        e.preventDefault();
        if (!otp) return;
        setError('');
        setIsSubmitting(true);
        try {
            const formatted = phoneNumber.startsWith('+') ? phoneNumber : `+91${phoneNumber}`;
            const res = await fetch(`${API_BASE_URL}/auth/phone/verify-otp`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phoneNumber: formatted, otp }),
            });
            const d = await res.json();
            if (!res.ok) throw new Error(d.detail || 'Invalid OTP');

            // Backend mints a Supabase-compatible JWT — set it as the session
            await supabase.auth.setSession({ access_token: d.access_token, refresh_token: '' });
            const role = d.role;
            setSelectedRole(role);

            if (role === 'patient') {
                const meRes = await fetch(`${API_BASE_URL}/patient/me`, {
                    headers: { 'Authorization': `Bearer ${d.access_token}` },
                });
                if (meRes.ok) {
                    const meData = await meRes.json();
                    setStoredFaceDescriptor(meData.faceData || null);
                }
                setPatientUid(d.uid);
                await generateBackendOTP(d.uid, d.access_token);
                setAuthStep(2);
            } else {
                setAuthStep(4);
            }
        } catch (err) {
            setError(err.message);
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="auth-container">
            <div className="auth-form-wrapper glass-panel">
                <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1rem' }}>
                    <img src="/logo.png" alt="MedAxis AI Logo" style={{ height: '56px', objectFit: 'contain' }} />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
                    {authStep > 1 && (
                        <button type="button" onClick={() => { setAuthStep(1); setError(''); }}
                            style={{ position: 'absolute', left: 0, background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.9rem', padding: '0.5rem 0' }}>
                            &larr; Back
                        </button>
                    )}
                    <h1 className="auth-title" style={{ margin: 0, marginTop: '0.5rem' }}>Welcome Back</h1>
                </div>
                <p className="auth-subtitle" style={{ marginTop: '0.5rem' }}>
                    {authStep === 1 ? 'Sign in to MedAxis AI' : `Log in as ${selectedRole?.charAt(0).toUpperCase() + selectedRole?.slice(1)}`}
                </p>

                {error && <div className="error-msg">{error}</div>}
                <div id="recaptcha-container"></div>

                {/* STEP 1 — email / phone */}
                {authStep === 1 && (
                    <>
                        {/* Login method tabs */}
                        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem' }}>
                            {['email', 'phone'].map(m => (
                                <button key={m} type="button"
                                    onClick={() => { setLoginMethod(m); setError(''); }}
                                    style={{ flex: 1, padding: '0.6rem', borderRadius: '8px', border: '1px solid var(--border-color)',
                                             background: loginMethod === m ? 'var(--primary)' : 'transparent',
                                             color: loginMethod === m ? '#fff' : 'var(--text-muted)', cursor: 'pointer', fontWeight: 600 }}>
                                    {m.charAt(0).toUpperCase() + m.slice(1)}
                                </button>
                            ))}
                        </div>

                        {loginMethod === 'email' && (
                            <form onSubmit={handleLogin}>
                                <div className="form-group">
                                    <label className="form-label">Email Address</label>
                                    <input type="email" className="form-input" value={email} onChange={e => setEmail(e.target.value)} required placeholder="doctor@medaxis.ai" />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Password</label>
                                    <input type="password" className="form-input" value={password} onChange={e => setPassword(e.target.value)} required placeholder="••••••••" />
                                </div>
                                <button type="submit" className="btn-primary" disabled={isSubmitting} style={{ marginTop: '0.5rem' }}>
                                    {isSubmitting ? <span className="loader"></span> : 'Sign In'}
                                </button>
                                <div style={{ margin: '1.5rem 0', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                                    <div style={{ flex: 1, height: '1px', background: 'var(--border-color)' }}></div>
                                    <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>OR</span>
                                    <div style={{ flex: 1, height: '1px', background: 'var(--border-color)' }}></div>
                                </div>
                                <button type="button" onClick={handleGoogleLogin} disabled={isSubmitting}
                                    style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', background: 'white', color: '#1f2937',
                                             border: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                             gap: '0.5rem', fontWeight: 600, cursor: 'pointer' }}>
                                    <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" style={{ width: '18px' }} />
                                    Continue with Google
                                </button>
                            </form>
                        )}

                        {loginMethod === 'phone' && (
                            <div>
                                {!isOtpSent ? (
                                    <form onSubmit={handleSendOtp}>
                                        <div className="form-group">
                                            <label className="form-label">Phone Number</label>
                                            <input type="tel" className="form-input" value={phoneNumber} onChange={e => setPhoneNumber(e.target.value)} required placeholder="+91 99999 99999" />
                                            <small style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: '0.25rem', display: 'block' }}>Include country code (e.g. +91)</small>
                                        </div>
                                        <button type="submit" className="btn-primary" disabled={isSubmitting}>
                                            {isSubmitting ? <span className="loader"></span> : 'Send Verification Code'}
                                        </button>
                                    </form>
                                ) : (
                                    <form onSubmit={handleVerifyOtp}>
                                        <div style={{ color: '#10b981', display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem', fontSize: '0.9rem' }}>
                                            <CheckCircle size={16} /> Code sent to {phoneNumber}
                                        </div>
                                        <div className="form-group">
                                            <label className="form-label">6-Digit Code</label>
                                            <input type="text" className="form-input" value={otp} onChange={e => setOtp(e.target.value)} required placeholder="123456" maxLength={6}
                                                style={{ letterSpacing: '4px', textAlign: 'center', fontSize: '1.2rem', fontWeight: 600 }} />
                                        </div>
                                        <button type="submit" className="btn-primary" disabled={isSubmitting}>
                                            {isSubmitting ? <span className="loader"></span> : 'Verify & Log In'}
                                        </button>
                                        <button type="button" onClick={() => setIsOtpSent(false)}
                                            style={{ background: 'none', border: 'none', color: 'var(--primary)', width: '100%', marginTop: '1rem', cursor: 'pointer', fontSize: '0.9rem' }}>
                                            Change Phone Number
                                        </button>
                                        <div style={{ textAlign: 'center', marginTop: '1rem' }}>
                                            {resendTimer > 0 ? (
                                                <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Resend in {resendTimer}s</span>
                                            ) : (
                                                <button type="button" onClick={handleSendOtp}
                                                    style={{ background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600 }}>
                                                    Resend Code
                                                </button>
                                            )}
                                        </div>
                                    </form>
                                )}
                            </div>
                        )}
                    </>
                )}

                {/* STEP 2 — OTP (patient layer 2) */}
                {authStep === 2 && (
                    <form onSubmit={handleVerifyBackendOTP}>
                        <div style={{ color: '#10b981', display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem', fontSize: '0.9rem' }}>
                            <ShieldCheck size={16} /> Layer 1 Passed. Enter Security PIN.
                        </div>
                        <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
                            A security OTP has been sent to your registered phone/email.
                        </p>
                        <div className="form-group">
                            <label className="form-label">6-Digit OTP</label>
                            <input type="text" className="form-input" value={otp} onChange={e => setOtp(e.target.value)} required placeholder="123456" maxLength={6}
                                style={{ letterSpacing: '4px', textAlign: 'center', fontSize: '1.2rem', fontWeight: 600 }} />
                        </div>
                        <button type="submit" className="btn-primary" disabled={isSubmitting}>
                            {isSubmitting ? <span className="loader"></span> : 'Verify PIN'}
                        </button>
                        <div style={{ textAlign: 'center', marginTop: '1.5rem' }}>
                            {resendTimer > 0 ? (
                                <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Resend PIN in {resendTimer}s</span>
                            ) : (
                                <button type="button" onClick={async () => {
                                    const { data: { session } } = await supabase.auth.getSession();
                                    await generateBackendOTP(patientUid, session?.access_token, true);
                                    setResendTimer(30);
                                }} style={{ background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600 }}>
                                    Resend Security PIN
                                </button>
                            )}
                        </div>
                    </form>
                )}

                {/* STEP 3 — Face Auth (patient layer 3) */}
                {authStep === 3 && (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                        <div style={{ color: '#f59e0b', display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem', fontSize: '0.9rem' }}>
                            <Camera size={16} /> Layer 2 Passed. Final Step: Face Login.
                        </div>
                        <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '1rem', textAlign: 'center' }}>
                            {storedFaceDescriptor ? 'Look straight into the camera to verify your identity.' : 'First login: register your face for future logins.'}
                        </p>
                        {!modelsLoaded ? (
                            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                                <span className="loader" style={{ borderColor: 'var(--primary)', borderBottomColor: 'transparent', width: '32px', height: '32px', marginBottom: '1rem' }}></span>
                                <p>Loading Deep Learning Models...</p>
                            </div>
                        ) : (
                            <>
                                <div style={{ borderRadius: '12px', overflow: 'hidden', border: '3px solid var(--primary)', marginBottom: '1rem', background: '#000', width: '100%', maxWidth: '300px', aspectRatio: '4/3' }}>
                                    <Webcam audio={false} ref={webcamRef} screenshotFormat="image/jpeg"
                                        videoConstraints={{ facingMode: 'user' }}
                                        style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                </div>
                                <button onClick={handleFaceAuthentication} className="btn-primary" disabled={isSubmitting} style={{ width: '100%' }}>
                                    {isSubmitting ? <span className="loader"></span> : (storedFaceDescriptor ? 'Verify Face' : 'Register & Log In')}
                                </button>
                            </>
                        )}
                    </div>
                )}

                <p style={{ textAlign: 'center', marginTop: '1.5rem', color: 'var(--text-muted)' }}>
                    Don't have an account? <Link to="/register" className="link">Create one</Link>
                </p>
            </div>

            <footer style={{ marginTop: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                <div style={{ marginBottom: '0.5rem', color: 'var(--text-dim)', fontSize: '0.8rem' }}>
                    Created by Preethi M, Vinuthashree Gowd &amp; Yashavanthagowda R G — BNM Institute of Technology
                </div>
                By logging in, you agree to our <Link to="/privacy" style={{ color: 'var(--primary)', textDecoration: 'underline' }}>Privacy Policy</Link>
            </footer>
        </div>
    );
};

export default Login;
