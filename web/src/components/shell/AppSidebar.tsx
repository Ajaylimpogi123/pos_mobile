/**
 * The app sidebar (MASTER §2.1; legacy `app-sidebar.jsx` look): the round
 * logo, the modules from `@/constants/modules`
 * grouped and filtered by `me.permissions`, and the user tile with the terminal.
 */
import { LogOutIcon, PlusIcon } from "lucide-react";
import { Link, useLocation } from "react-router";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
    Sidebar,
    SidebarContent,
    SidebarFooter,
    SidebarGroup,
    SidebarGroupLabel,
    SidebarHeader,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
    useSidebar,
} from "@/components/ui/sidebar";
import {
    MODULE_GROUP_LABELS,
    type AppModule,
    type ModuleGroup,
} from "@/constants/modules";
import { useLogout } from "@/hooks/useAuth";
import { useVisibleModules } from "@/hooks/useModules";
import { cn } from "@/lib/utils";
import { registeredDevice, useSessionStore } from "@/stores/session";

import { ModuleBadge } from "./ModuleBadge";

const GROUP_ORDER: ModuleGroup[] = [
    "main",
    "catalogue",
    "stock",
    "people",
    "settings",
];

/** The module whose path is the longest prefix of the current path (so /staff/12 is Staff, /staff/roles is Roles). */
function activeModuleKey(modules: readonly AppModule[], pathname: string): string | null {
    let best: AppModule | null = null;
    for (const module of modules) {
        const matches = pathname === module.path || pathname.startsWith(`${module.path}/`);
        if (matches && (!best || module.path.length > best.path.length)) best = module;
    }
    return best?.key ?? null;
}

function initials(name: string): string {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    return (
        (
            (parts[0]?.[0] ?? "") +
            (parts.length > 1 ? parts[parts.length - 1][0] : "")
        ).toUpperCase() || "?"
    );
}

export function AppSidebar() {
    const modules = useVisibleModules();
    const user = useSessionStore((state) => state.user);
    const device = registeredDevice(useSessionStore((state) => state.device));
    const { open, isDrawer, setDrawerOpen } = useSidebar();
    const { logout, pending } = useLogout();
    const expanded = open || isDrawer;
    const { pathname } = useLocation();
    const activeKey = activeModuleKey(modules, pathname);
    const pos = modules.find((module) => module.key === "pos");
    const canSell = pos !== undefined && pos.ready;

    function closeDrawer() {
        if (isDrawer) setDrawerOpen(false);
    }

    return (
        <Sidebar label="Main">
            <SidebarHeader className="items-center">
                <img
                    src={`${import.meta.env.BASE_URL}logo.png`}
                    alt="Mama Bing's Fried Chicken"
                    className={cn(
                        "rounded-full object-cover",
                        expanded ? "size-16" : "size-9",
                    )}
                />
                {/* MASTER §2.1: the dark New sale button under the logo (icon-only on the rail). */}
                {canSell ? (
                    <Button
                        asChild
                        variant="default"
                        size={expanded ? "default" : "icon"}
                        className={cn(expanded && "w-full")}
                    >
                        <Link
                            to="/sell"
                            onClick={closeDrawer}
                            aria-label={expanded ? undefined : "New sale"}
                            title={expanded ? undefined : "New sale"}
                        >
                            <PlusIcon aria-hidden="true" />
                            {expanded ? "New sale" : null}
                        </Link>
                    </Button>
                ) : null}
            </SidebarHeader>

            <SidebarContent>
                {GROUP_ORDER.map((group) => {
                    const items = modules.filter(
                        (module) => module.group === group,
                    );
                    if (items.length === 0) return null;
                    const heading = MODULE_GROUP_LABELS[group];
                    return (
                        <SidebarGroup key={group}>
                            {heading ? (
                                <SidebarGroupLabel>{heading}</SidebarGroupLabel>
                            ) : null}
                            <SidebarMenu>
                                {items.map((module) => {
                                    const Icon = module.icon;
                                    return (
                                        <SidebarMenuItem key={module.key}>
                                            {module.ready ? (
                                                <SidebarMenuButton
                                                    asChild
                                                    tooltip={module.label}
                                                >
                                                    {/* Active: the longest matching path (Order History vs Needs review, Staff vs Roles). */}
                                                    <Link
                                                        to={module.path}
                                                        aria-current={
                                                            activeKey ===
                                                            module.key
                                                                ? "page"
                                                                : undefined
                                                        }
                                                        onClick={closeDrawer}
                                                        className={cn(
                                                            module.badge &&
                                                                "relative",
                                                        )}
                                                    >
                                                        <Icon aria-hidden="true" />
                                                        <span
                                                            className={cn(
                                                                expanded
                                                                    ? "flex-1"
                                                                    : "sr-only",
                                                            )}
                                                        >
                                                            {module.label}
                                                        </span>
                                                        {module.badge ? (
                                                            <ModuleBadge
                                                                kind={
                                                                    module.badge
                                                                }
                                                                compact={
                                                                    !expanded
                                                                }
                                                            />
                                                        ) : null}
                                                    </Link>
                                                </SidebarMenuButton>
                                            ) : (
                                                <SidebarMenuButton
                                                    aria-disabled="true"
                                                    tabIndex={-1}
                                                    tooltip={`${module.label} (soon)`}
                                                >
                                                    <Icon aria-hidden="true" />
                                                    <span
                                                        className={cn(
                                                            "flex-1",
                                                            !expanded &&
                                                                "sr-only",
                                                        )}
                                                    >
                                                        {module.label}
                                                    </span>
                                                    {expanded ? (
                                                        <Badge tone="outline" className="font-medium text-muted-foreground">
                                                            Soon
                                                        </Badge>
                                                    ) : (
                                                        <span className="sr-only">
                                                            , coming soon
                                                        </span>
                                                    )}
                                                </SidebarMenuButton>
                                            )}
                                        </SidebarMenuItem>
                                    );
                                })}
                            </SidebarMenu>
                        </SidebarGroup>
                    );
                })}
            </SidebarContent>

            <SidebarFooter>
                {user ? (
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <button
                                type="button"
                                className="flex w-full items-center gap-2 rounded-lg p-2 text-left hover:bg-sidebar-accent"
                                aria-label={`Account: ${user.name}`}
                            >
                                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent text-xs font-bold">
                                    {initials(user.name)}
                                </span>
                                {expanded ? (
                                    <span className="min-w-0 flex-1">
                                        <span className="block truncate text-sm font-semibold">
                                            {user.name}
                                        </span>
                                        <span className="block truncate text-xs text-muted-foreground">
                                            {user.role.name}
                                            {device ? ` · ${device.code}` : ""}
                                        </span>
                                    </span>
                                ) : null}
                            </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                            side="top"
                            align="start"
                            className="w-60"
                        >
                            <DropdownMenuLabel>
                                <span className="block text-sm text-foreground">
                                    {user.name}
                                </span>
                                <span className="block font-normal">
                                    {user.email}
                                </span>
                                <span className="block font-normal">
                                    {user.branch.name}
                                    {device ? ` · Terminal ${device.code}` : ""}
                                </span>
                            </DropdownMenuLabel>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                                disabled={pending}
                                onSelect={() => void logout()}
                            >
                                <LogOutIcon aria-hidden="true" />
                                Log out
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                ) : null}
            </SidebarFooter>
        </Sidebar>
    );
}
