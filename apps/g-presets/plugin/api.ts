/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import { RestAPI, UserStore } from "@webpack/common";

import { urlToDataUri } from "./imageUtils";
import { learnedField } from "./learn";
import {
    ApplyResult, CollectibleRef, CosmeticField, EMPTY_FIELDS, Preset, PresetFields
} from "./types";

const ME = "/users/@me";
const ME_PROFILE = "/users/@me/profile";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export interface RestError {
    status: number;
    message: string;
    body?: any;
}

function toRestError(e: any): RestError {
    const status = e?.status ?? 0;
    const body = e?.body;

    let message: string =
        body?.message ??
        e?.text ??
        String(e?.message ?? e);

    if (body?.errors) message = `${message} ${JSON.stringify(body.errors)}`.trim();

    return { status, message, body };
}

/** PATCH with a single automatic retry when Discord rate limits us. */
async function patch(url: string, body: Record<string, any>): Promise<void> {
    try {
        await RestAPI.patch({ url, body });
    } catch (e: any) {
        const err = toRestError(e);
        if (err.status === 429) {
            const wait = Math.ceil((err.body?.retry_after ?? 1) * 1000) + 250;
            await sleep(wait);
            await RestAPI.patch({ url, body });
            return;
        }
        throw err;
    }
}

/**
 * Animated assets carry an `a_` prefix and are served as gif, but the still formats work
 * for the same hash and a single failing extension used to leave the field silently empty.
 */
function cdnCandidates(kind: "avatars" | "banners", userId: string, hash: string) {
    const base = `https://cdn.discordapp.com/${kind}/${userId}/${hash}`;
    const exts = hash.startsWith("a_") ? ["gif", "png", "webp"] : ["png", "webp", "gif"];
    return exts.map(ext => `${base}.${ext}?size=1024`);
}

/** Filled by the last profile read, so a partial capture can be reported instead of hidden. */
export let lastReadWarnings: string[] = [];

async function downloadFirst(urls: string[], label: string): Promise<string | null> {
    let lastError = "";
    for (const url of urls) {
        try {
            return await urlToDataUri(url);
        } catch (e: any) {
            lastError = String(e?.message ?? e);
        }
    }
    const warning = `${label} indirilemedi (${lastError})`;
    lastReadWarnings.push(warning);
    console.warn(`[ProfilePresets] ${warning}`, urls);
    return null;
}

/**
 * Walks a JSON tree for the first key matching `keyRe` that carries a sku id, in either
 * `{ sku_id }` object form or as a bare id string. Discord keeps moving these fields
 * around, and a hardcoded path that silently returns nothing is worse than no read at all.
 */
function deepFindSku(root: any, keyRe: RegExp, maxDepth = 6): CollectibleRef | null {
    const seen = new Set<any>();

    function walk(node: any, depth: number): CollectibleRef | null {
        if (!node || typeof node !== "object" || depth > maxDepth || seen.has(node)) return null;
        seen.add(node);

        for (const [k, v] of Object.entries(node as Record<string, any>)) {
            if (!keyRe.test(k)) continue;

            if (v && typeof v === "object") {
                const skuId = (v as any).sku_id ?? (v as any).skuId ?? (v as any).id;
                if (skuId) {
                    return {
                        skuId: String(skuId),
                        asset: (v as any).asset ?? null,
                        label: (v as any).label ?? (v as any).name ?? null
                    };
                }
            }
            if (typeof v === "string" && /^\d{6,}$/.test(v)) return { skuId: v };
        }

        for (const v of Object.values(node as Record<string, any>)) {
            const hit = walk(v, depth + 1);
            if (hit) return hit;
        }
        return null;
    }

    return walk(root, 0);
}

/**
 * Profile collectibles come back as an array under `user_profile.collectibles`, holding
 * `{ sku_id, type }` entries — the frame *and* the profile effect live in the same list
 * (type 3 is the frame). Writes use a flat `collectibles_sku_ids` list instead, and
 * `user.collectibles` is an unrelated *object* holding the nameplate. Accept every shape.
 */
const FRAME_TYPE = 3;

interface CollectibleEntry {
    skuId: string;
    type: number | null;
}

