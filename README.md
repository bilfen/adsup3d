# Bilfen AD'S UP — Görselden 3B videoya

**Yayında:** https://bilfen.github.io/adsup3d/ — repoya her push'ta GitHub Pages kendiliğinden güncellenir.

Bir fotoğraf veya çizim yükle. Stable Fast 3D onu dokulu bir 3B modele çevirir. Model bu sayfada 360° döner ve video cihaza iner. Hesap veya anahtar istenmez.

## Akış

1. Görsel, Hugging Face üzerindeki [Stable Fast 3D](https://huggingface.co/spaces/stabilityai/stable-fast-3d) alanına gider. Çıktı gerçek bir GLB modelidir.
2. Model tarayıcıda (Three.js) bir tur döner. Bu adım ikinci bir ekran kartı hakkı harcamaz.
3. Kayıt bu tarayıcıda yapılır. Chrome MP4 indirir; kayıt biçimi desteklemiyorsa dosya WebM olur ve adı da ona göre verilir.

## Kullanım

1. Görseli sürükle-bırak (PNG, JPG veya WebP).
2. Dönüş süresini seç (4–8 saniye, varsayılan 6).
3. **✨ 3B modele çevir ve videoyu indir**. Model inince sahne döner, video oynar ve iner.
4. **⬇ İndir** dosyayı yeniden kaydeder. **↻ Tekrar üret** aynı görselle yeniden dener.

## Ölçülen sınırlar (22 Ekim 2026)

- Model servisi ücretsiz ZeroGPU kotası ister. Kota yetmezse sayfa Türkçe hata ve, varsa, yeniden deneme süresini yazar. Sahte video üretilmez.
- Dönüş kaydı ayrı denendi: eldeki gerçek GLB, headless Chrome'da 4 saniyelik dönüşte **1.558.339 bayt** MP4 verdi (`ftyp`, `moov`, `mdat`).
- Görsel gönderilmeden önce uzun kenarı en fazla 768 piksele indirilir.
- `file://` ile açma çalışmaz. Modüller bir http adresinden yüklenmelidir.

## GitHub Pages

Site `bilfen/adsup3d` reposundan yayınlanır. `main` dalına push yeter. Bir iki dakika sonra https://bilfen.github.io/adsup3d/ güncellenir.

`.env`, `serve.ps1` ve `dev-server.js` yalnızca yerel test içindir.

## Yerel test

```powershell
powershell -ExecutionPolicy Bypass -File serve.ps1
```

`http://localhost:8080` adresini aç.

## İsteğe bağlı

- **Gemini ile renk canlandırma:** yalnızca yerel sunucuda ve `/api/health` gemini derse görünür. Anahtar `.env` içindeki `GEMINI_API_KEY` değeridir; tarayıcıya gitmez.
- **Drive'a kaydet:** `app.js` başındaki `DRIVE.clientId` boşsa düğme uyarı verir.

## Teknoloji

- Saf HTML, CSS ve JS.
- `mesh3d.js`: Gradio 4 `queue/join` + `queue/data`. `/call/run_button` hata gövdesini yuttuğu için kullanılmaz.
- `spin.js`: Three.js r169, tuval kaydı.
- Model: [Stable Fast 3D](https://github.com/Stability-AI/stable-fast-3d) (Stability AI).
