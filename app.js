/* ============================================================================
   Makan Split — a lunch bill splitter PWA
   Vanilla JS, no build step. All data is stored on the device (localStorage).
   ----------------------------------------------------------------------------
   - Each EVENT (a meal) is paid by ONE person; everyone pays their share back.
   - Punch in each line, set quantity, mark items Shared (split equally) and pick
     who shared them.
   - Service charge + SST are added on top (SST on the subtotal, before service
     charge).
   - "Settle events together" combines several meals (lunch + tea + dinner) and
     nets everyone out to the fewest "X pays Y" transfers across all of them.
   ========================================================================== */
(function () {
  "use strict";

  var LS_KEY = "makanSplit.v1";
  var MAX_PEOPLE = 16;
  var DEFAULT_SC = 10;   // service charge %  (Malaysia F&B is typically 10%)
  var DEFAULT_SST = 6;   // SST / service tax % (Malaysia is 6%)
  var EPS = 0.005;

  var AV_COLORS = ["#ff6a3d","#0f9d8f","#5b6cff","#e5484d","#12996b","#a855f7",
                   "#f59e0b","#0ea5e9","#ec4899","#64748b","#16a34a","#d97706",
                   "#7c3aed","#0891b2","#dc2626","#2563eb"];

  /* ------------------------------- state -------------------------------- */
  function seed() {
    var users = [{ id: 1, name: "Debbie Lim" }];
    for (var i = 2; i <= MAX_PEOPLE; i++) users.push({ id: i, name: "Person " + i });

    var sample = {
      id: "evt_sample",
      name: "🍜 Sample: Team Lunch",
      date: todayISO(),
      payerId: 1,
      participantIds: [1, 2, 3, 4],
      serviceChargeEnabled: true, serviceChargeRate: DEFAULT_SC,
      sstEnabled: true, sstRate: DEFAULT_SST,
      paid: {},
      items: [
        { id: "it_1", name: "Nasi Lemak Ayam",  price: 15.90, qty: 1, shared: false, assignedTo: [2] },
        { id: "it_2", name: "Char Kuey Teow",   price: 13.50, qty: 1, shared: false, assignedTo: [3] },
        { id: "it_3", name: "Chicken Chop",      price: 22.00, qty: 1, shared: false, assignedTo: [1] },
        { id: "it_4", name: "Fish & Chips",      price: 24.00, qty: 1, shared: false, assignedTo: [4] },
        { id: "it_5", name: "Satay Platter",     price: 16.00, qty: 2, shared: true,  assignedTo: [1, 2, 3, 4] },
        { id: "it_6", name: "Iced Lemon Tea",    price: 4.50,  qty: 4, shared: true,  assignedTo: [1, 2, 3, 4] }
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

  // Bring older saved events up to the current model (one payer, quantities, no photo).
  (function normalize() {
    (state.events || []).forEach(function (ev) {
      if (ev.payerId == null) ev.payerId = (Array.isArray(ev.payerIds) && ev.payerIds[0]) || ((ev.participantIds || [])[0]) || 1;
      if (!Array.isArray(ev.participantIds)) ev.participantIds = [ev.payerId];
      if (!ev.paid || typeof ev.paid !== "object") ev.paid = {};
      (ev.items || []).forEach(function (it) { if (it.qty == null) it.qty = 1; });
      if (ev.serviceChargeEnabled === false) ev.serviceChargeRate = 0;   // toggles removed: 0% = off
      if (ev.sstEnabled === false) ev.sstRate = 0;
      ev.serviceChargeEnabled = (Number(ev.serviceChargeRate) || 0) > 0;
      ev.sstEnabled = (Number(ev.sstRate) || 0) > 0;
      delete ev.payerIds; delete ev.payments; delete ev.receiptThumb; delete ev.status; delete ev.sstOnServiceCharge;
    });
    save();
  })();

  /* Ask "who are you?" once each time the app opens, before the events page. */
  var identityConfirmed = false;

  /* ------------------------------ helpers ------------------------------- */
  function todayISO() { var d = new Date(); var m = d.getMonth() + 1, day = d.getDate();
    return d.getFullYear() + "-" + (m < 10 ? "0" + m : m) + "-" + (day < 10 ? "0" + day : day); }
  function money(n) { n = Number(n) || 0; return "RM " + n.toFixed(2); }
  function signed(n) { return (n > EPS ? "+" : "") + money(n); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function attr(s) { return String(s == null ? "" : s).replace(/"/g, "&quot;"); }
  function uid(p) { state.seq = (state.seq || 0) + 1; return (p || "id_") + state.seq; }
  function userById(id) { for (var i = 0; i < state.users.length; i++) if (state.users[i].id === id) return state.users[i]; return { id: id, name: "?" }; }
  function firstName(u) { return (u.name || "").trim().split(/\s+/)[0] || ("P" + u.id); }
  function initials(name) { var p = String(name || "").trim().split(/\s+/); return ((p[0] || "?")[0] + (p[1] ? p[1][0] : "")).toUpperCase(); }
  function color(id) { return AV_COLORS[(id - 1) % AV_COLORS.length]; }
  function eventById(id) { for (var i = 0; i < state.events.length; i++) if (state.events[i].id === id) return state.events[i]; return null; }
  function itemById(ev, id) { var a = ev.items || []; for (var i = 0; i < a.length; i++) if (a[i].id === id) return a[i]; return null; }
  // Read an item's draft inputs (name / price / qty) from the DOM into state.
  function readItemInputs(it) {
    if (!it) return;
    var nm = document.getElementById("nm_" + it.id); if (nm) it.name = nm.value;
    var pr = document.getElementById("pr_" + it.id); if (pr) { var p = parseFloat(pr.value); if (!isNaN(p)) it.price = p; }
    var qt = document.getElementById("qt_" + it.id); if (qt) { var q = parseInt(qt.value, 10); it.qty = (!q || q < 1) ? 1 : q; }
  }
  // Preserve every in-progress item edit before a re-render, so nothing is lost.
  function flushAllItemInputs() {
    if (state.ui.screen !== "event") return;
    var ev = eventById(state.ui.eventId); if (!ev) return;
    (ev.items || []).forEach(function (it) { readItemInputs(it); });
  }
  function fmtDate(iso) { if (!iso) return ""; var d = new Date(iso + "T00:00:00");
    if (isNaN(d)) return iso;
    return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" }); }

  /* --------------------------- calculations ----------------------------- */
  function lineTotal(it) { return (Number(it.price) || 0) * (Number(it.qty) || 1); }

  // Everyone involved: those who joined, the payer, and anyone assigned to an item.
  function assignPool(ev) {
    var out = (ev.participantIds || []).slice();
    function add(id) { if (out.indexOf(id) === -1) out.push(id); }
    if (ev.payerId != null) add(ev.payerId);
    (ev.items || []).forEach(function (it) { (it.assignedTo || []).forEach(add); });
    return out;
  }

  // One person's share of an event.
  function share(ev, userId) {
    var sub = 0;
    (ev.items || []).forEach(function (it) {
      var a = it.assignedTo || [];
      if (a.length && a.indexOf(userId) !== -1) sub += lineTotal(it) / a.length;
    });
    var scRate = ev.serviceChargeEnabled ? (Number(ev.serviceChargeRate) || 0) : 0;
    var sstRate = ev.sstEnabled ? (Number(ev.sstRate) || 0) : 0;
    var sc = sub * scRate / 100;
    var sst = sub * sstRate / 100;   // SST on the items subtotal, before service charge
    return { sub: sub, sc: sc, sst: sst, total: sub + sc + sst };
  }
  function summary(ev) {
    var itemsSub = (ev.items || []).reduce(function (t, it) { return t + lineTotal(it); }, 0);
    var assignedSub = 0, unassignedItems = 0;
    (ev.items || []).forEach(function (it) {
      if ((it.assignedTo || []).length) assignedSub += lineTotal(it);
      else unassignedItems++;
    });
    var scRate = ev.serviceChargeEnabled ? (Number(ev.serviceChargeRate) || 0) : 0;
    var sstRate = ev.sstEnabled ? (Number(ev.sstRate) || 0) : 0;
    var sc = itemsSub * scRate / 100;
    var sst = itemsSub * sstRate / 100;
    return { itemsSub: itemsSub, unassigned: itemsSub - assignedSub, unassignedItems: unassignedItems,
             sc: sc, sst: sst, grand: itemsSub + sc + sst };
  }

  // Fewest "debtor pays creditor" transfers from a map of net positions.
  function minimizeTransfers(nets) {
    var cr = [], db = [];
    Object.keys(nets).forEach(function (k) {
      var id = Number(k), n = nets[k];
      if (n > EPS) cr.push({ id: id, amt: n }); else if (n < -EPS) db.push({ id: id, amt: -n });
    });
    cr.sort(function (a, b) { return b.amt - a.amt; });
    db.sort(function (a, b) { return b.amt - a.amt; });
    var t = [], ci = 0, di = 0;
    while (ci < cr.length && di < db.length) {
      var pay = Math.min(cr[ci].amt, db[di].amt);
      if (pay > EPS) t.push({ from: db[di].id, to: cr[ci].id, amount: Math.round(pay * 100) / 100 });
      cr[ci].amt -= pay; db[di].amt -= pay;
      if (cr[ci].amt <= EPS) ci++;
      if (db[di].amt <= EPS) di++;
    }
    return t;
  }
  function xferKey(from, to) { return from + "_" + to; }
  function transferPaid(ev, t) { return !!((ev.paid || {})[xferKey(t.from, t.to)]); }
  function personSettled(ev, transfers, id) {
    for (var i = 0; i < transfers.length; i++) if (transfers[i].from === id && !transferPaid(ev, transfers[i])) return false;
    return true;
  }

  // Single-event settle-up: everyone pays the one payer their share.
  function settleInfo(ev) {
    var pool = assignPool(ev), nets = {};
    var grand = summary(ev).grand;
    pool.forEach(function (id) { nets[id] = (id === ev.payerId ? grand : 0) - share(ev, id).total; });
    var transfers = minimizeTransfers(nets);
    var me = state.currentUserId, myOwe = 0, myOwed = 0, outstanding = 0;
    transfers.forEach(function (t) {
      if (!transferPaid(ev, t)) { outstanding++; if (t.from === me) myOwe += t.amount; if (t.to === me) myOwed += t.amount; }
    });
    return { transfers: transfers, nets: nets, myOwe: myOwe, myOwed: myOwed, outstanding: outstanding };
  }

  // Cart badge: total items the current user still owes for, across ALL events.
  function cartCount(me) {
    var c = 0;
    state.events.forEach(function (e) {
      if (e.payerId !== me && share(e, me).total > EPS && !transferPaid(e, { from: me, to: e.payerId })) {
        (e.items || []).forEach(function (it) { if ((it.assignedTo || []).indexOf(me) !== -1) c++; });
      }
    });
    return c;
  }

  // Aggregate settle-up across several events (each with its own single payer).
  function aggregateInfo(events) {
    var poolSet = {};
    events.forEach(function (e) { assignPool(e).forEach(function (id) { poolSet[id] = 1; }); });
    var rows = {}, nets = {};
    Object.keys(poolSet).map(Number).forEach(function (id) {
      var paid = 0, ate = 0;
      events.forEach(function (e) { if (e.payerId === id) paid += summary(e).grand; ate += share(e, id).total; });
      rows[id] = { ate: ate, paid: paid, net: paid - ate };
      nets[id] = paid - ate;
    });
    return { rows: rows, transfers: minimizeTransfers(nets) };
  }

  // A combined transfer is "paid" once its debtor is marked settled in every
  // selected event where they owe — so combined + per-event stay in sync.
  function combinedTransferPaid(sel, t) {
    var D = t.from, done = true;
    sel.forEach(function (e) {
      if (e.payerId !== D && share(e, D).total > EPS) { if (!(e.paid && e.paid[xferKey(D, e.payerId)])) done = false; }
    });
    return done;
  }

  // Settle one debtor across a set of events; when it clears the last transfer,
  // mark every remaining (netted) debt in those events too. Shared by combine + summary.
  function settleAcross(events, fromId, val) {
    events.forEach(function (e) {
      if (e.payerId !== fromId && share(e, fromId).total > EPS) {
        if (!e.paid) e.paid = {};
        var k = xferKey(fromId, e.payerId);
        if (val) e.paid[k] = true; else delete e.paid[k];
      }
    });
    if (val) {
      var a = aggregateInfo(events);
      if (a.transfers.every(function (t) { return combinedTransferPaid(events, t); })) {
        events.forEach(function (e) {
          if (!e.paid) e.paid = {};
          assignPool(e).forEach(function (id) {
            if (id !== e.payerId && share(e, id).total > EPS) e.paid[xferKey(id, e.payerId)] = true;
          });
        });
      }
    }
    save(); render();
  }

  /* ------------------------------ render -------------------------------- */
  var app = document.getElementById("app");
  var lastKey = null;
  var moreOpen = {};      // per-item / per-section: is the "＋ More" list expanded?
  var combineSel = {};    // eventId -> selected in the "settle together" screen

  function avatar(u, size) { size = size || 26;
    return '<span class="avatar" style="background:' + color(u.id) + ';width:' + size + 'px;height:' + size + 'px">' + esc(initials(u.name)) + '</span>'; }

  function brandbar() {
    return '<div class="appbar"><div class="row"><span class="brand">' + LOGO_SVG + '<span>Makan Split</span></span></div></div>';
  }

  function appbar() {
    var u = userById(state.currentUserId);
    var installBtn = window.__deferredInstall
      ? '<button class="iconbtn" title="Install app" onclick="MS.install()">⬇︎</button>' : "";
    var opts = state.users.map(function (x) {
      return '<option value="' + x.id + '"' + (x.id === state.currentUserId ? " selected" : "") + '>' + esc(x.name) + '</option>';
    }).join("");
    var ccnt = cartCount(state.currentUserId);
    var cartBtn = '<button class="iconbtn cartbtn" title="Your cart" onclick="MS.openCheckout()">🛒' + (ccnt > 0 ? '<span class="cartbadge">' + ccnt + '</span>' : '') + '</button>';
    return '' +
      '<div class="appbar">' +
        '<div class="row">' +
          '<span class="brand">' + LOGO_SVG + '<span>Makan Split</span></span>' +
          '<span class="spacer"></span>' + installBtn + cartBtn +
        '</div>' +
        '<div class="userbar">' + avatar(u, 30) +
          '<div class="who"><b>You are ' + esc(firstName(u)) + '</b></div>' +
          '<select onchange="MS.switchUser(this.value)" title="Switch person">' + opts + '</select>' +
        '</div>' +
      '</div>';
  }

  function bottomnav() {
    var s = state.ui.screen;
    return '<div class="bottomnav">' +
      '<button class="' + (s === "home" || s === "event" || s === "create" || s === "combine" || s === "checkout" ? "active" : "") + '" onclick="MS.nav(\'home\')"><span class="ic">🏠</span>Events</button>' +
      '<button class="' + (s === "summary" ? "active" : "") + '" onclick="MS.nav(\'summary\')"><span class="ic">📊</span>Summary</button>' +
      '<button class="' + (s === "people" ? "active" : "") + '" onclick="MS.nav(\'people\')"><span class="ic">👥</span>People</button>' +
      '<button class="' + (s === "guide" ? "active" : "") + '" onclick="MS.nav(\'guide\')"><span class="ic">📖</span>Guide</button>' +
      '</div>';
  }

  function render() {
    var key = state.ui.screen + "|" + (state.ui.eventId || "");
    var keep = key === lastKey;
    var y = keep ? (window.scrollY || window.pageYOffset || 0) : 0;
    var out;
    if (state.ui.screen === "identity") {
      out = brandbar() + '<div class="screen">' + screenIdentity() + '</div>';
    } else {
      var body;
      switch (state.ui.screen) {
        case "create":   body = screenCreate();   break;
        case "event":    body = screenEvent();    break;
        case "checkout": body = screenCheckout(); break;
        case "combine":  body = screenCombine();  break;
        case "summary":  body = screenSummary();  break;
        case "people":   body = screenPeople();   break;
        case "guide":    body = screenGuide();    break;
        default:         body = screenHome();
      }
      out = appbar() + '<div class="screen">' + body + '</div>' + bottomnav();
    }
    app.innerHTML = out;
    lastKey = key;
    window.scrollTo(0, y);
  }

  /* ----------------------------- IDENTITY ------------------------------- */
  function screenIdentity() {
    var cards = state.users.map(function (u) {
      return '<button class="idcard" onclick="MS.chooseIdentity(' + u.id + ')">' + avatar(u, 46) + '<span>' + esc(u.name) + '</span></button>';
    }).join("");
    return '<div class="welcome"><h2>Who are you?</h2><p class="sub">Pick your name to see your lunch events and what you owe.</p></div>' +
      '<div class="idgrid">' + cards + '</div>' +
      '<div class="note" style="text-align:center;margin-top:16px">Names look wrong? Pick anyone for now — you can rename your lunch crew from 👥 People.</div>';
  }

  /* ------------------------------- HOME --------------------------------- */
  function screenHome() {
    var meId = state.currentUserId;
    var html = '<button class="btn btn-primary" style="margin-bottom:10px" onclick="MS.nav(\'create\')">＋ Create an event</button>';
    if (state.events.length > 1) html += '<button class="btn btn-teal btn-block" style="margin-bottom:14px" onclick="MS.openCombine()">🧮 Settle several events together</button>';
    html += '<h2 class="title" style="font-size:16px">Your events</h2>';

    if (!state.events.length) {
      html += '<div class="empty"><div class="big">🧾</div><b>No events yet</b><div class="sub" style="margin-top:4px">Tap “Create an event” to split your first lunch bill.</div></div>';
      return html;
    }

    html += '<div class="events">';
    state.events.slice().reverse().forEach(function (ev) {
      var sum = summary(ev), info = settleInfo(ev), pool = assignPool(ev);
      var inEvent = pool.indexOf(meId) !== -1;
      var avs = pool.slice(0, 5).map(function (id) { return avatar(userById(id)); }).join("");
      var extra = pool.length - 5;
      if (extra > 0) avs += '<span class="avatar" style="background:var(--muted)">+' + extra + '</span>';

      var chip;
      if (info.transfers.length && info.outstanding === 0) chip = '<span class="badge settled">✓ All settled</span>';
      else if (info.myOwe > EPS) chip = '<span class="badge owe">You owe ' + money(info.myOwe) + '</span>';
      else if (info.myOwed > EPS) chip = '<span class="badge owed">You’re owed ' + money(info.myOwed) + '</span>';
      else if (!inEvent) chip = '<span class="badge">Not in this event</span>';
      else if (info.outstanding > 0) chip = '<span class="badge">' + info.outstanding + ' to settle</span>';
      else chip = '<span class="badge settled">✓ Settled</span>';

      html += '<div class="event-card" onclick="MS.openEvent(\'' + ev.id + '\')">' +
        '<button class="cardx" title="Delete" onclick="event.stopPropagation();MS.deleteEvent(\'' + ev.id + '\')">✕</button>' +
        '<div class="top">' +
          '<div style="padding-right:22px"><p class="nm">' + esc(ev.name) + '</p><div class="dt">' + esc(fmtDate(ev.date)) + ' · Paid by ' + esc(firstName(userById(ev.payerId))) + '</div></div>' +
          '<div class="amt"><div class="v">' + money(sum.grand) + '</div><div class="l">total bill</div></div>' +
        '</div>' +
        '<div class="foot"><div class="avatars">' + avs + '</div>' + chip + '</div>' +
      '</div>';
    });
    html += '</div>';
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
        '<div class="ins" style="gap:0"><b>' + esc(u.name) + (isMe ? ' <span class="badge">you</span>' : '') + '</b></div>' +
      '</label>';
    }).join("");
    var payerOpts = state.users.map(function (u) {
      return '<option value="' + u.id + '"' + (u.id === state.currentUserId ? " selected" : "") + '>' + esc(u.name) + '</option>';
    }).join("");

    return '<button class="backbtn" onclick="MS.nav(\'home\')">‹ Back</button>' +
      '<h2 class="title">Create an event</h2>' +
      '<div class="card">' +
        '<div class="field"><label>Event name (e.g. Lunch, Tea, Dinner)</label><input id="ce-name" type="text" placeholder="e.g. Friday Lunch @ Nando’s"></div>' +
        '<div class="field"><label>Date</label><input id="ce-date" type="date" value="' + attr(todayISO()) + '"></div>' +
        '<div class="field" style="margin-bottom:0"><label>Who paid this bill?</label><select id="ce-payer">' + payerOpts + '</select></div>' +
      '</div>' +
      '<div class="card">' +
        '<h3>Who’s in this event?</h3>' +
        '<div class="sub" style="margin-bottom:8px">You (' + esc(firstName(me)) + ') are always included.</div>' +
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
    var pool = assignPool(ev);
    var sum = summary(ev), mine = share(ev, meId);

    var html = '<button class="backbtn" onclick="MS.nav(\'home\')">‹ All events</button>';
    html += '<h2 class="title" style="margin-bottom:2px">' + esc(ev.name) + '</h2>';
    html += '<div class="sub" style="margin-bottom:12px">' + esc(fmtDate(ev.date)) + ' · Paid by ' + esc(firstName(userById(ev.payerId))) +
            (isPayer ? ' (you)' : '') + ' · ' + pool.length + ' people</div>';

    /* Paid by (single payer, with More for guests) */
    html += paidByCard(ev);

    /* Items */
    html += '<div class="card"><h3>Items <span class="hint">' + (ev.items || []).length + ' line' + ((ev.items || []).length === 1 ? '' : 's') + '</span></h3>';
    if (!(ev.items || []).length) html += '<div class="sub" style="padding:6px 0 10px">No items yet.' + (isPayer ? ' Add the first line below.' : '') + '</div>';
    (ev.items || []).forEach(function (it) { html += itemRow(ev, it, isPayer, meId); });
    if (isPayer) {
      html += '<div class="divider"></div>' +
        '<div class="flex" style="align-items:flex-end">' +
          '<div class="grow"><label class="sub" style="font-weight:600">Item</label><input id="ai-name" type="text" placeholder="e.g. Chicken Rice"></div>' +
          '<div style="width:82px"><label class="sub" style="font-weight:600">Unit RM</label><input id="ai-price" type="number" inputmode="decimal" step="0.01" placeholder="0.00" style="text-align:right"></div>' +
          '<div style="width:52px"><label class="sub" style="font-weight:600">Qty</label><input id="ai-qty" type="number" inputmode="numeric" min="1" step="1" value="1" style="text-align:right"></div>' +
        '</div>' +
        '<label class="rowline" style="cursor:pointer"><span class="lb">Shared <span class="sub" style="font-weight:400">(pick who below)</span></span>' +
          '<span class="rt"><span class="switch"><input id="ai-shared" type="checkbox"><span class="slider"></span></span></span></label>' +
        '<button class="btn btn-teal btn-block btn-sm" style="margin-top:6px" onclick="MS.addItem(\'' + ev.id + '\')">＋ Add item</button>';
    }
    html += '</div>';

    html += chargesCard(ev, isPayer);

    /* Your share */
    html += '<div class="card yourshare"><h3 style="color:#fff">Your share</h3>' +
      sumline("Your items subtotal", money(mine.sub)) +
      (ev.serviceChargeEnabled ? sumline("Service charge (" + (Number(ev.serviceChargeRate) || 0) + "%)", money(mine.sc)) : "") +
      (ev.sstEnabled ? sumline("SST (" + (Number(ev.sstRate) || 0) + "%)", money(mine.sst)) : "") +
      '<div class="sumline total"><span>What you ate/drank</span><span>' + money(mine.total) + '</span></div>' +
      '</div>';

    html += settleCard(ev);

    /* Bill total */
    html += '<div class="card"><h3>Bill total</h3>' +
      sumline("Items subtotal", money(sum.itemsSub)) +
      (ev.serviceChargeEnabled ? sumline("Service charge (" + (Number(ev.serviceChargeRate) || 0) + "%)", money(sum.sc)) : "") +
      (ev.sstEnabled ? sumline("SST (" + (Number(ev.sstRate) || 0) + "%)", money(sum.sst)) : "") +
      '<div class="sumline total"><span>Grand total</span><span>' + money(sum.grand) + '</span></div>';
    if (sum.unassignedItems > 0) html += '<div class="warn">⚠︎ ' + sum.unassignedItems + ' item' + (sum.unassignedItems === 1 ? '' : 's') + ' (' + money(sum.unassigned) + ') not assigned yet — assign them so the split adds up.</div>';
    html += '</div>';

    html += '<button class="btn btn-danger btn-block" onclick="MS.deleteEvent(\'' + ev.id + '\')">🗑 Delete this event</button>';
    return html;
  }

  function paidByCard(ev) {
    var pool = assignPool(ev);
    var extras = state.users.filter(function (x) { return pool.indexOf(x.id) === -1; });
    var mk = "pay_" + ev.id;
    function chip(id, guest) {
      var u = userById(id), on = ev.payerId === id;
      return '<button class="chip ' + (on ? "active" : "") + (guest ? " guest" : "") + '" onclick="MS.setPayer(\'' + ev.id + '\',' + id + ')">' +
        '<span class="dot" style="background:' + color(id) + '">' + esc(initials(u.name)) + '</span>' + esc(firstName(u)) + '</button>';
    }
    return '<div class="card"><h3>Who paid <span class="hint">one payer per event</span></h3>' +
      '<div class="chips">' +
        pool.map(function (id) { return chip(id, false); }).join("") +
        (extras.length ? '<button class="chip more" onclick="MS.toggleMore(\'' + mk + '\')">' + (moreOpen[mk] ? 'Less ▲' : '＋ More (' + extras.length + ')') + '</button>' : '') +
      '</div>' +
      ((moreOpen[mk] && extras.length) ? '<div class="chips morebox">' + extras.map(function (x) { return chip(x.id, true); }).join("") + '</div>' : '') +
      '<div class="note">Tap ＋ More to pick a payer who wasn’t in the event. Combine events later to settle several meals at once.</div>' +
    '</div>';
  }

  function itemRow(ev, it, editable, meId) {
    var a = it.assignedTo || [], n = a.length;
    var perHead = n ? lineTotal(it) / n : 0;
    var isMine = a.indexOf(meId) !== -1;
    var tag = '<span class="tag ' + (it.shared ? "shared" : "indiv") + '">' + (it.shared ? "Shared" + (n ? " · " + n : "") : "Individual") + '</span>';
    var qtyLabel = (Number(it.qty) || 1) > 1 ? (it.qty + " × " + money(it.price) + " = ") : "";
    var html = '<div class="item">';

    if (editable) {
      var extras = state.users.filter(function (x) { return assignPool(ev).indexOf(x.id) === -1; });
      var chipFor = function (id, guest) {
        var uu = userById(id), on = a.indexOf(id) !== -1;
        return '<button class="chip ' + (on ? "active" : "") + (guest ? " guest" : "") + '" onclick="MS.toggleAssign(\'' + ev.id + '\',\'' + it.id + '\',' + id + ')">' +
          '<span class="dot" style="background:' + color(id) + '">' + esc(initials(uu.name)) + '</span>' + esc(firstName(uu)) + '</button>';
      };
      html += '<div class="r1">' +
          '<input id="nm_' + it.id + '" class="nm-in" type="text" value="' + attr(it.name) + '">' +
          '<button class="btn btn-sm btn-teal" title="Save changes to this item" onclick="MS.saveItem(\'' + ev.id + '\',\'' + it.id + '\')">💾 Save</button>' +
          '<button class="del" title="Remove" onclick="MS.removeItem(\'' + ev.id + '\',\'' + it.id + '\')">🗑</button>' +
        '</div>' +
        '<div class="r2" style="gap:8px">' +
          '<span class="meta">RM</span><input id="pr_' + it.id + '" class="price-in" style="width:78px" type="number" inputmode="decimal" step="0.01" value="' + attr(it.price) + '">' +
          '<span class="meta">×</span><input id="qt_' + it.id + '" class="price-in" style="width:52px" type="number" inputmode="numeric" min="1" step="1" value="' + attr(it.qty || 1) + '">' +
          '<span class="meta" style="margin-left:auto;font-weight:700">' + money(lineTotal(it)) + '</span>' +
        '</div>' +
        '<div class="r2">' + tag +
          '<label class="meta" style="display:inline-flex;align-items:center;gap:6px;cursor:pointer"><span class="switch" style="width:38px;height:22px"><input type="checkbox"' + (it.shared ? " checked" : "") + ' onchange="MS.setShared(\'' + ev.id + '\',\'' + it.id + '\',this.checked)"><span class="slider"></span></span> shared</label>' +
          '<span class="meta" style="margin-left:auto">' + (n ? money(perHead) + " each" : "unassigned") + '</span>' +
        '</div>' +
        '<div class="assign"><div class="chips">' +
          assignPool(ev).map(function (id) { return chipFor(id, false); }).join("") +
          '<button class="chip" onclick="MS.assignAll(\'' + ev.id + '\',\'' + it.id + '\',true)">All</button>' +
          '<button class="chip" onclick="MS.assignAll(\'' + ev.id + '\',\'' + it.id + '\',false)">Clear</button>' +
          (extras.length ? '<button class="chip more" onclick="MS.toggleMore(\'' + it.id + '\')">' + (moreOpen[it.id] ? 'Less ▲' : '＋ More (' + extras.length + ')') + '</button>' : '') +
        '</div>' +
          ((moreOpen[it.id] && extras.length) ? '<div class="chips morebox">' + extras.map(function (x) { return chipFor(x.id, true); }).join("") + '</div>' : '') +
        '</div>';
    } else {
      html += '<div class="r1"><span class="nm-in">' + esc(it.name) + ' ' + tag + '</span>' +
        '<span style="font-weight:700">' + money(lineTotal(it)) + '</span></div>';
      html += '<div class="r2"><span class="meta">' + qtyLabel + (n ? money(perHead) + " each" : "not assigned") + '</span>' +
        '<span class="avatars" style="margin-left:auto">' + a.map(function (id) { return avatar(userById(id), 22); }).join("") + '</span></div>';
      html += '<button class="btn btn-sm ' + (isMine ? "btn-ghost" : "btn-teal") + '" style="margin-top:9px;width:100%" onclick="MS.toggleAssign(\'' + ev.id + '\',\'' + it.id + '\',' + meId + ')">' +
        (isMine ? "🛒 ✓ In your cart — tap to remove" : "🛒 Add to cart") + '</button>';
    }
    html += '</div>';
    return html;
  }

  function chargesCard(ev, editable) {
    if (editable) {
      return '<div class="card"><h3>Service charge & SST <span class="hint">payer confirms</span></h3>' +
        '<div class="rowline"><span class="lb">Service charge</span><span class="rt">' +
          '<input class="rate-in" type="number" step="0.5" min="0" value="' + attr(ev.serviceChargeRate) + '" onchange="MS.setCharge(\'' + ev.id + '\')" id="sc-rate">%</span></div>' +
        '<div class="rowline"><span class="lb">SST</span><span class="rt">' +
          '<input class="rate-in" type="number" step="0.5" min="0" value="' + attr(ev.sstRate) + '" onchange="MS.setCharge(\'' + ev.id + '\')" id="sst-rate">%</span></div>' +
        '<div class="note">SST is charged on the items subtotal, before service charge. Malaysia default: 10% service charge and 6% SST. Set a rate to 0 to remove it.</div>' +
      '</div>';
    }
    return '<div class="card"><h3>Service charge & SST</h3>' +
      '<div class="rowline"><span class="lb">Service charge</span><span class="rt">' + (ev.serviceChargeEnabled ? (Number(ev.serviceChargeRate) || 0) + '%' : '—') + '</span></div>' +
      '<div class="rowline"><span class="lb">SST</span><span class="rt">' + (ev.sstEnabled ? (Number(ev.sstRate) || 0) + '%' : '—') + '</span></div>' +
    '</div>';
  }

  function settleCard(ev) {
    var info = settleInfo(ev), me = state.currentUserId, grand = summary(ev).grand;

    var html = '<div class="card"><h3>Settle up</h3>';
    if (info.myOwe > EPS) html += '<span class="pill owe">You owe ' + money(info.myOwe) + '</span>';
    else if (info.myOwed > EPS) html += '<span class="pill get">You’re owed ' + money(info.myOwed) + '</span>';
    else html += '<span class="pill done">You’re all settled ✓</span>';

    html += '<table class="bd" style="margin-top:10px"><thead><tr><th>Person</th><th>Ate</th><th>Paid</th><th>Net</th></tr></thead><tbody>';
    assignPool(ev).forEach(function (id) {
      var u = userById(id), s = share(ev, id).total, p = (id === ev.payerId ? grand : 0), net = p - s;
      var done = personSettled(ev, info.transfers, id);
      var col = net > EPS ? "var(--ok)" : (net < -EPS ? "var(--danger)" : "inherit");
      html += '<tr class="' + (id === me ? "me" : "") + '" style="' + (done ? "opacity:.45" : "") + '">' +
        '<td>' + esc(firstName(u)) + (id === ev.payerId ? ' <span class="badge">payer</span>' : '') + (done ? ' ✓' : '') + '</td>' +
        '<td>' + money(s) + '</td><td>' + money(p) + '</td>' +
        '<td style="color:' + col + '">' + signed(net) + '</td></tr>';
    });
    html += '</tbody></table>';

    html += '<div style="margin-top:14px;font-weight:700;font-size:13px">Who pays who</div>';
    if (!info.transfers.length) html += '<div class="sub" style="margin-top:4px">All balanced — nothing to transfer.</div>';
    info.transfers.forEach(function (t) {
      var paid = transferPaid(ev, t), from = userById(t.from), to = userById(t.to);
      var hint = t.from === me ? "You pay " + esc(firstName(to)) : (t.to === me ? esc(firstName(from)) + " pays you" : "");
      html += '<div class="xfer' + (paid ? " dim" : "") + '">' + avatar(from, 26) +
        '<div style="flex:1;min-width:0"><b' + (paid ? ' class="strike"' : '') + '>' + esc(firstName(from)) + ' → ' + esc(firstName(to)) + '</b>' +
          (hint ? '<div class="sub">' + hint + '</div>' : '') + '</div>' +
        '<span class="xamt' + (paid ? ' strike" ' : '"') + '>' + money(t.amount) + '</span>' +
        '<button class="btn btn-sm ' + (paid ? "btn-ghost" : "btn-teal") + '" onclick="MS.markPaid(\'' + ev.id + '\',' + t.from + ',' + t.to + ',' + (paid ? "false" : "true") + ')">' + (paid ? "Undo" : "Mark paid") + '</button>' +
      '</div>';
    });
    html += '</div>';
    return html;
  }

  function sumline(label, val) { return '<div class="sumline"><span class="muted">' + esc(label) + '</span><span>' + val + '</span></div>'; }

  /* ---------------------------- CHECKOUT (global cart) ------------------ */
  function screenCheckout() {
    var me = state.currentUserId;
    var oweList = state.events.filter(function (e) { return e.payerId !== me && share(e, me).total > EPS; });
    var owedList = state.events.filter(function (e) { return e.payerId === me; });

    var html = '<button class="backbtn" onclick="MS.nav(\'home\')">‹ Back</button>' +
      '<h2 class="title">🛒 Your cart</h2>' +
      '<div class="sub" style="margin:-6px 2px 12px">Everything you owe across all your events, and who to pay.</div>';

    // Overall owed + who to pay (grouped by payer).
    var totalOwe = 0, payerTotals = {};
    oweList.forEach(function (e) {
      if (transferPaid(e, { from: me, to: e.payerId })) return;
      var t = share(e, me).total;
      totalOwe += t; payerTotals[e.payerId] = (payerTotals[e.payerId] || 0) + t;
    });

    html += '<div class="card"><h3>You owe</h3>';
    if (totalOwe <= EPS) {
      html += '<span class="pill done">Nothing to pay — you’re all settled ✓</span>';
    } else {
      html += '<div class="sumline total" style="border-top:0;margin-top:0"><span>Total to pay</span><span>' + money(totalOwe) + '</span></div>' +
        '<div style="margin-top:8px;font-weight:700;font-size:13px">Pay to</div>';
      Object.keys(payerTotals).map(Number).forEach(function (pid) {
        html += '<div class="rowline"><span class="lb" style="display:flex;align-items:center;gap:8px">' + avatar(userById(pid), 22) + esc(firstName(userById(pid))) + '</span><span class="rt">' + money(payerTotals[pid]) + '</span></div>';
      });
    }
    html += '</div>';

    // Per-event breakdown — each item labelled with the event it belongs to.
    if (!oweList.length) html += '<div class="card"><div class="sub">Your cart is empty. Open an event and tap “🛒 Add to cart” on what you had.</div></div>';
    oweList.forEach(function (e) {
      var cart = (e.items || []).filter(function (it) { return (it.assignedTo || []).indexOf(me) !== -1; });
      var s = share(e, me), paid = transferPaid(e, { from: me, to: e.payerId });
      html += '<div class="card" style="' + (paid ? "opacity:.55" : "") + '"><h3>' + esc(e.name) + ' <span class="hint">' + esc(fmtDate(e.date)) + '</span></h3>' +
        '<div class="sub" style="margin:-4px 0 8px">Pay ' + esc(firstName(userById(e.payerId))) + '</div>';
      cart.forEach(function (it) {
        var nn = (it.assignedTo || []).length, head = lineTotal(it) / nn;
        html += '<div class="rowline"><span class="lb">' + esc(it.name) + (it.shared ? ' <span class="tag shared">shared ÷' + nn + '</span>' : '') + '</span><span class="rt">' + money(head) + '</span></div>';
      });
      html += sumline("Subtotal", money(s.sub));
      if (s.sc > EPS) html += sumline("Service charge", money(s.sc));
      if (s.sst > EPS) html += sumline("SST", money(s.sst));
      html += '<div class="sumline total"><span>' + (paid ? "Paid ✓" : "You owe " + esc(firstName(userById(e.payerId)))) + '</span><span' + (paid ? ' class="strike"' : '') + '>' + money(s.total) + '</span></div>' +
        '<button class="btn btn-sm ' + (paid ? "btn-ghost" : "btn-teal") + ' btn-block" style="margin-top:8px" onclick="MS.markCartPaid(\'' + e.id + '\',' + (paid ? "false" : "true") + ')">' + (paid ? "Undo" : "✓ Mark paid") + '</button>' +
      '</div>';
    });

    // Owed to you — when you're the payer in some events.
    var totalOwed = 0, owedRows = [];
    owedList.forEach(function (e) {
      settleInfo(e).transfers.filter(function (t) { return t.to === me; }).forEach(function (t) {
        var paid = transferPaid(e, t);
        if (!paid) totalOwed += t.amount;
        owedRows.push({ ev: e, t: t, paid: paid });
      });
    });
    if (owedRows.length) {
      html += '<div class="card"><h3>💰 Owed to you <span class="hint">' + money(totalOwed) + ' outstanding</span></h3>';
      owedRows.forEach(function (r) {
        html += '<div class="xfer' + (r.paid ? " dim" : "") + '">' + avatar(userById(r.t.from), 26) +
          '<div style="flex:1;min-width:0"><b' + (r.paid ? ' class="strike"' : '') + '>' + esc(firstName(userById(r.t.from))) + '</b><div class="sub">' + esc(r.ev.name) + '</div></div>' +
          '<span class="xamt' + (r.paid ? ' strike" ' : '"') + '>' + money(r.t.amount) + '</span>' +
          '<button class="btn btn-sm ' + (r.paid ? "btn-ghost" : "btn-teal") + '" onclick="MS.markPaid(\'' + r.ev.id + '\',' + r.t.from + ',' + r.t.to + ',' + (r.paid ? "false" : "true") + ')">' + (r.paid ? "Undo" : "Got it") + '</button></div>';
      });
      html += '</div>';
    }

    html += '<button class="btn btn-primary btn-block" onclick="MS.nav(\'home\')">Back to home</button>';
    return html;
  }

  /* ---------------------------- COMBINE --------------------------------- */
  function screenCombine() {
    var selected = state.events.filter(function (e) { return combineSel[e.id]; });
    var html = '<button class="backbtn" onclick="MS.nav(\'home\')">‹ Back</button>' +
      '<h2 class="title">Settle events together</h2>' +
      '<div class="sub" style="margin:-6px 2px 12px">Tick the meals to combine (e.g. Lunch + Tea + Dinner). The app nets everyone across them and shows the fewest payments.</div>';

    html += '<div class="card"><h3>Choose events <span class="hint">' + selected.length + ' selected</span></h3>';
    state.events.slice().reverse().forEach(function (ev) {
      html += '<label class="payrow" style="cursor:pointer">' +
        '<input type="checkbox"' + (combineSel[ev.id] ? " checked" : "") + ' style="width:20px;height:20px" onchange="MS.toggleCombine(\'' + ev.id + '\')">' +
        '<div style="flex:1;min-width:0"><b>' + esc(ev.name) + '</b><div class="sub">' + esc(fmtDate(ev.date)) + ' · Paid by ' + esc(firstName(userById(ev.payerId))) + '</div></div>' +
        '<span style="font-weight:700">' + money(summary(ev).grand) + '</span></label>';
    });
    html += '</div>';

    if (selected.length < 2) {
      html += '<div class="card"><div class="sub">Select at least 2 events to see the combined settle-up.</div></div>';
      return html;
    }

    var agg = aggregateInfo(selected);
    var me = state.currentUserId;
    var total = selected.reduce(function (t, e) { return t + summary(e).grand; }, 0);

    var outstanding = agg.transfers.filter(function (t) { return !combinedTransferPaid(selected, t); });
    var involved = {}, myOwe = 0, myOwed = 0;
    outstanding.forEach(function (t) { involved[t.from] = 1; involved[t.to] = 1; if (t.from === me) myOwe += t.amount; if (t.to === me) myOwed += t.amount; });

    html += '<div class="card"><h3>Combined settle-up <span class="hint">' + selected.length + ' events · ' + money(total) + '</span></h3>';
    if (myOwe > EPS) html += '<span class="pill owe">You owe ' + money(myOwe) + ' overall</span>';
    else if (myOwed > EPS) html += '<span class="pill get">You’re owed ' + money(myOwed) + ' overall</span>';
    else html += '<span class="pill done">You’re all settled ✓</span>';

    html += '<table class="bd" style="margin-top:10px"><thead><tr><th>Person</th><th>Ate</th><th>Paid</th><th>Net</th></tr></thead><tbody>';
    Object.keys(agg.rows).map(Number).sort(function (a, b) { return agg.rows[b].net - agg.rows[a].net; }).forEach(function (id) {
      var r = agg.rows[id], col = r.net > EPS ? "var(--ok)" : (r.net < -EPS ? "var(--danger)" : "inherit");
      var done = !involved[id];
      html += '<tr class="' + (id === me ? "me" : "") + '" style="' + (done ? "opacity:.45" : "") + '"><td>' + esc(firstName(userById(id))) + (done ? ' ✓' : '') + '</td>' +
        '<td>' + money(r.ate) + '</td><td>' + money(r.paid) + '</td>' +
        '<td style="color:' + col + '">' + signed(r.net) + '</td></tr>';
    });
    html += '</tbody></table>';

    html += '<div style="margin-top:14px;font-weight:700;font-size:13px">Who pays who (overall)</div>';
    if (!agg.transfers.length) html += '<div class="sub" style="margin-top:4px">Everyone’s even — no payments needed.</div>';
    agg.transfers.forEach(function (t) {
      var paid = combinedTransferPaid(selected, t), from = userById(t.from), to = userById(t.to);
      var hint = t.from === me ? "You pay " + esc(firstName(to)) : (t.to === me ? esc(firstName(from)) + " pays you" : "");
      html += '<div class="xfer' + (paid ? " dim" : "") + '">' + avatar(from, 26) +
        '<div style="flex:1;min-width:0"><b' + (paid ? ' class="strike"' : '') + '>' + esc(firstName(from)) + ' → ' + esc(firstName(to)) + '</b>' + (hint ? '<div class="sub">' + hint + '</div>' : '') + '</div>' +
        '<span class="xamt' + (paid ? ' strike" ' : '"') + '>' + money(t.amount) + '</span>' +
        '<button class="btn btn-sm ' + (paid ? "btn-ghost" : "btn-teal") + '" onclick="MS.markCombinedPaid(' + t.from + ',' + (paid ? "false" : "true") + ')">' + (paid ? "Undo" : "Mark paid") + '</button>' +
      '</div>';
    });
    html += '<div class="note">Marking a payment here also marks it settled inside each of those events. When everyone has paid, every event shows as settled.</div>';
    html += '</div>';
    return html;
  }

  /* ------------------------------ SUMMARY ------------------------------- */
  function screenSummary() {
    var me = state.currentUserId;
    var html = '<h2 class="title">📊 Summary</h2>';
    if (!state.events.length) return html + '<div class="empty"><div class="big">📊</div><b>No events yet</b><div class="sub" style="margin-top:4px">Create some events and this shows the overall who-owes-who.</div></div>';

    var agg = aggregateInfo(state.events);
    var outstanding = agg.transfers.filter(function (t) { return !combinedTransferPaid(state.events, t); });
    var involved = {}, myOwe = 0, myOwed = 0;
    outstanding.forEach(function (t) { involved[t.from] = 1; involved[t.to] = 1; if (t.from === me) myOwe += t.amount; if (t.to === me) myOwed += t.amount; });

    html += '<div class="sub" style="margin:-6px 2px 12px">Across all ' + state.events.length + ' event' + (state.events.length === 1 ? '' : 's') + ' — the overall picture of who owes who.</div>';

    html += '<div class="card"><h3>Your position</h3>';
    if (myOwe > EPS) html += '<span class="pill owe">You owe ' + money(myOwe) + ' overall</span>';
    else if (myOwed > EPS) html += '<span class="pill get">You’re owed ' + money(myOwed) + ' overall</span>';
    else html += '<span class="pill done">You’re all settled ✓</span>';
    html += '</div>';

    html += '<div class="card"><h3>Who owes who</h3>';
    if (!agg.transfers.length) {
      html += '<div class="sub">Everyone’s even — nothing outstanding. 🎉</div>';
    } else {
      html += '<table class="bd"><thead><tr><th>Who</th><th></th><th>Whom</th><th>Amount</th><th></th></tr></thead><tbody>';
      agg.transfers.forEach(function (t) {
        var paid = combinedTransferPaid(state.events, t);
        html += '<tr style="' + (paid ? "opacity:.45" : "") + '"><td>' + esc(firstName(userById(t.from))) + '</td>' +
          '<td style="text-align:center;color:var(--muted)">→</td><td>' + esc(firstName(userById(t.to))) + '</td>' +
          '<td' + (paid ? ' class="strike"' : '') + '>' + money(t.amount) + '</td>' +
          '<td><button class="linkbtn" onclick="MS.markSummaryPaid(' + t.from + ',' + (paid ? "false" : "true") + ')">' + (paid ? "Undo" : "Paid") + '</button></td></tr>';
      });
      html += '</tbody></table>';
    }
    html += '</div>';

    html += '<div class="card"><h3>Everyone overall</h3><table class="bd"><thead><tr><th>Person</th><th>Ate</th><th>Paid</th><th>Net</th></tr></thead><tbody>';
    Object.keys(agg.rows).map(Number).sort(function (a, b) { return agg.rows[b].net - agg.rows[a].net; }).forEach(function (id) {
      var r = agg.rows[id], col = r.net > EPS ? "var(--ok)" : (r.net < -EPS ? "var(--danger)" : "inherit"), done = !involved[id];
      html += '<tr class="' + (id === me ? "me" : "") + '" style="' + (done ? "opacity:.5" : "") + '"><td>' + esc(firstName(userById(id))) + (done ? ' ✓' : '') + '</td>' +
        '<td>' + money(r.ate) + '</td><td>' + money(r.paid) + '</td><td style="color:' + col + '">' + signed(r.net) + '</td></tr>';
    });
    html += '</tbody></table></div>';
    return html;
  }

  /* ------------------------------ GUIDE --------------------------------- */
  function screenGuide() {
    function step(n, title, body) {
      return '<div class="gstep"><span class="gnum">' + n + '</span><div><b>' + title + '</b><div class="sub">' + body + '</div></div></div>';
    }
    return '<h2 class="title">📖 How to use Makan Split</h2>' +
      '<div class="card"><h3>The basics</h3>' +
        step(1, "Pick who you are", "Use the “You are …” dropdown at the top to switch to another person any time.") +
        step(2, "Create an event", "One event = one meal. Set the name, the date, and who paid the bill.") +
        step(3, "Payer adds, payees select", "Only the payer can input the items. Everyone else (the payees) can see the list and select which items are theirs.") +
        step(4, "Add the items", "The payer punches in each line with a unit price and quantity, then taps 💾 Save to commit an edit.") +
        step(5, "Mark shared items", "The payer flips “Shared” and taps the people who split it. Use ＋ More to add a friend who wasn’t in the event.") +
      '</div>' +
      '<div class="card"><h3>Paying your share</h3>' +
        step(6, "Add to cart", "As a payee, tap 🛒 Add to cart on the items you had.") +
        step(7, "Checkout", "Tap the 🛒 cart icon (top-right) to see your total across all events and who to pay, then Mark paid.") +
      '</div>' +
      '<div class="card"><h3>Settling up</h3>' +
        step(8, "Service charge & SST", "The payer sets the rates (Malaysia: 10% service charge + 6% SST on the subtotal). Set a rate to 0 to remove it.") +
        step(9, "Who owes who", "Each event’s “Settle up” shows who pays the payer, with a Mark paid button.") +
        step(10, "Combine meals", "On the Events page, “🧮 Settle several events together” nets lunch + tea + dinner into the fewest payments.") +
        step(11, "Summary tab", "📊 Summary shows the overall who-owes-who across every event.") +
      '</div>' +
      '<div class="note" style="text-align:center">Everything is saved on your device — no account needed.</div>';
  }

  /* ------------------------------ PEOPLE -------------------------------- */
  function screenPeople() {
    var rows = state.users.map(function (u) {
      return '<div class="prow">' + avatar(u, 34) +
        '<div class="ins"><input type="text" value="' + attr(u.name) + '" placeholder="Name" onchange="MS.saveUser(' + u.id + ',this.value)"></div></div>';
    }).join("");
    return '<button class="backbtn" onclick="MS.nav(\'home\')">‹ Back</button>' +
      '<h2 class="title">People (' + MAX_PEOPLE + ')</h2>' +
      '<div class="sub" style="margin:-6px 2px 12px">This app is set up for a fixed group of ' + MAX_PEOPLE + '. Name your regular lunch crew here — each person just picks their name when they open the app.</div>' +
      '<div class="card">' + rows + '</div>';
  }

  /* ------------------------------ actions ------------------------------- */
  window.MS = {
    render: render,
    nav: function (screen, eventId) { state.ui = { screen: screen, eventId: eventId || null }; save(); render(); },
    openEvent: function (id) { state.ui = { screen: "event", eventId: id }; save(); render(); },
    switchUser: function (id) { state.currentUserId = Number(id) || 1; save(); render(); },
    chooseIdentity: function (id) { state.currentUserId = Number(id) || 1; identityConfirmed = true; state.ui = { screen: "home", eventId: null }; save(); render(); },
    toggleMore: function (k) { flushAllItemInputs(); moreOpen[k] = !moreOpen[k]; render(); },
    openCombine: function () { combineSel = {}; state.events.forEach(function (e) { combineSel[e.id] = true; }); state.ui = { screen: "combine", eventId: null }; save(); render(); },
    toggleCombine: function (id) { combineSel[id] = !combineSel[id]; render(); },

    submitCreate: function () {
      var name = (document.getElementById("ce-name").value || "").trim() || "Lunch";
      var date = document.getElementById("ce-date").value || todayISO();
      var payer = Number(document.getElementById("ce-payer").value) || state.currentUserId;
      var ids = [];
      document.querySelectorAll(".ce-p:checked").forEach(function (c) { ids.push(Number(c.value)); });
      if (ids.indexOf(state.currentUserId) === -1) ids.unshift(state.currentUserId);
      if (ids.indexOf(payer) === -1) ids.push(payer);
      var ev = { id: uid("evt_"), name: name, date: date, payerId: payer, participantIds: ids,
        serviceChargeEnabled: true, serviceChargeRate: DEFAULT_SC, sstEnabled: true, sstRate: DEFAULT_SST,
        paid: {}, items: [] };
      state.events.push(ev);
      state.ui = { screen: "event", eventId: ev.id };
      save(); render();
    },

    addItem: function (eventId) {
      var ev = eventById(eventId); if (!ev) return;
      flushAllItemInputs();
      var nameEl = document.getElementById("ai-name"), priceEl = document.getElementById("ai-price");
      var name = (nameEl.value || "").trim(), price = parseFloat(priceEl.value);
      if (!name || isNaN(price)) { nameEl.focus(); return; }
      var qty = parseInt(document.getElementById("ai-qty").value, 10); if (!qty || qty < 1) qty = 1;
      var shared = document.getElementById("ai-shared").checked;
      ev.items.push({ id: uid("it_"), name: name, price: price, qty: qty, shared: shared,
        assignedTo: shared ? assignPool(ev) : [] });
      save(); render();
    },
    saveItem: function (eventId, itemId) {
      var ev = eventById(eventId); if (!ev) return; var it = itemById(ev, itemId); if (!it) return;
      flushAllItemInputs(); save(); render();
    },
    removeItem: function (eventId, itemId) {
      var ev = eventById(eventId); if (!ev) return;
      flushAllItemInputs();
      ev.items = (ev.items || []).filter(function (x) { return x.id !== itemId; }); save(); render();
    },
    setShared: function (eventId, itemId, val) {
      var ev = eventById(eventId); if (!ev) return; var it = itemById(ev, itemId); if (!it) return;
      flushAllItemInputs();
      it.shared = !!val;
      if (val && !(it.assignedTo || []).length) it.assignedTo = assignPool(ev);
      save(); render();
    },
    toggleAssign: function (eventId, itemId, userId) {
      var ev = eventById(eventId); if (!ev) return; var it = itemById(ev, itemId); if (!it) return;
      flushAllItemInputs();
      var a = it.assignedTo || [], i = a.indexOf(userId);
      if (i === -1) a.push(userId); else a.splice(i, 1);
      it.assignedTo = a; save(); render();
    },
    assignAll: function (eventId, itemId, val) {
      var ev = eventById(eventId); if (!ev) return; var it = itemById(ev, itemId); if (!it) return;
      flushAllItemInputs();
      it.assignedTo = val ? assignPool(ev) : []; save(); render();
    },
    setCharge: function (eventId) {
      var ev = eventById(eventId); if (!ev) return;
      flushAllItemInputs();
      ev.serviceChargeRate = parseFloat(document.getElementById("sc-rate").value) || 0;
      ev.sstRate = parseFloat(document.getElementById("sst-rate").value) || 0;
      ev.serviceChargeEnabled = ev.serviceChargeRate > 0;   // a charge applies when its rate > 0
      ev.sstEnabled = ev.sstRate > 0;
      save(); render();
    },
    setPayer: function (eventId, userId) {
      var ev = eventById(eventId); if (!ev) return; flushAllItemInputs(); ev.payerId = Number(userId); save(); render();
    },
    markPaid: function (eventId, fromId, toId, val) {
      var ev = eventById(eventId); if (!ev) return;
      flushAllItemInputs();
      if (!ev.paid) ev.paid = {};
      var k = xferKey(fromId, toId);
      if (val) ev.paid[k] = true; else delete ev.paid[k];
      save(); render();
    },
    // Mark a person settled across the combined (or all) events; syncs to each event.
    markCombinedPaid: function (fromId, val) { settleAcross(state.events.filter(function (e) { return combineSel[e.id]; }), Number(fromId), val); },
    markSummaryPaid: function (fromId, val) { settleAcross(state.events.slice(), Number(fromId), val); },
    openCheckout: function () { state.ui = { screen: "checkout", eventId: null }; save(); render(); },
    markCartPaid: function (eventId, val) {
      var ev = eventById(eventId); if (!ev) return;
      var me = state.currentUserId;
      if (!ev.paid) ev.paid = {};
      var k = xferKey(me, ev.payerId);
      if (val) ev.paid[k] = true; else delete ev.paid[k];
      save();
      // Paid off everything you owe? Celebrate by heading home.
      var stillOwe = state.events.some(function (e) { return e.payerId !== me && share(e, me).total > EPS && !transferPaid(e, { from: me, to: e.payerId }); });
      if (val && !stillOwe) state.ui = { screen: "home", eventId: null };
      render();
    },
    deleteEvent: function (eventId) {
      var ev = eventById(eventId);
      if (ev && !confirm('Delete "' + ev.name + '"? This cannot be undone.')) return;
      state.events = state.events.filter(function (x) { return x.id !== eventId; });
      delete combineSel[eventId];
      state.ui = { screen: "home", eventId: null }; save(); render();
    },
    saveUser: function (userId, value) {
      var u = userById(userId); if (!u) return; u.name = value; save(); render();
    },
    install: function () {
      var d = window.__deferredInstall; if (!d) return;
      d.prompt(); d.userChoice.finally(function () { window.__deferredInstall = null; render(); });
    }
  };

  var LOGO_SVG = '<svg class="logo" viewBox="0 0 512 512" aria-hidden="true"><rect width="512" height="512" rx="120" fill="rgba(255,255,255,.22)"/><path d="M150 120h150a18 18 0 0 1 18 18v230l-28-16-28 16-28-16-28 16-28-16-28 16V138a18 18 0 0 1 18-18Z" fill="#fff"/><rect x="176" y="168" width="98" height="14" rx="7" fill="#ffd8c6"/><rect x="176" y="200" width="78" height="12" rx="6" fill="#ffe3d6"/><rect x="176" y="228" width="88" height="12" rx="6" fill="#ffe3d6"/><circle cx="352" cy="348" r="70" fill="#0f9d8f" stroke="#fff" stroke-width="12"/><rect x="320" y="341" width="64" height="14" rx="7" fill="#fff"/><circle cx="352" cy="322" r="8" fill="#fff"/><circle cx="352" cy="374" r="8" fill="#fff"/></svg>';

  if (!identityConfirmed) state.ui = { screen: "identity", eventId: null };
  render();
})();
