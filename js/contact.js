/* ================================================================
   contact.js  —  REACT-X
   Contact Us page: team members and email links.
   ================================================================ */
const Contact = (() => {

  const TEAM = [
    {
      name:  'Harini M',
      role:  'AI Pipeline & Backend',
      email: '2403717673822015@cit.edu.in',
      initial: 'H'
    },
    {
      name:  'Jeeva Prakasini G',
      role:  'Frontend & UI/UX',
      email: '2403717674422019@cit.edu.in',
      initial: 'J'
    },
    {
      name:  'Santhiya C',
      role:  'System Architecture & Testing',
      email: '2403717674422048@cit.edu.in',
      initial: 'S'
    }
  ];

  function render() {
    const container = document.getElementById('contactContent');
    if (!container) return;

    container.innerHTML = `
      <div style="max-width:860px;">

        <!-- Intro card -->
        <div class="section-card" style="margin-bottom:1.5rem;padding:1.75rem 2rem;">
          <div style="display:flex;align-items:flex-start;gap:1rem;">
            <div style="font-size:2rem;flex-shrink:0;">📬</div>
            <div>
              <h2 style="font-size:1.1rem;font-weight:700;color:var(--text);margin-bottom:0.35rem;">
                Get in touch
              </h2>
              <p style="font-size:0.88rem;color:var(--text-secondary);line-height:1.7;">
                Have a question about REACT-X, found a bug, or want to suggest a feature?
                Reach out to any of the team members below. We typically respond within one business day.
              </p>
            </div>
          </div>
        </div>

        <!-- Team cards -->
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:1.1rem;margin-bottom:1.75rem;">
          ${TEAM.map(m => `
            <div class="settings-card" style="display:flex;flex-direction:column;gap:0;">

              <!-- Avatar + name -->
              <div style="display:flex;align-items:center;gap:0.9rem;margin-bottom:1rem;">
                <div style="
                  width:48px;height:48px;border-radius:50%;
                  background:var(--accent);color:#fff;
                  display:flex;align-items:center;justify-content:center;
                  font-size:1.2rem;font-weight:700;flex-shrink:0;
                  letter-spacing:0.01em;">
                  ${m.initial}
                </div>
                <div>
                  <div style="font-weight:700;font-size:0.95rem;color:var(--text);">${m.name}</div>
                  <div style="font-size:0.76rem;color:var(--text-muted);margin-top:0.1rem;">${m.role}</div>
                </div>
              </div>

              <!-- Email -->
              <div style="display:flex;align-items:center;gap:0.5rem;
                          padding:0.55rem 0.75rem;background:var(--bg-alt);
                          border-radius:var(--radius-sm);border:1px solid var(--border);">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                     stroke="var(--accent)" stroke-width="2" style="flex-shrink:0;">
                  <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                  <polyline points="22,6 12,13 2,6"/>
                </svg>
                <a href="mailto:${m.email}"
                   style="font-size:0.78rem;color:var(--accent);word-break:break-all;
                          font-weight:500;text-decoration:none;"
                   onmouseover="this.style.textDecoration='underline'"
                   onmouseout="this.style.textDecoration='none'">
                  ${m.email}
                </a>
              </div>

              <!-- Mail button -->
              <a href="mailto:${m.email}"
                 class="btn btn-primary btn-sm"
                 style="margin-top:0.75rem;justify-content:center;text-decoration:none;">
                ✉ Send Email
              </a>

            </div>
          `).join('')}
        </div>

        <!-- Mail all button -->
        <div class="section-card" style="padding:1.25rem 1.5rem;">
          <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:0.75rem;">
            <div>
              <div style="font-weight:600;font-size:0.9rem;color:var(--text);">Contact the whole team at once</div>
              <div style="font-size:0.79rem;color:var(--text-muted);margin-top:0.2rem;">
                Opens a single email addressed to all three team members.
              </div>
            </div>
            <a href="mailto:2403717673822015@cit.edu.in,2403717674422019@cit.edu.in,2403717674422048@cit.edu.in"
               class="btn btn-primary"
               style="text-decoration:none;white-space:nowrap;">
              ✉ Email All
            </a>
          </div>
        </div>

      </div>`;
  }

  return { render };
})();
