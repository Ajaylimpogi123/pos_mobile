import type { ReactNode, Ref } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

type KeyboardScrollViewProps = {
  children: ReactNode;
  contentContainerStyle?: StyleProp<ViewStyle>;
  style?: StyleProp<ViewStyle>;
  scrollRef?: Ref<ScrollView>;
  testID?: string;
};

/**
 * Form container: KeyboardAvoidingView + ScrollView, so inputs stay visible
 * above the keyboard and taps on buttons work while the keyboard is open.
 *
 * `behavior` follows the Expo SDK 57 keyboard-handling guide: `padding` on
 * iOS, `undefined` on Android (the view itself keeps inputs uncovered there).
 */
export function KeyboardScrollView({ children, contentContainerStyle, style, scrollRef, testID }: KeyboardScrollViewProps) {
  return (
    <KeyboardAvoidingView style={[styles.flex, style]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        ref={scrollRef}
        style={styles.flex}
        contentContainerStyle={[styles.content, contentContainerStyle]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        testID={testID}
      >
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
  },
});
