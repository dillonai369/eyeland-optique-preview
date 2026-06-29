/* =========================================================
   Glimpse Vision — Motion (native scroll, no Lenis)
   - IntersectionObserver scroll reveals
   - Hero h1 character reveal on load
   - Mouse-follow hero glow
   - GSAP ScrollTrigger for pinned brand showcase + hero parallax
   - Honors prefers-reduced-motion
   ========================================================= */
(function () {
  var prefersReduced = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------- Header scroll state ----------
  // rAF-throttled scroll handler so we don't run logic on every wheel tick.
  // Reduces jank on lower-power devices and avoids flicker on the
  // is-scrolled boundary.
  var header = document.querySelector('.site-header');
  if (header) {
    var heroEl = document.querySelector('.hero');
    if (heroEl) {
      var threshold = Math.max(heroEl.getBoundingClientRect().height - 100, 60);
      var ticking = false;
      var applyScrollState = function () {
        if (window.scrollY > threshold) header.classList.add('is-scrolled');
        else header.classList.remove('is-scrolled');
        ticking = false;
      };
      var onScroll = function () {
        if (!ticking) {
          window.requestAnimationFrame(applyScrollState);
          ticking = true;
        }
      };
      // Debounced resize so iOS URL-bar collapses don't thrash recalc.
      var resizeTimer = null;
      var onResize = function () {
        if (resizeTimer) clearTimeout(resizeTimer);
        resizeTimer = setTimeout(function () {
          threshold = Math.max(heroEl.getBoundingClientRect().height - 100, 60);
          applyScrollState();
        }, 120);
      };
      window.addEventListener('scroll', onScroll, { passive: true });
      window.addEventListener('resize', onResize, { passive: true });
      // iOS orientation change fires resize but viewport may not be settled
      window.addEventListener('orientationchange', onResize, { passive: true });
      applyScrollState();
    } else {
      header.classList.add('is-scrolled');
    }
  }

  // ---------- Hero h1 character reveal (load animation only) ----------
  document.querySelectorAll('.hero h1[data-split]').forEach(function (h) {
    var html = h.innerHTML;
    var wrap = function (str) {
      return str.split('').map(function (c) {
        if (c === ' ') return ' ';
        return '<span class="char">' + c + '</span>';
      }).join('');
    };
    var tmp = document.createElement('div');
    tmp.innerHTML = html;
    var out = '';
    tmp.childNodes.forEach(function (n) {
      if (n.nodeType === 3) {
        out += wrap(n.textContent);
      } else if (n.nodeName.toLowerCase() === 'br') {
        out += '<br>';
      } else {
        out += '<' + n.nodeName.toLowerCase() + (n.className ? ' class="' + n.className + '"' : '') + '>' +
          wrap(n.textContent) + '</' + n.nodeName.toLowerCase() + '>';
      }
    });
    h.innerHTML = out;
    requestAnimationFrame(function () {
      var chars = h.querySelectorAll('.char');
      chars.forEach(function (c, i) {
        c.style.transitionDelay = (i * 16) + 'ms';
      });
      h.classList.add('is-loaded');
    });
  });

  // ---------- Mouse-follow hero glow (cheap, paint-only) ----------
  var hero = document.querySelector('.hero');
  if (hero && !prefersReduced) {
    hero.addEventListener('pointermove', function (e) {
      var r = hero.getBoundingClientRect();
      var x = ((e.clientX - r.left) / r.width) * 100;
      var y = ((e.clientY - r.top) / r.height) * 100;
      hero.style.setProperty('--mx', x + '%');
      hero.style.setProperty('--my', y + '%');
    });
  }

  // ---------- Big stats: count up from 0 when scrolled into view ----------
  (function () {
    var statEls = document.querySelectorAll('.big-stat .num');
    if (!statEls.length || !('IntersectionObserver' in window)) return;

    // Stash final values + original HTML; start displayed value at 0
    statEls.forEach(function (el) {
      var raw = (el.textContent || '').trim();
      var target = parseInt(raw, 10);
      if (isNaN(target)) return;
      el.dataset.target = String(target);
      el.dataset.hasEm = el.querySelector('em') ? '1' : '0';
      el.textContent = '0';
      if (el.dataset.hasEm === '1') el.innerHTML = '<em>0</em>';
    });

    if (prefersReduced) {
      // Skip the animation — just show final values immediately
      statEls.forEach(function (el) {
        var t = el.dataset.target;
        if (!t) return;
        el.innerHTML = el.dataset.hasEm === '1' ? '<em>' + t + '</em>' : t;
      });
      return;
    }

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        var el = e.target;
        var target = parseInt(el.dataset.target, 10);
        if (!target) { io.unobserve(el); return; }
        var start = performance.now();
        var duration = 1200;
        function step(now) {
          var t = Math.min(1, (now - start) / duration);
          var eased = 1 - Math.pow(1 - t, 3);  // ease-out cubic
          var current = Math.round(eased * target);
          if (el.dataset.hasEm === '1') {
            el.innerHTML = '<em>' + current + '</em>';
          } else {
            el.textContent = String(current);
          }
          if (t < 1) requestAnimationFrame(step);
        }
        requestAnimationFrame(step);
        io.unobserve(el);
      });
    }, { threshold: 0.4 });

    statEls.forEach(function (el) { io.observe(el); });
  })();

  // ---------- IntersectionObserver scroll reveals ----------
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          e.target.classList.add('visible');
          io.unobserve(e.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
    document.querySelectorAll('.reveal, .reveal-mask, .split-headline').forEach(function (el) {
      io.observe(el);
    });
  } else {
    document.querySelectorAll('.reveal, .reveal-mask, .split-headline').forEach(function (el) {
      el.classList.add('visible');
    });
  }

  // ---------- GSAP ScrollTrigger (pinned showcase + hero parallax) ----------
  function initGsap() {
    if (prefersReduced) return;
    if (!window.gsap || !window.ScrollTrigger) return;

    window.gsap.registerPlugin(window.ScrollTrigger);

    // Pinned horizontal brand showcase (side panel is inside the track and scrolls with it)
    // SKIP when .showcase--manual is present — that variant uses native horizontal scroll instead of GSAP pin
    var showcase = document.querySelector('.showcase:not(.showcase--manual)');
    var track = showcase ? showcase.querySelector('.showcase-track') : null;
    var pin = showcase ? showcase.querySelector('.showcase-pin') : null;
    var counter = showcase ? showcase.querySelector('.showcase-counter .num') : null;
    if (showcase && track && pin && window.matchMedia('(min-width: 821px)').matches) {
      var panels = track.querySelectorAll('.showcase-panel');
      // Sum width of every direct child of the track — including .showcase-side
      var trackTotalWidth = 0;
      Array.prototype.forEach.call(track.children, function (c) {
        trackTotalWidth += c.getBoundingClientRect().width;
      });
      // Scroll just far enough for the last panel's right edge to meet the
      // viewport's right edge. No extra buffer — extra scroll past the visible
      // end feels like the section is "locked" without showing new content.
      var scrollDistance = trackTotalWidth - window.innerWidth;
      if (scrollDistance > 0) {
        // Compress the scroll-to-translation ratio slightly so it feels less
        // sluggish — user scrolls ~85% of pixel distance and the track still
        // translates the full width. This shortens the time spent pinned.
        var scrollLength = Math.round(scrollDistance * 0.85);
        window.gsap.to(track, {
          x: -scrollDistance,
          ease: 'none',
          scrollTrigger: {
            trigger: showcase,
            start: 'top top',
            end: '+=' + scrollLength,
            scrub: 0.4,           // small smoothing so it doesn't feel jittery
            pin: true,
            pinSpacing: true,
            anticipatePin: 1,
            invalidateOnRefresh: true
          }
        });

        if (counter) {
          panels.forEach(function (p, i) {
            window.ScrollTrigger.create({
              trigger: p,
              start: 'left center',
              end: 'right center',
              onEnter: function () { counter.textContent = String(i + 1).padStart(2, '0'); },
              onEnterBack: function () { counter.textContent = String(i + 1).padStart(2, '0'); }
            });
          });
        }
      }
    }

    // Subtle hero parallax on background frames
    document.querySelectorAll('.hero-frames svg').forEach(function (svg, i) {
      window.gsap.to(svg, {
        y: (i + 1) * -80,
        ease: 'none',
        scrollTrigger: {
          trigger: '.hero',
          start: 'top top',
          end: 'bottom top',
          scrub: true
        }
      });
    });

    window.ScrollTrigger.refresh();

    // Debounced refresh on resize / orientation change so the pinned showcase
    // re-measures its track width and the threshold heights stay correct.
    // This is the #1 fix for "scroll glitches" after resize or rotate.
    var gsapResizeTimer = null;
    var doRefresh = function () {
      if (gsapResizeTimer) clearTimeout(gsapResizeTimer);
      gsapResizeTimer = setTimeout(function () {
        if (window.ScrollTrigger) window.ScrollTrigger.refresh();
      }, 200);
    };
    window.addEventListener('resize', doRefresh, { passive: true });
    window.addEventListener('orientationchange', doRefresh, { passive: true });
    // Also refresh when the hero video metadata loads (its rendered size
    // can shift after first paint, which throws off the showcase pin).
    var heroVideo = document.querySelector('.hero-media video');
    if (heroVideo) {
      heroVideo.addEventListener('loadedmetadata', doRefresh, { once: true });
    }
  }

  if (document.readyState === 'complete') initGsap();
  else window.addEventListener('load', initGsap);

  // ---------- Mobile menu: close after tapping a link ----------
  // The inline onclick on the burger button opens/closes the panel. After a
  // tap on any nav link the panel should auto-close, otherwise the user is
  // stuck looking at the menu instead of the page they just navigated to.
  var mobileNav = document.getElementById('mob');
  if (mobileNav) {
    mobileNav.addEventListener('click', function (e) {
      var target = e.target;
      // Walk up to find an anchor (clicks may land on inner text/icon)
      while (target && target !== mobileNav && target.nodeName !== 'A') {
        target = target.parentNode;
      }
      if (target && target.nodeName === 'A' && target.getAttribute('href')) {
        // Same-page hash links don't navigate but should still close the menu
        mobileNav.classList.remove('open');
      }
    });
    // Close menu on Escape key for accessibility
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && mobileNav.classList.contains('open')) {
        mobileNav.classList.remove('open');
      }
    });
  }
})();
