import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, sendPasswordResetEmail,
  reauthenticateWithCredential, EmailAuthProvider, updatePassword, verifyBeforeUpdateEmail, deleteUser }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { initializeFirestore, persistentLocalCache, doc, collection, setDoc, onSnapshot, getDocs, deleteDoc }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCayAeJaMxwAOuTGqAy97GpeVtFCbAC13c",
  authDomain: "bepal01.firebaseapp.com",
  projectId: "bepal01",
  storageBucket: "bepal01.firebasestorage.app",
  messagingSenderId: "917121160442",
  appId: "1:917121160442:web:46ac442d22500869cd6543"
};
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = initializeFirestore(app, { localCache: persistentLocalCache(), experimentalAutoDetectLongPolling: true }); // works offline, syncs later

var CATEGORIES = { grocery: "Grocery store", retail: "Retail shop", wholesale: "Wholesaler", mill: "Mill / service", other: "Other" };
var VIEWS = ["loading", "login", "pin", "register", "dashboard", "products", "inventory", "pos", "reports", "sales", "settings", "credit"];
var APPVIEWS = ["dashboard", "products", "inventory", "pos", "reports", "sales", "credit"];
var view = "dashboard";
try { view = sessionStorage.getItem("bepal.view") || "dashboard"; } catch (e) {}
var user = null, business = null, sales = [], loaded = false, locked = false, pinMode = "unlock", fails = 0, unsubB = null, unsubS = null;
var query = "", posQ = "", editId = null, cart = [], lastReceipt = "";

function $(id) { return document.getElementById(id); }
function num(v) { return parseFloat(v) || 0; }
function esc(s) {
  return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; });
}
function money(n) { return business.currency + " " + Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 }); }
function find(id) { return business.products.filter(function (p) { return p.id === id; })[0]; }
function isLow(p) { return p.stock <= 0 || (p.low > 0 && p.stock <= p.low); }
function stockText(p) { return p.stock + (p.unit ? " " + p.unit : ""); }

// ----- Cloud storage -----
function bizRef() { return doc(db, "businesses", user.uid); }
function salesCol() { return collection(db, "businesses", user.uid, "sales"); }
function fail(e) { alert("Cloud problem: " + (e && e.message ? e.message : e)); }
function saveBusiness() {
  var d = {};
  Object.keys(business).forEach(function (k) { if (k !== "sales") d[k] = business[k]; });
  setDoc(bizRef(), d).catch(fail);
  return true;
}
function norm(b) {
  b.customers = Array.isArray(b.customers) ? b.customers : [];
  b.ledger = Array.isArray(b.ledger) ? b.ledger : [];
  b.products = Array.isArray(b.products) ? b.products : [];
  b.products.forEach(function (p) { p.cost = num(p.cost); p.stock = num(p.stock); p.low = num(p.low); });
  b.sales = sales;
  return b;
}
function start() {
  if (!user || unsubB) { show(); return; }
  unsubB = onSnapshot(bizRef(), function (s) {
    business = s.exists() ? norm(s.data()) : null; loaded = true; show();
  }, fail);
  unsubS = onSnapshot(salesCol(), function (s) {
    sales = s.docs.map(function (d) { return d.data(); });
    if (business) business.sales = sales;
    show();
  }, fail);
  show();
}
function stop() {
  if (unsubB) unsubB(); if (unsubS) unsubS();
  unsubB = unsubS = null; business = null; sales = []; loaded = false; cart = [];
}

// ----- Login and PIN -----
var AUTH_ERR = { "auth/invalid-credential": "Wrong email or password.", "auth/invalid-email": "That email looks wrong.",
  "auth/email-already-in-use": "This email already has an account. Sign in instead.", "auth/weak-password": "Password must be at least 6 characters.",
  "auth/network-request-failed": "No internet connection.", "auth/requires-recent-login": "Please sign out, sign in again, then retry.", "auth/too-many-requests": "Too many tries. Wait a while and try again." };
function authFail(e) { $("aMsg").textContent = AUTH_ERR[e.code] || e.message; }
$("loginForm").addEventListener("submit", function (e) {
  e.preventDefault(); $("aMsg").textContent = "";
  signInWithEmailAndPassword(auth, $("aEmail").value.trim(), $("aPass").value).catch(authFail);
});
$("signupBtn").addEventListener("click", function () {
  $("aMsg").textContent = "";
  if (!$("aEmail").value || $("aPass").value.length < 6) { $("aMsg").textContent = "Enter an email and a password of 6+ characters."; return; }
  createUserWithEmailAndPassword(auth, $("aEmail").value.trim(), $("aPass").value).catch(authFail);
});
$("forgotBtn").addEventListener("click", function () {
  var m = $("aEmail").value.trim();
  if (!m) { $("aMsg").textContent = "Type your email first."; return; }
  sendPasswordResetEmail(auth, m).then(function () { $("aMsg").textContent = "Reset link sent. Check your email."; }).catch(authFail);
});

