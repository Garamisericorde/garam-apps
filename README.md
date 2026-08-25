# garam-apps

Garam masaustu uygulamalarinin ortak deposu. Uc uygulama ayni tasarim sistemini,
ayni kutuphaneleri ve ayni derleme zincirini paylasiyor.

```
garam-apps/
├── packages/
│   ├── theme/      @garam/theme  — tasarim tokenlari (TEK renk kaynagi)
│   ├── ui/         @garam/ui     — ortak React bilesenleri
│   └── core/       @garam/core   — ayarlar, gunlukleme, dosya, IPC altyapisi
├── apps/
│   ├── g-snap/     Ekran alintisi + anotasyon (Lightshot benzeri)
│   ├── g-recorder/ Anlik tekrar kaydi + video kirpma
│   └── g-note/     Not defteri
├── installer/
│   └── bootstrapper/  Garam Setup — kucuk indirici kurulum programi
└── tools/
    ├── icons/      Uc uygulama icin ortak simge ureteci
    └── release/    catalog.json ureteci
```

## Kurulum

```bash
npm install
```

Tek `node_modules`, tek `package-lock.json`. Electron bir kez indirilir.

## Gelistirme

```bash
npm run dev:snap
```

```bash
npm run dev:recorder
```

```bash
npm run dev:note
```

## Paketleme

```bash
npm run package:snap
```

Cikti: `apps/g-snap/release/G-Snap-<surum>-setup.exe`

## Ortak paketler nasil calisiyor

`@garam/*` paketleri **derlenmemis TypeScript kaynagi** olarak tuketiliyor —
`dist` yok, ayri bir derleme adimi yok. Vite/electron-vite bunlari dogrudan
bundle'a gomuyor.

Bunun icin `electron.vite.config.ts` dosyalarinda su ayar sart:

```ts
externalizeDepsPlugin({ exclude: ['@garam/core', '@garam/theme', '@garam/ui'] })
```

Bu satir olmazsa paketlenmis uygulama calisma zamaninda `@garam/core`'u
bulamaz — cunku node_modules'teki sembolik bag asar arsivine girmez.

### Renk degistirmek

Tek yer: `packages/theme/src/tokens.css`. Uygulamalarda ham hex yazilmaz.
Konva/canvas gibi CSS degiskeni okuyamayan yerler icin ayni degerlerin JS
aynasi `packages/theme/src/index.ts` icinde — ikisi birlikte guncellenir.

## Dagitim

1. Uygulamalari paketle: `npm run package:snap` (ve digerleri)
2. `tools/release/apps.json` icindeki `github.owner` alanini doldur
3. Katalogu uret: `npm run catalog`
4. Kurulum dosyalarini GitHub Releases'e, `catalog.json`'u GitHub Pages'e yukle
5. Bootstrapper katalogu okuyup kullanicinin sectiklerini indirip kurar

Ayrinti: [installer/bootstrapper/README.md](installer/bootstrapper/README.md)

## Durum

| Parca | Durum |
|---|---|
| `@garam/theme`, `@garam/ui`, `@garam/core` | Calisiyor |
| `g-snap` | Calisiyor — derleniyor, yakalama ve overlay test edildi |
| `g-recorder` | Tasindi, typecheck geciyor — tasarimi henuz `@garam/theme`'e gecmedi |
| `g-note` | Tasindi — henuz `@garam/theme`'e gecmedi, eski stack'te (Electron 28, saf Vite) |
| `catalog.json` ureteci | Yazildi, paketlenmis kurulum dosyasi olmadan test edilmedi |
| Bootstrapper | Yazildi, **derlenmedi** — Rust toolchain gerekiyor |
