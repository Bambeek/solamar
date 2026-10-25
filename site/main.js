/* Fills the page from BRAND (brand.js) and runs its motion. No dependencies. */
(function () {
  'use strict';

  var B = typeof BRAND === 'object' && BRAND ? BRAND : { name: '', slug: '', downloadUrl: '#download', macDownloadUrl: '#download', repoUrl: '', mcpPort: 47821 };
  var root = document.documentElement;
  var ARC_SUNSET = Date.UTC(2026, 11, 22); // December 22, 2026
  var still = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  function each(selector, fn) {
    Array.prototype.forEach.call(document.querySelectorAll(selector), fn);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // 1. Name everywhere it appears.
  each('[data-brand]', function (el) {
    var key = el.getAttribute('data-brand') || 'name';
    if (B[key] != null) el.textContent = B[key];
  });
  if (B.name && document.title.indexOf(B.name) === -1) {
    console.warn('BRAND.name is "' + B.name + '" but the <title> in index.html still says: ' + document.title);
  }

  // 2. Download buttons (data-download="windows" or "mac"; a bare one follows the visitor's system), and the optional
  //    source link.
  var real = function (u) { return !!u && u.charAt(0) !== '#'; };
  var urls = { windows: (B.downloadUrl || '').trim(), mac: (B.macDownloadUrl || '').trim() };
  var onMac = /Macintosh|Mac OS X/.test(navigator.userAgent) && !/iPhone|iPad/.test(navigator.userAgent);
  each('[data-download]', function (a) {
    var u = urls[a.getAttribute('data-download') || (onMac ? 'mac' : 'windows')];
    a.setAttribute('href', real(u) ? u : '#download');
  });
  root.classList.toggle('dl-pending', !real(urls.windows) && !real(urls.mac));
  if (B.repoUrl) {
    each('[data-repo]', function (el) { el.hidden = false; });
    each('[data-repo-link]', function (a) { a.setAttribute('href', B.repoUrl); });
  }

  // 3. Claude Code command, built from the brand so a rename carries through.
  var cmd = document.getElementById('mcp-cmd');
  if (cmd) {
    var port = Number(B.mcpPort) || 47821;
    cmd.innerHTML =
      '<span class="tok-cmd">claude</span> mcp add <span class="tok-flag">--transport</span> http ' +
      '<span class="tok-flag">--scope</span> user <span class="tok-name">' + escapeHtml(B.slug || 'browser') + '</span> ' +
      '<span class="tok-url">http://127.0.0.1:' + port + '/mcp</span> ' +
      '<span class="tok-flag">--header</span> <span class="tok-str">"Authorization: Bearer ' +
      escapeHtml('<from ' + (B.name || 'app') + ' settings>') + '"</span>';
  }

  // 4. Copy button.
  var status = document.getElementById('copy-status');
  each('[data-copy]', function (btn) {
    var label = btn.querySelector('.copy-label');
    btn.addEventListener('click', function () {
      var target = document.querySelector(btn.getAttribute('data-copy'));
      if (!target) return;
      var done = function (ok) {
        if (label) label.textContent = ok ? 'Copied' : 'Press Ctrl+C';
        if (status) status.textContent = ok ? 'Command copied to the clipboard.' : 'Copy failed. The command is selected; press Ctrl+C.';
        btn.classList.toggle('is-done', ok);
        setTimeout(function () {
          if (label) label.textContent = 'Copy';
          btn.classList.remove('is-done');
        }, 2000);
      };
      var selectIt = function () {
        var range = document.createRange();
        range.selectNodeContents(target);
        var sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(target.textContent).then(function () { done(true); }, function () { selectIt(); done(false); });
      } else {
        selectIt();
        done(false);
      }
    });
  });

  // 5. Days until Arc stops working, counted in calendar days on the visitor's clock.
  var now = new Date();
  var daysLeft = Math.max(0, Math.round((ARC_SUNSET - Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000));
  each('[data-days-left]', function (el) { el.textContent = String(daysLeft); });

  // 6. Top bar firms up once the page scrolls.
  var bar = document.getElementById('topbar');
  var onScroll = function () { if (bar) bar.classList.toggle('scrolled', window.scrollY > 24); };
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });

  // 7. Footer year.
  var year = document.getElementById('year');
  if (year) year.textContent = String(new Date().getFullYear());

  // 8. The tour: a view picked on the left shows its screenshot. While the tour is on screen it moves on by itself
  //    every few seconds, until the visitor picks one; reduced motion never moves it.
  var tour = document.querySelector('[data-tour]');
  if (tour) {
    var tabs = tour.querySelectorAll('[role="tab"]');
    var shots = tour.querySelectorAll('.tour-shot');
    var caption = tour.querySelector('.tour-caption');
    var TOUR_MS = 6500;
    var current = 0;
    var timer = 0;
    var picked = false;
    var visible = false;
    var show = function (i, focus) {
      current = (i + tabs.length) % tabs.length;
      var id = tabs[current].getAttribute('data-shot');
      Array.prototype.forEach.call(tabs, function (t, k) {
        var on = k === current;
        t.classList.toggle('on', on);
        t.setAttribute('aria-selected', String(on));
        t.tabIndex = on ? 0 : -1;
        var bar = t.querySelector('.tour-bar');
        if (bar) bar.classList.remove('run');
      });
      Array.prototype.forEach.call(shots, function (s) { s.classList.toggle('on', s.getAttribute('data-shot') === id); });
      if (caption) caption.textContent = tabs[current].querySelector('small').textContent;
      if (focus) tabs[current].focus();
      schedule();
    };
    var schedule = function () {
      clearTimeout(timer);
      if (still || picked || !visible || document.hidden) return;
      var bar = tabs[current].querySelector('.tour-bar');
      if (bar) {
        void bar.offsetWidth;
        bar.style.setProperty('--tour-ms', TOUR_MS + 'ms');
        bar.classList.add('run');
      }
      timer = setTimeout(function () { show(current + 1); }, TOUR_MS);
    };
    Array.prototype.forEach.call(tabs, function (t, k) {
      t.addEventListener('click', function () {
        picked = true;
        show(k);
      });
      t.addEventListener('keydown', function (e) {
        var step = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
        if (!step) return;
        e.preventDefault();
        picked = true;
        show(current + step, true);
      });
    });
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        visible = entries[0].isIntersecting;
        schedule();
      }, { threshold: 0.35 }).observe(tour);
    }
    document.addEventListener('visibilitychange', schedule);
    show(0);
  }
})();
