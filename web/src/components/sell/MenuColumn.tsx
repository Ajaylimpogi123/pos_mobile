/**
 * The Sell menu column (sell.md → Menu column; legacy `CategoryItems.jsx`):
 * the Search group on the band, the category tiles, and the product grid.
 *
 * Keyboard (sell.md): `/` focuses search (handled by the page), the arrow keys
 * move between products, and `Enter` adds the highlighted product (also from
 * the search box, so "type, Enter" adds the first match).
 */
import { CheckIcon, SearchIcon, UtensilsIcon } from "lucide-react";
import {
    forwardRef,
    useEffect,
    useRef,
    useState,
    type KeyboardEvent,
} from "react";

import { EmptyState, ErrorState } from "@/components/common/ListStates";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Kbd, Skeleton } from "@/components/ui/misc";
import { cn } from "@/lib/utils";
import type { StockBadge } from "@/hooks/useStockBadges";
import type { Category, Product } from "@/services/types";
import { formatPeso } from "@pos/core/money";

import { ProductImage, QtyStepper } from "./SellParts";

type SearchBarProps = {
    value: string;
    onChange: (value: string) => void;
    onEnter: () => void;
    onArrowDown: () => void;
};

export const SearchBar = forwardRef<HTMLInputElement, SearchBarProps>(
    function SearchBar({ value, onChange, onEnter, onArrowDown }, ref) {
        function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
            if (event.key === "Enter") {
                event.preventDefault();
                onEnter();
            } else if (event.key === "ArrowDown") {
                event.preventDefault();
                onArrowDown();
            } else if (event.key === "Escape" && value !== "") {
                event.preventDefault();
                onChange("");
            }
        }
        return (
            <div className="flex flex-col gap-1.5">
                <label
                    htmlFor="sell-search"
                    className="flex items-center gap-2 text-sm font-semibold text-on-band"
                >
                    Search
                    <Kbd aria-hidden="true">/</Kbd>
                </label>
                <div className="flex">
                    <Input
                        ref={ref}
                        id="sell-search"
                        type="search"
                        value={value}
                        onChange={(event) => onChange(event.target.value)}
                        onKeyDown={onKeyDown}
                        placeholder="Search by name or SKU"
                        autoComplete="off"
                        className="h-11 rounded-r-none"
                        aria-describedby="sell-search-hint"
                    />
                    <Button
                        variant="outline"
                        className="h-11 rounded-l-none border-l-0"
                        onClick={onEnter}
                        aria-describedby="sell-search-hint"
                    >
                        <SearchIcon aria-hidden="true" />
                        Search
                    </Button>
                </div>
                <p id="sell-search-hint" className="sr-only">
                    Press Enter to add the highlighted product, or the down
                    arrow to move to the products.
                </p>
            </div>
        );
    },
);

type CategoryTilesProps = {
    categories: Category[];
    activeId: number | null;
    onSelect: (id: number | null) => void;
    loading: boolean;
};

function itemsText(count: number): string {
    return `${count} ${count === 1 ? "item" : "items"}`;
}