function deepFindCollectibles(root: any, maxDepth = 6): CollectibleEntry[] {
    const seen = new Set<any>();

    function walk(node: any, depth: number): CollectibleEntry[] | null {
        if (!node || typeof node !== "object" || depth > maxDepth || seen.has(node)) return null;
        seen.add(node);

        for (const [k, v] of Object.entries(node as Record<string, any>)) {
            if (!/collectibles/i.test(k) || !Array.isArray(v)) continue;

            const entries = v
                .map((x: any) => (typeof x === "string"
                    ? { skuId: x, type: null }
                    : { skuId: x?.sku_id ?? x?.skuId, type: x?.type ?? null }))
                .filter(e => e.skuId)
                .map(e => ({ skuId: String(e.skuId), type: e.type }));

            if (entries.length) return entries;
        }

        for (const v of Object.values(node as Record<string, any>)) {
            const hit = walk(v, depth + 1);
            if (hit) return hit;
        }
        return null;
    }

    return walk(root, 0) ?? [];
}

/** Tries the REST payload first, then the client's own user object. */
function pickCollectible(body: any, user: any, keyRe: RegExp): CollectibleRef | null {
    return deepFindSku(body, keyRe) ?? deepFindSku(user, keyRe, 4);
}

/**
 * Reads the profile that is live on the account right now.
 * With `downloadImages`, avatar/banner are fetched from the CDN and inlined as data
 * URIs so the snapshot can be re-applied later without needing the original files.
 */
export async function fetchCurrentProfile(downloadImages = true): Promise<PresetFields> {
    lastReadWarnings = [];

    const me = UserStore.getCurrentUser();
    if (!me) throw new Error("Hesap bilgisi okunamadı.");

    const { body } = await RestAPI.get({
        url: `/users/${me.id}/profile`,
        query: {
            with_mutual_guilds: false,
            with_mutual_friends: false,
            with_mutual_friends_count: false
        }
    });

    const user = body?.user ?? {};
    const profile = body?.user_profile ?? {};

    const fields: PresetFields = { ...EMPTY_FIELDS };

    fields.globalName = user.global_name ?? null;
    fields.bio = profile.bio ?? user.bio ?? null;
    fields.pronouns = profile.pronouns ?? null;
    // the account-level value is the one the user actually set; the profile copy is
    // often derived from the avatar for people who never picked a colour
    fields.accentColor = user.accent_color ?? profile.accent_color ?? null;
    fields.themeColors = Array.isArray(profile.theme_colors) && profile.theme_colors.length === 2
        ? [profile.theme_colors[0], profile.theme_colors[1]]
        : null;

    // The exact location of the collectibles in this payload is undocumented and has
    // moved between builds, so search the response for the key instead of hardcoding a
    // path. Reading the nameplate wrongly is what made every apply look like a no-op.
    const deco = pickCollectible(body, me, /avatar_?decoration/i);
    if (deco) fields.avatarDecoration = deco;

    const styles = user.display_name_styles ?? profile.display_name_styles ?? null;
    if (styles) {
        fields.displayNameStyle = {
            fontId: styles.font_id ?? null,
            effectId: styles.effect_id ?? null,
            colors: Array.isArray(styles.colors) ? styles.colors.map(Number) : null
        };
    }

    const nameplate = pickCollectible(body, me, /nameplate/i);
    if (nameplate) fields.nameplate = nameplate;

    // frame and effect share one array; only the type tells them apart
    const entries = deepFindCollectibles(body);
    const frame = entries.find(e => e.type === FRAME_TYPE)
        ?? (entries.length === 1 && entries[0].type == null ? entries[0] : null);
    if (frame) fields.profileFrame = { skuId: frame.skuId };

    const effect = pickCollectible(body, me, /profile_?effect/i);
    const otherEntry = entries.find(e => e !== frame);
    if (effect) fields.profileEffect = effect;
    else if (otherEntry) fields.profileEffect = { skuId: otherEntry.skuId };

    const avatarHash = user.avatar ?? null;
    const bannerHash = profile.banner ?? user.banner ?? null;
    fields.avatarHash = avatarHash;
    fields.bannerHash = bannerHash;

    if (downloadImages) {
        if (avatarHash) {
            fields.avatar = await downloadFirst(cdnCandidates("avatars", me.id, avatarHash), "Avatar");
        }
        if (bannerHash) {
            fields.banner = await downloadFirst(cdnCandidates("banners", me.id, bannerHash), "Banner");
        }
    }

    return fields;
}

