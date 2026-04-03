'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { isAdmin, getCurrentUserEmail } from '@/lib/auth'
import ThemeToggle, { useThemeMode } from './theme-toggle'

interface NavItem {
  label: string
  href: string
}

const MON_ESPACE: NavItem[] = [
  { label: 'My Tokens', href: '/tokens' },
  { label: 'Dashboard', href: '/dashboard' },
  { label: 'Audit Log', href: '/audit' },
]

const ADMINISTRATION: NavItem[] = [
  { label: 'Users & Tokens', href: '/admin/users' },
  { label: 'Configuration', href: '/admin/config' },
]

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const [mode, toggleMode] = useThemeMode()
  const admin = isAdmin()
  const email = getCurrentUserEmail()

  const isDark = mode === 'dark'

  const sidebarBg = isDark ? '#1a1a2e' : '#ffffff'
  const sidebarText = isDark ? '#e0e0e0' : '#333333'
  const sidebarBorder = isDark ? '#2a2a4a' : '#e5e7eb'
  const mainBg = isDark ? '#12122a' : '#f5f6fa'
  const sectionLabel = isDark ? '#8888aa' : '#999999'
  const hoverBg = isDark ? '#2a2a4a' : '#eef3fd'

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + '/')

  const navItemStyle = (href: string): React.CSSProperties => ({
    display: 'block',
    padding: '8px 16px',
    borderRadius: 6,
    fontSize: 14,
    fontWeight: isActive(href) ? 600 : 400,
    color: isActive(href) ? '#297EF2' : sidebarText,
    background: isActive(href) ? (isDark ? '#1e3a6e' : '#eef3fd') : 'transparent',
    borderLeft: isActive(href) ? '3px solid #297EF2' : '3px solid transparent',
    textDecoration: 'none',
    transition: 'background 0.15s, color 0.15s',
    cursor: 'pointer',
  })

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: mainBg, fontFamily: 'system-ui, sans-serif' }}>
      {/* Sidebar */}
      <aside style={{
        width: 240,
        minWidth: 240,
        background: sidebarBg,
        borderRight: `1px solid ${sidebarBorder}`,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}>
        {/* Brand */}
        <div style={{ padding: '24px 20px 16px', borderBottom: `1px solid ${sidebarBorder}` }}>
          <span style={{ fontSize: 18, fontWeight: 700, color: '#297EF2', letterSpacing: '-0.3px' }}>
            Token Manager
          </span>
        </div>

        {/* Navigation */}
        <nav style={{ flex: 1, overflowY: 'auto', padding: '16px 8px' }}>
          {/* MON ESPACE section */}
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: sectionLabel, padding: '0 16px 6px', textTransform: 'uppercase' }}>
              Mon Espace
            </div>
            {MON_ESPACE.map(item => (
              <Link key={item.href} href={item.href} style={navItemStyle(item.href)}
                onMouseEnter={e => { if (!isActive(item.href)) (e.currentTarget as HTMLElement).style.background = hoverBg }}
                onMouseLeave={e => { if (!isActive(item.href)) (e.currentTarget as HTMLElement).style.background = 'transparent' }}
              >
                {item.label}
              </Link>
            ))}
          </div>

          {/* ADMINISTRATION section — admin only */}
          {admin && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: sectionLabel, padding: '0 16px 6px', textTransform: 'uppercase' }}>
                Administration
              </div>
              {ADMINISTRATION.map(item => (
                <Link key={item.href} href={item.href} style={navItemStyle(item.href)}
                  onMouseEnter={e => { if (!isActive(item.href)) (e.currentTarget as HTMLElement).style.background = hoverBg }}
                  onMouseLeave={e => { if (!isActive(item.href)) (e.currentTarget as HTMLElement).style.background = 'transparent' }}
                >
                  {item.label}
                </Link>
              ))}
            </div>
          )}
        </nav>

        {/* Bottom: email + theme toggle */}
        <div style={{ padding: '12px 16px', borderTop: `1px solid ${sidebarBorder}` }}>
          {email && (
            <div style={{ fontSize: 12, color: sectionLabel, marginBottom: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={email}>
              {email}
            </div>
          )}
          <ThemeToggle mode={mode} onToggle={toggleMode} />
        </div>
      </aside>

      {/* Main content */}
      <main style={{ flex: 1, overflowY: 'auto', padding: 24, color: isDark ? '#e0e0e0' : '#1a1a2e' }}>
        {children}
      </main>
    </div>
  )
}
