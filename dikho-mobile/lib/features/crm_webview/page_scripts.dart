/// Scripts run in the CRM page. Fixed strings only: nothing from a URL, a
/// message or the page is ever interpolated into them.
library;

/// Android back closes what is on top before it leaves the screen. The CRM
/// already closes its layers on Escape, so this reuses that behaviour instead
/// of teaching the web app about Android. Returns 'layer' when one was open.
const closeTopLayerScript = r'''
(function () {
  var layer = document.querySelector('[role="dialog"],[aria-modal="true"],.crm-modal-backdrop,.modal-card,.crm-panel');
  if (!layer) return 'none';
  var target = document.activeElement || document.body;
  target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }));
  return 'layer';
})()
''';

/// One step back in the page's own history. Pages the drawer opened were added by a
/// script, not a tap, and Chromium's own back skips entries like that, so
/// WebViewController.goBack would jump past them. Returns 'went' if it moved.
const pageBackScript = r'''
(function () {
  if (window.navigation && window.navigation.canGoBack) { history.back(); return 'went'; }
  return 'root';
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
