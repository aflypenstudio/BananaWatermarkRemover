# 圖片方向前綴功能設計

**日期**: 2026-07-08
**需求**: 下載時根據圖片方向在檔名前加上前綴

---

## 1. 需求摘要

下載圖片時自動侦测图片方向并修改檔名：
- **橫式圖片**（寬 > 高）：前綴 `R_`（Raster/Landscape）
- **直式圖片**（寬 ≤ 高）：前綴 `S_`（Stand/Portrait）

---

## 2. 實作計畫

### 2.1 修改個別下載 (`download()` 方法)

在 `D:/MyPython/GeminiWatermarkRemove/script.js` 的 `download()` 方法中：

修改檔名建構邏輯：

原：
```javascript
const nameParts = this.file.name.split('.');
nameParts.pop();
const suffix = Localization.get('cleanSuffix') || '_clean';
link.download = `${nameParts.join('.')}${suffix}${ext}`;
```

改為：
```javascript
const nameParts = this.file.name.split('.');
nameParts.pop();
const suffix = Localization.get('cleanSuffix') || '_clean';

// 偵測方向並加前綴
const w = outputCanvas.width;
const h = outputCanvas.height;
const prefix = w > h ? 'R_' : 'S_';

link.download = `${prefix}${nameParts.join('.')}${suffix}${ext}`;
```

### 2.2 修改批次下載

在批次下載的 ZIP 檔案名稱處理中，同樣加入前綴邏輯。

---

## 3. 實作檔案清單

| 檔案 | 變更內容 |
|------|----------|
| `script.js` | 修改 `download()` 和批次下載中 `link.download` 的組字串邏輯 |

---

## 4. 測試情境

1. 橫式圖片下載 → 確認檔名開頭為 `R_`
2. 直式圖片下載 → 確認檔名開頭為 `S_`
3. 批次下載 ZIP 內的檔案正確前綴