import { useEffect } from 'react';
import { create } from 'zustand';

import { getTablesViewPreference, saveTablesViewPreference, type TablesViewPreference } from '@/services/secureStorage';

type State = {
  view: TablesViewPreference;
  loaded: boolean;
  setView: (view: TablesViewPreference) => void;
};

/** Default: the floor plan (an area with no placed table still shows its grid). */
const useStore = create<State>()((set) => ({
  view: 'floor',
  loaded: false,
  setView: (view) => {
    set({ view, loaded: true });
    void saveTablesViewPreference(view);
  },
}));

/**
 * Table Management §C: Sell → Tables' **Floor | Grid** switch, remembered on
 * this device (SecureStore, kept across sign-outs). Read once per launch.
 */
export function useTablesViewPreference(): [TablesViewPreference, (view: TablesViewPreference) => void] {
  const view = useStore((state) => state.view);
  const loaded = useStore((state) => state.loaded);
  const setView = useStore((state) => state.setView);

  useEffect(() => {
    if (loaded) return;
    let cancelled = false;
    void getTablesViewPreference().then((stored) => {
      if (cancelled || useStore.getState().loaded) return;
      useStore.setState({ view: stored ?? 'floor', loaded: true });
    });
    return () => {
      cancelled = true;
    };
  }, [loaded]);

  return [view, setView];
}
