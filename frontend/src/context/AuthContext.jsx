import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../supabase/supabaseClient';

const AuthContext = createContext();

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }) => {
    const [currentUser, setCurrentUser] = useState(null);
    const [userRole, setUserRole]       = useState(null);
    const [loading, setLoading]         = useState(true);
    const [patientAuthStep, setPatientAuthStep] = useState(0);

    useEffect(() => {
        // Initialise from the current session (covers page reloads)
        supabase.auth.getSession().then(({ data: { session } }) => {
            if (session?.user) {
                setCurrentUser(session.user);
                setUserRole(session.user.app_metadata?.role || null);
            }
            setLoading(false);
        });

        // Subscribe to future auth changes
        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
            if (session?.user) {
                setCurrentUser(session.user);
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
