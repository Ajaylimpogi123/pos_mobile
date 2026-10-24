/**
 * **Mark reviewed** (docs/api-contract.md → POST /orders/{ulid}/review), for
 * users with `order.review` on an order the server flagged (`needs_review`):
 * an optional note (max 255). The request is in flight once; a `422` shows
 * under the note, anything else (e.g. `409 "This order doesn't need review."`)
 * in a banner, and a `409` re-reads the order (someone else reviewed it). On
 * success the detail shows the returned `Order`, and the lists and the
 * sidebar's Needs review count refresh.
 */
import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';

import { orderKeys } from '@/hooks/useOrders';
import { getErrorMessage, isApiError, isApiValidationError } from '@/services/api';
import { reviewOrder } from '@/services/orders';
import type { Order } from '@/services/types';
import { useSessionStore } from '@/stores/session';
import { hasPermission, PERMISSIONS } from '@/utils/permissions';
import { REVIEW_NOTE_MAX } from '@pos/core/sale/reviewReasons';

export function useOrderReview(order: Order) {
  const queryClient = useQueryClient();
  const canReview = useSessionStore((state) => hasPermission(state.user, PERMISSIONS.orderReview));
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [noteError, setNoteError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [doneMessage, setDoneMessage] = useState<string | null>(null);
  const inFlight = useRef(false);

  function refreshLists() {
    void queryClient.invalidateQueries({ queryKey: orderKeys.lists });
    void queryClient.invalidateQueries({ queryKey: orderKeys.needsReviewCount });
  }

  async function submit() {
    if (inFlight.current) return;
    const trimmed = note.trim();
    if (trimmed.length > REVIEW_NOTE_MAX) {
      setNoteError(`Use ${REVIEW_NOTE_MAX} characters or fewer.`);
      return;
    }
    inFlight.current = true;
    setSubmitting(true);
    setError(null);
    setNoteError(null);
    try {
      const updated = await reviewOrder(order.ulid, { note: trimmed === '' ? null : trimmed });
      queryClient.setQueryData(orderKeys.detail(order.ulid), updated);
      refreshLists();
      setOpen(false);
      setNote('');
      setDoneMessage('Marked as reviewed.');
    } catch (caught) {
      if (isApiValidationError(caught)) {
        const message = caught.firstError('note');
        if (message) setNoteError(message);
        else setError(caught.message);
      } else {
        setError(getErrorMessage(caught));
        // A 409 means someone else already reviewed it: show the current state.
        if (isApiError(caught) && caught.status === 409) {
          void queryClient.invalidateQueries({ queryKey: orderKeys.detail(order.ulid) });
          refreshLists();
        }
      }
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  return {
    /** The action shows only with `order.review` on a flagged order. */
    available: canReview && order.needs_review,
    open,
    note,
    noteError,
    error,
    submitting,
    doneMessage,
    request: () => {
      setError(null);
      setNoteError(null);
      setDoneMessage(null);
      setOpen(true);
    },
    cancel: () => {
      if (!inFlight.current) {
        setOpen(false);
        setError(null);
      }
    },
    setNote: (text: string) => {
      setNote(text);
      setNoteError(null);
    },
    submit: () => void submit(),
  };
}

export type OrderReviewState = ReturnType<typeof useOrderReview>;
