(() => {
  'use strict';

  // All numbers and campaign labels in this interface are synthetic.
  const syntheticMarkets = {
    all: {
      spend: '€82,410', revenue: '€286,940', roas: '3.48×', cpa: '€47.20',
      line: 'M20 196 C90 181 120 184 175 150 S270 162 335 116 S435 138 500 75 S615 81 700 35',
      area: 'M20 196 C90 181 120 184 175 150 S270 162 335 116 S435 138 500 75 S615 81 700 35 L700 228 L20 228Z'
    },
    core: {
      spend: '€63,780', revenue: '€241,260', roas: '3.78×', cpa: '€43.80',
      line: 'M20 203 C85 190 125 175 175 163 S269 150 335 126 S430 114 500 88 S612 71 700 44',
      area: 'M20 203 C85 190 125 175 175 163 S269 150 335 126 S430 114 500 88 S612 71 700 44 L700 228 L20 228Z'
    },
    new: {
      spend: '€18,630', revenue: '€45,680', roas: '2.45×', cpa: '€61.40',
      line: 'M20 211 C82 204 127 214 175 184 S268 195 335 163 S430 178 500 139 S613 152 700 110',
      area: 'M20 211 C82 204 127 214 175 184 S268 195 335 163 S430 178 500 139 S613 152 700 110 L700 228 L20 228Z'
    }
  };

  const roles = {
    founder: {
      kicker: 'EXECUTIVE PULSE',
      title: 'See whether growth is getting healthier.',
      body: 'Revenue, spend, blended efficiency and new-customer economics—without navigating a media-buying interface.',
      list: ['One-minute mobile read', 'Market and period comparisons', 'Business-level movement, not vanity metrics'],
      phoneTitle: 'Growth is healthier.', value: '3.48×', delta: '↑ 0.21 vs prior period', a: '€286.9k', b: '€47.20', signal: 'Scale Prospecting · Video 04'
    },
    growth: {
      kicker: 'GROWTH CONTROL',
      title: 'See where the next efficient dollar can go.',
      body: 'Separate promotions, evergreen acquisition and market expansion so each motion is judged against the right operating context.',
      list: ['Budget concentration and headroom', 'Market and motion contribution', 'Daily scale, hold and investigate signals'],
      phoneTitle: 'Headroom found.', value: '+€44.6k', delta: 'validated weekly signal', a: '8.4%', b: '5.92×', signal: 'Increase Video 04 by 20%'
    },
    buyer: {
      kicker: 'BUYER WORKBENCH',
      title: 'Go from account scan to action list.',
      body: 'Campaign, ad-set and creative evidence stays connected, so intervention is faster and easier to defend.',
      list: ['Campaign and ad-set triage', 'Creative fatigue and breakout signals', 'Explicit attribution and data caveats'],
      phoneTitle: 'Three moves today.', value: '03', delta: '1 scale · 1 hold · 1 cut', a: '€2.8k', b: '0.74×', signal: 'Investigate Static 12 now'
    },
    agency: {
      kicker: 'PORTFOLIO COMMAND',
      title: 'Deliver judgment, not another deck.',
      body: 'Give clients a premium operating layer while your team manages definitions, quality and narrative from one repeatable system.',
      list: ['Client-isolated workspaces', 'Consistent metric governance', 'Repeatable reporting without generic templates'],
      phoneTitle: 'All clients aligned.', value: '07', delta: 'accounts reporting normally', a: '99.9%', b: '08:00', signal: 'Client review pack is ready'
    }
  };

  const header = document.querySelector('[data-header]');
  const menuButton = document.querySelector('[data-menu-button]');
  const mobileMenu = document.querySelector('[data-mobile-menu]');
  const dialog = document.querySelector('[data-dialog]');
  const formStep = document.querySelector('[data-dialog-step="form"]');
  const successStep = document.querySelector('[data-dialog-step="success"]');
  const briefForm = document.querySelector('[data-brief-form]');
  const briefOutput = document.querySelector('[data-brief-output]');
  const emailBrief = document.querySelector('[data-email-brief]');
  const copyStatus = document.querySelector('[data-copy-status]');
  let lastDialogTrigger = null;

  const setHeader = () => header?.classList.toggle('is-scrolled', window.scrollY > 20);
  setHeader();
  window.addEventListener('scroll', setHeader, { passive: true });

  function closeMenu() {
    if (!menuButton || !mobileMenu) return;
    menuButton.setAttribute('aria-expanded', 'false');
    menuButton.setAttribute('aria-label', 'Open menu');
    mobileMenu.hidden = true;
  }

  menuButton?.addEventListener('click', () => {
    const open = menuButton.getAttribute('aria-expanded') === 'true';
    menuButton.setAttribute('aria-expanded', String(!open));
    menuButton.setAttribute('aria-label', open ? 'Open menu' : 'Close menu');
    mobileMenu.hidden = open;
  });
  mobileMenu?.querySelectorAll('a').forEach(link => link.addEventListener('click', closeMenu));

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const revealObserver = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        revealObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -4% 0px' });
  document.querySelectorAll('.reveal').forEach(el => revealObserver.observe(el));

  const tilt = document.querySelector('[data-tilt]');
  const productWindow = tilt?.querySelector('.product-window');
  if (tilt && productWindow && !reducedMotion && matchMedia('(pointer:fine)').matches) {
    tilt.addEventListener('pointermove', event => {
      const box = tilt.getBoundingClientRect();
      const x = (event.clientX - box.left) / box.width - .5;
      const y = (event.clientY - box.top) / box.height - .5;
      productWindow.style.transform = `rotateX(${1.5 - y * 2.4}deg) rotateY(${x * 2.2}deg) translateY(-2px)`;
    });
    tilt.addEventListener('pointerleave', () => { productWindow.style.transform = 'rotateX(1.5deg)'; });
  }

  document.querySelectorAll('[data-market]').forEach(button => {
    button.addEventListener('click', () => {
      const key = button.dataset.market;
      const data = syntheticMarkets[key];
      if (!data) return;
      document.querySelectorAll('[data-market]').forEach(item => {
        const selected = item === button;
        item.classList.toggle('is-active', selected);
        item.setAttribute('aria-pressed', String(selected));
      });
      Object.entries({ spend: data.spend, revenue: data.revenue, roas: data.roas, cpa: data.cpa }).forEach(([metric, value]) => {
        const element = document.querySelector(`[data-kpi="${metric}"]`);
        if (!element) return;
        element.animate([{ opacity: .25, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }], { duration: 320, easing: 'ease-out' });
        element.textContent = value;
      });
      document.querySelector('[data-chart-line]')?.setAttribute('d', data.line);
      document.querySelector('[data-chart-area]')?.setAttribute('d', data.area);
      const status = document.querySelector('[data-market-status]');
      if (status) status.textContent = `${button.textContent.trim()} market selected. Spend ${data.spend}, revenue ${data.revenue}, return ${data.roas}, new customer acquisition cost ${data.cpa}.`;
    });
  });

  document.querySelector('[data-signal-button]')?.addEventListener('click', () => {
    const signal = document.querySelector('.signal-card');
    if (!signal) return;
    signal.classList.toggle('evidence-open');
    const reason = signal.querySelector('.signal-reason p');
    const button = signal.querySelector('button');
    if (signal.classList.contains('evidence-open')) {
      reason.textContent = 'Evidence: 5.92× ROAS, 8.4% spend share, stable CPA across three controlled increases.';
      button.innerHTML = 'Hide evidence <span>↑</span>';
    } else {
      reason.textContent = 'Efficiency held across 3 budget increases. Headroom remains.';
      button.innerHTML = 'Review evidence <span>→</span>';
    }
  });

  function showStory(key) {
    document.querySelectorAll('[data-story]').forEach(step => {
      const selected = step.dataset.story === key;
      step.classList.toggle('is-active', selected);
      step.setAttribute('aria-pressed', String(selected));
    });
    document.querySelectorAll('[data-story-panel]').forEach(panel => {
      const selected = panel.dataset.storyPanel === key;
      panel.classList.toggle('is-visible', selected);
      panel.setAttribute('aria-hidden', String(!selected));
    });
    const labels = { noise: 'RAW INPUT', truth: 'NORMALIZED MODEL', action: 'DECISION LAYER' };
    const label = document.querySelector('[data-story-label]');
    if (label) label.textContent = labels[key];
  }
  document.querySelectorAll('[data-story]').forEach(step => step.addEventListener('click', () => showStory(step.dataset.story)));

  if (!reducedMotion) {
    const storySteps = [...document.querySelectorAll('[data-story]')];
    const storyObserver = new IntersectionObserver(entries => {
      const visible = entries.filter(entry => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (visible) showStory(visible.target.dataset.story);
    }, { threshold: [.55, .75], rootMargin: '-22% 0px -35% 0px' });
    storySteps.forEach(step => storyObserver.observe(step));
  }

  function applyRole(key) {
    const data = roles[key];
    if (!data) return;
    document.querySelectorAll('[data-role]').forEach(tab => {
      const selected = tab.dataset.role === key;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
    });
    const panel = document.querySelector('[role="tabpanel"]');
    if (panel) panel.setAttribute('aria-labelledby', `role-${key}`);
    const content = document.querySelector('.role-copy');
    const phone = document.querySelector('.phone-shell');
    [content, phone].forEach(el => el?.animate([{ opacity: .35, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 380, easing: 'cubic-bezier(.2,.8,.2,1)' }));
    document.querySelector('[data-role-kicker]').textContent = data.kicker;
    document.querySelector('[data-role-title]').textContent = data.title;
    document.querySelector('[data-role-body]').textContent = data.body;
    const list = document.querySelector('[data-role-list]');
    list.innerHTML = data.list.map(item => `<li>${item}</li>`).join('');
    document.querySelector('[data-phone-title]').textContent = data.phoneTitle;
    document.querySelector('[data-phone-value]').textContent = data.value;
    document.querySelector('[data-phone-delta]').textContent = data.delta;
    document.querySelector('[data-phone-metric-a]').textContent = data.a;
    document.querySelector('[data-phone-metric-b]').textContent = data.b;
    document.querySelector('[data-phone-signal]').textContent = data.signal;
  }
  document.querySelectorAll('[data-role]').forEach(tab => {
    tab.addEventListener('click', () => applyRole(tab.dataset.role));
    tab.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const tabs = [...document.querySelectorAll('[data-role]')];
      const current = tabs.indexOf(tab);
      let next = current;
      if (event.key === 'ArrowLeft') next = (current - 1 + tabs.length) % tabs.length;
      if (event.key === 'ArrowRight') next = (current + 1) % tabs.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = tabs.length - 1;
      tabs[next].focus(); applyRole(tabs[next].dataset.role);
    });
  });

  const countObserver = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const element = entry.target;
      const target = Number(element.dataset.count);
      if (reducedMotion) { element.textContent = String(target).padStart(2, '0'); return; }
      const start = performance.now();
      const duration = 1100;
      const tick = now => {
        const progress = Math.min(1, (now - start) / duration);
        const eased = 1 - Math.pow(1 - progress, 3);
        element.textContent = String(Math.round(target * eased)).padStart(2, '0');
        if (progress < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      countObserver.unobserve(element);
    });
  }, { threshold: .6 });
  document.querySelectorAll('[data-count]').forEach(item => countObserver.observe(item));

  function openDialog(trigger) {
    if (!dialog) return;
    lastDialogTrigger = trigger;
    formStep.classList.add('is-active');
    successStep.classList.remove('is-active');
    dialog.setAttribute('aria-labelledby', 'dialog-title');
    copyStatus.textContent = '';
    dialog.showModal();
    requestAnimationFrame(() => dialog.querySelector('input')?.focus());
  }
  function closeDialog() {
    if (!dialog?.open) return;
    dialog.close();
    lastDialogTrigger?.focus();
  }
  document.querySelectorAll('[data-open-dialog]').forEach(button => button.addEventListener('click', () => { closeMenu(); openDialog(button); }));
  document.querySelectorAll('[data-close-dialog]').forEach(button => button.addEventListener('click', closeDialog));
  dialog?.addEventListener('click', event => {
    const box = dialog.getBoundingClientRect();
    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) closeDialog();
  });
  dialog?.addEventListener('cancel', event => { event.preventDefault(); closeDialog(); });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && dialog?.open) closeDialog();
  });

  briefForm?.addEventListener('submit', event => {
    event.preventDefault();
    if (!briefForm.reportValidity()) return;
    const data = new FormData(briefForm);
    const brief = [
      'AGENTHIC CONTROL — PRIVATE BUILD BRIEF',
      `Contact: ${data.get('email')}`,
      `Monthly Meta spend: ${data.get('spend')}`,
      `Primary visibility challenge: ${data.get('challenge')}`,
      '',
      'Requested outcome: a private Meta Ads operating system with explicit metric definitions and action-ready reporting.'
    ].join('\n');
    briefOutput.textContent = brief;
    if (emailBrief) {
      const subject = 'AGENTHIC CONTROL — private build request';
      emailBrief.href = `mailto:hello@agenthic.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(brief)}`;
    }
    formStep.classList.remove('is-active');
    successStep.classList.add('is-active');
    dialog.setAttribute('aria-labelledby', 'dialog-success-title');
    emailBrief?.focus();
  });

  document.querySelector('[data-copy-brief]')?.addEventListener('click', async () => {
    const text = briefOutput.textContent;
    try {
      await navigator.clipboard.writeText(text);
      copyStatus.textContent = 'Brief copied to clipboard.';
    } catch {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(briefOutput);
      selection.removeAllRanges(); selection.addRange(range);
      copyStatus.textContent = 'Brief selected. Copy it with your keyboard.';
    }
  });
})();
