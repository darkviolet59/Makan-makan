/* ============================================================================
   Makan Split — a lunch bill splitter PWA
   Vanilla JS, no build step. All data is stored on the device (localStorage).
   ----------------------------------------------------------------------------
   Concept:
   - One person pays the whole bill, then everyone pays them back.
   - The payer creates an EVENT, snaps the receipt and "punches in" each line.
   - Each item can be Individual (one person) or Shared (split equally).
   - Every participant "logs in" (pick their name) and taps the items they had;
     shared items they were included in show up automatically.
   - Service charge + SST are added on top; the payer confirms the rates.
   NOTE: real photo OCR and real multi-device login need a backend — see README.
   ========================================================================== */
(function () {
  "use strict";

  var LS_KEY = "makanSplit.v1";
  var MAX_PEOPLE = 16;
  var DEFAULT_SC = 10;   // service charge %  (Malaysia F&B is typically 10%)
  var DEFAULT_SST = 6;   // SST / service tax % (Malaysia is 6%)

  var AV_COLORS = ["#ff6a3d","#0f9d8f","#5b6cff","#e5484d","#12996b","#a855f7",
                   "#f59e0b","#0ea5e9","#ec4899","#64748b","#16a34a","#d97706",
                   "#7c3aed","#0891b2","#dc2626","#2563eb"];

  /* ------------------------------- state -------------------------------- */
  function seed() {
    var users = [{ id: 1, name: "Debbie Lim", email: "debbie.lim@microsoft.com" }];
    for (var i = 2; i <= MAX_PEOPLE; i++) users.push({ id: i, name: "Person " + i, email: "" });

    var sample = {
      id: "evt_sample",
      name: "🍜 Sample: Team Lunch",
      date: todayISO(),
      payerId: 1,
      participantIds: [1, 2, 3, 4],
      serviceChargeEnabled: true, serviceChargeRate: DEFAULT_SC,
      sstEnabled: true, sstRate: DEFAULT_SST, sstOnServiceCharge: true,
      receiptThumb: null,
      status: "open",
      items: [
        { id: "it_1", name: "Nasi Lemak Ayam",  price: 15.90, shared: false, assignedTo: [2] },
        { id: "it_2", name: "Char Kuey Teow",   price: 13.50, shared: false, assignedTo: [3] },
        { id: "it_3", name: "Chicken Chop",      price: 22.00, shared: false, assignedTo: [1] },
        { id: "it_4", name: "Fish & Chips",      price: 24.00, shared: false, assignedTo: [4] },
        { id: "it_5", name: "Satay Platter (share)", price: 32.00, shared: true, assignedTo: [1, 2, 3, 4] },
        { id: "it_6", name: "Jug of Iced Lemon Tea", price: 18.00, shared: true, assignedTo: [1, 2, 3, 4] }
      ]
    };

    return { seq: 100, currentUserId: 1, users: users, events: [sample], ui: { screen: "home", eventId: null } };
  }

  var state;
  function load() {
    try { var raw = localStorage.getItem(LS_KEY); if (raw) return JSON.parse(raw); } catch (e) {}
    return seed();
  }
  function save() { try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (e) {} }
  state = load();

  /* ------------------------------ helpers ------------------------------- */
  function todayISO() { var d = new Date(); var m = d.getMonth() + 1, day = d.getDate();
    return d.getFullYear() + "-" + (m < 10 ? "0" + m : m) + "-" + (day < 10 ? "0" + day : day); }
  function money(n) { n = Number(n) || 0; return "RM " + n.toFixed(2); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function attr(s) { return String(s == null ? "" : s).replace(/"/g, "&quot;"); }
  function uid(p) { state.seq = (state.seq || 0) + 1; return (p || "id_") + state.seq; }
  function userById(id) { for (var i = 0; i < state.users.length; i++) if (state.users[i].id === id) return state.users[i]; return { id: id, name: "?", email: "" }; }
  function firstName(u) { return (u.name || "").trim().split(/\s+/)[0] || ("P" + u.id); }
  function initials(name) { var p = String(name || "").trim().split(/\s+/); return ((p[0] || "?")[0] + (p[1] ? p[1][0] : "")).toUpperCase(); }
  function color(id) { return AV_COLORS[(id - 1) % AV_COLORS.length]; }
  function eventById(id) { for (var i = 0; i < state.events.length; i++) if (state.events[i].id === id) return state.events[i]; return null; }
  function fmtDate(iso) { if (!iso) return ""; var d = new Date(iso + "T00:00:00");
    if (isNaN(d)) return iso;
    return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" }); }

  /* --------------------------- calculations ----------------------------- */
  // One person's share of an event = sum of (item price / number of people on it)
  // for every item they are assigned to, then service charge + SST on top.
  function share(ev, userId) {
    var sub = 0;
    (ev.items || []).forEach(function (it) {
      var a = it.assignedTo || [];
      if (a.length && a.indexOf(userId) !== -1) sub += (Number(it.price) || 0) / a.length;
    });
    var scRate = ev.serviceChargeEnabled ? (Number(ev.serviceChargeRate) || 0) : 0;
    var sstRate = ev.sstEnabled ? (Number(ev.sstRate) || 0) : 0;
    var sc = sub * scRate / 100;
    var sstBase = ev.sstOnServiceCharge ? (sub + sc) : sub;
    var sst = sstBase * sstRate / 100;
    return { sub: sub, sc: sc, sst: sst, total: sub + sc + sst };
  }
  function summary(ev) {
    var itemsSub = (ev.items || []).reduce(function (t, it) { return t + (Number(it.price) || 0); }, 0);
    var assignedSub = 0, unassignedItems = 0;
    (ev.items || []).forEach(function (it) {
      if ((it.assignedTo || []).length) assignedSub += (Number(it.price) || 0);
      else unassignedItems++;
    });
    var scRate = ev.serviceChargeEnabled ? (Number(ev.serviceChargeRate) || 0) : 0;
    var sstRate = ev.sstEnabled ? (Number(ev.sstRate) || 0) : 0;
    var sc = itemsSub * scRate / 100;
    var sstBase = ev.sstOnServiceCharge ? (itemsSub + sc) : itemsSub;
    var sst = sstBase * sstRate / 100;
    return { itemsSub: itemsSub, unassigned: itemsSub - assignedSub, unassignedItems: unassignedItems,
             sc: sc, sst: sst, grand: itemsSub + sc + sst };
  }

  /* ------------------------------ render -------------------------------- */
  var app = document.getElementById("app");

  function avatar(u, size) { size = size || 26;
    return '<span class="avatar" style="background:' + color(u.id) + ';width:' + size + 'px;height:' + size + 'px">' + esc(initials(u.name)) + '</span>'; }

  function appbar() {
    var u = userById(state.currentUserId);
    var opts = state.users.map(function (x) {
      return '<option value="' + x.id + '"' + (x.id === state.currentUserId ? " selected" : "") + '>' + esc(x.name) + '</option>';
    }).join("");
    var installBtn = window.__deferredInstall
      ? '<button class="iconbtn" title="Install app" onclick="MS.install()">⬇︎</button>' : "";
    return '' +
      '<div class="appbar">' +
        '<div class="row">' +
          '<span class="brand">' + LOGO_SVG + '<span>Makan Split</span></span>' +
          '<span class="spacer"></span>' + installBtn +
          '<button class="iconbtn" title="People" onclick="MS.nav(\'people\')">👥</button>' +
        '</div>' +
        '<div class="userbar">' + avatar(u, 30) +
          '<div class="who"><b>Logged in as ' + esc(firstName(u)) + '</b><span>' + (esc(u.email) || "no email set — tap 👥 to add") + '</span></div>' +
          '<select onchange="MS.switchUser(this.value)" title="Switch login (simulate each person)">' + opts + '</select>' +
        '</div>' +
      '</div>';
  }

  function bottomnav() {
    var s = state.ui.screen;
    return '<div class="bottomnav">' +
      '<button class="' + (s === "home" || s === "event" || s === "create" ? "active" : "") + '" onclick="MS.nav(\'home\')"><span class="ic">🏠</span>Events</button>' +
      '<button class="' + (s === "people" ? "active" : "") + '" onclick="MS.nav(\'people\')"><span class="ic">👥</span>People</button>' +
      '</div>';
  }

  function render() {
    var body;
    switch (state.ui.screen) {
      case "create": body = screenCreate(); break;
      case "event":  body = screenEvent();  break;
      case "people": body = screenPeople(); break;
      default:       body = screenHome();
    }
    app.innerHTML = appbar() + '<div class="screen">' + body + '</div>' + bottomnav();
    window.scrollTo(0, 0);
  }

  /* ------------------------------- HOME --------------------------------- */
  function screenHome() {
    var meId = state.currentUserId;
    var html = '<button class="btn btn-primary" style="margin-bottom:14px" onclick="MS.nav(\'create\')">＋ Create an event</button>';
    html += '<h2 class="title" style="font-size:16px">Your events</h2>';

    if (!state.events.length) {
      html += '<div class="empty"><div class="big">🧾</div><b>No events yet</b><div class="sub" style="margin-top:4px">Tap “Create an event” to split your first lunch bill.</div></div>';
      return html;
    }

    html += '<div class="events">';
    // newest first
    state.events.slice().reverse().forEach(function (ev) {
      var sum = summary(ev);
      var payer = userById(ev.payerId);
      var isPayer = ev.payerId === meId;
      var inEvent = (ev.participantIds || []).indexOf(meId) !== -1;
      var mine = share(ev, meId).total;

      var avs = (ev.participantIds || []).slice(0, 5).map(function (id) { return avatar(userById(id)); }).join("");
      var extra = (ev.participantIds || []).length - 5;
      if (extra > 0) avs += '<span class="avatar" style="background:var(--muted)">+' + extra + '</span>';

      var chip;
      if (ev.status === "settled") chip = '<span class="badge settled">✓ Settled</span>';
      else if (isPayer) chip = '<span class="badge owed">You paid — collect ' + money(sum.grand - mine) + '</span>';
      else if (inEvent) chip = '<span class="badge owe">You owe ' + money(mine) + '</span>';
      else chip = '<span class="badge">Not in this event</span>';

      html += '<div class="event-card" onclick="MS.openEvent(\'' + ev.id + '\')">' +
        '<div class="top">' +
          '<div><p class="nm">' + esc(ev.name) + '</p><div class="dt">' + esc(fmtDate(ev.date)) + ' · Paid by ' + esc(firstName(payer)) + '</div></div>' +
          '<div class="amt"><div class="v">' + money(sum.grand) + '</div><div class="l">total bill</div></div>' +
        '</div>' +
        '<div class="foot"><div class="avatars">' + avs + '</div>' + chip + '</div>' +
      '</div>';
    });
    html += '</div>';
    html += '<div class="note" style="text-align:center;margin-top:14px">Tip: use the switcher at the top to “log in” as another person and tap the items they had.</div>';
    return html;
  }

  /* ------------------------------ CREATE -------------------------------- */
  function screenCreate() {
    var me = userById(state.currentUserId);
    var rows = state.users.map(function (u) {
      var isMe = u.id === state.currentUserId;
      return '<label class="prow" style="cursor:pointer">' +
        '<input type="checkbox" class="ce-p" value="' + u.id + '"' + (isMe ? " checked disabled" : "") + ' style="width:20px;height:20px">' +
        avatar(u) +
        '<div class="ins" style="gap:0"><b>' + esc(u.name) + (isMe ? ' <span class="badge">payer · you</span>' : '') + '</b>' +
        '<span class="sub">' + (esc(u.email) || 'no email') + '</span></div>' +
      '</label>';
    }).join("");

    return '<button class="backbtn" onclick="MS.nav(\'home\')">‹ Back</button>' +
      '<h2 class="title">Create an event</h2>' +
      '<div class="card">' +
        '<div class="field"><label>Event name</label><input id="ce-name" type="text" placeholder="e.g. Friday Lunch @ Nando’s"></div>' +
        '<div class="field"><label>Date</label><input id="ce-date" type="date" value="' + attr(todayISO()) + '"></div>' +
      '</div>' +
      '<div class="card">' +
        '<h3>Who’s in this event? <span class="hint">you pay the bill</span></h3>' +
        '<div class="sub" style="margin-bottom:8px">You (' + esc(firstName(me)) + ') are the payer and are always included.</div>' +
        rows +
      '</div>' +
      '<button class="btn btn-primary" onclick="MS.submitCreate()">Create event</button>';
  }

  /* ------------------------------ EVENT --------------------------------- */
  function screenEvent() {
    var ev = eventById(state.ui.eventId);
    if (!ev) { state.ui.screen = "home"; return screenHome(); }
    var meId = state.currentUserId;
    var isPayer = ev.payerId === meId;
    var payer = userById(ev.payerId);
    var participants = (ev.participantIds || []).map(userById);
    var sum = summary(ev);
    var mine = share(ev, meId);
    var settled = ev.status === "settled";

    var html = '<button class="backbtn" onclick="MS.nav(\'home\')">‹ All events</button>';
    html += '<h2 class="title" style="margin-bottom:2px">' + esc(ev.name) + '</h2>';
    html += '<div class="sub" style="margin-bottom:12px">' + esc(fmtDate(ev.date)) + ' · Paid by ' + esc(firstName(payer)) +
            (isPayer ? ' (you)' : '') + ' · ' + participants.length + ' people' +
            (settled ? ' · <b style="color:var(--teal)">Settled ✓</b>' : '') + '</div>';

    /* Receipt */
    html += '<div class="card"><h3>🧾 Receipt' + (isPayer ? ' <span class="hint">snap & punch in the lines</span>' : '') + '</h3>';
    if (ev.receiptThumb) html += '<img class="receipt-photo" src="' + attr(ev.receiptThumb) + '" alt="receipt">';
    if (isPayer && !settled) {
      html += '<label class="btn btn-ghost btn-block" style="margin-top:' + (ev.receiptThumb ? '10px' : '0') + '">' +
        '📷 ' + (ev.receiptThumb ? 'Retake receipt photo' : 'Snap / upload receipt') +
        '<input type="file" accept="image/*" capture="environment" style="display:none" onchange="MS.onPhoto(\'' + ev.id + '\',this)"></label>';
      html += '<div class="note">The photo is your reference — add each line below. (Auto-scan/OCR is on the roadmap — see the README.)</div>';
    } else if (!ev.receiptThumb) {
      html += '<div class="sub">No receipt photo attached.</div>';
    }
    html += '</div>';

    /* Items */
    html += '<div class="card"><h3>Items <span class="hint">' + (ev.items || []).length + ' line' + ((ev.items || []).length === 1 ? '' : 's') + '</span></h3>';
    if (!(ev.items || []).length) {
      html += '<div class="sub" style="padding:6px 0 10px">No items yet.' + (isPayer ? ' Add the first line below.' : '') + '</div>';
    }
    (ev.items || []).forEach(function (it) { html += itemRow(ev, it, isPayer && !settled, meId); });

    if (isPayer && !settled) {
      html += '<div class="divider"></div>' +
        '<div class="flex" style="align-items:flex-end">' +
          '<div class="grow"><label class="sub" style="font-weight:600">Item</label><input id="ai-name" type="text" placeholder="e.g. Chicken Rice"></div>' +
          '<div style="width:96px"><label class="sub" style="font-weight:600">Price</label><input id="ai-price" type="number" inputmode="decimal" step="0.01" placeholder="0.00" style="text-align:right"></div>' +
        '</div>' +
        '<label class="rowline" style="cursor:pointer"><span class="lb">Shared item (split equally)</span>' +
          '<span class="rt"><span class="switch"><input id="ai-shared" type="checkbox"><span class="slider"></span></span></span></label>' +
        '<button class="btn btn-teal btn-block btn-sm" style="margin-top:6px" onclick="MS.addItem(\'' + ev.id + '\')">＋ Add item</button>';
    }
    html += '</div>';

    /* Charges */
    html += chargesCard(ev, isPayer && !settled);

    /* Your share */
    html += '<div class="card yourshare"><h3 style="color:#fff">Your share' + (isPayer ? ' (as a diner)' : '') + '</h3>' +
      sumline("Your items subtotal", money(mine.sub)) +
      (ev.serviceChargeEnabled ? sumline("Service charge (" + (Number(ev.serviceChargeRate) || 0) + "%)", money(mine.sc)) : "") +
      (ev.sstEnabled ? sumline("SST (" + (Number(ev.sstRate) || 0) + "%)", money(mine.sst)) : "") +
      '<div class="sumline total"><span>' + (isPayer ? "Your own share" : "You owe " + esc(firstName(payer))) + '</span><span>' + money(mine.total) + '</span></div>' +
      '</div>';

    /* Breakdown for everyone */
    html += '<div class="card"><h3>Everyone’s split</h3>' + breakdownTable(ev, meId) + '</div>';

    /* Bill total */
    html += '<div class="card"><h3>Bill total</h3>' +
      sumline("Items subtotal", money(sum.itemsSub)) +
      (ev.serviceChargeEnabled ? sumline("Service charge (" + (Number(ev.serviceChargeRate) || 0) + "%)", money(sum.sc)) : "") +
      (ev.sstEnabled ? sumline("SST (" + (Number(ev.sstRate) || 0) + "%)", money(sum.sst)) : "") +
      '<div class="sumline total"><span>Grand total</span><span>' + money(sum.grand) + '</span></div>';
    if (sum.unassignedItems > 0) html += '<div class="warn">⚠︎ ' + sum.unassignedItems + ' item' + (sum.unassignedItems === 1 ? '' : 's') + ' (' + money(sum.unassigned) + ') not assigned to anyone yet — assign them so the split adds up.</div>';
    html += '</div>';

    /* Actions */
    html += '<div class="flex">' +
      (settled
        ? '<button class="btn btn-ghost grow" onclick="MS.setStatus(\'' + ev.id + '\',\'open\')">Reopen</button>'
        : '<button class="btn btn-teal grow" onclick="MS.setStatus(\'' + ev.id + '\',\'settled\')">Mark as settled ✓</button>') +
      (isPayer ? '<button class="btn btn-danger" onclick="MS.deleteEvent(\'' + ev.id + '\')">Delete</button>' : '') +
      '</div>';
    return html;
  }

  function itemRow(ev, it, editable, meId) {
    var a = it.assignedTo || [];
    var perHead = a.length ? (Number(it.price) || 0) / a.length : 0;
    var isMine = a.indexOf(meId) !== -1;
    var html = '<div class="item">';

    if (editable) {
      html += '<div class="r1">' +
        '<input class="nm-in" type="text" value="' + attr(it.name) + '" onchange="MS.updateItem(\'' + ev.id + '\',\'' + it.id + '\',\'name\',this.value)">' +
        '<input class="price-in" type="number" inputmode="decimal" step="0.01" value="' + attr(it.price) + '" onchange="MS.updateItem(\'' + ev.id + '\',\'' + it.id + '\',\'price\',this.value)">' +
        '<button class="del" title="Remove" onclick="MS.removeItem(\'' + ev.id + '\',\'' + it.id + '\')">🗑</button>' +
      '</div>' +
      '<div class="r2">' +
        '<span class="tag ' + (it.shared ? 'shared' : 'indiv') + '">' + (it.shared ? 'Shared' : 'Individual') + '</span>' +
        '<label class="meta" style="display:inline-flex;align-items:center;gap:6px;cursor:pointer"><span class="switch" style="width:38px;height:22px"><input type="checkbox"' + (it.shared ? ' checked' : '') + ' onchange="MS.setShared(\'' + ev.id + '\',\'' + it.id + '\',this.checked)"><span class="slider"></span></span> shared</label>' +
        '<span class="meta" style="margin-left:auto">' + (a.length ? money(perHead) + ' each × ' + a.length : 'unassigned') + '</span>' +
      '</div>' +
      '<div class="assign"><div class="chips">' +
        (ev.participantIds || []).map(function (id) {
          var u = userById(id), on = a.indexOf(id) !== -1;
          return '<button class="chip ' + (on ? 'active' : '') + '" onclick="MS.toggleAssign(\'' + ev.id + '\',\'' + it.id + '\',' + id + ')">' +
            '<span class="dot" style="background:' + color(id) + '">' + esc(initials(u.name)) + '</span>' + esc(firstName(u)) + '</button>';
        }).join("") +
        '<button class="chip" onclick="MS.assignAll(\'' + ev.id + '\',\'' + it.id + '\',true)">All</button>' +
        '<button class="chip" onclick="MS.assignAll(\'' + ev.id + '\',\'' + it.id + '\',false)">Clear</button>' +
      '</div></div>';
    } else {
      // Participant / read-only view
      html += '<div class="r1"><span class="nm-in">' + esc(it.name) +
        ' <span class="tag ' + (it.shared ? 'shared' : 'indiv') + '" style="margin-left:4px">' + (it.shared ? 'Shared' : 'Individual') + '</span></span>' +
        '<span style="font-weight:700">' + money(it.price) + '</span></div>';
      html += '<div class="r2"><span class="meta">' + (a.length ? money(perHead) + ' each' : 'not assigned') + '</span>' +
        '<span class="avatars" style="margin-left:auto">' + a.map(function (id) { return avatar(userById(id), 22); }).join("") + '</span></div>';
      if (state.ui.screen === "event" && ev.status !== "settled") {
        html += '<button class="btn btn-sm ' + (isMine ? 'btn-ghost' : 'btn-teal') + '" style="margin-top:9px;width:100%" onclick="MS.toggleAssign(\'' + ev.id + '\',\'' + it.id + '\',' + meId + ')">' +
          (isMine ? '✓ You had this — tap to remove' : '＋ I had this') + '</button>';
      }
    }
    html += '</div>';
    return html;
  }

  function chargesCard(ev, editable) {
    if (editable) {
      return '<div class="card"><h3>Service charge & SST <span class="hint">payer confirms</span></h3>' +
        '<div class="rowline"><span class="lb">Service charge</span><span class="rt">' +
          '<input class="rate-in" type="number" step="0.5" value="' + attr(ev.serviceChargeRate) + '" onchange="MS.setCharge(\'' + ev.id + '\')" id="sc-rate">%' +
          '<span class="switch"><input id="sc-on" type="checkbox"' + (ev.serviceChargeEnabled ? ' checked' : '') + ' onchange="MS.setCharge(\'' + ev.id + '\')"><span class="slider"></span></span></span></div>' +
        '<div class="rowline"><span class="lb">SST</span><span class="rt">' +
          '<input class="rate-in" type="number" step="0.5" value="' + attr(ev.sstRate) + '" onchange="MS.setCharge(\'' + ev.id + '\')" id="sst-rate">%' +
          '<span class="switch"><input id="sst-on" type="checkbox"' + (ev.sstEnabled ? ' checked' : '') + ' onchange="MS.setCharge(\'' + ev.id + '\')"><span class="slider"></span></span></span></div>' +
        '<label class="rowline" style="cursor:pointer"><span class="lb">Charge SST on service charge too</span><span class="rt">' +
          '<span class="switch"><input id="sst-base" type="checkbox"' + (ev.sstOnServiceCharge ? ' checked' : '') + ' onchange="MS.setCharge(\'' + ev.id + '\')"><span class="slider"></span></span></span></label>' +
        '<div class="note">Malaysia default: 10% service charge, then 6% SST on (subtotal + service charge). Adjust to match your receipt.</div>' +
      '</div>';
    }
    return '<div class="card"><h3>Service charge & SST</h3>' +
      '<div class="rowline"><span class="lb">Service charge</span><span class="rt">' + (ev.serviceChargeEnabled ? (Number(ev.serviceChargeRate) || 0) + '%' : '—') + '</span></div>' +
      '<div class="rowline"><span class="lb">SST</span><span class="rt">' + (ev.sstEnabled ? (Number(ev.sstRate) || 0) + '%' : '—') + '</span></div>' +
    '</div>';
  }

  function breakdownTable(ev, meId) {
    var rows = (ev.participantIds || []).map(function (id) {
      var u = userById(id), s = share(ev, id);
      return '<tr class="' + (id === meId ? 'me' : '') + '"><td>' + esc(firstName(u)) + (id === ev.payerId ? ' <span class="badge">payer</span>' : '') + '</td>' +
        '<td>' + money(s.sub) + '</td><td>' + money(s.sc + s.sst) + '</td><td>' + money(s.total) + '</td></tr>';
    }).join("");
    var tot = (ev.participantIds || []).reduce(function (t, id) { return t + share(ev, id).total; }, 0);
    return '<table class="bd"><thead><tr><th>Person</th><th>Items</th><th>Charges</th><th>Total</th></tr></thead>' +
      '<tbody>' + rows + '</tbody>' +
      '<tfoot><tr><td>Collected</td><td></td><td></td><td>' + money(tot) + '</td></tr></tfoot></table>';
  }

  function sumline(label, val) { return '<div class="sumline"><span class="muted">' + esc(label) + '</span><span>' + val + '</span></div>'; }

  /* ------------------------------ PEOPLE -------------------------------- */
  function screenPeople() {
    var rows = state.users.map(function (u) {
      return '<div class="prow">' + avatar(u, 34) +
        '<div class="ins">' +
          '<input type="text" value="' + attr(u.name) + '" placeholder="Name" onchange="MS.saveUser(' + u.id + ',\'name\',this.value)">' +
          '<input type="email" value="' + attr(u.email) + '" placeholder="email@company.com" onchange="MS.saveUser(' + u.id + ',\'email\',this.value)">' +
        '</div></div>';
    }).join("");
    return '<button class="backbtn" onclick="MS.nav(\'home\')">‹ Back</button>' +
      '<h2 class="title">People (' + MAX_PEOPLE + ')</h2>' +
      '<div class="sub" style="margin:-6px 2px 12px">This app is set up for a fixed group of ' + MAX_PEOPLE + '. Each person “logs in” with their name/email. Set them up once here.</div>' +
      '<div class="card">' + rows + '</div>' +
      '<div class="note">In this prototype “logging in” means picking your name in the top switcher. Real per-device sign-in with email needs a backend — see the README.</div>';
  }

  /* ------------------------------ actions ------------------------------- */
  window.MS = {
    render: render,
    nav: function (screen, eventId) { state.ui = { screen: screen, eventId: eventId || null }; save(); render(); },
    openEvent: function (id) { state.ui = { screen: "event", eventId: id }; save(); render(); },
    switchUser: function (id) { state.currentUserId = Number(id) || 1; save(); render(); },

    submitCreate: function () {
      var name = (document.getElementById("ce-name").value || "").trim() || "Lunch";
      var date = document.getElementById("ce-date").value || todayISO();
      var ids = [];
      document.querySelectorAll(".ce-p:checked").forEach(function (c) { ids.push(Number(c.value)); });
      if (ids.indexOf(state.currentUserId) === -1) ids.unshift(state.currentUserId);
      var ev = { id: uid("evt_"), name: name, date: date, payerId: state.currentUserId, participantIds: ids,
        serviceChargeEnabled: true, serviceChargeRate: DEFAULT_SC, sstEnabled: true, sstRate: DEFAULT_SST,
        sstOnServiceCharge: true, receiptThumb: null, status: "open", items: [] };
      state.events.push(ev);
      state.ui = { screen: "event", eventId: ev.id };
      save(); render();
    },

    addItem: function (eventId) {
      var ev = eventById(eventId); if (!ev) return;
      var nameEl = document.getElementById("ai-name"), priceEl = document.getElementById("ai-price");
      var name = (nameEl.value || "").trim(), price = parseFloat(priceEl.value);
      if (!name || isNaN(price)) { nameEl.focus(); return; }
      var shared = document.getElementById("ai-shared").checked;
      ev.items.push({ id: uid("it_"), name: name, price: price, shared: shared,
        assignedTo: shared ? (ev.participantIds || []).slice() : [] });
      save(); render();
    },
    updateItem: function (eventId, itemId, field, value) {
      var ev = eventById(eventId); if (!ev) return;
      var it = (ev.items || []).filter(function (x) { return x.id === itemId; })[0]; if (!it) return;
      it[field] = (field === "price") ? (parseFloat(value) || 0) : value;
      save(); render();
    },
    removeItem: function (eventId, itemId) {
      var ev = eventById(eventId); if (!ev) return;
      ev.items = (ev.items || []).filter(function (x) { return x.id !== itemId; });
      save(); render();
    },
    setShared: function (eventId, itemId, val) {
      var ev = eventById(eventId); if (!ev) return;
      var it = (ev.items || []).filter(function (x) { return x.id === itemId; })[0]; if (!it) return;
      it.shared = !!val;
      if (val && !(it.assignedTo || []).length) it.assignedTo = (ev.participantIds || []).slice();
      save(); render();
    },
    toggleAssign: function (eventId, itemId, userId) {
      var ev = eventById(eventId); if (!ev) return;
      var it = (ev.items || []).filter(function (x) { return x.id === itemId; })[0]; if (!it) return;
      var a = it.assignedTo || []; var i = a.indexOf(userId);
      if (i === -1) a.push(userId); else a.splice(i, 1);
      it.assignedTo = a; save(); render();
    },
    assignAll: function (eventId, itemId, val) {
      var ev = eventById(eventId); if (!ev) return;
      var it = (ev.items || []).filter(function (x) { return x.id === itemId; })[0]; if (!it) return;
      it.assignedTo = val ? (ev.participantIds || []).slice() : [];
      save(); render();
    },
    setCharge: function (eventId) {
      var ev = eventById(eventId); if (!ev) return;
      ev.serviceChargeEnabled = document.getElementById("sc-on").checked;
      ev.serviceChargeRate = parseFloat(document.getElementById("sc-rate").value) || 0;
      ev.sstEnabled = document.getElementById("sst-on").checked;
      ev.sstRate = parseFloat(document.getElementById("sst-rate").value) || 0;
      ev.sstOnServiceCharge = document.getElementById("sst-base").checked;
      save(); render();
    },
    setStatus: function (eventId, status) {
      var ev = eventById(eventId); if (!ev) return; ev.status = status; save(); render();
    },
    deleteEvent: function (eventId) {
      var ev = eventById(eventId);
      if (ev && !confirm('Delete "' + ev.name + '"? This cannot be undone.')) return;
      state.events = state.events.filter(function (x) { return x.id !== eventId; });
      state.ui = { screen: "home", eventId: null }; save(); render();
    },
    saveUser: function (userId, field, value) {
      var u = userById(userId); if (!u) return; u[field] = value; save(); render();
    },
    onPhoto: function (eventId, input) {
      var ev = eventById(eventId); if (!ev || !input.files || !input.files[0]) return;
      var reader = new FileReader();
      reader.onload = function (e) {
        var img = new Image();
        img.onload = function () {
          var max = 900, w = img.width, h = img.height, scale = Math.min(1, max / Math.max(w, h));
          var cw = Math.round(w * scale), ch = Math.round(h * scale);
          var cv = document.createElement("canvas"); cv.width = cw; cv.height = ch;
          cv.getContext("2d").drawImage(img, 0, 0, cw, ch);
          try { ev.receiptThumb = cv.toDataURL("image/jpeg", 0.6); } catch (err) { ev.receiptThumb = e.target.result; }
          save(); render();
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(input.files[0]);
    },
    install: function () {
      var d = window.__deferredInstall; if (!d) return;
      d.prompt(); d.userChoice.finally(function () { window.__deferredInstall = null; render(); });
    }
  };

  var LOGO_SVG = '<svg class="logo" viewBox="0 0 512 512" aria-hidden="true"><rect width="512" height="512" rx="120" fill="rgba(255,255,255,.22)"/><path d="M150 120h150a18 18 0 0 1 18 18v230l-28-16-28 16-28-16-28 16-28-16-28 16V138a18 18 0 0 1 18-18Z" fill="#fff"/><rect x="176" y="168" width="98" height="14" rx="7" fill="#ffd8c6"/><rect x="176" y="200" width="78" height="12" rx="6" fill="#ffe3d6"/><rect x="176" y="228" width="88" height="12" rx="6" fill="#ffe3d6"/><circle cx="352" cy="348" r="70" fill="#0f9d8f" stroke="#fff" stroke-width="12"/><rect x="320" y="341" width="64" height="14" rx="7" fill="#fff"/><circle cx="352" cy="322" r="8" fill="#fff"/><circle cx="352" cy="374" r="8" fill="#fff"/></svg>';

  render();
})();
