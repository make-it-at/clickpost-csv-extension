/**
 * content.js
 * リベシティフリマ注文一覧ページへのUI注入スクリプト
 */

// スクリプト注入確認用（IIFEの外）
console.log('[CP-CSV] content.js スクリプト注入OK');

(function () {
  'use strict';

  const MAX_ORDERS = 40;
  let injected = false;
  let observer = null;

  // =========================================================
  // DOM監視 - SPA対応
  // =========================================================
  function startObserver() {
    if (observer) observer.disconnect();

    observer = new MutationObserver(() => {
      checkAndInject();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  function checkAndInject() {
    // URL に /seller/orders があることを確認（個別ページを除外）
    const path = window.location.pathname;
    console.log('[CP-CSV] checkAndInject path:', path);

    if (path.match(/^\/seller\/orders\/[^/]+/)) {
      console.log('[CP-CSV] 個別ページのためスキップ');
      return;
    }

    // 注文行が存在するか確認
    const orderRows = getOrderRows();
    console.log('[CP-CSV] 注文行数:', orderRows.length);
    if (orderRows.length === 0) {
      console.log('[CP-CSV] 注文行が見つかりません（まだDOMが未準備かも）');
      return;
    }

    // 既に注入済みの場合はチェックボックスのみ更新
    if (document.getElementById('cp-toolbar')) {
      updateCheckboxes();
      return;
    }

    console.log('[CP-CSV] UI注入開始');
    injectUI();
  }

  function isTradingActive() {
    // タブ要素を探す
    const tabs = document.querySelectorAll(
      'a[href*="status"], button[data-status], .tab-item, .nav-link, [role="tab"]'
    );

    for (const tab of tabs) {
      const text = tab.textContent.trim();
      const isActive =
        tab.classList.contains('active') ||
        tab.getAttribute('aria-selected') === 'true' ||
        tab.closest('.active') !== null;

      if (isActive && (text.includes('取引中') || text.includes('trading'))) {
        return true;
      }
    }

    // URL パラメータで判断
    const url = new URL(window.location.href);
    const status = url.searchParams.get('status') || url.searchParams.get('tab');
    if (status === 'trading' || status === null || status === '') {
      // デフォルト（パラメータなし）も取引中とみなす場合
      // 実際のサイト構造に応じて調整が必要
      return true;
    }

    return false;
  }

  function getOrderRows() {
    // 注文行のセレクタ（リベシティフリマの実際のDOM構造に合わせた順序）
    const selectors = [
      '.statusBox.seller',   // リベシティフリマの実際のセレクタ
      'tr[data-order-id]',
      '[class*="order-row"]',
      '[class*="order_row"]',
      'tbody tr',
      '[class*="trade-item"]',
      '[class*="trade_item"]',
      'li[class*="order"]',
    ];

    for (const sel of selectors) {
      const rows = document.querySelectorAll(sel);
      if (rows.length > 0) return Array.from(rows);
    }

    return [];
  }

  // =========================================================
  // UI注入
  // =========================================================
  function injectUI() {
    // ツールバー作成
    const toolbar = createToolbar();

    // 注文一覧コンテナの前に挿入
    const container = findOrderContainer();
    console.log('[CP-CSV] コンテナ:', container);
    if (!container) {
      console.warn('[CP-CSV] コンテナが見つかりません。注文行の前に直接挿入します');
      const rows = getOrderRows();
      if (rows.length > 0) {
        rows[0].parentNode.insertBefore(toolbar, rows[0]);
      }
    } else {
      container.parentNode.insertBefore(toolbar, container);
    }

    // チェックボックス注入
    updateCheckboxes();

    injected = true;
    console.log('[CP-CSV] UI注入完了');
  }

  function createToolbar() {
    const toolbar = document.createElement('div');
    toolbar.id = 'cp-toolbar';
    toolbar.innerHTML = `
      <div class="cp-toolbar-inner">
        <div class="cp-toolbar-left">
          <button id="cp-toggle-all" class="cp-btn cp-btn-secondary">
            全選択
          </button>
          <span id="cp-count-display" class="cp-count">0件選択中 / 上限 ${MAX_ORDERS}件</span>
        </div>
        <div class="cp-toolbar-right">
          <button id="cp-generate-btn" class="cp-btn cp-btn-primary" disabled>
            📋 クリックポストCSV生成
          </button>
        </div>
      </div>
      <div id="cp-warning" class="cp-warning" style="display:none">
        ⚠️ 40件を超えて選択されています。先頭40件のみCSVに含まれます。
      </div>
      <div id="cp-progress" class="cp-progress" style="display:none">
        <div class="cp-progress-text">準備中...</div>
        <div class="cp-progress-bar"><div class="cp-progress-fill" style="width:0%"></div></div>
      </div>
    `;

    // イベント登録
    toolbar.querySelector('#cp-toggle-all').addEventListener('click', toggleAll);
    toolbar.querySelector('#cp-generate-btn').addEventListener('click', generateCSV);

    return toolbar;
  }

  function findOrderContainer() {
    const selectors = [
      '.sortBox_seller',     // リベシティフリマの実際のコンテナ
      'table',
      '[class*="order-list"]',
      '[class*="order_list"]',
      '[class*="trade-list"]',
      '[class*="trade_list"]',
      'ul[class*="order"]',
      '.orders-container',
    ];

    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) return el;
    }

    // フォールバック: 注文行の親要素
    const rows = getOrderRows();
    if (rows.length > 0) return rows[0].parentNode;

    return null;
  }

  function updateCheckboxes() {
    const rows = getOrderRows();

    rows.forEach((row) => {
      // 既に注入済みならスキップ
      if (row.querySelector('.cp-checkbox')) return;

      const orderId = extractOrderId(row);
      if (!orderId) return;

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'cp-checkbox';
      cb.dataset.orderId = orderId;
      cb.dataset.orderUrl = `https://furima.libecity.com/seller/orders/${orderId}`;

      cb.addEventListener('change', onCheckboxChange);

      // divカード構造に対応したラッパー
      const cbWrapper = document.createElement('div');
      cbWrapper.className = 'cp-checkbox-cell';
      cbWrapper.appendChild(cb);

      // カードの先頭に挿入（tr/tdの有無に関わらず対応）
      const firstCell = row.querySelector('td, th');
      if (firstCell) {
        row.insertBefore(cbWrapper, firstCell);
      } else {
        row.prepend(cbWrapper);
      }
    });
  }

  function extractOrderId(row) {
    // data属性から取得
    if (row.dataset.orderId) return row.dataset.orderId;
    if (row.dataset.id) return row.dataset.id;

    // .btn_order リンクから取得（リベシティフリマの実際の構造）
    const btnOrder = row.querySelector('.btn_order');
    if (btnOrder) {
      const match = btnOrder.href.match(/\/orders\/(\d+)/);
      if (match) return match[1];
    }

    // 汎用リンクから取得
    const link = row.querySelector('a[href*="/orders/"]');
    if (link) {
      const match = link.href.match(/\/orders\/(\d+)/);
      if (match) return match[1];
    }

    // クラス名やIDから取得
    const idMatch = (row.id || row.className).match(/(\d{5,})/);
    if (idMatch) return idMatch[1];

    return null;
  }

  // =========================================================
  // チェックボックスの状態管理
  // =========================================================
  function getCheckedBoxes() {
    return Array.from(document.querySelectorAll('.cp-checkbox:checked'));
  }

  function onCheckboxChange() {
    updateUI();
  }

  function toggleAll() {
    const allBoxes = Array.from(document.querySelectorAll('.cp-checkbox'));
    const checkedBoxes = allBoxes.filter((cb) => cb.checked);
    const shouldCheck = checkedBoxes.length < allBoxes.length;

    allBoxes.forEach((cb) => {
      cb.checked = shouldCheck;
    });

    const btn = document.getElementById('cp-toggle-all');
    if (btn) btn.textContent = shouldCheck ? '全解除' : '全選択';

    updateUI();
  }

  function updateUI() {
    const checked = getCheckedBoxes();
    const count = checked.length;

    const countDisplay = document.getElementById('cp-count-display');
    if (countDisplay) {
      countDisplay.textContent = `${count}件選択中 / 上限 ${MAX_ORDERS}件`;
      countDisplay.classList.toggle('cp-count-warning', count > MAX_ORDERS);
    }

    const warning = document.getElementById('cp-warning');
    if (warning) {
      warning.style.display = count > MAX_ORDERS ? 'block' : 'none';
    }

    const generateBtn = document.getElementById('cp-generate-btn');
    if (generateBtn) {
      generateBtn.disabled = count === 0;
    }
  }

  function removeInjectedUI() {
    const toolbar = document.getElementById('cp-toolbar');
    if (toolbar) toolbar.remove();

    document.querySelectorAll('.cp-checkbox-cell').forEach((el) => el.remove());

    injected = false;
  }

  // =========================================================
  // CSV生成
  // =========================================================
  async function generateCSV() {
    const checkedBoxes = getCheckedBoxes();
    if (checkedBoxes.length === 0) return;

    const orders = checkedBoxes.slice(0, MAX_ORDERS).map((cb) => ({
      id: cb.dataset.orderId,
      url: cb.dataset.orderUrl,
    }));

    // UI をローディング状態に
    setLoading(true, orders.length);

    try {
      // background.js にメッセージを送信してデータ取得
      const results = await fetchOrdersViaBackground(orders);

      // CSV生成
      const csv = buildCSV(results);

      // ダウンロード
      downloadCSV(csv);

      // 結果サマリー表示
      showResults(results);
    } catch (err) {
      console.error('[CP-CSV] Error:', err);
      showError('CSV生成中にエラーが発生しました: ' + err.message);
    } finally {
      setLoading(false, 0);
    }
  }

  function fetchOrdersViaBackground(orders) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        {
          type: 'FETCH_ORDERS',
          orders: orders,
        },
        (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          if (response && response.error) {
            reject(new Error(response.error));
            return;
          }
          resolve(response.results || []);
        }
      );
    });
  }

  // =========================================================
  // CSV構築
  // =========================================================
  function buildCSV(results) {
    const header =
      'お届け先郵便番号,お届け先氏名,お届け先敬称,お届け先住所1行目,お届け先住所2行目,お届け先住所3行目,お届け先住所4行目,内容品';

    const rows = results
      .filter((r) => r.success)
      .map((r) => buildRow(r.data));

    return [header, ...rows].join('\r\n');
  }

  function buildRow(data) {
    const { postalCode, name, address, product } = data;

    // A列: 郵便番号（〒除去）
    const zip = cleanPostalCode(postalCode);

    // B列: 氏名（様・御中除去、20文字以内）
    const cleanName = truncate(removeSuffix(name), 20);

    // C列: 敬称
    const honorific = hasSuffix(name) ? '様' : '';

    // D-G列: 住所分割
    const [addr1, addr2, addr3, addr4] = splitAddress(address);

    // H列: 内容品（15文字以内）
    const item = truncate(product, 15);

    const cols = [zip, cleanName, honorific, addr1, addr2, addr3, addr4, item];
    return cols.map(escapeCSV).join(',');
  }

  function cleanPostalCode(raw) {
    if (!raw) return '';
    // 〒除去、数字とハイフンのみ残す
    return raw.replace(/[〒]/g, '').replace(/[^\d-]/g, '').trim();
  }

  function removeSuffix(name) {
    if (!name) return '';
    return name.replace(/[様御中]$/, '').trim();
  }

  function hasSuffix(name) {
    if (!name) return false;
    return /[様御中]$/.test(name.trim());
  }

  function splitAddress(address) {
    if (!address) return ['', '', '', ''];

    const MAX = 20;
    if ([...address].length <= MAX) {
      return [address, '', '', ''];
    }

    // 20文字ずつ分割（全角対応）
    const chars = [...address];
    const parts = [];
    for (let i = 0; i < chars.length && parts.length < 4; i += MAX) {
      parts.push(chars.slice(i, i + MAX).join(''));
    }

    while (parts.length < 4) parts.push('');
    return parts.slice(0, 4);
  }

  function truncate(str, maxLen) {
    if (!str) return '';
    const chars = [...str];
    if (chars.length <= maxLen) return str;
    return chars.slice(0, maxLen).join('');
  }

  function escapeCSV(val) {
    if (val === null || val === undefined) return '';
    const str = String(val);
    if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  }

  // =========================================================
  // ダウンロード
  // =========================================================
  function downloadCSV(csvText) {
    // background.js 経由でダウンロード（Shift-JIS変換込み）
    chrome.runtime.sendMessage({
      type: 'DOWNLOAD_CSV',
      csvText: csvText,
      filename: generateFilename(),
    });
  }

  function generateFilename() {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const date =
      now.getFullYear() +
      pad(now.getMonth() + 1) +
      pad(now.getDate()) +
      '_' +
      pad(now.getHours()) +
      pad(now.getMinutes()) +
      pad(now.getSeconds());
    return `clickpost_${date}.csv`;
  }

  // =========================================================
  // UI状態制御
  // =========================================================
  function setLoading(loading, total) {
    const progress = document.getElementById('cp-progress');
    const generateBtn = document.getElementById('cp-generate-btn');

    if (loading) {
      if (progress) {
        progress.style.display = 'block';
        progress.querySelector('.cp-progress-text').textContent = `0/${total}件取得中...`;
        progress.querySelector('.cp-progress-fill').style.width = '0%';
      }
      if (generateBtn) {
        generateBtn.disabled = true;
        generateBtn.textContent = '処理中...';
      }
    } else {
      if (progress) progress.style.display = 'none';
      if (generateBtn) {
        generateBtn.disabled = false;
        generateBtn.textContent = '📋 クリックポストCSV生成';
      }
    }
  }

  // background.js からの進捗メッセージを受信
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'PROGRESS_UPDATE') {
      const progress = document.getElementById('cp-progress');
      if (progress) {
        const { current, total } = message;
        progress.querySelector('.cp-progress-text').textContent = `${current}/${total}件取得中...`;
        const pct = total > 0 ? Math.round((current / total) * 100) : 0;
        progress.querySelector('.cp-progress-fill').style.width = `${pct}%`;
      }
    }
  });

  function showResults(results) {
    const failed = results.filter((r) => !r.success);
    if (failed.length === 0) {
      showSuccess(`${results.filter((r) => r.success).length}件のCSVを生成しました`);
    } else {
      const failedIds = failed.map((r) => `✗ 注文ID: ${r.id} 取得失敗`).join('\n');
      showWarning(
        `${results.filter((r) => r.success).length}件のCSVを生成しました。\n失敗: ${failed.length}件\n${failedIds}`
      );
    }
  }

  function showSuccess(msg) {
    showNotification(msg, 'success');
  }

  function showWarning(msg) {
    showNotification(msg, 'warning');
  }

  function showError(msg) {
    showNotification(msg, 'error');
  }

  function showNotification(msg, type) {
    // 既存の通知を削除
    const existing = document.getElementById('cp-notification');
    if (existing) existing.remove();

    const notif = document.createElement('div');
    notif.id = 'cp-notification';
    notif.className = `cp-notification cp-notification-${type}`;
    notif.style.whiteSpace = 'pre-line';
    notif.textContent = msg;

    const toolbar = document.getElementById('cp-toolbar');
    if (toolbar) {
      toolbar.appendChild(notif);
    }

    // 5秒後に自動消去（エラー以外）
    if (type !== 'error') {
      setTimeout(() => notif.remove(), 5000);
    }
  }

  // =========================================================
  // 初期化
  // =========================================================
  function init() {
    console.log('[CP-CSV] content.js 読み込み完了 URL:', window.location.href);
    console.log('[CP-CSV] isTradingActive:', isTradingActive());
    console.log('[CP-CSV] getOrderRows:', getOrderRows().length, '件');
    checkAndInject();
    startObserver();
  }

  // URLの変化を監視（SPAナビゲーション対応）
  let lastUrl = location.href;
  new MutationObserver(() => {
    const currentUrl = location.href;
    if (currentUrl !== lastUrl) {
      lastUrl = currentUrl;
      injected = false;
      setTimeout(checkAndInject, 500);
    }
  }).observe(document, { subtree: true, childList: true });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
