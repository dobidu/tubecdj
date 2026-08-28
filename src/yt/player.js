// Per-deck wrapper around the YouTube IFrame Player API.
// Only what a CDJ needs: transport, seek, volume, playback rate, metadata.

let apiPromise = null;

export function loadYouTubeApi() {
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve, reject) => {
    if (window.YT && window.YT.Player) return resolve(window.YT);
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { prev?.(); resolve(window.YT); };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.async = true;
    s.onerror = () => reject(new Error('Falha ao carregar a IFrame Player API'));
    document.head.appendChild(s);
  });
  return apiPromise;
}

export const PS = { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 };

export class DeckPlayer {
  /** @param {HTMLElement} mount empty div the iframe replaces */
  constructor(mount, handlers = {}) {
    this.mount = mount;
    this.handlers = handlers;
    this.player = null;
    this.ready = false;
    this._vol = 100;
    this._rate = 1;
  }

  async init() {
    const YT = await loadYouTubeApi();
    await new Promise((resolve) => {
      this.player = new YT.Player(this.mount, {
        width: '100%',
        height: '100%',
        playerVars: {
          controls: 0, disablekb: 1, modestbranding: 1, rel: 0, fs: 0,
          iv_load_policy: 3, playsinline: 1, origin: location.origin,
        },
        events: {
          onReady: () => { this.ready = true; this.handlers.onReady?.(this); resolve(); },
          onStateChange: (e) => {
            this.handlers.onStateChange?.(e.data, this);
            if (e.data === PS.ENDED) this.handlers.onEnded?.(this);
          },
          onError: (e) => this.handlers.onError?.(e.data, this),
        },
      });
    });
    return this;
  }

  load(videoId, { start = 0, autoplay = false } = {}) {
    if (!this.ready) return;
    if (autoplay) this.player.loadVideoById({ videoId, startSeconds: start });
    else this.player.cueVideoById({ videoId, startSeconds: start });
  }

  loadPlaylist(listId, { index = 0, autoplay = false } = {}) {
    if (!this.ready) return;
    this.player.cuePlaylist({ listType: 'playlist', list: listId, index });
    if (autoplay) this.player.playVideo();
  }

  play() { this.ready && this.player.playVideo(); }
  pause() { this.ready && this.player.pauseVideo(); }
  stop() { this.ready && this.player.stopVideo(); }
  seek(t) { this.ready && this.player.seekTo(Math.max(0, t), true); }

  /** @param {number} v 0..1 */
  setVolume(v) {
    if (!this.ready) return;
    const n = Math.round(Math.max(0, Math.min(1, v)) * 100);
    if (n === this._vol) return;
    this._vol = n;
    this.player.setVolume(n);
    if (n === 0) this.player.mute(); else if (this.player.isMuted()) this.player.unMute();
  }

  setMuted(on) {
    if (!this.ready) return;
    on ? this.player.mute() : this.player.unMute();
  }

  /** YouTube preserves perceived pitch when the rate changes (native key lock). */
  setRate(r) {
    if (!this.ready) return;
    const n = Math.max(0.25, Math.min(2, r));
    if (Math.abs(n - this._rate) < 0.001) return;
    this._rate = n;
    this.player.setPlaybackRate(n);
  }

  get time() { return this.ready ? (this.player.getCurrentTime() || 0) : 0; }
  get duration() { return this.ready ? (this.player.getDuration() || 0) : 0; }
  get playerState() { return this.ready ? this.player.getPlayerState() : PS.UNSTARTED; }
  get isPlaying() { return this.playerState === PS.PLAYING || this.playerState === PS.BUFFERING; }

  videoData() {
    try { return this.player.getVideoData() || {}; } catch { return {}; }
  }
  playlistIds() {
    try { return this.player.getPlaylist() || []; } catch { return []; }
  }
  iframe() { return this.ready ? this.player.getIframe() : null; }
}
