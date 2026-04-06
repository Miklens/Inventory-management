/**
 * Firebase Cloud Functions – send emails from NotificationQueue.
 * Template matches the old Google Apps Script sendUniversalEmail style.
 * Set env: EMAIL_USER (Gmail address), EMAIL_APP_PASSWORD (App Password), APP_URL (optional, for button link).
 */
const functions = require('firebase-functions');
const admin = require('firebase-admin');
const nodemailer = require('nodemailer');

admin.initializeApp();

const db = admin.firestore();

function getConfig(key) {
  if (process.env[key]) return process.env[key];
  try {
    const c = functions.config();
    if (key === 'EMAIL_USER' && c.email && c.email.user) return c.email.user;
    if (key === 'EMAIL_APP_PASSWORD' && c.email && c.email.app_password) return c.email.app_password;
    if (key === 'APP_URL' && c.app && c.app.url) return c.app.url;
  } catch (e) {}
  return '';
}

const STATUS_COLORS = { INFO: '#3b82f6', SUCCESS: '#10b981', ALERT: '#ef4444', WARNING: '#f59e0b' };

function buildHtml(reqId, eventTitle, title, details, color, appUrl) {
  const finalUrl = appUrl || 'https://miklens.github.io/Inventory-management';
  let detailsHtml = '';
  if (details && details.length > 0) {
    detailsHtml = '<div style="margin: 20px 0; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden;">' +
      '<table style="width: 100%; border-collapse: collapse; font-family: sans-serif; font-size: 13px;">' +
      '<thead style="background-color: #f9fafb;"><tr>' +
      '<th style="padding: 10px; border-bottom: 1px solid #e5e7eb; text-align: left; color: #6b7280; text-transform: uppercase; font-size: 10px;">Detail</th>' +
      '<th style="padding: 10px; border-bottom: 1px solid #e5e7eb; text-align: left; color: #6b7280; text-transform: uppercase; font-size: 10px;">Information</th></tr></thead><tbody>';
    details.forEach(function (item) {
      const label = String(item.label || '').replace(/</g, '&lt;').replace(/"/g, '&quot;');
      const value = String(item.value != null ? item.value : '').replace(/</g, '&lt;').replace(/"/g, '&quot;');
      detailsHtml += '<tr><td style="padding: 10px; border-bottom: 1px solid #f3f4f6; color: #374151; font-weight: bold;">' + label + '</td>' +
        '<td style="padding: 10px; border-bottom: 1px solid #f3f4f6; color: #4b5563;">' + value + '</td></tr>';
    });
    detailsHtml += '</tbody></table></div>';
  }
  const safeReqId = String(reqId || '').replace(/</g, '&lt;');
  const safeTitle = String(title || 'System Update').replace(/</g, '&lt;');
  const safeEvent = String(eventTitle || '').replace(/</g, '&lt;');
  return '<div style="background-color: #f3f4f6; padding: 20px; font-family: \'Segoe UI\', Arial, sans-serif;">' +
    '<div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1);">' +
    '<div style="background-color: ' + (color || STATUS_COLORS.INFO) + '; padding: 30px; text-align: center;">' +
    '<div style="color: #ffffff; font-size: 10px; font-weight: bold; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 10px;">Miklens Digital Requisition</div>' +
    '<h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: 900;">' + safeEvent + '</h1>' +
    '<div style="color: rgba(255,255,255,0.8); font-size: 14px; margin-top: 5px; font-weight: bold;">' + safeTitle + '</div></div>' +
    '<div style="padding: 30px;">' +
    '<p style="color: #4b5563; font-size: 15px; line-height: 1.6; margin-top: 0;">This is an automated notification regarding <b>#' + safeReqId + '</b>.</p>' +
    detailsHtml +
    '<div style="text-align: center; margin-top: 30px;">' +
    '<a href="' + finalUrl + '" style="background-color: ' + (color || STATUS_COLORS.INFO) + '; color: #ffffff; padding: 12px 30px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 14px; display: inline-block;">Open Application</a></div>' +
    '<div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #f3f4f6; color: #9ca3af; font-size: 11px; text-align: center;">© ' + new Date().getFullYear() + ' Miklens Digital Inventory Sync • Automated Alert</div>' +
    '</div></div></div>';
}

async function getManagerAdminEmails() {
  const snap = await db.collection('Users').get();
  const emails = [];
  snap.forEach(function (doc) {
    const d = doc.data();
    const role = (d.Role || d.role || '').toLowerCase();
    const email = (d.Email || d.email || '').trim();
    if (email && (role === 'manager' || role === 'admin')) emails.push(email);
  });
  return emails;
}

async function sendOne(to, subject, html, transporter) {
  if (!to || !subject || !transporter) return;
  const from = getConfig('EMAIL_USER');
  await transporter.sendMail({
    from: from,
    to: to,
    subject: subject,
    html: html
  });
}

exports.processNotificationQueue = functions.firestore
  .document('NotificationQueue/{docId}')
  .onCreate(async (snap, context) => {
    const docId = context.params.docId;
    const data = snap.data();
    const type = (data.type || '').trim();
    const alreadySent = data.sent === true;
    if (alreadySent || !type) return null;

    const emailUser = getConfig('EMAIL_USER');
    const emailPass = getConfig('EMAIL_APP_PASSWORD');
    const appUrl = getConfig('APP_URL');
    if (!emailUser || !emailPass) {
      console.warn('processNotificationQueue: EMAIL_USER or EMAIL_APP_PASSWORD not set; skipping email');
      return null;
    }

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: emailUser, pass: emailPass }
    });

    const payload = data.data || {};
    let to = '';
    let subject = '';
    let reqId = payload.requestId || payload.formulaRequestId || payload.dispatchId || docId;
    let details = [];
    let color = STATUS_COLORS.INFO;
    let eventTitle = 'Notification';
    let title = 'System Update';

    if (type === 'approval_needed') {
      eventTitle = 'New Requisition Submitted';
      title = 'New Requisition';
      color = STATUS_COLORS.INFO;
      details = [
        { label: 'Request ID', value: payload.requestId || '' },
        { label: 'Product', value: payload.productName || '' },
        { label: 'Action', value: 'Please approve or reject in the app.' }
      ];
      to = (payload.managerEmail || '').trim();
      if (!to) {
        const managers = await getManagerAdminEmails();
        to = managers.length ? managers.join(',') : '';
      }
      subject = '[MIKLENS REQ-' + (payload.requestId || '') + '] New Requisition – Approval Required';
    } else if (type === 'reservation_released') {
      eventTitle = 'Reservation Released';
      title = 'Reservation Expired';
      color = STATUS_COLORS.WARNING;
      details = [
        { label: 'Request ID', value: payload.requestId || '' },
        { label: 'Reason', value: 'Reservation timed out after ' + (payload.hours || 48) + ' hours.' },
        { label: 'Action', value: 'Re-issue materials from Pending Issue if still needed.' }
      ];
      const managers = await getManagerAdminEmails();
      to = managers.length ? managers.join(',') : '';
      subject = '[MIKLENS REQ-' + (payload.requestId || '') + '] Reservation Released – Re-issue if needed';
    } else if (type === 'dispatch_approval_required') {
      eventTitle = 'Dispatch Approval Required';
      title = 'Dispatch Request';
      color = STATUS_COLORS.INFO;
      details = [
        { label: 'Request ID', value: payload.requestId || '' },
        { label: 'Product', value: payload.productName || '' },
        { label: 'Quantity', value: (payload.quantity != null ? payload.quantity : '') + ' ' + (payload.unit || '') },
        { label: 'Requested by', value: payload.requestedBy || '' }
      ];
      const managers = await getManagerAdminEmails();
      to = managers.length ? managers.join(',') : '';
      subject = '[MIKLENS] Dispatch Approval Required – ' + (payload.productName || '');
    } else if (type === 'dispatch_approved') {
      eventTitle = 'Dispatch Approved';
      title = 'Dispatch Approved';
      color = STATUS_COLORS.SUCCESS;
      details = [
        { label: 'Request ID', value: payload.requestId || '' },
        { label: 'Product', value: payload.productName || '' },
        { label: 'Quantity', value: (payload.quantity != null ? payload.quantity : '') + ' ' + (payload.unit || '') },
        { label: 'Approved by', value: payload.approvedBy || '' }
      ];
      to = (payload.requesterEmail || '').trim();
      subject = '[MIKLENS REQ-' + (payload.requestId || '') + '] Dispatch Approved';
    } else if (type === 'formula_request_submitted') {
      eventTitle = 'New Formula Request';
      title = 'Formula Request';
      color = STATUS_COLORS.INFO;
      details = [
        { label: 'Request ID', value: payload.formulaRequestId || '' },
        { label: 'Requested by', value: (payload.requestedByName || '') + ' (' + (payload.requestedBy || '') + ')' },
        { label: 'Basis', value: payload.formulaBasis || '' }
      ];
      const managers = await getManagerAdminEmails();
      to = managers.length ? managers.join(',') : '';
      subject = '[MIKLENS] New Formula Request – ' + (payload.formulaRequestId || '');
    } else if (type === 'formula_request_resolved') {
      eventTitle = 'Formula Request Updated';
      title = 'Formula Request ' + (payload.status || 'Resolved');
      color = STATUS_COLORS.SUCCESS;
      details = [
        { label: 'Request ID', value: payload.formulaRequestId || '' },
        { label: 'Status', value: payload.status || '' },
        { label: 'Resolved by', value: payload.resolvedBy || '' }
      ];
      to = (payload.requestedBy || '').trim();
      subject = '[MIKLENS] Formula Request ' + (payload.status || '') + ' – ' + (payload.formulaRequestId || '');
    } else {
      eventTitle = type.replace(/_/g, ' ');
      details = [{ label: 'Type', value: type }, { label: 'Data', value: JSON.stringify(payload) }];
      const managers = await getManagerAdminEmails();
      to = managers.length ? managers.join(',') : '';
      subject = '[MIKLENS] ' + eventTitle;
    }

    if (!to) {
      console.warn('processNotificationQueue: no recipient for type=' + type);
      await snap.ref.update({ sent: false, lastError: 'No recipient', processedAt: new Date().toISOString() });
      return null;
    }

    try {
      const html = buildHtml(reqId, eventTitle, title, details, color, appUrl);
      await sendOne(to, subject, html, transporter);
      await snap.ref.update({ sent: true, sentAt: new Date().toISOString() });
    } catch (err) {
      console.error('processNotificationQueue send failed:', err);
      await snap.ref.update({ sent: false, lastError: (err && err.message) || String(err), processedAt: new Date().toISOString() });
    }
    return null;
  });

