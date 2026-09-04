const fs = require('fs')
let app = fs.readFileSync('/home/alice/dikho/src/App.jsx', 'utf8')

const target = `                        <td>
                          <span className="cell-primary">{formatValue(phone)}</span>
                          <span className="cell-secondary" title={vendor.email || ''}>{formatValue(vendor.email)}</span>
                        </td>`

const replacement = `                        <td>
                          {phone ? <ContactHoverAction type="phone" value={phone} /> : <span className="cell-primary">-</span>}
                          {vendor.email ? <ContactHoverAction type="email" value={vendor.email} /> : <span className="cell-secondary">-</span>}
                        </td>`

app = app.replace(target, replacement)
fs.writeFileSync('/home/alice/dikho/src/App.jsx', app)
