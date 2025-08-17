// Augment types so TS accepts v7 future flags even if your installed version predates them.
declare module 'react-router' {
  interface FutureConfig {
    v7_startTransition?: boolean;
    v7_relativeSplatPath?: boolean;
    v7_fetcherPersist?: boolean;
    v7_normalizeFormMethod?: boolean;
  }
}

declare module 'react-router-dom' {
  // Some versions also allow passing future flags to RouterProvider; we add it for safety.
  interface RouterProviderProps {
    future?: {
      v7_startTransition?: boolean;
      v7_relativeSplatPath?: boolean;
      v7_fetcherPersist?: boolean;
      v7_normalizeFormMethod?: boolean;
    };
  }
}
