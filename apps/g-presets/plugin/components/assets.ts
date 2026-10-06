/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { findByProps, findByPropsLazy } from "@webpack";

import { CollectibleRef, CosmeticField } from "../types";

export function intToHex(n: number | null | undefined): string | null {
    if (n == null || Number.isNaN(n)) return null;
    return "#" + (n & 0xFFFFFF).toString(16).padStart(6, "0");
}

export function hexToInt(hex: string): number {
    return parseInt(hex.replace("#", ""), 16) | 0;
}

export function decorationUrl(asset: string, size = 96) {
    return `https://cdn.discordapp.com/avatar-decoration-presets/${asset}.png?size=${size}&passthrough=true`;
}

/**
 * Collectible CDN paths are undocumented and differ per type, so callers try the
 * candidates in order and fall back to showing the id when none of them load.
 */
export function collectibleUrls(field: CosmeticField, ref: CollectibleRef): string[] {
    const { asset } = ref;

    // frames arrive without an asset, so fall back to resolving the sku through the client
    if (!asset) return ref.skuId ? skuAssetUrls(ref.skuId) : [];

    if (field === "avatarDecoration") return [decorationUrl(asset)];

    if (field === "nameplate" || field === "profileFrame") {
        const base = asset.endsWith("/") ? asset : `${asset}/`;
        return [
            `https://cdn.discordapp.com/assets/collectibles/${base}static.png`,
            `https://cdn.discordapp.com/assets/collectibles/${base}asset.webp`
        ];
    }
    return [];
}

/**
 * The profile payload gives a frame only as a sku id — no asset — yet the client renders
 * it, so it must resolve the sku through its own product store. Pull the asset from there.
 */
const CollectiblesProducts = findByPropsLazy("getProductsForSku");

const ASSET_KEY = /asset|image|src|icon|thumbnail/i;
const logged = new Set<string>();

function collectAssetStrings(node: any, out: Set<string>, depth = 0) {
    if (!node || typeof node !== "object" || depth > 5) return;

    for (const [k, v] of Object.entries(node as Record<string, any>)) {
        if (typeof v === "string" && v && ASSET_KEY.test(k) && !v.includes(" ")) out.add(v);
        else if (v && typeof v === "object") collectAssetStrings(v, out, depth + 1);
    }
}

/** Candidate image URLs for a collectible we only know by sku id. */
export function skuAssetUrls(skuId: string): string[] {
    let products: any;
    try {
        products = (CollectiblesProducts as any)?.getProductsForSku?.(skuId);
    } catch {
        return [];
    }
    if (!products) return [];

    // one-time dump, so an unrecognised product shape can be diagnosed instead of guessed at
    if (!logged.has(skuId)) {
        logged.add(skuId);
        console.debug("[ProfilePresets] sku ürünü", skuId, products);
    }

    const found = new Set<string>();
    collectAssetStrings(products, found);

    const urls: string[] = [];
    for (const value of found) {
        if (value.startsWith("http")) {
            urls.push(value);
            continue;
        }
        const base = value.endsWith("/") ? value : `${value}/`;
        urls.push(
            `https://cdn.discordapp.com/assets/collectibles/${base}static.png`,
            `https://cdn.discordapp.com/assets/collectibles/${base}asset.webp`,
            `https://cdn.discordapp.com/assets/collectibles/${value}.png`
        );
    }
    return urls;
}

/**
 * The store resolves but returns nothing for the sku, which means Discord simply has not
 * fetched that product yet. Find out which methods it exposes and whether a fetch action
 * exists, rather than guessing again.
 */
export function diagnoseSku(skuId: string | null | undefined): string {
    const store: any = CollectiblesProducts;

    const info: Record<string, any> = {
        skuId: skuId ?? null,
        storeResolved: !!store,
        storeName: store?.constructor?.displayName ?? store?.constructor?.name ?? null,
        protoMethods: [],
        calls: {},
        fetchCandidates: {}
    };

    try {
        if (store) {
            const proto = Object.getPrototypeOf(store) ?? {};
            const names = Object.getOwnPropertyNames(proto);
            info.protoMethods = names;

            for (const name of names) {
                if (!/product|sku|collectible|frame/i.test(name)) continue;
                if (typeof store[name] !== "function") continue;
                try {
                    const out = skuId ? store[name](skuId) : store[name]();
                    info.calls[name] = out === undefined ? "undefined" : out;
                } catch (e: any) {
                    info.calls[name] = `HATA: ${String(e?.message ?? e)}`;
                }
            }
        }

        // does anything expose a way to load the product on demand?
        for (const prop of [
            "fetchProductsForSku", "fetchProduct", "fetchCollectiblesProducts",
            "getCollectiblesProducts", "fetchSkuProducts", "fetchCollectibles"
        ]) {
            try {
                info.fetchCandidates[prop] = findByProps(prop) ? "bulundu" : null;
            } catch {
                info.fetchCandidates[prop] = null;
            }
        }
    } catch (e: any) {
        info.error = String(e?.message ?? e);
    }

    return JSON.stringify(info, (_k, v) => (typeof v === "function" ? "[fn]" : v), 1);
}
