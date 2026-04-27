// Imperative toast — matches the legacy UI where toasts are DOM-driven, not
// component state. Easier than threading a toast context through every screen.
let _timer;
export function toast(msg) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(_timer);
  _timer = setTimeout(() => el.classList.remove('show'), 2200);
}

// "+N XP" flyout — called from earnXP. DOM-only so it doesn't re-render anything.
export function floatXp(amount) {
  if (typeof document === 'undefined') return;
  const el = document.createElement('div');
  el.className = 'xp-float';
  el.textContent = `+${amount} XP`;
  el.style.cssText = `left:${window.innerWidth / 2 - 28}px;top:${window.innerHeight * 0.42}px`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 850);
}

// Confetti at results screen.
export function launchConfetti() {
  if (typeof document === 'undefined') return;
  const cols = ['var(--y)', 'var(--g)', 'var(--pk)', 'var(--b)', 'var(--pu)', '#fff'];
  for (let i = 0; i < 50; i++) {
    const el = document.createElement('div');
    el.className = 'confetti-piece';
    el.style.cssText =
      `left:${Math.random() * 100}vw;top:-10px;` +
      `background:${cols[Math.floor(Math.random() * cols.length)]};` +
      `animation-duration:${2 + Math.random() * 2}s;animation-delay:${Math.random() * 1.2}s;` +
      `width:${6 + Math.random() * 8}px;height:${6 + Math.random() * 8}px`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 4500);
  }
}
