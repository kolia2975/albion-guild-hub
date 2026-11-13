// Спільний "каркас" сторінки на Alpine.js: тема, дзвіночок нотифікацій, юзер.
// Підключається на кожній сторінці як x-data="appShell()" на <body>.
function applyTheme(theme) {
  document.documentElement.classList.toggle('theme-light', theme === 'light');
}

function appShell() {
  return {
    user: Api.currentUser(),
    theme: localStorage.getItem('agh_theme') || 'dark',
    notifPanelOpen: false,
    notifications: [],
    unreadCount: 0,
    sidebarOpen: false,

    init() {
      applyTheme(this.theme);
      if (this.user) {
        this.loadNotifications();
        setInterval(() => this.loadNotifications(), 20000);
      }
    },

    toggleTheme() {
      this.theme = this.theme === 'dark' ? 'light' : 'dark';
      localStorage.setItem('agh_theme', this.theme);
      applyTheme(this.theme);
      Api.patch('/auth/me', { themePref: this.theme }).catch(() => {});
    },

    async loadNotifications() {
      try {
        const list = await Api.get('/notifications?unread=true');
        this.notifications = list;
        this.unreadCount = list.length;
      } catch (_) {
        /* тихо ігноруємо, щоб не спамити помилками при протуханні токена */
      }
    },

    async markRead(id) {
      await Api.post(`/notifications/${id}/read`);
      this.loadNotifications();
    },

    async markAllRead() {
      await Api.post('/notifications/read-all');
      this.loadNotifications();
    },

    severityClass(sev) {
      if (sev === 'critical') return 'badge-red';
      if (sev === 'warning') return 'badge-gold';
      return 'badge-blue';
    },

    logout() {
      Api.logout();
    },

    roleLabel(role) {
      const map = {
        member: 'Гільд-юзер',
        economist: 'Економіст',
        accountant: 'Обліковець',
        roster: 'Кістяк файтів',
        moderator: 'Модератор',
        admin: 'Адміністратор',
      };
      return map[role] || role;
    },

    fmtSilver(n) {
      return Math.round(Number(n) || 0).toLocaleString('uk-UA');
    },

    fmtTime(iso) {
      if (!iso) return '—';
      return new Date(iso).toLocaleString('uk-UA');
    },
  };
}
