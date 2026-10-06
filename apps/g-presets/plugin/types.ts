/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/** Every profile cosmetic a preset can carry. */
export type CosmeticField =
    | "globalName"
    | "avatar"
    | "banner"
    | "bio"
    | "pronouns"
    | "accentColor"
    | "themeColors"
    | "avatarDecoration"
    | "profileEffect"
    | "nameplate"
    | "profileFrame"
    | "displayNameStyle";

export const ACCOUNT_FIELDS = ["globalName", "avatar"] as const;
export const PROFILE_FIELDS = [
    "banner", "bio", "pronouns", "accentColor", "themeColors",
    "avatarDecoration", "profileEffect", "nameplate", "profileFrame", "displayNameStyle"
] as const;

export const FIELD_LABELS: Record<CosmeticField, string> = {
    globalName: "Görünen ad",
    avatar: "Avatar",
    banner: "Banner",
    bio: "Hakkımda",
    pronouns: "Zamirler",
    accentColor: "Vurgu rengi",
    themeColors: "Profil teması",
    avatarDecoration: "Avatar dekorasyonu",
    profileEffect: "Profil efekti",
    nameplate: "İsimlik (nameplate)",
    profileFrame: "Profil çerçevesi",
    displayNameStyle: "Görünen ad stili"
};

/** Fields that require Nitro; used purely to give better error messages. */
export const NITRO_FIELDS: CosmeticField[] = [
    "banner", "themeColors", "profileEffect", "profileFrame", "displayNameStyle"
];

/**
 * A collectible (avatar decoration / profile effect / nameplate).
 * `skuId` null means "remove this collectible".
 */
export interface CollectibleRef {
    skuId: string | null;
    /** asset hash, only used to render a preview in our UI */
    asset?: string | null;
    /** human readable name, only used in our UI */
    label?: string | null;
}

/** Font, effect and gradient colours behind Discord's "Görünen Ad Stili". */
export interface DisplayNameStyle {
    fontId: number | null;
    effectId: number | null;
    colors: number[] | null;
}

export interface PresetFields {
    globalName: string | null;
    /** data URI (data:image/png;base64,...) or null to remove */
    avatar: string | null;
    banner: string | null;
    /**
     * CDN hashes the images were captured from. Discord rate limits avatar changes, so an
     * apply that would upload the identical image must be skipped rather than spent.
     */
    avatarHash: string | null;
    bannerHash: string | null;
    bio: string | null;
    pronouns: string | null;
    /** 0xRRGGBB integer */
    accentColor: number | null;
    /** [primary, secondary] as 0xRRGGBB integers */
    themeColors: [number, number] | null;
    avatarDecoration: CollectibleRef | null;
    profileEffect: CollectibleRef | null;
    nameplate: CollectibleRef | null;
    profileFrame: CollectibleRef | null;
    displayNameStyle: DisplayNameStyle | null;
}

export interface Preset {
    id: string;
    name: string;
    /** quick-switch slot number shown in the UI and toolbox */
    slot: number;
    createdAt: number;
    updatedAt: number;
    /** fields NOT listed here are left completely untouched when applying */
    include: CosmeticField[];
    fields: PresetFields;
}

export type ApplyStatus = "ok" | "skipped" | "failed";

export interface ApplyResult {
    field: CosmeticField;
    status: ApplyStatus;
    /** human readable reason, shown in the result panel */
    detail?: string;
}

export const EMPTY_FIELDS: PresetFields = {
    globalName: null,
    avatar: null,
    banner: null,
    avatarHash: null,
    bannerHash: null,
    bio: null,
    pronouns: null,
    accentColor: null,
    themeColors: null,
    avatarDecoration: null,
    profileEffect: null,
    nameplate: null,
    profileFrame: null,
    displayNameStyle: null
};
