import { Component, Fragment, type ErrorInfo, type ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/Button';
import { IconBadge } from '@/components/ui/IconBadge';
import { colors, layout, spacing, typography } from '@/constants/theme';
import { captureError } from '@/errors/capture';

type Props = { children: ReactNode };
type State = { failed: boolean; generation: number };

/**
 * Hardening & Pilot §F: the root error boundary. A render error shows a
 * friendly "Something went wrong" screen with **Restart app**; the error is
 * kept in the error queue and sent later. Restart remounts the whole app tree
 * (a fresh start of every screen and hook; stored data, the outbox and the
 * session are untouched).
 */
export class AppErrorBoundary extends Component<Props, State> {
  state: State = { failed: false, generation: 0 };

  static getDerivedStateFromError(): Partial<State> {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    const stack = [error.stack ?? '', info.componentStack ?? ''].filter(Boolean).join('\n');
    const withStack = Object.assign(new Error(error.message), { name: error.name, stack });
    captureError(withStack, { level: 'fatal', extra: { source: 'error_boundary' } });
  }

  restart = () => {
    this.setState((state) => ({ failed: false, generation: state.generation + 1 }));
  };

  render() {
    if (this.state.failed) return <CrashScreen onRestart={this.restart} />;
    return <Fragment key={this.state.generation}>{this.props.children}</Fragment>;
  }
}

function CrashScreen({ onRestart }: { onRestart: () => void }) {
  return (
    <SafeAreaView edges={['top', 'right', 'bottom', 'left']} style={styles.safe} testID="app-crash-screen">
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.inner} accessibilityRole="alert">
          <IconBadge icon="warning-outline" tone="danger" size="lg" />
          <Text style={styles.title} accessibilityRole="header">
            Something went wrong
          </Text>
          <Text style={styles.message}>
            The app hit an unexpected problem. Sales saved on this tablet are safe. The error was recorded and will be
            sent to your manager.
          </Text>
          <Button title="Restart app" leftIcon="refresh" size="lg" onPress={onRestart} style={styles.button} testID="app-crash-restart" />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: spacing.xxl,
  },
  inner: {
    width: '100%',
    maxWidth: layout.formMaxWidth,
    alignSelf: 'center',
    alignItems: 'center',
    gap: spacing.lg,
  },
  title: {
    ...typography.title,
    color: colors.text,
    textAlign: 'center',
  },
  message: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  button: {
    alignSelf: 'stretch',
  },
});
