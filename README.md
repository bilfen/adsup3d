# Bilfen AD'S UP — Görselden 3D Animasyon Videosuna

Öğrenci bir görsel yükler. Görsel ücretsiz bulutta gerçek bir 3D modele (GLB) dönüşür. Model sahnede **5 saniyede 360°** döner ve video iner.

## Nasıl çalışır?

1. Öğrenci görseli sürükleyip bırakır (veya tıklayarak seçer).
2. Görsel, ücretsiz bir image-to-3D servisine gider ve renkli bir 3D model olarak geri döner. Bu genelde bir-iki dakika sürer; servis meşgulse sıradaki servis denenir.
3. Model hazır olunca kendi etrafında 5 saniyelik tam bir tur döner. Video kendiliğinden inmeye başlar.
4. İnmezse karttaki **⬇ İndir** aynı dosyayı tekrar kaydeder. Chrome veya Edge kullanın.

3D model Hugging Face üzerindeki açık alanlarda üretilir (Stable Fast 3D, olmazsa Hunyuan3D 2.1, olmazsa Hunyuan3D). Video tarayıcıda kaydedilir. Bu servislerin ücretsiz GPU kotası dolunca üretim durur; birkaç dakika sonra yeniden denemek gerekir.

## İsteğe bağlı: Gemini ile renk canlandırma

Gemini **3D model ve video üretmez**. Yalnızca işaretlenirse görseli daha canlı renge çevirir; 3D model yine bulutta üretilir.

1. `.env.example` dosyasını `.env` yapın ve `GEMINI_API_KEY=` satırına anahtarı yazın.
2. `bun dev-server.js` ile `http://localhost:8080` açın. Sayfada "Gemini ile renkleri canlandır" kutusu çıkar.
3. Kutu işaretliyse görsel Google'a gider. İşaretsizse görsel bilgisayardan çıkmaz.
4. `.env` dosyasını GitHub'a, öğrenci klasörüne veya sayfanın içine koymayın. Sunucu bu dosyayı dışarı vermez.

## Opsiyonel: "Google Drive'a Kaydet" düğmesi

Video kartındaki **⬇ İndir** düğmesinin yanında **"☁ Drive'a Kaydet"** düğmesi vardır. Bunun çalışması için bir kezlik kurulum gerekir (Google'ın kuralı gereği öğrencinin kendi Google oturumu kullanılır):

1. [console.cloud.google.com](https://console.cloud.google.com) adresinde ücretsiz bir proje oluşturun.
2. **API & Services → Library** → **Google Drive API**'yi etkinleştirin.
3. **API & Services → Credentials → Create Credentials → OAuth client ID** → Tür: **Web application**.
   - **Authorized JavaScript origins**: `https://bilfen.github.io` (yerel test için `http://localhost:8080` de ekleyebilirsiniz).
4. Aldığınız **Client ID**'yi (`xxxx.apps.googleusercontent.com`) `app.js` dosyasının başındaki `DRIVE.clientId` alanına yazın ve push'layın.
5. *Opsiyonel — ortak klasör:* videoların otomatik birikeceği Google Drive klasörünün ID'sini `DRIVE.folderId` alanına yazın (klasör URL'sinde `.../folders/`'dan sonra gelen koddur). Bu klasöre yükleme yapacak öğrencilerin Google hesaplarına **Düzenleyici** izni paylaşın. `folderId` boşsa video öğrencinin kendi "Drive'ım" köküne gider.

Çalışma şekli: ilk kayıtta öğrenci popup'ta Google hesabını seçip izin verir (`drive.file` kapsamı yalnızca uygulamanın yüklediği dosyalar için yetki verir); aynı oturumdaki sonraki kayıtlar sessiz geçer. Drive'da %100 otomatik anonim yükleme mümkün değildir (Google zorunlu tutar) — bu, tarayıcıdan yapılabilecek en otomatik haldir.

## GitHub Pages ile yayınlama (5 adım)

1. Bu klasördeki **tüm dosyaları** (`index.html`, `app.js`, `assets/`, `dev-server.js`, bu README) Bilfen GitHub hesabında yeni bir repoya yükleyin (örn. `adsup-3d`).
   - Hızlı yöntem: GitHub web'de *Add file → Upload files* ile sürükleyip bırakın. `dev-server.js` yalnızca yerel test için kullanılır, yüklemeseniz de olur.
2. Repo → **Settings → Pages** → *Source*: **Deploy from a branch** → Branch: **main** / **/(root)** → *Save*.
3. 1–2 dakika sonra `https://<GitHub-kullanıcı-adı>.github.io/adsup-3d/` adresi yayında olur.
4. Öğrenciler bu adresi tarayıcıda açar — kurulum, hesap veya anahtar gerekmez.

> GitHub Pages üzerinde sayfa açılır. 3D model ücretsiz bulutta üretilir, video tarayıcıda kaydedilir. Gemini renk kutusu yalnızca yerel sunucuda görünür; `.env` dosyasını repoya koymayın.

## Yerel test

Bu bilgisayarda Bun/Node/Python yoksa:

```powershell
powershell -ExecutionPolicy Bypass -File serve.ps1
```

Tarayıcıda `http://localhost:8080` açın. Dosyayı çift tıklayarak açmayın; tarayıcı modülleri `file://` adresinde çalışmaz.

Bun yüklüyse `bun dev-server.js` aynı adresi açar. Python varsa `python -m http.server 8080` yalnızca 3D'yi açar, Gemini kutusunu açmaz.

## Sınırlar & iyi sonuç için ipuçları

- En iyi sonuç: **sade/düz arka planlı**, tek nesne fotoğrafları (oyuncak, ürün, karakter, kendi çizimi…). Kalabalık bir sahne tek bir kapalı modele dönüşmez.
- Üretim ücretsiz GPU kuyruğuna bağlıdır. Kota doluysa sayfa bunu yazar; kabartma göstermez.
- Çıktı videosu WebM formatındadır (Chrome/Edge ile MP4 destekli tarayıcılar otomatik MP4 seçebilir). İstenirse Windows'ta "Fotoğraflar" ya da VLC ile MP4'e dönüştürülebilir.
- Sitede banner `assets/banner.jpg` olarak kullanılır — kendi görselinizle değiştirebilirsiniz.

## Teknoloji

- Google Drive (opsiyonel): Google Identity Services token'ı ile Drive API multipart upload — tamamı tarayıcıdan.

- Saf HTML/CSS/JS (framework yok) + [Three.js](https://threejs.org) 0.160 (CDN'den).
- 3D: görsel Hugging Face üzerindeki Hunyuan3D / Stable Fast 3D alanına gider, dönen dosya GLB olur (`mesh3d.js`). Sahne Three.js.
- Video: `canvas.captureStream()` + `MediaRecorder`, 5 saniyede tam bir tur.
- İsteğe bağlı renk: yerel `dev-server.js` üzerinden Gemini görsel API'si. Anahtar yalnızca `.env`.
