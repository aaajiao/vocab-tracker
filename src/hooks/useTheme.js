import { useState, useEffect } from 'react';

const THEME_STORAGE_KEY = 'vocab-theme';

export function useTheme() {
    const [theme, setTheme] = useState(() => {
        // First check localStorage for saved preference
        if (typeof window !== 'undefined') {
            const saved = localStorage.getItem(THEME_STORAGE_KEY);
            if (saved === 'dark' || saved === 'light') {
                return saved;
            }
            // Fall back to system preference
            return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
        }
        return 'light';
    });

    useEffect(() => {
        const root = window.document.documentElement;
        if (theme === 'dark') {
            root.classList.add('dark');
        } else {
            root.classList.remove('dark');
        }
        // Save to localStorage for persistence
        localStorage.setItem(THEME_STORAGE_KEY, theme);
    }, [theme]);

    const toggleTheme = () => {
        setTheme(prev => prev === 'dark' ? 'light' : 'dark');
    };

    return { theme, setTheme, toggleTheme };
}

export default useTheme;
