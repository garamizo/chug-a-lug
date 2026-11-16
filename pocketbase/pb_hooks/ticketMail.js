// The boarding-code email as a gold ticket, like web/src/lib/components/Ticket.svelte (spec
// 2026-11-15-festive-ticket-mail-design.md). Email clients drop gradients, pseudo-elements and
// negative margins, so it is tables with inline styles and bgcolor fallbacks. The notches are
// half-circles whose straight edge sits on the card boundary. The code is one text node so
// copy-paste, one-time-code autofill and the tests' /\b\d{6}\b/ all see six digits; the plain-text
// part keeps the original wording. Hooks cannot read labels.ts, so the wording lives here.

const FONT = "system-ui,-apple-system,'Segoe UI',Roboto,sans-serif"
const DARK = '#111111', GOLD = '#ffb400', INK = '#1a1406', SOFT_INK = '#5c4710', LEDGE = '#6b4c10'

const notch = (radius) =>
  `<td width="10" style="width:10px;padding:0;"><div style="width:10px;height:20px;background:${DARK};border-radius:${radius};"></div></td>`

function ticketHtml(code) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Your Chug-a-Lug boarding code</title></head>
<body style="margin:0;padding:0;background:${DARK};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">Your boarding code: ${code}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${DARK}" style="background:${DARK};">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${GOLD}" style="width:100%;max-width:360px;background:${GOLD};border-radius:14px;border-bottom:6px solid ${LEDGE};border-collapse:separate;font-family:${FONT};color:${INK};">
<tr><td colspan="3" style="padding:16px 18px 0;font-size:11px;letter-spacing:.12em;font-weight:800;color:${SOFT_INK};">BOARDING CODE · ADMIT ONE</td></tr>
<tr><td colspan="3" data-code style="padding:2px 18px 12px;font-size:40px;line-height:1.15;font-weight:900;letter-spacing:.18em;color:${INK};">${code}</td></tr>
<tr>${notch('0 10px 10px 0')}<td style="padding:0 6px;"><div style="border-top:2px dashed #8a6a1c;height:0;font-size:0;line-height:0;">&nbsp;</div></td>${notch('10px 0 0 10px')}</tr>
<tr><td colspan="3" style="padding:10px 14px 16px 18px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td style="font-family:${FONT};font-size:12px;font-weight:800;color:${INK};white-space:nowrap;">VALID 15 MIN</td>
<td align="right" style="font-family:${FONT};font-size:12px;font-weight:800;color:${INK};text-align:right;white-space:nowrap;padding-left:12px;">CHUG-A-LUG CHOO-CHOO</td>
</tr></table>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`
}

exports.codeMail = function (email, code) {
  return {
    to: [email],
    subject: `${code} is your Chug-a-Lug boarding code`,
    text: `Your Chug-a-Lug boarding code: ${code}\n\nIt works for 15 minutes.`,
    html: ticketHtml(code)
  }
}
