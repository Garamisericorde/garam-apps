/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { Button } from "@components/Button";
import ErrorBoundary from "@components/ErrorBoundary";
import { PaintbrushIcon } from "@components/Icons";
import SettingsPlugin from "@plugins/_core/settings";
import { classNameFactory } from "@utils/css";
import { removeFromArray } from "@utils/misc";
import definePlugin from "@utils/types";
import { Menu } from "@webpack/common";
import type { ReactNode } from "react";

import { loadStrategies } from "./api";
import { openPresetManager, PresetsSettingsPage } from "./components/PresetManagerModal";
import { runDiagnostics } from "./diagnostics";
import { loadCaptures, startCapture, stopCapture } from "./learn";
import { quickApply } from "./quickApply";
import { settings } from "./settings";
import { loadPresets, usePresets } from "./store";

const cl = classNameFactory("vc-pp-");

const SETTINGS_KEY = "vencord_profile_presets";

function SettingsEntry() {
    return (
        <div className={cl("settings-entry")}>
            <Button onClick={openPresetManager}>Preset yöneticisini aç</Button>
            <p className={cl("hint")}>
                Yöneticinin asıl yeri: Discord ayarlarının sol menüsündeki
                <b> Vencord Settings → Profil Preset'leri</b> sekmesi. Preset'ler yalnızca bu
                cihazda saklanır ve uygulamadan önce mevcut profilin otomatik yedeklenir.
            </p>
        </div>
    );
}

export default definePlugin({
    name: "ProfilePresets",
    description:
        "Profil kozmetiklerini (avatar, banner, görünen ad, hakkımda, renkler, dekorasyon, efekt, isimlik) " +
        "preset olarak kaydet ve aralarında tek tıkla geçiş yap.",
    authors: [{ name: "Garam", id: 0n }],
    tags: ["Customisation", "Appearance"],

    settings,
    settingsAboutComponent: SettingsEntry,

    async start() {
        await Promise.all([loadPresets(), loadCaptures(), loadStrategies()]);
        if (settings.store.learnMode) startCapture();

        SettingsPlugin.customEntries.push({
            key: SETTINGS_KEY,
            title: "Profil Preset'leri",
            panelTitle: "Profil Preset'leri",
            Component: ErrorBoundary.wrap(PresetsSettingsPage, { noop: false }),
            Icon: PaintbrushIcon
        });

        // give webpack a moment to register every factory before scanning them
        if (settings.store.diagnostics) setTimeout(runDiagnostics, 8000);
    },

    stop() {
        stopCapture();
        removeFromArray(SettingsPlugin.customEntries, e => e.key === SETTINGS_KEY);
    },

    toolboxActions(): ReactNode {
        const presets = usePresets();
        if (!settings.store.showToolboxEntries) return null;

        const entries: ReactNode[] = [
            <Menu.MenuItem
                id="vc-pp-open"
                key="vc-pp-open"
                label="Preset yöneticisi"
                action={openPresetManager}
            />
        ];

        if (presets.length) {
            entries.push(<Menu.MenuSeparator key="vc-pp-sep" />);
            for (const p of presets) {
                entries.push(
                    <Menu.MenuItem
                        id={`vc-pp-apply-${p.id}`}
                        key={`vc-pp-apply-${p.id}`}
                        label={`${p.slot}. ${p.name}`}
                        action={() => quickApply(p)}
                    />
                );
            }
        }

        return entries;
    }
});
