import { createContext } from 'react';

// The authenticated shell owns top/side/bottom insets; standalone Driver screens own theirs.
export const DriverShellContext = createContext(false);
