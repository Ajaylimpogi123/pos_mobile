import { ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
    ActionRow,
    CheckRow,
    RowList,
    ValueRow,
} from "@/components/device/DeviceParts";
import { InfoCard } from "@/components/shared/InfoCard";
import { ListHeader } from "@/components/shared/ListHeader";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { Screen } from "@/components/ui/Screen";
import { colors, spacing, typography } from "@/constants/theme";
import {
    useThisTablet,
    type ThisTabletState,
} from "@/hooks/device/useThisTablet";
import { useResponsive } from "@/hooks/useResponsive";
import { formatClockTime, formatRelativeTime } from "@/utils/dates";
import { formatPeso } from "@pos/core/money";

const NEVER = "Never";

function ago(iso: string | null, now: number): string {
    if (!iso) return NEVER;
    return formatRelativeTime(iso, now) ?? NEVER;
}

function seconds(ms: number): string {
    const s = Math.round(ms / 1000);
    return `${s > 0 ? "+" : ""}${s} s`;
}

function ChecklistCard({ state }: { state: ThisTabletState }) {
    const problems = state.checklist.filter(
        (item) => item.state !== "ok",
    ).length;
    return (
        <InfoCard
            title="Checklist"
            icon="checkbox-outline"
            tone={problems > 0 ? "danger" : "primary"}
            testID="device-checklist"
        >
            <Text style={styles.summary} testID="device-checklist-summary">
                {problems === 0
                    ? "Everything is ready for service."
                    : `${problems} ${problems === 1 ? "item needs" : "items need"} a look.`}
            </Text>
            <RowList>
                {state.checklist.map((item) => (
                    <CheckRow
                        key={item.key}
                        label={item.label}
                        state={item.state}
                        hint={item.hint}
                        testID={`device-check-${item.key}`}
                    />
                ))}
            </RowList>
        </InfoCard>
    );
}

function ServerCard({ state }: { state: ThisTabletState }) {
    const { server } = state;
    return (
        <InfoCard title="Server" icon="server-outline" testID="device-server">
            <RowList>
                <ValueRow
                    label="Address"
                    value={server.url}
                    testID="device-server-url"
                />
                <ValueRow
                    label="Status"
                    value={
                        <Chip
                            label={
                                server.reachable ? "Reachable" : "Not reachable"
                            }
                            variant={server.reachable ? "success" : "danger"}
                            size="sm"
                            testID="device-server-status"
                        />
                    }
                />
                <ValueRow
                    label="Response time"
                    value={
                        server.latencyMs === null
                            ? "—"
                            : `${server.latencyMs} ms`
                    }
                    testID="device-server-latency"
                />
                <ValueRow
                    label="Server time"
                    value={
                        server.clock
                            ? (formatClockTime(server.clock.serverTime) ?? "—")
                            : "—"
                    }
                    testID="device-server-time"
                />
                <ValueRow
                    label="Clock difference"
                    value={server.drift === null ? "—" : seconds(server.drift)}
                    testID="device-server-drift"
                />
            </RowList>
            <ActionRow>
                <Button
                    title="Check now"
                    leftIcon="pulse-outline"
                    variant="secondary"
                    loading={state.checking}
                    disabled={state.checking}
                    onPress={state.checkNow}
                    testID="device-check-now"
                />
            </ActionRow>
        </InfoCard>
    );
}

function TabletCard({ state }: { state: ThisTabletState }) {
    const { tablet } = state;
    return (
        <InfoCard
            title="This tablet"
            icon="tablet-landscape-outline"
            testID="device-tablet"
        >
            <RowList>
                <ValueRow
                    label="Code"
                    value={tablet.code ?? "Not registered"}
                    testID="device-code"
                />
                <ValueRow
                    label="Name"
                    value={tablet.name ?? "—"}
                    testID="device-name"
                />
                <ValueRow
                    label="Install ID"
                    value={
                        tablet.installIdTail ? `…${tablet.installIdTail}` : "—"
                    }
                    testID="device-install-id"
                />
                <ValueRow
                    label="App version"
                    value={tablet.appVersion ?? "—"}
                    testID="device-app-version"
                />
                <ValueRow
                    label="System"
                    value={
                        [
                            tablet.os ? `Android ${tablet.os}` : null,
                            tablet.model,
                        ]
                            .filter(Boolean)
                            .join(" · ") || "—"
                    }
                    testID="device-os"
                />
                <ValueRow
                    label="Free storage"
                    value={
                        tablet.storageMb === null
                            ? "—"
                            : `${tablet.storageMb.toLocaleString("en-US")} MB`
                    }
                    testID="device-storage"
                />
            </RowList>
        </InfoCard>
    );
}

