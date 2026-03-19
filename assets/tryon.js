// TryOn - AI Jewellery Try-On for Shopify
// Mirrors the logic from tryout.txt using vanilla JS

const TryOn = (() => {
  const API = 'http://127.0.0.1:6050';

  let quality = localStorage.getItem('jewellery_tryon_quality') || '1K';
  let jewelleryImage = null;
  let jewelleryType = 'ring';
  let jewelleryIndex = 1;

  let videoStream = null;
  let handsInstance = null;
  let cameraInstance = null;
  let timerRef = null;
  let prevLandmark = null;
  let captured = false;
  let capturedBlobUrl = null;
  let qualityMenuOpen = false;

  // ── DOM helpers ──────────────────────────────────────────────────────────────
  const $ = (id) => document.getElementById(id);

  function setStatus(msg) {
    const el = $('tryon-status');
    if (el) el.textContent = msg;
  }

  function showCameraView() {
    $('tryon-camera-view').style.display = 'flex';
    $('tryon-result-view').style.display = 'none';
  }

  function showResultView() {
    $('tryon-camera-view').style.display = 'none';
    $('tryon-result-view').style.display = 'flex';
  }

  function updateQualityUI() {
    ['tryon-quality-label', 'tryon-quality-badge', 'tryon-result-quality-badge'].forEach((id) => {
      const el = $(id);
      if (el) el.textContent = quality;
    });
    document.querySelectorAll('.tryon-q-check').forEach((el) => {
      el.style.display = el.dataset.q === quality ? 'inline' : 'none';
    });
  }

  // ── Camera ───────────────────────────────────────────────────────────────────
  async function startCamera() {
    try {
      videoStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
      const video = $('tryon-video');
      video.srcObject = videoStream;
      video.onloadedmetadata = () => {
        video.play();
        setStatus('Show your hand clearly');
      };
    } catch {
      setStatus('Camera access denied');
    }
  }

  function stopCamera() {
    if (videoStream) {
      videoStream.getTracks().forEach((t) => t.stop());
      videoStream = null;
    }
    if (cameraInstance) {
      try { cameraInstance.stop(); } catch {}
      cameraInstance = null;
    }
  }

  // ── MediaPipe Hands ──────────────────────────────────────────────────────────
  function initHands() {
    if (!window.Hands || !window.Camera) return;

    handsInstance = new window.Hands({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
    });

    handsInstance.setOptions({
      maxNumHands: 1,
      modelComplexity: 1,
      minDetectionConfidence: 0.7,
      minTrackingConfidence: 0.7,
    });

    handsInstance.onResults((results) => {
      if (captured) return;

      if (results.multiHandLandmarks && results.multiHandLandmarks.length) {
        const landmarks = results.multiHandLandmarks[0];
        const target = jewelleryType === 'bracelet' ? landmarks[0] : landmarks[16];

        if (!target) { setStatus('Show your hand clearly'); return; }

        if (prevLandmark) {
          const dx = target.x - prevLandmark.x;
          const dy = target.y - prevLandmark.y;
          if (Math.sqrt(dx * dx + dy * dy) > 0.02) {
            clearTimeout(timerRef);
            timerRef = null;
            setStatus('Hold your hand steady');
            prevLandmark = target;
            return;
          }
        }

        prevLandmark = target;

        if (!timerRef) {
          setStatus('Hold still... capturing in 3 seconds');
          timerRef = setTimeout(captureAndSend, 3000);
        }
      } else {
        setStatus('Show your hand to camera');
        clearTimeout(timerRef);
        timerRef = null;
      }
    });

    const video = $('tryon-video');
    cameraInstance = new window.Camera(video, {
      onFrame: async () => { await handsInstance.send({ image: video }); },
      width: 640,
      height: 480,
    });
    cameraInstance.start();
  }

  // ── Capture & API call ───────────────────────────────────────────────────────
  async function captureAndSend() {
    if (captured) return;
    captured = true;

    const video = $('tryon-video');
    const canvas = $('tryon-canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);

    const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.95));
    capturedBlobUrl = URL.createObjectURL(blob);

    // Show captured still instead of live video
    const capturedImg = $('tryon-captured');
    capturedImg.src = capturedBlobUrl;
    capturedImg.style.display = 'block';
    $('tryon-video').style.display = 'none';

    setStatus(`Generating AI Try-On in ${quality} quality...`);

    const formData = new FormData();
    formData.append('person', blob, 'hand.jpg');
    formData.append('type', jewelleryType);
    formData.append('index', jewelleryIndex);
    formData.append('quality', quality);
    if (jewelleryImage) formData.append('jewellery_url', jewelleryImage);

    try {
      const res = await fetch(`${API}/api/generate-jewellery-tryon`, {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();

      if (data.success) {
        const resultUrl = data.result_url || (data.result_urls && data.result_urls[0]);
        showResult(resultUrl);
      } else {
        setStatus('Try-On Failed. Try again.');
        captured = false;
        $('tryon-video').style.display = 'block';
        capturedImg.style.display = 'none';
      }
    } catch {
      setStatus('Server Error. Try again.');
      captured = false;
      $('tryon-video').style.display = 'block';
      capturedImg.style.display = 'none';
    }
  }

  function showResult(resultUrl) {
    $('tryon-result-img').src = resultUrl;
    $('tryon-hand-preview').src = capturedBlobUrl || '';
    $('tryon-jewellery-preview').src = jewelleryImage || '';
    showResultView();
  }

  // ── Public API ───────────────────────────────────────────────────────────────
  function open(opts = {}) {
    jewelleryImage = opts.image || null;
    jewelleryType = opts.type || 'ring';
    jewelleryIndex = opts.index || 1;
    captured = false;
    prevLandmark = null;
    timerRef = null;
    capturedBlobUrl = null;

    updateQualityUI();
    showCameraView();

    const modal = $('tryon-modal');
    modal.style.display = 'block';
    document.body.style.overflow = 'hidden';

    // Reset video/captured state
    $('tryon-video').style.display = 'block';
    $('tryon-captured').style.display = 'none';

    startCamera().then(() => {
      // Wait for MediaPipe to be available (loaded async)
      const waitForMP = setInterval(() => {
        if (window.Hands && window.Camera) {
          clearInterval(waitForMP);
          initHands();
        }
      }, 300);
    });
  }

  function close() {
    stopCamera();
    clearTimeout(timerRef);
    timerRef = null;
    handsInstance = null;

    $('tryon-modal').style.display = 'none';
    document.body.style.overflow = '';
  }

  function tryAgain() {
    captured = false;
    prevLandmark = null;
    capturedBlobUrl = null;
    clearTimeout(timerRef);
    timerRef = null;

    $('tryon-video').style.display = 'block';
    $('tryon-captured').style.display = 'none';
    showCameraView();
    setStatus('Show your hand to camera');

    stopCamera();
    startCamera().then(() => {
      if (handsInstance) {
        const video = $('tryon-video');
        cameraInstance = new window.Camera(video, {
          onFrame: async () => { await handsInstance.send({ image: video }); },
          width: 640,
          height: 480,
        });
        cameraInstance.start();
      }
    });
  }

  function toggleQuality() {
    qualityMenuOpen = !qualityMenuOpen;
    $('tryon-quality-menu').style.display = qualityMenuOpen ? 'block' : 'none';
    $('tryon-quality-arrow').style.transform = qualityMenuOpen ? 'rotate(180deg)' : '';
  }

  function setQuality(q) {
    quality = q;
    localStorage.setItem('jewellery_tryon_quality', q);
    updateQualityUI();
    qualityMenuOpen = false;
    $('tryon-quality-menu').style.display = 'none';
    $('tryon-quality-arrow').style.transform = '';
  }

  // Close quality menu on outside click
  document.addEventListener('click', (e) => {
    if (qualityMenuOpen && !e.target.closest('#tryon-quality-btn') && !e.target.closest('#tryon-quality-menu')) {
      qualityMenuOpen = false;
      const menu = $('tryon-quality-menu');
      if (menu) menu.style.display = 'none';
      const arrow = $('tryon-quality-arrow');
      if (arrow) arrow.style.transform = '';
    }
  });

  return { open, close, tryAgain, toggleQuality, setQuality };
})();
