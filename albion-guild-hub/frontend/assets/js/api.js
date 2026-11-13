// Тонка обгортка над fetch(): сама підставляє JWT з localStorage,
// сама кидає в /index.html при 401 (токен протух/відсутній).
const API_BASE = '/api';

const Api = {
  token() {
    return localStorage.getItem('agh_token');
  },

  setToken(token) {
    if (token) localStorage.setItem('agh_token', token);
    else localStorage.removeItem('agh_token');
  },

  currentUser() {
    const raw = localStorage.getItem('agh_user');
    return raw ? JSON.parse(raw) : null;
  },

  setCurrentUser(user) {
    if (user) localStorage.setItem('agh_user', JSON.stringify(user));
    else localStorage.removeItem('agh_user');
  },

  logout() {
    this.setToken(null);
    this.setCurrentUser(null);
    window.location.href = '/index.html';
  },

  async request(method, path, body) {
    const headers = { 'Content-Type': 'application/json' };
    const token = this.token();
    if (token) headers.Authorization = `Bearer ${token}`;

    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (res.status === 401) {
      this.logout();
      throw new Error('Сесія протермінована, увійди ще раз.');
    }

    let data = null;
    try {
      data = await res.json();
    } catch (_) {
      /* тіло могло бути порожнім */
    }

    if (!res.ok) {
      throw new Error((data && data.error) || `Помилка запиту (${res.status})`);
    }
    return data;
  },

  get(path) {
    return this.request('GET', path);
  },
  post(path, body) {
    return this.request('POST', path, body);
  },
  put(path, body) {
    return this.request('PUT', path, body);
  },
  patch(path, body) {
    return this.request('PATCH', path, body);
  },
  delete(path) {
    return this.request('DELETE', path);
  },
};

// Якщо на сторінці немає токена і сама сторінка не index.html (логін) — назад на логін.
function guardAuth() {
  const isLoginPage = window.location.pathname.endsWith('/index.html') || window.location.pathname === '/';
  if (!Api.token() && !isLoginPage) {
    window.location.href = '/index.html';
  }
}
guardAuth();
