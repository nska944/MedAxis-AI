import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../supabase/supabaseClient';

const AuthContext = createContext();

export const useAuth = () => useContext(AuthContext);

/**
 * Wrap a Supabase user so legacy Firebase-style accessors keep working:
 *   user.uid            → Supabase's user.id
 *   user.getIdToken()   → current session's access_token (always fresh)
 * Returns null if input is null.
 */
const wrapUser = (rawUser) => {
    if (!rawUser) return null;
    return {
        ...rawUser,
        uid: rawUser.id,
        getIdToken: async () => {
            const { data } = await supabase.auth.getSession();
            return data.session?.access_token || null;
        },
    };
};

export const AuthProvider = ({ children }) => {
    const [currentUser, setCurrentUser] = useState(null);
    const [userRole, setUserRole]       = useState(null);
    const [loading, setLoading]         = useState(true);
    const [patientAuthStep, setPatientAuthStep] = useState(0);

    useEffect(() => {
        // Initialise from the current session (covers page reloads)
        supabase.auth.getSession().then(({ data: { session } }) => {
            if (session?.user) {
                setCurrentUser(wrapUser(session.user));
                setUserRole(session.user.app_metadata?.role || null);
            }
            setLoading(false);
        });

        // Subscribe to future auth changes
        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
            if (session?.user) {
                setCurrentUser(wrapUser(session.user));
                setUserRole(session.user.app_metadata?.role || null);
            } else {
                setCurrentUser(null);
                setUserRole(null);
            }
            setLoading(false);
        });

        return () => subscription?.unsubscribe();
    }, []);

    const logout = async () => {
        setPatientAuthStep(0);
        await supabase.auth.signOut();
    };

    const value = {
        currentUser,
        userRole,
        loading,
        patientAuthStep,
        setPatientAuthStep,
        logout,
    };

    return (
        <AuthContext.Provider value={value}>
            {!loading && children}
        </AuthContext.Provider>
    );
};
