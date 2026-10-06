/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import ErrorBoundary from "@components/ErrorBoundary";
import { classNameFactory } from "@utils/css";
import { findByCodeLazy, findByPropsLazy } from "@webpack";
import { useState } from "@webpack/common";
import type { CSSProperties, ReactNode } from "react";

import { CollectibleRef, CosmeticField, DisplayNameStyle, Preset } from "../types";
import { collectibleUrls, intToHex } from "./assets";

const cl = classNameFactory("vc-pp-");

const PLACEHOLDER_AVATAR = "https://cdn.discordapp.com/embed/avatars/0.png";

/**
 * `StorefrontProductStore` knows the frame's artwork but only after the product has been
 * fetched, and it exposes no fetch action of its own. The client loads it through this hook
 * — the same one its shop rows use — so ask for the product with fetching enabled.
 */
const useProductForSku = findByCodeLazy("shouldFetchProduct");
const CollectiblesProducts = findByPropsLazy("getProductsForSku");

/**
 * Frames and effects have no single image: their artwork is a stack of anchored layers
 * (`tenantMetadata.collectibles.item.layers`) composited around the profile, and the
 * product carries no thumbnail. Rather than guess at layer URLs, show what the product
 * does state plainly — its name, its colour, and the collection artwork.
 */
function describeSku(products: any, skuId: string) {
    const list = Array.isArray(products) ? products : products ? [products] : [];

    for (const product of list) {
        const sku = product?.skus?.find((x: any) => String(x?.id) === skuId);
        if (!sku && list.length > 1) continue;

        return {
            name: sku?.name ?? product?.name ?? null,
            color: sku?.tenantMetadata?.collectibles?.optionSelectorDisplayValue ?? null,
            background: product?.primaryCollectionPdpBgUrl ?? null
        };
    }
    return null;
}

/** Resolves a collectible that arrives as a bare sku id, such as a frame or an effect. */
function ProductImage({ skuId, label }: { skuId: string; label: string; }) {
    // calling the hook loads the product into StorefrontProductStore when it is missing
    (useProductForSku as any)(skuId, { needsCategory: false, shouldFetchProduct: true });

    let products: any = null;
    try {
        products = (CollectiblesProducts as any)?.getProductsForSku?.(skuId) ?? null;
    } catch { /* store not ready yet */ }

    const info = describeSku(products, skuId);

    if (!info?.name) return <span className={cl("card-sku")}>{label}</span>;

    return (
        <span
            className={cl("card-product")}
            style={info.background ? { backgroundImage: `url(${info.background})` } : undefined}
        >
            <span className={cl("card-product-name")}>
                {info.color && <span className={cl("card-product-dot")} style={{ background: info.color }} />}
                {info.name}
            </span>
        </span>
    );
}

const SafeProductImage = ErrorBoundary.wrap(ProductImage, { noop: true });

/** Walks the candidate CDN paths for a collectible and gives up quietly. */
function CollectibleImg({ field, value, className }: {
    field: CosmeticField;
    value: CollectibleRef;
    className?: string;
}) {
    const [attempt, setAttempt] = useState(0);

    const urls = collectibleUrls(field, value);
    const url = urls[attempt];

    // no asset in the payload (frames) — resolve the artwork through the sku instead
    if (!url) {
        return value.skuId
            ? <SafeProductImage skuId={value.skuId} label={`…${value.skuId.slice(-5)}`} />
            : <span className={cl("card-unknown")}>görsel yok</span>;
    }

    return (
        <img
            className={className ?? cl("card-img")}
            src={url}
            alt=""
            onError={() => setAttempt(a => a + 1)}
        />
    );
}

/** Paints the name with the preset's own gradient, the way Discord previews it. */
function nameStyle(style: DisplayNameStyle | null): CSSProperties | undefined {
    const colors = style?.colors;
    if (!colors?.length) return undefined;

    const stops = colors.map(c => intToHex(c)).filter(Boolean);
    if (!stops.length) return undefined;

    if (stops.length === 1) return { color: stops[0]! };

    return {
        backgroundImage: `linear-gradient(90deg, ${stops.join(", ")})`,
        WebkitBackgroundClip: "text",
        backgroundClip: "text",
        color: "transparent"
    };
}

function Section({ label, children }: { label: string; children: ReactNode; }) {
    return (
        <section className={cl("card-sec")}>
            <span className={cl("card-label")}>{label}</span>
            {children}
        </section>
    );
}

