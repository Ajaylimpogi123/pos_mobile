import { Chip, type ChipVariant } from '@/components/ui/Chip';
import type { IconName } from '@/components/ui/Icon';
import type { Reachability } from '@/stores/printing';

export type PrinterDotState = Reachability['state'] | 'unknown' | 'off';

/** Responding → completed (green), not responding → cancelled (red), checking → processing (blue); unknown / off → neutral with a glyph. */
const LOOKS: Record<PrinterDotState, { variant: ChipVariant; label: string; icon?: IconName }> = {
  ok: { variant: 'completed', label: 'Responding' },
  down: { variant: 'cancelled', label: 'Not responding' },
  checking: { variant: 'processing', label: 'Checking…' },
  unknown: { variant: 'neutral', label: 'Not checked yet', icon: 'help-circle-outline' },
  off: { variant: 'neutral', label: 'Turned off', icon: 'power-outline' },
};

type StatusDotProps = {
  state: PrinterDotState;
  testID?: string;
};

/** A printer's reachability as a status pill: a dot (or glyph) and a text label, so the colour is never the only cue. */
export function StatusDot({ state, testID }: StatusDotProps) {
  const look = LOOKS[state];
  return <Chip label={look.label} variant={look.variant} icon={look.icon} accessibilityLabel={`Status: ${look.label}`} testID={testID} />;
}
