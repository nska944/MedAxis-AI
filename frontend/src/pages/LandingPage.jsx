import React, { useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, ArrowUpRight } from 'lucide-react';

export const LandingPage = () => {
    const navigate = useNavigate();
    const fadeRefs = useRef([]);

    // Subtle fade-in-on-scroll for the editorial feel
    useEffect(() => {
        const io = new IntersectionObserver(
            (entries) => entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('is-in'); }),
            { threshold: 0.12, rootMargin: '0px 0px -60px 0px' }
        );
        fadeRefs.current.forEach(el => el && io.observe(el));
        return () => io.disconnect();
    }, []);

    const addRef = (el) => { if (el && !fadeRefs.current.includes(el)) fadeRefs.current.push(el); };

    return (
        <div style={{ minHeight: '100vh', background: 'var(--bg-app)', color: 'var(--ink)' }}>
            <style>{`
                .fade-up { opacity: 0; transform: translateY(20px); transition: opacity 800ms ease, transform 800ms cubic-bezier(0.2,0,0,1); }
                .fade-up.is-in { opacity: 1; transform: translateY(0); }
                .underline-grow { position: relative; }
                .underline-grow::after {
                    content: ''; position: absolute; left: 0; bottom: -4px;
                    height: 1px; width: 100%; background: var(--ink);
                    transform: scaleX(0); transform-origin: left; transition: transform 500ms cubic-bezier(0.2,0,0,1);
                }
                .underline-grow:hover::after { transform: scaleX(1); }
                .pill-link { display: inline-flex; align-items: center; gap: 0.4rem; padding: 0.45rem 0.95rem;
                    border: 1px solid var(--line-strong); border-radius: 999px; font-size: 0.82rem;
                    color: var(--ink-secondary); background: var(--bg-paper); transition: var(--transition); }
                .pill-link:hover { border-color: var(--ink); color: var(--ink); }
                .mark-dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: var(--sage); margin: 0 0.4rem 0.18rem 0; vertical-align: middle; }
                .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 5rem; align-items: start; }
                @media (max-width: 900px) { .grid-2 { grid-template-columns: 1fr; gap: 2.5rem; } }
                .num { font-family: 'Fraunces', serif; font-variation-settings: 'opsz' 144, 'SOFT' 30; font-weight: 400; font-size: 3.2rem; letter-spacing: -0.04em; line-height: 1; color: var(--ink); }
                .hero-display {
                    font-family: 'Fraunces', serif;
                    font-variation-settings: 'opsz' 144, 'SOFT' 40;
                    font-weight: 360;
                    font-size: clamp(2.6rem, 6.5vw, 5rem);
                    line-height: 1.02;
                    letter-spacing: -0.038em;
                    color: var(--ink);
                }
                .hero-display em {
                    font-style: italic;
                    font-variation-settings: 'opsz' 18, 'SOFT' 80;
                    color: var(--sage-deep);
                }
                .quote-rule { border-left: 2px solid var(--sage); padding-left: 1.25rem; }
                .feature-row { display: grid; grid-template-columns: 0.5fr 0.4fr 1fr; gap: 2rem;
                    padding: 2.5rem 0; border-top: 1px solid var(--line); align-items: start; }
                @media (max-width: 700px) { .feature-row { grid-template-columns: 1fr; gap: 0.75rem; padding: 1.75rem 0; } }
                .feature-row .feature-num { font-family: 'IBM Plex Mono', monospace; font-size: 0.78rem; color: var(--ink-dim); letter-spacing: 0.04em; }
                .feature-row h3 { font-size: 1.4rem; }
                .feature-row p { color: var(--ink-secondary); font-size: 0.98rem; line-height: 1.6; max-width: 36ch; }
            `}</style>

            {/* ── Header ─────────────────────────────────────────────────── */}
            <header style={{
                padding: '1.5rem 2.5rem',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                borderBottom: '1px solid var(--line)',
                background: 'var(--bg-app)',
                position: 'sticky', top: 0, zIndex: 50,
            }}>
                <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: '0.7rem', textDecoration: 'none', color: 'var(--ink)' }}>
                    <span className="mark-dot" style={{ width: '8px', height: '8px', margin: 0 }}></span>
                    <span style={{ fontFamily: 'Fraunces, serif', fontVariationSettings: '"opsz" 18, "SOFT" 30', fontSize: '1.15rem', fontWeight: 500, letterSpacing: '-0.02em' }}>
                        MedAxis
                    </span>
                </Link>
                <nav style={{ display: 'flex', gap: '2rem', alignItems: 'center' }}>
                    <Link to="/privacy" className="underline-grow" style={{ color: 'var(--ink-secondary)', textDecoration: 'none', fontSize: '0.92rem' }}>Privacy</Link>
                    <Link to="/terms-of-service" className="underline-grow" style={{ color: 'var(--ink-secondary)', textDecoration: 'none', fontSize: '0.92rem' }}>Terms</Link>
                    <button
                        onClick={() => navigate('/login')}
                        className="underline-grow"
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink)', fontSize: '0.92rem', fontWeight: 500, padding: 0 }}
                    >Sign in</button>
                    <button onClick={() => navigate('/register')} className="btn-primary" style={{ width: 'auto', padding: '0.55rem 1.1rem', fontSize: '0.88rem' }}>
                        Create account
                    </button>
                </nav>
            </header>

            {/* ── Hero ───────────────────────────────────────────────────── */}
            <section style={{ padding: '8rem 2.5rem 6rem', maxWidth: '1280px', margin: '0 auto' }}>
                <div className="fade-up is-in" style={{ marginBottom: '1.5rem' }}>
                    <span className="pill-link" style={{ cursor: 'default' }}>
                        <span className="mark-dot"></span>
                        New · AI-assisted blood report analysis
                    </span>
                </div>

                <h1 className="hero-display fade-up is-in" style={{ maxWidth: '20ch' }}>
                    A modern medical record,<br/>
                    built <em>patient-first.</em>
                </h1>

                <div className="fade-up is-in" style={{ marginTop: '2.25rem', maxWidth: '46ch' }}>
                    <p style={{ fontSize: '1.18rem', lineHeight: 1.55, color: 'var(--ink-secondary)', margin: 0 }}>
                        Upload a blood report. Get a clinical read in seconds. Share with your doctor when you're ready —
                        not before. Your records, your terms.
                    </p>
                </div>

                <div className="fade-up is-in" style={{ marginTop: '2.5rem', display: 'flex', gap: '0.85rem', alignItems: 'center', flexWrap: 'wrap' }}>
                    <button onClick={() => navigate('/register')} className="btn-primary" style={{ width: 'auto', padding: '0.85rem 1.6rem', fontSize: '0.96rem' }}>
                        Create your account <ArrowRight size={16} strokeWidth={1.5} />
                    </button>
                    <span style={{ color: 'var(--ink-dim)', fontSize: '0.95rem' }}>
                        Already with us?{' '}
                        <button onClick={() => navigate('/login')} className="underline-grow" style={{ background: 'none', border: 'none', color: 'var(--ink)', cursor: 'pointer', padding: 0, fontSize: '0.95rem', fontWeight: 500 }}>
                            Sign in
                        </button>
                    </span>
                </div>
            </section>

            <hr className="rule" style={{ maxWidth: '1280px', margin: '0 auto' }}/>

            {/* ── A small editorial intro ─────────────────────────────── */}
            <section style={{ padding: '5rem 2.5rem', maxWidth: '1280px', margin: '0 auto' }}>
                <div className="grid-2">
                    <div ref={addRef} className="fade-up">
                        <div className="eyebrow">— Why we built this</div>
                        <h2 style={{ fontSize: 'clamp(1.8rem, 3.2vw, 2.6rem)', fontVariationSettings: '"opsz" 96, "SOFT" 30', maxWidth: '18ch' }}>
                            Health data is yours.<br/>It should <em style={{ color: 'var(--sage-deep)' }}>feel</em> like it.
                        </h2>
                    </div>
                    <div ref={addRef} className="fade-up quote-rule" style={{ paddingTop: '0.25rem' }}>
                        <p style={{ fontSize: '1.05rem', lineHeight: 1.7, color: 'var(--ink-secondary)' }}>
                            Hospitals keep records in formats meant for billing, not for you.
                            Doctors flip through PDFs that don't talk to each other.
                            We built MedAxis to put a clean, structured copy of your record in your pocket —
                            and let an AI second-read it before your next appointment.
                        </p>
                        <p className="byline" style={{ marginTop: '1.5rem' }}>
                            — Preethi, Vinuthashree & Yashavanthagowda · BNMIT
                        </p>
                    </div>
                </div>
            </section>

            {/* ── Features as Editorial Rows ─────────────────────────── */}
            <section style={{ padding: '3rem 2.5rem 5rem', maxWidth: '1280px', margin: '0 auto' }}>
                <div className="eyebrow" style={{ marginBottom: '2rem' }}>— What's inside</div>

                <div ref={addRef} className="feature-row fade-up">
                    <div className="feature-num">01 / Analysis</div>
                    <h3 style={{ fontVariationSettings: '"opsz" 36, "SOFT" 30' }}>Reads your report like a clinician would.</h3>
                    <p>Upload a PDF or scan. We extract every lab value, flag what's out of range, and write a plain-English clinical summary you can take to your doctor.</p>
                </div>

                <div ref={addRef} className="feature-row fade-up">
                    <div className="feature-num">02 / Records</div>
                    <h3 style={{ fontVariationSettings: '"opsz" 36, "SOFT" 30' }}>One record. <em>FHIR-native</em>. Yours.</h3>
                    <p>Every report you upload becomes a structured medical record in the international FHIR R4 standard — the same format hospitals use, but built for you to read.</p>
                </div>

                <div ref={addRef} className="feature-row fade-up">
                    <div className="feature-num">03 / Consent</div>
                    <h3 style={{ fontVariationSettings: '"opsz" 36, "SOFT" 30' }}>Doctors see what you grant. Nothing more.</h3>
                    <p>Share a single visit, an ongoing condition, or your full history. Revoke anytime. We keep an audit log so you always know who looked at what.</p>
                </div>

                <div ref={addRef} className="feature-row fade-up">
                    <div className="feature-num">04 / Family</div>
                    <h3 style={{ fontVariationSettings: '"opsz" 36, "SOFT" 30' }}>Caregivers, included by design.</h3>
                    <p>Track checkups and prescriptions for parents, children, or anyone you care for — without juggling five different patient portals.</p>
                </div>
            </section>

            {/* ── Stats / Numbers strip ──────────────────────────────── */}
            <section style={{ padding: '4rem 2.5rem', maxWidth: '1280px', margin: '0 auto', borderTop: '1px solid var(--line)' }}>
                <div ref={addRef} className="fade-up" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '2.5rem' }}>
                    <div>
                        <div className="num">3</div>
                        <p style={{ marginTop: '0.4rem', fontSize: '0.92rem', color: 'var(--ink-muted)' }}>Layers of patient<br/>authentication</p>
                    </div>
                    <div>
                        <div className="num">FHIR R4</div>
                        <p style={{ marginTop: '0.4rem', fontSize: '0.92rem', color: 'var(--ink-muted)' }}>International standard.<br/>Not a proprietary lock-in.</p>
                    </div>
                    <div>
                        <div className="num">&lt; 30s</div>
                        <p style={{ marginTop: '0.4rem', fontSize: '0.92rem', color: 'var(--ink-muted)' }}>From upload to<br/>structured analysis</p>
                    </div>
                    <div>
                        <div className="num">0</div>
                        <p style={{ marginTop: '0.4rem', fontSize: '0.92rem', color: 'var(--ink-muted)' }}>Ads. Trackers.<br/>Data resold.</p>
                    </div>
                </div>
            </section>

            {/* ── Transparency callout (replaces old privacy box) ────── */}
            <section style={{ padding: '5rem 2.5rem 6rem', maxWidth: '1280px', margin: '0 auto' }}>
                <div ref={addRef} className="fade-up" style={{
                    background: 'var(--bg-paper)',
                    border: '1px solid var(--line)',
                    borderRadius: 'var(--radius-lg)',
                    padding: 'clamp(2rem, 4vw, 3.5rem)',
                    display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '3rem'
                }}>
                    <div>
                        <div className="eyebrow">— Transparency</div>
                        <h2 style={{ fontSize: 'clamp(1.6rem, 2.8vw, 2.2rem)', fontVariationSettings: '"opsz" 96, "SOFT" 30', maxWidth: '20ch' }}>
                            What we ask for. <em style={{ color: 'var(--sage-deep)' }}>Why</em> we ask for it.
                        </h2>
                    </div>
                    <div>
                        <p style={{ color: 'var(--ink-secondary)', lineHeight: 1.7, fontSize: '0.98rem' }}>
                            We request your name and email to create your medical account. We never sell that data, never share it with advertisers,
                            and never give it to a third party that hasn't been explicitly cleared by you.
                        </p>
                        <p style={{ color: 'var(--ink-secondary)', lineHeight: 1.7, fontSize: '0.98rem', marginTop: '1rem' }}>
                            Doctor access is opt-in, per-record, and revokable. There's an audit log you can inspect at any time.
                        </p>
                        <Link to="/privacy" className="pill-link" style={{ marginTop: '1.5rem', textDecoration: 'none' }}>
                            Read the full privacy policy <ArrowUpRight size={14} strokeWidth={1.5} />
                        </Link>
                    </div>
                </div>
            </section>

            {/* ── Footer ─────────────────────────────────────────────── */}
            <footer style={{ padding: '3rem 2.5rem 4rem', borderTop: '1px solid var(--line)', background: 'var(--bg-app)' }}>
                <div style={{ maxWidth: '1280px', margin: '0 auto', display: 'grid', gridTemplateColumns: '1fr auto', gap: '2rem', alignItems: 'end' }}>
                    <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                            <span className="mark-dot" style={{ width: '8px', height: '8px', margin: 0 }}></span>
                            <span style={{ fontFamily: 'Fraunces, serif', fontVariationSettings: '"opsz" 18, "SOFT" 30', fontSize: '1.05rem', letterSpacing: '-0.02em' }}>MedAxis</span>
                        </div>
                        <p className="byline">A student project by Preethi M, Vinuthashree Gowd &amp; Yashavanthagowda R G — BNM Institute of Technology.</p>
                    </div>
                    <div style={{ display: 'flex', gap: '1.5rem', fontSize: '0.88rem' }}>
                        <Link to="/privacy" className="underline-grow" style={{ color: 'var(--ink-secondary)', textDecoration: 'none' }}>Privacy</Link>
                        <Link to="/terms-of-service" className="underline-grow" style={{ color: 'var(--ink-secondary)', textDecoration: 'none' }}>Terms</Link>
                    </div>
                </div>
                <div style={{ maxWidth: '1280px', margin: '2.5rem auto 0', paddingTop: '1.5rem', borderTop: '1px solid var(--line)', color: 'var(--ink-dim)', fontSize: '0.82rem' }}>
                    © 2026 MedAxis AI · All rights reserved.
                </div>
            </footer>
        </div>
    );
};

export default LandingPage;
