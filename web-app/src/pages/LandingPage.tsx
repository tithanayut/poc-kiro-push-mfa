import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTheme } from '../context/ThemeContext'
import './LandingPage.css'

const steps = [
  {
    icon: '🔐',
    title: 'Caller triggers challenge',
    desc: 'Your app POSTs to /push with a Bearer app secret. The request blocks, waiting for the user.',
  },
  {
    icon: '📲',
    title: 'Push hits the browser',
    desc: 'The backend signs a Web Push notification via VAPID and delivers it to the user\'s registered browser — foreground or background.',
  },
  {
    icon: '✅',
    title: 'User approves or denies',
    desc: 'A clean in-app prompt (or OS notification) lets the user tap Accept or Deny in seconds.',
  },
  {
    icon: '⚡',
    title: 'Caller gets the answer',
    desc: 'Redis pub/sub unblocks the long-poll instantly. Your app receives { response: "accepted" } and continues.',
  },
]

const features = [
  {
    icon: '🏢',
    title: 'Multi-tenant',
    desc: 'Fully isolated tenants with their own users and apps. One deployment, many organisations.',
  },
  {
    icon: '🔑',
    title: 'App-based auth',
    desc: 'Each integration gets its own appId + secret. Revoke a single integration without touching anything else.',
  },
  {
    icon: '📡',
    title: 'Standards-based push',
    desc: 'Web Push Protocol + VAPID (RFC 8030 / 8292). No Firebase account, no vendor lock-in. Works in Chrome, Firefox, Edge, and Safari 16+.',
  },
  {
    icon: '⚖️',
    title: 'Horizontally scalable',
    desc: 'All state lives in Postgres and Redis. Spin up as many backend instances as you need — pub/sub routes responses to the right instance.',
  },
  {
    icon: '🛡️',
    title: 'Role-based access',
    desc: 'Super Admin, Tenant Admin, and Tenant User roles. Admins manage users and apps; users just respond to challenges.',
  },
  {
    icon: '✨',
    title: 'Intuitive dashboards',
    desc: 'Built-in Super Admin and Tenant Admin dashboards to manage tenants, users, and app secrets — no external tooling needed.',
  },
]

const codeSnippet = `curl -X POST https://api.example.com/push \\
  -H "Authorization: Bearer <app-secret>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "tenantId": "<tenant-uuid>",
    "username": "alice",
    "appId": "<app-uuid>",
    "message": "Login attempt from Chrome on macOS"
  }'

# Blocks until Alice taps Accept or Deny...

{ "request_id": "...", "response": "accepted" }`

function useInView(threshold = 0.15) {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) setVisible(true) }, { threshold })
    obs.observe(el)
    return () => obs.disconnect()
  }, [threshold])
  return { ref, visible }
}
function TenantAdminMock() {
  const [tab, setTab] = useState<'users' | 'apps'>('users')

  const users = [
    { name: 'alice', role: 'Admin', status: 'accepted' },
    { name: 'bob',   role: 'User',  status: 'pending'  },
    { name: 'carol', role: 'User',  status: null        },
  ]

  const apps = [
    { name: 'Default App', isDefault: true,  active: true  },
    { name: 'CI Pipeline',  isDefault: false, active: true  },
    { name: 'Legacy API',   isDefault: false, active: false },
  ]

  return (
    <>
      <div className="lp-dash-tabs">
        <span
          className={`lp-dash-tab ${tab === 'users' ? 'lp-dash-tab-active' : ''}`}
          onClick={() => setTab('users')}
        >Users</span>
        <span
          className={`lp-dash-tab ${tab === 'apps' ? 'lp-dash-tab-active' : ''}`}
          onClick={() => setTab('apps')}
        >Apps</span>
      </div>

      {tab === 'users' && (
        <>
          <div className="lp-mock-table">
            {users.map(u => (
              <div className="lp-mock-row" key={u.name}>
                <div className="lp-mock-row-main">
                  <span className="lp-mock-name">{u.name}</span>
                  <span className={`lp-mock-badge ${u.role === 'Admin' ? 'lp-mock-badge-purple' : 'lp-mock-badge-blue'}`}>{u.role}</span>
                </div>
                <div className="lp-mock-row-actions">
                  {u.status === 'accepted' && <span className="lp-mock-badge lp-mock-badge-green">Accepted</span>}
                  {u.status === 'pending'  && <span className="lp-mock-badge lp-mock-badge-gray">Sending…</span>}
                  <span className="lp-mock-btn">Push</span>
                  <span className="lp-mock-btn">Disable</span>
                </div>
              </div>
            ))}
          </div>
          <div className="lp-dash-features">
            <span>✦ Create &amp; manage users</span>
            <span>✦ Simulate push challenges</span>
            <span>✦ Set login instructions</span>
          </div>
        </>
      )}

      {tab === 'apps' && (
        <>
          <div className="lp-mock-table">
            {apps.map(a => (
              <div className="lp-mock-row" key={a.name}>
                <div className="lp-mock-row-main">
                  <span className="lp-mock-name">{a.name}</span>
                  {a.isDefault && <span className="lp-mock-badge lp-mock-badge-gray">Default</span>}
                </div>
                <div className="lp-mock-row-actions">
                  <span className={`lp-mock-badge ${a.active ? 'lp-mock-badge-green' : 'lp-mock-badge-gray'}`}>
                    {a.active ? 'Active' : 'Disabled'}
                  </span>
                  {!a.isDefault && <span className="lp-mock-btn">Reset Secret</span>}
                  {!a.isDefault && <span className="lp-mock-btn">Disable</span>}
                  {!a.isDefault && <span className="lp-mock-btn lp-mock-btn-danger">Delete</span>}
                </div>
              </div>
            ))}
          </div>
          <div className="lp-dash-features">
            <span>✦ Create apps with unique secrets</span>
            <span>✦ Reset secrets anytime</span>
            <span>✦ Disable or delete integrations</span>
          </div>
        </>
      )}
    </>
  )
}

