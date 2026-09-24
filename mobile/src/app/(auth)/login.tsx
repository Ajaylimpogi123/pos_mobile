import { useRef } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { Banner } from '@/components/Banner';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Screen } from '@/components/Screen';
import { TextField } from '@/components/TextField';
import { colors, fontSizes, fontWeights, sizes, spacing } from '@/constants/theme';
import { useLoginForm } from '@/hooks/useLoginForm';

export default function LoginScreen() {
  const form = useLoginForm();
  const passwordRef = useRef<TextInput>(null);
  const deviceCodeRef = useRef<TextInput>(null);

  return (
    <Screen scroll centered testID="login-screen">
      <Card style={styles.card}>
        <View style={styles.header}>
          <Text style={styles.title} accessibilityRole="header">
            POS Mobile
          </Text>
          <Text style={styles.subtitle}>Log in to this tablet</Text>
        </View>

        {form.bannerError ? <Banner message={form.bannerError} variant="error" testID="login-banner" /> : null}

        <TextField
          label="Email"
          value={form.email}
          onChangeText={form.setEmail}
          error={form.fieldErrors.email}
          placeholder="name@example.com"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          keyboardType="email-address"
          textContentType="username"
          returnKeyType="next"
          submitBehavior="submit"
          onSubmitEditing={() => passwordRef.current?.focus()}
          editable={!form.submitting}
          testID="login-email"
        />

        <TextField
          ref={passwordRef}
          label="Password"
          value={form.password}
          onChangeText={form.setPassword}
          error={form.fieldErrors.password}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="current-password"
          textContentType="password"
          returnKeyType="next"
          submitBehavior="submit"
          onSubmitEditing={() => deviceCodeRef.current?.focus()}
          editable={!form.submitting}
          testID="login-password"
        />

        <TextField
          ref={deviceCodeRef}
          label="Device code"
          value={form.deviceCode}
          onChangeText={form.setDeviceCode}
          error={form.fieldErrors.device_code}
          placeholder="e.g. TAB01"
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={20}
          returnKeyType="go"
          onSubmitEditing={() => void form.submit()}
          editable={!form.submitting}
          testID="login-device-code"
        />

        <Button
          title="Log in"
          onPress={() => void form.submit()}
          loading={form.submitting}
          testID="login-submit"
          style={styles.submit}
        />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: {
    width: '100%',
    maxWidth: sizes.formCardMaxWidth,
    gap: spacing.lg,
  },
  header: {
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  title: {
    fontSize: fontSizes.xxl,
    fontWeight: fontWeights.bold,
    color: colors.text,
  },
  subtitle: {
    fontSize: fontSizes.md,
    color: colors.textMuted,
  },
  submit: {
    marginTop: spacing.sm,
  },
});