function pinKey() { return "bepal.pin." + user.uid; }
function skipKey() { return "bepal.skip." + user.uid; }
function hashPin(pin) {
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(user.uid + ":" + pin)).then(function (b) {
    return Array.from(new Uint8Array(b)).map(function (x) { return x.toString(16).padStart(2, "0"); }).join("");
  });
}
function lockNow(mode) {
  locked = true; pinMode = mode; fails = 0; $("pinInput").value = ""; $("pinMsg").textContent = ""; show();
}
$("pinForm").addEventListener("submit", function (e) {
  e.preventDefault();
  var p = $("pinInput").value.trim();
  if (!/^\d{4}$/.test(p)) { $("pinMsg").textContent = "Enter exactly 4 digits."; return; }
  hashPin(p).then(function (h) {
    if (pinMode === "set") { localStorage.setItem(pinKey(), h); locked = false; start(); return; }
    if (h === localStorage.getItem(pinKey())) { locked = false; start(); return; }
    fails++;
    if (fails >= 5) { signOut(auth); return; }
    $("pinMsg").textContent = "Wrong PIN. Tries left: " + (5 - fails);
    $("pinInput").value = "";
  });
});
$("pinSkip").addEventListener("click", function () {
  if (!localStorage.getItem(pinKey())) localStorage.setItem(skipKey(), "1");
  locked = false; start();
});
$("pinPass").addEventListener("click", function () { signOut(auth); });
$("lockBtn").addEventListener("click", function () { lockNow(localStorage.getItem(pinKey()) ? "unlock" : "set"); });
$("pinBtn").addEventListener("click", function () { lockNow("set"); });
$("outBtn").addEventListener("click", function () { if (confirm("Sign out of this phone?")) signOut(auth); });

onAuthStateChanged(auth, function (u) {
  stop(); user = u; locked = false;
  if (u) {
    if (localStorage.getItem(pinKey())) lockNow("unlock");
    else if (localStorage.getItem(skipKey())) start();
    else lockNow("set");
  } else show();
});

// ----- Screens -----
function show() {
  var v;
  if (!user) v = "login";
  else if (locked) v = "pin";
  else if (!loaded) v = "loading";
  else if (!business) v = "register";
  else v = (APPVIEWS.indexOf(view) < 0 && view !== "settings") ? "dashboard" : view;
  if (APPVIEWS.indexOf(v) >= 0) { try { sessionStorage.setItem("bepal.view", v); } catch (e) {} }
  VIEWS.forEach(function (n) { var el = $("view" + n.charAt(0).toUpperCase() + n.slice(1)); if (el) el.hidden = n !== v; });
  if (v === "pin") {
    var set = pinMode === "set";
    $("pinTitle").textContent = set ? "Create a 4-digit PIN for this phone" : "Enter PIN";
    $("pinOk").textContent = set ? "Save PIN" : "Unlock";
    $("pinSkip").hidden = !set; $("pinPass").hidden = set;
  }
  if (!business || v === "pin" || v === "login") { document.title = "BEPAL - Business Nepal"; return; }
  document.title = business.name + " - BEPAL";
  $("dName").textContent = business.name;
  $("dInfo").textContent = CATEGORIES[business.category] + " | Owner: " + business.owner + " | " + business.phone;
  var low = business.products.filter(isLow).length;
  var soon = business.products.filter(function (p) { var d = daysLeft(p.exp); return d !== null && d <= 30; }).length;
  $("dAlert").textContent = (low ? low + " product(s) low or out of stock. " : "") + (soon ? soon + " product(s) expired or expiring within 30 days." : "");
  if (v === "products") renderProducts();
  if (v === "inventory") renderInventory();
  if (v === "pos") { renderPos(); renderCart(); }
  if (v === "reports") renderReports();
  if (v === "sales") renderSales();
  if (v === "credit") renderCredit();
}
function go(v) { view = v; query = ""; posQ = ""; $("search").value = ""; $("posSearch").value = ""; closeForm(); show(); if (v === "settings") fillSettings(); }

// ----- Products -----
function renderProducts() {
  var cats = [], html = "";
  business.products.forEach(function (p) {
    if (p.cat && cats.indexOf(p.cat) < 0) cats.push(p.cat);
    if (p.name.toLowerCase().indexOf(query.toLowerCase()) < 0) return;
    html += '<div class="item"><div><div class="name">' + esc(p.name) + '</div><div class="cat">' + esc(p.cat || "") + ' | Stock: ' + esc(stockText(p)) +
      (isLow(p) ? '<span class="badge">Low</span>' : '') + '</div></div><div class="price">' + esc(money(p.price)) + (p.unit ? ' / ' + esc(p.unit) : '') +
      '<br><button class="eb" type="button" data-edit="' + p.id + '">Edit</button></div></div>';
  });
  if (!html) html = '<div class="empty">' + (business.products.length ? "No products found." : "No products yet. Tap + Add product.") + '</div>';
  $("list").innerHTML = html;
  $("catList").innerHTML = cats.map(function (c) { return '<option value="' + esc(c) + '">'; }).join("");
}
function openForm(id) {
  editId = id;
  var p = (id && find(id)) || {};
  $("pFormTitle").textContent = id ? "Edit product" : "Add product";
  $("pName").value = p.name || ""; $("pPrice").value = p.price != null ? p.price : ""; $("pCost").value = p.cost || "";
  $("pStock").value = p.stock || ""; $("pLow").value = p.low || ""; $("pUnit").value = p.unit || ""; $("pCat").value = p.cat || "";
  $("pBarcode").value = p.barcode || ""; $("pMfg").value = p.mfg || ""; $("pExp").value = p.exp || "";
  $("pDelete").hidden = !id; $("productForm").hidden = false; $("addBtn").hidden = true; $("pName").focus();
}
function closeForm() { editId = null; $("productForm").hidden = true; $("addBtn").hidden = false; }
$("addBtn").addEventListener("click", function () { openForm(null); });
$("pCancel").addEventListener("click", closeForm);
$("search").addEventListener("input", function () { query = this.value; renderProducts(); });
$("list").addEventListener("click", function (e) { var b = e.target.closest("[data-edit]"); if (b) openForm(Number(b.getAttribute("data-edit"))); });
$("productForm").addEventListener("submit", function (e) {
  e.preventDefault();
  var d = { name: $("pName").value.trim(), price: num($("pPrice").value), cost: num($("pCost").value), stock: num($("pStock").value),
            low: num($("pLow").value), unit: $("pUnit").value.trim(), cat: $("pCat").value.trim(),
            barcode: $("pBarcode").value.trim(), mfg: $("pMfg").value, exp: $("pExp").value };
  if (d.barcode && business.products.some(function (p) { return p.barcode === d.barcode && p.id !== editId; })) { alert("Another product already has this barcode."); return; }
  if (editId) Object.assign(find(editId), d); else { d.id = Date.now(); business.products.push(d); }
  saveBusiness(); closeForm(); renderProducts();
});
$("pDelete").addEventListener("click", function () {
  if (!confirm("Delete this product?")) return;
  business.products = business.products.filter(function (p) { return p.id !== editId; });
  cart = cart.filter(function (l) { return l.id !== editId; });
  saveBusiness(); closeForm(); renderProducts();
});

