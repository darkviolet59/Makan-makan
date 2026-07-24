/* ============================================================================
   Makan Split — a lunch bill splitter PWA
   Vanilla JS, no build step. All data is stored on the device (localStorage).
   ----------------------------------------------------------------------------
   - One or more people can PAY the bill; everyone pays their share back.
   - The payer(s) snap the receipt and "punch in" each line.
   - Each item is Individual (one person) or Shared (split equally).
   - Each person picks who they are, then taps the items they had.
   - Service charge + SST are added on top (SST on the subtotal, before service
     charge). The app nets everyone out to the fewest "X pays Y" transfers.
   ========================================================================== */
(function () {
  "use strict";

  var LS_KEY = "makanSplit.v1";
  var MAX_PEOPLE = 16;
  var DEFAULT_SC = 10;   // service charge %  (Malaysia F&B is typically 10%)
  var DEFAULT_SST = 6;   // SST / service tax % (Malaysia is 6%)
  var EPS = 0.005;       // rounding tolerance

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
      payerIds: [1],
      payments: {},
      paid: {},
      participantIds: [1, 2, 3, 4],
      serviceChargeEnabled: true, serviceChargeRate: DEFAULT_SC,
      sstEnabled: true, sstRate: DEFAULT_SST,
      receiptThumb: null,
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

  // Bring older saved events up to the current model (single payer -> payers list).
  (function normalize() {
    (state.events || []).forEach(function (ev) {
      if (!Array.isArray(ev.payerIds)) ev.payerIds = (ev.payerId != null) ? [ev.payerId] : [((ev.participantIds || [])[0]) || 1];
      if (!ev.payments || typeof ev.payments !== "object") ev.payments = {};
      if (!ev.paid || typeof ev.paid !== "object") ev.paid = {};
      if (!Array.isArray(ev.participantIds)) ev.participantIds = ev.payerIds.slice();
      ev.payerIds.forEach(function (id) { if (ev.participantIds.indexOf(id) === -1) ev.participantIds.push(id); });
      delete ev.payerId; delete ev.status; delete ev.sstOnServiceCharge;
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
  function fmtDate(iso) { if (!iso) return ""; var d = new Date(iso + "T00:00:00");
    if (isNaN(d)) return iso;
    return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" }); }
  function payersLabel(ev) { return (ev.payerIds || []).map(function (id) { return firstName(userById(id)); }).join(" + "); }

  /* --------------------------- calculations ----------------------------- */
  // One person's share = sum of (item price / people sharing it) for their items,
  // then service charge, then SST on the items subtotal (before service charge).
  function share(ev, userId) {
    var sub = 0;
    (ev.items || []).forEach(function (it) {
      var a = it.assignedTo || [];
      if (a.length && a.indexOf(userId) !== -1) sub += (Number(it.price) || 0) / a.length;
    });
    var scRate = ev.serviceChargeEnabled ? (Number(ev.serviceChargeRate) || 0) : 0;
    var sstRate = ev.sstEnabled ? (Number(ev.sstRate) || 0) : 0;
    var sc = sub * scRate / 100;
    var sst = sub * sstRate / 100;
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
    var sst = itemsSub * sstRate / 100;
    return { itemsSub: itemsSub, unassigned: itemsSub - assignedSub, unassignedItems: unassignedItems,
             sc: sc, sst: sst, grand: itemsSub + sc + sst };
  }

  // How much each payer actually put in. Single payer => the whole bill.
  function effectivePayments(ev) {
    var out = {};
    if ((ev.payerIds || []).length <= 1) {
      if (ev.payerIds && ev.payerIds.length === 1) out[ev.payerIds[0]] = summary(ev).grand;
      return out;
    }
    ev.payerIds.forEach(function (id) { out[id] = Number((ev.payments || {})[id]) || 0; });
    return out;
  }

  // Everyone involved in an event: those who joined, the payers, and anyone assigned
  // to an item (e.g. a friend added via "＋ More" who wasn't originally in the event).
  function assignPool(ev) {
    var out = (ev.participantIds || []).slice();
    function add(id) { if (out.indexOf(id) === -1) out.push(id); }
    (ev.payerIds || []).forEach(add);
    (ev.items || []).forEach(function (it) { (it.assignedTo || []).forEach(add); });
    return out;
  }

  // Reduce everyone's net position to the fewest "debtor pays creditor" transfers.
  // Net = what you paid − what you owe. This naturally cancels mutual debts.
  function settleUp(ev) {
    var pays = effectivePayments(ev);
    var nets = {};
    var creditors = [], debtors = [];
    assignPool(ev).forEach(function (id) {
      var net = (pays[id] || 0) - share(ev, id).total;
      nets[id] = net;
      if (net > EPS) creditors.push({ id: id, amt: net });
      else if (net < -EPS) debtors.push({ id: id, amt: -net });
    });
    creditors.sort(function (a, b) { return b.amt - a.amt; });
    debtors.sort(function (a, b) { return b.amt - a.amt; });
    var transfers = [], ci = 0, di = 0;
    while (ci < creditors.length && di < debtors.length) {
      var pay = Math.min(creditors[ci].amt, debtors[di].amt);
      if (pay > EPS) transfers.push({ from: debtors[di].id, to: creditors[ci].id, amount: Math.round(pay * 100) / 100 });
      creditors[ci].amt -= pay; debtors[di].amt -= pay;
      if (creditors[ci].amt <= EPS) ci++;
      if (debtors[di].amt <= EPS) di++;
    }
    return { transfers: transfers, nets: nets };
  }
  function xferKey(from, to) { return from + "_" + to; }
  function transferPaid(ev, t) { return !!((ev.paid || {})[xferKey(t.from, t.to)]); }
  function personSettled(ev, transfers, id) {
    for (var i = 0; i < transfers.length; i++) if (transfers[i].from === id && !transferPaid(ev, transfers[i])) return false;
    return true; // owes nothing outstanding (payer, balanced, or fully paid)
  }
  function settleInfo(ev) {
    var s = settleUp(ev), me = state.currentUserId, myOwe = 0, myOwed = 0, outstanding = 0;
    s.transfers.forEach(function (t) {
      var paid = transferPaid(ev, t);
      if (!paid) { outstanding++; if (t.from === me) myOwe += t.amount; if (t.to === me) myOwed += t.amount; }
    });
    return { transfers: s.transfers, nets: s.nets, myOwe: myOwe, myOwed: myOwed,
             allSettled: outstanding === 0, outstanding: outstanding };
  }

  /* ------------------------------ render -------------------------------- */
  var app = document.getElementById("app");
  var lastKey = null;
  var moreOpen = {};   // per-item: is the "＋ More" (extra friends) list expanded?

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
    return '' +
      '<div class="appbar">' +
        '<div class="row">' +
          '<span class="brand">' + LOGO_SVG + '<span>Makan Split</span></span>' +
          '<span class="spacer"></span>' + installBtn +
          '<button class="iconbtn" title="Who are you?" onclick="MS.nav(\'identity\')">🔄</button>' +
          '<button class="iconbtn" title="People" onclick="MS.nav(\'people\')">👥</button>' +
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
      '<button class="' + (s === "home" || s === "event" || s === "create" ? "active" : "") + '" onclick="MS.nav(\'home\')"><span class="ic">🏠</span>Events</button>' +
      '<button class="' + (s === "people" ? "active" : "") + '" onclick="MS.nav(\'people\')"><span class="ic">👥</span>People</button>' +
      '</div>';
  }

  function render() {
    var key = state.ui.screen + "|" + (state.ui.eventId || "");
    var keep = key === lastKey;                 // same screen -> preserve scroll position
    var y = keep ? (window.scrollY || window.pageYOffset || 0) : 0;
    var out;
    if (state.ui.screen === "identity") {
      out = brandbar() + '<div class="screen">' + screenIdentity() + '</div>';
    } else {
      var body;
      switch (state.ui.screen) {
        case "create": body = screenCreate(); break;
        case "event":  body = screenEvent();  break;
        case "people": body = screenPeople(); break;
        default:       body = screenHome();
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
    var html = '<button class="btn btn-primary" style="margin-bottom:14px" onclick="MS.nav(\'create\')">＋ Create an event</button>';
    html += '<h2 class="title" style="font-size:16px">Your events</h2>';

    if (!state.events.length) {
      html += '<div class="empty"><div class="big">🧾</div><b>No events yet</b><div class="sub" style="margin-top:4px">Tap “Create an event” to split your first lunch bill.</div></div>';
      return html;
    }

    html += '<div class="events">';
    state.events.slice().reverse().forEach(function (ev) {
      var sum = summary(ev);
      var info = settleInfo(ev);
      var pool = assignPool(ev);
      var inEvent = pool.indexOf(meId) !== -1;

      var avs = pool.slice(0, 5).map(function (id) { return avatar(userById(id)); }).join("");
      var extra = pool.length - 5;
      if (extra > 0) avs += '<span class="avatar" style="background:var(--muted)">+' + extra + '</span>';

      var chip;
      if (info.transfers.length && info.allSettled) chip = '<span class="badge settled">✓ All settled</span>';
      else if (info.myOwe > EPS) chip = '<span class="badge owe">You owe ' + money(info.myOwe) + '</span>';
      else if (info.myOwed > EPS) chip = '<span class="badge owed">You’re owed ' + money(info.myOwed) + '</span>';
      else if (!inEvent) chip = '<span class="badge">Not in this event</span>';
      else if (info.outstanding > 0) chip = '<span class="badge">' + info.outstanding + ' to settle</span>';
      else chip = '<span class="badge settled">✓ Settled</span>';

      html += '<div class="event-card" onclick="MS.openEvent(\'' + ev.id + '\')">' +
        '<div class="top">' +
          '<div><p class="nm">' + esc(ev.name) + '</p><div class="dt">' + esc(fmtDate(ev.date)) + ' · Paid by ' + esc(payersLabel(ev)) + '</div></div>' +
          '<div class="amt"><div class="v">' + money(sum.grand) + '</div><div class="l">total bill</div></div>' +
        '</div>' +
        '<div class="foot"><div class="avatars">' + avs + '</div>' + chip + '</div>' +
      '</div>';
    });
    html += '</div>';
    html += '<div class="note" style="text-align:center;margin-top:14px">Tip: use 🔄 at the top to switch person and tap the items you had.</div>';
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
        '<div class="field"><label>Event name</label><input id="ce-name" type="text" placeholder="e.g. Friday Lunch @ Nando’s"></div>' +
        '<div class="field"><label>Date</label><input id="ce-date" type="date" value="' + attr(todayISO()) + '"></div>' +
        '<div class="field" style="margin-bottom:0"><label>Who paid the bill?</label><select id="ce-payer">' + payerOpts + '</select>' +
        '<div class="note">You can add more payers (2 or 3 people) inside the event.</div></div>' +
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
    var isPayer = (ev.payerIds || []).indexOf(meId) !== -1;
    var participants = assignPool(ev).map(userById);
    var sum = summary(ev);
    var mine = share(ev, meId);

    var html = '<button class="backbtn" onclick="MS.nav(\'home\')">‹ All events</button>';
    html += '<h2 class="title" style="margin-bottom:2px">' + esc(ev.name) + '</h2>';
    html += '<div class="sub" style="margin-bottom:12px">' + esc(fmtDate(ev.date)) + ' · Paid by ' + esc(payersLabel(ev)) +
            ' · ' + participants.length + ' people</div>';

    /* Receipt */
    html += '<div class="card"><h3>🧾 Receipt' + (isPayer ? ' <span class="hint">snap & punch in the lines</span>' : '') + '</h3>';
    if (ev.receiptThumb) html += '<img class="receipt-photo" src="' + attr(ev.receiptThumb) + '" alt="receipt">';
    if (isPayer) {
      html += '<label class="btn btn-ghost btn-block" style="margin-top:' + (ev.receiptThumb ? '10px' : '0') + '">' +
        '📷 ' + (ev.receiptThumb ? 'Retake receipt photo' : 'Snap / upload receipt') +
        '<input type="file" accept="image/*" capture="environment" style="display:none" onchange="MS.onPhoto(\'' + ev.id + '\',this)"></label>';
    } else if (!ev.receiptThumb) {
      html += '<div class="sub">No receipt photo attached.</div>';
    }
    html += '</div>';

    /* Items */
    html += '<div class="card"><h3>Items <span class="hint">' + (ev.items || []).length + ' line' + ((ev.items || []).length === 1 ? '' : 's') + '</span></h3>';
    if (!(ev.items || []).length) html += '<div class="sub" style="padding:6px 0 10px">No items yet.' + (isPayer ? ' Add the first line below.' : '') + '</div>';
    (ev.items || []).forEach(function (it) { html += itemRow(ev, it, isPayer, meId); });
    if (isPayer) {
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

    /* Charges + who paid */
    html += chargesCard(ev, isPayer);
    html += whoPaidCard(ev, isPayer);

    /* Your share */
    html += '<div class="card yourshare"><h3 style="color:#fff">Your share</h3>' +
      sumline("Your items subtotal", money(mine.sub)) +
      (ev.serviceChargeEnabled ? sumline("Service charge (" + (Number(ev.serviceChargeRate) || 0) + "%)", money(mine.sc)) : "") +
      (ev.sstEnabled ? sumline("SST (" + (Number(ev.sstRate) || 0) + "%)", money(mine.sst)) : "") +
      '<div class="sumline total"><span>What you ate/drank</span><span>' + money(mine.total) + '</span></div>' +
      '</div>';

    /* Settle up */
    html += settleCard(ev);

    /* Bill total */
    html += '<div class="card"><h3>Bill total</h3>' +
      sumline("Items subtotal", money(sum.itemsSub)) +
      (ev.serviceChargeEnabled ? sumline("Service charge (" + (Number(ev.serviceChargeRate) || 0) + "%)", money(sum.sc)) : "") +
      (ev.sstEnabled ? sumline("SST (" + (Number(ev.sstRate) || 0) + "%)", money(sum.sst)) : "") +
      '<div class="sumline total"><span>Grand total</span><span>' + money(sum.grand) + '</span></div>';
    if (sum.unassignedItems > 0) html += '<div class="warn">⚠︎ ' + sum.unassignedItems + ' item' + (sum.unassignedItems === 1 ? '' : 's') + ' (' + money(sum.unassigned) + ') not assigned yet — assign them so the split adds up.</div>';
    html += '</div>';

    if (isPayer) html += '<button class="btn btn-danger btn-block" onclick="MS.deleteEvent(\'' + ev.id + '\')">Delete event</button>';
    return html;
  }

  function itemRow(ev, it, editable, meId) {
    var a = it.assignedTo || [];
    var perHead = a.length ? (Number(it.price) || 0) / a.length : 0;
    var isMine = a.indexOf(meId) !== -1;
    var html = '<div class="item">';

    if (editable) {
      var pool = assignPool(ev);
      var extras = state.users.filter(function (x) { return pool.indexOf(x.id) === -1; });
      var chipFor = function (id, guest) {
        var uu = userById(id), on = a.indexOf(id) !== -1;
        return '<button class="chip ' + (on ? 'active' : '') + (guest ? ' guest' : '') + '" onclick="MS.toggleAssign(\'' + ev.id + '\',\'' + it.id + '\',' + id + ')">' +
          '<span class="dot" style="background:' + color(id) + '">' + esc(initials(uu.name)) + '</span>' + esc(firstName(uu)) + '</button>';
      };
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
        pool.map(function (id) { return chipFor(id, false); }).join("") +
        '<button class="chip" onclick="MS.assignAll(\'' + ev.id + '\',\'' + it.id + '\',true)">All</button>' +
        '<button class="chip" onclick="MS.assignAll(\'' + ev.id + '\',\'' + it.id + '\',false)">Clear</button>' +
        (extras.length ? '<button class="chip more" onclick="MS.toggleMore(\'' + it.id + '\')">' + (moreOpen[it.id] ? 'Less ▲' : '＋ More (' + extras.length + ')') + '</button>' : '') +
      '</div>' +
        ((moreOpen[it.id] && extras.length) ? '<div class="chips morebox">' + extras.map(function (x) { return chipFor(x.id, true); }).join("") + '</div>' : '') +
      '</div>';
    } else {
      html += '<div class="r1"><span class="nm-in">' + esc(it.name) +
        ' <span class="tag ' + (it.shared ? 'shared' : 'indiv') + '" style="margin-left:4px">' + (it.shared ? 'Shared' : 'Individual') + '</span></span>' +
        '<span style="font-weight:700">' + money(it.price) + '</span></div>';
      html += '<div class="r2"><span class="meta">' + (a.length ? money(perHead) + ' each' : 'not assigned') + '</span>' +
        '<span class="avatars" style="margin-left:auto">' + a.map(function (id) { return avatar(userById(id), 22); }).join("") + '</span></div>';
      html += '<button class="btn btn-sm ' + (isMine ? 'btn-ghost' : 'btn-teal') + '" style="margin-top:9px;width:100%" onclick="MS.toggleAssign(\'' + ev.id + '\',\'' + it.id + '\',' + meId + ')">' +
        (isMine ? '✓ You had this — tap to remove' : '＋ I had this') + '</button>';
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
        '<div class="note">SST is charged on the items subtotal, before service charge. Malaysia default: 10% service charge and 6% SST. Adjust to match your receipt.</div>' +
      '</div>';
    }
    return '<div class="card"><h3>Service charge & SST</h3>' +
      '<div class="rowline"><span class="lb">Service charge</span><span class="rt">' + (ev.serviceChargeEnabled ? (Number(ev.serviceChargeRate) || 0) + '%' : '—') + '</span></div>' +
      '<div class="rowline"><span class="lb">SST</span><span class="rt">' + (ev.sstEnabled ? (Number(ev.sstRate) || 0) + '%' : '—') + '</span></div>' +
    '</div>';
  }

  function whoPaidCard(ev, editable) {
    var mult = (ev.payerIds || []).length > 1;
    var grand = summary(ev).grand;
    var pays = effectivePayments(ev);

    if (!editable) {
      var lbl = (ev.payerIds || []).map(function (id) { return esc(firstName(userById(id))) + (mult ? ' (' + money(pays[id] || 0) + ')' : ''); }).join(", ");
      return '<div class="card"><h3>Who paid</h3><div class="rowline"><span class="lb">' + (mult ? 'Payers' : 'Payer') + '</span><span class="rt">' + lbl + '</span></div></div>';
    }

    var rows = assignPool(ev).map(function (id) {
      var u = userById(id), on = (ev.payerIds || []).indexOf(id) !== -1;
      var amt = (on && mult) ? '<input class="rate-in" style="width:96px" type="number" inputmode="decimal" step="0.01" value="' + attr(pays[id] || 0) + '" onchange="MS.setPayment(\'' + ev.id + '\',' + id + ',this.value)">'
              : (on ? '<span class="sub">paid ' + money(grand) + '</span>' : '');
      return '<label class="payrow"><span class="switch" style="width:38px;height:22px"><input type="checkbox"' + (on ? ' checked' : '') + ' onchange="MS.togglePayer(\'' + ev.id + '\',' + id + ')"><span class="slider"></span></span>' +
        avatar(u, 26) + '<b style="flex:1">' + esc(firstName(u)) + '</b>' + amt + '</label>';
    }).join("");

    var extra = "";
    if (mult) {
      var entered = (ev.payerIds || []).reduce(function (t, id) { return t + (Number(pays[id]) || 0); }, 0);
      extra = '<div class="rowline"><span class="lb">Entered / bill</span><span class="rt">' + money(entered) + ' / ' + money(grand) + '</span></div>' +
        (Math.abs(entered - grand) > 0.01 ? '<div class="warn">⚠︎ Amounts entered (' + money(entered) + ') don’t match the bill (' + money(grand) + ').</div>' : '') +
        '<button class="btn btn-ghost btn-sm btn-block" style="margin-top:8px" onclick="MS.splitPay(\'' + ev.id + '\')">Split the bill equally among payers</button>';
    }
    return '<div class="card"><h3>Who paid <span class="hint">tap to add a payer</span></h3>' + rows + extra +
      '<div class="note">' + (mult ? 'Enter what each person actually put in.' : 'One payer covers the whole bill. Add a 2nd or 3rd payer if you split the payment.') + '</div></div>';
  }

  function settleCard(ev) {
    var info = settleInfo(ev), me = state.currentUserId, pays = effectivePayments(ev);

    var html = '<div class="card"><h3>Settle up' + ((ev.payerIds || []).length > 1 ? ' <span class="hint">' + ev.payerIds.length + ' payers</span>' : '') + '</h3>';

    if (info.myOwe > EPS) html += '<span class="pill owe">You owe ' + money(info.myOwe) + '</span>';
    else if (info.myOwed > EPS) html += '<span class="pill get">You’re owed ' + money(info.myOwed) + '</span>';
    else html += '<span class="pill done">You’re all settled ✓</span>';

    // Per-person: what they ate, what they paid, and their net.
    html += '<table class="bd" style="margin-top:10px"><thead><tr><th>Person</th><th>Ate</th><th>Paid</th><th>Net</th></tr></thead><tbody>';
    assignPool(ev).forEach(function (id) {
      var u = userById(id), s = share(ev, id).total, p = pays[id] || 0, net = p - s;
      var done = personSettled(ev, info.transfers, id);
      var col = net > EPS ? "var(--ok)" : (net < -EPS ? "var(--danger)" : "inherit");
      html += '<tr class="' + (id === me ? "me" : "") + '" style="' + (done ? "opacity:.45" : "") + '">' +
        '<td>' + esc(firstName(u)) + ((ev.payerIds || []).indexOf(id) !== -1 ? ' <span class="badge">payer</span>' : '') + (done ? ' ✓' : '') + '</td>' +
        '<td>' + money(s) + '</td><td>' + money(p) + '</td>' +
        '<td style="color:' + col + '">' + signed(net) + '</td></tr>';
    });
    html += '</tbody></table>';

    html += '<div style="margin-top:14px;font-weight:700;font-size:13px">Who pays who</div>';
    if (!info.transfers.length) {
      html += '<div class="sub" style="margin-top:4px">All balanced — nothing to transfer.</div>';
    } else {
      info.transfers.forEach(function (t) {
        var paid = transferPaid(ev, t), from = userById(t.from), to = userById(t.to);
        var mineFrom = t.from === me, mineTo = t.to === me;
        var hint = mineFrom ? "You pay " + esc(firstName(to)) : (mineTo ? esc(firstName(from)) + " pays you" : "");
        html += '<div class="xfer' + (paid ? " dim" : "") + '">' + avatar(from, 26) +
          '<div style="flex:1;min-width:0"><b' + (paid ? ' class="strike"' : '') + '>' + esc(firstName(from)) + ' → ' + esc(firstName(to)) + '</b>' +
            (hint ? '<div class="sub">' + hint + '</div>' : '') + '</div>' +
          '<span class="xamt' + (paid ? ' strike" ' : '"') + '>' + money(t.amount) + '</span>' +
          '<button class="btn btn-sm ' + (paid ? "btn-ghost" : "btn-teal") + '" onclick="MS.markPaid(\'' + ev.id + '\',' + t.from + ',' + t.to + ',' + (paid ? "false" : "true") + ')">' + (paid ? "Undo" : "Mark paid") + '</button>' +
        '</div>';
      });
    }
    html += '</div>';
    return html;
  }

  function sumline(label, val) { return '<div class="sumline"><span class="muted">' + esc(label) + '</span><span>' + val + '</span></div>'; }

  /* ------------------------------ PEOPLE -------------------------------- */
  function screenPeople() {
    var rows = state.users.map(function (u) {
      return '<div class="prow">' + avatar(u, 34) +
        '<div class="ins">' +
          '<input type="text" value="' + attr(u.name) + '" placeholder="Name" onchange="MS.saveUser(' + u.id + ',this.value)">' +
        '</div></div>';
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
    toggleMore: function (itemId) { moreOpen[itemId] = !moreOpen[itemId]; render(); },

    submitCreate: function () {
      var name = (document.getElementById("ce-name").value || "").trim() || "Lunch";
      var date = document.getElementById("ce-date").value || todayISO();
      var payer = Number(document.getElementById("ce-payer").value) || state.currentUserId;
      var ids = [];
      document.querySelectorAll(".ce-p:checked").forEach(function (c) { ids.push(Number(c.value)); });
      if (ids.indexOf(state.currentUserId) === -1) ids.unshift(state.currentUserId);
      if (ids.indexOf(payer) === -1) ids.push(payer);
      var ev = { id: uid("evt_"), name: name, date: date, payerIds: [payer], payments: {}, paid: {},
        participantIds: ids, serviceChargeEnabled: true, serviceChargeRate: DEFAULT_SC,
        sstEnabled: true, sstRate: DEFAULT_SST, receiptThumb: null, items: [] };
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
        assignedTo: shared ? assignPool(ev) : [] });
      save(); render();
    },
    updateItem: function (eventId, itemId, field, value) {
      var ev = eventById(eventId); if (!ev) return; var it = itemById(ev, itemId); if (!it) return;
      it[field] = (field === "price") ? (parseFloat(value) || 0) : value; save(); render();
    },
    removeItem: function (eventId, itemId) {
      var ev = eventById(eventId); if (!ev) return;
      ev.items = (ev.items || []).filter(function (x) { return x.id !== itemId; }); save(); render();
    },
    setShared: function (eventId, itemId, val) {
      var ev = eventById(eventId); if (!ev) return; var it = itemById(ev, itemId); if (!it) return;
      it.shared = !!val;
      if (val && !(it.assignedTo || []).length) it.assignedTo = assignPool(ev);
      save(); render();
    },
    toggleAssign: function (eventId, itemId, userId) {
      var ev = eventById(eventId); if (!ev) return; var it = itemById(ev, itemId); if (!it) return;
      var a = it.assignedTo || [], i = a.indexOf(userId);
      if (i === -1) a.push(userId); else a.splice(i, 1);
      it.assignedTo = a; save(); render();
    },
    assignAll: function (eventId, itemId, val) {
      var ev = eventById(eventId); if (!ev) return; var it = itemById(ev, itemId); if (!it) return;
      it.assignedTo = val ? assignPool(ev) : []; save(); render();
    },
    setCharge: function (eventId) {
      var ev = eventById(eventId); if (!ev) return;
      ev.serviceChargeEnabled = document.getElementById("sc-on").checked;
      ev.serviceChargeRate = parseFloat(document.getElementById("sc-rate").value) || 0;
      ev.sstEnabled = document.getElementById("sst-on").checked;
      ev.sstRate = parseFloat(document.getElementById("sst-rate").value) || 0;
      save(); render();
    },

    togglePayer: function (eventId, userId) {
      var ev = eventById(eventId); if (!ev) return;
      var ids = (ev.payerIds || []).slice(), i = ids.indexOf(userId);
      if (i >= 0) { if (ids.length > 1) ids.splice(i, 1); }   // keep at least one payer
      else ids.push(userId);
      ev.payerIds = ids;
      if (ev.participantIds.indexOf(userId) === -1) ev.participantIds.push(userId);
      if (ids.length > 1) {                                    // pre-fill equal amounts
        var grand = summary(ev).grand, each = Math.round((grand / ids.length) * 100) / 100, p = {};
        ids.forEach(function (id) { p[id] = each; });
        p[ids[ids.length - 1]] = Math.round((grand - each * (ids.length - 1)) * 100) / 100;
        ev.payments = p;
      } else { ev.payments = {}; }
      save(); render();
    },
    setPayment: function (eventId, userId, amount) {
      var ev = eventById(eventId); if (!ev) return;
      if (!ev.payments) ev.payments = {};
      ev.payments[userId] = parseFloat(amount) || 0; save(); render();
    },
    splitPay: function (eventId) {
      var ev = eventById(eventId); if (!ev) return;
      var ids = ev.payerIds || [], grand = summary(ev).grand;
      var each = Math.round((grand / ids.length) * 100) / 100, p = {};
      ids.forEach(function (id) { p[id] = each; });
      if (ids.length) p[ids[ids.length - 1]] = Math.round((grand - each * (ids.length - 1)) * 100) / 100;
      ev.payments = p; save(); render();
    },
    markPaid: function (eventId, fromId, toId, val) {
      var ev = eventById(eventId); if (!ev) return;
      if (!ev.paid) ev.paid = {};
      var k = xferKey(fromId, toId);
      if (val) ev.paid[k] = true; else delete ev.paid[k];
      save(); render();
    },

    deleteEvent: function (eventId) {
      var ev = eventById(eventId);
      if (ev && !confirm('Delete "' + ev.name + '"? This cannot be undone.')) return;
      state.events = state.events.filter(function (x) { return x.id !== eventId; });
      state.ui = { screen: "home", eventId: null }; save(); render();
    },
    saveUser: function (userId, value) {
      var u = userById(userId); if (!u) return; u.name = value; save(); render();
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

  if (!identityConfirmed) state.ui = { screen: "identity", eventId: null };   // ask "who are you?" on open
  render();
})();