/**
 * Dumps what the profile endpoint and the client's user object actually contain, with
 * long values trimmed. Guessing where a cosmetic lives has cost several rounds; this
 * shows the payload instead.
 */
export async function dumpProfileShape(): Promise<string> {
    const me: any = UserStore.getCurrentUser();

    const trim = (v: any, depth = 0): any => {
        if (typeof v === "string") return v.length > 120 ? `${v.slice(0, 60)}…(${v.length})` : v;
        if (Array.isArray(v)) return v.slice(0, 10).map(x => trim(x, depth + 1));
        if (v && typeof v === "object" && depth < 6) {
            const out: Record<string, any> = {};
            for (const [k, val] of Object.entries(v)) out[k] = trim(val, depth + 1);
            return out;
        }
        return v;
    };

    let profile: any;
    try {
        profile = await fetchRawProfile();
    } catch (e: any) {
        profile = { error: String(e?.message ?? e) };
    }

    return JSON.stringify({
        profileResponse: trim(profile),
        userStoreUser: trim({
            id: me?.id,
            globalName: me?.globalName,
            avatarDecorationData: me?.avatarDecorationData,
            collectibles: me?.collectibles,
            primaryGuild: me?.primaryGuild,
            keys: Object.keys(me ?? {})
        })
    }, null, 1);
}

/** Raw profile response, for the schema inspector in the UI. */
export async function fetchRawProfile(): Promise<any> {
    const me = UserStore.getCurrentUser();
    const { body } = await RestAPI.get({
        url: `/users/${me.id}/profile`,
        query: { with_mutual_guilds: false, with_mutual_friends: false, with_mutual_friends_count: false }
    });
    return body;
}

// #region collectibles

/**
 * Ground truth, captured from the real client on build 595897: it sends the avatar
 * decoration and the nameplate together in a single request.
 *
 *   PATCH /users/@me  { avatar_decoration_sku_id, nameplate_sku_id }
 *   PATCH /users/@me/profile  { profile_effect_id }
 *
 * An earlier version guessed at shapes and verified each guess against the live profile.
 * That was a mistake: the nameplate could not be read back, so verification always
 * "failed" and the next candidate fired — five writes per apply, which is what actually
 * tripped Discord's cooldown. Mirroring the client exactly means at most two requests.
 */

export type CollectibleField = "avatarDecoration" | "profileEffect" | "nameplate" | "profileFrame";

const LEARN_PATTERNS: Record<CollectibleField, RegExp> = {
    avatarDecoration: /avatar_?decoration/i,
    profileEffect: /profile_?effect/i,
    nameplate: /nameplate/i,
    profileFrame: /profile_?frame/i
};

const ACCOUNT_KEYS: Partial<Record<CollectibleField, string>> = {
    avatarDecoration: "avatar_decoration_sku_id",
    nameplate: "nameplate_sku_id"
};

/**
 * If the real client has been observed writing this cosmetic, prefer the key it used —
 * that is ground truth, whereas ACCOUNT_KEYS carries one educated guess.
 */
function accountKeyFor(field: CollectibleField): string | undefined {
    const learned = learnedField(LEARN_PATTERNS[field]);
    if (learned && learned.url === ME) return learned.key;
    return ACCOUNT_KEYS[field];
}

const STRATEGY_KEY = "ProfilePresets_strategies_v1";

let strategyCache: Partial<Record<CosmeticField, string>> = {};

export async function loadStrategies() {
    strategyCache = (await DataStore.get<typeof strategyCache>(STRATEGY_KEY)) ?? {};
}

export function getStrategies() {
    return strategyCache;
}

export async function forgetStrategies() {
    strategyCache = {};
    await DataStore.set(STRATEGY_KEY, strategyCache);
}

async function rememberStrategy(field: CosmeticField, name: string) {
    strategyCache = { ...strategyCache, [field]: name };
    await DataStore.set(STRATEGY_KEY, strategyCache);
}

function liveSku(fields: PresetFields, field: CollectibleField): string | null {
    return fields[field]?.skuId ?? null;
}

/**
 * A 400 whose `errors` object is keyed by a field we just sent proves Discord *recognised*
 * that field: the shape is right and the value was rejected, usually by a cooldown.
 * Unknown keys are dropped silently instead, so this is how the two are told apart.
 */
