/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";
import { classNameFactory } from "@utils/css";
import { showToast, Toasts, useEffect, useRef, useState } from "@webpack/common";

import { applyPreset, dumpProfileShape, fetchCurrentProfile, forgetStrategies, getStrategies } from "../api";
import { clearCaptures, getCaptures } from "../learn";
import { savePresetIntoSlot } from "../quickApply";
import { settings } from "../settings";
import {
    ALL_FIELDS, createPreset, deletePreset, getAutoBackup, setAutoBackup, upsertPreset, usePresets
} from "../store";
import { ApplyResult, FIELD_LABELS, Preset } from "../types";
import { collectibleUrls, diagnoseSku } from "./assets";
import { ProfileCard } from "./ProfileCard";

const cl = classNameFactory("vc-pp-");

const SLOTS = [1, 2, 3, 4, 5];

function TrashIcon() {
    return (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"
            strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 6h16M9 6V4h6v2M7 6l1 14h8l1-14" />
        </svg>
    );
}

/** A square slot showing the preset's avatar wearing its decoration, like Discord's own tile. */
function Slot({ slot, preset, active, busy, onSelect, onDelete }: {
    slot: number;
    preset?: Preset;
    active: boolean;
    busy: boolean;
    onSelect(): void;
    onDelete(): void;
}) {
    const deco = preset?.fields.avatarDecoration;
    const decoUrl = deco ? collectibleUrls("avatarDecoration", deco)[0] : null;

    return (
        <div
            role="button"
            tabIndex={0}
            className={cl("slot", active ? "slot-active" : "", preset ? "" : "slot-empty")}
            onClick={onSelect}
            onKeyDown={e => {
                if (e.key === "Enter" || e.key === " ") onSelect();
            }}
        >
            {preset?.fields.avatar
                ? <img className={cl("slot-avatar")} src={preset.fields.avatar} alt="" />
                : <span className={cl("slot-blank")} />}

            {decoUrl && <img className={cl("slot-deco")} src={decoUrl} alt="" />}

            <span className={cl("slot-num")}>{slot}</span>

            {preset && (
                <button
                    className={cl("slot-del")}
                    title="Bu preseti sil"
                    disabled={busy}
                    onClick={e => { e.stopPropagation(); onDelete(); }}
                >
                    <TrashIcon />
                </button>
            )}
        </div>
    );
}

function ResultList({ results }: { results: ApplyResult[]; }) {
    if (!results.length) return null;

    return (
        <div className={cl("results")}>
            <span className={cl("results-title")}>Son uygulama</span>
            {results.map(r => (
                <div key={r.field} className={cl("result", `result-${r.status}`)}>
                    <span className={cl("result-icon")}>
                        {r.status === "ok" ? "✓" : r.status === "skipped" ? "–" : "✕"}
                    </span>
                    <span className={cl("result-field")}>{FIELD_LABELS[r.field]}</span>
                    {r.detail && <span className={cl("result-detail")}>{r.detail}</span>}
                </div>
            ))}
        </div>
    );
}

/**
 * Shows which collectible payload shape was found to actually work, so a cosmetic that
 * refuses to apply is diagnosable instead of mysterious.
 */
function SchemaPanel({ preset }: { preset: Preset | null; }) {
    const [tick, setTick] = useState(0);
    const strategies = getStrategies();
    const captures = getCaptures();

    const dump = JSON.stringify(
        captures.map(c => ({ m: c.method, url: c.url, body: c.body })),
        null,
        1
    );

    return (
        <details className={cl("schema")} key={tick}>
            <summary>Şema tanılama ({captures.length} yakalanmış istek)</summary>

            <ul>
                <li>Dekorasyon: <code>{strategies.avatarDecoration ?? "henüz bulunamadı"}</code></li>
                <li>Efekt: <code>{strategies.profileEffect ?? "henüz bulunamadı"}</code></li>
                <li>İsimlik: <code>{strategies.nameplate ?? "henüz bulunamadı"}</code></li>
                <li>Çerçeve: <code>{strategies.profileFrame ?? "henüz bulunamadı"}</code></li>
            </ul>

            <p className={cl("foot-note")}>
                Bir kozmetik uygulanmıyorsa: <b>Discord'un kendi ayarlarından</b> o kozmetiği bir kez
                elle değiştir. Eklenti istemcinin gönderdiği gerçek isteği yakalar ve aşağıda gösterir.
            </p>

            {captures.length > 0 && <pre className={cl("schema-dump")}>{dump}</pre>}

            <div className={cl("schema-actions")}>
                <Button
                    size="xs"
                    variant="secondary"
                    onClick={() => {
                        navigator.clipboard.writeText(dump);
                        showToast("Yakalananlar panoya kopyalandı", Toasts.Type.SUCCESS);
                    }}
                >
                    Yakalanan istekleri kopyala
                </Button>
                <Button
                    size="xs"
                    variant="secondary"
                    onClick={() => void dumpProfileShape().then(text => {
                        navigator.clipboard.writeText(text);
                        showToast("Ham profil yanıtı panoya kopyalandı", Toasts.Type.SUCCESS);
                    })}
                >
                    Ham profil yanıtını kopyala
                </Button>
                <Button
                    size="xs"
                    variant="secondary"
                    onClick={() => {
                        navigator.clipboard.writeText(diagnoseSku(preset?.fields.profileFrame?.skuId));
                        showToast("Çerçeve ürünü panoya kopyalandı", Toasts.Type.SUCCESS);
                    }}
                >
                    Çerçeve görselini teşhis et
                </Button>
                <Button
                    size="xs"
                    variant="secondary"
                    onClick={() => void clearCaptures().then(() => setTick(t => t + 1))}
                >
                    Yakalananları temizle
                </Button>
                <Button
                    size="xs"
                    variant="secondary"
                    onClick={() => void forgetStrategies().then(() => setTick(t => t + 1))}
                >
                    Şemayı sıfırla
                </Button>
            </div>
        </details>
    );
}