// ─── Targeted WIP Reminder (every 2 days) ────────────────────────────────────
// Queries Firestore for actual WIP batches and emails ONLY the specific
// employees who have a WIP request — not a blanket role-based blast.
exports.sendWIPReminders = functions.pubsub
  .schedule('every 48 hours')
  .onRun(async (context) => {
    const emailUser = getConfig('EMAIL_USER');
    const emailPass = getConfig('EMAIL_APP_PASSWORD');
    const appUrl = getConfig('APP_URL');
    if (!emailUser || !emailPass) {
      console.warn('sendWIPReminders: EMAIL_USER or EMAIL_APP_PASSWORD not set; skipping.');
      return null;
    }

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: emailUser, pass: emailPass }
    });

    // Get all WIP requests (non-Research, active stages).
    const snap = await db.collection('Requisitions_V2').get();
    const wipByEmail = {};  // email -> { name, batches: [] }

    snap.forEach(function (doc) {
      const r = doc.data();
      const typ = String(r.Type || r.type || '').toUpperCase();
      const cur = String(r.CurrentStage || r.currentStage || r.stage || '').toUpperCase();
      const status = String(r.Status || r.status || '').toUpperCase();

      // Skip Research requests — they use a different flow.
      if (typ.indexOf('RESEARCH') >= 0) return;

      // Match same WIP stages as getRequestsByStage('WIP') in firebase-backend.js.
      const isWip = cur.indexOf('MANUFACTURING') >= 0 ||
                    cur.indexOf('WIP') >= 0 ||
                    cur.indexOf('MATERIAL ISSUED') >= 0 ||
                    cur === 'PAUSED';
      if (!isWip) return;

      const email = String(r.EmployeeEm || r.requesterEmail || r.email || '').toLowerCase().trim();
      if (!email || email.indexOf('@') < 0) return;

      const name  = String(r.EmployeeName || r.requesterName || r.name || '').trim() || email.split('@')[0];
      const product = String(r.ProductName || r.productName || '').trim();
      const qty   = r.RequestedQty != null ? r.RequestedQty : '';
      const unit  = String(r.Unit || r.unit || '').trim();
      const reqId = String(r.RequestId || r.requestId || doc.id || '').trim();
      const stage = cur;

      if (!wipByEmail[email]) wipByEmail[email] = { name: name, batches: [] };
      wipByEmail[email].batches.push({ reqId: reqId, product: product, qty: qty, unit: unit, stage: stage });
    });

    const targets = Object.keys(wipByEmail);
    if (targets.length === 0) {
      console.log('sendWIPReminders: no active WIP batches found.');
      return null;
    }

    // Check and enforce 2-day cooldown per recipient using Firestore.
    const now = new Date();
    const nowDay = Math.floor(now.getTime() / 86400000);
    const intervalDays = 2;
    let sent = 0;
    let skipped = 0;

    for (let i = 0; i < targets.length; i++) {
      const email = targets[i];
      const info  = wipByEmail[email];

      // Cooldown check: read last sent day from Firestore.
      const cooldownRef = db.collection('ReminderCooldown').doc('wip__' + email.replace(/[^a-z0-9]/g, '_'));
      let lastSentDay = null;
      try {
        const cdSnap = await cooldownRef.get();
        if (cdSnap.exists) {
          const rawTs = cdSnap.data().lastSentAt;
          if (rawTs) lastSentDay = Math.floor(new Date(rawTs).getTime() / 86400000);
        }
      } catch (e) {}

      if (lastSentDay !== null && (nowDay - lastSentDay) < intervalDays) {
        skipped++;
        continue;
      }

      // Build email body listing their WIP batches.
      const batchRows = info.batches.map(function (b, idx) {
        return '<tr>' +
          '<td style="padding:8px 10px;border-bottom:1px solid #f3f4f6;color:#374151;font-weight:bold;">' + (idx + 1) + '. #' + b.reqId + '</td>' +
          '<td style="padding:8px 10px;border-bottom:1px solid #f3f4f6;color:#4b5563;">' + (b.product || '—') + '</td>' +
          '<td style="padding:8px 10px;border-bottom:1px solid #f3f4f6;color:#4b5563;">' + (b.qty !== '' ? b.qty + ' ' + b.unit : '—') + '</td>' +
          '<td style="padding:8px 10px;border-bottom:1px solid #f3f4f6;color:#f59e0b;font-weight:bold;">' + b.stage + '</td>' +
          '</tr>';
      }).join('');

      const finalUrl = appUrl || 'https://miklens.github.io/Inventory-management';
      const html =
        '<div style="background:#f3f4f6;padding:20px;font-family:\'Segoe UI\',Arial,sans-serif;">' +
        '<div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 6px -1px rgba(0,0,0,0.1);">' +
        '<div style="background:#f59e0b;padding:30px;text-align:center;">' +
        '<div style="color:#fff;font-size:10px;font-weight:bold;text-transform:uppercase;letter-spacing:2px;margin-bottom:10px;">Miklens Digital Requisition</div>' +
        '<h1 style="color:#fff;margin:0;font-size:24px;font-weight:900;">WIP Batch Reminder</h1>' +
        '<div style="color:rgba(255,255,255,0.8);font-size:14px;margin-top:5px;">You have active WIP batches pending action</div></div>' +
        '<div style="padding:30px;">' +
        '<p style="color:#4b5563;font-size:15px;line-height:1.6;margin-top:0;">Dear <b>' + info.name + '</b>,</p>' +
        '<p style="color:#4b5563;font-size:14px;line-height:1.6;">The following production batches you submitted are currently in <b>Work In Progress</b> and require your attention. Please either complete or pause them in the application.</p>' +
        '<div style="margin:20px 0;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">' +
        '<table style="width:100%;border-collapse:collapse;font-size:13px;">' +
        '<thead style="background:#f9fafb;"><tr>' +
        '<th style="padding:10px;border-bottom:1px solid #e5e7eb;text-align:left;color:#6b7280;font-size:10px;text-transform:uppercase;">Batch #</th>' +
        '<th style="padding:10px;border-bottom:1px solid #e5e7eb;text-align:left;color:#6b7280;font-size:10px;text-transform:uppercase;">Product</th>' +
        '<th style="padding:10px;border-bottom:1px solid #e5e7eb;text-align:left;color:#6b7280;font-size:10px;text-transform:uppercase;">Qty</th>' +
        '<th style="padding:10px;border-bottom:1px solid #e5e7eb;text-align:left;color:#6b7280;font-size:10px;text-transform:uppercase;">Stage</th>' +
        '</tr></thead><tbody>' + batchRows + '</tbody></table></div>' +
        '<div style="text-align:center;margin-top:30px;">' +
        '<a href="' + finalUrl + '" style="background:#f59e0b;color:#fff;padding:12px 30px;text-decoration:none;border-radius:8px;font-weight:bold;font-size:14px;display:inline-block;">Open Application</a></div>' +
        '<div style="margin-top:30px;padding-top:20px;border-top:1px solid #f3f4f6;color:#9ca3af;font-size:11px;text-align:center;">© ' + now.getFullYear() + ' Miklens Digital Inventory Sync • Automated Alert</div>' +
        '</div></div></div>';

      try {
        await transporter.sendMail({
          from: emailUser,
          to: email,
          subject: '[MIKLENS] WIP Reminder – You have ' + info.batches.length + ' active batch(es) pending',
          html: html
        });
        await cooldownRef.set({ lastSentAt: now.toISOString(), email: email, sentCount: info.batches.length });
        sent++;
      } catch (err) {
        console.error('sendWIPReminders: failed for ' + email + ':', err.message);
      }
    }

    console.log('sendWIPReminders: sent=' + sent + ' skipped=' + skipped + ' targets=' + targets.length);
    return null;
  });