function SyncCard({ state }: { state: ThisTabletState }) {
    const { sync, now } = state;
    return (
        <InfoCard title="Sync" icon="sync-outline" testID="device-sync">
            <RowList>
                <ValueRow
                    label="Sales to send"
                    value={String(sync.pending)}
                    testID="device-sync-pending"
                />
                <ValueRow
                    label="Failed sales"
                    value={String(sync.failed)}
                    testID="device-sync-failed"
                />
                <ValueRow
                    label="Oldest waiting"
                    value={
                        sync.oldestPendingAt
                            ? ago(sync.oldestPendingAt, now)
                            : "—"
                    }
                    testID="device-sync-oldest"
                />
                <ValueRow
                    label="Menu synced"
                    value={ago(sync.lastMenuSyncAt, now)}
                    testID="device-sync-menu"
                />
                <ValueRow
                    label="Stock synced"
                    value={ago(sync.lastStockSyncAt, now)}
                    testID="device-sync-stock"
                />
                <ValueRow
                    label="Orders synced"
                    value={ago(sync.lastOutboxSyncAt, now)}
                    testID="device-sync-orders"
                />
            </RowList>
            <ActionRow>
                <Button
                    title="Sync now"
                    leftIcon="sync"
                    variant="secondary"
                    loading={sync.syncing}
                    disabled={!sync.online || sync.syncing}
                    onPress={state.syncNow}
                    testID="device-sync-now"
                />
                <Button
                    title={
                        state.showFailed
                            ? "Hide failed sales"
                            : "View failed sales"
                    }
                    leftIcon="alert-circle-outline"
                    variant="secondary"
                    disabled={sync.failed === 0 && !state.showFailed}
                    onPress={state.toggleFailed}
                    testID="device-view-failed"
                />
            </ActionRow>
            {state.showFailed ? <FailedSales state={state} /> : null}
        </InfoCard>
    );
}

function FailedSales({ state }: { state: ThisTabletState }) {
    if (state.failedSales === null)
        return <Text style={styles.muted}>Loading…</Text>;
    if (state.failedSales.length === 0)
        return <Text style={styles.muted}>No failed sales.</Text>;
    return (
        <View style={styles.failedList} testID="device-failed-list">
            {state.failedSales.map((sale) => (
                <View
                    key={sale.ulid}
                    style={styles.failedRow}
                    testID={`device-failed-${sale.ulid}`}
                >
                    <View style={styles.failedHead}>
                        <Text style={styles.failedNo} numberOfLines={1}>
                            {sale.orderNo ?? sale.ulid.slice(-6)}
                        </Text>
                        <Text style={styles.failedTotal}>
                            {formatPeso(sale.order.total_cents)}
                        </Text>
                    </View>
                    <Text style={styles.muted}>
                        {ago(sale.createdAt, state.now)}
                    </Text>
                    <Text style={styles.failedError}>
                        {sale.lastError ??
                            "The server could not store this sale."}
                    </Text>
                </View>
            ))}
        </View>
    );
}

function PrintersCard({ state }: { state: ThisTabletState }) {
    return (
        <InfoCard
            title="Printers"
            icon="print-outline"
            testID="device-printers"
        >
            {state.printers.length === 0 ? (
                <Text style={styles.muted}>No printers are set up.</Text>
            ) : null}
            {state.printers.map((row) => {
                const test = state.printerTests[row.printer.id];
                let label = "Not checked";
                let variant: "success" | "danger" | "neutral" = "neutral";
                if (row.ok === true) {
                    label = "OK";
                    variant = "success";
                } else if (row.ok === false) {
                    label = "Not responding";
                    variant = "danger";
                }
                return (
                    <View
                        key={row.printer.id}
                        style={styles.printerRow}
                        testID={`device-printer-${row.printer.id}`}
                    >
                        <View style={styles.printerHead}>
                            <Text style={styles.printerName} numberOfLines={2}>
                                {row.printer.name}
                                {row.isReceipt ? " (receipts)" : ""}
                            </Text>
                            <Chip
                                label={label}
                                variant={variant}
                                size="sm"
                                testID={`device-printer-${row.printer.id}-status`}
                            />
                        </View>
                        {test ? (
                            <Text style={styles.muted}>{test.message}</Text>
                        ) : null}
                        {state.canTestPrint ? (
                            <Button
                                title="Test print"
                                leftIcon="document-text-outline"
                                variant="secondary"
                                loading={state.testing[row.printer.id] ?? false}
                                disabled={
                                    state.testing[row.printer.id] ?? false
                                }
                                onPress={() => state.runTestPrint(row.printer)}
                                testID={`device-printer-${row.printer.id}-test`}
                            />
                        ) : null}
                    </View>
                );
            })}
        </InfoCard>
    );
}

