/**
 * Units (§A; Q-025): the seeded unit catalog (`GET /api/v1/units`, any
 * user), grouped by dimension with each exact factor to its base unit. The
 * catalog is read-only: the contract has no admin unit endpoints; an
 * ingredient's own units (a sack, a cup of flour) are edited on its form.
 */
import { INGREDIENTS_NAV } from '@/components/catalog/ingredientsNav';
import { EmptyState, ErrorState, LoadingRows } from '@/components/common/ListStates';
import { PageBand } from '@/components/common/PageBand';
import { SubNav } from '@/components/common/SubNav';
import { useShellHeader } from '@/components/shell/ShellHeaderContext';
import { Card } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useUnits } from '@/hooks/useRecipeBuilder';
import type { UnitDimension } from '@/services/types';
import { formatScaledQty, toScaled } from '@pos/core/quantity';
import { BASE_UNITS, BASE_UNIT_DIMENSION } from '@pos/core/units';

const DIMENSIONS: readonly { value: UnitDimension; label: string }[] = [
  { value: 'mass', label: 'Weight' },
  { value: 'volume', label: 'Volume' },
  { value: 'count', label: 'Count' },
];

/** A factor with every decimal it has (up to 10, grouped): `"28.349523125"` → `28.349523125`. */
function exactFactor(value: string | number): string {
  const scaled = toScaled(value, 10);
  return scaled === null ? String(value) : formatScaledQty(scaled, 10);
}

function baseOf(dimension: UnitDimension): string {
  return BASE_UNITS.find((unit) => BASE_UNIT_DIMENSION[unit.value] === dimension)?.value ?? '';
}

export function UnitsPage() {
  useShellHeader('Units');
  const { units, loading, error } = useUnits();

  return (
    <PageBand title="Units">
      <Card className="overflow-hidden">
        <div className="border-b border-border p-4">
          <SubNav label="Ingredients and units" links={INGREDIENTS_NAV} />
        </div>
        {loading ? (
          <LoadingRows rows={6} label="Loading units…" />
        ) : error ? (
          <ErrorState title="Couldn't load the units" message={error} />
        ) : units.length === 0 ? (
          <EmptyState title="No units" message="The unit catalog is seeded on the server." />
        ) : (
          <div className="grid gap-4 p-4 lg:grid-cols-3">
            {DIMENSIONS.map((dimension) => {
              const rows = units.filter((unit) => unit.dimension === dimension.value);
              const base = baseOf(dimension.value);
              return (
                <section key={dimension.value} aria-labelledby={`units-${dimension.value}`} className="rounded-lg border border-border">
                  <h2 id={`units-${dimension.value}`} className="border-b border-border px-4 py-3 text-base font-semibold">
                    {dimension.label} <span className="text-sm font-normal text-muted-foreground">(base {base})</span>
                  </h2>
                  <Table aria-label={`${dimension.label} units`}>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead>Unit</TableHead>
                        <TableHead className="text-right">In {base}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((unit) => (
                        <TableRow key={unit.code} className="hover:bg-transparent">
                          <TableCell>
                            <span className="font-medium">{unit.code}</span>
                            <span className="text-muted-foreground"> · {unit.name}</span>
                          </TableCell>
                          <TableCell className="text-right tabular">{exactFactor(unit.factor_to_base)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </section>
              );
            })}
          </div>
        )}
      </Card>
    </PageBand>
  );
}
