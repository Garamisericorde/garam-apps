# Garam Setup

Kucuk indirici kurulum programi. Uygulamalari kendi icine gommez; `catalog.json`
dosyasini okuyup kullanicinin sectiklerini internetten indirir, dogrular ve
sessizce kurar.

**Durum: yazildi, HENUZ DERLENMEDI.** Bu makinede Rust toolchain kurulu degil.

## Neden bu tasarim

| | Tek buyuk setup | Bu yaklasim |
|---|---|---|
| Boyut | ~250 MB (uc uygulama gomulu) | ~3-5 MB |
| Yeni surum cikarmak | Setup'i yeniden yayinla | Sadece `catalog.json`'u guncelle |
| Kullanici tek uygulama istiyor | Hepsini indirir | Yalnizca sectigini indirir |

Arayuz HTML/CSS oldugu icin `@garam/theme` ile ayni renkleri kullaniyor — setup,
kurdugu uygulamalarla ayni gorunuyor.

## Onkosullar

```bash
winget install Rustlang.Rustup
```

WebView2 runtime Windows 11'de kurulu gelir; Windows 10'da cogunlukla vardir.
Yoksa Tauri NSIS paketi kurulum sirasinda indirir.

## Calistirma

```bash
npm install
```

```bash
npm run dev
```

## Derleme

Katalog adresini derleme zamaninda ver:

```bash
GARAM_CATALOG_URL=https://KULLANICI.github.io/garam-apps/catalog.json npm run build
```

Cikti: `src-tauri/target/release/bundle/nsis/Garam Setup_0.1.0_x64-setup.exe`

Degisken verilmezse `src/main.rs` icindeki varsayilan adres kullanilir.

## Guvenlik

- Her indirilen dosyanin **SHA-256'si katalogdakiyle karsilastirilir**.
  Eslesmezse dosya silinir ve kurulum durur — bozuk/degistirilmis kurulum
  hicbir kosulda CALISTIRILMAZ.
- HTTPS `rustls` ile; sistem OpenSSL'ine bagimlilik yok.
- Tauri allowlist'i kapali; yalnizca `shell.open` acik.

## catalog.json bicimi

```json
{
  "schemaVersion": 1,
  "publishedAt": "2026-08-25T14:00:00.000Z",
  "apps": [
    {
      "id": "g-snap",
      "name": "G-Snap",
      "description": "Ekran alintisi, anotasyon ve hizli paylasim",
      "version": "0.1.0",
      "sizeBytes": 74000000,
      "default": true,
      "requires": [],
      "installer": {
        "fileName": "G-Snap-0.1.0-setup.exe",
        "url": "https://github.com/KULLANICI/garam-apps/releases/download/g-snap-v0.1.0/G-Snap-0.1.0-setup.exe",
        "sha256": "...",
        "silentArgs": ["/S"]
      }
    }
  ]
}
```

Depo kokunden `npm run catalog` ile uretilir.

## NSIS notu

electron-builder'in urettigi kurulum `/S` ile sessiz calisir. Hedef klasor
vermek icin `/D=<yol>` **tirnaksiz ve en son argüman** olmalidir — NSIS'in
kirilgan bir kurali.
