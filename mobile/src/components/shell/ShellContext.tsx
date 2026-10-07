import { createContext, useContext } from 'react';

export type ShellContextValue = {
  /**
   * `drawer`: no persistent sidebar (phone portrait), so content headers show
   * a ☰ button that opens the slide-in drawer. `persistent`: a sidebar is on
   * screen. `none`: rendered outside the app shell (e.g. in a unit test).
   */
  navigation: 'drawer' | 'persistent' | 'none';
  /** Opens the slide-in navigation drawer / overlay. */
  openNavigation: () => void;
  /** True while the persistent sidebar is the wide, labelled panel (it narrows the content). */
  sidebarExpanded: boolean;
  /** Width the persistent sidebar takes from the content, margins and inset included (0 without one). */
  sidebarWidth: number;
};

const noop = () => undefined;

export const ShellContext = createContext<ShellContextValue>({
  navigation: 'none',
  openNavigation: noop,
  sidebarExpanded: false,
  sidebarWidth: 0,
});

/** The app shell's navigation state, for content screens (e.g. the ☰ button). */
export function useShell(): ShellContextValue {
  return useContext(ShellContext);
}
