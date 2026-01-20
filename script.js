// ===== Duplicate carousel items for infinite scroll =====
document.addEventListener('DOMContentLoaded', () => {
    // Duplicate screenshots carousel
    const track = document.querySelector('.carousel-track');
    if (track) {
        const items = track.innerHTML;
        track.innerHTML = items + items;
    }
    
    // Duplicate reviews carousel
    const reviewsTrack = document.querySelector('.reviews-track');
    if (reviewsTrack) {
        const items = reviewsTrack.innerHTML;
        reviewsTrack.innerHTML = items + items;
    }
    
    // ===== Coming Soon Modal =====
    const modal = document.getElementById('comingSoonModal');
    const appStoreBtn = document.getElementById('appStoreBtn');
    const appStoreBtnCta = document.getElementById('appStoreBtnCta');
    const modalClose = document.getElementById('modalClose');
    
    const showModal = (e) => {
        e.preventDefault();
        modal.classList.add('active');
    };
    
    const hideModal = () => {
        modal.classList.remove('active');
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
    
    // ===== Contact Form Modal =====
    const contactModal = document.getElementById('contactModal');
    const contactBtn = document.getElementById('contactBtn');
    const contactBtnFooter = document.getElementById('contactBtnFooter');
    const contactCloseX = document.getElementById('contactCloseX');
    
    const showContactModal = (e) => {
        e.preventDefault();
        contactModal.classList.add('active');
    };
    
    const hideContactModal = () => {
        contactModal.classList.remove('active');
    };
    
    if (contactBtn) contactBtn.addEventListener('click', showContactModal);
    if (contactBtnFooter) contactBtnFooter.addEventListener('click', showContactModal);
    if (contactCloseX) contactCloseX.addEventListener('click', hideContactModal);
    
    // Close contact modal on overlay click
    if (contactModal) {
        contactModal.addEventListener('click', (e) => {
            if (e.target === contactModal) hideContactModal();
        });
    }
    
    // Handle contact form submission via mailto
    const contactForm = document.getElementById('contactForm');
    if (contactForm) {
        contactForm.addEventListener('submit', (e) => {
            e.preventDefault();
            
            const name = document.getElementById('contactName').value;
            const email = document.getElementById('contactEmail').value;
            const message = document.getElementById('contactMessage').value;
            
            const subject = encodeURIComponent(`SnapFit Contact: Message from ${name}`);
            const body = encodeURIComponent(`Name: ${name}\nEmail: ${email}\n\nMessage:\n${message}`);
            
            // Open default email client
            window.location.href = `mailto:snapfit.ai.official@gmail.com?subject=${subject}&body=${body}`;
            
            // Reset form and show feedback
            const submitBtn = contactForm.querySelector('.submit-btn');
            submitBtn.textContent = 'Opening Email...';
            
            setTimeout(() => {
                contactForm.reset();
                hideContactModal();
                submitBtn.textContent = 'Send Message';
            }, 1500);
        });
    }
    
    // Close modals on Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (modal && modal.classList.contains('active')) hideModal();
            if (contactModal && contactModal.classList.contains('active')) hideContactModal();
        }
    });
    
    // ===== Smooth reveal animations on scroll =====
    const observerOptions = {
        threshold: 0.1,
        rootMargin: '0px 0px -50px 0px'
    };
    
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
            }
        });
    }, observerOptions);
    
    // Observe feature cards with staggered animation
    document.querySelectorAll('.feature-card').forEach((card, index) => {
        card.style.opacity = '0';
        card.style.transform = 'translateY(30px)';
        card.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
        card.style.transitionDelay = `${index * 0.1}s`;
        observer.observe(card);
    });
    
    // Observe review cards with staggered animation
    document.querySelectorAll('.review-card').forEach((card, index) => {
        card.style.opacity = '0';
        card.style.transform = 'translateY(30px)';
        card.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
        card.style.transitionDelay = `${index * 0.1}s`;
        observer.observe(card);
    });
    
    // Observe section titles
    document.querySelectorAll('.section-title, .section-subtitle').forEach((el) => {
        el.style.opacity = '0';
        el.style.transform = 'translateY(20px)';
        el.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
        observer.observe(el);
    });
    
    // Observe CTA section
    const ctaContent = document.querySelector('.cta-content');
    if (ctaContent) {
        ctaContent.style.opacity = '0';
        ctaContent.style.transform = 'translateY(30px)';
        ctaContent.style.transition = 'opacity 0.7s ease, transform 0.7s ease';
        observer.observe(ctaContent);
    }
    
    // Add visible class styles
    const style = document.createElement('style');
    style.textContent = `
        .feature-card.visible,
        .review-card.visible,
        .section-title.visible,
        .section-subtitle.visible,
        .cta-content.visible {
            opacity: 1 !important;
            transform: translateY(0) !important;
        }
    `;
    document.head.appendChild(style);
});
