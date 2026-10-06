/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { openModal } from "@utils/modal";
import type { RenderModalProps } from "@vencord/discord-types";
import { Modal } from "@webpack/common";

import { settings } from "../settings";
import { PresetManager } from "./PresetManager";


function PresetManagerModal(modalProps: RenderModalProps) {
    return (
        <Modal
            {...modalProps}
            size="xl"
            title="Profil Preset'leri"
            subtitle={settings.store.dryRun
                ? "SİMÜLASYON MODU — hiçbir istek gönderilmez"
                : "Kozmetiklerini kaydet, aralarında tek tıkla geçiş yap"}
        >
            <PresetManager />
        </Modal>
    );
}

export function openPresetManager() {
    openModal(modalProps => <PresetManagerModal {...modalProps} />);
}

/** Full-page variant, mounted as an entry in Discord's own settings sidebar. */
export function PresetsSettingsPage() {
    return <PresetManager />;
}
