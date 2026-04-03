/**
 * background.js
 * Service Worker: 注文個別ページのfetch並列制御 + Shift-JIS変換 + CSV ダウンロード
 */

'use strict';

// Shift-JIS変換ライブラリ（Service Worker環境でimportScripts使用）
try {
  importScripts('lib/encoding.min.js');
} catch (e) {
  console.warn('[CP-CSV] encoding.min.js の読み込みに失敗:', e);
}

const CONCURRENCY = 3;      // 同時fetch数
const INTERVAL_MS = 500;    // リクエスト間インターバル(ms)

// =========================================================
// メッセージハンドラ
// =========================================================
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'FETCH_ORDERS') {
    handleFetchOrders(message.orders, sender.tab?.id)
      .then((results) => sendResponse({ results }))
      .catch((err) => sendResponse({ error: err.message }));
    return true; // 非同期レスポンスのため
  }

  if (message.type === 'DOWNLOAD_CSV') {
    handleDownloadCSV(message.csvText, message.filename)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }
});

// =========================================================
// 注文データの並列取得
// =========================================================
async function handleFetchOrders(orders, tabId) {
  const results = [];
  const total = orders.length;
  let completed = 0;

  // 並列制御: キューを CONCURRENCY 件ずつ処理
  for (let i = 0; i < orders.length; i += CONCURRENCY) {
    const batch = orders.slice(i, i + CONCURRENCY);

    const batchResults = await Promise.all(
      batch.map((order) => fetchOrderPage(order))
    );

    results.push(...batchResults);
    completed += batchResults.length;

    // 進捗をコンテンツスクリプトに通知
    if (tabId) {
      try {
        await chrome.tabs.sendMessage(tabId, {
          type: 'PROGRESS_UPDATE',
          current: completed,
          total: total,
        });
      } catch (e) {
        // タブが閉じられた等、エラーは無視
      }
    }

    // 最後のバッチでなければインターバルを挿入
    if (i + CONCURRENCY < orders.length) {
      await sleep(INTERVAL_MS);
    }
  }

  return results;
}

async function fetchOrderPage(order) {
  try {
    const response = await fetch(order.url, {
      credentials: 'include', // 同一ドメインなのでCookieが自動送信される
      headers: {
        'Accept': 'text/html,application/xhtml+xml',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const html = await response.text();
    const data = parseOrderPage(html);

    return {
      id: order.id,
      url: order.url,
      success: true,
      data,
    };
  } catch (err) {
    console.error(`[CP-CSV] Failed to fetch order ${order.id}:`, err);
    return {
      id: order.id,
      url: order.url,
      success: false,
      error: err.message,
    };
  }
}

// =========================================================
// HTMLパース: 発送先情報・商品タイトル抽出
// =========================================================
function parseOrderPage(html) {
  // DOMParser はService Workerでは使えないため、正規表現でパース
  const data = {
    postalCode: '',
    name: '',
    address: '',
    phone: '',
    product: '',
  };

  // address.trade_text.trade_container の内容を抽出
  // 例: <address class="trade_text trade_container">〒514-1251<br>三重県津市榜原甴5061-5<br>鶴見佳代様<br>09042108095</address>
  const addressMatch = html.match(
    /<address[^>]*class="[^"]*trade_text[^"]*trade_container[^"]*"[^>]*>([\s\S]*?)<\/address>/i
  );

  if (addressMatch) {
    const inner = addressMatch[1];
    // <br> タグで分割
    const parts = inner
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')   // 残りのタグを除去
      .split('\n')
      .map((s) => decodeHtmlEntities(s.trim()))
      .filter((s) => s.length > 0);

    // [郵便番号, 住所, 氏名, 電話番号]
    if (parts[0]) data.postalCode = parts[0];
    if (parts[1]) data.address = parts[1];
    if (parts[2]) data.name = parts[2];
    if (parts[3]) data.phone = parts[3];
  }

  // p.product_text.fw-bold の内容を抽出（複数商品対応）
  const productRegex = /<p[^>]*class="[^"]*product_text[^"]*fw-bold[^"]*"[^>]*>([\s\S]*?)<\/p>/gi;
  const productMatches = [];
  let productMatch;

  while ((productMatch = productRegex.exec(html)) !== null) {
    const text = productMatch[1]
      .replace(/<[^>]+>/g, '')
      .trim();
    const decoded = decodeHtmlEntities(text);
    if (decoded) productMatches.push(decoded);
  }

  if (productMatches.length > 0) {
    // 複数商品はカンマ区切りで結合し15文字に切り詰め
    data.product = truncate(productMatches.join('、'), 15);
  }

  return data;
}

function decodeHtmlEntities(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function truncate(str, maxLen) {
  if (!str) return '';
  const chars = [...str]; // サロゲートペア対応
  if (chars.length <= maxLen) return str;
  return chars.slice(0, maxLen).join('');
}

// =========================================================
// CSV ダウンロード (Shift-JIS変換)
// =========================================================
async function handleDownloadCSV(csvText, filename) {
  // Shift-JIS に変換
  const sjisArray = toShiftJIS(csvText);

  // Blob URL を作成してダウンロード
  const blob = new Blob([new Uint8Array(sjisArray)], {
    type: 'application/octet-stream',
  });

  const url = URL.createObjectURL(blob);

  await chrome.downloads.download({
    url: url,
    filename: filename,
    saveAs: false,
  });

  // しばらく後にBlobURLを解放
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

// =========================================================
// Shift-JIS 変換
// encoding.min.js は content script に読み込まれているが、
// background では使えないため、Web API + TextEncoder を使用した
// 独自の軽量変換を実装
// =========================================================
function toShiftJIS(str) {
  // encoding-japanese はService Workerでは使えないため
  // importScripts で読み込む
  try {
    // encoding.min.js を importScripts でロード済みの場合
    if (typeof Encoding !== 'undefined') {
      const unicodeArray = Array.from(str).map((c) => c.charCodeAt(0));
      return Encoding.convert(unicodeArray, 'SJIS', 'UNICODE');
    }
  } catch (e) {
    // フォールバック
  }

  // TextEncoder による UTF-8 → BOM付きUTF-8 フォールバック
  // (Shift-JIS変換できない場合はUTF-8で保存)
  console.warn('[CP-CSV] Shift-JIS変換不可。UTF-8で保存します。');
  const encoder = new TextEncoder();
  return Array.from(encoder.encode('\uFEFF' + str));
}

// =========================================================
// ユーティリティ
// =========================================================
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
