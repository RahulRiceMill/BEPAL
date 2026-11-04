import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, sendPasswordResetEmail }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { initializeFirestore, persistentLocalCache, doc, collection, setDoc, onSnapshot }
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
const db = initializeFirestore(app, { localCache: persistentLocalCache(), experimentalAutoDetectLongPolling: true });

var CATEGORIES = { grocery: "Grocery store", retail: "Retail shop", wholesale: "Wholesaler", other: "Other" };
var VIEWS = ["loading", "login", "pin", "register", "dashboard", "products", "inventory", "pos", "reports"];
var APPVIEWS = ["dashboard", "products", "inventory", "pos", "reports"];
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
  "auth/network-request-failed": "No internet connection.", "auth/too-many-requests": "Too many tries. Wait a while and try again." };
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
  else v = APPVIEWS.indexOf(view) < 0 ? "dashboard" : view;
  if (APPVIEWS.indexOf(v) >= 0) { try { sessionStorage.setItem("bepal.view", v); } catch (e) {} }
  VIEWS.forEach(function (n) { $("view" + n.charAt(0).toUpperCase() + n.slice(1)).hidden = n !== v; });
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
  $("dAlert").textContent = low ? low + " product(s) low or out of stock." : "";
  if (v === "products") renderProducts();
  if (v === "inventory") renderInventory();
  if (v === "pos") { renderPos(); renderCart(); }
  if (v === "reports") renderReports();
}
function go(v) { view = v; query = ""; posQ = ""; $("search").value = ""; $("posSearch").value = ""; closeForm(); show(); }

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
            low: num($("pLow").value), unit: $("pUnit").value.trim(), cat: $("pCat").value.trim() };
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
    items.push({ name: p.name, qty: l.qty, price: p.price, cost: p.cost });
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

// ----- Business setup and navigation -----
$("registerForm").addEventListener("submit", function (e) {
  e.preventDefault();
  business = { name: $("bName").value.trim(), owner: $("bOwner").value.trim(), phone: $("bPhone").value.trim(), category: $("bCategory").value,
               currency: $("bCurrency").value.trim() || "Rs", products: [], sales: sales, createdAt: new Date().toISOString() };
  view = "dashboard"; saveBusiness(); show();
});
document.querySelectorAll(".tile").forEach(function (t) { t.addEventListener("click", function () { go(t.getAttribute("data-go")); }); });
document.querySelectorAll(".back").forEach(function (b) { b.addEventListener("click", function () { go("dashboard"); }); });

show();
