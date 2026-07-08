# 圖片尺寸自動調整功能 實作计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增偵測圖片方向並自動調整尺寸的功能（橫式 1280×720、直式 720×1280）

**Architecture:** 在下載流程中新增可選的尺寸調整步驟。偵測 `canvas.width > canvas.height` 判斷方向，然後用 `drawImage()` 強制拉伸到目標尺寸。

**Tech Stack:** Vanilla JS (無新依賴)

---

## 檔案變更預覽

| 檔案 | 變更內容 |
|------|----------|
| `index.html` | 全域操作區新增 resize toggle checkbox |
| `script.js` | STATE 新增 `resizeAfterProcess`，修改下載/批次下載邏輯 |
| `translations.js` | 5 個語系新增 `resizeLabel` |
| `style.css` | 新增 `.resize-toggle` 樣式 |

---

## Task 1: 新增 STATE 設定

**Files:**
- Modify: `D:/MyPython/GeminiWatermarkRemove/script.js:17`

- [ ] **Step 1: 在 STATE 中新增 resizeAfterProcess 欄位**

在 `downloadFormat: 'png'` 行下方新增：

```javascript
    downloadFormat: 'png', // 'png' or 'jpeg' - 全域下載格式設定

    // 新增：縮放設定
    resizeAfterProcess: false // true = 啟用自動縮放（橫式 1280×720 / 直式 720×1280）
};
```

---

## Task 2: 修改下載方法 (個別下載)

**Files:**
- Modify: `D:/MyPython/GeminiWatermarkRemove/script.js:641-663`

- [ ] **Step 1: 讀取現有的 download() 方法**

確認目前程式碼結構（已在上方讀取過）。

- [ ] **Step 2: 在 download() 方法中，在 `outputCanvas.toBlob` 呼叫前新增 resize 邏輯**

找到這段程式碼：
```javascript
        const format = STATE.downloadFormat;
        const mimeType = format === 'jpeg' ? 'image/jpeg' : 'image/png';
        const ext = format === 'jpeg' ? '.jpg' : '.png';
        const quality = format === 'jpeg' ? 0.85 : undefined; // JPEG 壓縮品質

        this.elements.canvas.toBlob((blob) => {
```

在 `const quality = ...` 這行**之後**、`this.elements.canvas.toBlob` 呼叫**之前**，插入：

```javascript
        const quality = format === 'jpeg' ? 0.85 : undefined; // JPEG 壓縮品質

        // 新增：如果啟用 resize，強制縮放到目標尺寸
        let outputCanvas = this.elements.canvas;
        if (STATE.resizeAfterProcess) {
            const w = outputCanvas.width;
            const h = outputCanvas.height;
            const isLandscape = w > h;

            const targetW = isLandscape ? 1280 : 720;
            const targetH = isLandscape ? 720 : 1280;

            const resizedCanvas = document.createElement('canvas');
            resizedCanvas.width = targetW;
            resizedCanvas.height = targetH;
            const ctx = resizedCanvas.getContext('2d');

            // 強制拉伸繪製（不改變比例、不留黑邊）
            ctx.drawImage(outputCanvas, 0, 0, targetW, targetH);

            outputCanvas = resizedCanvas;
        }

        outputCanvas.toBlob((blob) => {
```

---

## Task 3: 修改批次下載邏輯

**Files:**
- Modify: `D:/MyPython/GeminiWatermarkRemove/script.js:769-847`

- [ ] **Step 1: 讀取批次下載區段**

確認目前程式碼位置（約在 769 行）。

- [ ] **Step 2: 在每個 processor 的 blob 生成處加入相同的 resize 邏輯**

在 `p.elements.canvas.toBlob((blob) => {` 這行改為：

```javascript
                // 個別圖片 resize 處理
                let sourceCanvas = p.elements.canvas;
                if (STATE.resizeAfterProcess) {
                    const w = sourceCanvas.width;
                    const h = sourceCanvas.height;
                    const isLandscape = w > h;

                    const targetW = isLandscape ? 1280 : 720;
                    const targetH = isLandscape ? 720 : 1280;

                    const resizedCanvas = document.createElement('canvas');
                    resizedCanvas.width = targetW;
                    resizedCanvas.height = targetH;
                    const ctx = resizedCanvas.getContext('2d');
                    ctx.drawImage(sourceCanvas, 0, 0, targetW, targetH);

                    sourceCanvas = resizedCanvas;
                }

                sourceCanvas.toBlob((blob) => {
```