function ReportsCard({ state }: { state: ThisTabletState }) {
    return (
        <InfoCard
            title="Error reports"
            icon="bug-outline"
            testID="device-errors"
        >
            <ValueRow
                label="Waiting to send"
                value={String(state.errorsPending)}
                testID="device-errors-pending"
            />
            <ActionRow>
                <Button
                    title="Send now"
                    leftIcon="cloud-upload-outline"
                    variant="secondary"
                    loading={state.sendingErrors}
                    disabled={state.sendingErrors || state.errorsPending === 0}
                    onPress={state.sendErrorsNow}
                    testID="device-errors-send"
                />
            </ActionRow>
            <Text style={styles.sectionTitle}>Send diagnostics</Text>
            <Text style={styles.muted}>
                Sends this tablet’s status and any waiting error reports to your
                manager now.
            </Text>
            <ActionRow>
                <Button
                    title="Send diagnostics"
                    leftIcon="paper-plane-outline"
                    loading={state.sendingDiagnostics}
                    disabled={state.sendingDiagnostics}
                    onPress={state.sendDiagnostics}
                    testID="device-send-diagnostics"
                />
            </ActionRow>
            {state.diagnosticsSentAt ? (
                <Banner
                    variant="success"
                    message={`Sent at ${formatClockTime(new Date(state.diagnosticsSentAt).toISOString()) ?? ""}`}
                    testID="device-diagnostics-sent"
                />
            ) : null}
        </InfoCard>
    );
}

/**
 * "This tablet" (Hardening & Pilot §E), for every signed-in user: the setup
 * checklist on top, then Server, This tablet, Sync, Printers and Error
 * reports with Send diagnostics. Two columns in tablet landscape, one in portrait and on phones; it
 * scrolls, and rotation re-lays out in place.
 */
export function ThisTabletScreen() {
    const state = useThisTablet();
    const {
        isTwoPane,
        screenPaddingX,
        screenPaddingY,
        contentMaxWidth,
        gutter,
    } = useResponsive();

    const left = (
        <>
            <ServerCard state={state} />
            <TabletCard state={state} />
            <ReportsCard state={state} />
        </>
    );
    const right = (
        <>
            <SyncCard state={state} />
            <PrintersCard state={state} />
        </>
    );

    return (
        <Screen edges={[]} testID="this-tablet-screen">
            <ListHeader
                title="This tablet"
                subtitle="Setup and health"
                testIDPrefix="device"
            />
            <SafeAreaView
                edges={["left", "right", "bottom"]}
                style={styles.body}
            >
                <ScrollView
                    contentContainerStyle={[
                        styles.content,
                        {
                            paddingHorizontal: screenPaddingX,
                            paddingVertical: screenPaddingY,
                            maxWidth: contentMaxWidth,
                            gap: gutter,
                        },
                    ]}
                >
                    <ChecklistCard state={state} />
                    {isTwoPane ? (
                        <View style={[styles.columns, { gap: gutter }]}>
                            <View style={[styles.column, { gap: gutter }]}>
                                {left}
                            </View>
                            <View style={[styles.column, { gap: gutter }]}>
                                {right}
                            </View>
                        </View>
                    ) : (
                        <>
                            {left}
                            {right}
                        </>
                    )}
                </ScrollView>
            </SafeAreaView>
        </Screen>
    );
}

const styles = StyleSheet.create({
    body: {
        flex: 1,
    },
    content: {
        width: "100%",
        alignSelf: "center",
    },
    columns: {
        flexDirection: "row",
        alignItems: "flex-start",
    },
    column: {
        flex: 1,
        minWidth: 0,
    },
    summary: {
        ...typography.bodyStrong,
        color: colors.text,
    },
    sectionTitle: {
        ...typography.label,
        color: colors.text,
        marginTop: spacing.sm,
    },
    muted: {
        ...typography.bodySm,
        color: colors.textSecondary,
    },
    failedList: {
        gap: spacing.sm,
    },
    failedRow: {
        gap: spacing.xxs,
        paddingVertical: spacing.sm,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: colors.divider,
    },
    failedHead: {
        flexDirection: "row",
        justifyContent: "space-between",
        gap: spacing.sm,
    },
    failedNo: {
        ...typography.bodyStrong,
        color: colors.text,
        flexShrink: 1,
    },
    failedTotal: {
        ...typography.bodyStrong,
        color: colors.text,
    },
    failedError: {
        ...typography.bodySm,
        color: colors.dangerText,
    },
    printerRow: {
        gap: spacing.sm,
        paddingVertical: spacing.sm,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: colors.divider,
    },
    printerHead: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: spacing.sm,
    },
    printerName: {
        ...typography.bodyStrong,
        color: colors.text,
        flexShrink: 1,
    },
});