function fieldErrors(err: RestError, body: Record<string, any>) {
    const errors = err.body?.errors;
    const out: Record<string, { code: string; message: string; }> = {};
    if (!errors) return out;

    for (const key of Object.keys(body)) {
        const detail = errors[key]?._errors?.[0];
        if (detail) {
            out[key] = {
                code: String(detail.code ?? ""),
                message: String(detail.message ?? "")
            };
        }
    }
    return out;
}

function describe(field: CosmeticField, key: string, e: { code: string; message: string; }) {
    return e.code.endsWith("_RATE_LIMIT")
        ? `Discord bekleme süresi — ${e.message}`
        : `${e.code || "hata"}: ${e.message}`;
}

interface CollectibleWish {
    field: CollectibleField;
    want: string | null;
}

/**
 * Applies all requested collectibles in the same shape the client uses. Anything already
 * at the wanted value is skipped, so switching between presets that share a cosmetic
 * costs nothing against the cooldown.
 */
async function applyCollectibles(wishes: CollectibleWish[], live: PresetFields | null): Promise<ApplyResult[]> {
    const results: ApplyResult[] = [];

    const accountBody: Record<string, any> = {};
    const accountFields: CollectibleField[] = [];
    const profileWishes: CollectibleWish[] = [];

    for (const { field, want } of wishes) {
        if (live && liveSku(live, field) === want) {
            results.push({ field, status: "ok", detail: "zaten ayarlı, istek gönderilmedi" });
            continue;
        }

        const key = accountKeyFor(field);
        if (key) {
            accountBody[key] = want;
            accountFields.push(field);
            continue;
        }

        // handled together below — they share one id list
        profileWishes.push({ field, want });
    }

    if (profileWishes.length) {
        results.push(...await applyProfileCollectibles(profileWishes, live));
        await sleep(300);
    }

    if (!accountFields.length) {
        await confirmCollectibles(wishes, results);
        return results;
    }

    try {
        await patch(ME, accountBody);
        for (const field of accountFields) {
            const key = accountKeyFor(field)!;
            if (strategyCache[field] !== `me:${key}`) await rememberStrategy(field, `me:${key}`);
            results.push({ field, status: "ok", detail: key });
        }
    } catch (e) {
        const err = e as RestError;
        const errs = fieldErrors(err, accountBody);

        const rejected = accountFields.filter(f => errs[ACCOUNT_KEYS[f]!]);
        const bystanders = accountFields.filter(f => !errs[ACCOUNT_KEYS[f]!]);

        // Discord rejects the whole request when any one field is refused, so a cosmetic
        // on cooldown would drag an unrelated one down with it. Resend the survivors alone.
        if (rejected.length && bystanders.length) {
            const retryBody: Record<string, any> = {};
            for (const f of bystanders) retryBody[ACCOUNT_KEYS[f]!] = accountBody[ACCOUNT_KEYS[f]!];

            await sleep(300);
            try {
                await patch(ME, retryBody);
                for (const field of bystanders) {
                    const key = accountKeyFor(field)!;
                    if (strategyCache[field] !== `me:${key}`) await rememberStrategy(field, `me:${key}`);
                    results.push({ field, status: "ok", detail: `${key} (tek başına yeniden gönderildi)` });
                }
            } catch (retryErr) {
                const re = retryErr as RestError;
                const retryErrs = fieldErrors(re, retryBody);
                for (const field of bystanders) {
                    const key = accountKeyFor(field)!;
                    const hit = retryErrs[key];
                    results.push({
                        field,
                        status: "failed",
                        detail: hit ? describe(field, key, hit) : `${re.status}: ${re.message}`
                    });
                }
            }
        } else {
            for (const field of bystanders) {
                results.push({ field, status: "failed", detail: `${err.status}: ${err.message}` });
            }
        }

        for (const field of rejected) {
            const key = accountKeyFor(field)!;
            // the field was understood, so the shape is right — keep it
            if (strategyCache[field] !== `me:${key}`) await rememberStrategy(field, `me:${key}`);
            results.push({ field, status: "failed", detail: describe(field, key, errs[key]) });
        }
    }

    await confirmCollectibles(wishes, results);
    return results;
}

/**
 * The three display-name keys were read off the client's *guild* profile save, so the
 * endpoint that owns them globally is unconfirmed. Discord drops unknown keys silently,
 * so try each candidate and check the profile afterwards rather than trusting a 200.
 */
