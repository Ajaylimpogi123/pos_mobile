/**
 * A status badge for a label + tone pair from the label files
 * (`constants/inventoryLabels.ts`, `constants/purchasingLabels.ts`): the
 * MASTER §1.3 tints, or a plain neutral badge (Cancelled, unknown values).
 * Always a dot plus the word, never colour alone.
 */
import { Badge, StatusBadge } from '@/components/ui/badge';
import type { StatusTone } from '@/constants/inventoryLabels';

export function ToneBadge({ info, className }: { info: { label: string; tone: StatusTone | 'neutral' }; className?: string }) {
  if (info.tone === 'neutral') {
    return (
      <Badge tone="neutral" className={className}>
        <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
        {info.label}
      </Badge>
    );
  }
  return <StatusBadge tone={info.tone} label={info.label} className={className} />;
}
