/** A product's stock mode (§J), with the selector's wording from `@pos/core/recipe`. */
import { Badge, type TagTone } from '@/components/ui/badge';
import type { StockMode } from '@/services/types';
import { STOCK_MODES } from '@pos/core/recipe';

/** A stock mode is a tag, not a state (MASTER §6): neutral or outline, no dot. */
const TONES: Record<StockMode, TagTone> = { own: 'neutral', recipe: 'neutral', none: 'outline' };

export function StockModeBadge({ mode }: { mode: StockMode }) {
  const label = STOCK_MODES.find((option) => option.value === mode)?.label ?? mode;
  return <Badge tone={TONES[mode]}>{label}</Badge>;
}
