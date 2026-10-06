/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import { useEffect, useState } from "@webpack/common";

import { CosmeticField, EMPTY_FIELDS, Preset } from "./types";

const STORE_KEY = "ProfilePresets_presets_v1";
const BACKUP_KEY = "ProfilePresets_autoBackup_v1";

const ALL_FIELDS: CosmeticField[] = [
    "globalName", "avatar", "banner", "bio", "pronouns",
    "accentColor", "themeColors", "avatarDecoration", "profileEffect", "nameplate", "profileFrame", "displayNameStyle"
];

let cache: Preset[] = [];
let loaded = false;
const listeners = new Set<() => void>();

function emit() {
    for (const l of [...listeners]) l();
}

/** Synchronous read of the in-memory cache. Safe to call from render. */
export function getPresets(): Preset[] {
    return cache;
}

export async function loadPresets(): Promise<Preset[]> {
    cache = (await DataStore.get<Preset[]>(STORE_KEY)) ?? [];
    // migrate/repair: guarantee every preset has all keys we expect
    cache = cache.map(p => ({
        ...p,
        // early versions named presets after the day they were captured
        name: /^Mevcut profil/.test(p.name ?? "") ? `Preset ${p.slot}` : p.name,
        include: p.include ?? [...ALL_FIELDS],
        fields: { ...EMPTY_FIELDS, ...p.fields }
    }));
    loaded = true;
    emit();
    return cache;
}

async function persist() {
    await DataStore.set(STORE_KEY, cache);
    emit();
}

export function getPresetBySlot(slot: number): Preset | undefined {
    return cache.find(p => p.slot === slot);
}

export function createPreset(name?: string, forcedSlot?: number): Preset {
    const slot = forcedSlot ?? (cache.length ? Math.max(...cache.map(p => p.slot)) + 1 : 1);
    return {
        id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        name: name || `Preset ${slot}`,
        slot,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        include: [...ALL_FIELDS],
        fields: { ...EMPTY_FIELDS }
    };
}

export async function upsertPreset(preset: Preset) {
    const idx = cache.findIndex(p => p.id === preset.id);
    const next = { ...preset, updatedAt: Date.now() };
    if (idx === -1) cache = [...cache, next];
    else cache = cache.map((p, i) => (i === idx ? next : p));
    await persist();
}

export async function deletePreset(id: string) {
    cache = cache.filter(p => p.id !== id);
    await persist();
}

export async function replaceAll(presets: Preset[]) {
    cache = presets;
    await persist();
}

/** The snapshot taken right before the last "apply", so a bad switch is undoable. */
export async function setAutoBackup(preset: Preset | null) {
    await DataStore.set(BACKUP_KEY, preset);
}

export function getAutoBackup(): Promise<Preset | null> {
    return DataStore.get<Preset>(BACKUP_KEY).then(v => v ?? null);
}

/** React hook: re-renders whenever the preset list changes. */
export function usePresets(): Preset[] {
    const [, setTick] = useState(0);

    useEffect(() => {
        const cb = () => setTick(t => t + 1);
        listeners.add(cb);
        if (!loaded) loadPresets();
        return () => void listeners.delete(cb);
    }, []);

    return cache;
}

export { ALL_FIELDS };
