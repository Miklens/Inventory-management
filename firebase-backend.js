/**
 * Firebase backend adapter – same API as Google Apps Script Web App.
 * Load after Firebase SDK (compat). Call FirebaseBackend.init(config) then FirebaseBackend.callBackend(action, params).
 */
(function (global) {
  'use strict';
  var db = null;
  var backendConfig = {};

  function fail(err) {
    return { result: 'error', error: (err && err.message) || String(err) };
  }

  function ok(data) {
    return Object.assign({ result: 'success' }, data);
  }

  /** Firestore allows only specific types. Strip undefined, NaN, Infinity; coerce to safe values. */
  function sanitizeForFirestore(val) {
    if (val === undefined) return null;
    if (val === null) return null;
    if (typeof val === 'number') {
      if (val !== val || val === Infinity || val === -Infinity) return 0;
      return val;
    }
    if (typeof val === 'string' || typeof val === 'boolean') return val;
    if (Array.isArray(val)) {
      return val.map(function (item) { return sanitizeForFirestore(item); });
    }
    if (typeof val === 'object' && val !== null) {
      var out = {};
      for (var k in val) {
        if (!Object.prototype.hasOwnProperty.call(val, k)) continue;
        var key = String(k).indexOf('.') >= 0 ? String(k).replace(/\./g, '_') : k;
        out[key] = sanitizeForFirestore(val[k]);
      }
      return out;
    }
    return null;
  }

  async function auditLog(action, user, details) {
    if (!db) return;
    try {
      await db.collection('AuditLog').add({
        action: String(action),
        user: String(user || 'system'),
        timestamp: new Date().toISOString(),
        details: details && typeof details === 'object' ? details : { note: String(details || '') }
      });
    } catch (e) {
      console.warn('AuditLog write failed', e);
    }
  }

  var STATUS_COLORS = { INFO: '#3b82f6', SUCCESS: '#10b981', ALERT: '#ef4444', WARNING: '#f59e0b' };

  function buildHtml(reqId, eventTitle, title, details, color, appUrl) {
    var finalUrl = (appUrl || backendConfig.APP_URL || 'https://miklens.github.io/Inventory-management').trim();
    var detailsHtml = '';
    if (details && details.length > 0) {
      var cellWrap = 'word-wrap: break-word; word-break: break-word; overflow-wrap: break-word; white-space: normal;';
      detailsHtml = '<div style="margin: 20px 0; border: 1px solid #e5e7eb; border-radius: 8px; overflow-x: auto; -webkit-overflow-scrolling: touch;">' +
        '<table style="width: 100%; min-width: 0; border-collapse: collapse; font-family: sans-serif; font-size: 13px; table-layout: fixed;">' +
        '<thead style="background-color: #f9fafb;"><tr>' +
        '<th style="padding: 10px; border-bottom: 1px solid #e5e7eb; text-align: left; color: #6b7280; text-transform: uppercase; font-size: 10px; width: 28%; ' + cellWrap + '">Detail</th>' +
        '<th style="padding: 10px; border-bottom: 1px solid #e5e7eb; text-align: left; color: #6b7280; text-transform: uppercase; font-size: 10px; ' + cellWrap + '">Information</th></tr></thead><tbody>';
      for (var i = 0; i < details.length; i++) {
        var item = details[i];
        var label = String(item.label || '').replace(/</g, '&lt;').replace(/"/g, '&quot;');
        var value = String(item.value != null ? item.value : '').replace(/</g, '&lt;').replace(/"/g, '&quot;');
        detailsHtml += '<tr><td style="padding: 10px; border-bottom: 1px solid #f3f4f6; color: #374151; font-weight: bold; width: 28%; ' + cellWrap + '">' + label + '</td>' +
          '<td style="padding: 10px; border-bottom: 1px solid #f3f4f6; color: #4b5563; ' + cellWrap + '">' + value + '</td></tr>';
      }
      detailsHtml += '</tbody></table></div>';
    }
    var safeReqId = String(reqId || '').replace(/</g, '&lt;');
    var safeTitle = String(title || 'System Update').replace(/</g, '&lt;');
    var safeEvent = String(eventTitle || '').replace(/</g, '&lt;');
    return '<div style="background-color: #f3f4f6; padding: 20px; font-family: \'Segoe UI\', Arial, sans-serif;">' +
      '<div style="max-width: 600px; width: 100%; box-sizing: border-box; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1);">' +
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
    if (!db) return [];
    var snap = await db.collection('Users').get();
    var emails = [];
    snap.forEach(function (doc) {
      var d = doc.data();
      var role = (d.Role || d.role || '').toLowerCase().trim();
      var email = (d.Email || d.email || '').trim();
      if (email && (role === 'manager' || role === 'admin')) emails.push(email);
    });
    return emails;
  }

  async function buildEmailContent(type, data) {
    var payload = data && typeof data === 'object' ? data : {};
    var reqId = payload.requestId || payload.formulaRequestId || payload.dispatchId || '';
    var details = [];
    var color = STATUS_COLORS.INFO;
    var eventTitle = 'Notification';
    var title = 'System Update';
    var to = '';
    var subject = '';

    if (type === 'approval_needed') {
      eventTitle = 'New Requisition Submitted';
      title = 'New Requisition – Approval Required';
      color = STATUS_COLORS.INFO;
      var reqDate = payload.requestedAt ? new Date(payload.requestedAt).toLocaleString() : '';
      details = [
        { label: 'Request ID', value: payload.requestId || '' },
        { label: 'Requested by', value: (payload.requesterName || '') + (payload.requesterEmail ? ' (' + payload.requesterEmail + ')' : '') },
        { label: 'Product', value: payload.productName || '' },
        { label: 'Quantity', value: (payload.requestedQty != null ? payload.requestedQty : '') + ' ' + (payload.unit || '') },
        { label: 'Request date', value: reqDate },
        { label: 'Action', value: 'Please approve or reject in the app.' }
      ];
      var managersList = await getManagerAdminEmails();
      to = (payload.managerEmail || '').trim();
      if (!to) to = managersList.length ? managersList.join(',') : '';
      var ccApproval = managersList.filter(function (e) { return to.indexOf(e) < 0; }).join(',');
      subject = '[MIKLENS REQ-' + (payload.requestId || '') + '] New Requisition – ' + (payload.requesterName || 'Employee') + ' – ' + (payload.productName || '') + ' – Approval Required';
    } else if (type === 'reservation_released') {
      eventTitle = 'Reservation Released';
      title = 'Reservation Expired';
      color = STATUS_COLORS.WARNING;
      details = [
        { label: 'Request ID', value: payload.requestId || '' },
        { label: 'Product', value: payload.productName || '' },
        { label: 'Reason', value: 'Reservation timed out after ' + (payload.hours || 48) + ' hours.' },
        { label: 'Action', value: 'Re-issue materials from Pending Issue if still needed.' }
      ];
      var managers0 = await getManagerAdminEmails();
      to = managers0.length ? managers0.join(',') : '';
      subject = '[MIKLENS REQ-' + (payload.requestId || '') + '] Reservation Released – Re-issue if needed';
    } else if (type === 'dispatch_approval_required') {
      eventTitle = 'Dispatch Approval Required';
      title = 'Dispatch Request';
      color = STATUS_COLORS.INFO;
      details = [
        { label: 'Request ID', value: payload.requestId || '' },
        { label: 'Dispatch ID', value: payload.dispatchId || '' },
        { label: 'Product', value: payload.productName || '' },
        { label: 'Quantity', value: (payload.quantity != null ? payload.quantity : '') + ' ' + (payload.unit || '') },
        { label: 'Requested by', value: payload.requestedBy || '' },
        { label: 'Action', value: 'Approve or reject in the app.' }
      ];
      var managers1 = await getManagerAdminEmails();
      to = managers1.length ? managers1.join(',') : '';
      subject = '[MIKLENS] Dispatch Approval Required – ' + (payload.productName || '');
    } else if (type === 'dispatch_approved') {
      eventTitle = 'Dispatch Approved';
      title = 'Dispatch Approved';
      color = STATUS_COLORS.SUCCESS;
      details = [
        { label: 'Request ID', value: payload.requestId || '' },
        { label: 'Product', value: payload.productName || '' },
        { label: 'Quantity', value: (payload.quantity != null ? payload.quantity : '') + ' ' + (payload.unit || '') },
        { label: 'Approved by', value: payload.approvedBy || '' },
        { label: 'Action', value: 'You can collect the dispatched items.' }
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
      var managers2 = await getManagerAdminEmails();
      to = managers2.length ? managers2.join(',') : '';
      subject = '[MIKLENS] New Formula Request – ' + (payload.formulaRequestId || '');
    } else if (type === 'formula_request_resolved') {
      eventTitle = 'Formula Request Updated';
      title = 'Formula Request ' + (payload.status || 'Resolved');
      color = STATUS_COLORS.SUCCESS;
      details = [
        { label: 'Request ID', value: payload.formulaRequestId || '' },
        { label: 'Status', value: payload.status || '' },
        { label: 'Resolved by', value: payload.resolvedBy || '' },
        { label: 'Action', value: 'Check the app for details.' }
      ];
      to = (payload.requestedBy || '').trim();
      subject = '[MIKLENS] Formula Request ' + (payload.status || '') + ' – ' + (payload.formulaRequestId || '');
    } else if (type === 'production_completed') {
      eventTitle = 'Production Completed';
      title = 'WIP / Production Completed';
      color = STATUS_COLORS.SUCCESS;
      details = [
        { label: 'Request ID', value: payload.requestId || '' },
        { label: 'Product', value: payload.productName || '' },
        { label: 'Quantity', value: (payload.quantity != null ? payload.quantity : '') + ' ' + (payload.unit || '') },
        { label: 'Completed by', value: payload.completedBy || '' },
        { label: 'Requested by', value: (payload.requesterName || '') + (payload.requesterEmail ? ' (' + payload.requesterEmail + ')' : '') },
        { label: 'Action', value: 'Ready for dispatch or next step.' }
      ];
      to = (payload.requesterEmail || '').trim();
      if (!to) { var managersP = await getManagerAdminEmails(); to = managersP.length ? managersP.join(',') : ''; }
      subject = '[MIKLENS REQ-' + (payload.requestId || '') + '] Production Completed – ' + (payload.productName || '');
    } else if (type === 'production_paused') {
      eventTitle = 'Production Paused';
      title = 'WIP Paused';
      color = STATUS_COLORS.WARNING;
      details = [
        { label: 'Request ID', value: payload.requestId || '' },
        { label: 'Product', value: payload.productName || '' },
        { label: 'Quantity', value: (payload.quantity != null ? payload.quantity : '') + ' ' + (payload.unit || '') },
        { label: 'Paused by', value: payload.pausedBy || '' },
        { label: 'Reason', value: payload.reason || '—' },
        { label: 'Requested by', value: (payload.requesterName || '') + (payload.requesterEmail ? ' (' + payload.requesterEmail + ')' : '') },
        { label: 'Action', value: 'Resume from WIP when ready.' }
      ];
      to = (payload.requesterEmail || '').trim();
      if (!to) { var managersPause = await getManagerAdminEmails(); to = managersPause.length ? managersPause.join(',') : ''; }
      subject = '[MIKLENS REQ-' + (payload.requestId || '') + '] Production Paused – ' + (payload.productName || '');
    } else if (type === 'production_cancelled') {
      eventTitle = 'Production Cancelled';
      title = 'WIP Cancelled';
      color = STATUS_COLORS.ERROR;
      details = [
        { label: 'Request ID', value: payload.requestId || '' },
        { label: 'Product', value: payload.productName || '' },
        { label: 'Quantity', value: (payload.quantity != null ? payload.quantity : '') + ' ' + (payload.unit || '') },
        { label: 'Cancelled by', value: payload.cancelledBy || '' },
        { label: 'Reason', value: payload.reason || '—' },
        { label: 'Requested by', value: (payload.requesterName || '') + (payload.requesterEmail ? ' (' + payload.requesterEmail + ')' : '') },
        { label: 'Action', value: 'Request is closed. Create a new request if needed.' }
      ];
      to = (payload.requesterEmail || '').trim();
      if (!to) { var managersCancel = await getManagerAdminEmails(); to = managersCancel.length ? managersCancel.join(',') : ''; }
      subject = '[MIKLENS REQ-' + (payload.requestId || '') + '] Production Cancelled – ' + (payload.productName || '');
    } else if (type === 'materials_issued') {
      eventTitle = 'Materials Issued';
      title = 'Materials Issued to Floor';
      color = STATUS_COLORS.SUCCESS;
      details = [
        { label: 'Request ID', value: payload.requestId || '' },
        { label: 'Product', value: payload.productName || '' },
        { label: 'Quantity', value: (payload.quantity != null ? payload.quantity : '') + ' ' + (payload.unit || '') },
        { label: 'Issued by', value: payload.issuedBy || 'Store' },
        { label: 'Action', value: 'Items issued to production floor. Inventory deducted.' }
      ];
      to = (payload.requesterEmail || '').trim();
      if (!to) { var managersM = await getManagerAdminEmails(); to = managersM.length ? managersM.join(',') : ''; }
      subject = '[MIKLENS REQ-' + (payload.requestId || '') + '] Materials Issued – Production Started';
    } else if (type === 'correction_requested') {
      eventTitle = 'Correction Requested';
      title = 'Adjustment Needed';
      color = STATUS_COLORS.WARNING;
      details = [
        { label: 'Request ID', value: payload.requestId || '' },
        { label: 'Product', value: payload.productName || '' },
        { label: 'Requested by', value: (payload.requestedBy || '') + (payload.requestedByEmail ? ' (' + payload.requestedByEmail + ')' : '') },
        { label: 'Reason', value: payload.summary || 'Ingredient correction requested' },
        { label: 'Action', value: 'Check "Pending Manager Approval" and re-approve or reject.' }
      ];
      var managersCorr = await getManagerAdminEmails();
      to = managersCorr.length ? managersCorr.join(',') : '';
      subject = '[MIKLENS REQ-' + (payload.requestId || '') + '] Correction Requested';
    } else if (type === 'request_approved') {
      eventTitle = 'Request Approved';
      title = 'Requisition Approved';
      color = STATUS_COLORS.SUCCESS;
      details = [
        { label: 'Request ID', value: payload.requestId || '' },
        { label: 'Product', value: payload.productName || '' },
        { label: 'Quantity', value: (payload.quantity != null ? payload.quantity : '') + ' ' + (payload.unit || '') },
        { label: 'Approved by', value: payload.approvedBy || '' },
        { label: 'Action', value: 'Awaiting material issue from Store. You will be notified when materials are issued.' }
      ];
      to = (payload.requesterEmail || '').trim();
      if (!to) { var managersApp = await getManagerAdminEmails(); to = managersApp.length ? managersApp.join(',') : ''; }
      subject = '[MIKLENS REQ-' + (payload.requestId || '') + '] Request Approved – ' + (payload.productName || '');
    } else if (type === 'request_rejected') {
      eventTitle = 'Request Rejected';
      title = 'Requisition Rejected';
      color = STATUS_COLORS.ERROR;
      details = [
        { label: 'Request ID', value: payload.requestId || '' },
        { label: 'Product', value: payload.productName || '' },
        { label: 'Quantity', value: (payload.quantity != null ? payload.quantity : '') + ' ' + (payload.unit || '') },
        { label: 'Rejected by', value: payload.rejectedBy || '' },
        { label: 'Reason', value: payload.reason || '—' },
        { label: 'Action', value: 'You may submit a new request if needed.' }
      ];
      to = (payload.requesterEmail || '').trim();
      if (!to) { var managersRej = await getManagerAdminEmails(); to = managersRej.length ? managersRej.join(',') : ''; }
      subject = '[MIKLENS REQ-' + (payload.requestId || '') + '] Request Rejected – ' + (payload.productName || '');
    } else if (type === 'request_on_hold') {
      eventTitle = 'Request On Hold';
      title = 'Requisition On Hold';
      color = STATUS_COLORS.WARNING;
      details = [
        { label: 'Request ID', value: payload.requestId || '' },
        { label: 'Product', value: payload.productName || '' },
        { label: 'Quantity', value: (payload.quantity != null ? payload.quantity : '') + ' ' + (payload.unit || '') },
        { label: 'Put on hold by', value: payload.heldBy || '' },
        { label: 'Reason', value: payload.reason || '—' },
        { label: 'Action', value: 'Manager will resume or update this request. Check the app for status.' }
      ];
      to = (payload.requesterEmail || '').trim();
      if (!to) { var managersHold = await getManagerAdminEmails(); to = managersHold.length ? managersHold.join(',') : ''; }
      subject = '[MIKLENS REQ-' + (payload.requestId || '') + '] Request On Hold – ' + (payload.productName || '');
    } else if (type === 'partial_issued') {
      eventTitle = 'Partially Issued';
      title = 'Materials Partially Issued';
      color = STATUS_COLORS.WARNING;
      details = [
        { label: 'Request ID', value: payload.requestId || '' },
        { label: 'Product', value: payload.productName || '' },
        { label: 'Issued', value: (payload.partialQty != null ? payload.partialQty : '') + ' ' + (payload.unit || '') },
        { label: 'Requested', value: (payload.requestedQty != null ? payload.requestedQty : '') + ' ' + (payload.unit || '') },
        { label: 'Issued by', value: payload.issuedBy || 'Store' },
        { label: 'Action', value: 'Remaining quantity to be issued later. Check the app for status.' }
      ];
      to = (payload.requesterEmail || '').trim();
      if (!to) { var managersPart = await getManagerAdminEmails(); to = managersPart.length ? managersPart.join(',') : ''; }
      subject = '[MIKLENS REQ-' + (payload.requestId || '') + '] Partially Issued – ' + (payload.productName || '');
    } else {
      eventTitle = type.replace(/_/g, ' ');
      details = [{ label: 'Type', value: type }, { label: 'Data', value: JSON.stringify(payload) }];
      var managers3 = await getManagerAdminEmails();
      to = managers3.length ? managers3.join(',') : '';
      subject = '[MIKLENS] ' + eventTitle;
    }
    if (!to) return null;
    var html = buildHtml(reqId, eventTitle, title, details, color, backendConfig.APP_URL);
    var cc = (type === 'approval_needed' && ccApproval) ? ccApproval : '';
    return { to: to, subject: subject, html: html, cc: cc || '' };
  }

  function sendEmailViaAppsScript(payload) {
    var url = (backendConfig.APP_SCRIPT_EMAIL_URL || '').trim();
    var secret = (backendConfig.APP_SCRIPT_EMAIL_SECRET || '').trim();
    if (!url || !secret) {
      console.warn('Email skipped: APP_SCRIPT_EMAIL_URL or APP_SCRIPT_EMAIL_SECRET not set in config.');
      return;
    }
    if (!payload || !payload.to) {
      console.warn('Email skipped: no recipient (to). Check Manager Email on the requisition or add a user with Role Manager/Admin in Firestore Users.');
      return;
    }
    try {
      var data = {
        secret: secret,
        to: payload.to,
        subject: payload.subject || '',
        html: payload.html || ''
      };
      if (payload.cc && String(payload.cc).trim()) data.cc = String(payload.cc).trim();
      var payloadStr = JSON.stringify(data);
      /* Form POST in iframe. Email sends; 403 in console is from iframe loading script response – harmless. */
      var iframe = document.createElement('iframe');
      iframe.style.cssText = 'position:absolute;width:0;height:0;border:0;visibility:hidden';
      iframe.name = 'appsScriptEmail_' + Date.now();
      document.body.appendChild(iframe);
      var form = document.createElement('form');
      form.action = url;
      form.method = 'POST';
      form.target = iframe.name;
      var input = document.createElement('input');
      input.name = 'payload';
      input.value = payloadStr;
      form.appendChild(input);
      document.body.appendChild(form);
      form.submit();
      console.log('Email sent (form POST) to:', payload.to);
      setTimeout(function () {
        try { document.body.removeChild(form); document.body.removeChild(iframe); } catch (e) {}
      }, 3000);
    } catch (e) {
      console.warn('Apps Script email failed', e);
    }
  }

  /** Log that this employee submitted a request (for reminder: only remind those who have not requested in 2 days). */
  function logRequestToReminderSheet(email, name) {
    var url = (backendConfig.APP_SCRIPT_EMAIL_URL || '').trim();
    var secret = (backendConfig.APP_SCRIPT_EMAIL_SECRET || '').trim();
    if (!url || !secret || !email) return;
    try {
      var payloadStr = JSON.stringify({
        secret: secret,
        action: 'log_request',
        email: String(email).toLowerCase().trim(),
        name: String(name || '').trim()
      });
      var iframe = document.createElement('iframe');
      iframe.style.cssText = 'position:absolute;width:0;height:0;border:0;visibility:hidden';
      iframe.name = 'appsScriptLog_' + Date.now();
      document.body.appendChild(iframe);
      var form = document.createElement('form');
      form.action = url;
      form.method = 'POST';
      form.target = iframe.name;
      var input = document.createElement('input');
      input.name = 'payload';
      input.value = payloadStr;
      form.appendChild(input);
      document.body.appendChild(form);
      form.submit();
      setTimeout(function () {
        try { document.body.removeChild(form); document.body.removeChild(iframe); } catch (e) {}
      }, 2000);
    } catch (e) {}
  }

  /** Optional: push to NotificationQueue for in-app notifications; if Apps Script URL is set, also send email for free. */
  async function pushNotificationQueue(type, data) {
    if (!db) return;
    try {
      await db.collection('NotificationQueue').add({
        type: String(type),
        createdAt: new Date().toISOString(),
        sent: false,
        data: data && typeof data === 'object' ? data : {}
      });
      if (backendConfig.APP_SCRIPT_EMAIL_URL && backendConfig.APP_SCRIPT_EMAIL_SECRET) {
        try {
          var emailPayload = await buildEmailContent(type, data);
          if (emailPayload && emailPayload.to) {
            sendEmailViaAppsScript(emailPayload);
          } else if (!emailPayload || !emailPayload.to) {
            console.warn('Email skipped: no recipient for type=', type, '- set Manager Email on the request or add Manager/Admin users in Firestore.');
          }
        } catch (e) {
          console.warn('Apps Script email failed', e);
        }
      }
    } catch (e) {
      console.warn('NotificationQueue write failed', e);
    }
  }

  async function sha256(str) {
    var buf = new TextEncoder().encode(str);
    var hash = await crypto.subtle.digest('SHA-256', buf);
    var arr = Array.from(new Uint8Array(hash));
    return arr.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
  }

  function getAuth() {
    return (typeof global.firebase !== 'undefined' && global.firebase.auth) ? global.firebase.auth() : null;
  }

  // Login: database only. Only users listed in Firestore Users (by email) can log in. No Firebase Auth required.
  async function loginUser(email, password) {
    if (!email || !password) return fail(new Error('Email and password required'));
    var emailNorm = String(email).toLowerCase().trim();
    var docRef = db.collection('Users').doc(emailNorm.replace(/\//g, '_'));
    var snap = await docRef.get();
    if (!snap.exists) return { result: 'error', error: 'Invalid login or not in user list. Ask admin to add you.' };
    var u = snap.data();
    var stored = (u.PasswordHash || '').trim();
    if (!stored) return { result: 'error', error: 'Invalid login' };
    var combined = String(password) + emailNorm;
    var hashed = await sha256(combined);
    var match = (stored === hashed) || (/^[a-f0-9]{64}$/i.test(stored) === false && stored === String(password).trim());
    if (!match) return { result: 'error', error: 'Invalid email or password.' };
    return ok({
      user: { email: u.Email || emailNorm, name: u.Name || '', role: u.Role || '', department: u.Department || '' }
    });
  }

  async function getMyProfile() {
    var auth = getAuth();
    if (!auth || !auth.currentUser) return fail(new Error('Not signed in'));
    var uid = auth.currentUser.uid;
    var snap = await db.collection('Users').doc(uid).get();
    if (!snap.exists) return fail(new Error('Not on the approve list'));
    var u = snap.data();
    return ok({
      user: { uid: uid, email: u.Email || auth.currentUser.email || '', name: u.Name || '', role: u.Role || '', department: u.Department || '' }
    });
  }

  async function getDb() {
    var snap = await db.collection('Database').doc('latest').get();
    if (!snap.exists) return { status: 'success', result: 'success', data: null };
    var d = snap.data();
    var payload = (d && d.data) ? d.data : d;
    var version = (d && d.latestId) ? d.latestId : null;
    return { status: 'success', result: 'success', data: payload, version: version };
  }

  async function saveInventory(payload, baseVersionParam) {
    var dataString = (payload && payload.data) ? JSON.stringify(payload) : (typeof payload === 'string' ? payload : JSON.stringify(payload));
    var parsed = null;
    try { parsed = typeof dataString === 'string' ? JSON.parse(dataString) : dataString; } catch (e) { return fail(e); }
    var dataObj = (parsed && parsed.data && parsed.data.inventory) ? parsed.data : parsed;
    var baseVersion = (baseVersionParam !== undefined && baseVersionParam !== null && baseVersionParam !== '') ? String(baseVersionParam) : ((payload && payload.baseVersion !== undefined && payload.baseVersion !== null) ? String(payload.baseVersion) : null);
    if (baseVersion !== null && baseVersion !== '') {
      var currentSnap = await db.collection('Database').doc('latest').get();
      if (currentSnap.exists) {
        var currentId = (currentSnap.data().latestId || '').toString();
        if (currentId !== '' && currentId !== baseVersion) {
          return { result: 'error', error: 'Data was changed by someone else. Refresh to get the latest, then try again.', code: 'CONFLICT', serverVersion: currentId };
        }
      }
    }
    var id = Date.now().toString();
    await db.collection('Database').doc('latest').set({
      data: dataObj || parsed,
      latestId: id,
      exportedAt: new Date().toISOString()
    });
    return { status: 'success', result: 'success', version: id };
  }

  async function getCollectionArray(collName) {
    var snap = await db.collection(collName).get();
    var out = [];
    snap.forEach(function (d) {
      if (d.id === '_empty' || d.id === 'latest') return;
      out.push(Object.assign({ _id: d.id }, d.data()));
    });
    return out;
  }

  function rowToRequest(d, light) {
    var r = (d && d.data) ? d.data : d;
    var id = r.RequestID || r.id || d.id;
    var row = {
      id: id,
      type: r.Type || r.type || '',
      status: r.Status || r.status || '',
      requesterName: r.EmployeeName || r.requesterName || '',
      requesterEmail: r.EmployeeEm || r.requesterEmail || '',
      productName: r.ProductName || r.productName || '',
      quantity: r.RequestedQty != null ? r.RequestedQty : r.quantity,
      unit: r.Unit || r.unit || '',
      remarks: r.Notes || r.remarks || '',
      date: r.CreatedDate || r.date,
      stage: r.CurrentStage || r.stage,
      currentStage: r.CurrentStage || r.stage
    };
    if (r.PartialIssuedQty != null) row.partialIssuedQty = r.PartialIssuedQty;
    if (!light) {
      row.ingredients = safeJson(r.Formulaltems || r.ingredients, []);
      row.packing = safeJson(r.Additionalltems || r.packing, []);
      row.labels = safeJson(r.Labels || r.labels, []);
      row.additionalItems = safeJson(r.AdditionalItems || r.additionalItems, []);
      row.corrections = safeJson(r.Corrections || r.corrections, []);
    } else if ((String(r.Type || r.type || '')).toUpperCase() === 'RESEARCH') {
      row.additionalItems = safeJson(r.AdditionalItems || r.additionalItems, []);
    }
    return row;
  }

  function safeJson(v, def) {
    if (v == null || v === '') return def;
    if (Array.isArray(v)) return v;
    if (typeof v === 'object') return v;
    try { return JSON.parse(String(v)); } catch (e) { return def; }
  }

  function buildReservationItemsFromRequisition(data) {
    var ingredients = safeJson(data.Formulaltems || data.ingredients, []);
    var packing = safeJson(data.Additionalltems || data.packing, []);
    var labels = safeJson(data.Labels || data.labels, []);
    var toEntry = function (i, cat) {
      return {
        itemId: i.id != null ? i.id : i.itemId,
        itemName: (i.name || i.itemName || '').toString().trim(),
        quantity: parseFloat(i.quantity || i.qty || 0) || 0,
        category: cat
      };
    };
    var rawMaterials = (Array.isArray(ingredients) ? ingredients : []).map(function (i) { return toEntry(i, 'rawMaterials'); });
    var packingMaterials = (Array.isArray(packing) ? packing : []).map(function (i) { return toEntry(i, 'packingMaterials'); });
    var labelsList = (Array.isArray(labels) ? labels : []).map(function (i) { return toEntry(i, 'labels'); });
    return { rawMaterials: rawMaterials, packingMaterials: packingMaterials, labels: labelsList };
  }

  async function upsertRequisitionReservation(requestId, data, status) {
    var docId = String(requestId).replace(/\//g, '_');
    var ref = db.collection('RequisitionReservations').doc(docId);
    var built = buildReservationItemsFromRequisition(data);
    var items = []
      .concat((built.rawMaterials || []).map(function (r) { return Object.assign({}, r, { category: 'rawMaterials' }); }))
      .concat((built.packingMaterials || []).map(function (r) { return Object.assign({}, r, { category: 'packingMaterials' }); }))
      .concat((built.labels || []).map(function (r) { return Object.assign({}, r, { category: 'labels' }); }));
    await ref.set({
      requestId: requestId,
      status: status,
      items: items,
      updatedAt: new Date().toISOString()
    });
  }

  /** Deduct requisition materials from Database/latest inventory. Used when issue is completed (direct ISSUE or Manager approves after Store issued). */
  async function deductInventoryForRequisition(requestId, data) {
    var latestRef = db.collection('Database').doc('latest');
    var snap = await latestRef.get();
    if (!snap.exists) return { result: 'error', error: 'No inventory data. Add stock in Main Inventory first.', code: 'NO_INVENTORY' };
    var d = snap.data();
    var currentVersion = (d.latestId || '').toString();
    var payload = (d.data != null) ? d.data : d;
    var inv = (payload && payload.inventory) ? payload.inventory : payload;
    if (!inv || typeof inv !== 'object') return { result: 'error', error: 'Inventory structure not found.', code: 'NO_INVENTORY' };

    var built = buildReservationItemsFromRequisition(data);
    var categories = { rawMaterials: built.rawMaterials || [], packingMaterials: built.packingMaterials || [], labels: built.labels || [] };
    var list = (categories.rawMaterials || []).concat(categories.packingMaterials || []).concat(categories.labels || []);

    function findAndDeduct(arr, itemId, itemName, qty) {
      var remaining = parseFloat(qty) || 0;
      if (!arr || !Array.isArray(arr)) return remaining;
      var idStr = (itemId != null ? String(itemId) : '').trim();
      var nameStr = (itemName || '').toString().trim();
      for (var i = 0; i < arr.length && remaining > 0; i++) {
        var item = arr[i];
        var match = (idStr && (String(item.id || '') === idStr || String(item.itemId || '') === idStr)) ||
          (nameStr && (String(item.name || '') === nameStr || String(item.itemName || '') === nameStr));
        if (!match) continue;
        var current = parseFloat(item.quantity || item.qty || 0) || 0;
        var deduct = Math.min(remaining, current);
        item.quantity = item.qty = Math.max(0, current - deduct);
        remaining -= deduct;
      }
      return remaining;
    }

    var nowIso = new Date().toISOString();
    var dateStr = nowIso.split('T')[0] + 'T00:00:00.000Z';
    if (!Array.isArray(payload.transactions)) payload.transactions = [];

    for (var c = 0; c < list.length; c++) {
      var ent = list[c];
      var cat = (ent.category || 'rawMaterials').toString();
      var arr = inv[cat];
      var left = findAndDeduct(arr, ent.itemId, ent.itemName, ent.quantity);
      if (left > 0) {
        await auditLog('requisition_issue_deduction_shortfall', 'system', { requestId: requestId, itemName: ent.itemName || ent.itemId, shortfall: left });
      }
      var deducted = (parseFloat(ent.quantity) || 0) - left;
      if (deducted > 0) {
        payload.transactions.push({
          id: Date.now().toString() + '-' + c,
          itemId: ent.itemId || ent.itemName,
          itemName: ent.itemName || ent.itemId,
          category: cat,
          type: 'requisition-issue',
          quantity: -deducted,
          date: dateStr,
          requestId: requestId
        });
      }
    }

    var saveResult = await saveInventory(payload, currentVersion);
    if (saveResult.result === 'error' && saveResult.code === 'CONFLICT') {
      return { result: 'error', error: saveResult.error || 'Inventory was changed by someone else. Ask them to sync, then try Issue again.', code: 'CONFLICT', serverVersion: saveResult.serverVersion };
    }
    if (saveResult.result !== 'success' && saveResult.status !== 'success') {
      return { result: 'error', error: (saveResult.error || 'Deduction failed') };
    }
    await auditLog('requisition_issue_deduction', 'system', { requestId: requestId, note: 'Inventory deducted for issue' });
    return { result: 'success' };
  }

  /** Release reservations older than X hours (optional auto-release). Resets requisition to Awaiting Material Issue so Store can re-issue. */
  async function releaseExpiredReservations(params) {
    var hours = parseFloat(params.hours || params.hoursLimit || 48, 10) || 48;
    var cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
    var snap = await db.collection('RequisitionReservations').get();
    var released = [];
    for (var i = 0; i < snap.docs.length; i++) {
      var d = snap.docs[i];
      var doc = d.data();
      if ((doc.status || '').toLowerCase() !== 'reserved') continue;
      var updatedAt = (doc.updatedAt || '').toString();
      if (updatedAt >= cutoff) continue;
      var requestId = doc.requestId || d.id.replace(/_/g, '/');
      await d.ref.update({ status: 'released', updatedAt: new Date().toISOString() });
      var reqRef = db.collection('Requisitions_V2').doc(String(requestId).replace(/\//g, '_'));
      var reqSnap = await reqRef.get();
      if (reqSnap.exists) {
        await reqRef.update({
          Status: 'APPROVED',
          CurrentStage: 'Awaiting Material Issue (reservation expired – re-issue required)'
        });
      }
      released.push(requestId);
      await auditLog('reservation_timeout_released', 'system', { requestId: requestId, hours: hours });
      await pushNotificationQueue('reservation_released', { requestId: requestId, hours: hours });
    }
    return ok({ released: released, count: released.length });
  }

  async function getRequisitionReservedTotals() {
    var snap = await db.collection('RequisitionReservations').get();
    var byKey = {};
    snap.forEach(function (d) {
      var doc = d.data();
      if ((doc.status || '').toLowerCase() !== 'reserved') return;
      var items = doc.items || [];
      items.forEach(function (it) {
        var cat = (it.category || 'rawMaterials').toString();
        var key = cat + ':' + (it.itemId != null ? String(it.itemId) : (it.itemName || '').toString());
        if (!key || key === cat + ':') return;
        byKey[key] = (byKey[key] || 0) + (parseFloat(it.quantity) || 0);
      });
    });
    var rawMaterials = [], packingMaterials = [], labels = [];
    Object.keys(byKey).forEach(function (k) {
      var val = byKey[k];
      var parts = k.split(':');
      var cat = parts[0];
      var idOrName = parts.slice(1).join(':');
      var entry = { itemId: idOrName, itemName: idOrName, quantity: val };
      if (cat === 'rawMaterials') rawMaterials.push(entry);
      else if (cat === 'packingMaterials') packingMaterials.push(entry);
      else labels.push(entry);
    });
    return ok({ rawMaterials: rawMaterials, packingMaterials: packingMaterials, labels: labels });
  }

  async function getRequestsByStage(params) {
    var stage = (params.stage || '').toUpperCase();
    var limit = parseInt(params.limit, 10) || 20;
    var page = parseInt(params.page, 10) || 1;
    var skip = (page - 1) * limit;
    var light = params.light === '1' || params.light === true;
    var all = await getCollectionArray('Requisitions_V2');
    var match = function (r, st) {
      var status = (r.Status || r.status || '').toUpperCase();
      var cur = (r.CurrentStage || r.currentStage || r.stage || '').toUpperCase();
      if (st === 'ALL') return true;
      if (st === 'PENDING_APPROVALS') {
        if (cur.indexOf('PENDING MANAGER APPROVAL') >= 0 && (status === 'SUBMITTED' || status === 'PENDING')) return true;
        if (status === 'ISSUED_PENDING_APPROVAL' && cur.indexOf('STORE ISSUED') >= 0) return true;
        return false;
      }
      if (st === 'PENDING_ISSUE') {
        if (cur.indexOf('AWAITING MATERIAL ISSUE') >= 0 || cur.indexOf('PENDING STORE') >= 0 || cur.indexOf('PENDING MANAGER APPROVAL') >= 0) return true;
        if ((status === 'APPROVED' || status === 'APPROVE_REQUEST') && (cur.indexOf('AWAITING') >= 0 || cur.indexOf('MATERIAL ISSUE') >= 0)) return true;
        if (status === 'PARTIALLY_ISSUED') return true;
      }
      if (st === 'WIP' && (cur.indexOf('MANUFACTURING') >= 0 || cur.indexOf('WIP') >= 0 || cur.indexOf('MATERIAL ISSUED') >= 0 || cur === 'PAUSED')) return true;
      if (st === 'DISPATCH' && (cur.indexOf('AWAITING DISPATCH') >= 0 || status === 'PRODUCED')) return true;
      if (st === 'PENDING_RECORD' && (cur.indexOf('AWAITING PRODUCTION RECORDING') >= 0 || cur.indexOf('MATERIAL ISSUED') >= 0)) return true;
      if (st === 'PARTIAL_ISSUE' && status === 'PARTIALLY_ISSUED') return true;
      return false;
    };
    var filtered = stage === 'ALL' ? all : all.filter(function (r) { return match(r, stage); });
    var totalMatches = filtered.length;
    var pageList = filtered.slice(skip, skip + limit);
    var requests = pageList.map(function (d) { return rowToRequest(d, light); });
    return ok({ requests: requests, totalMatches: totalMatches, page: page });
  }

  async function getAllRequests(params) {
    return getRequestsByStage({ stage: 'ALL', limit: params.limit || 500, light: params.light });
  }

  async function getRequestDetails(params) {
    var id = params.id;
    if (!id) return fail(new Error('No id'));
    var docRef = db.collection('Requisitions_V2').doc(String(id).replace(/\//g, '_'));
    var snap = await docRef.get();
    if (!snap.exists) return fail(new Error('Request not found'));
    var r = snap.data();
    var threadsSnap = await db.collection('RequestThreads').where('RequestID', '==', id).get();
    var threads = [];
    threadsSnap.forEach(function (t) { threads.push(t.data()); });
    threads.sort(function (a, b) { return (new Date(a.Timestamp || 0)).getTime() - (new Date(b.Timestamp || 0)).getTime(); });
    var request = {
      id: r.RequestID || id,
      type: r.Type,
      status: r.Status,
      requesterEmail: r.EmployeeEm,
      requesterName: r.EmployeeName,
      productName: r.ProductName,
      quantity: r.RequestedQty,
      unit: r.Unit,
      ingredients: safeJson(r.Formulaltems, []),
      packing: safeJson(r.Additionalltems, []),
      labels: safeJson(r.Labels, []),
      additionalItems: safeJson(r.AdditionalItems, []),
      corrections: safeJson(r.Corrections, []),
      notes: r.Notes,
      date: r.CreatedDate,
      currentStage: r.CurrentStage,
      managerEmail: r.ManagerEmail,
      batchId: r.BatchID,
      partialIssuedQty: r.PartialIssuedQty,
      thread: threads
    };
    return ok({ request: request });
  }

  function buildFormDataFromInventory(inv) {
    if (!inv) return { products: [], materials: [], rawMaterials: [], packingMaterials: [], labels: [] };
    var toItem = function (i) { return { id: i.id || i.name, name: i.name || i.itemName || String(i.id || ''), unit: i.unit || 'Units' }; };
    var raw = (inv.rawMaterials || []).map(toItem);
    var pack = (inv.packingMaterials || []).map(toItem);
    var lbl = (inv.labels || []).map(toItem);
    var prods = (inv.finishedGoods || inv.products || []).map(toItem);
    var materials = []
      .concat(raw.map(function (r) { return Object.assign({}, r, { category: 'raw' }); }))
      .concat(pack.map(function (p) { return Object.assign({}, p, { category: 'packing' }); }))
      .concat(lbl.map(function (l) { return Object.assign({}, l, { category: 'labels' }); }));
    return { products: prods, materials: materials, rawMaterials: raw, packingMaterials: pack, labels: lbl };
  }

  async function getFormData() {
    var products = [];
    var materials = [];
    var rawMaterials = [];
    var packingMaterials = [];
    var labels = [];
    var managers = [];

    var formSnap = await db.collection('FormCache').doc('latest').get();
    if (formSnap.exists) {
      var fc = formSnap.data();
      products = fc.products || [];
      materials = fc.materials || [];
      rawMaterials = fc.rawMaterials || [];
      packingMaterials = fc.packingMaterials || [];
      labels = fc.labels || [];
    }
    if (products.length === 0 && materials.length === 0) {
      var formCol = await db.collection('FormCache').limit(10).get();
      formCol.forEach(function (d) {
        if (products.length > 0 && materials.length > 0) return;
        if (d.id === '_empty' || d.id === 'latest') return;
        var fc2 = d.data();
        var p = fc2.products || [];
        var m = fc2.materials || [];
        if (p.length || m.length) {
          products = p;
          materials = m;
          rawMaterials = fc2.rawMaterials || [];
          packingMaterials = fc2.packingMaterials || [];
          labels = fc2.labels || [];
        }
      });
    }
    if (products.length === 0 && materials.length === 0) {
      var dbSnap = await db.collection('Database').doc('latest').get();
      if (dbSnap.exists) {
        var d = dbSnap.data();
        var payload = (d && d.data) ? d.data : d;
        var inv = (payload && payload.inventory) ? payload.inventory : payload;
        var built = buildFormDataFromInventory(inv);
        products = built.products;
        materials = built.materials;
        rawMaterials = built.rawMaterials;
        packingMaterials = built.packingMaterials;
        labels = built.labels;
      }
    }

    var dataSnap = await db.collection('Data').doc('latest').get();
    var employees = [];
    var departments = [];
    if (dataSnap.exists) {
      var dd = dataSnap.data();
      employees = dd.Employees || dd.employees || [];
      departments = dd.Departments || dd.departments || [];
    }
    var usersSnap = await db.collection('Users').get();
    usersSnap.forEach(function (d) {
      var u = d.data();
      if (!u.Role) return;
      var role = String(u.Role).toLowerCase();
      if (role.indexOf('manager') >= 0 || role.indexOf('admin') >= 0) managers.push({ name: u.Name, email: u.Email });
    });
    return ok({
      products: products,
      materials: materials,
      rawMaterials: rawMaterials,
      packingMaterials: packingMaterials,
      labels: labels,
      managers: managers,
      employees: employees,
      departments: departments,
      approvers: managers.map(function (m) { return m.name; })
    });
  }

  async function getLists() {
    var formData = await getFormData();
    if (formData.result !== 'success') return formData;
    return ok({ data: { products: formData.products, materials: formData.materials, rawMaterials: formData.rawMaterials, packingMaterials: formData.packingMaterials, labels: formData.labels, employees: formData.employees, departments: formData.departments, approvers: formData.approvers } });
  }

  async function getStageCounts() {
    var all = await getCollectionArray('Requisitions_V2');
    var counts = { PENDING_ISSUE: 0, WIP: 0, DISPATCH: 0, PENDING_RECORD: 0, PENDING_APPROVALS: 0, PARTIAL_ISSUE: 0, PENDING_DISPATCH_APPROVALS: 0, FORMULA_REQUESTS: 0, OVERDUE: 0, TODAY_ISSUED: 0 };
    var now = Date.now();
    var oneDayMs = 24 * 60 * 60 * 1000;
    var overdueThresholdMs = 3 * oneDayMs; // 3 days
    var todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    var todayStartMs = todayStart.getTime();
    all.forEach(function (r) {
      var status = (r.Status || r.status || '').toUpperCase();
      var cur = (r.CurrentStage || r.currentStage || '').toUpperCase();
      var created = r.CreatedDate || r.date || '';
      var createdMs = created ? new Date(created).getTime() : 0;
      var isPendingApproval = (cur.indexOf('PENDING MANAGER APPROVAL') >= 0 && (status === 'SUBMITTED' || status === 'PENDING')) || (status === 'ISSUED_PENDING_APPROVAL' && cur.indexOf('STORE ISSUED') >= 0);
      var isPendingIssue = cur.indexOf('AWAITING MATERIAL ISSUE') >= 0 || cur.indexOf('PENDING STORE') >= 0 || (status === 'APPROVED' && cur.indexOf('AWAITING') >= 0) || status === 'PARTIALLY_ISSUED';
      if (isPendingApproval) counts.PENDING_APPROVALS++;
      if (isPendingIssue) counts.PENDING_ISSUE++;
      if (cur.indexOf('MANUFACTURING') >= 0 || cur.indexOf('WIP') >= 0 || cur === 'PAUSED') counts.WIP++;
      if (cur.indexOf('AWAITING DISPATCH') >= 0 || status === 'PRODUCED') counts.DISPATCH++;
      if (cur.indexOf('AWAITING PRODUCTION RECORDING') >= 0) counts.PENDING_RECORD++;
      if (status === 'PARTIALLY_ISSUED') counts.PARTIAL_ISSUE++;
      if ((isPendingApproval || isPendingIssue) && createdMs && (now - createdMs > overdueThresholdMs)) counts.OVERDUE++;
      if (status === 'ISSUED' && (r.IssuedAt || r.UpdatedDate)) {
        var upd = new Date(r.IssuedAt || r.UpdatedDate).getTime();
        if (upd >= todayStartMs) counts.TODAY_ISSUED++;
      }
    });
    var dispSnap = await db.collection('RequisitionDispatches').get();
    dispSnap.forEach(function (d) {
      var x = d.data();
      if ((x.Status || '').toLowerCase() === 'pending') counts.PENDING_DISPATCH_APPROVALS++;
    });
    var formulaSnap = await db.collection('FormulaRequests').get();
    formulaSnap.forEach(function (d) {
      if ((d.data().Status || '').toLowerCase() === 'pending') counts.FORMULA_REQUESTS++;
    });
    return ok({ counts: counts });
  }

  async function submitRequest(params) {
    var newId = 'REQ-' + Date.now();
    var docRef = db.collection('Requisitions_V2').doc(newId);
    var type = String(params.type || 'Production').trim();
    var email = String(params.requesterEmail || params.employeeEmail || '').toLowerCase().trim();
    var name = String(params.requesterName || params.employeeName || '').trim();
    var requestedQty = params.requestedQty != null ? Number(params.requestedQty) : (params.quantity != null ? Number(params.quantity) : 0);
    if (typeof requestedQty !== 'number' || isNaN(requestedQty) || requestedQty < 0) requestedQty = 0;
    var toStr = function (x) {
      if (x == null || x === undefined) return '';
      if (typeof x === 'string') return x;
      try { return JSON.stringify(x); } catch (e) { return ''; }
    };
    var notes = String(params.notes || params.remarks || '');
    if (params.purpose != null && String(params.purpose).trim() !== '') notes = String(params.purpose).trim() + (notes ? '\n' + notes : '');
    var payload = {
      RequestID: newId,
      Type: type,
      Status: 'SUBMITTED',
      EmployeeEm: email,
      EmployeeName: name,
      ProductName: String(params.productName || ''),
      RequestedQty: requestedQty,
      Formulaltems: toStr(params.ingredients || params.formulaItems) || '[]',
      Additionalltems: toStr(params.packing || params.packingItems) || '[]',
      ManagerEmail: String(params.managerEmail || '').toLowerCase().trim(),
      CreatedDate: new Date().toISOString(),
      Unit: String(params.unit || ''),
      Labels: toStr(params.labels) || '[]',
      Notes: notes,
      CurrentStage: type.toLowerCase() === 'research' ? 'Pending Store & Manager' : 'Pending Manager Approval',
      AdditionalItems: toStr(params.additionalItems || params.items) || '[]',
      Corrections: '[]',
      BatchID: '',
      PartialIssuedQty: 0
    };
    var safe = {};
    for (var k in payload) {
      if (!Object.prototype.hasOwnProperty.call(payload, k)) continue;
      var v = payload[k];
      if (typeof v === 'string') safe[k] = v;
      else if (typeof v === 'number' && v === v && v !== Infinity && v !== -Infinity) safe[k] = v;
      else if (v === null || v === undefined) safe[k] = '';
      else safe[k] = String(v);
    }
    await docRef.set(safe);
    await pushNotificationQueue('approval_needed', {
      requestId: newId,
      managerEmail: (payload.ManagerEmail || '').toString().trim(),
      productName: payload.ProductName || '',
      requesterName: payload.EmployeeName || '',
      requesterEmail: payload.EmployeeEm || '',
      requestedQty: payload.RequestedQty,
      unit: payload.Unit || '',
      requestedAt: payload.CreatedDate || new Date().toISOString()
    });
    logRequestToReminderSheet(payload.EmployeeEm || '', payload.EmployeeName || '');
    return ok({ requestId: newId });
  }

  async function updateRequestStage(params) {
    var id = params.id;
    if (!id) return fail(new Error('No id'));
    var docRef = db.collection('Requisitions_V2').doc(String(id).replace(/\//g, '_'));
    var snap = await docRef.get();
    if (!snap.exists) return fail(new Error('Request not found'));
    var updates = {};
    var stageAction = (params.stageAction || '').toUpperCase();
    if (stageAction === 'ISSUE') {
      var data = snap.data();
      var currentStatus = (data.Status || data.status || '').toUpperCase();
      var currentStage = (data.CurrentStage || data.currentStage || '').toUpperCase();
      if ((currentStatus === 'SUBMITTED' || currentStatus === 'PENDING') && currentStage.indexOf('PENDING MANAGER APPROVAL') >= 0) {
        // Option B: Store issued first – materials go to RESERVED until Manager approves
        updates.Status = 'ISSUED_PENDING_APPROVAL';
        updates.CurrentStage = 'Awaiting Manager Approval (Store Issued)';
        try { await upsertRequisitionReservation(id, data, 'reserved'); } catch (e) { /* non-fatal */ }
      } else {
        // Option A: Manager already approved – deduct from inventory and move to WIP
        var deductResult = await deductInventoryForRequisition(id, data);
        if (deductResult.result !== 'success') {
          return deductResult;
        }
        updates.Status = 'ISSUED';
        updates.CurrentStage = 'Material Issued / WIP';
        updates.IssuedAt = new Date().toISOString();
        var resRef = db.collection('RequisitionReservations').doc(String(id).replace(/\//g, '_'));
        var resSnap = await resRef.get();
        if (resSnap.exists) {
          await resRef.update({ status: 'consumed', updatedAt: new Date().toISOString() });
        }
      }
    } else if (stageAction === 'RECORD') {
      updates.Status = 'ISSUED';
      updates.CurrentStage = 'Manufacturing / WIP';
    } else if (params.stageAction === 'PARTIAL_ISSUE' && params.partialQty != null) {
      var partialQty = parseFloat(params.partialQty);
      updates.PartialIssuedQty = partialQty;
      updates.Status = 'PARTIALLY_ISSUED';
      updates.CurrentStage = 'Partially Issued – remaining to issue';
    }
    if (params.stage) updates.CurrentStage = params.stage;
    if (params.status) updates.Status = params.status;
    if (Object.keys(updates).length) {
      await docRef.update(updates);
      await auditLog('requisition_stage', params.user || params.email || 'user', { requestId: id, stageAction: params.stageAction || params.stage, newStatus: updates.Status });
      if (updates.Status === 'ISSUED') {
        var d = snap.data();
        try {
          pushNotificationQueue('materials_issued', {
            requestId: id,
            requesterEmail: (d.EmployeeEm || d.requesterEmail || '').trim(),
            productName: d.ProductName || d.productName || '',
            quantity: d.RequestedQty != null ? d.RequestedQty : d.quantity,
            unit: d.Unit || d.unit || '',
            issuedBy: params.user || params.email || 'Store'
          });
        } catch (e) { console.warn('materials_issued email:', e); }
      }
      if (updates.Status === 'PARTIALLY_ISSUED') {
        var d2 = snap.data();
        var partialQtyNum = updates.PartialIssuedQty != null ? updates.PartialIssuedQty : parseFloat(params.partialQty);
        try {
          pushNotificationQueue('partial_issued', {
            requestId: id,
            requesterEmail: (d2.EmployeeEm || d2.requesterEmail || '').trim(),
            productName: d2.ProductName || d2.productName || '',
            partialQty: partialQtyNum,
            requestedQty: d2.RequestedQty != null ? d2.RequestedQty : d2.quantity,
            unit: d2.Unit || d2.unit || '',
            issuedBy: params.user || params.email || 'Store'
          });
        } catch (e) { console.warn('partial_issued email:', e); }
      }
    }
    return ok({ newStatus: updates.Status });
  }

  async function addThreadNote(params) {
    var id = params.id;
    if (!id) return fail(new Error('No id'));
    var col = db.collection('RequestThreads');
    await col.add({
      RequestID: id,
      Timestamp: new Date().toISOString(),
      Actor: params.role || 'User',
      Action: 'NOTE',
      User: params.user || '',
      Remarks: params.note || ''
    });
    return ok({});
  }

  async function addMaterialRequest(params) {
    var id = params.id;
    if (!id) return fail(new Error('No id'));
    var docRef = db.collection('Requisitions_V2').doc(String(id).replace(/\//g, '_'));
    var snap = await docRef.get();
    if (!snap.exists) return fail(new Error('Request not found'));
    var add = safeJson(snap.data().AdditionalItems, []);
    if (!Array.isArray(add)) add = [];
    add.push({ category: params.category, itemName: params.itemName, quantity: parseFloat(params.quantity) || 0 });
    await docRef.update({ AdditionalItems: JSON.stringify(add) });
    return ok({});
  }

  async function actionRequest(params, action) {
    var id = params.id;
    if (!id) return fail(new Error('No id'));
    var docRef = db.collection('Requisitions_V2').doc(String(id).replace(/\//g, '_'));
    var snap = await docRef.get();
    if (!snap.exists) return fail(new Error('Request not found'));
    var data = snap.data();
    var currentStatus = (data.Status || data.status || '').toUpperCase();
    var status = action === 'APPROVED' ? 'APPROVED' : action === 'REJECTED' ? 'REJECTED' : action === 'ON_HOLD' ? 'ON_HOLD' : action === 'APPROVE_PARTIAL' ? 'APPROVE_PARTIAL' : 'ON_HOLD';
    var stage = data.CurrentStage || data.currentStage || '';
    if (action === 'APPROVED') {
      if (currentStatus === 'ISSUED_PENDING_APPROVAL') {
        // Option B: Store issued first – Manager approval deducts materials and moves to WIP
        status = 'ISSUED';
        stage = 'Material Issued / WIP';
      } else {
        stage = 'Awaiting Material Issue';
      }
    }
    if (action === 'REJECTED') stage = 'Rejected';
    if (action === 'ON_HOLD') stage = 'On Hold';
    var updatePayload = { Status: status, CurrentStage: stage };
    if (status === 'ISSUED') updatePayload.IssuedAt = new Date().toISOString();
    if (currentStatus === 'ISSUED_PENDING_APPROVAL' && action === 'APPROVED') {
      var deductResult = await deductInventoryForRequisition(id, data);
      if (deductResult.result !== 'success') {
        return deductResult;
      }
    }
    await docRef.update(updatePayload);
    if (currentStatus === 'ISSUED_PENDING_APPROVAL') {
      var resRef = db.collection('RequisitionReservations').doc(String(id).replace(/\//g, '_'));
      var resSnap = await resRef.get();
      if (resSnap.exists) {
        await resRef.update({ status: action === 'APPROVED' ? 'consumed' : 'released', updatedAt: new Date().toISOString() });
      }
      if (action === 'APPROVED' && status === 'ISSUED') {
        try {
          pushNotificationQueue('materials_issued', {
            requestId: id,
            requesterEmail: (data.EmployeeEm || data.requesterEmail || '').trim(),
            productName: data.ProductName || data.productName || '',
            quantity: data.RequestedQty != null ? data.RequestedQty : data.quantity,
            unit: data.Unit || data.unit || '',
            issuedBy: params.user || params.email || 'Manager'
          });
        } catch (e) { console.warn('materials_issued email:', e); }
      }
    } else if (action === 'APPROVED') {
      // Manager approved first – reserve stock until Store issues
      try { await upsertRequisitionReservation(id, data, 'reserved'); } catch (e) { /* non-fatal */ }
      try {
        await pushNotificationQueue('request_approved', {
          requestId: id,
          requesterEmail: (data.EmployeeEm || data.requesterEmail || '').trim(),
          requesterName: (data.EmployeeName || data.requesterName || '').trim(),
          productName: data.ProductName || data.productName || '',
          quantity: data.RequestedQty != null ? data.RequestedQty : data.quantity,
          unit: data.Unit || data.unit || '',
          approvedBy: params.user || params.email || 'Manager'
        });
      } catch (e) { console.warn('request_approved email:', e); }
    }
    if (action === 'REJECTED') {
      try {
        await pushNotificationQueue('request_rejected', {
          requestId: id,
          requesterEmail: (data.EmployeeEm || data.requesterEmail || '').trim(),
          requesterName: (data.EmployeeName || data.requesterName || '').trim(),
          productName: data.ProductName || data.productName || '',
          quantity: data.RequestedQty != null ? data.RequestedQty : data.quantity,
          unit: data.Unit || data.unit || '',
          rejectedBy: params.user || params.email || 'Manager',
          reason: (params.reason || '').trim() || '—'
        });
      } catch (e) { console.warn('request_rejected email:', e); }
    }
    if (action === 'ON_HOLD') {
      try {
        await pushNotificationQueue('request_on_hold', {
          requestId: id,
          requesterEmail: (data.EmployeeEm || data.requesterEmail || '').trim(),
          requesterName: (data.EmployeeName || data.requesterName || '').trim(),
          productName: data.ProductName || data.productName || '',
          quantity: data.RequestedQty != null ? data.RequestedQty : data.quantity,
          unit: data.Unit || data.unit || '',
          heldBy: params.user || params.email || 'Manager',
          reason: (params.reason || '').trim() || '—'
        });
      } catch (e) { console.warn('request_on_hold email:', e); }
    }
    await auditLog('requisition_' + (action === 'APPROVED' ? 'approve' : action === 'REJECTED' ? 'reject' : 'hold'), params.user || params.email || 'user', { requestId: id, action: action });
    return ok({});
  }

  async function getMyRequests(params) {
    var email = (params.email || '').toLowerCase().trim();
    var all = await getCollectionArray('Requisitions_V2');
    var mine = all.filter(function (r) { return (r.EmployeeEm || r.requesterEmail || '').toLowerCase().trim() === email; });
    var light = params.light === '1' || params.light === true;
    var requests = mine.map(function (d) { return rowToRequest(d, light); });
    return ok({ requests: requests });
  }

  async function getPendingApprovals(params) {
    return getRequestsByStage({ stage: 'PENDING_APPROVALS', limit: 100, light: true });
  }

  async function getMaterialQueue() {
    var q = await getCollectionArray('Material_Requisition_Queue');
    return ok({ queue: q, requests: q });
  }

  async function getWipBatches() {
    var batches = await getCollectionArray('WIP_Batches');
    return ok({ batches: batches });
  }

  async function getPendingProduction() {
    var batches = await getCollectionArray('WIP_Batches');
    var pending = batches.filter(function (b) { return (b.Status || b.status || '').toLowerCase() !== 'completed'; });
    return ok({ pending: pending });
  }

  async function getStockAdjustmentRequests(params) {
    var all = await getCollectionArray('StockAdjustmentRequests');
    var status = (params.status || '').toLowerCase();
    var list = status ? all.filter(function (r) { return (r.Status || '').toLowerCase() === status; }) : all;
    return ok({ requests: list });
  }

  async function markStockAdjustmentDone(params) {
    var id = params.requestId;
    if (!id) return fail(new Error('No requestId'));
    var docRef = db.collection('StockAdjustmentRequests').doc(String(id).replace(/\//g, '_'));
    await docRef.update({ Status: 'Done', DoneBy: params.doneBy || '', DoneAt: new Date().toISOString() });
    return ok({});
  }

  async function getPendingDispatchApprovals() {
    var all = await getCollectionArray('RequisitionDispatches');
    var pending = all.filter(function (d) {
      var s = (d.Status || '').toLowerCase();
      return s === 'pending' || s === 'pending_approval';
    });
    return ok({ data: pending });
  }

  async function getDispatchesForRequest(params) {
    var requestId = params.requestId;
    var snap = await db.collection('RequisitionDispatches').where('RequestID', '==', requestId).get();
    var list = [];
    snap.forEach(function (d) { list.push(d.data()); });
    return ok({ dispatches: list });
  }

  async function getUserRole(emailOrUid) {
    if (!emailOrUid) return '';
    var ref = db.collection('Users').doc(String(emailOrUid).trim());
    var snap = await ref.get();
    if (!snap.exists) {
      if (emailOrUid.indexOf('@') >= 0) {
        ref = db.collection('Users').doc(String(emailOrUid).toLowerCase().trim().replace(/\//g, '_'));
        snap = await ref.get();
        if (!snap.exists) return '';
      } else return '';
    }
    return String(snap.data().Role || '').trim();
  }

  async function hasRole(identifier, allowedRoles) {
    var role = (await getUserRole(identifier) || '').toLowerCase();
    var allowed = (allowedRoles || []).map(function (x) { return String(x).toLowerCase(); });
    return allowed.some(function (a) { return role.indexOf(a) >= 0; });
  }

  function adminIdentifier(params) {
    return params.adminUid || params.uid || (params.adminEmail || params.email || '').toLowerCase().trim() || null;
  }

  async function changePassword(params) {
    var email = (params.email || '').toLowerCase().trim();
    var currentPassword = params.currentPassword || params.current_password || '';
    var newPassword = params.newPassword || params.new_password || '';
    if (!email || !currentPassword || !newPassword) return fail(new Error('Email, current password and new password required'));
    if (newPassword.length < 4) return fail(new Error('New password must be at least 4 characters'));
    var docRef = db.collection('Users').doc(email.replace(/\//g, '_'));
    var snap = await docRef.get();
    if (!snap.exists) return fail(new Error('User not found'));
    var u = snap.data();
    var stored = (u.PasswordHash || '').trim();
    if (!stored) return fail(new Error('Cannot change password'));
    var combinedCurrent = String(currentPassword) + email;
    var hashedCurrent = await sha256(combinedCurrent);
    var match = (stored === hashedCurrent) || (/^[a-f0-9]{64}$/i.test(stored) === false && stored === String(currentPassword).trim());
    if (!match) return fail(new Error('Current password is incorrect'));
    var combinedNew = String(newPassword) + email;
    var hashedNew = await sha256(combinedNew);
    await docRef.update({ PasswordHash: hashedNew });
    return ok({ message: 'Password updated' });
  }

  async function addUser(params) {
    var adminId = adminIdentifier(params);
    if (!adminId) return fail(new Error('Admin email or UID required'));
    var allowed = await hasRole(adminId, ['Manager', 'Admin']);
    if (!allowed) return fail(new Error('Only Manager or Admin can add users'));
    var email = (params.newUserEmail || params.userEmail || '').toLowerCase().trim();
    var name = (params.name || params.newUserName || '').trim();
    var role = (params.role || 'Employee').trim();
    var defaultPassword = params.defaultPassword || params.password || '';
    if (!email) return fail(new Error('User email required'));
    if (!defaultPassword) return fail(new Error('Default password required'));
    if (defaultPassword.length < 4) return fail(new Error('Default password must be at least 4 characters'));
    var docId = email.replace(/\//g, '_');
    var docRef = db.collection('Users').doc(docId);
    var snap = await docRef.get();
    if (snap.exists) return fail(new Error('A user with this email already exists'));
    var combined = String(defaultPassword) + email;
    var hashed = await sha256(combined);
    await docRef.set({
      Email: email,
      Name: name || email,
      Role: role || 'Employee',
      PasswordHash: hashed,
      Department: params.department || '',
      CreatedBy: adminId,
      CreatedAt: new Date().toISOString()
    });
    return ok({ message: 'User added. They can log in with this email and the default password, then change it.' });
  }

  async function listUsers(params) {
    var adminId = adminIdentifier(params);
    if (!adminId) return fail(new Error('Admin email or UID required'));
    var allowed = await hasRole(adminId, ['Manager', 'Admin']);
    if (!allowed) return fail(new Error('Only Manager or Admin can list users'));
    var snap = await db.collection('Users').get();
    var list = [];
    snap.forEach(function (d) {
      if (d.id === '_empty') return;
      var u = d.data();
      list.push({ uid: d.id, email: u.Email || d.id, name: u.Name || '', role: u.Role || '', department: u.Department || '' });
    });
    return ok({ users: list });
  }

  async function deleteUser(params) {
    var adminId = adminIdentifier(params);
    if (!adminId) return fail(new Error('Admin email or UID required'));
    var allowed = await hasRole(adminId, ['Manager', 'Admin']);
    if (!allowed) return fail(new Error('Only Manager or Admin can delete users'));
    var targetId = (params.userEmail || params.targetEmail || params.targetUid || '').toString().trim();
    if (!targetId) return fail(new Error('User email or UID to delete is required'));
    if (targetId === adminId) return fail(new Error('You cannot delete your own account'));
    var docRef = db.collection('Users').doc(targetId.indexOf('@') >= 0 ? targetId.toLowerCase().replace(/\//g, '_') : targetId);
    var snap = await docRef.get();
    if (!snap.exists) return fail(new Error('User not found'));
    await docRef.delete();
    return ok({ message: 'User removed. They can no longer log in.' });
  }

  async function generateReport(params) {
    var startStr = (params.startDate || '').toString().trim();
    var endStr = (params.endDate || '').toString().trim();
    if (!startStr || !endStr) return fail(new Error('startDate and endDate required'));
    var start = new Date(startStr);
    var end = new Date(endStr);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) return fail(new Error('Invalid dates'));
    var snap = await db.collection('Database').doc('latest').get();
    var transactions = [];
    if (snap.exists) {
      var d = snap.data();
      var payload = (d && d.data) ? d.data : d;
      if (payload && Array.isArray(payload.transactions)) transactions = payload.transactions;
      else if (payload && payload.inventory) transactions = payload.transactions || [];
    }
    var byType = {};
    var byItem = {};
    var totalQty = 0;
    var rowCount = 0;
    transactions.forEach(function (tx) {
      var txDate = (tx.date || tx.Date || '').toString().split('T')[0];
      if (!txDate || txDate < startStr || txDate > endStr) return;
      rowCount++;
      var type = tx.type || tx.Type || 'unknown';
      byType[type] = (byType[type] || 0) + (parseFloat(tx.quantity) || 0);
      var itemName = tx.itemName || tx.ItemName || tx.category || type;
      byItem[itemName] = (byItem[itemName] || 0) + (parseFloat(tx.quantity) || 0);
      totalQty += parseFloat(tx.quantity) || 0;
    });
    return ok({
      result: 'success',
      byType: byType,
      byItem: byItem,
      dateRange: { start: startStr, end: endStr },
      rowCount: rowCount,
      totalQty: totalQty
    });
  }

  async function notifyStockArrival(params) {
    return ok({ result: 'success', requestCount: 0 });
  }

  async function saveWipBatch(params) {
    var batchId = (params.batchId || params.batchNo || params.id || '').toString().trim();
    if (!batchId) return fail(new Error('batchId or batchNo required'));
    var linkedReqId = (params.linkedReqId || params.requestId || params.reqId || '').toString().trim();
    var docId = batchId.replace(/\//g, '_');
    var ref = db.collection('WIP_Batches').doc(docId);
    var payload = {
      id: batchId,
      batchId: batchId,
      batchNo: batchId,
      status: (params.status || 'started').toString().toLowerCase(),
      productName: params.productName || params.itemName || '',
      itemName: params.itemName || params.productName || '',
      targetQty: parseFloat(params.targetQty) || 0,
      unit: params.unit || '',
      updatedAt: new Date().toISOString()
    };
    if (linkedReqId) {
      payload.linkedReqId = linkedReqId;
      payload.requestId = linkedReqId;
      payload.reqId = linkedReqId;
    }
    if (params.formulaId != null) payload.formulaId = params.formulaId;
    if (params.productionSlipId != null) payload.productionSlipId = params.productionSlipId;
    await ref.set(payload, { merge: true });
    if (linkedReqId) {
      var reqRef = db.collection('Requisitions_V2').doc(String(linkedReqId).replace(/\//g, '_'));
      var reqSnap = await reqRef.get();
      if (reqSnap.exists) {
        await reqRef.update({ BatchID: batchId, CurrentStage: 'Manufacturing / WIP' });
      }
    }
    return ok({ message: 'WIP batch saved', batchId: batchId });
  }

  async function syncWipToReq(params) {
    var batchId = params.batchId || params.batchNo || '';
    var status = (params.status || '').toLowerCase();
    var reason = (params.reason || '').trim();
    if (!batchId) return fail(new Error('batchId required'));
    var all = await getCollectionArray('WIP_Batches');
    var batch = all.find(function (b) { return (b.id || b.batchId || b.batchNo || b._id) == batchId; });
    if (!batch) return ok({ message: 'Batch not found or already synced' });
    var docId = (batch._id || batchId).toString().replace(/\//g, '_');
    var ref = db.collection('WIP_Batches').doc(docId);
    var up = { status: status || 'paused', updatedAt: new Date().toISOString() };
    if (reason) up.reason = reason;
    await ref.update(up);
    var linkedReqId = batch.linkedReqId || batch.requestId || batch.reqId;
    if (linkedReqId) {
      var reqRef = db.collection('Requisitions_V2').doc(String(linkedReqId).replace(/\//g, '_'));
      var reqSnap = await reqRef.get();
      if (reqSnap.exists) {
        var reqData = reqSnap.data();
        if (status === 'completed') {
          await reqRef.update({
            Status: 'PRODUCED',
            CurrentStage: 'Awaiting Dispatch',
            ProducedAt: new Date().toISOString()
          });
          await pushNotificationQueue('production_completed', {
            requestId: linkedReqId,
            requesterEmail: (reqData.EmployeeEm || reqData.requesterEmail || '').trim(),
            requesterName: (reqData.EmployeeName || reqData.requesterName || '').trim(),
            productName: reqData.ProductName || '',
            quantity: reqData.RequestedQty != null ? reqData.RequestedQty : reqData.quantity,
            unit: reqData.Unit || '',
            completedBy: (params.userEmail || params.email || '').trim() || 'WIP sync'
          });
        } else if (status === 'paused') {
          await pushNotificationQueue('production_paused', {
            requestId: linkedReqId,
            requesterEmail: (reqData.EmployeeEm || reqData.requesterEmail || '').trim(),
            requesterName: (reqData.EmployeeName || reqData.requesterName || '').trim(),
            productName: reqData.ProductName || '',
            quantity: reqData.RequestedQty != null ? reqData.RequestedQty : reqData.quantity,
            unit: reqData.Unit || '',
            pausedBy: (params.userEmail || params.email || '').trim() || 'WIP sync',
            reason: reason || ''
          });
        }
      }
    }
    return ok({ message: 'Synced' });
  }

  async function markUsed(params) {
    var id = params.id || params.slipId || '';
    var items = params.items || '[]';
    if (!id) return ok({ result: 'success' });
    try {
      var itemsArr = typeof items === 'string' ? JSON.parse(items) : items;
      await db.collection('ConsumedSlips').doc(String(id).replace(/\//g, '_')).set({
        id: id,
        items: itemsArr,
        consumedAt: new Date().toISOString(),
        context: params.context || ''
      });
    } catch (e) {}
    return ok({ result: 'success' });
  }

  async function adminSetPassword(params) {
    var adminId = adminIdentifier(params);
    if (!adminId) return fail(new Error('Admin email or UID required'));
    var allowed = await hasRole(adminId, ['Manager', 'Admin']);
    if (!allowed) return fail(new Error('Only Manager or Admin can reset passwords'));
    var targetEmail = (params.targetEmail || params.userEmail || '').toLowerCase().trim();
    var newPassword = params.newPassword || params.password || '';
    if (!targetEmail) return fail(new Error('Target user email required'));
    if (!newPassword || newPassword.length < 4) return fail(new Error('New password must be at least 4 characters'));
    var docRef = db.collection('Users').doc(targetEmail.replace(/\//g, '_'));
    var snap = await docRef.get();
    if (!snap.exists) return fail(new Error('User not found'));
    var combined = String(newPassword) + targetEmail;
    var hashed = await sha256(combined);
    await docRef.update({ PasswordHash: hashed });
    return ok({ message: 'Password updated. User can log in with the new password.' });
  }

  async function requestDispatch(params) {
    var requestId = params.requestId || params.id;
    var productName = params.productName || '';
    var qty = parseFloat(params.quantity || params.qty || 0);
    var unit = params.unit || '';
    var requestedBy = params.user || 'Store';
    var remarks = params.remarks || '';
    if (!requestId || !productName || qty <= 0) return fail(new Error('Request ID, product name and quantity required'));
    var reqRef = db.collection('Requisitions_V2').doc(String(requestId).replace(/\//g, '_'));
    var reqSnap = await reqRef.get();
    if (!reqSnap.exists) return fail(new Error('Request not found'));
    var reqData = reqSnap.data();
    var status = (reqData.Status || '').toUpperCase();
    if (status !== 'PRODUCED') return fail(new Error('Only produced batches can be dispatched'));
    var dispatchId = 'DSP-' + Date.now();
    await db.collection('RequisitionDispatches').doc(dispatchId).set({
      DispatchID: dispatchId,
      RequestID: requestId,
      BatchID: reqData.BatchID || '',
      ProductName: productName,
      Quantity: qty,
      Unit: unit || reqData.Unit || '',
      Status: 'PENDING_APPROVAL',
      RequestedBy: requestedBy,
      RequestedAt: new Date().toISOString(),
      ApprovedBy: '',
      ApprovedAt: null,
      MainInvSynced: 'N',
      Remarks: remarks
    });
    await pushNotificationQueue('dispatch_approval_required', {
      dispatchId: dispatchId,
      requestId: requestId,
      productName: productName,
      quantity: qty,
      unit: unit || reqData.Unit || '',
      requestedBy: requestedBy
    });
    return ok({ dispatchId: dispatchId, message: 'Dispatch request submitted for manager approval' });
  }

  async function approveDispatch(params) {
    var dispatchId = params.dispatchId || params.id;
    var approvedBy = params.user || 'Manager';
    if (!dispatchId) return fail(new Error('Dispatch ID required'));
    var approverId = adminIdentifier(params) || (params.email || '').toLowerCase().trim();
    var allowed = await hasRole(approverId, ['Manager', 'Admin']);
    if (!allowed) return fail(new Error('Only Manager or Admin can approve dispatch'));
    var docRef = db.collection('RequisitionDispatches').doc(String(dispatchId).replace(/\//g, '_'));
    var snap = await docRef.get();
    if (!snap.exists) return fail(new Error('Dispatch not found'));
    var d = snap.data();
    if ((d.Status || '').toUpperCase() === 'APPROVED') return fail(new Error('Dispatch already approved'));
    await docRef.update({
      Status: 'APPROVED',
      ApprovedBy: approvedBy,
      ApprovedAt: new Date().toISOString(),
      MainInvSynced: 'Y'
    });
    var requestId = d.RequestID || '';
    var requesterEmail = '';
    if (requestId) {
      var reqSnap = await db.collection('Requisitions_V2').doc(String(requestId).replace(/\//g, '_')).get();
      if (reqSnap.exists) requesterEmail = (reqSnap.data().EmployeeEm || reqSnap.data().requesterEmail || '').trim();
    }
    await pushNotificationQueue('dispatch_approved', {
      requestId: requestId,
      requesterEmail: requesterEmail,
      productName: d.ProductName || '',
      quantity: d.Quantity,
      unit: d.Unit || '',
      approvedBy: approvedBy
    });
    return ok({ message: 'Dispatch approved' });
  }

  async function confirmFormula(params) {
    var id = params.id;
    if (!id) return fail(new Error('No id'));
    var ref = db.collection('Requisitions_V2').doc(String(id).replace(/\//g, '_'));
    var snap = await ref.get();
    if (!snap.exists) return fail(new Error('Request not found'));
    await ref.update({ CurrentStage: 'Awaiting Material Issue' });
    return ok({});
  }

  async function requestCorrection(params) {
    var id = params.id;
    if (!id) return fail(new Error('No id'));
    var ref = db.collection('Requisitions_V2').doc(String(id).replace(/\//g, '_'));
    var snap = await ref.get();
    if (!snap.exists) return fail(new Error('Request not found'));
    var data = snap.data();
    var corrections = params.corrections || params.summary || '[]';
    if (typeof corrections !== 'string') corrections = JSON.stringify(corrections);
    await ref.update({
      Status: 'CORRECTION_REQUIRED',
      CurrentStage: 'Awaiting Manager Re-approval',
      Corrections: corrections
    });
    try {
      pushNotificationQueue('correction_requested', {
        requestId: id,
        productName: data.ProductName || data.productName || '',
        requestedBy: data.EmployeeName || data.requesterName || params.user || '',
        requestedByEmail: data.EmployeeEm || data.requesterEmail || '',
        summary: (typeof params.summary === 'string' ? params.summary : '') || 'Ingredient correction requested'
      });
    } catch (e) { console.warn('correction_requested email:', e); }
    return ok({});
  }

  async function updateRequestPackingLabels(params) {
    var id = params.id || params.requestId;
    if (!id) return fail(new Error('No id'));
    var ref = db.collection('Requisitions_V2').doc(String(id).replace(/\//g, '_'));
    var snap = await ref.get();
    if (!snap.exists) return fail(new Error('Request not found'));
    var up = {};
    if (params.packing != null) up.Additionalltems = typeof params.packing === 'string' ? params.packing : JSON.stringify(params.packing || []);
    if (params.labels != null) up.Labels = typeof params.labels === 'string' ? params.labels : JSON.stringify(params.labels || []);
    if (Object.keys(up).length) await ref.update(up);
    return ok({});
  }

  async function wipActionRequisition(params) {
    var id = params.id;
    var action = (params.wipAction || '').toUpperCase();
    var reason = params.reason || '';
    var userEmail = (params.email || '').toLowerCase().trim();
    if (!id) return fail(new Error('No id'));
    var ref = db.collection('Requisitions_V2').doc(String(id).replace(/\//g, '_'));
    var snap = await ref.get();
    if (!snap.exists) return fail(new Error('Requisition not found'));
    var reqData = snap.data();
    var currentStatus = (reqData.Status || '').toUpperCase();
    if (currentStatus === 'COMPLETED' || currentStatus === 'CANCELLED') return fail(new Error('Request is already finalized'));
    var updates = {};
    if (action === 'PAUSE') {
      updates.CurrentStage = 'PAUSED';
      await pushNotificationQueue('production_paused', {
        requestId: id,
        requesterEmail: (reqData.EmployeeEm || reqData.requesterEmail || '').trim(),
        requesterName: (reqData.EmployeeName || reqData.requesterName || '').trim(),
        productName: reqData.ProductName || '',
        quantity: reqData.RequestedQty != null ? reqData.RequestedQty : reqData.quantity,
        unit: reqData.Unit || '',
        pausedBy: userEmail || '',
        reason: reason || ''
      });
    } else if (action === 'COMPLETE') {
      updates.Status = 'COMPLETED';
      updates.CurrentStage = 'Production Completed';
      await pushNotificationQueue('production_completed', {
        requestId: id,
        requesterEmail: (reqData.EmployeeEm || reqData.requesterEmail || '').trim(),
        requesterName: (reqData.EmployeeName || reqData.requesterName || '').trim(),
        productName: reqData.ProductName || '',
        quantity: reqData.RequestedQty != null ? reqData.RequestedQty : reqData.quantity,
        unit: reqData.Unit || '',
        completedBy: userEmail || ''
      });
    } else if (action === 'CANCEL') {
      updates.Status = 'CANCELLED';
      updates.CurrentStage = 'Cancelled';
      await pushNotificationQueue('production_cancelled', {
        requestId: id,
        requesterEmail: (reqData.EmployeeEm || reqData.requesterEmail || '').trim(),
        requesterName: (reqData.EmployeeName || reqData.requesterName || '').trim(),
        productName: reqData.ProductName || '',
        quantity: reqData.RequestedQty != null ? reqData.RequestedQty : reqData.quantity,
        unit: reqData.Unit || '',
        cancelledBy: userEmail || '',
        reason: reason || ''
      });
    } else {
      return fail(new Error('Invalid wipAction: use PAUSE, COMPLETE, or CANCEL'));
    }
    await ref.update(updates);
    var batchId = reqData.BatchID;
    if (batchId) {
      var wipRef = db.collection('WIP_Batches').doc(String(batchId).replace(/\//g, '_'));
      var wipSnap = await wipRef.get();
      if (wipSnap.exists) {
        await wipRef.update({ Status: action === 'COMPLETE' ? 'completed' : action === 'CANCEL' ? 'cancelled' : 'paused' });
      }
    }
    return ok({});
  }

  async function editRequestItem(params) {
    var id = params.id;
    var itemName = params.itemName;
    var newQty = parseFloat(params.quantity);
    var userEmail = (params.email || '').toLowerCase().trim();
    if (!id || !itemName || isNaN(newQty)) return fail(new Error('id, itemName and quantity required'));
    var ref = db.collection('Requisitions_V2').doc(String(id).replace(/\//g, '_'));
    var snap = await ref.get();
    if (!snap.exists) return fail(new Error('Request not found'));
    var d = snap.data();
    if ((d.EmployeeEm || '').toLowerCase().trim() !== userEmail) return fail(new Error('Only the requester can edit items'));
    var status = (d.Status || '').toUpperCase();
    if (status !== 'SUBMITTED' && status !== 'CORRECTION_REQUIRED') return fail(new Error('Items cannot be edited after approval'));
    var ingredients = safeJson(d.Formulaltems, []);
    var addItems = safeJson(d.AdditionalItems, []);
    function editFn(item) {
      if (item && (item.name === itemName || item.itemName === itemName)) {
        item.quantity = item.qty = newQty;
      }
      return item;
    }
    var newIngredients = ingredients.map(editFn);
    var newAddItems = addItems.map(editFn);
    await ref.update({
      Formulaltems: JSON.stringify(newIngredients),
      AdditionalItems: JSON.stringify(newAddItems)
    });
    return ok({ message: 'Item updated' });
  }

  async function deleteRequestItem(params) {
    var id = params.id;
    var itemName = params.itemName;
    var userEmail = (params.email || '').toLowerCase().trim();
    if (!id || !itemName) return fail(new Error('id and itemName required'));
    var ref = db.collection('Requisitions_V2').doc(String(id).replace(/\//g, '_'));
    var snap = await ref.get();
    if (!snap.exists) return fail(new Error('Request not found'));
    var d = snap.data();
    if ((d.EmployeeEm || '').toLowerCase().trim() !== userEmail) return fail(new Error('Only the requester can delete items'));
    var status = (d.Status || '').toUpperCase();
    if (status !== 'SUBMITTED' && status !== 'CORRECTION_REQUIRED') return fail(new Error('Items cannot be deleted after approval'));
    var ingredients = safeJson(d.Formulaltems, []);
    var addItems = safeJson(d.AdditionalItems, []);
    function filterFn(item) {
      return item && item.name !== itemName && item.itemName !== itemName;
    }
    var newIngredients = ingredients.filter(filterFn);
    var newAddItems = addItems.filter(filterFn);
    await ref.update({
      Formulaltems: JSON.stringify(newIngredients),
      AdditionalItems: JSON.stringify(newAddItems)
    });
    return ok({ message: 'Item removed' });
  }

  async function adminOverride(params) {
    var id = params.id;
    var status = params.status;
    var stage = params.stage;
    if (!id) return fail(new Error('No id'));
    var adminId = adminIdentifier(params) || (params.email || '').toLowerCase().trim();
    var allowed = await hasRole(adminId, ['Manager', 'Admin']);
    if (!allowed) return fail(new Error('Admin privileges required'));
    var ref = db.collection('Requisitions_V2').doc(String(id).replace(/\//g, '_'));
    var snap = await ref.get();
    if (!snap.exists) return fail(new Error('Request not found'));
    var up = {};
    if (status) up.Status = status.toUpperCase();
    if (stage) up.CurrentStage = stage;
    if (Object.keys(up).length) await ref.update(up);
    return ok({});
  }

  async function adminForceAction(params) {
    var id = params.id;
    var type = (params.type || '').toUpperCase();
    if (!id) return fail(new Error('No id'));
    var adminId = adminIdentifier(params) || (params.email || '').toLowerCase().trim();
    var allowed = await hasRole(adminId, ['Manager', 'Admin']);
    if (!allowed) return fail(new Error('Admin privileges required'));
    var ref = db.collection('Requisitions_V2').doc(String(id).replace(/\//g, '_'));
    var snap = await ref.get();
    if (!snap.exists) return fail(new Error('Request not found'));
    var d = snap.data();
    var up = {};
    if (type === 'FORCE_WIP') {
      up.Status = 'ISSUED';
      up.CurrentStage = 'MATERIAL ISSUED / WIP';
    } else if (type === 'FORCE_COMPLETE') {
      up.Status = 'PRODUCED';
      up.CurrentStage = 'Awaiting Dispatch';
    } else if (type === 'FORCE_REFUND') {
      up.CurrentStage = 'Refund requested';
    } else {
      return fail(new Error('Invalid type: use FORCE_WIP, FORCE_COMPLETE, or FORCE_REFUND'));
    }
    if (Object.keys(up).length) await ref.update(up);
    return ok({});
  }

  var actionHandlers = {
    test_connection: async function () { return ok({ status: 'Online' }); },
    test: async function () { return ok({ status: 'Online' }); },
    login: function (p) { return loginUser(p.email, p.password); },
    get_my_profile: getMyProfile,
    change_password: changePassword,
    add_user: addUser,
    list_users: listUsers,
    delete_user: deleteUser,
    admin_set_password: adminSetPassword,
    get_db: getDb,
    save_inventory: async function (p) {
      var payload = p.data;
      if (typeof payload === 'string') {
        try { payload = JSON.parse(payload); } catch (e) { return fail(e); }
      }
      var result = await saveInventory(payload, p.baseVersion);
      if (result && (result.status === 'success' || result.result === 'success')) {
        await auditLog('inventory_sync', p.user || p.userEmail || 'inventory_app', { version: result.version || '' });
      }
      return result;
    },
    get_form_data: getFormData,
    get_form_products: async function () { var fd = await getFormData(); return fd.result === 'success' ? ok({ products: fd.products }) : fd; },
    get_lists: getLists,
    get_requests_by_stage: getRequestsByStage,
    get_all_requests: getAllRequests,
    get_request_details: getRequestDetails,
    get_stage_counts: getStageCounts,
    get_my_requests: getMyRequests,
    get_pending_approvals: getPendingApprovals,
    get_requisition_reserved_totals: getRequisitionReservedTotals,
    release_expired_reservations: releaseExpiredReservations,
    get_material_queue: getMaterialQueue,
    get_requisition_queue: getMaterialQueue,
    get_wip_batches: getWipBatches,
    get_pending_production: getPendingProduction,
    get_stock_adjustment_requests: getStockAdjustmentRequests,
    get_pending_dispatch_approvals: getPendingDispatchApprovals,
    get_dispatches_for_request: getDispatchesForRequest,
    submit_request: submitRequest,
    create_request: submitRequest,
    update_request_stage: updateRequestStage,
    update_req_stage: updateRequestStage,
    add_thread_note: addThreadNote,
    add_material_request: addMaterialRequest,
    approve_request: function (p) { return actionRequest(p, 'APPROVED'); },
    approve_partial_request: function (p) { return actionRequest(p, 'APPROVED'); },
    hold_request: function (p) { return actionRequest(p, 'ON_HOLD'); },
    hold_plan_request: function (p) { return actionRequest(p, 'ON_HOLD'); },
    reject_request: function (p) { return actionRequest(p, 'REJECTED'); },
    mark_stock_adjustment_done: markStockAdjustmentDone,
    consume_requisition_material: async function (p) {
      if (!p.reqId || !p.itemName) return fail(new Error('reqId and itemName required'));
      return ok({ message: 'Recorded (Firebase)', remaining: 0 });
    },
    request_dispatch: requestDispatch,
    approve_dispatch: approveDispatch,
    confirm_formula: confirmFormula,
    request_correction: requestCorrection,
    update_request_packing_labels: updateRequestPackingLabels,
    wip_action_req: wipActionRequisition,
    edit_request_item: editRequestItem,
    delete_request_item: deleteRequestItem,
    admin_override: adminOverride,
    admin_force_action: adminForceAction,
    submit_stock_adjustment_request: async function (p) {
      var id = 'SAR-' + Date.now();
      await db.collection('StockAdjustmentRequests').doc(id).set({
        RequestID: id,
        requisitionId: p.requisitionId || '',
        itemName: p.itemName || '',
        itemId: p.itemId || '',
        quantity: parseFloat(p.quantity) || 0,
        unit: p.unit || '',
        RequestedBy: p.user || '',
        RequestedAt: new Date().toISOString(),
        Status: 'Pending'
      });
      return ok({ message: 'Request submitted' });
    },
    submit_formula_request: async function (p) {
      var id = 'FR-' + Date.now();
      await db.collection('FormulaRequests').doc(id).set({
        id: id,
        email: p.email || '',
        name: p.name || '',
        formulaBasis: p.formulaBasis || '',
        formulaDetails: p.formulaDetails || '',
        status: 'Pending',
        createdAt: new Date().toISOString()
      });
      await pushNotificationQueue('formula_request_submitted', {
        formulaRequestId: id,
        requestedBy: p.email || '',
        requestedByName: p.name || '',
        formulaBasis: p.formulaBasis || ''
      });
      logRequestToReminderSheet(p.email || '', p.name || '');
      return ok({ id: id });
    },
    get_formula_requests: async function (p) {
      var snap = await db.collection('FormulaRequests').get();
      var list = [];
      snap.forEach(function (d) {
        if (d.id === '_empty') return;
        list.push(Object.assign({ id: d.id }, d.data()));
      });
      var status = (p.status || '').toLowerCase();
      if (status) list = list.filter(function (r) { return (r.status || '').toLowerCase() === status; });
      return ok({ requests: list });
    },
    update_formula_request_status: async function (p) {
      var ref = db.collection('FormulaRequests').doc(String(p.id).replace(/\//g, '_'));
      var snap = await ref.get();
      if (!snap.exists) return fail(new Error('Request not found'));
      var existing = snap.data();
      await ref.update({
        status: p.status || 'Added',
        resolvedBy: p.user || '',
        notes: p.notes || '',
        resolvedAt: new Date().toISOString()
      });
      await pushNotificationQueue('formula_request_resolved', {
        formulaRequestId: p.id,
        status: p.status || 'Added',
        resolvedBy: p.user || '',
        requestedBy: existing.email || ''
      });
      return ok({});
    },
    generate_report: generateReport,
    notify_stock_arrival: notifyStockArrival,
    sync_wip_to_req: syncWipToReq,
    save_wip_batch: saveWipBatch,
    mark_used: markUsed
  };

  async function callBackend(action, params) {
    if (!db) return fail(new Error('Firebase not initialized. Call FirebaseBackend.init(config) first.'));
    params = params || {};
    var handler = actionHandlers[action];
    if (!handler) return fail(new Error('Invalid action: ' + action));
    try {
      return await handler(params);
    } catch (e) {
      return fail(e);
    }
  }

  function init(config) {
    if (typeof global.firebase === 'undefined') {
      console.error('Firebase SDK not loaded. Include firebase-app-compat.js and firebase-firestore-compat.js first.');
      return false;
    }
    try {
      backendConfig = config && typeof config === 'object' ? config : {};
      var app = global.firebase.initializeApp(config);
      db = global.firebase.firestore();
      return true;
    } catch (e) {
      console.error('Firebase init failed', e);
      return false;
    }
  }

  global.FirebaseBackend = { init: init, callBackend: callBackend };
})(typeof window !== 'undefined' ? window : this);
