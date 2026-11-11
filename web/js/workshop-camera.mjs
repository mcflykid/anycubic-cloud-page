import { $, serverText, set, tr } from './workshop-ui.mjs?v=a063449a11af';

const CAMERA_PRESENCE_INTERVAL_MS = 45000;

/** Possède le lecteur et ses générations sans partager ses identifiants avec les autres panneaux. */
export function createCamera(request, getPrinter) {
  let client = null,
    track = null,
    viewer = null,
    sdkPromise = null;
  let generation = 0,
    releasePending = Promise.resolve(),
    zoom = 1,
    wanted = false;
  let presenceTimer = null,
    presencePending = false;

  function stopPresence() {
    if (presenceTimer !== null) clearInterval(presenceTimer);
    presenceTimer = null;
  }

  async function signalPresence(target) {
    if (
      presencePending ||
      document.visibilityState !== 'visible' ||
      viewer !== target ||
      !client
    )
      return;
    presencePending = true;
    try {
      // Ce battement local évite de redemander une session Cloud pour garder un spectateur actif.
      await request('/camera-presence', {
        method: 'POST',
        printerKey: target.printer,
        headers: { 'X-Camera-Viewer': target.id },
        timeoutMs: 5000,
      });
    } catch (error) {
      // Une panne réseau attend le prochain battement ; ce signal local n’a aucun ordre à rejouer.
      if (error.cameraPresenceExpired && viewer === target) {
        const closing = await close();
        if (closing === generation) set('camera-state', tr('Session caméra expirée'));
      }
    } finally {
      presencePending = false;
    }
  }

  function startPresence(target) {
    stopPresence();
    presenceTimer = setInterval(() => void signalPresence(target), CAMERA_PRESENCE_INTERVAL_MS);
  }

  function refreshVisiblePresence() {
    if (document.visibilityState === 'visible' && viewer && client)
      void signalPresence(viewer);
  }

  function loadSdk() {
    if (!sdkPromise)
      sdkPromise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = '/imprimante-api/ui/js/agora-rtc.js';
        script.onload = () => resolve(window.AgoraRTC);
        script.onerror = () => reject(new Error(tr('Le lecteur vidéo n’a pas pu être chargé.')));
        document.head.append(script);
      });
    return sdkPromise;
  }

  /** Garde la fermeture réseau awaitable et borne l’attente pour laisser le navigateur terminer. */
  function releaseViewer(options) {
    releasePending = request('/camera-close', { ...options, timeoutMs: 7000, keepalive: true }).catch(() => {});
    return releasePending;
  }

  async function close() {
    const previous = viewer;
    viewer = null;
    stopPresence();
    const released = previous
      ? releaseViewer({
          method: 'POST',
          printerKey: previous.printer,
          headers: { 'X-Camera-Viewer': previous.id },
        })
      : releasePending;
    wanted = false;
    const closing = ++generation;
    $('camera-start').disabled = false;
    $('camera-stop').disabled = true;
    track?.stop();
    track = null;
    $('camera-video').replaceChildren();
    set('camera-state', tr('Caméra éteinte'));
    const old = client;
    client = null;
    const left = old ? Promise.resolve().then(() => old.leave()).catch(() => {}) : Promise.resolve();
    await Promise.all([released, left]);
    return closing;
  }

  async function open() {
    let opening;
    try {
      const closing = await close();
      if (closing !== generation) return;
      opening = ++generation;
      wanted = true;
      $('camera-start').disabled = true;
      $('camera-stop').disabled = false;
      set('camera-state', tr('Connexion en cours…'));
      delete $('camera-state').dataset.tooltip;
      const sdk = await loadSdk();
      if (opening !== generation) return;
      sdk.setLogLevel(3);
      viewer = { id: crypto.randomUUID(), printer: getPrinter() };
      const options = {
        method: 'POST',
        printerKey: viewer.printer,
        headers: { 'X-Camera-Viewer': viewer.id },
      };
      const session = await request('/camera-session', options);
      if (opening !== generation) {
        releaseViewer(options);
        return;
      }
      const mine = sdk.createClient({ mode: 'live', codec: 'h264', role: 'host' });
      client = mine;
      const current = () => opening === generation && client === mine;
      const subscribe = async (user) => {
        if (!current()) return;
        await mine.subscribe(user, 'video');
        if (!current()) return;
        track = user.videoTrack;
        track.play('camera-video');
        set('camera-state', tr('Caméra connectée'));
      };
      mine.on('user-published', (user, type) => {
        if (type === 'video')
          subscribe(user).catch(() => {
            if (current()) set('camera-state', tr('Flux vidéo indisponible'));
          });
      });
      mine.on('user-unpublished', () => {
        if (current()) set('camera-state', tr('Flux vidéo interrompu'));
      });
      mine.on('user-left', () => {
        if (current()) set('camera-state', tr('Caméra déconnectée'));
      });
      let renewing = false;
      mine.on('token-privilege-will-expire', async () => {
        if (!current() || renewing) return;
        renewing = true;
        try {
          const updated = await request('/camera-session', options);
          if (!current()) {
            releaseViewer(options);
            return;
          }
          // Un jeton Agora d’une autre session ne peut pas prolonger le canal déjà rejoint.
          const sameSession = ['appid', 'channel', 'client_uid', 'encryption_mode', 'encryption_key', 'encryption_kdf_salt']
            .every((field) => updated[field] === session[field]);
          if (!sameSession || typeof updated.rtc_token !== 'string' || !updated.rtc_token) {
            set('camera-state', tr('Session caméra expirée'));
            return;
          }
          await mine.renewToken(updated.rtc_token);
        } catch {
          if (current()) set('camera-state', tr('Session caméra expirée'));
        } finally {
          renewing = false;
        }
      });
      const salt = Uint8Array.from(atob(session.encryption_kdf_salt), (character) =>
        character.charCodeAt(0),
      );
      mine.setEncryptionConfig(
        String(session.encryption_mode).toLowerCase().replaceAll('_', '-'),
        session.encryption_key,
        salt,
      );
      await mine.setClientRole('host');
      await mine.join(
        session.appid,
        session.channel,
        session.rtc_token || null,
        session.client_uid || null,
      );
      if (opening !== generation) {
        await mine.leave();
        return;
      }
      startPresence(viewer);
      await Promise.all(mine.remoteUsers.filter((user) => user.hasVideo).map(subscribe));
      if (current())
        set('camera-state', track ? tr('Caméra connectée') : tr('En attente de la vidéo'));
    } catch (error) {
      if (opening !== generation) return;
      const closing = await close();
      if (closing !== generation) return;
      const known = ['missing_credentials', 'invalid_format', 'unsupported_transport'].includes(
        error.cameraReason,
      );
      set('camera-state', known ? error.message : tr('Caméra indisponible'));
      $('camera-state').dataset.tooltip = known
        ? error.message
        : tr('La session vidéo ne peut pas être ouverte pour le moment.');
    }
  }

  function renderZoom() {
    $('camera-video').style.transform = `scale(${zoom})`;
    set('zoom-label', `${Math.round(zoom * 100)} %`);
  }

  $('camera-start').onclick = open;
  $('camera-stop').onclick = close;
  document.addEventListener('visibilitychange', refreshVisiblePresence);
  for (const [id, change] of [
    ['zoom-in', 0.25],
    ['zoom-out', -0.25],
  ]) {
    $(id).onclick = () => {
      zoom = Math.min(4, Math.max(1, zoom + change));
      renderZoom();
    };
  }
  $('zoom-reset').onclick = () => {
    zoom = 1;
    renderZoom();
  };
  $('fullscreen').onclick = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else $('camera-wrapper').requestFullscreen();
  };

  return {
    open,
    close,
    get hasVideo() {
      return !!track;
    },
    updateDiagnostic(diagnostic) {
      if (wanted && !track && diagnostic)
        set(
          'camera-state',
          serverText(diagnostic.message, 'Pas de diagnostic traduit pour cet événement.'),
        );
    },
  };
}
