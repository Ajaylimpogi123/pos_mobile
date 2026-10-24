/**
 * The MASTER restyle of the shared primitives (design-system/pos/MASTER.md
 * §1, §3, §4 and §6): badges (dot + word for a state, no dot for a tag), the
 * button variants, the destructive confirmation, toasts, the "Showing n" /
 * Load more footer, the Sell search group, the form's sticky footer and error
 * summary, and reduce-motion.
 */
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react-native';
import { AccessibilityInfo, StyleSheet, Text } from 'react-native';

import { prFieldLabel } from '@/components/purchasing/PurchaseRequestFormScreen';
import { FormLayout } from '@/components/shared/FormLayout';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { errorItemsFrom } from '@/components/ui/ErrorSummary';
import { LoadMoreFooter } from '@/components/ui/LoadMoreFooter';
import { SearchGroup } from '@/components/ui/SearchGroup';
import { ToastHost } from '@/components/ui/Toast';
import { colors, radius, sizes, status } from '@/constants/theme';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { showToast, useToastStore } from '@/stores/toast';

// The OS asks for reduced motion in this file (read once, at the first subscription).
jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);

function styleOf(testID: string) {
  return StyleSheet.flatten(screen.getByTestId(testID).props.style);
}

describe('Chip (badges)', () => {
  it('a state badge has the 6 px dot, the word, its tint and border; 24 high, radius 6', async () => {
    await render(<Chip label="Completed" variant="completed" icon="checkmark" testID="badge" />);
    const style = styleOf('badge');
    expect(style).toMatchObject({
      minHeight: 24,
      borderRadius: radius.sm,
      borderWidth: 1,
      backgroundColor: status.completed.tint,
      borderColor: status.completed.border,
    });
    expect(screen.getByTestId('badge')).toHaveTextContent('Completed');
    // The dot is never replaced by an icon in a small state badge.
    const dot = screen.getByTestId('badge').children.find((child) => typeof child !== 'string' && StyleSheet.flatten(child.props.style)?.width === sizes.chipDot);
    expect(dot).toBeDefined();
  });

  it('a tag (not a state) is neutral: no dot and no status tint', async () => {
    await render(<Chip label="SC/PWD" variant="primary" testID="tag" />);
    expect(styleOf('tag')).toMatchObject({ backgroundColor: colors.surface, borderColor: colors.border });
    const dot = screen.getByTestId('tag').children.find((child) => typeof child !== 'string' && StyleSheet.flatten(child.props.style)?.width === sizes.chipDot);
    expect(dot).toBeUndefined();
  });
});

describe('Button', () => {
  it('primary is the green pill; secondary and tonal are the 8 px outline button', async () => {
    const view = await render(<Button title="Save" onPress={jest.fn()} testID="b" />);
    expect(styleOf('b')).toMatchObject({ backgroundColor: colors.green, borderRadius: radius.pill, minHeight: 48 });

    await view.rerender(<Button title="Cancel" variant="tonal" onPress={jest.fn()} testID="b" />);
    expect(styleOf('b')).toMatchObject({ backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.md });
  });

  it('disabled: #E5E7EB with #4B5563 text; strong is the dark neutral button', async () => {
    const view = await render(<Button title="Out of stock" disabled onPress={jest.fn()} testID="b" />);
    expect(styleOf('b').backgroundColor).toBe('#E5E7EB');
    expect(screen.getByText('Out of stock')).toHaveStyle({ color: '#4B5563' });

    await view.rerender(<Button title="New sale" variant="strong" onPress={jest.fn()} testID="b" />);
    expect(styleOf('b').backgroundColor).toBe(colors.dark);
  });
});

describe('ConfirmDialog', () => {
  it('a danger confirmation is the filled destructive button, labelled with the action', async () => {
    await render(
      <ConfirmDialog visible title="Void order?" confirmLabel="Void order" confirmVariant="danger" onConfirm={jest.fn()} onCancel={jest.fn()} testID="d" />,
    );
    expect(styleOf('d-confirm').backgroundColor).toBe(colors.destructiveFill);
    expect(screen.getByTestId('d-confirm')).toHaveTextContent('Void order');
  });
});

