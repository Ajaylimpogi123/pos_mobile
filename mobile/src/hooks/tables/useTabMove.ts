import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useRef, useState } from 'react';

import { tabRoute } from '@/constants/routes';
import { tableKeys } from '@/hooks/tables/queryKeys';
import { getErrorMessage } from '@/services/api';
import { mergeTab, transferTab } from '@/services/tables';
import type { Tab, TableView } from '@/services/types';
import { dropRoundCart } from '@/stores/tabCarts';
import { ulid as makeUlid } from '@/utils/ulid';

import { isTabConflict } from './useTab';
import { fetchAllTables } from './useTablesView';

export type MoveKind = 'transfer' | 'merge';

type Draft = { kind: MoveKind; target: TableView | null; key: string; error: string | null };

/**
 * **Transfer** (to a free table) and **Merge** (into another open bill),
 * Dine-in Tables & Tabs §D.8–9 (T2). The tables come from `GET /tables`
 * while the dialog is open. Transfer keeps this tab; Merge opens the bill it
 * was merged into. A `409` (the table was taken, the bill changed) goes to
 * the tab's conflict dialog (`onConflict`).
 */
export function useTabMove(tab: Tab | null, onConflict: (message: string) => void) {
  const client = useQueryClient();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const inFlight = useRef(false);

  const tables = useQuery({ queryKey: tableKeys.tablesView(), queryFn: fetchAllTables, enabled: draft !== null });
  const choices = (tables.data ?? []).filter((table) => {
    if (!tab || table.id === tab.table.id) return false;
    if (draft?.kind === 'transfer') return table.tab === null;
    return table.tab !== null && table.tab.ulid !== tab.ulid;
  });

  async function confirm() {
    if (!draft || !draft.target || !tab || inFlight.current) return;
    inFlight.current = true;
    setSubmitting(true);
    setDraft((current) => (current ? { ...current, error: null } : current));
    try {
      if (draft.kind === 'transfer') {
        const next = await transferTab(tab.ulid, { table_id: draft.target.id }, draft.key);
        client.setQueryData(tableKeys.tab(tab.ulid), next);
        setDraft(null);
      } else {
        const into = draft.target.tab?.ulid;
        if (!into) return;
        const target = await mergeTab(tab.ulid, { into_ulid: into }, draft.key);
        client.setQueryData(tableKeys.tab(target.ulid), target);
        client.removeQueries({ queryKey: tableKeys.tab(tab.ulid) });
        dropRoundCart(tab.ulid);
        setDraft(null);
        router.replace(tabRoute(target.ulid));
      }
      void client.invalidateQueries({ queryKey: tableKeys.tablesView() });
    } catch (error) {
      if (isTabConflict(error)) {
        setDraft(null);
        onConflict(error.message);
      } else {
        setDraft((current) => (current ? { ...current, error: getErrorMessage(error) } : current));
      }
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  return {
    draft,
    submitting,
    choices,
    loading: tables.isPending && draft !== null,
    loadError: tables.error,
    retry: () => void tables.refetch(),
    open: (kind: MoveKind) => setDraft({ kind, target: null, key: makeUlid(), error: null }),
    choose: (table: TableView) => setDraft((current) => (current ? { ...current, target: table, error: null } : current)),
    close: () => {
      if (!inFlight.current) setDraft(null);
    },
    confirm: () => void confirm(),
  };
}

export type TabMoveState = ReturnType<typeof useTabMove>;
