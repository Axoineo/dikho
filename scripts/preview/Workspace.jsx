// The authenticated app's content pane (.app-shell > .app-main > .workspace),
// minus the sidebar. The workspace padding variables are declared on
// .app-shell, so a bare .workspace renders flush against the window edge.
// --sidebar-w is zeroed so the pane fills the window, and the border and
// corner that normally separate it from the rail are dropped.
export default function Workspace({ children }) {
  return (
    <div className="app-shell" style={{ '--sidebar-w': '0px' }}>
      <div className="app-main" style={{ borderLeft: 0, borderRadius: 0 }}>
        <main className="workspace">{children}</main>
      </div>
    </div>
  )
}
