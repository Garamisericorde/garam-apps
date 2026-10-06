/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { showToast, Toasts } from "@webpack/common";

import { applyPreset, fetchCurrentProfile, lastReadWarnings } from "./api";
import { settings } from "./settings";
import { createPreset, setAutoBackup, upsertPreset } from "./store";
import { Preset } from "./types";

/**
 * Apply a preset without any surrounding UI — used by the toolbox entries and by the
 * numbered slots in Discord's own profile settings. Same pipeline as the manager modal.
 */
export async function quickApply(preset: Preset) {
    try {
        if (settings.store.backupBeforeApply && !settings.store.dryRun) {
            try {
                const backup = createPreset("Otomatik yedek");
                backup.fields = await fetchCurrentProfile(true);
                await setAutoBackup(backup);
            } catch { /* a missing backup must not block the switch */ }
        }

        const results = await applyPreset(preset, { dryRun: settings.store.dryRun });
        const failed = results.filter(r => r.status === "failed");

        if (settings.store.dryRun) {
            showToast("Simülasyon tamamlandı — ayrıntılar konsolda", Toasts.Type.MESSAGE);
        } else if (failed.length) {
            showToast(`"${preset.name}" kısmen uygulandı (${failed.length} alan başarısız)`, Toasts.Type.FAILURE);
            console.warn("[ProfilePresets] başarısız alanlar", failed);
        } else {
            showToast(`"${preset.name}" uygulandı`, Toasts.Type.SUCCESS);
        }
    } catch (e: any) {
        showToast(e?.message ?? "Preset uygulanamadı", Toasts.Type.FAILURE);
    }
}

/**
 * Snapshots whatever is live on the account right now into the given slot, keeping the
 * existing preset's id and name when the slot is already taken.
 */
export async function savePresetIntoSlot(slot: number, existing?: Preset): Promise<Preset | null> {
    try {
        const preset = existing
            ? { ...existing }
            : createPreset(`Preset ${slot}`, slot);

        preset.fields = await fetchCurrentProfile(true);

        // a half-captured preset would silently apply the wrong thing later
        if (lastReadWarnings.length) {
            showToast(lastReadWarnings.join(" · "), Toasts.Type.FAILURE);
        }

        // A profile theme overrides the legacy accent colour, and Discord's current UI has
        // no control for it at all — so writing the value it reports back would just push a
        // colour the user never chose. Leave it out of the applied set; the switch re-enables it.
        if (preset.fields.themeColors) {
            preset.include = preset.include.filter(f => f !== "accentColor");
        }

        await upsertPreset(preset);
        showToast(`${slot}. slota kaydedildi`, Toasts.Type.SUCCESS);
        return preset;
    } catch (e: any) {
        showToast(e?.message ?? "Canlı profil okunamadı", Toasts.Type.FAILURE);
        return null;
    }
}
