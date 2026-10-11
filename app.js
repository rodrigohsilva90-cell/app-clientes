* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
}

body {
  background-color: #f3f4f6;
  color: #1f2937;
  padding: 12px;
}

.container {
  max-width: 520px;
  margin: 0 auto;
}

/* Prevenção de Zoom no iOS/Safari: font-size 16px em todos os inputs */
input[type="text"],
input[type="tel"],
input[type="date"],
input[type="number"],
input[type="email"],
input[type="password"],
select {
  font-size: 16px !important;
}

/* Telas de Autenticação e Paywall */
.auth-screen {
  position: fixed;
  inset: 0;
  background-color: #f3f4f6;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  z-index: 9999;
}

.auth-card {
  background: #ffffff;
  padding: 20px;
  border-radius: 14px;
  width: 100%;
  max-width: 400px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.1);
  text-align: center;
}

.auth-card h2 {
  font-size: 1.25rem;
  margin-bottom: 4px;
  color: #111827;
}

.auth-card p {
  font-size: 0.82rem;
  color: #6b7280;
  margin-bottom: 14px;
}

/* Paywall Pix */
.paywall-card {
  border-top: 5px solid #dc2626;
}

.paywall-pix-box {
  background: #f0fdf4;
  border: 1px dashed #16a34a;
  border-radius: 8px;
  padding: 12px;
  margin: 12px 0;
  text-align: center;
}

.paywall-pix-label {
  display: block;
  font-size: 0.72rem;
  color: #166534;
  font-weight: 700;
  margin-bottom: 4px;
}

.paywall-pix-key {
  font-size: 0.92rem;
  color: #111827;
  word-break: break-all;
}

.auth-nav-tabs {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 4px;
  background: #f3f4f6;
  padding: 4px;
  border-radius: 8px;
  margin-bottom: 14px;
}

.auth-tab {
  background: transparent;
  border: none;
  padding: 8px 4px;
  font-size: 0.78rem;
  font-weight: 700;
  color: #6b7280;
  border-radius: 6px;
  cursor: pointer;
}

.auth-tab.active {
  background: #ffffff;
  color: #1e3a8a;
  box-shadow: 0 1px 2px rgba(0,0,0,0.06);
}

.auth-card .field {
  text-align: left;
}

/* Inputs e Botão Olhinho */
.password-input-wrapper {
  position: relative;
  display: flex;
  align-items: center;
  width: 100%;
}

.password-input-wrapper input {
  padding-right: 44px !important;
}

.btn-toggle-eye {
  position: absolute;
  right: 6px;
  background: transparent;
  border: none;
  padding: 6px;
  cursor: pointer;
  font-size: 1.1rem;
  line-height: 1;
  color: #6b7280;
  display: flex;
  align-items: center;
  justify-content: center;
  width: auto;
}

.btn-auth {
  width: 100%;
  background-color: #2563eb;
  color: white;
  padding: 12px;
  font-weight: 700;
  border-radius: 8px;
  border: none;
  font-size: 0.95rem;
  cursor: pointer;
  margin-top: 8px;
}

.auth-error {
  color: #dc2626 !important;
  font-weight: 600;
  margin-top: 10px;
  min-height: 18px;
  font-size: 0.8rem;
}

.auth-success {
  color: #16a34a !important;
  font-weight: 600;
  margin-top: 10px;
  min-height: 18px;
  font-size: 0.8rem;
}

/* Header */
.header-bar {
  position: relative;
  display: flex;
  justify-content: center;
  align-items: center;
  margin-bottom: 4px;
}

.header-bar h1 {
  font-size: 1.35rem;
  color: #111827;
  text-align: center;
  width: 100%;
}

.user-badge-bar {
  text-align: center;
  font-size: 0.75rem;
  color: #6b7280;
  margin-bottom: 4px;
}

.trial-indicator-bar {
  text-align: center;
  font-size: 0.72rem;
  font-weight: 700;
  color: #d97706;
  background: #fef3c7;
  border: 1px solid #fde68a;
  border-radius: 6px;
  padding: 4px 8px;
  margin-bottom: 8px;
}

.header-actions {
  position: absolute;
  right: 0;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  gap: 6px;
}

.btn-circle {
  background: #ffffff;
  border: 1px solid #d1d5db;
  border-radius: 50%;
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.1rem;
  cursor: pointer;
  box-shadow: 0 1px 2px rgba(0,0,0,0.05);
  padding: 0;
  line-height: 1;
}