export function CategoryTiles({
    categories,
    activeId,
    onSelect,
    loading,
}: CategoryTilesProps) {
    const total = categories.reduce(
        (sum, category) => sum + category.products_count,
        0,
    );
    const tiles: { id: number | null; name: string; count: number }[] = [
        { id: null, name: "All", count: total },
        ...categories.map((category) => ({
            id: category.id,
            name: category.name,
            count: category.products_count,
        })),
    ];

    function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
        if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
        event.preventDefault();
        const index = tiles.findIndex((tile) => tile.id === activeId);
        const next =
            tiles[
                (index + (event.key === "ArrowRight" ? 1 : -1) + tiles.length) %
                    tiles.length
            ];
        onSelect(next.id);
        const button = event.currentTarget.querySelector<HTMLButtonElement>(
            `[data-tile="${next.id ?? "all"}"]`,
        );
        button?.focus();
    }

    return (
        <Card className="p-3">
            {loading ? (
                <div className="flex gap-2 overflow-hidden" aria-busy="true">
                    {Array.from({ length: 5 }, (_, index) => (
                        <Skeleton
                            key={index}
                            className="h-[100px] w-[136px] shrink-0"
                        />
                    ))}
                </div>
            ) : (
                <div
                    role="tablist"
                    aria-label="Categories"
                    className="flex gap-2 overflow-x-auto pb-1"
                    onKeyDown={onKeyDown}
                >
                    {tiles.map((tile) => {
                        const active = tile.id === activeId;
                        return (
                            <button
                                key={tile.id ?? "all"}
                                type="button"
                                role="tab"
                                data-tile={tile.id ?? "all"}
                                aria-selected={active}
                                tabIndex={active ? 0 : -1}
                                onClick={() => onSelect(tile.id)}
                                className={cn(
                                    "flex w-[136px] shrink-0 flex-col items-center gap-1 rounded-lg px-2 py-2.5",
                                    active
                                        ? "tile-active border-b-4 border-green-line shadow-tile"
                                        : "tile-inactive border-t-4 border-tile-border hover:border-green-line",
                                )}
                            >
                                <span
                                    className={cn(
                                        "flex size-10 items-center justify-center rounded-full",
                                        active ? "bg-green-chip" : "bg-card",
                                    )}
                                >
                                    <UtensilsIcon
                                        className="size-5"
                                        aria-hidden="true"
                                    />
                                </span>
                                <span className="line-clamp-1 text-[15px] font-medium">
                                    {tile.name}
                                </span>
                                <span className="text-xs text-ink-muted tabular">
                                    {itemsText(tile.count)}
                                </span>
                            </button>
                        );
                    })}
                </div>
            )}
        </Card>
    );
}

type ProductGridProps = {
    products: Product[];
    loading: boolean;
    error: string | null;
    onRetry: () => void;
    highlight: number;
    onHighlight: (index: number) => void;
    /** Adds `qty` of the product; returns whether it went into the cart. */
    onAdd: (product: Product, qty: number) => boolean;
    /** Bumped by the search box's ArrowDown: focus the highlighted card. */
    focusRequest: number;
    searching: boolean;
    locked: boolean;
    /** Advisory stock badges by product id (`useStockBadges`). */
    badges: ReadonlyMap<number, StockBadge>;
};

export function ProductGrid({
    products,
    loading,
    error,
    onRetry,
    highlight,
    onHighlight,
    onAdd,
    focusRequest,
    searching,
    locked,
    badges,
}: ProductGridProps) {
    const gridRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (focusRequest === 0) return;
        gridRef.current
            ?.querySelector<HTMLElement>(`[data-index="${highlight}"]`)
            ?.focus();
        // Only a new request moves focus (not every highlight change).
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [focusRequest]);

    if (loading) {
        return (
            <div
                className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-4"
                aria-busy="true"
            >
                <span className="sr-only">Loading the menu…</span>
                {Array.from({ length: 8 }, (_, index) => (
                    <Skeleton key={index} className="h-[340px] rounded-xl" />
                ))}
            </div>
        );
    }
    if (error) {
        return (
            <Card>
                <ErrorState
                    title="Couldn't load the menu"
                    message={error}
                    onRetry={onRetry}
                />
            </Card>
        );
    }
    if (products.length === 0) {
        return (
            <Card>
                <EmptyState
                    title={
                        searching
                            ? "No products match your search"
                            : "No products in this category"
                    }
                    message={
                        searching
                            ? "Check the spelling, or search by SKU."
                            : "Pick another category, or add products in the back-office."
                    }
                />
            </Card>
        );
    }

    function columnsCount(): number {
        const grid = gridRef.current;
        if (!grid) return 1;
        return Math.max(
            1,
            window
                .getComputedStyle(grid)
                .gridTemplateColumns.split(" ")
                .filter(Boolean).length,
        );
    }

    function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
        const target = event.target as HTMLElement;
        if (!target.dataset.index) return;
        const columns = columnsCount();
        const moves: Record<string, number> = {
            ArrowRight: 1,
            ArrowLeft: -1,
            ArrowDown: columns,
            ArrowUp: -columns,
        };
        const move = moves[event.key];
        if (move === undefined) return;
        event.preventDefault();
        const next = Math.min(
            products.length - 1,
            Math.max(0, highlight + move),
        );
        onHighlight(next);
        gridRef.current
            ?.querySelector<HTMLElement>(`[data-index="${next}"]`)
            ?.focus();
    }

    return (
        <div
            ref={gridRef}
            className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-4"
            onKeyDown={onKeyDown}
            aria-label="Products"
            role="list"
        >
            {products.map((product, index) => (
                <ProductCard
                    key={product.id}
                    product={product}
                    index={index}
                    highlighted={index === highlight}
                    onFocus={() => onHighlight(index)}
                    onAdd={onAdd}
                    stock={badges.get(product.id) ?? null}
                    locked={locked}
                />
            ))}
        </div>
    );
}

