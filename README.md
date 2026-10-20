# Bilfen AD'S UP — Görselden 3D Animasyon Videosuna

Öğrenciler bir görsel (çizim, fotoğraf, logo…) yükler; görsel **Tencent Hunyuan3D-2** modeliyle 3D modele dönüşür ve öğrenci, **kendi tarayıcısında dönen modeli video olarak kaydedip indirir**. Sitenin tamamı statiktir: GitHub Pages'te ücretsiz barındırılır, sunucu/anahtar gerektirmez.

## Nasıl çalışır?

1. Öğrenci görseli sürükleyip bırakır (veya tıklayarak seçer).
2. Görsel doğrudan tarayıcıdan Hugging Face'teki resmî **`tencent/Hunyuan3D-2`** Space'inin ücretsiz API'sine gönderilir → 3D model (.glb) döner (genelde 10–60 saniye; kuyrukta bekleme olabilir).
3. Model Three.js ile canlı gösterilir; otomatik döner, fareyle de çevrilebilir.
4. **"10 saniyelik kayıt + indir"** ya da manuel kayıt düğmesiyle model MediaRecorder ile WebM videoya çevrilir, sayfada oynatılır ve **⬇ İndir** ile bilgisayara iner.

Görsel hiçbir aracı sunucuya gitmez; cihaz ↔ Hugging Face arasında doğrudan akar.

## GitHub Pages ile yayınlama (5 adım)

1. Bu klasördeki **tüm dosyaları** (`index.html`, `app.js`, `assets/`, `dev-server.js`, bu README) Bilfen GitHub hesabında yeni bir repoya yükleyin (örn. `adsup-3d`).
   - Hızlı yöntem: GitHub web'de *Add file → Upload files* ile sürükleyip bırakın. `dev-server.js` yalnızca yerel test için kullanılır, yüklemeseniz de olur.
2. Repo → **Settings → Pages** → *Source*: **Deploy from a branch** → Branch: **main** / **/(root)** → *Save*.
3. 1–2 dakika sonra `https://<GitHub-kullanıcı-adı>.github.io/adsup-3d/` adresi yayında olur.
4. Öğrenciler bu adresi tarayıcıda açar — kurulum, hesap veya anahtar gerekmez.

> Not: GitHub Pages `localhost` değildir; tarayıcı CORS/HTTPS kuralları Hugging Face API'siyle sorunsuz çalışır (test edildi).

## Yerel test (isteğe bağlı)

[Bun](https://bun.sh) yüklüyse: klasörde `bun dev-server.js` → `http://localhost:8080`.
Python varsa: `python -m http.server 8080` de aynı işi görür.

## Sınırlar & iyi sonuç için ipuçları

- Hugging Face'in ücretsiz demosunun kendi kota/bekleme sınırı vardır; yoğun saatlerde sırada bekleme olabilir. Sitede bu durum HTTPS hatası yerine net mesajla gösterilir.
- En iyi sonuç: **sade/düz arka planlı**, tek nesne fotoğrafları (oyuncak, ürün, karakter, kendi çizimi…).
- Çıktı videosu WebM formatındadır (Chrome/Edge ile MP4 destekli tarayıcılar otomatik MP4 seçebilir). İstenirse Windows'ta "Fotoğraflar" ya da VLC ile MP4'e dönüştürülebilir.
- Sitede banner `assets/banner.jpg` olarak kullanılır — kendi görselinizle değiştirebilirsiniz.

## Teknoloji

- Saf HTML/CSS/JS (framework yok) + [Three.js](https://threejs.org) 0.160 (CDN'den).
- Hunyuan3D-2 Gradio HTTP API: `POST /upload` → `POST /call/shape_generation` → SSE (`/call/shape_generation/<event_id>`) → indirme `GET /file=<path>` ( doğrulanmış akış).
- Video: tarayıcıda `canvas.captureStream()` + `MediaRecorder` (sunucu yok).