/* Navegação Master */
.master-nav {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
  margin-bottom: 12px;
}

.nav-tab {
  padding: 9px 4px;
  background-color: #e5e7eb;
  color: #4b5563;
  border: none;
  border-radius: 8px;
  font-size: 0.85rem;
  font-weight: 700;
  cursor: pointer;
  text-align: center;
}

.nav-tab.active {
  background-color: #1e3a8a;
  color: #ffffff;
}

.impersonation-bar {
  background-color: #fef08a;
  border: 1px solid #eab308;
  color: #854d0e;
  border-radius: 8px;
  padding: 8px 12px;
  margin-bottom: 10px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 0.8rem;
}

.btn-back-master {
  background-color: #ca8a04;
  color: #ffffff;
  border: none;
  border-radius: 6px;
  padding: 5px 10px;
  font-size: 0.75rem;
  font-weight: 700;
  cursor: pointer;
  width: auto;
}

/* Ações do Dia */
.daily-actions-box {
  background: #fffbeb;
  border: 1px solid #fde68a;
  border-radius: 12px;
  padding: 12px 14px;
  margin-bottom: 14px;
  box-shadow: 0 2px 4px rgba(245, 158, 11, 0.08);
}

.daily-actions-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}

.daily-title {
  font-size: 0.95rem;
  font-weight: 800;
  color: #92400e;
}

.daily-badge {
  background-color: #fef3c7;
  color: #b45309;
  border: 1px solid #fcd34d;
  font-size: 0.72rem;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 12px;
}

.daily-desc {
  font-size: 0.78rem;
  color: #78350f;
  margin-bottom: 10px;
}

.daily-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 230px;
  overflow-y: auto;
}

.daily-item {
  background: #ffffff;
  border: 1px solid #fef08a;
  border-radius: 8px;
  padding: 8px 10px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.daily-item-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow: hidden;
}

.daily-item-name {
  font-size: 0.85rem;
  font-weight: 700;
  color: #1f2937;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.daily-item-status {
  font-size: 0.72rem;
  font-weight: 600;
}

.daily-item-status.today { color: #d97706; }
.daily-item-status.late { color: #dc2626; }

.btn-daily-wa {
  background-color: #25d366;
  color: white;
  text-decoration: none;
  font-size: 0.75rem;
  font-weight: 700;
  padding: 6px 10px;
  border-radius: 6px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
}

/* Paginação */
.pagination-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: #ffffff;
  padding: 10px 14px;
  border-radius: 10px;
  margin-top: 14px;
  box-shadow: 0 1px 2px rgba(0,0,0,0.05);
}

.btn-page {
  background-color: #2563eb;
  color: #ffffff;
  border: none;
  border-radius: 6px;
  padding: 8px 14px;
  font-size: 0.8rem;
  font-weight: 700;
  cursor: pointer;
  width: auto;
}

.btn-page:disabled {
  background-color: #d1d5db;
  color: #9ca3af;
  cursor: not-allowed;
}

.page-info {
  font-size: 0.82rem;
  font-weight: 600;
  color: #4b5563;
}

/* Painel de Revendedores */
.reseller-box, .reseller-list-box {
  background: #ffffff;
  padding: 16px;
  border-radius: 12px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.08);
  margin-bottom: 14px;
}

.reseller-box h2, .reseller-list-box h2 {
  font-size: 1rem;
  color: #111827;
  margin-bottom: 8px;
}

.reseller-help {
  font-size: 0.78rem;
  color: #6b7280;
  margin-bottom: 12px;
}

.reseller-card {
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  padding: 12px;
  margin-bottom: 12px;
  box-shadow: 0 1px 2px rgba(0,0,0,0.03);
}

.reseller-card.blocked-card {
  border-left: 5px solid #dc2626;
  background-color: #fef2f2;
}

.reseller-card-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 8px;
}

.reseller-card-header strong {
  font-size: 0.95rem;
  color: #111827;
  word-break: break-all;
}

.reseller-contact-line {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
  font-size: 0.78rem;
  color: #4b5563;
}

.btn-reseller-wa {
  background: #25d366;
  color: white;
  text-decoration: none;
  padding: 2px 7px;
  border-radius: 4px;
  font-size: 0.7rem;
  font-weight: bold;
}

