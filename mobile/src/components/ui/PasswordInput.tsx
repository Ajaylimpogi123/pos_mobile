import { useState, type ComponentProps } from 'react';

import { IconButton } from '@/components/ui/IconButton';
import { Input } from '@/components/ui/Input';

type PasswordInputProps = Omit<ComponentProps<typeof Input>, 'secureTextEntry' | 'rightAccessory'> & {
  /** Controlled visibility (optional); otherwise the input keeps its own. */
  shown?: boolean;
  onToggleShown?: () => void;
};

/**
 * A new-password input with a show/hide toggle (there is no confirmation
 * field; the toggle lets people check what they typed).
 */
export function PasswordInput({ shown, onToggleShown, testID, ...inputProps }: PasswordInputProps) {
  const [ownShown, setOwnShown] = useState(false);
  const visible = shown ?? ownShown;
  const toggle = onToggleShown ?? (() => setOwnShown((value) => !value));

  return (
    <Input
      leftIcon="lock-closed-outline"
      autoCapitalize="none"
      autoCorrect={false}
      autoComplete="new-password"
      textContentType="newPassword"
      {...inputProps}
      testID={testID}
      secureTextEntry={!visible}
      rightAccessory={
        <IconButton
          icon={visible ? 'eye-off-outline' : 'eye-outline'}
          variant="ghost"
          accessibilityLabel={visible ? 'Hide password' : 'Show password'}
          onPress={toggle}
          testID={testID ? `${testID}-toggle` : undefined}
        />
      }
    />
  );
}
