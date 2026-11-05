/// Scripts run in the CRM page. Fixed strings only: nothing from a URL, a
/// message or the page is ever interpolated into them.
library;

/// Android back closes what is on top before it leaves the screen. The CRM
/// already closes its layers on Escape, so this reuses that behaviour instead
/// of teaching the web app about Android. Returns 'layer' when one was open.
const closeTopLayerScript = r'''
(function () {
  var layer = document.querySelector('[role="dialog"],[aria-modal="true"],.crm-modal-backdrop,.modal-card,.crm-panel');
  var shell = document.querySelector('.app-shell');
  var drawer = window.innerWidth <= 768 && shell && !shell.classList.contains('sidebar-is-closed');
  if (!layer && !drawer) return 'none';
  var target = document.activeElement || document.body;
  target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }));
  return 'layer';
})()
''';

/// True when reloading now could lose something the person is doing.
const pageIsBusyScript = r'''
(function () {
  if (document.querySelector('[role="dialog"],[aria-modal="true"],.crm-modal-backdrop,.modal-card')) return 'busy';
  var el = document.activeElement;
  if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return 'busy';
  return 'idle';
})()
''';
