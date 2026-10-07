import { useCallback, useRef } from 'react';
import { StyleSheet, Text, View, type TextInput } from 'react-native';

import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { IconButton } from '@/components/ui/IconButton';
import { Input } from '@/components/ui/Input';
import { colors, radius, shadows, sizes, spacing, typography } from '@/constants/theme';
import type { LoginFormState } from '@/hooks/useLoginForm';
import { useResponsive } from '@/hooks/useResponsive';

type LoginFormProps = {
  /** State lives in `useLoginForm()` in the screen, above every layout switch. */
  form: LoginFormState;
};

/**
 * The sign-in form: "Welcome back", email, password (with show/hide), a
 * banner for non-field errors, the 56 dp Sign in button and the help line.
 * On tablets it is a white card (≈ 420 wide, radius 20, soft shadow); on
 * phones the same card drops its chrome and sits on the page, under the
 * brand header. The tree is identical in both, so rotation keeps focus.
 */
export function LoginForm({ form }: LoginFormProps) {
  const passwordRef = useRef<TextInput>(null);
  const { isTablet, isCompactHeight } = useResponsive();
  const { submit: submitForm } = form;

  const submit = useCallback(() => void submitForm(), [submitForm]);
  const focusPassword = useCallback(() => passwordRef.current?.focus(), []);

  return (
    <Card flush elevation="lg" style={[styles.card, isTablet ? styles.cardTablet : styles.cardPlain]} testID="login-card">
      <View style={styles.header}>
        <Text style={isTablet && !isCompactHeight ? styles.title : styles.titleCompact} accessibilityRole="header">
          Welcome back
        </Text>
        <Text style={styles.subtitle}>Sign in with your staff account.</Text>
      </View>

      {form.bannerError ? <Banner message={form.bannerError} variant="error" testID="login-banner" /> : null}

      <Input
        label="Email"
        value={form.email}
        onChangeText={form.setEmail}
        error={form.fieldErrors.email}
        leftIcon="mail-outline"
        placeholder="name@example.com"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        keyboardType="email-address"
        textContentType="username"
        returnKeyType="next"
        submitBehavior="submit"
        onSubmitEditing={focusPassword}
        editable={!form.submitting}
        testID="login-email"
      />

      <Input
        ref={passwordRef}
        label="Password"
        value={form.password}
        onChangeText={form.setPassword}
        error={form.fieldErrors.password}
        leftIcon="lock-closed-outline"
        placeholder="Your password"
        secureTextEntry={!form.passwordVisible}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="current-password"
        textContentType="password"
        returnKeyType="go"
        onSubmitEditing={submit}
        editable={!form.submitting}
        testID="login-password"
        rightAccessory={
          <IconButton
            icon={form.passwordVisible ? 'eye-off-outline' : 'eye-outline'}
            variant="ghost"
            accessibilityLabel={form.passwordVisible ? 'Hide password' : 'Show password'}
            onPress={form.togglePasswordVisible}
            testID="login-password-toggle"
          />
        }
      />

      <Button
        title="Sign in"
        size="lg"
        rightIcon="arrow-forward"
        onPress={submit}
        loading={form.submitting}
        testID="login-submit"
        style={styles.submit}
      />

      <Text style={styles.help}>Forgot your password? Ask a manager to reset it.</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    width: '100%',
    maxWidth: sizes.loginCardWidth,
    gap: spacing.xl,
  },
  cardTablet: {
    padding: spacing.huge,
    borderRadius: radius.xl,
    gap: spacing.xxl,
  },
  cardPlain: {
    backgroundColor: colors.transparent,
    borderColor: colors.transparent,
    ...shadows.none,
  },
  header: {
    gap: spacing.xs + spacing.xxs,
  },
  title: {
    ...typography.titleLarge,
    color: colors.text,
  },
  titleCompact: {
    ...typography.title,
    color: colors.text,
  },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
  },
  submit: {
    marginTop: spacing.xs,
  },
  help: {
    ...typography.caption,
    color: colors.textSecondary,
    textAlign: 'center',
  },
});