// ----- Inventory -----
function renderInventory() {
  var arr = business.products.slice().sort(function (a, b) { return (isLow(b) ? 1 : 0) - (isLow(a) ? 1 : 0) || a.name.localeCompare(b.name); });
  $("invList").innerHTML = arr.length ? arr.map(function (p) {
    return '<div class="item"><div><div class="name">' + esc(p.name) + (isLow(p) ? '<span class="badge">Low</span>' : '') + '</div><div class="cat">Stock: ' +
      esc(stockText(p)) + '</div></div><button class="eb" type="button" data-stock="' + p.id + '">+ Stock</button></div>';
  }).join("") : '<div class="empty">No products yet. Add them in Products.</div>';
}
$("invList").addEventListener("click", function (e) {
  var b = e.target.closest("[data-stock]"); if (!b) return;
  var p = find(Number(b.getAttribute("data-stock")));
  var n = parseFloat(prompt("How many to add to " + p.name + "? (use a minus number to remove)"));
  if (isNaN(n)) return;
  p.stock = Math.max(0, p.stock + n); saveBusiness(); renderInventory();
});

// ----- POS / Billing -----
function renderPos() {
  var html = "";
  business.products.forEach(function (p) {
    if (p.name.toLowerCase().indexOf(posQ.toLowerCase()) < 0) return;
    html += '<div class="item"><div><div class="name">' + esc(p.name) + '</div><div class="cat">Stock: ' + esc(stockText(p)) + '</div></div><div class="price">' +
      esc(money(p.price)) + '<br><button class="eb" type="button" data-add="' + p.id + '">+ Add</button></div></div>';
  });
  $("posList").innerHTML = html || '<div class="empty">No products found.</div>';
}
function renderCart() {
  cart = cart.filter(function (l) { return find(l.id); });
  var total = 0;
  $("cart").innerHTML = cart.length ? cart.map(function (l) {
    var p = find(l.id), sub = p.price * l.qty; total += sub;
    return '<div class="item"><div><div class="name">' + esc(p.name) + '</div><div class="cat">' + esc(money(p.price)) + ' x ' + l.qty + '</div></div><div class="price">' +
      esc(money(sub)) + '<br><button class="eb" type="button" data-dec="' + p.id + '">-</button> <button class="eb" type="button" data-inc="' + p.id + '">+</button></div></div>';
  }).join("") : '<div class="empty">Cart is empty.</div>';
  $("cartTotal").textContent = "Total: " + money(total);
}
function changeQty(id, d) {
  var p = find(id), l = cart.filter(function (x) { return x.id === id; })[0], q = (l ? l.qty : 0) + d;
  if (q > p.stock) { alert("Not enough stock. Only " + stockText(p) + " left."); return; }
  if (q <= 0) cart = cart.filter(function (x) { return x.id !== id; }); else if (l) l.qty = q; else cart.push({ id: id, qty: q });
  renderCart();
}
$("posSearch").addEventListener("input", function () { posQ = this.value; renderPos(); });
$("posList").addEventListener("click", function (e) { var b = e.target.closest("[data-add]"); if (b) changeQty(Number(b.getAttribute("data-add")), 1); });
$("cart").addEventListener("click", function (e) {
  var i = e.target.closest("[data-inc]"), d = e.target.closest("[data-dec]");
  if (i) changeQty(Number(i.getAttribute("data-inc")), 1);
  if (d) changeQty(Number(d.getAttribute("data-dec")), -1);
});
$("sellBtn").addEventListener("click", function () {
  if (!cart.length) { alert("Cart is empty."); return; }
  var items = [], total = 0, profit = 0, i, p;
  for (i = 0; i < cart.length; i++) {
    p = find(cart[i].id);
    if (!p || cart[i].qty > p.stock) { alert("Not enough stock for " + (p ? p.name : "a product") + "."); return; }
  }
  cart.forEach(function (l) {
    var p = find(l.id);
    items.push({ pid: p.id, name: p.name, qty: l.qty, price: p.price, cost: p.cost });
    total += p.price * l.qty; profit += (p.price - p.cost) * l.qty; p.stock -= l.qty;
  });
  var sale = { id: Date.now(), date: new Date().toISOString(), items: items, total: total, profit: profit };
  saveBusiness();
  setDoc(doc(salesCol(), String(sale.id)), sale).catch(fail);
  lastReceipt = business.name + "\n" + new Date(sale.date).toLocaleString() + "\n--------------\n" +
    items.map(function (x) { return x.name + " x" + x.qty + "  " + money(x.price * x.qty); }).join("\n") + "\n--------------\nTotal: " + money(total) + "\nThank you!";
  $("receipt").textContent = lastReceipt; $("receiptBox").hidden = false;
  cart = []; renderCart(); renderPos();
});
$("shareBtn").addEventListener("click", function () {
  if (navigator.share) navigator.share({ text: lastReceipt }).catch(function () {});
  else window.open("https://wa.me/?text=" + encodeURIComponent(lastReceipt), "_blank");
});
$("printBtn").addEventListener("click", function () { window.print(); });

