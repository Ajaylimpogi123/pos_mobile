import { useShell } from '@/components/shell/ShellContext';
import { IconButton, type IconButtonVariant } from '@/components/ui/IconButton';

type MenuButtonProps = {
  variant?: IconButtonVariant;
  testID?: string;
};

/**
 * The ☰ button of a content top bar. Rendered only when the app shell has no
 * persistent sidebar (phone portrait); it opens the slide-in drawer.
 */
export function MenuButton({ variant = 'bar', testID = 'open-navigation' }: MenuButtonProps) {
  const { navigation, openNavigation } = useShell();
  if (navigation !== 'drawer') return null;

  return (
    <IconButton
      icon="menu"
      variant={variant}
      accessibilityLabel="Open navigation"
      onPress={openNavigation}
      testID={testID}
    />
  );
}