/** The whole preset manager. Rendered both as a modal and as a settings page. */
export function PresetManager() {
    const presets = usePresets();

    const [slot, setSlot] = useState(1);
    const [draft, setDraft] = useState<Preset | null>(null);
    const [busy, setBusy] = useState(false);
    const [results, setResults] = useState<ApplyResult[]>([]);
    const [hasBackup, setHasBackup] = useState(false);

    const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const current = presets.find(p => p.slot === slot);

    useEffect(() => {
        setDraft(presets.find(p => p.slot === slot) ?? null);
        setResults([]);
    }, [slot, current?.id]);

    useEffect(() => {
        getAutoBackup().then(b => setHasBackup(!!b));
    }, []);

    /** Local edits are debounced into IndexedDB so nothing is ever lost. */
    function edit(next: Preset) {
        setDraft(next);
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(() => upsertPreset(next), 500);
    }

    async function run<T>(fn: () => Promise<T>) {
        setBusy(true);
        try {
            return await fn();
        } finally {
            setBusy(false);
        }
    }

    async function saveHere() {
        const saved = await run(() => savePresetIntoSlot(slot, current));
        if (saved) setDraft(saved);
    }

    async function apply(preset: Preset) {
        setResults([]);
        await run(async () => {
            try {
                if (settings.store.backupBeforeApply && !settings.store.dryRun) {
                    try {
                        const backup = createPreset("Otomatik yedek");
                        backup.fields = await fetchCurrentProfile(true);
                        await setAutoBackup(backup);
                        setHasBackup(true);
                    } catch {
                        showToast("Yedek alınamadı, yine de devam ediliyor", Toasts.Type.MESSAGE);
                    }
                }

                const res = await applyPreset(preset, { dryRun: settings.store.dryRun });
                setResults(res);

                const failed = res.filter(r => r.status === "failed").length;
                if (settings.store.dryRun) {
                    showToast("Simülasyon tamamlandı — ayrıntılar konsolda", Toasts.Type.MESSAGE);
                } else if (failed) {
                    showToast(`${res.length - failed} alan uygulandı, ${failed} tanesi başarısız`, Toasts.Type.FAILURE);
                } else {
                    showToast("Profil bu presete geçti", Toasts.Type.SUCCESS);
                }
            } catch (e: any) {
                showToast(e?.message ?? "Uygulama başarısız", Toasts.Type.FAILURE);
            }
        });
    }

    async function restoreBackup() {
        const backup = await getAutoBackup();
        if (!backup) {
            showToast("Yedek bulunamadı", Toasts.Type.FAILURE);
            return;
        }
        await apply({ ...backup, include: [...ALL_FIELDS] });
    }

    return (
        <div className={cl("root")}>
            <div className={cl("layout")}>
                <aside className={cl("rail")}>
                    {SLOTS.map(n => (
                        <Slot
                            key={n}
                            slot={n}
                            preset={presets.find(p => p.slot === n)}
                            active={n === slot}
                            busy={busy}
                            onSelect={() => setSlot(n)}
                            onDelete={() => {
                                const p = presets.find(x => x.slot === n);
                                if (p) void deletePreset(p.id);
                            }}
                        />
                    ))}

                </aside>

                <main className={cl("work")}>
                    {settings.store.dryRun && (
                        <div className={cl("dry")}>Simülasyon modu — hiçbir istek gönderilmez</div>
                    )}

                    {!draft ? (
                        <div className={cl("blank")}>
                            <span className={cl("blank-num")}>{slot}</span>
                            <p>Bu slot boş.</p>
                            <Button disabled={busy} onClick={saveHere}>
                                Şu anki profilimi buraya kaydet
                            </Button>
                        </div>
                    ) : (
                        <>
                            <div className={cl("head")}>
                                <input
                                    className={cl("input", "input-title")}
                                    value={draft.name}
                                    placeholder={`Preset ${slot}`}
                                    onChange={e => edit({ ...draft, name: e.currentTarget.value })}
                                />
                                <div className={cl("head-actions")}>
                                    <Button className={cl("btn-lg")} disabled={busy} onClick={() => void apply(draft)}>
                                        {busy ? "Uygulanıyor…" : "Hesabıma uygula"}
                                    </Button>
                                    {hasBackup && (
                                        <Button
                                            className={cl("btn-lg")}
                                            variant="secondary"
                                            disabled={busy}
                                            title="Son uygulamadan hemen önceki profiline geri döner"
                                            onClick={restoreBackup}
                                        >
                                            Uygulama öncesine dön
                                        </Button>
                                    )}
                                    <Button
                                        className={cl("btn-lg")}
                                        variant="dangerSecondary"
                                        disabled={busy}
                                        onClick={() => void deletePreset(draft.id)}
                                    >
                                        Preseti sil
                                    </Button>
                                </div>
                            </div>

                            <ResultList results={results} />
                            <ProfileCard preset={draft} />
                            <SchemaPanel preset={draft} />
                        </>
                    )}
                </main>
            </div>
        </div>
    );
}