// ----- Reports -----
function renderReports() {
  var per = $("repPeriod").value, now = Date.now();
  var list = business.sales.filter(function (s) {
    if (s.cancelled) return false;
    var t = new Date(s.date);
    if (per === "today") return t.toDateString() === new Date().toDateString();
    if (per === "week") return now - t.getTime() < 7 * 864e5;
    return true;
  });
  var rev = 0, prof = 0, qty = {};
  list.forEach(function (s) { rev += s.total; prof += s.profit; s.items.forEach(function (i) { qty[i.name] = (qty[i.name] || 0) + i.qty; }); });
  var top = Object.keys(qty).sort(function (a, b) { return qty[b] - qty[a]; }).slice(0, 5);
  var low = business.products.filter(isLow);
  $("repBody").innerHTML =
    '<div class="cards"><div class="card"><small>Sales</small><strong>' + list.length + '</strong></div><div class="card"><small>Revenue</small><strong>' + esc(money(rev)) +
    '</strong></div><div class="card"><small>Profit</small><strong>' + esc(money(prof)) + '</strong></div><div class="card"><small>Low stock items</small><strong>' + low.length + '</strong></div></div>' +
    '<h3>Best sellers</h3><div class="list">' + (top.length ? top.map(function (n) { return '<div class="item"><div class="name">' + esc(n) + '</div><div class="price">' + qty[n] + ' sold</div></div>'; }).join("") : '<div class="empty">No sales in this period.</div>') + '</div>' +
    '<h3>Needs restocking</h3><div class="list">' + (low.length ? low.map(function (p) { return '<div class="item"><div class="name">' + esc(p.name) + '</div><div class="price">' + esc(stockText(p)) + '</div></div>'; }).join("") : '<div class="empty">Nothing is low.</div>') + '</div>';
}
$("repPeriod").addEventListener("change", renderReports);

// ----- Sales history and cancelling a sale -----
function renderSales() {
  var arr = business.sales.slice().sort(function (a, b) { return b.id - a.id; }).slice(0, 50);
  $("salesList").innerHTML = arr.length ? arr.map(function (s) {
    var names = s.items.map(function (i) { return esc(i.name) + " x" + i.qty; }).join(", ");
    return '<div class="item"><div><div class="name">' + esc(money(s.total)) + (s.cancelled ? '<span class="badge">Cancelled</span>' : '') + '</div>' +
      '<div class="cat">' + esc(new Date(s.date).toLocaleString()) + '<br>' + names + '</div></div>' +
      (s.cancelled ? '' : '<button class="eb" type="button" data-cancel="' + s.id + '">Cancel</button>') + '</div>';
  }).join("") : '<div class="empty">No sales yet.</div>';
}
function cancelSale(id) {
  var s = business.sales.filter(function (x) { return x.id === id; })[0];
  if (!s || s.cancelled) return;
  if (!confirm("Cancel this sale and put the items back in stock?")) return;
  s.items.forEach(function (i) {
    var p = i.pid ? find(i.pid) : business.products.filter(function (x) { return x.name === i.name; })[0];
    if (p) p.stock += i.qty;
  });
  s.cancelled = true; s.cancelledAt = new Date().toISOString();
  saveBusiness();
  setDoc(doc(salesCol(), String(s.id)), s).catch(fail);
  renderSales();
}
if ($("salesList")) $("salesList").addEventListener("click", function (e) {
  var b = e.target.closest("[data-cancel]"); if (b) cancelSale(Number(b.getAttribute("data-cancel")));
});
if ($("salesBtn")) $("salesBtn").addEventListener("click", function () { go("sales"); });

