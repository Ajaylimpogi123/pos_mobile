/**
 * DataTable (ui primitive): headers, default and custom cells, pressable rows
 * (`<rowTestID>-open`), the selected row, the totals footer, skeleton loading,
 * the empty state, and the phone card fallback.
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { CellText, DataTable, type DataTableColumn } from '@/components/ui/DataTable';
import { REFERENCE_SIZES, resetWindowSize, setWindowSize } from '@/test-utils';

type Row = { id: number; name: string; qty: number; note: string | null };

const ROWS: Row[] = [
  { id: 1, name: 'Tapsilog', qty: 34, note: null },
  { id: 2, name: 'Iced Tea', qty: 58, note: 'Large' },
];

const COLUMNS: DataTableColumn<Row>[] = [
  { key: 'name', header: 'Item', flex: 2 },
  { key: 'note', header: 'Note' },
  { key: 'qty', header: 'Qty', width: 64, align: 'right', render: (row) => <CellText align="right" testID={`qty-${row.id}`}>{`${row.qty} sold`}</CellText> },
];

const keyOf = (row: Row) => String(row.id);
const testIDOf = (row: Row) => `row-${row.id}`;

afterEach(() => {
  resetWindowSize();
});

describe('DataTable', () => {
  it('draws the column headers, default cells ("—" for null) and custom cells', async () => {
    await render(<DataTable columns={COLUMNS} rows={ROWS} keyExtractor={keyOf} rowTestID={testIDOf} testID="table" />);

    expect(screen.getByTestId('table-header')).toHaveTextContent('ItemNoteQty');
    expect(screen.getByTestId('row-1')).toHaveTextContent('Tapsilog—34 sold');
    expect(screen.getByTestId('row-2')).toHaveTextContent('Iced TeaLarge58 sold');
    expect(screen.getByTestId('qty-2')).toHaveTextContent('58 sold');
    // Not pressable without onRowPress.
    expect(screen.queryByTestId('row-1-open')).toBeNull();
  });

  it('pressable rows call onRowPress with the row; the selected row is marked', async () => {
    const onRowPress = jest.fn();
    await render(
      <DataTable
        columns={COLUMNS}
        rows={ROWS}
        keyExtractor={keyOf}
        rowTestID={testIDOf}
        onRowPress={onRowPress}
        rowAccessibilityLabel={(row) => `${row.name}, ${row.qty} sold`}
        selectedKey="2"
        testID="table"
      />,
    );

    await fireEvent.press(screen.getByTestId('row-2-open'));
    expect(onRowPress).toHaveBeenCalledWith(ROWS[1]);
    expect(screen.getByTestId('row-2-open')).toBeSelected();
    expect(screen.getByTestId('row-1-open')).not.toBeSelected();
    expect(screen.getByLabelText('Tapsilog, 34 sold')).toBeOnTheScreen();
  });

  it('shows the totals footer under the rows', async () => {
    await render(
      <DataTable columns={COLUMNS} rows={ROWS} keyExtractor={keyOf} footer={{ name: 'Total', qty: '92' }} testID="table" />,
    );
    expect(screen.getByTestId('table-footer')).toHaveTextContent('Total92');
    expect(screen.getByTestId('table-footer-qty')).toHaveTextContent('92');
  });

  it('loading: skeleton rows under the headers (no spinner); then the empty state', async () => {
    const header = <Text testID="above">Filters</Text>;
    const view = await render(
      <DataTable columns={COLUMNS} rows={[]} keyExtractor={keyOf} loading ListHeaderComponent={header} testID="table" />,
    );
    expect(screen.getByTestId('table-loading')).toBeOnTheScreen();
    expect(screen.getByTestId('table-header')).toBeOnTheScreen();
    expect(screen.getByTestId('above')).toBeOnTheScreen();

    await view.rerender(
      <DataTable
        columns={COLUMNS}
        rows={[]}
        keyExtractor={keyOf}
        ListHeaderComponent={header}
        empty={<Text testID="empty">Nothing yet</Text>}
        testID="table"
      />,
    );
    expect(screen.queryByTestId('table-loading')).toBeNull();
    expect(screen.queryByTestId('table-header')).toBeNull();
    expect(screen.getByTestId('empty')).toBeOnTheScreen();
    // The content above the table stays.
    expect(screen.getByTestId('above')).toBeOnTheScreen();
  });

  it('without content above, the empty state replaces the list', async () => {
    await render(<DataTable columns={COLUMNS} rows={[]} keyExtractor={keyOf} empty={<Text testID="empty">Nothing yet</Text>} testID="table" />);
    expect(screen.getByTestId('empty')).toBeOnTheScreen();
    expect(screen.queryByTestId('table')).toBeNull();
  });

  it('phones: rows fall back to renderCard (no column headers); tablets keep the table', async () => {
    const renderCard = (row: Row) => <Text testID={`card-${row.id}`}>{row.name}</Text>;
    await act(async () => setWindowSize(REFERENCE_SIZES.phonePortrait.width, REFERENCE_SIZES.phonePortrait.height));
    await render(<DataTable columns={COLUMNS} rows={ROWS} keyExtractor={keyOf} rowTestID={testIDOf} renderCard={renderCard} testID="table" />);

    expect(screen.getByTestId('card-1')).toHaveTextContent('Tapsilog');
    expect(screen.queryByTestId('table-header')).toBeNull();
    expect(screen.queryByTestId('row-1')).toBeNull();

    await act(async () => setWindowSize(REFERENCE_SIZES.tabletPortrait.width, REFERENCE_SIZES.tabletPortrait.height));
    expect(screen.getByTestId('row-1')).toBeOnTheScreen();
    expect(screen.queryByTestId('card-1')).toBeNull();
  });

  it('rowAccessible={false}: inner buttons stay reachable; the row label goes on the first cell', async () => {
    const onPress = jest.fn();
    const columns: DataTableColumn<Row>[] = [
      { key: 'name', header: 'Item' },
      { key: 'act', header: 'Action', render: (row) => <Text accessibilityRole="button" onPress={onPress} testID={`approve-${row.id}`}>Approve</Text> },
    ];
    await render(
      <DataTable
        columns={columns}
        rows={ROWS}
        keyExtractor={keyOf}
        rowTestID={testIDOf}
        rowAccessibilityLabel={(row) => `${row.name} row`}
        rowAccessible={false}
        testID="table"
      />,
    );

    const label = screen.getByLabelText('Tapsilog row');
    expect(label).toHaveTextContent('Tapsilog');
    expect(label).not.toHaveTextContent('Approve');
    expect(screen.getByTestId('approve-1')).toBeOnTheScreen();
    expect(screen.getByTestId('row-1').props.accessible).toBeFalsy();
  });

  it('phones: renderFooterCard draws the totals after the cards; tablets draw the footer row', async () => {
    const renderCard = (row: Row) => <Text testID={`card-${row.id}`}>{row.name}</Text>;
    const renderFooterCard = () => <Text testID="totals-card">Total 92</Text>;
    await act(async () => setWindowSize(REFERENCE_SIZES.phonePortrait.width, REFERENCE_SIZES.phonePortrait.height));
    await render(
      <DataTable
        columns={COLUMNS}
        rows={ROWS}
        keyExtractor={keyOf}
        renderCard={renderCard}
        renderFooterCard={renderFooterCard}
        footer={{ name: 'Total', qty: '92' }}
        testID="table"
      />,
    );
    expect(screen.getByTestId('totals-card')).toHaveTextContent('Total 92');
    expect(screen.queryByTestId('table-footer')).toBeNull();

    await act(async () => setWindowSize(REFERENCE_SIZES.tabletPortrait.width, REFERENCE_SIZES.tabletPortrait.height));
    expect(screen.getByTestId('table-footer')).toBeOnTheScreen();
    expect(screen.queryByTestId('totals-card')).toBeNull();
  });

  it('fixed rows are laid out without measuring (getItemLayout); auto rows are measured', async () => {
    const view = await render(<DataTable columns={COLUMNS} rows={ROWS} keyExtractor={keyOf} testID="table" />);
    const layout = screen.getByTestId('table').props.getItemLayout as ((data: unknown, index: number) => { length: number; offset: number }) | undefined;
    expect(layout?.(ROWS, 1)).toEqual(expect.objectContaining({ length: 52, offset: 52 }));

    await view.rerender(<DataTable columns={COLUMNS} rows={ROWS} keyExtractor={keyOf} rowHeight="auto" testID="table" />);
    expect(screen.getByTestId('table').props.getItemLayout).toBeUndefined();
  });
});
