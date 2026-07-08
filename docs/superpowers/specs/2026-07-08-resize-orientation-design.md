# 圖片尺寸自動調整功能設計

**日期**: 2026-07-08
**作者**: aflypenstudio
**需求**: 新增偵測圖片方向並自動調整尺寸的功能

---

## 1. 需求摘要

在移除浮水印並添加 Logo 之後，依照圖片方向自動縮小到指定尺寸：
- **橫式圖片**（寬 > 高）：強制縮放至 1280×720
- **直式圖片**（寬 ≤ 高）：強制縮放至 720×1280

---

## 2. UI 變更

在 `index.html` 的全域操作區（`globalActions`）中，現有「格式」下拉選單旁新增：

```html
<!-- 新增：尺寸調整開關 -->
<div class="resize-toggle">
    <label>
        <input type="checkbox" id="resizeToggle">
        <span data-i18n="resizeLabel">縮放 1280×720 / 720×1280</span>
    </label>
</div>
```

同步更新 `translations.js` 多語言翻譯。

---

## 3. 程式碼變更

### 3.1 STATE 新增設定

```javascript
// script.js

const STATE = {
    // ... 現有欄位 ...

    downloadFormat: 'png',

    // 新增：縮放設定
    resizeAfterProcess: false  // true = 啟用自動縮放
};
```

### 3.2 下載邏輯修改

修改 `ImageProcessor.download()` 方法：

```javascript
download() {
    if (!this.state.processedImageData) return;

    const format = STATE.downloadFormat;
    const mimeType = format === 'jpeg' ? 'image/jpeg' : 'image/png';
    const ext = format === 'jpeg' ? '.jpg' : '.png';
    const quality = format === 'jpeg' ? 0.85 : undefined;

    let outputCanvas = this.elements.canvas;

    // 新增：如果啟用 resize
    if (STATE.resizeAfterProcess) {
        const w = outputCanvas.width;
        const h = outputCanvas.height;
        const isLandscape = w > h;

        // 目標尺寸
        const targetW = isLandscape ? 1280 : 720;
        const targetH = isLandscape ? 720 : 1280;

        // 建立目標 canvas 並強制縮放繪製
        const resizedCanvas = document.createElement('canvas');
        resizedCanvas.width = targetW;
        resizedCanvas.height = targetH;
        const ctx = resizedCanvas.getContext('2d');

        // 強制拉伸繪製（不保持比例）
        ctx.drawImage(outputCanvas, 0, 0, targetW, targetH);

        outputCanvas = resizedCanvas;
    }

    outputCanvas.toBlob((blob) => {
        // ... 現有下載邏輯 ...
    }, mimeType, quality);
}
```

### 3.3 批次下載修改

修改 `downloadAllBtn` 的點擊事件，同樣處理 resize 邏輯。

### 3.4 UI 事件綁定

在 `index.html` 新增 checkbox，在 `script.js` 加上監聽：

```javascript
const resizeToggle = document.getElementById('resizeToggle');
if (resizeToggle) {
    resizeToggle.addEventListener('change', (e) => {
        STATE.resizeAfterProcess = e.target.checked;
    });
}
```

### 3.5 多語言翻譯

在 `translations.js` 所有語系中新增：

```javascript
resizeLabel: {
    'zh-TW': '縮放 1280×720 / 720×1280',
    'zh-CN': '缩放 1280×720 / 720×1280',
    'en': 'Resize 1280×720 / 720×1280',
    'ja': 'リサイズ 1280×720 / 720×1280',
    'ko': '크기 조정 1280×720 / 720×1280'
}
```

---

## 4. CSS 樣式

在 `style.css` 新增：

```css
.format-selector,
.resize-toggle {
    display: flex;
    align-items: center;
    gap: 0.5rem;
}

.resize-toggle input[type="checkbox"] {
    width: auto;
    height: auto;
    cursor: pointer;
}
```

---

## 5. 實作檔案清單

| 檔案 | 變更內容 |
|------|----------|
| `index.html` | 新增 resize toggle checkbox |
| `script.js` | STATE 新增 `resizeAfterProcess`，修改 `download()` 和批次下載邏輯 |
| `translations.js` | 新增 `resizeLabel` 翻譯 |
| `style.css` | 新增 `.resize-toggle` 樣式 |

---

## 6. 測試情境

1. 上傳橫式圖片（寬 > 高），啟用 resize，下載確認尺寸為 1280×720
2. 上傳直式圖片（寬 ≤ 高），啟用 resize，下載確認尺寸為 720×1280
3. 停用 resize，下載確認為原始尺寸
4. 批次下載（含横式+直式混合），確認各自正確 resize
5. 確認所有語系的 UI 顯示正確