// ----- Settings -----
function setMsg(t) { $("setMsg").textContent = t; }
function setErr(e) { setMsg(AUTH_ERR[e.code] || e.message); }
function reauth(pw) { return reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, pw)); }
function fillSettings() {
  setMsg(""); $("setEmail").textContent = user.email;
  $("sName").value = business.name; $("sOwner").value = business.owner; $("sPhone").value = business.phone;
  $("sCat").value = business.category; $("sCur").value = business.currency;
  ["curPass", "newPass", "mailPass", "newMail", "dangerPass"].forEach(function (i) { $(i).value = ""; });
}
function deleteAllSales() {
  return getDocs(salesCol()).then(function (snap) { return Promise.all(snap.docs.map(function (d) { return deleteDoc(d.ref); })); });
}
$("bizForm").addEventListener("submit", function (e) {
  e.preventDefault();
  business.name = $("sName").value.trim(); business.owner = $("sOwner").value.trim(); business.phone = $("sPhone").value.trim();
  business.category = $("sCat").value; business.currency = $("sCur").value.trim() || "Rs";
  saveBusiness(); setMsg("Business details saved.");
});
$("passForm").addEventListener("submit", function (e) {
  e.preventDefault(); setMsg("");
  reauth($("curPass").value).then(function () { return updatePassword(user, $("newPass").value); })
    .then(function () { setMsg("Password changed."); $("curPass").value = ""; $("newPass").value = ""; }).catch(setErr);
});
$("mailForm").addEventListener("submit", function (e) {
  e.preventDefault(); setMsg("");
  var m = $("newMail").value.trim();
  reauth($("mailPass").value).then(function () { return verifyBeforeUpdateEmail(user, m); })
    .then(function () { setMsg("Check " + m + " for a link. Your email changes after you open it. Then sign in again."); $("mailPass").value = ""; }).catch(setErr);
});
function csvCell(v) { v = String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
$("exportBtn").addEventListener("click", function () {
  var rows = [["Date", "Status", "Item", "Qty", "Price", "Cost", "Line total"]];
  business.sales.slice().sort(function (a, b) { return a.id - b.id; }).forEach(function (s) {
    s.items.forEach(function (i) { rows.push([new Date(s.date).toLocaleString(), s.cancelled ? "Cancelled" : "Completed", i.name, i.qty, i.price, i.cost, i.price * i.qty]); });
  });
  var csv = "\ufeff" + rows.map(function (r) { return r.map(csvCell).join(","); }).join("\n");
  var a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = "bepal-sales.csv"; a.click();
});
$("delHistBtn").addEventListener("click", function () {
  if (!business.sales.length) { setMsg("There is no sales history."); return; }
  if (prompt("This permanently deletes ALL sales history and reports. Download the spreadsheet first if you need it. Type DELETE to confirm.") !== "DELETE") return;
  deleteAllSales().then(function () { setMsg("Sales history deleted."); }).catch(fail);
});
$("delAcctBtn").addEventListener("click", function () {
  var pw = $("dangerPass").value;
  if (!pw) { setMsg("Type your current password in the box first."); return; }
  if (prompt("This permanently deletes your account, business, products and sales. Type DELETE to confirm.") !== "DELETE") return;
  var uid = user.uid;
  reauth(pw).then(deleteAllSales).then(function () { return deleteDoc(bizRef()); }).then(function () { return deleteUser(user); })
    .then(function () { localStorage.removeItem("bepal.pin." + uid); localStorage.removeItem("bepal.skip." + uid); }).catch(setErr);
});

// ----- Starter products by category -----
var STARTERS = {
  grocery: [["Rice", "kg", "Grocery"], ["Sugar", "kg", "Grocery"], ["Salt", "kg", "Grocery"], ["Cooking oil", "litre", "Grocery"], ["Lentils (dal)", "kg", "Grocery"], ["Noodles", "packet", "Snacks"]],
  retail: [["Notebook", "piece", "Stationery"], ["Pen", "piece", "Stationery"], ["Soap", "piece", "Household"], ["Shampoo", "sachet", "Personal care"], ["Biscuits", "packet", "Snacks"]],
  wholesale: [["Rice", "sack", "Grains"], ["Sugar", "sack", "Grains"], ["Cooking oil", "carton", "Oil"], ["Noodles", "carton", "Snacks"]],
  mill: [["Milling - Sailer", "quintal", "Milling"], ["Milling - Huller", "quintal", "Milling"], ["Grinding - Wheat and rice", "kg", "Grinding"], ["Oil pressing - Mustard seed", "kg", "Oil pressing"]],
  other: []
};
function starter(cat) {
  return (STARTERS[cat] || []).map(function (r, i) { return { id: Date.now() + i, name: r[0], unit: r[1], cat: r[2], price: 0, cost: 0, stock: 0, low: 0 }; });
}

// ----- Credit (udhar) -----
var openCid = null;
function on(id, ev, fn) { var e = $(id); if (e) e.addEventListener(ev, fn); }
function custBal(c) {
  return business.ledger.filter(function (e) { return e.cid === c.id; }).reduce(function (t, e) { return t + (e.type === "credit" ? e.amount : -e.amount); }, 0);
}
function renderCredit() {
  var q = ($("custSearch").value || "").toLowerCase();
  var rows = business.customers.filter(function (c) { return c.name.toLowerCase().indexOf(q) >= 0; });
  $("creditTotal").textContent = "Total owed to you: " + money(business.customers.reduce(function (t, c) { return t + custBal(c); }, 0));
  $("custList").innerHTML = rows.length ? rows.map(function (c) {
    return '<div class="item"><div><div class="name">' + esc(c.name) + '</div><div class="cat">' + esc(c.phone || "") + '</div></div><div class="price">' +
      esc(money(custBal(c))) + '<br><button class="eb" type="button" data-cust="' + c.id + '">Open</button></div></div>';
  }).join("") : '<div class="empty">No customers yet.</div>';
  var c = business.customers.filter(function (x) { return x.id === openCid; })[0];
  $("custBox").hidden = !c;
  if (!c) return;
  $("custName").textContent = c.name + " owes " + money(custBal(c));
  var h = business.ledger.filter(function (e) { return e.cid === c.id; }).sort(function (a, b) { return b.id - a.id; }).slice(0, 30);
  $("custHist").innerHTML = h.length ? h.map(function (e) {
    return '<div class="item"><div><div class="name">' + (e.type === "credit" ? "Took on credit " : "Paid ") + esc(money(e.amount)) + '</div><div class="cat">' +
      esc(new Date(e.date).toLocaleDateString()) + (e.note ? " | " + esc(e.note) : "") + '</div></div></div>';
  }).join("") : '<div class="empty">No entries yet.</div>';
}
function addEntry(type) {
  var a = parseFloat(prompt((type === "credit" ? "Amount on credit" : "Amount paid") + " (" + business.currency + ")"));
  if (!(a > 0)) return;
  var note = prompt("Note (optional)") || "";
  business.ledger.push({ id: Date.now(), cid: openCid, type: type, amount: a, date: new Date().toISOString(), note: note });
  saveBusiness(); renderCredit();
}
on("custSearch", "input", renderCredit);
on("addCustBtn", "click", function () {
  var n = (prompt("Customer name") || "").trim(); if (!n) return;
  var c = { id: Date.now(), name: n, phone: (prompt("Phone number (optional)") || "").trim() };
  business.customers.push(c); openCid = c.id; saveBusiness(); renderCredit();
});
on("custList", "click", function (e) { var b = e.target.closest("[data-cust]"); if (b) { openCid = Number(b.getAttribute("data-cust")); renderCredit(); } });
on("btnCredit", "click", function () { addEntry("credit"); });
on("btnPaid", "click", function () { addEntry("payment"); });
on("btnDelCust", "click", function () {
  if (!confirm("Delete this customer and all their credit records?")) return;
  business.customers = business.customers.filter(function (c) { return c.id !== openCid; });
  business.ledger = business.ledger.filter(function (e) { return e.cid !== openCid; });
  openCid = null; saveBusiness(); renderCredit();
});

// ----- Nepali language for the app screens -----
var NE = {
  "Sign in": "साइन इन", "Create new account": "नयाँ खाता बनाउनुहोस्", "Forgot password?": "पासवर्ड बिर्सनुभयो?", "Email": "इमेल",
  "Password (at least 6 characters)": "पासवर्ड (कम्तीमा ६ अक्षर)", "Enter PIN": "PIN हाल्नुहोस्", "Unlock": "खोल्नुहोस्", "Skip": "छोड्नुहोस्",
  "Use password instead": "पासवर्ड प्रयोग गर्नुहोस्", "Set up your business": "आफ्नो व्यवसाय सेटअप गर्नुहोस्", "Business name": "व्यवसायको नाम",
  "Owner name": "मालिकको नाम", "Phone number": "फोन नम्बर", "Business category": "व्यवसायको प्रकार", "Currency symbol": "मुद्रा चिन्ह",
  "Save business": "व्यवसाय सेभ गर्नुहोस्", "Grocery store": "किराना पसल", "Retail shop": "खुद्रा पसल", "Wholesaler": "थोक व्यापारी", "Other": "अन्य",
  "Mill / service": "मिल / सेवा", "Products": "सामान", "POS / Billing": "बिलिङ (POS)", "Inventory": "स्टक", "Reports": "रिपोर्ट", "Settings": "सेटिङ",
  "Credit (Udhar)": "उधारो", "← Dashboard": "← ड्यासबोर्ड", "Search products": "सामान खोज्नुहोस्", "Search product to add": "थप्ने सामान खोज्नुहोस्",
  "Search customers": "ग्राहक खोज्नुहोस्", "+ Add product": "+ सामान थप्नुहोस्", "Add product": "सामान थप्नुहोस्", "Edit product": "सामान सम्पादन",
  "Product name": "सामानको नाम", "Selling price": "बिक्री मूल्य", "Cost price (what you paid)": "खरिद मूल्य (तिरेको)", "Stock in hand": "हालको स्टक",
  "Warn me when stock is at or below": "स्टक यति वा कम भएमा सूचना दिनुहोस्", "Unit (kg, piece, packet...)": "एकाइ (केजी, थान, प्याकेट...)",
  "Category": "श्रेणी", "Save product": "सामान सेभ गर्नुहोस्", "Cancel": "रद्द", "Delete product": "सामान हटाउनुहोस्", "Edit": "सम्पादन", "Low": "कम",
  "+ Stock": "+ स्टक", "+ Add": "+ थप्नुहोस्", "Cart": "कार्ट", "Complete sale": "बिक्री पूरा गर्नुहोस्", "Receipt": "रसिद", "Share receipt": "रसिद सेयर",
  "Print": "प्रिन्ट", "Today": "आज", "Last 7 days": "पछिल्लो ७ दिन", "All time": "सबै समय", "Sales": "बिक्री", "Revenue": "आम्दानी", "Profit": "नाफा",
  "Low stock items": "कम स्टक भएका सामान", "Best sellers": "धेरै बिक्ने", "Needs restocking": "फेरि भर्नुपर्ने", "Sales history and cancel": "बिक्री इतिहास र रद्द",
  "Sales history": "बिक्री इतिहास", "Business": "व्यवसाय", "Account": "खाता", "Security": "सुरक्षा", "Your data": "तपाईंको डाटा", "Language": "भाषा",
  "Save business details": "विवरण सेभ गर्नुहोस्", "Change email": "इमेल परिवर्तन", "Change password": "पासवर्ड परिवर्तन", "Lock now": "अहिले लक गर्नुहोस्",
  "Change PIN": "PIN परिवर्तन", "Sign out": "साइन आउट", "Download sales (spreadsheet)": "बिक्री डाउनलोड (स्प्रेडसिट)", "Delete sales history": "बिक्री इतिहास मेट्नुहोस्",
  "Delete account": "खाता मेट्नुहोस्", "Delete account and all data": "खाता र सबै डाटा मेट्नुहोस्", "Loading...": "लोड हुँदैछ...", "Cancelled": "रद्द भएको",
  "No products yet. Tap + Add product.": "कुनै सामान छैन। + सामान थप्नुहोस् थिच्नुहोस्।", "No products found.": "सामान फेला परेन।", "Cart is empty.": "कार्ट खाली छ।",
  "No sales yet.": "अहिलेसम्म बिक्री छैन।", "Add customer": "ग्राहक थप्नुहोस्", "Record credit": "उधारो चढाउनुहोस्", "Record payment": "भुक्तानी लिनुहोस्",
  "No customers yet.": "अहिलेसम्म ग्राहक छैन।", "No entries yet.": "अहिलेसम्म कुनै लेखा छैन।", "Open": "खोल्नुहोस्", "Delete this customer": "यो ग्राहक हटाउनुहोस्",
  "Add sample products for this category": "यो प्रकारका नमुना सामान थप्नुहोस्"
};
var lang = "en";
try { lang = localStorage.getItem("bepal.lang") || "en"; } catch (e) {}
var orig = new WeakMap();
function applyLang(root) {
  var w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), n;
  while ((n = w.nextNode())) {
    var t = n.nodeValue.trim();
    if (!t) continue;
    if (lang === "ne") { if (NE[t]) { orig.set(n, n.nodeValue); n.nodeValue = n.nodeValue.replace(t, NE[t]); } }
    else if (orig.has(n)) { n.nodeValue = orig.get(n); orig.delete(n); }
  }
  if (root.querySelectorAll) root.querySelectorAll("[placeholder]").forEach(function (e) {
    var p = e.getAttribute("data-ph") || e.getAttribute("placeholder");
    e.setAttribute("data-ph", p); e.setAttribute("placeholder", lang === "ne" && NE[p] ? NE[p] : p);
  });
}
new MutationObserver(function (ms) {
  if (lang !== "ne") return;
  ms.forEach(function (m) { m.addedNodes.forEach(function (a) { if (a.nodeType === 1) applyLang(a); else if (a.parentNode) applyLang(a.parentNode); }); });
}).observe(document.body, { childList: true, subtree: true });
on("sLang", "change", function () {
  lang = this.value; try { localStorage.setItem("bepal.lang", lang); } catch (e) {}
  applyLang(document.body); document.documentElement.lang = lang; show();
});
if ($("sLang")) $("sLang").value = lang;