function AnimatedSection({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  const { ref, visible } = useInView()
  return (
    <div ref={ref} className={`anim-section ${visible ? 'anim-visible' : ''} ${className}`}>
      {children}
    </div>
  )
}

export default function LandingPage() {
  const navigate = useNavigate()
  const { theme, toggle } = useTheme()
  const [copied, setCopied] = useState(false)

  function copy() {
    navigator.clipboard.writeText(codeSnippet)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="lp">
      {/* NAV */}
      <nav className="lp-nav">
        <span className="lp-logo">Push<span>MFA</span></span>
        <div className="lp-nav-links">
          <a href="#how-it-works">How it works</a>
          <a href="#features">Features</a>
          <a href="#integrate">Integrate</a>
          <button className="lp-btn-outline" onClick={() => navigate('/login')}>Sign in</button>
          <button className="lp-theme-toggle" onClick={toggle} aria-label="Toggle theme">
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
        </div>
      </nav>

      {/* HERO */}
      <section className="lp-hero">
        <div className="lp-hero-glow" />
        <AnimatedSection className="lp-hero-content">
          <div className="lp-badge">Open-source · Self-hosted · Ready in seconds</div>
          <h1>Push-based MFA<br /><span>that everyone loves</span></h1>
          <p className="lp-hero-sub">
            One HTTP call. Your user taps Accept. You get a synchronous response.<br />
            No polling. No webhooks. No third-party accounts.
          </p>
          <div className="lp-hero-cta">
            <button className="lp-btn-primary" onClick={() => navigate('/login')}>Open the app</button>
            <a className="lp-btn-ghost" href="#how-it-works">See how it works ↓</a>
          </div>
        </AnimatedSection>

        {/* mock phone */}
        <AnimatedSection className="lp-hero-phone-wrap">
          <div className="lp-phone">
            {/* Side buttons */}
            <div className="lp-phone-btn lp-phone-btn-vol-up" />
            <div className="lp-phone-btn lp-phone-btn-vol-down" />
            <div className="lp-phone-btn lp-phone-btn-power" />
            {/* Screen */}
            <div className="lp-phone-screen">
              {/* Status bar */}
              <div className="lp-phone-statusbar">
                <span>9:41</span>
                <div className="lp-phone-statusbar-icons">
                  <span>●●●</span>
                  <span>WiFi</span>
                  <span>🔋</span>
                </div>
              </div>
              {/* Dynamic island / notch */}
              <div className="lp-phone-island" />
              {/* App header */}
              <div className="lp-phone-appbar">
                <div className="lp-phone-appbar-icon">🔐</div>
                <div className="lp-phone-appbar-title">PushMFA</div>
              </div>
              {/* Push card */}
              <div className="lp-push-card">
                <div className="lp-push-from">
                  <div className="lp-push-avatar">A</div>
                  <div>
                    <div className="lp-push-from-label">Authentication request</div>
                    <div className="lp-push-from-app">acme-corp · just now</div>
                  </div>
                </div>
                <div className="lp-push-msg">Login attempt from Chrome on macOS</div>
                <div className="lp-push-actions">
                  <button className="lp-push-deny">✕ Deny</button>
                  <button className="lp-push-accept">✓ Accept</button>
                </div>
              </div>
              {/* Home indicator */}
              <div className="lp-phone-home" />
            </div>
          </div>
        </AnimatedSection>
      </section>

      {/* HOW IT WORKS */}
      <section className="lp-section" id="how-it-works">
        <AnimatedSection>
          <div className="lp-section-label">How it works</div>
          <h2>Four steps, zero friction</h2>
        </AnimatedSection>
        <div className="lp-steps">
          {steps.map((s, i) => (
            <AnimatedSection key={i} className="lp-step">
              <div className="lp-step-num">{i + 1}</div>
              <div className="lp-step-icon">{s.icon}</div>
              <h3>{s.title}</h3>
              <p>{s.desc}</p>
            </AnimatedSection>
          ))}
        </div>
      </section>

      {/* FEATURES */}
      <section className="lp-section lp-section-alt" id="features">
        <AnimatedSection>
          <div className="lp-section-label">Features</div>
          <h2>Everything you need, nothing you don't</h2>
        </AnimatedSection>
        <div className="lp-features">
          {features.map((f, i) => (
            <AnimatedSection key={i} className="lp-feature-card">
              <div className="lp-feature-icon">{f.icon}</div>
              <h3>{f.title}</h3>
              <p>{f.desc}</p>
            </AnimatedSection>
          ))}
        </div>
      </section>

      {/* INTEGRATE */}
      <section className="lp-section" id="integrate">
        <AnimatedSection>
          <div className="lp-section-label">Integrate</div>
          <h2>One curl call away</h2>
          <p className="lp-section-sub">
            Any HTTP client works. The request blocks until the user responds — or times out after a configurable window.
          </p>
        </AnimatedSection>
        <AnimatedSection className="lp-code-wrap">
          <div className="lp-code-header">
            <span>bash</span>
            <button className="lp-copy-btn" onClick={copy}>{copied ? '✓ Copied' : 'Copy'}</button>
          </div>
          <pre className="lp-code"><code>{codeSnippet}</code></pre>
        </AnimatedSection>
      </section>

      {/* DASHBOARDS */}
      <section className="lp-section lp-section-alt" id="dashboards">
        <AnimatedSection>
          <div className="lp-section-label">Management</div>
          <h2>Built-in dashboards for every role</h2>
          <p className="lp-section-sub">
            No external admin tools needed. Everything lives in the app.
          </p>
        </AnimatedSection>

        <div className="lp-dashboards">
          {/* Super Admin panel */}
          <AnimatedSection className="lp-dash-panel">
            <div className="lp-dash-header">
              <div>
                <div className="lp-dash-title">Super Admin</div>
                <div className="lp-dash-sub">Platform-wide control</div>
              </div>
              <span className="lp-dash-badge lp-dash-badge-purple">Super Admin</span>
            </div>
            <div className="lp-dash-body">
              <div className="lp-dash-section-label">Tenants</div>
              <div className="lp-mock-table">
                {[
                  { name: 'Acme Corp', domain: 'acme-corp', active: true },
                  { name: 'Globex Inc', domain: 'globex', active: true },
                  { name: 'Initech', domain: 'initech', active: false },
                ].map(t => (
                  <div className="lp-mock-row" key={t.domain}>
                    <div className="lp-mock-row-main">
                      <span className="lp-mock-name">{t.name}</span>
                      <code className="lp-mock-code">{t.domain}</code>
                    </div>
                    <div className="lp-mock-row-actions">
                      <span className={`lp-mock-badge ${t.active ? 'lp-mock-badge-green' : 'lp-mock-badge-gray'}`}>
                        {t.active ? 'Active' : 'Disabled'}
                      </span>
                      <span className="lp-mock-btn">{t.active ? 'Disable' : 'Enable'}</span>
                      <span className="lp-mock-btn">Users</span>
                    </div>
                  </div>
                ))}
              </div>
              <div className="lp-dash-features">
                <span>✦ Create &amp; disable tenants</span>
                <span>✦ Manage all tenant users</span>
                <span>✦ Create tenant admins</span>
              </div>
            </div>
          </AnimatedSection>

          {/* Tenant Admin panel */}
          <AnimatedSection className="lp-dash-panel">
            <div className="lp-dash-header">
              <div>
                <div className="lp-dash-title">Tenant Admin</div>
                <div className="lp-dash-sub">acme-corp</div>
              </div>
              <span className="lp-dash-badge lp-dash-badge-blue">Tenant Admin</span>
            </div>
            <div className="lp-dash-body">
              <TenantAdminMock />
            </div>
          </AnimatedSection>
        </div>
      </section>

      {/* STACK */}
      <section className="lp-section lp-section-alt">
        <AnimatedSection>
          <div className="lp-section-label">Stack</div>
          <h2>Modern tech, on purpose</h2>
        </AnimatedSection>
        <AnimatedSection className="lp-stack">
          {[
            ['React 18 + TypeScript', 'Frontend'],
            ['ASP.NET Core', 'Backend'],
            ['PostgreSQL', 'Persistence'],
            ['Redis', 'Pub/sub & state'],
            ['Web Push + VAPID', 'Delivery'],
            ['Docker Compose', 'Deployment'],
          ].map(([tech, role]) => (
            <div className="lp-stack-item" key={tech}>
              <span className="lp-stack-tech">{tech}</span>
              <span className="lp-stack-role">{role}</span>
            </div>
          ))}
        </AnimatedSection>
      </section>

      {/* FOOTER */}
      <footer className="lp-footer">
        <span className="lp-logo">Push<span>MFA</span></span>
        <a
          className="lp-footer-repo"
          href="https://github.com/tithanayut/poc-kiro-push-mfa"
          target="_blank"
          rel="noopener noreferrer"
        >
          GitHub ↗
        </a>
      </footer>
    </div>
  )
}