async function applyDisplayNameStyle(preset: Preset, live: PresetFields | null): Promise<ApplyResult> {
    const field: CosmeticField = "displayNameStyle";
    const st = preset.fields.displayNameStyle;

    const got = live?.displayNameStyle ?? null;
    if (live && JSON.stringify(got) === JSON.stringify(st ?? null)) {
        return { field, status: "ok", detail: "zaten ayarlı, istek gönderilmedi" };
    }

    const body = {
        display_name_font_id: st?.fontId ?? null,
        display_name_effect_id: st?.effectId ?? null,
        display_name_colors: st?.colors ?? null
    };

    const learned = learnedField(/display_name_(font|effect|colors)/i);
    const urls = learned ? [learned.url, ME_PROFILE, ME] : [ME_PROFILE, ME];

    const tried: string[] = [];
    let lastError: string | null = null;

    for (const url of urls) {
        if (tried.includes(url)) continue;
        tried.push(url);

        try {
            await patch(url, body);
        } catch (e) {
            const err = e as RestError;
            const errs = fieldErrors(err, body);
            const hit = errs.display_name_font_id ?? errs.display_name_effect_id ?? errs.display_name_colors;
            if (hit) return { field, status: "failed", detail: describe(field, "display_name_font_id", hit) };

            lastError = `${err.status}: ${err.message}`;
            continue;
        }

        await sleep(350);
        try {
            const live = await fetchCurrentProfile(false);
            const got = live.displayNameStyle;
            if (got?.fontId === (st?.fontId ?? null) && got?.effectId === (st?.effectId ?? null)) {
                await rememberStrategy(field, `${url}:display_name_font_id`);
                return { field, status: "ok", detail: `${url} üzerinden uygulandı` };
            }
            if (!st && !got) return { field, status: "ok", detail: "temizlendi" };
        } catch {
            return { field, status: "ok", detail: `${url} (doğrulanamadı)` };
        }
    }

    return {
        field,
        status: "failed",
        detail: lastError
            ? `Hiçbir adres tutmadı (son hata ${lastError}). Denenen: ${tried.join(", ")}`
            : "Discord istekleri kabul etti ama değer değişmedi. Ad stilini Discord ayarlarından " +
            "bir kez elle değiştir — eklenti gerçek isteği yakalayıp doğru adresi öğrensin. " +
            `Denenen: ${tried.join(", ")}`
    };
}

/**
 * The profile frame and the profile effect are stored in a single `collectibles_sku_ids`
 * list, so writing one alone deletes the other. Send whatever the preset wants for both,
 * carrying over anything the preset does not manage.
 */
async function applyProfileCollectibles(
    wishes: CollectibleWish[],
    live: PresetFields | null
): Promise<ApplyResult[]> {
    const wanted = new Map<CollectibleField, string | null>();
    for (const w of wishes) wanted.set(w.field, w.want);

    // fields this preset does not touch keep whatever is live right now
    for (const field of ["profileFrame", "profileEffect"] as CollectibleField[]) {
        if (!wanted.has(field)) wanted.set(field, live ? liveSku(live, field) : null);
    }

    const ids = [...wanted.values()].filter((v): v is string => !!v);
    const body = { collectibles_sku_ids: ids };

    try {
        await patch(ME_PROFILE, body);
        for (const w of wishes) {
            await rememberStrategy(w.field, "profile:collectibles_sku_ids");
        }
        return wishes.map(w => ({
            field: w.field,
            status: "ok" as const,
            detail: "collectibles_sku_ids"
        }));
    } catch (e) {
        const err = e as RestError;
        const errs = fieldErrors(err, body);
        const hit = errs.collectibles_sku_ids;

        return wishes.map(w => ({
            field: w.field,
            status: "failed" as const,
            detail: hit ? describe(w.field, "collectibles_sku_ids", hit) : `${err.status}: ${err.message}`
        }));
    }
}

/**
 * One read after the writes. Discord drops unknown payload keys without complaining, so a
 * 200 alone does not mean a cosmetic landed — only the profile does. This never retries;
 * it exists so a wrong key is reported instead of quietly looking like success.
 */