// ----- Barcode / QR scanner and expiry dates -----
function daysLeft(d) {
  if (!d) return null;
  var t = new Date(); t.setHours(0, 0, 0, 0);
  return Math.round((new Date(d + "T00:00:00") - t) / 864e5);
}
function dateInfo(d) {
  if (!d) return "-";
  var n = daysLeft(d), t = new Date(d + "T00:00:00").toLocaleDateString();
  return n < 0 ? t + " (EXPIRED)" : n <= 30 ? t + " (" + n + " days left)" : t;
}
var scanner = null, scanMode = "info", scanBusy = false;
function stopCamera() {
  if (!scanner) return;
  var sc = scanner; scanner = null;
  sc.stop().then(function () { sc.clear(); }).catch(function () {});
}
function openScan(mode) {
  scanMode = mode; scanBusy = false; lastAdded = ""; $("scanBox").hidden = false;
  $("scanAgain").hidden = mode === "cart"; $("scanClose").textContent = mode === "cart" ? "Done" : "Close"; $("scanInfo").hidden = true; $("scanMsg").textContent = "";
  if (!window.Html5Qrcode) { $("scanMsg").textContent = "The scanner could not load. Check your internet and reload."; return; }
  stopCamera();
  var F = window.Html5QrcodeSupportedFormats;
  scanner = new Html5Qrcode("reader", { verbose: false, experimentalFeatures: { useBarCodeDetectorIfSupported: true },
    formatsToSupport: F ? [F.QR_CODE, F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E, F.CODE_128, F.CODE_39] : undefined });
  scanner.start({ facingMode: "environment" }, { fps: 20, qrbox: { width: 300, height: 170 }, disableFlip: true }, onScan, function () {})
    .catch(function (e) { $("scanMsg").textContent = "Could not open the camera. Allow camera access and try again."; scanner = null; });
}
function closeScan() { stopCamera(); $("scanBox").hidden = true; }
var lastCode = "", lastSeen = 0, lastAdded = "";
function isRepeat(code) {   // the same code in view is counted once until it leaves the camera for a moment
  var n = Date.now(), r = code === lastCode && n - lastSeen < 1500;
  lastCode = code; lastSeen = n; return r;
}
function cartLine(p) {
  var l = cart.filter(function (x) { return x.id === p.id; })[0], q = l ? l.qty : 0;
  var box = $("scanInfo"); box.hidden = false;
  box.innerHTML = '<div class="item"><div><div class="name">' + esc(p.name) + '</div><div class="cat">' + esc($("cartTotal").textContent) + '</div></div>' +
    '<div class="price"><button class="eb" type="button" data-q="-1" data-id="' + p.id + '">-</button> ' + q +
    ' <button class="eb" type="button" data-q="1" data-id="' + p.id + '">+</button></div></div>';
}
on("scanInfo", "click", function (e) {
  var b = e.target.closest("[data-q]"); if (!b || scanMode !== "cart") return;
  var p = find(Number(b.getAttribute("data-id"))); if (!p) return;
  changeQty(p.id, Number(b.getAttribute("data-q"))); cartLine(p);
});
function onScan(code) {
  code = String(code).trim();
  var p = business.products.filter(function (x) { return x.barcode === code; })[0];
  if (scanMode === "cart") {
    if (code === lastAdded) return;   // the same item is still in front of the camera: ignore it, use + on the screen for more
    lastAdded = code;
    if (!p) { $("scanMsg").textContent = "No product has the barcode " + code; return; }
    $("scanMsg").textContent = "";
    changeQty(p.id, 1); cartLine(p);
    try { navigator.vibrate(60); } catch (e) {}
    return;
  }
  if (scanBusy) return;
  scanBusy = true;
  if (scanMode === "fill") { $("pBarcode").value = code; closeScan(); return; }
  stopCamera();
  var box = $("scanInfo"); box.hidden = false;
  if (!p) {
    box.innerHTML = '<div class="empty">No product has the barcode ' + esc(code) + '.<br><button class="eb" type="button" id="scanNew">Add as new product</button></div>';
    $("scanNew").addEventListener("click", function () { closeScan(); go("products"); openForm(null); $("pBarcode").value = code; });
    return;
  }
  box.innerHTML = '<div class="item"><div><div class="name">' + esc(p.name) + '</div><div class="cat">' + esc(p.cat || "") + '</div>' +
    '<p>Price: <strong>' + esc(money(p.price)) + (p.unit ? " / " + esc(p.unit) : "") + '</strong><br>Stock: ' + esc(stockText(p)) + (isLow(p) ? '<span class="badge">Low</span>' : '') +
    '<br>Production date: ' + esc(dateInfo(p.mfg)) + '<br>Expiry date: ' + esc(dateInfo(p.exp)) + '<br>Barcode: ' + esc(code) + '</p></div></div>';
}
on("scanBtn1", "click", function () { openScan("info"); });
on("scanBtn2", "click", function () { openScan("cart"); });
on("scanFill", "click", function () { openScan("fill"); });
on("scanAgain", "click", function () { openScan(scanMode); });
on("scanClose", "click", closeScan);
Object.assign(NE, { "Done": "सकियो", "Scan barcode": "बारकोड स्क्यान", "Scan to add": "स्क्यान गरेर थप्नुहोस्", "Scan": "स्क्यान", "Scan again": "फेरि स्क्यान", "Close": "बन्द गर्नुहोस्",
  "Barcode / QR code": "बारकोड / QR कोड", "Production date": "उत्पादन मिति", "Expiry date": "म्याद सकिने मिति", "Scan barcode / QR code": "बारकोड / QR कोड स्क्यान" });

