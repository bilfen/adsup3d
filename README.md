# Bilfen AD'S UP — Görselden Videoya

Öğrenci bir görsel yükler. Görsel, ücretsiz buluttaki açık kaynak [LTX-Video](https://github.com/Lightricks/LTX-Video) modeliyle yaklaşık 2 saniyelik bir MP4 olur ve bilgisayara iner.

## Nasıl çalışır?

1. Öğrenci görseli sürükleyip bırakır (veya tıklayarak seçer). İsteğe bağlı bir hareket cümlesi yazabilir.
2. Görsel, Hugging Face üzerindeki `Lightricks/ltx-video-distilled` alanına gider. Üretim genelde bir-iki dakika sürer.
3. Dönen dosya MP4’tir. Sayfada oynar ve kendiliğinden inmeye başlar.
4. İnmezse karttaki **⬇ İndir** aynı dosyayı tekrar kaydeder. Chrome veya Edge kullanın.

Görsel bu bilgisayardan çıkar. Ücretsiz ekran kartı kotası aynı interneti paylaşan herkes için ortaktır. Kota dolunca sayfa bunu yazar; 3D kabartma veya sahte bir yakınlaştırma göstermez.

## İsteğe bağlı: Gemini ile renk canlandırma

Gemini **video üretmez**. Yalnızca işaretlenirse görseli daha canlı renge çevirir; video yine LTX bulutunda üretilir.

1. `.env.example` dosyasını `.env` yapın ve `GEMINI_API_KEY=` satırına anahtarı yazın.
2. `bun dev-server.js` ile `http://localhost:8080` açın. Sayfada "Gemini ile renkleri canlandır" kutusu çıkar.
3. Kutu işaretliyse görsel önce Google'a gider. Video için görsel her durumda Hugging Face’e gider.
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

1. Bu klasördeki **tüm dosyaları** (`index.html`, `app.js`, `i2v.js`, `assets/`, `dev-server.js`, bu README) Bilfen GitHub hesabında yeni bir repoya yükleyin (örn. `adsup-3d`).
   - Hızlı yöntem: GitHub web'de *Add file → Upload files* ile sürükleyip bırakın. `dev-server.js` yalnızca yerel test için kullanılır, yüklemeseniz de olur.
2. Repo → **Settings → Pages** → *Source*: **Deploy from a branch** → Branch: **main** / **/(root)** → *Save*.
3. 1–2 dakika sonra `https://<GitHub-kullanıcı-adı>.github.io/adsup-3d/` adresi yayında olur.
4. Öğrenciler bu adresi tarayıcıda açar — kurulum, hesap veya anahtar gerekmez.

> GitHub Pages üzerinde sayfa açılır. Video ücretsiz Hugging Face ekran kartında üretilir. Gemini renk kutusu yalnızca yerel sunucuda görünür; `.env` dosyasını repoya koymayın.

## Yerel test

Bu bilgisayarda Bun/Node/Python yoksa:

```powershell
powershell -ExecutionPolicy Bypass -File serve.ps1
```

Tarayıcıda `http://localhost:8080` açın. Dosyayı çift tıklayarak açmayın; tarayıcı modülleri `file://` adresinde çalışmaz.

Bun yüklüyse `bun dev-server.js` aynı adresi açar. Python varsa `python -m http.server 8080` videoyu açar, Gemini kutusunu açmaz.

## Sınırlar & iyi sonuç için ipuçları

- En iyi sonuç: tek özne, sade arka plan. Kalabalık sahnede hareket dağınık olabilir.
- Klip yaklaşık 2 saniyedir ve 512×704 boyutunda üretilir.
- Üretim ücretsiz GPU kuyruğuna bağlıdır. Kota doluysa sayfa bunu yazar.
- Çıktı MP4’tir.
- Sitede banner `assets/banner.jpg` olarak kullanılır — kendi görselinizle değiştirebilirsiniz.

## Teknoloji

- Saf HTML/CSS/JS (framework yok).
- Video: `i2v.js` görseli `https://lightricks-ltx-video-distilled.hf.space` adresine yükler, Gradio kuyruğundan MP4 indirir. Model [LTX-Video](https://github.com/Lightricks/LTX-Video).
- Google Drive (opsiyonel): Google Identity Services token'ı ile Drive API multipart upload — tamamı tarayıcıdan.
- İsteğe bağlı renk: yerel `dev-server.js` üzerinden Gemini görsel API'si. Anahtar yalnızca `.env`.