async function confirmCollectibles(wishes: CollectibleWish[], results: ApplyResult[]) {
    const written = results.filter(r => r.status === "ok" && r.detail !== "zaten ayarlı, istek gönderilmedi");
    if (!written.length) return;

    await sleep(500);

    let live: PresetFields;
    try {
        live = await fetchCurrentProfile(false);
    } catch {
        return; // cannot confirm; leave the optimistic result alone
    }

    for (const r of written) {
        const wish = wishes.find(w => w.field === r.field);
        if (!wish) continue;

        const got = liveSku(live, wish.field as CollectibleField);
        if (got === wish.want) continue;

        r.status = "failed";
        r.detail =
            "Discord isteği kabul etti ama değer değişmedi — alan adı bu sürümde farklı olabilir. " +
            "Bu kozmetiği Discord ayarlarından bir kez elle değiştir, eklenti gerçek adı öğrensin.";
    }
}



interface FieldPatch {
    field: CosmeticField;
    key: string;
    value: any;
    /** extra keys that must travel in the same request as `key` */
    extra?: Record<string, any>;
}

/** Builds the plain (non-collectible) payload entries the preset asks for. */
function buildPatches(preset: Preset, live: PresetFields | null) {
    const inc = new Set(preset.include);
    const f = preset.fields;

    const account: FieldPatch[] = [];
    const profile: FieldPatch[] = [];
    const skipped: ApplyResult[] = [];

    /**
     * Nothing is worth a request if the account already holds that exact value: some
     * fields are rate limited, and every needless write is a chance for Discord to
     * reject the whole batch. Empty string and null both mean "not set".
     */
    const norm = (v: any) => (v === "" || v === undefined ? null : v);
    const unchanged = (a: any, b: any) => JSON.stringify(norm(a)) === JSON.stringify(norm(b));

    function push(target: FieldPatch[], p: FieldPatch, liveValue: any, wanted: any) {
        if (live && unchanged(wanted, liveValue)) {
            skipped.push({ field: p.field, status: "ok", detail: "zaten ayarlı, istek gönderilmedi" });
            return;
        }
        target.push(p);
    }

    if (inc.has("globalName")) {
        push(
            account,
            { field: "globalName", key: "global_name", value: f.globalName ?? null },
            live?.globalName,
            f.globalName
        );
    }

    // uploading a byte-identical image still costs a cooldown, so compare CDN hashes first
    const sameImage = (field: "avatar" | "banner") => {
        const hash = field === "avatar" ? f.avatarHash : f.bannerHash;
        const liveHash = live && (field === "avatar" ? live.avatarHash : live.bannerHash);
        return !!hash && !!liveHash && hash === liveHash;
    };

    if (inc.has("avatar")) {
        if (sameImage("avatar")) {
            skipped.push({ field: "avatar", status: "ok", detail: "zaten ayarlı, istek gönderilmedi" });
        } else {
            account.push({ field: "avatar", key: "avatar", value: f.avatar ?? null });
        }
    }

    if (inc.has("bio")) {
        push(profile, { field: "bio", key: "bio", value: f.bio ?? "" }, live?.bio, f.bio);
    }
    if (inc.has("pronouns")) {
        push(profile, { field: "pronouns", key: "pronouns", value: f.pronouns ?? "" }, live?.pronouns, f.pronouns);
    }
    if (inc.has("accentColor")) {
        push(
            profile,
            { field: "accentColor", key: "accent_color", value: f.accentColor ?? null },
            live?.accentColor,
            f.accentColor
        );
    }
    if (inc.has("themeColors")) {
        push(
            profile,
            { field: "themeColors", key: "theme_colors", value: f.themeColors ?? null },
            live?.themeColors,
            f.themeColors
        );
    }
    if (inc.has("banner")) {
        if (sameImage("banner")) {
            skipped.push({ field: "banner", status: "ok", detail: "zaten ayarlı, istek gönderilmedi" });
        } else {
            profile.push({ field: "banner", key: "banner", value: f.banner ?? null });
        }
    }



    const collectibles = (["avatarDecoration", "profileEffect", "nameplate", "profileFrame"] as CollectibleField[])
        .filter(c => inc.has(c))
        .map(c => ({ field: c, want: f[c]?.skuId ?? null }));

    return { account, profile, collectibles, skipped };
}

function bodyOf(patches: FieldPatch[]) {
    const body: Record<string, any> = {};
    for (const p of patches) {
        body[p.key] = p.value;
        if (p.extra) Object.assign(body, p.extra);
    }
    return body;
}