.reseller-metrics-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
  margin: 10px 0;
  background: #ffffff;
  padding: 10px;
  border-radius: 8px;
  border: 1px solid #f3f4f6;
}

.reseller-metric-item {
  display: flex;
  flex-direction: column;
}

.reseller-metric-label {
  font-size: 0.68rem;
  color: #6b7280;
  font-weight: 600;
  text-transform: uppercase;
}

.reseller-metric-val {
  font-size: 0.95rem;
  font-weight: 800;
  color: #1f2937;
}

.reseller-card-actions {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(64px, 1fr));
  gap: 5px;
  margin-top: 10px;
}

.btn-r-act {
  border: none;
  padding: 8px 4px;
  border-radius: 6px;
  font-size: 0.72rem;
  font-weight: 700;
  cursor: pointer;
  text-align: center;
  width: 100%;
}

.btn-r-view { background-color: #2563eb; color: white; }
.btn-r-renew { background-color: #059669; color: white; }
.btn-r-block { background-color: #f59e0b; color: #111827; }
.btn-r-unblock { background-color: #10b981; color: white; }
.btn-r-backup { background-color: #4b5563; color: white; }
.btn-r-del { background-color: #fee2e2; color: #dc2626; }

/* Configuração do Pix e Formulários */
.pix-config {
  background: #ffffff;
  padding: 10px 14px;
  border-radius: 10px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.06);
  margin-bottom: 12px;
}

.pix-config label {
  display: block;
  font-size: 0.78rem;
  color: #374151;
  font-weight: 700;
  margin-bottom: 6px;
}

.pix-input-group {
  display: flex;
  gap: 8px;
}

.pix-input-group input {
  flex: 1;
  padding: 8px;
}

.btn-pix-save {
  width: auto;
  padding: 8px 14px;
  font-size: 0.82rem;
  background-color: #059669;
  color: white;
  border-radius: 7px;
  border: none;
  cursor: pointer;
  white-space: nowrap;
}

.status-summary {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-bottom: 12px;
}

.status-badge-card {
  background: #ffffff;
  padding: 12px 14px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  gap: 12px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.06);
  border-bottom: 3px solid transparent;
}

.status-badge-card.active-card { border-bottom-color: #16a34a; }
.status-badge-card.inactive-card { border-bottom-color: #dc2626; }

.status-icon { font-size: 1.4rem; line-height: 1; }
.status-info { display: flex; flex-direction: column; }
.status-title { font-size: 0.75rem; color: #6b7280; font-weight: 600; text-transform: uppercase; }
.status-info strong { font-size: 1.25rem; font-weight: 800; color: #111827; }

.dashboard {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  margin-bottom: 14px;
}

.dash-card {
  background: #ffffff;
  padding: 10px;
  border-radius: 10px;
  text-align: center;
  box-shadow: 0 1px 3px rgba(0,0,0,0.05);
}

.dash-label {
  display: block;
  font-size: 0.72rem;
  color: #6b7280;
  margin-bottom: 4px;
  text-transform: uppercase;
  font-weight: 600;
}

.dash-card strong { font-size: 0.95rem; color: #1f2937; }
.dash-card.ok strong { color: #166534; }
.dash-card.expired strong { color: #dc2626; }

form {
  background: #ffffff;
  padding: 14px;
  border-radius: 12px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.08);
  margin-bottom: 14px;
}

form h2 { font-size: 1rem; margin-bottom: 10px; }
.field { margin-bottom: 10px; }
.field-group { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
label { display: block; font-size: 0.8rem; font-weight: 600; margin-bottom: 3px; }

input[type="text"], input[type="tel"], input[type="date"], input[type="number"], input[type="email"], input[type="password"] {
  width: 100%;
  padding: 9px;
  border: 1px solid #d1d5db;
  border-radius: 7px;
}

.field-checkbox {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 10px 0 14px 0;
  background: #fffbeb;
  padding: 8px 10px;
  border-radius: 7px;
  border: 1px solid #fde68a;
}

.field-checkbox input { width: 18px; height: 18px; cursor: pointer; }
.field-checkbox label { margin-bottom: 0; font-size: 0.8rem; color: #92400e; cursor: pointer; }

.form-buttons { display: flex; gap: 8px; margin-top: 4px; }

button {
  width: 100%;
  padding: 11px;
  background-color: #2563eb;
  color: #ffffff;
  border: none;
  border-radius: 7px;
  font-size: 0.95rem;
  font-weight: 600;
  cursor: pointer;
}

button:active { opacity: 0.9; }
.btn-cancel { background-color: #6b7280; }

.backup-tools { display: flex; gap: 6px; margin-bottom: 6px; }

.btn-tool {
  flex: 1;
  padding: 8px;
  font-size: 0.78rem;
  background-color: #4b5563;
  color: #ffffff;
  border-radius: 6px;
  text-align: center;
  cursor: pointer;
  border: none;
  font-weight: 600;
}

.btn-upload { display: inline-flex; justify-content: center; align-items: center; }
.hidden-input { display: none; }

.backup-alert {
  font-size: 0.72rem;
  color: #6b7280;
  text-align: center;
  margin-bottom: 12px;
}

.search-box { margin-bottom: 10px; }
.sort-box { margin-top: 8px; }
.sort-box label { font-size: 0.78rem; font-weight: 600; color: #4b5563; }

.sort-box select {
  width: 100%;
  padding: 8px;
  border-radius: 7px;
  border: 1px solid #d1d5db;
  background: white;
  margin-top: 4px;
}

.filter-tabs {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 4px;
  margin-bottom: 14px;
}

.tab {
  background: #e5e7eb;
  color: #4b5563;
  padding: 8px 4px;
  font-size: 0.72rem;
  border-radius: 6px;
  border: none;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}

.tab.active { background: #2563eb; color: #ffffff; }

.cards-list { display: flex; flex-direction: column; gap: 10px; }

.card {
  background: #ffffff;
  padding: 12px 14px;
  border-radius: 10px;
  border-left: 5px solid #2563eb;
  box-shadow: 0 1px 2px rgba(0,0,0,0.05);
}

/* Borda Verde para Clientes em Dia */
.card.ok { border-left-color: #16a34a; }
.card.expired { border-left-color: #ef4444; }
.card.warning { border-left-color: #f59e0b; }

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 6px;
}

.card-header h3 { font-size: 1rem; color: #111827; }
.card-price { font-weight: 700; color: #111827; font-size: 0.95rem; }
.card-details p { font-size: 0.83rem; color: #4b5563; margin-bottom: 3px; }

.card-notes {
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  padding: 6px 10px;
  margin-top: 8px;
  font-size: 0.8rem;
  color: #374151;
}

.card-pending-alert {
  background: #fee2e2;
  border: 1px dashed #ef4444;
  color: #991b1b;
  border-radius: 6px;
  padding: 6px 10px;
  margin-top: 6px;
  font-size: 0.78rem;
  font-weight: 600;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.btn-clear-pending {
  background: #dc2626;
  color: #ffffff;
  border: none;
  border-radius: 4px;
  font-size: 0.7rem;
  font-weight: 700;
  padding: 4px 8px;
  cursor: pointer;
  width: auto;
}

.badge {
  display: inline-block;
  margin-top: 4px;
  font-size: 0.72rem;
  font-weight: bold;
  padding: 2px 6px;
  border-radius: 4px;
}

.badge.expired { background: #fee2e2; color: #991b1b; }
.badge.warning { background: #fef3c7; color: #92400e; }
.badge.ok { background: #dcfce7; color: #166534; }

.card-actions {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
  margin-top: 12px;
  padding-top: 8px;
  border-top: 1px solid #f3f4f6;
}

.btn-act {
  font-size: 0.75rem;
  font-weight: 600;
  padding: 8px 4px;
  min-height: 38px;
  border-radius: 6px;
  border: none;
  cursor: pointer;
  text-decoration: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  text-align: center;
}

.btn-whatsapp { background-color: #25d366; color: white; }
.btn-renew { background-color: #3b82f6; color: white; }
.btn-renew.blocked { background-color: #9ca3af; color: #f3f4f6; cursor: not-allowed; }
.btn-edit { background-color: #f3f4f6; color: #1f2937; border: 1px solid #d1d5db; }
.btn-delete { background-color: #fee2e2; color: #dc2626; }

/* Adaptação para Telas Ultra-Estreitas (<= 360px) */
@media (max-width: 360px) {
  body { padding: 8px; }
  .field-group { grid-template-columns: 1fr; gap: 8px; }
  .reseller-metrics-grid { grid-template-columns: 1fr; }
  .card-actions { grid-template-columns: 1fr 1fr; }
  .reseller-card-actions { grid-template-columns: 1fr 1fr; }
}