// ----- Business setup and navigation -----
$("registerForm").addEventListener("submit", function (e) {
  e.preventDefault();
  business = { name: $("bName").value.trim(), owner: $("bOwner").value.trim(), phone: $("bPhone").value.trim(), category: $("bCategory").value,
               currency: $("bCurrency").value.trim() || "Rs", products: ($("bSample") && $("bSample").checked) ? starter($("bCategory").value) : [], customers: [], ledger: [], sales: sales, createdAt: new Date().toISOString() };
  view = "dashboard"; saveBusiness(); show();
});
document.querySelectorAll(".tile").forEach(function (t) { t.addEventListener("click", function () { go(t.getAttribute("data-go")); }); });
document.querySelectorAll(".back").forEach(function (b) { b.addEventListener("click", function () { go("dashboard"); }); });

show();
if (lang === "ne") { applyLang(document.body); document.documentElement.lang = "ne"; }
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(function () {});
// ----- Install screen (shown when the app is opened from the website) -----
var deferredInstall = null;
function isInstalled() { return window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true; }
window.addEventListener("beforeinstallprompt", function (e) { e.preventDefault(); deferredInstall = e; if ($("installBtn")) $("installBtn").hidden = false; });
window.addEventListener("appinstalled", function () {
    if (window.gtag) gtag("event", "app_install");
  if ($("installMsg")) $("installMsg").textContent = "Installed. Open BEPAL from your home screen.";
  if ($("installBtn")) $("installBtn").hidden = true;
});
if ($("installBox") && /[?&]install=1/.test(location.search) && !isInstalled()) $("installBox").hidden = false;
on("installBtn", "click", function () { if (!deferredInstall) return; deferredInstall.prompt(); deferredInstall = null; $("installBtn").hidden = true; });
on("installSkip", "click", function () { $("installBox").hidden = true; });