function Tile({ empty, wide, children }: { empty?: boolean; wide?: boolean; children?: ReactNode; }) {
    return (
        <div className={cl("card-tile", wide ? "card-tile-wide" : "", empty ? "card-tile-empty" : "")}>
            {children}
        </div>
    );
}

/**
 * A read-only mirror of Discord's own "Ana Profil" panel, showing exactly what the preset
 * holds. Nothing here is editable — a preset is captured from the live profile, not built
 * by hand.
 */
export function ProfileCard({ preset }: { preset: Preset; }) {
    const f = preset.fields;
    const [top, bottom] = f.themeColors ?? [null, null];

    return (
        <div className={cl("card")}>
            <Section label="İsim Plakası">
                <div className={cl("card-plate", f.nameplate ? "" : "card-tile-empty")}>
                    {f.nameplate
                        ? <CollectibleImg field="nameplate" value={f.nameplate} />
                        : <span className={cl("card-unknown")}>yok</span>}
                    {f.avatar && <img className={cl("card-plate-avatar")} src={f.avatar} alt="" />}
                </div>
            </Section>

            <Section label="Avatar ve Dekorasyonu">
                <div className={cl("card-row")}>
                    <Tile empty={!f.avatar}>
                        {f.avatar
                            ? <img className={cl("card-avatar")} src={f.avatar} alt="" />
                            : <span className={cl("card-unknown")}>yok</span>}
                    </Tile>
                    <Tile empty={!f.avatarDecoration}>
                        {f.avatarDecoration ? (
                            // Discord previews a decoration around its placeholder avatar
                            // rather than yours, so the ring itself stays readable
                            <span className={cl("card-deco")}>
                                <img className={cl("card-deco-avatar")} src={PLACEHOLDER_AVATAR} alt="" />
                                <CollectibleImg
                                    field="avatarDecoration"
                                    value={f.avatarDecoration}
                                    className={cl("card-deco-ring")}
                                />
                            </span>
                        ) : <span className={cl("card-unknown")}>yok</span>}
                    </Tile>
                </div>
            </Section>

            <Section label="Görünen Ad Stili">
                <div className={cl("card-name")}>
                    <span className={cl("card-name-text")} style={nameStyle(f.displayNameStyle)}>
                        {f.globalName || "—"}
                    </span>
                </div>
                {f.displayNameStyle && (
                    <span className={cl("card-note")}>
                        Font #{f.displayNameStyle.fontId ?? "—"} · Efekt #{f.displayNameStyle.effectId ?? "—"}
                        {" — yazı tipi burada önizlenemiyor, uygulanınca doğru görünür"}
                    </span>
                )}
            </Section>

            <Section label="Tema ve Afiş">
                <div className={cl("card-row")}>
                    <Tile empty={!f.themeColors}>
                        {f.themeColors ? (
                            <span
                                className={cl("card-fill")}
                                style={{ background: `linear-gradient(${intToHex(top)}, ${intToHex(bottom)})` }}
                            >
                                <span className={cl("card-dot")} style={{ background: intToHex(top)! }} />
                                <span className={cl("card-dot")} style={{ background: intToHex(bottom)! }} />
                            </span>
                        ) : <span className={cl("card-unknown")}>yok</span>}
                    </Tile>
                    <Tile empty={!f.banner}>
                        {f.banner
                            ? <span className={cl("card-fill")} style={{ backgroundImage: `url(${f.banner})` }} />
                            : <span className={cl("card-unknown")}>yok</span>}
                    </Tile>
                </div>
            </Section>

            <Section label="Profil Efekti ve Çerçeveler">
                <div className={cl("card-row")}>
                    <Tile empty={!f.profileEffect}>
                        {f.profileEffect
                            ? <CollectibleImg field="profileEffect" value={f.profileEffect} />
                            : <span className={cl("card-unknown")}>yok</span>}
                    </Tile>
                    <Tile empty={!f.profileFrame}>
                        {f.profileFrame
                            ? <CollectibleImg field="profileFrame" value={f.profileFrame} />
                            : <span className={cl("card-unknown")}>yok</span>}
                    </Tile>
                </div>
            </Section>

            <Section label="Hakkımda">
                <div className={cl("card-bio", f.bio ? "" : "card-tile-empty")}>
                    {f.bio || "—"}
                </div>
            </Section>
        </div>
    );
}
