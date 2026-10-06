/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { OptionType } from "@utils/types";

export const settings = definePluginSettings({
    dryRun: {
        type: OptionType.BOOLEAN,
        default: false,
        description: "Simülasyon modu — istekleri göndermek yerine konsola yazar (test için)"
    },
    backupBeforeApply: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Uygula'dan önce mevcut profili otomatik yedekle (geri alma için)"
    },
    learnMode: {
        type: OptionType.BOOLEAN,
        default: true,
        description:
            "Şema öğrenme — Discord'un kendi ayarlarından bir kozmetik değiştirdiğinde, " +
            "istemcinin gönderdiği isteğin alan adlarını öğrenir. Hiçbir şey göndermez, sadece izler."
    },
    diagnostics: {
        type: OptionType.BOOLEAN,
        default: true,
        description:
            "Tanılama — açılıştan 8 sn sonra konsola [ProfilePresets-DIAG] etiketli modül " +
            "raporu yazar. Yerleştirme sorunu çözülünce kapatabilirsin."
    },
    showToolboxEntries: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Vencord Toolbox menüsünde preset'leri tek tıkla uygulanabilir olarak listele"
    }
});
