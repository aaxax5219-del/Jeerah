let allPosts = [];
let currentUser = null;
let authToken = localStorage.getItem("jeerahToken") || "";
let authMode = "login";

function authHeaders() {
  return authToken ? { Authorization: `Bearer ${authToken}` } : {};
}

document.addEventListener("DOMContentLoaded", async () => {
  await restoreSession();
  await loadPosts();
  await loadEvents();
  updateAccountButton();
});

async function restoreSession() {
  if (!authToken) return;
  try {
    const res = await fetch("/api/me", { headers: authHeaders() });
    if (!res.ok) throw new Error("جلسة منتهية");
    const data = await res.json();
    currentUser = data.user;
  } catch {
    authToken = "";
    currentUser = null;
    localStorage.removeItem("jeerahToken");
  }
}

function updateAccountButton() {
  const button = document.getElementById("accountButton");
  if (!button) return;
  button.textContent = currentUser ? `مرحباً ${currentUser.name} · خروج` : "تسجيل الدخول";
  button.onclick = currentUser ? logout : openLogin;
}

function logout() {
  authToken = "";
  currentUser = null;
  localStorage.removeItem("jeerahToken");
  updateAccountButton();
  loadPosts();
  alert("تم تسجيل الخروج");
}

async function loadPosts() {
  try {
    const res = await fetch("/api/posts");
    allPosts = await res.json();
    renderPosts(allPosts);
  } catch (error) { console.error("Error loading posts:", error); }
}

async function loadEvents() {
  try {
    const res = await fetch("/api/events");
    const events = await res.json();
    document.getElementById("eventsList").innerHTML = events.map(e => `
      <div class="event"><b>${escapeHtml(e.title)}</b>
      <small>📅 ${escapeHtml(e.date)} · 📍 ${escapeHtml(e.location)}</small></div>
    `).join("");
  } catch (error) { console.error("Error loading events:", error); }
}

function renderPosts(posts) {
  const grid = document.getElementById("postsGrid");
  if (!posts.length) {
    grid.innerHTML = `<div class="post"><h3>لا توجد منشورات</h3><p>كن أول من يضيف منشوراً!</p></div>`;
    return;
  }
  grid.innerHTML = posts.map(p => `
    <article class="post">
      <span class="tag">${escapeHtml(p.category)}</span>
      <h3>${escapeHtml(p.title)}</h3>
      <p>${escapeHtml(p.description)}</p>
      <div class="author">👤 ${escapeHtml(p.author)}</div>
      ${currentUser && Number(p.user_id) === Number(currentUser.id) ? `<button class="delete-post" onclick="deletePost(${Number(p.id)})">حذف منشوري</button>` : ""}
    </article>
  `).join("");
}

async function deletePost(id) {
  if (!currentUser) return openLogin();
  if (!confirm("هل أنت متأكدة من حذف منشورك؟")) return;
  try {
    const res = await fetch(`/api/posts/${id}`, { method: "DELETE", headers: authHeaders() });
    const data = await res.json();
    if (!res.ok) return alert(data.error || "تعذر حذف المنشور");
    await loadPosts();
    alert("تم حذف منشورك بنجاح");
  } catch { alert("تعذر الاتصال بالخادم"); }
}

function filterCategory(category) {
  renderPosts(category === "الكل" ? allPosts : allPosts.filter(p => p.category === category));
}
function searchPosts() {
  const q = document.getElementById("searchInput").value.trim().toLowerCase();
  renderPosts(!q ? allPosts : allPosts.filter(p => `${p.title} ${p.description} ${p.category}`.toLowerCase().includes(q)));
  document.getElementById("posts").scrollIntoView({ behavior: "smooth" });
}
function openPost() {
  if (!currentUser) {
    alert("سجلي الدخول أولاً حتى تتمكني من إضافة منشور باسم حسابك");
    return openLogin();
  }
  document.getElementById("modal").classList.remove("hidden");
}
function openLogin() {
  authMode = "login";
  updateAuthMode();
  document.getElementById("authMessage").textContent = "";
  document.getElementById("loginModal").classList.remove("hidden");
}
function toggleAuthMode() {
  authMode = authMode === "login" ? "register" : "login";
  updateAuthMode();
}
function updateAuthMode() {
  const registering = authMode === "register";
  document.getElementById("authTitle").textContent = registering ? "إنشاء حساب جديد" : "تسجيل الدخول";
  document.getElementById("authName").classList.toggle("hidden", !registering);
  document.getElementById("authName").required = registering;
  document.getElementById("authPassword").autocomplete = registering ? "new-password" : "current-password";
  document.getElementById("authSubmit").textContent = registering ? "إنشاء الحساب" : "دخول";
  document.getElementById("authSwitch").textContent = registering ? "لديك حساب؟ تسجيل الدخول" : "إنشاء حساب جديد";
}
function closeModal() { document.querySelectorAll(".modal").forEach(m => m.classList.add("hidden")); }

 document.getElementById("authForm").addEventListener("submit", async e => {
  e.preventDefault();
  const message = document.getElementById("authMessage");
  const body = {
    name: document.getElementById("authName").value.trim(),
    email: document.getElementById("authEmail").value.trim(),
    password: document.getElementById("authPassword").value
  };
  try {
    const res = await fetch(authMode === "register" ? "/api/register" : "/api/login", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) { message.textContent = data.error || "تعذر إكمال العملية"; return; }
    authToken = data.token;
    currentUser = data.user;
    localStorage.setItem("jeerahToken", authToken);
    updateAccountButton();
    closeModal();
    await loadPosts();
    alert(authMode === "register" ? "تم إنشاء الحساب بنجاح" : "تم تسجيل الدخول بنجاح");
  } catch { message.textContent = "تعذر الاتصال بالخادم"; }
});

document.getElementById("postForm").addEventListener("submit", async e => {
  e.preventDefault();
  if (!currentUser) return openLogin();
  const payload = {
    title: document.getElementById("title").value.trim(),
    description: document.getElementById("description").value.trim(),
    category: document.getElementById("category").value
  };
  try {
    const res = await fetch("/api/posts", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) { alert(data.error || "حدث خطأ، حاولي مرة أخرى"); return; }
    e.target.reset();
    closeModal();
    await loadPosts();
  } catch { alert("تعذر الاتصال بالخادم"); }
});

document.querySelectorAll(".modal").forEach(modal => modal.addEventListener("click", e => {
  if (e.target === modal) closeModal();
}));
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));
}