describe('Toast', () => {
  afterEach(() => useToastStore.getState().reset());

  it('shows the message with its icon at the top, and hides after a few seconds or on tap', async () => {
    jest.useFakeTimers();
    try {
      await render(<ToastHost />);
      expect(screen.queryByTestId('toast-host')).toBeNull();

      await act(async () => showToast('Saved'));
      expect(screen.getByTestId('toast-success')).toBeOnTheScreen();
      expect(screen.getByTestId('toast-message')).toHaveTextContent('Saved');
      await act(async () => jest.advanceTimersByTime(3000));
      expect(screen.queryByTestId('toast-host')).toBeNull();

      await act(async () => showToast('Sent to kitchen', 'info'));
      await fireEvent.press(screen.getByTestId('toast-info'));
      expect(screen.queryByTestId('toast-host')).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('LoadMoreFooter', () => {
  it('"Showing n" and Load more while there is a next page; "of N" only with a total', async () => {
    const fetchNextPage = jest.fn();
    const view = await render(
      <LoadMoreFooter shown={25} hasNextPage isFetchingNextPage={false} fetchNextPage={fetchNextPage} testID="more" />,
    );
    expect(screen.getByTestId('more-count')).toHaveTextContent('Showing 25');
    await fireEvent.press(screen.getByTestId('more-button'));
    expect(fetchNextPage).toHaveBeenCalled();

    await view.rerender(<LoadMoreFooter shown={40} total={40} hasNextPage={false} isFetchingNextPage={false} fetchNextPage={fetchNextPage} testID="more" />);
    expect(screen.getByTestId('more-count')).toHaveTextContent('Showing 40 of 40');
    expect(screen.queryByTestId('more-button')).toBeNull();
  });
});

describe('SearchGroup', () => {
  it('has a visible label and a joined Search button; the button and the keyboard submit', async () => {
    const onSubmit = jest.fn();
    await render(<SearchGroup label="Search" value="cola" onChangeText={jest.fn()} onSubmit={onSubmit} onBand />);
    expect(screen.getByTestId('search-group-label')).toHaveStyle({ color: colors.onGradient });
    await fireEvent.press(screen.getByTestId('search-group-submit'));
    await fireEvent(screen.getByTestId('search-group-input'), 'submitEditing');
    expect(onSubmit).toHaveBeenCalledTimes(2);
  });
});

describe('FormLayout', () => {
  it('keeps Cancel / Save in a sticky footer under the scroll view, and shows the error summary', async () => {
    const onSelectError = jest.fn();
    await render(
      <FormLayout
        title="New customer"
        onBack={jest.fn()}
        banner={null}
        main={<Text>Fields</Text>}
        footer={<Text>Save</Text>}
        errorSummary={[{ field: 'full_name', label: 'Full name', message: 'The full name field is required.' }]}
        onSelectError={onSelectError}
      />,
    );
    expect(screen.getByTestId('form-scroll')).not.toContainElement(screen.getByTestId('form-footer'));
    expect(screen.getByTestId('form-error-summary')).toHaveTextContent(/Fix 1 field/);
    await fireEvent.press(screen.getByTestId('form-error-summary-full_name'));
    expect(onSelectError).toHaveBeenCalledWith('full_name');
  });
});

describe('useReducedMotion', () => {
  it('follows the OS reduce-motion setting', async () => {
    const { result } = await renderHook(() => useReducedMotion());
    await waitFor(() => expect(result.current).toBe(true));
  });
});

describe('error summary labels', () => {
  it('names line fields ("Line 2: Quantity") and can leave a key out', () => {
    expect(prFieldLabel('items.1.qty')).toBe('Line 2: Quantity');
    expect(prFieldLabel('date_needed')).toBe('Date needed');
    const items = errorItemsFrom({ form: 'Enter a quantity.', remarks: 'Too long.', 'items.0.unit': 'Choose a unit.' }, (field) =>
      field === 'form' ? null : prFieldLabel(field),
    );
    expect(items.map((item) => item.label)).toEqual(['Remarks', 'Line 1: Unit']);
  });
});