type ProductCardProps = {
    product: Product;
    index: number;
    highlighted: boolean;
    onFocus: () => void;
    onAdd: (product: Product, qty: number) => boolean;
    locked: boolean;
    stock: StockBadge | null;
};

/**
 * A product card. Stock badges follow the tablet (Inventory → Sell tile badges, §J):
 * Out / Low for a `track_stock` product, Check stock for a recipe product. They are
 * advisory: adding is never blocked on the client (Q-036).
 */
function ProductCard({
    product,
    index,
    highlighted,
    onFocus,
    onAdd,
    locked,
    stock,
}: ProductCardProps) {
    const [qty, setQty] = useState(1);
    const [added, setAdded] = useState(false);
    const available = product.is_available;
    const badge =
        !available || !stock
            ? null
            : stock.kind === "check"
              ? product.track_stock
                  ? null
                  : stock
              : product.track_stock
                ? stock
                : null;

    useEffect(() => {
        if (!added) return;
        const timer = window.setTimeout(() => setAdded(false), 600);
        return () => window.clearTimeout(timer);
    }, [added]);

    function add() {
        if (!available || locked) return;
        if (onAdd(product, qty)) {
            setAdded(true);
            setQty(1);
        }
    }

    function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
        if (event.key === "Enter" && event.target === event.currentTarget) {
            event.preventDefault();
            add();
        }
    }

    return (
        <div role="listitem" className="contents">
            <div
                data-index={index}
                tabIndex={highlighted ? 0 : -1}
                onFocus={(event) => {
                    if (event.target === event.currentTarget) onFocus();
                }}
                onKeyDown={onKeyDown}
                aria-label={`${product.name}, ${formatPeso(product.price_cents)}${available ? "" : ", unavailable"}${badge ? `, ${badge.label}` : ""}`}
                className={cn(
                    "flex flex-col gap-3 rounded-xl border bg-card p-3.5 shadow-card transition-shadow",
                    highlighted ? "border-green-line" : "border-border",
                )}
            >
                <div className="relative">
                    <ProductImage
                        imageUrl={product.image_url}
                        imagePath={product.image_path}
                        className="aspect-square w-full"
                    />
                    {!available ? (
                        <div className="absolute top-2 right-2">
                            <StatusBadge tone="danger" label="Unavailable" />
                        </div>
                    ) : badge ? (
                        <div className="absolute top-2 right-2">
                            <StatusBadge
                                tone={
                                    badge.kind === "out" ? "danger" : "warning"
                                }
                                label={badge.label}
                            />
                        </div>
                    ) : null}
                </div>
                <div className="flex min-h-0 flex-1 flex-col gap-0.5">
                    <h3 className="line-clamp-2 text-base leading-snug font-bold text-ink-soft">
                        {product.name}
                    </h3>
                    <p className="text-base font-bold text-green tabular">
                        {formatPeso(product.price_cents)}
                    </p>
                </div>
                {available ? (
                    <div className="flex justify-center">
                        <QtyStepper
                            value={qty}
                            onChange={setQty}
                            label={`quantity of ${product.name}`}
                            disabled={locked}
                        />
                    </div>
                ) : null}
                <Button
                    variant="green"
                    className="h-10 w-full text-[15px]"
                    onClick={add}
                    disabled={!available || locked}
                >
                    {!available ? (
                        "Unavailable"
                    ) : added ? (
                        <>
                            Added
                            <CheckIcon aria-hidden="true" />
                        </>
                    ) : (
                        `+ Add (${qty})`
                    )}
                </Button>
            </div>
        </div>
    );
}
