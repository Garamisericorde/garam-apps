/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Locates the module that renders Discord's profile customisation page, so a patch anchor
 * can be verified against the running client instead of guessed. Purely diagnostic: it
 * reads webpack factory sources and logs, nothing else.
 *
 * The lead: the page keeps its unsaved edits in `pending*` fields, which nothing else does.
 */

import { search } from "@webpack";

const TAG = "[ProfilePresets-DIAG]";

const PENDING_KEYS = [
    "pendingNameplate",
    "pendingProfileEffect",
    "pendingAvatarDecoration",
    "pendingThemeColors",
    "pendingGlobalName",
    "pendingBio",
    "pendingBanner"
];

function contextAround(src: string, needles: string[], before = 700, after = 1100) {
    for (const n of needles) {
        const i = src.indexOf(n);
        if (i !== -1) return src.slice(Math.max(0, i - before), i + after);
    }
    return null;
}

export function runDiagnostics() {
    const perKey: Record<string, string[]> = {};
    for (const k of PENDING_KEYS) {
        try {
            perKey[k] = Object.keys(search(k));
        } catch (e) {
            perKey[k] = [`HATA:${String(e)}`];
        }
    }
    console.log(`${TAG} pending anahtarlari\n` + JSON.stringify(perKey, null, 1));

    // Modules carrying several pending keys at once are the customisation page, not the shop.
    // The shop modal is enormous, so prefer the smallest candidates.
    const combos = [
        ["pendingNameplate", "pendingThemeColors"],
        ["pendingNameplate", "pendingProfileEffect", "pendingGlobalName"],
        ["pendingAvatarDecoration", "pendingBio"],
        ["pendingNameplate", "pendingAvatarDecoration"]
    ];

    for (const combo of combos) {
        const hits = search(...combo);
        const entries = Object.entries(hits)
            .map(([id, f]) => ({ id, src: String(f) }))
            .sort((a, b) => a.src.length - b.src.length);

        if (!entries.length) continue;

        console.log(`${TAG} kombinasyon [${combo.join("+")}] -> ` +
            JSON.stringify(entries.map(e => `${e.id}:${e.src.length}`)));

        for (const e of entries.slice(0, 2)) {
            const ctx = contextAround(e.src, combo);
            console.log(`${TAG} baglam modul ${e.id} (uzunluk ${e.src.length})\n${ctx}`);
        }
        console.log(`${TAG} bitti`);
        return;
    }

    console.log(`${TAG} hicbir kombinasyon eslesmedi — yukaridaki listeye bak`);
}
