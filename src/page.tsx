import { SignIn } from '@clerk/nextjs'

export default function SignInPage() {
  return (
    <div style={{
      minHeight: '100vh', background: '#080808',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 32
    }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 28, fontWeight: 900, letterSpacing: 4, color: '#fff', textTransform: 'uppercase' }}>
          <span style={{ color: '#ef4444' }}>OATH</span> VIOLATION TRACKER
        </div>
        <div style={{ fontSize: 10, color: '#333', letterSpacing: 2.5, marginTop: 6 }}>NYC FLEET COMPLIANCE · BUILDING SUPPLY</div>
      </div>
      <SignIn appearance={{
        variables: { colorPrimary: '#ef4444', colorBackground: '#0f0f0f', colorText: '#e0e0e0', colorInputBackground: '#111', colorInputText: '#ccc' },
        elements: { card: { border: '1px solid #1e1e1e', boxShadow: 'none' }, formButtonPrimary: { fontFamily: "'Barlow Condensed', sans-serif", letterSpacing: '2px', textTransform: 'uppercase' } }
      }} />
    </div>
  )
}
