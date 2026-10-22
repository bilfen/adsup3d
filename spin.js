// GLB modeli sabit kamerada bir tur döndürüp videoya kaydeder.
// Kayıt bu tarayıcıda olur; ikinci bir bulut hakkı harcanmaz.

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

function pickMime() {
  const list = ["video/mp4", "video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
  if (typeof MediaRecorder === "undefined") return "";
  return list.find((m) => MediaRecorder.isTypeSupported(m)) || "";
}

function fitCamera(camera, size) {
  const maxDim = Math.max(size.x, size.y, size.z, 0.001);
  const fov = (camera.fov * Math.PI) / 180;
  const dist = (maxDim * 0.62) / Math.tan(fov / 2);
  camera.position.set(maxDim * 0.15, maxDim * 0.22, dist);
  camera.near = dist / 100;
  camera.far = dist * 20;
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
}

/**
 * @returns {Promise<{blob: Blob, ext: string, ms: number}>}
 */
export async function spinToVideo(glbBlob, canvas, seconds, onStatus) {
  const mime = pickMime();
  if (!mime) throw new Error("Bu tarayıcı video kaydı yapamıyor. Chrome veya Edge kullan.");
  const report = onStatus || (() => {});
  const url = URL.createObjectURL(glbBlob);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(1);
  renderer.setSize(960, 540, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x101820);
  const camera = new THREE.PerspectiveCamera(32, 960 / 540, 0.01, 100);
  scene.add(new THREE.HemisphereLight(0xfff4e5, 0x243040, 1.35));
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(3, 4, 5);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0x9ecbff, 0.55);
  fill.position.set(-4, 1, -2);
  scene.add(fill);

  try {
    report("3B model sahneye alınıyor…", 90);
    const gltf = await new GLTFLoader().loadAsync(url);
    const root = gltf.scene;
    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    root.position.sub(center);
    scene.add(root);
    fitCamera(camera, size);
    renderer.render(scene, camera);

    const stream = canvas.captureStream(30);
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 4500000 });
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    const stopped = new Promise((resolve) => { rec.onstop = resolve; });
    const ms = Math.max(3, Math.min(8, Number(seconds) || 6)) * 1000;
    report("Model 360° dönüyor, video kaydediliyor…", 94);
    rec.start(200);
    const t0 = performance.now();
    await new Promise((resolve) => {
      const frame = (now) => {
        const t = Math.min(1, (now - t0) / ms);
        root.rotation.y = t * Math.PI * 2;
        renderer.render(scene, camera);
        if (t < 1) requestAnimationFrame(frame);
        else resolve();
      };
      requestAnimationFrame(frame);
    });
    rec.requestData();
    rec.stop();
    await stopped;
    stream.getTracks().forEach((t) => t.stop());
    const type = mime.startsWith("video/mp4") ? "video/mp4" : "video/webm";
    const blob = new Blob(chunks, { type });
    if (blob.size < 5000) throw new Error("Video kaydı boş kaldı. Sayfayı önde tutup yeniden dene.");
    return { blob, ext: type === "video/mp4" ? "mp4" : "webm", ms: Math.round(ms / 1000) };
  } finally {
    renderer.dispose();
    URL.revokeObjectURL(url);
  }
}
