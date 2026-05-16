import React, { useState, useEffect, useCallback } from 'react';
import { Bell, BellOff, Clock, Check, Trash2, Plus } from 'lucide-react';

// ── Local-storage helpers (replaces Firestore for browser-side reminders) ─────
const storageKey = (uid) => `medaxis_reminders_${uid}`;
const loadFromStorage = (uid) => {
    try { return JSON.parse(localStorage.getItem(storageKey(uid)) || '[]'); }
    catch { return []; }
};
const saveToStorage = (uid, reminders) => {
    localStorage.setItem(storageKey(uid), JSON.stringify(reminders));
};

const TIME_SLOTS = [
    { label: 'Morning', time: '08:00', icon: '🌅' },
    { label: 'Afternoon', time: '13:00', icon: '☀️' },
    { label: 'Night', time: '21:00', icon: '🌙' },
];

/**
 * MedicineReminders - Renders per-medicine reminder cards.
 * Props:
 *   medicines: string[]  — list of medicine names from AI analysis
 *   uid: string          — patient uid for Firestore path
 */
const MedicineReminders = ({ medicines = [], uid }) => {
    const [reminders, setReminders] = useState([]);
    const [loading, setLoading] = useState(true);
    const [notifPermission, setNotifPermission] = useState(
        typeof Notification !== 'undefined' ? Notification.permission : 'denied'
    );
    // per-medicine: track selected time slot or custom time before saving
    const [pendingSlot, setPendingSlot] = useState({}); // { [medicineName]: { label, time } }
    const [customTimes, setCustomTimes] = useState({});  // { [medicineName]: "HH:MM" }
    const [saving, setSaving] = useState({});

    // ── Load existing reminders from localStorage ──────────────────────────
    const loadReminders = useCallback(() => {
        if (!uid) return;
        setReminders(loadFromStorage(uid));
        setLoading(false);
    }, [uid]);

    useEffect(() => { loadReminders(); }, [loadReminders]);

    // ── Browser notification scheduler (poll every 60 s) ───────────────────
    useEffect(() => {
        if (notifPermission !== 'granted') return;
        const interval = setInterval(() => {
            const now = new Date();
            const hhmm = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
            reminders.forEach(r => {
                if (r.enabled && r.time === hhmm) {
                    new Notification(`💊 Medicine Reminder`, {
                        body: `Time to take ${r.medicineName}`,
                        icon: '/favicon.ico'
                    });
                }
            });
        }, 60000);
        return () => clearInterval(interval);
    }, [reminders, notifPermission]);

    // ── Request notification permission ─────────────────────────────────────
    const requestPermission = async () => {
        if (typeof Notification === 'undefined') return;
        const result = await Notification.requestPermission();
        setNotifPermission(result);
    };

    // ── Save a new reminder ──────────────────────────────────────────────────
    const saveReminder = (medicineName, label, time) => {
        if (!uid) return;
        setSaving(p => ({ ...p, [medicineName]: true }));
        const existing = reminders.find(r => r.medicineName === medicineName);
        let updated;
        if (existing) {
            updated = reminders.map(r => r.medicineName === medicineName ? { ...r, label, time, enabled: true } : r);
        } else {
            updated = [...reminders, { id: Date.now().toString(), medicineName, label, time, enabled: true, uid }];
        }
        saveToStorage(uid, updated);
        setReminders(updated);
        setPendingSlot(p => ({ ...p, [medicineName]: null }));
        setSaving(p => ({ ...p, [medicineName]: false }));
    };

    // ── Toggle enable/disable ────────────────────────────────────────────────
    const toggleReminder = (reminder) => {
        const updated = reminders.map(r => r.id === reminder.id ? { ...r, enabled: !r.enabled } : r);
        saveToStorage(uid, updated);
        setReminders(updated);
    };

    // ── Delete a reminder ────────────────────────────────────────────────────
    const deleteReminder = (reminder) => {
        const updated = reminders.filter(r => r.id !== reminder.id);
        saveToStorage(uid, updated);
        setReminders(updated);
    };

    if (!medicines || medicines.length === 0) return null;

    return (
        <div style={{ marginTop: '2rem' }}>
            {/* Header ─────────────────────────────────────────────────────── */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                <h4 style={{ fontSize: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0 }}>
                    <Bell size={18} color="var(--primary)" /> Medicine Reminders
                </h4>
                {notifPermission !== 'granted' && (
                    <button
                        className="btn-outline"
                        onClick={requestPermission}
                        style={{ fontSize: '0.8rem', padding: '0.35rem 0.75rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
                    >
                        <Bell size={14} /> Enable Notifications
                    </button>
                )}
                {notifPermission === 'granted' && (
                    <span style={{ fontSize: '0.75rem', color: 'var(--success)', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                        <Check size={13} /> Notifications on
                    </span>
                )}
            </div>

            {/* Per-medicine cards ─────────────────────────────────────────── */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {medicines.map((medicine) => {
                    const existing = reminders.find(r => r.medicineName === medicine);
                    const pending = pendingSlot[medicine];
                    const isCustom = pending?.label === 'Custom';

                    return (
                        <div key={medicine} style={{
                            background: 'rgba(99,102,241,0.06)',
                            border: '1px solid rgba(99,102,241,0.18)',
                            borderRadius: 'var(--radius-md)',
                            padding: '1rem 1.25rem'
                        }}>
                            {/* Medicine name + existing status */}
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                                <div>
                                    <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>💊 {medicine}</span>
                                    {existing && (
                                        <span style={{
                                            marginLeft: '0.75rem',
                                            fontSize: '0.72rem',
                                            padding: '0.2rem 0.55rem',
                                            borderRadius: '999px',
                                            background: existing.enabled ? 'rgba(16,185,129,0.15)' : 'rgba(107,114,128,0.15)',
                                            color: existing.enabled ? 'var(--success)' : 'var(--text-muted)'
                                        }}>
                                            {existing.icon || ''} {existing.label} · {existing.time} {existing.enabled ? '· Active' : '· Paused'}
                                        </span>
                                    )}
                                </div>

                                {/* Action buttons for existing reminder */}
                                {existing && (
                                    <div style={{ display: 'flex', gap: '0.4rem' }}>
                                        <button
                                            title={existing.enabled ? 'Disable reminder' : 'Enable reminder'}
                                            onClick={() => toggleReminder(existing)}
                                            className="btn-outline"
                                            style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}
                                        >
                                            {existing.enabled ? <><BellOff size={13} /> Pause</> : <><Bell size={13} /> Resume</>}
                                        </button>
                                        <button
                                            title="Delete reminder"
                                            onClick={() => deleteReminder(existing)}
                                            className="btn-outline"
                                            style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem', color: 'var(--danger)', borderColor: 'var(--danger)' }}
                                        >
                                            <Trash2 size={13} />
                                        </button>
                                    </div>
                                )}
                            </div>

                            {/* Time slot selection ─────────────────────────── */}
                            {!existing && (
                                <div>
                                    <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>Choose reminder time:</div>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
                                        {TIME_SLOTS.map(slot => (
                                            <button
                                                key={slot.label}
                                                onClick={() => setPendingSlot(p => ({ ...p, [medicine]: slot }))}
                                                className={pending?.label === slot.label ? 'btn-primary' : 'btn-outline'}
                                                style={{ fontSize: '0.82rem', padding: '0.35rem 0.85rem' }}
                                            >
                                                {slot.icon} {slot.label}
                                            </button>
                                        ))}
                                        <button
                                            onClick={() => setPendingSlot(p => ({ ...p, [medicine]: { label: 'Custom', time: customTimes[medicine] || '08:00' } }))}
                                            className={isCustom ? 'btn-primary' : 'btn-outline'}
                                            style={{ fontSize: '0.82rem', padding: '0.35rem 0.85rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}
                                        >
                                            <Clock size={13} /> Custom
                                        </button>
                                    </div>

                                    {/* Custom time picker */}
                                    {isCustom && (
                                        <div style={{ marginTop: '0.6rem', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                                            <input
                                                type="time"
                                                className="form-input"
                                                value={customTimes[medicine] || '08:00'}
                                                onChange={e => {
                                                    setCustomTimes(p => ({ ...p, [medicine]: e.target.value }));
                                                    setPendingSlot(p => ({ ...p, [medicine]: { label: 'Custom', time: e.target.value } }));
                                                }}
                                                style={{ width: 'auto', padding: '0.3rem 0.6rem', margin: 0, fontSize: '0.85rem' }}
                                            />
                                        </div>
                                    )}

                                    {/* Save button */}
                                    {pending && (
                                        <button
                                            className="btn-primary"
                                            style={{ marginTop: '0.75rem', fontSize: '0.85rem', padding: '0.4rem 1.2rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
                                            disabled={saving[medicine]}
                                            onClick={() => {
                                                if (notifPermission !== 'granted') requestPermission();
                                                saveReminder(medicine, pending.label, pending.time);
                                            }}
                                        >
                                            {saving[medicine] ? '⏳ Saving...' : <><Plus size={14} /> Set Reminder</>}
                                        </button>
                                    )}
                                </div>
                            )}

                            {/* Change time for existing reminder */}
                            {existing && (
                                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                                    <span>Change time:</span>
                                    {TIME_SLOTS.map(slot => (
                                        <button
                                            key={slot.label}
                                            onClick={() => saveReminder(medicine, slot.label, slot.time)}
                                            className="btn-outline"
                                            style={{ fontSize: '0.75rem', padding: '0.2rem 0.65rem' }}
                                        >
                                            {slot.icon} {slot.label}
                                        </button>
                                    ))}
                                    <input
                                        type="time"
                                        className="form-input"
                                        defaultValue={existing.time}
                                        onBlur={e => saveReminder(medicine, 'Custom', e.target.value)}
                                        style={{ width: 'auto', padding: '0.2rem 0.45rem', margin: 0, fontSize: '0.75rem' }}
                                    />
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default MedicineReminders;
