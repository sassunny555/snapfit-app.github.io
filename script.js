// ===== Duplicate carousel items for infinite scroll =====
document.addEventListener('DOMContentLoaded', () => {
    const updateNavState = () => {
        document.body.classList.toggle('nav-scrolled', window.scrollY > 24);
    };

    updateNavState();
    window.addEventListener('scroll', updateNavState, { passive: true });

    // Duplicate screenshots carousel
    const track = document.querySelector('.carousel-track');
    if (track) {
        [...track.children].forEach((item) => {
            const clone = item.cloneNode(true);
            clone.setAttribute('aria-hidden', 'true');
            track.appendChild(clone);
        });
    }
    
    // Duplicate reviews carousel
    const reviewsTrack = document.querySelector('.reviews-track');
    if (reviewsTrack) {
        [...reviewsTrack.children].forEach((item) => {
            const clone = item.cloneNode(true);
            clone.setAttribute('aria-hidden', 'true');
            reviewsTrack.appendChild(clone);
        });
    }
    
    // ===== Coming Soon Modal =====
    const modal = document.getElementById('comingSoonModal');
    const appStoreBtn = document.getElementById('appStoreBtn');
    const appStoreBtnCta = document.getElementById('appStoreBtnCta');
    const modalClose = document.getElementById('modalClose');
    
    const showModal = (e) => {
        e.preventDefault();
        modal.classList.add('active');
        modal.setAttribute('aria-hidden', 'false');
        modalClose?.focus();
    };
    
    const hideModal = () => {
        modal.classList.remove('active');
        modal.setAttribute('aria-hidden', 'true');
    };
    
    if (appStoreBtn) appStoreBtn.addEventListener('click', showModal);
    if (appStoreBtnCta) appStoreBtnCta.addEventListener('click', showModal);
    if (modalClose) modalClose.addEventListener('click', hideModal);
    
    // Close modal on overlay click
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) hideModal();
        });
    }
    
    // Close modals on Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (modal && modal.classList.contains('active')) hideModal();
        }
    });
    
    // ===== Coordinated one-time scroll reveals =====
    const revealTargets = [
        ...document.querySelectorAll('.section-title'),
        ...document.querySelectorAll('.section-subtitle'),
        ...document.querySelectorAll('.benefit-panel'),
        document.querySelector('.comparison-shell'),
        document.querySelector('.faq-list'),
        document.querySelector('.screenshots-carousel'),
        document.querySelector('.reviews-carousel'),
        document.querySelector('.ph-embed'),
        document.querySelector('.cta-content')
    ].filter(Boolean);

    document.querySelectorAll('.section-title').forEach((element) => {
        element.classList.add('reveal-on-scroll', 'reveal-heading');
    });

    document.querySelectorAll('.section-subtitle').forEach((element) => {
        element.classList.add('reveal-on-scroll');
        element.style.setProperty('--reveal-delay', '90ms');
    });

    document.querySelectorAll('.benefit-panel').forEach((panel, index) => {
        panel.classList.add('split-reveal');
        panel.style.setProperty('--reveal-delay', `${index * 90}ms`);
    });

    document.querySelectorAll('.screenshots-carousel, .reviews-carousel').forEach((panel) => {
        panel.classList.add('reveal-on-scroll', 'reveal-panel');
        panel.style.setProperty('--reveal-delay', '140ms');
    });

    const comparisonShell = document.querySelector('.comparison-shell');
    if (comparisonShell) {
        comparisonShell.classList.add('reveal-on-scroll', 'reveal-panel');
        comparisonShell.style.setProperty('--reveal-delay', '120ms');
    }

    const faqList = document.querySelector('.faq-list');
    if (faqList) {
        faqList.classList.add('reveal-on-scroll', 'reveal-panel');
        faqList.style.setProperty('--reveal-delay', '120ms');
    }

    // ===== FAQ accordion =====
    const faqItems = [...document.querySelectorAll('.faq-item')];

    faqItems.forEach((item) => {
        item.addEventListener('toggle', () => {
            if (!item.open) return;
            faqItems.forEach((otherItem) => {
                if (otherItem !== item) otherItem.open = false;
            });
        });
    });

    // ===== Interactive comparison filters =====
    const comparisonFilters = document.querySelectorAll('.comparison-filter');
    const comparisonRows = document.querySelectorAll('.comparison-row');
    let activeComparisonFilter = 'all';

    comparisonFilters.forEach((button) => {
        button.addEventListener('click', () => {
            activeComparisonFilter = button.dataset.filter || 'all';

            comparisonFilters.forEach((filterButton) => {
                const isActive = filterButton === button;
                filterButton.classList.toggle('active', isActive);
                filterButton.setAttribute('aria-pressed', String(isActive));
            });

            let visibleIndex = 0;
            comparisonRows.forEach((row) => {
                const shouldShow = activeComparisonFilter === 'all' || row.dataset.category === activeComparisonFilter;
                row.classList.remove('is-filtering-in');

                if (shouldShow) {
                    row.hidden = false;
                    row.classList.remove('is-filtering-out');
                    row.style.setProperty('--row-delay', `${visibleIndex * 70}ms`);
                    void row.offsetWidth;
                    row.classList.add('is-filtering-in');
                    visibleIndex += 1;
                } else {
                    row.classList.add('is-filtering-out');
                    window.setTimeout(() => {
                        const stillHidden = activeComparisonFilter !== 'all' && row.dataset.category !== activeComparisonFilter;
                        if (stillHidden) row.hidden = true;
                    }, 260);
                }
            });
        });
    });

    document.querySelectorAll('.ph-embed, .cta-content').forEach((panel) => {
        panel.classList.add('reveal-on-scroll', 'reveal-card');
    });

    if ('IntersectionObserver' in window) {
        const revealObserver = new IntersectionObserver((entries, observer) => {
            entries.forEach((entry) => {
                if (!entry.isIntersecting) return;
                entry.target.classList.add('is-revealed');
                observer.unobserve(entry.target);
            });
        }, {
            threshold: 0.05,
            rootMargin: '0px 0px -8% 0px'
        });

        revealTargets.forEach((target) => revealObserver.observe(target));
    } else {
        revealTargets.forEach((target) => target.classList.add('is-revealed'));
    }
});
