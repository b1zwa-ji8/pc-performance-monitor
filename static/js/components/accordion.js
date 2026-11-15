/**
 * Accordion Component — Melius Troubleshooting FAQ Pattern
 * Smooth animated expand/collapse rows with + to × icon rotation and subtle borders.
 */

class TroubleshootingAccordion {
    /**
     * @param {string} containerId - Accordion wrapper element ID
     * @param {Array<{question: string, answer: string}>} items
     */
    constructor(containerId, items = []) {
        this.container = document.getElementById(containerId);
        this.items = items;
        this._render();
    }

    _render() {
        if (!this.container) return;

        this.container.className = 'troubleshooting-accordion';
        this.container.innerHTML = this.items.map((item, index) => `
            <div class="accordion-row ${index === 0 ? 'open' : ''}" data-index="${index}">
                <button class="accordion-header" aria-expanded="${index === 0}">
                    <span class="accordion-title">${item.question}</span>
                    <span class="accordion-icon" aria-hidden="true">
                        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                            <line class="icon-h" x1="4" y1="10" x2="16" y2="10" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/>
                            <line class="icon-v" x1="10" y1="4" x2="10" y2="16" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/>
                        </svg>
                    </span>
                </button>
                <div class="accordion-content" style="${index === 0 ? 'max-height: 400px; opacity: 1;' : 'max-height: 0; opacity: 0;'}">
                    <div class="accordion-body">
                        ${item.answer}
                    </div>
                </div>
            </div>
        `).join('');

        this._bindEvents();
    }

    _bindEvents() {
        if (!this.container) return;

        this.container.querySelectorAll('.accordion-header').forEach(header => {
            header.addEventListener('click', (e) => {
                const row = e.currentTarget.closest('.accordion-row');
                const content = row.querySelector('.accordion-content');
                const isCurrentlyOpen = row.classList.contains('open');

                // Collapse all others (single open row pattern)
                this.container.querySelectorAll('.accordion-row').forEach(otherRow => {
                    if (otherRow !== row) {
                        otherRow.classList.remove('open');
                        otherRow.querySelector('.accordion-header').setAttribute('aria-expanded', 'false');
                        const otherContent = otherRow.querySelector('.accordion-content');
                        otherContent.style.maxHeight = '0px';
                        otherContent.style.opacity = '0';
                    }
                });

                // Toggle current
                if (isCurrentlyOpen) {
                    row.classList.remove('open');
                    header.setAttribute('aria-expanded', 'false');
                    content.style.maxHeight = '0px';
                    content.style.opacity = '0';
                } else {
                    row.classList.add('open');
                    header.setAttribute('aria-expanded', 'true');
                    content.style.maxHeight = content.scrollHeight + 40 + 'px';
                    content.style.opacity = '1';
                }
            });
        });
    }
}

window.TroubleshootingAccordion = TroubleshootingAccordion;