/**
 * Sends the whole group in one request. If that fails, retries every field on its own so
 * a single rejected value cannot take the rest of the preset down with it.
 */
async function applyGroup(url: string, patches: FieldPatch[]): Promise<ApplyResult[]> {
    if (!patches.length) return [];

    try {
        await patch(url, bodyOf(patches));
        return patches.map(p => ({ field: p.field, status: "ok" as const }));
    } catch (groupErr) {
        if (patches.length === 1) {
            const e = groupErr as RestError;
            return [{ field: patches[0].field, status: "failed", detail: `${e.status}: ${e.message}` }];
        }
    }

    const results: ApplyResult[] = [];
    for (const p of patches) {
        const body = { [p.key]: p.value, ...p.extra };
        try {
            await patch(url, body);
            results.push({ field: p.field, status: "ok" });
        } catch (e) {
            const err = e as RestError;
            const hit = fieldErrors(err, body)[p.key];
            results.push({
                field: p.field,
                status: "failed",
                detail: hit ? describe(p.field, p.key, hit) : `${err.status}: ${err.message}`
            });
        }
        await sleep(350);
    }
    return results;
}

/**
 * Re-reads the profile and downgrades any field that Discord accepted but silently
 * ignored. Images are excluded — a data URI cannot be compared against a CDN hash.
 */
async function verify(preset: Preset, results: ApplyResult[]) {
    const checkable: CosmeticField[] = [
        "globalName", "bio", "pronouns", "accentColor", "themeColors", "displayNameStyle"
    ];
    const relevant = results.filter(r => r.status === "ok" && checkable.includes(r.field));
    if (!relevant.length) return;

    let live: PresetFields;
    try {
        live = await fetchCurrentProfile(false);
    } catch {
        return;
    }

    const same = (a: any, b: any) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

    for (const r of relevant) {
        const want = preset.fields[r.field as keyof PresetFields];
        const got = live[r.field as keyof PresetFields];

        // empty string and null both mean "cleared"
        const norm = (v: any) => (v === "" ? null : v);
        if (!same(norm(want), norm(got))) {
            r.status = "failed";
            r.detail = "Discord isteği kabul etti ama değer değişmedi";
        }
    }
}

export interface ApplyOptions {
    /** Log the exact requests to the console instead of sending them. */
    dryRun?: boolean;
}

export async function applyPreset(preset: Preset, opts: ApplyOptions = {}): Promise<ApplyResult[]> {
    let live: PresetFields | null = null;
    if (!opts.dryRun) {
        try {
            live = await fetchCurrentProfile(false);
        } catch { /* fall back to applying blind */ }
    }

    const { account, profile, collectibles, skipped } = buildPatches(preset, live);

    if (opts.dryRun) {
        console.log("[ProfilePresets] DRY RUN — hiçbir istek gönderilmedi", {
            [`PATCH ${ME}`]: bodyOf(account),
            [`PATCH ${ME_PROFILE}`]: bodyOf(profile),
            collectibles: collectibles.map(c => ({ alan: c.field, skuId: c.want }))
        });
        return [...account, ...profile, ...collectibles].map(p => ({
            field: p.field,
            status: "skipped" as const,
            detail: "Simülasyon modu — istek gönderilmedi"
        }));
    }

    const results: ApplyResult[] = [...skipped];

    results.push(...await applyGroup(ME, account));
    if (account.length && profile.length) await sleep(350);
    results.push(...await applyGroup(ME_PROFILE, profile));

    // Discord has moved `banner` between the two endpoints over the years; if the profile
    // endpoint rejected it, try the account endpoint before reporting a failure.
    const banner = results.find(r => r.field === "banner" && r.status === "failed");
    if (banner) {
        const p = profile.find(x => x.field === "banner")!;
        try {
            await patch(ME, { banner: p.value });
            banner.status = "ok";
            banner.detail = "/users/@me üzerinden uygulandı";
        } catch { /* keep the original failure */ }
    }

    await verify(preset, results);

    if (preset.include.includes("displayNameStyle")) {
        results.push(await applyDisplayNameStyle(preset, live));
    }

    if (collectibles.length) {
        await sleep(350);
        results.push(...await applyCollectibles(collectibles, live));
    }

    return results;
}
