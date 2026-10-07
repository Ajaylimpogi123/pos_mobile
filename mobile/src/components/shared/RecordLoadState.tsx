import { SafeAreaView } from 'react-native-safe-area-context';
import { StyleSheet, View } from 'react-native';

import { ErrorState } from '@/components/ui/ErrorState';
import { IconButton } from '@/components/ui/IconButton';
import { LoadingState } from '@/components/ui/LoadingState';
import { Screen } from '@/components/ui/Screen';
import { TopBar } from '@/components/ui/TopBar';
import { getErrorMessage, isApiError } from '@/services/api';

type RecordLoadStateProps = {
  title: string;
  /** `null` while loading. */
  error: unknown;
  onRetry: () => void;
  onBack: () => void;
  /** Inside another screen's detail pane (Settings on tablets): no Screen and no top bar. */
  embedded?: boolean;
  testID?: string;
};

/** Header + loading or error (404 "not found", 403 "no access", else Retry) while an edit form's record loads. */
export function RecordLoadState({ title, error, onRetry, onBack, embedded = false, testID }: RecordLoadStateProps) {
  let errorTitle = "Couldn't load this item";
  let icon: 'cloud-offline-outline' | 'lock-closed-outline' | 'search-outline' = 'cloud-offline-outline';
  if (isApiError(error) && error.status === 404) {
    errorTitle = 'Not found';
    icon = 'search-outline';
  } else if (isApiError(error) && error.status === 403) {
    errorTitle = 'No access';
    icon = 'lock-closed-outline';
  }

  const body = error ? (
    <ErrorState title={errorTitle} icon={icon} message={getErrorMessage(error)} onRetry={onRetry} testID="record-error" />
  ) : (
    <LoadingState testID="record-loading" />
  );

  if (embedded) {
    return (
      <View style={styles.body} testID={testID}>
        {body}
      </View>
    );
  }

  return (
    <Screen edges={[]} testID={testID}>
      <TopBar
        title={title}
        left={<IconButton icon="arrow-back" variant="bar" accessibilityLabel="Back" onPress={onBack} testID="form-back" />}
      />
      <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.body}>
        {body}
      </SafeAreaView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
  },
});
