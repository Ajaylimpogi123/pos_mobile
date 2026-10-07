/**
 * ListRow (ui primitive): label, sub-line and value, press, selected and
 * disabled states, and the optional chevron.
 */
import { fireEvent, render, screen } from '@testing-library/react-native';

import { ListRow } from '@/components/ui/ListRow';

describe('ListRow', () => {
  it('shows the label, sub-line and value, and calls onPress', async () => {
    const onPress = jest.fn();
    await render(<ListRow label="Printers" subLabel="Kitchen and bar" value="3" icon="print-outline" onPress={onPress} testID="row" />);

    expect(screen.getByTestId('row')).toHaveTextContent(/Printers.*Kitchen and bar.*3/);
    await fireEvent.press(screen.getByTestId('row'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('marks the selected row, and a disabled row ignores presses', async () => {
    const onPress = jest.fn();
    const view = await render(<ListRow label="Receipt" selected onPress={onPress} testID="row" />);
    expect(screen.getByTestId('row')).toBeSelected();

    await view.rerender(<ListRow label="Close shift" danger disabled subLabel="Needs permission." onPress={onPress} testID="row" />);
    expect(screen.getByTestId('row')).toBeDisabled();
    await fireEvent.press(screen.getByTestId('row'));
    expect(onPress).not.toHaveBeenCalled();
  });
});
