/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Discord's collectible endpoints (avatar decorations, profile effects, nameplates) are
 * undocumented, their payload keys change over time, and unknown keys are silently ignored
 * rather than rejected. Rather than guessing, we watch the requests the *real* client makes
 * when you change a cosmetic through Discord's own settings, and reuse what it actually sent.
 *
 * This only observes requests the client already sends. It never sends anything itself.
 */

import * as DataStore from "@api/DataStore";

const CAPTURE_KEY = "ProfilePresets_captures_v2";
const MAX_CAPTURES = 40;

export interface CapturedRequest {
    method: string;
    url: string;
    body: Record<string, any>;
    at: number;
}

/**
 * Wide on purpose: the first version only watched `PATCH /users/@me[/profile]` and missed
 * however Discord actually saves collectibles.
 */
const INTERESTING_URL = /users\/@me|collectible|nameplate|decoration|profile|inventory/i;
const INTERESTING_METHOD = /^(PATCH|POST|PUT)$/;

/** Discord constantly syncs its settings protobuf through the same path; it tells us nothing. */
const NOISE_URL = /settings-proto|guilds\/|channels\/|read-states/i;

const XHR_META = Symbol("ProfilePresets.meta");

let captures: CapturedRequest[] = [];
let installed = false;

let origOpen: typeof XMLHttpRequest.prototype.open | null = null;
let origSend: typeof XMLHttpRequest.prototype.send | null = null;
let origFetch: typeof fetch | null = null;

export function getCaptures(): CapturedRequest[] {
    return captures;
}

export async function loadCaptures() {
    captures = (await DataStore.get<CapturedRequest[]>(CAPTURE_KEY)) ?? [];
}

export async function clearCaptures() {
    captures = [];
    await DataStore.set(CAPTURE_KEY, captures);
}

/** Strips image payloads — they are huge and we already keep our own copies. */
function slim(body: Record<string, any>): Record<string, any> {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(body)) {
        out[k] = typeof v === "string" && v.startsWith("data:")
            ? `<data-uri ${Math.round(v.length / 1024)}kb>`
            : v;
    }
    return out;
}

async function record(method: string, url: string, raw: string) {
    let body: any;
    try {
        body = JSON.parse(raw);
    } catch {
        return; // multipart uploads etc. — nothing for us to learn from
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) return;

    captures = [{ method, url, body: slim(body), at: Date.now() }, ...captures].slice(0, MAX_CAPTURES);
    await DataStore.set(CAPTURE_KEY, captures);
    console.log(`[ProfilePresets] yakalandi ${method} ${url}`, body);
}

function maybeRecord(method: string, url: string, body: unknown) {
    if (!INTERESTING_METHOD.test(method)) return;
    if (!INTERESTING_URL.test(url)) return;
    if (NOISE_URL.test(url)) return;
    if (typeof body !== "string") return;
    void record(method, url, body);
}

export function startCapture() {
    if (installed) return;
    installed = true;

    origOpen = XMLHttpRequest.prototype.open;
    origSend = XMLHttpRequest.prototype.send;
    origFetch = window.fetch;

    XMLHttpRequest.prototype.open = function (this: any, method: string, url: string, ...rest: any[]) {
        this[XHR_META] = { method: String(method).toUpperCase(), url: String(url) };
        return (origOpen as any).call(this, method, url, ...rest);
    } as any;

    XMLHttpRequest.prototype.send = function (this: any, body?: any) {
        const meta = this[XHR_META];
        if (meta) maybeRecord(meta.method, meta.url, body);
        return (origSend as any).call(this, body);
    } as any;

    // Discord mostly uses XHR, but not exclusively
    window.fetch = function (this: any, input: any, init?: any) {
        try {
            const url = typeof input === "string" ? input : input?.url ?? "";
            const method = String(init?.method ?? input?.method ?? "GET").toUpperCase();
            maybeRecord(method, url, init?.body);
        } catch { /* never let logging break a request */ }
        return (origFetch as any).call(this, input, init);
    } as any;
}

export function stopCapture() {
    if (!installed) return;
    if (origOpen) XMLHttpRequest.prototype.open = origOpen;
    if (origSend) XMLHttpRequest.prototype.send = origSend;
    if (origFetch) window.fetch = origFetch;
    installed = false;
}

export function isCapturing() {
    return installed;
}

/** Only self-profile writes can teach us anything about our own payload shapes. */
function profileWrites() {
    return captures.filter(c => /users\/@me/.test(c.url) && c.method === "PATCH");
}

/** `https://discord.com/api/v9/users/@me` -> `/users/@me` */
function toApiPath(url: string): string {
    return url.replace(/^.*?\/api\/v\d+/, "") || "/users/@me";
}

/**
 * Finds the payload key *and endpoint* Discord actually used for a given collectible,
 * e.g. `avatar_decoration_sku_id` on `/users/@me`. Both halves matter — the same key sent
 * to the wrong endpoint is silently ignored.
 */
export function learnedField(match: RegExp): { key: string; url: string; } | null {
    for (const c of profileWrites()) {
        for (const k of Object.keys(c.body)) {
            if (match.test(k)) return { key: k, url: toApiPath(c.url) };
        }
    }
    return null;
}

/** Any captured request whose URL hints at collectibles — shown in the diagnostics panel. */
export function collectibleCaptures() {
    return captures.filter(c => /collectible|nameplate|decoration|inventory/i.test(c.url));
}
