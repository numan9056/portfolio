(function () {
  'use strict';

  // ── Scroll-reveal via IntersectionObserver ───────────────────
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.1, rootMargin: '0px 0px -32px 0px' }
  );

  document.querySelectorAll('.reveal').forEach((el) => observer.observe(el));

  // ── Nav glass blur on scroll ─────────────────────────────────
  const nav = document.querySelector('.nav');
  if (nav) {
    const tick = () => nav.classList.toggle('nav--scrolled', window.scrollY > 20);
    window.addEventListener('scroll', tick, { passive: true });
    tick();
  }

  // ── Dark / Light mode toggle ─────────────────────────────────
  const root   = document.documentElement;
  const toggle = document.getElementById('theme-toggle');

  // Apply saved preference immediately (before paint)
  const saved = localStorage.getItem('theme');
  if (saved) root.setAttribute('data-theme', saved);

  if (toggle) {
    toggle.addEventListener('click', () => {
      const isDark = root.getAttribute('data-theme') === 'dark';
      const next   = isDark ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      localStorage.setItem('theme', next);
    });
  }

})();
