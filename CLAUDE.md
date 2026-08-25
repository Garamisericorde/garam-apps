# garam-apps — monorepo kurallari

Uc Electron uygulamasi ortak bir tasarim sistemi ve altyapi uzerinde duruyor.
Uygulamaya ozel kurallar icin ayrica `apps/<uygulama>/CLAUDE.md` dosyasina bak.

## Degismezler

- **Renkler tek yerden gelir:** `packages/theme/src/tokens.css`.
  Uygulama kaynaklarinda ham hex YAZILMAZ, `var(--...)` kullanilir.
  Konva/canvas icin JS aynasi `packages/theme/src/index.ts` — ikisi birlikte guncellenir.
- **Ortak bilesenler `@garam/ui`'dedir.** Bir dugme/alan/panel iki uygulamada
  gerekiyorsa uygulamaya degil pakete yazilir.
- **`@garam/*` paketleri derlenmez.** TypeScript kaynagi olarak tuketilir;
  `dist` uretilmez. Bu yuzden her uygulamanin electron-vite yapilandirmasinda
  `externalizeDepsPlugin({ exclude: [...] })` ile disarilanmamalari SART.
- **electron-vite yapilandirma dosyasinin adi `electron.vite.config.ts`**
  (nokta, tire degil) — aksi halde sessizce yok sayilir.
- **`@garam/theme` index'i DOM API kullanamaz.** Ana surec onu import ediyor;
  DOM'a bagli yardimcilar `@garam/theme/dom` altinda durur.

## Guvenlik / IPC

- `contextIsolation: true`, `nodeIntegration: false` — istisnasiz.
- Renderer'in ulastigi her ayricalikli islem preload'daki `window.api` uzerinden.
- Kanal adi renderer'dan GELMEZ; preload sabit kanallara baglanir.
- `ipcMain.handle` cagrilari tek dosyada toplanir (`src/main/ipc/`).

## DPI — bu depoda en cok hata cikan yer

Windows'ta kesirli olcekleme (or. %110 -> `scaleFactor = 1.1041666`) yaygin.
`bounds * scaleFactor` TAM SAYI VERMEZ ve gercek piksel sayisindan sapar:

```
2319 DIP x 1.1041666 = 2560.56  ->  yuvarlarsan 2561, gercegi 2560
```

Bir pikselllik sapma bile goruntunun kesirli oranda yeniden orneklenmesine ve
gozle gorulur bulaniklasmasina yol aciyor (olculdu: keskinlik 4.03 -> 4.90).

Kurallar:
- Yakalama boyutu **en yakin cift tam sayiya** yuvarlanir (`roundToEven`).
  Gercek ekran modlarinin iki boyutu da her zaman cift sayidir.
- Olcek hesaplari isletim sisteminin `scaleFactor`'undan DEGIL, gercekten
  alinan piksel sayisindan turetilir: `nativeSize.width / bounds.width`.
  Buyutec, disa aktarma ve kirpma hep bunu kullanir.
- Yakalama sonrasi istenen/alinan olcu gunluge yazilir; ayrisirlarsa UYARI.

## Konva notlari

- `getPointerPosition()` son isaretci olayinda guncellenir. Pencere yeni
  acildiysa ve icinde henuz hareket olmadiysa **(0,0) doner**. Ilk tiklamada
  konumu native olaydan hesapla (`clientX/clientY` - container rect).
- Disa aktarmadan once karartma ve secim cercevesi katmanlari gizlenir,
  sonra tekrar gosterilir.

## Windows dosya sistemi

- JSON okurken **BOM kirpilir**. PowerShell'in `-Encoding utf8`'i ve Not Defteri
  UTF-8'i BOM ile yazar; `JSON.parse` o karakterde patlar ve ayarlar sessizce
  varsayilana doner. `@garam/core`'daki `readJson` bunu zaten yapiyor.
- Ayarlar atomik yazilir (gecici dosya + `rename`), yarim dosya olusmaz.
- Dosya adlarinda ayrilmis isimler (CON, PRN, COM1...) ve kontrol karakterleri
  temizlenir — `sanitizeFileName`.

## Kaynak hijyeni

- Kaynak dosyalara **gorunmez karakter yazma** (BOM, U+FEFF, kiril benzeri
  harfler). Regex'te BOM gerekiyorsa `String.fromCharCode(0xfeff)` kullan.
- TypeScript strict; `noUnusedLocals` acik.
- Dosyalar odakli tutulur, tek dosyada devasa bilesen yok.

## Derleme ve dogrulama

```bash
npm run typecheck -w g-snap
```

```bash
npm run build -w g-snap
```

Derleme ciktisi `apps/<uygulama>/out/` altina gider; monorepo koku kirlenmemeli.

## Simgeler

`tools/icons/generate.mjs` — bagimliliksiz PNG/ICO ureteci, uc uygulama ayni
gorsel dili (yuvarlak kose kare + aksan rengi + beyaz sembol) paylasir.
Simgeler elle duzenlenmez, `npm run icons -w <uygulama>` ile uretilir.