---

## Task 4: 新增 HTML checkbox

**Files:**
- Modify: `D:/MyPython/GeminiWatermarkRemove/index.html:109-115`

- [ ] **Step 1: 在格式下拉選單後方新增 resize checkbox**

在 `</select>` 和 `</div>` 之間插入：

```html
                </select>
                </div>
                <div class="resize-toggle">
                    <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer; font-size: 0.875rem; color: var(--text-primary);">
                        <input type="checkbox" id="resizeToggle" style="width: auto; height: auto; cursor: pointer;">
                        <span data-i18n="resizeLabel">縮放 1280×720 / 720×1280</span>
                    </label>
                </div>
            </div>
```

---

## Task 5: 綁定 UI 事件

**Files:**
- Modify: `D:/MyPython/GeminiWatermarkRemove/script.js`

- [ ] **Step 1: 在 `init()` 函式或檔案底部新增 resizeToggle 事件監聽**

在 `downloadFormatSelect` 事件監聽附近新增：

```javascript
const resizeToggle = document.getElementById('resizeToggle');
if (resizeToggle) {
    resizeToggle.addEventListener('change', (e) => {
        STATE.resizeAfterProcess = e.target.checked;
    });
}
```

---

## Task 6: 新增多語言翻譯

**Files:**
- Modify: `D:/MyPython/GeminiWatermarkRemove/translations.js`

- [ ] **Step 1: 在每個語系物件中新增 resizeLabel**

在 `translations` 物件的 `en` 語系最後（約倒數第二個區塊），在即將閉合的 `}` 前新增：

```javascript
        downloadAll: '下載全部',
        // 尺寸調整
        resizeLabel: '縮放 1280×720 / 720×1280'
    },
    'zh-CN': {
        // ... 現有內容 ...
        downloadAll: '下载全部',
        // 尺寸调整
        resizeLabel: '缩放 1280×720 / 720×1280'
    },
    en: {
        // ... 現有內容 ...
        downloadAll: 'Download All',
        // Resize
        resizeLabel: 'Resize 1280×720 / 720×1280'
    },
    ja: {
        // ... 現有內容 ...
        downloadAll: 'すべてダウンロード',
        // リサイズ
        resizeLabel: 'リサイズ 1280×720 / 720×1280'
    },
    ko: {
        // ... 現有內容 ...
        downloadAll: '전체 다운로드',
        // 크기 조정
        resizeLabel: '크기 조정 1280×720 / 720×1280'
    }
};
```

---

## Task 7: 新增 CSS 樣式

**Files:**
- Modify: `D:/MyPython/GeminiWatermarkRemove/style.css`

- [ ] **Step 1: 在 `.format-selector` 附近新增 `.resize-toggle` 樣式**

在 `style.css` 中搜尋 `.format-selector` 並在其後新增：

```css
.resize-toggle {
    display: flex;
    align-items: center;
}

.resize-toggle input[type="checkbox"] {
    width: auto;
    height: auto;
    cursor: pointer;
}
```

---

## Task 8: 驗證功能

- [ ] **Step 1: 用瀏覽器開啟 index.html**

可用任何方式開啟（如 `file://` 路徑或 local server）。

- [ ] **Step 2: 上傳一張橫式圖片，處理後測試**
- 取消勾選 resize → 下載 → 確認尺寸為原圖
- 勾選 resize → 下載 → 確認尺寸為 1280×720

- [ ] **Step 3: 上傳一張直式圖片，處理後測試**
- 取消勾選 resize → 下載 → 確認尺寸為原圖
- 勾選 resize → 下載 → 確認尺寸為 720×1280

- [ ] **Step 4: 批次下載測試**（橫式+直式混合）
- 勾選 resize → 批次下載 ZIP → 解壓縮後確認各圖片尺寸正確

---

## 預期結果

完成後下載區的 UI 會是：

```
[格式: PNG ▼]  [✓ 縮放 1280×720 / 720×1280]  [全部下載]
```

---

## 失敗檢查

確認以下項目：
1. STATE.resizeAfterProcess 正確設定
2. drawImage 四個參數是 `(src, 0, 0, destW, destH)` 而不是六個（不裁切）
3. resizeToggle.checked 直接賦值給 STATE.resizeAfterProcess
4. 五個語系都有 resizeLabel

Plan complete.