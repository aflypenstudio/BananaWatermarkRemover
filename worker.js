// worker.js

/**
 * 系統常數設定
 */
const CONSTANTS = {
    LARGE_THRESHOLD: 1024,
    MARGIN_LARGE: 64,
    MARGIN_SMALL: 32,
    MARGIN_LARGE_NEW: 192,
    MARGIN_SMALL_NEW: 96,
    LOGO_VALUE: 255.0,
    ALPHA_THRESHOLD: 0.002,
    MAX_ALPHA: 0.99,
    POSITION_SCORE_TOLERANCE: 0.05,
    POSITION_SCORE_THRESHOLD: 0.2
};

let masks = {
    small: null,
    large: null
};

// 監聽主執行緒的訊息
self.onmessage = function(e) {
    const { type, payload } = e.data;

    if (type === 'INIT_MASKS') {
        masks = payload; // { small: { width, height, alphas }, large: ... }
    } else if (type === 'PROCESS_IMAGE') {
        const { imageData, config } = payload;
        try {
            const result = removeWatermark(imageData, config);
            const watermarkRegion = result ? result.region : null;
            const appliedGain = result ? result.appliedGain : config.alphaGain;
            self.postMessage({
                type: 'PROCESS_COMPLETE',
                payload: { imageData, watermarkRegion, appliedGain },
                id: payload.id
            }, [imageData.data.buffer]); // 轉移 buffer
        } catch (err) {
            self.postMessage({
                type: 'PROCESS_ERROR',
                payload: err.message,
                id: payload.id
            });
        }
    }
};

/**
 * 執行浮水印去除的核心函式
 * 包含：選擇大小模式、定位浮水印區域、自動估算強度、套用逆向 Alpha 混合演算法
 */
function removeWatermark(imageData, config) {
    const w = imageData.width;
    const h = imageData.height;

    // 1. 決定尺寸模式
    let mode = config.forceMode;
    if (mode === 'auto') {
        if (w > CONSTANTS.LARGE_THRESHOLD && h > CONSTANTS.LARGE_THRESHOLD) {
            mode = 'large';
        } else {
            mode = 'small';
        }
    }

    const mask = mode === 'large' ? masks.large : masks.small;
    if (!mask) {
        throw new Error('Masks not loaded yet');
    }

    // 2. 智慧偵測浮水印區域
    const region = selectWatermarkRegion(imageData, mask, mode, config.forcePosition);
    if (!region) return null;

    const posX = region.x;
    const posY = region.y;

    // 3. 處理強度增益值 (優先自動偵測)
    const data = imageData.data;
    let gain = config.alphaGain;

    if (config.autoStrength) {
        gain = estimateOptimalGain(imageData, mask, posX, posY);
    }

    // 4. 執行逆向 Alpha 混合演算法消除浮水印
    for (let my = 0; my < mask.height; my++) {
        for (let mx = 0; mx < mask.width; mx++) {
            const iy = posY + my;
            const ix = posX + mx;

            if (ix >= w || iy >= h) continue;

            const mIdx = my * mask.width + mx;
            let alpha = mask.alphas[mIdx] * gain;

            if (alpha < CONSTANTS.ALPHA_THRESHOLD) continue;
            if (alpha > CONSTANTS.MAX_ALPHA) alpha = CONSTANTS.MAX_ALPHA;

            const oneMinusAlpha = 1.0 - alpha;
            const idx = (iy * w + ix) * 4;

            for (let c = 0; c < 3; c++) {
                const currentVal = data[idx + c];
                let original = (currentVal - alpha * CONSTANTS.LOGO_VALUE) / oneMinusAlpha;
                if (original < 0) original = 0;
                if (original > 255) original = 255;
                data[idx + c] = original;
            }
        }
    }

    return { region, appliedGain: gain };
}

/**
 * 依照新舊 Gemini 浮水印邊距候選值，選出最可能的浮水印區域。
 * 目前保留舊版 64/32px 邊距，同時支援新版 192/96px 邊距。
 */
function selectWatermarkRegion(imageData, mask, mode, forcePosition) {
    const w = imageData.width;
    const h = imageData.height;
    
    let margins = [];
    if (forcePosition === 'new') {
        margins = [mode === 'large' ? CONSTANTS.MARGIN_LARGE_NEW : CONSTANTS.MARGIN_SMALL_NEW];
    } else if (forcePosition === 'old') {
        margins = [mode === 'large' ? CONSTANTS.MARGIN_LARGE : CONSTANTS.MARGIN_SMALL];
    } else {
        margins = mode === 'large'
            ? [CONSTANTS.MARGIN_LARGE, CONSTANTS.MARGIN_LARGE_NEW]
            : [CONSTANTS.MARGIN_SMALL, CONSTANTS.MARGIN_SMALL_NEW];
    }

    const candidates = margins
        .map(margin => ({
            margin,
            x: w - margin - mask.width,
            y: h - margin - mask.height,
            width: mask.width,
            height: mask.height,
            score: Number.NEGATIVE_INFINITY
        }))
        .filter(region => region.x >= 0 && region.y >= 0);

    if (candidates.length === 0) return null;

    if (forcePosition && forcePosition !== 'auto') {
        return candidates[0];
    }

    for (const candidate of candidates) {
        candidate.score = scoreWatermarkCandidate(imageData, mask, candidate);
    }

    const best = candidates.reduce((currentBest, candidate) => (
        candidate.score > currentBest.score ? candidate : currentBest
    ));
    const newerCandidate = candidates.find(candidate => (
        candidate.margin === CONSTANTS.MARGIN_LARGE_NEW ||
        candidate.margin === CONSTANTS.MARGIN_SMALL_NEW
    ));

    // 新版 Gemini 樣本會落在 192/96px 邊距；分數接近時優先使用新版位置。
    if (
        newerCandidate &&
        newerCandidate.score >= CONSTANTS.POSITION_SCORE_THRESHOLD &&
        newerCandidate.score >= best.score - CONSTANTS.POSITION_SCORE_TOLERANCE
    ) {
        return newerCandidate;
    }

    return best;
}

/**
 * 使用遮罩與影像灰階值的相關性評分，估計候選區域是否像 Gemini 星形浮水印。
 * 計算皮爾森相關係數 (Pearson Correlation Coefficient) 作為相關度指標。
 */
function scoreWatermarkCandidate(imageData, mask, region) {
    const data = imageData.data;
    const stride = imageData.width * 4;
    const sampleStep = 1;
    let sumMask = 0;
    let sumGray = 0;
    let count = 0;

    for (let my = 0; my < mask.height; my += sampleStep) {
        for (let mx = 0; mx < mask.width; mx += sampleStep) {
            const maskValue = mask.alphas[my * mask.width + mx];
            const idx = ((region.y + my) * stride) + ((region.x + mx) * 4);
            const gray = data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114;

            sumMask += maskValue;
            sumGray += gray;
            count++;
        }
    }

    const meanMask = sumMask / count;
    const meanGray = sumGray / count;
    let covariance = 0;
    let maskVariance = 0;
    let grayVariance = 0;

    for (let my = 0; my < mask.height; my += sampleStep) {
        for (let mx = 0; mx < mask.width; mx += sampleStep) {
            const maskDiff = mask.alphas[my * mask.width + mx] - meanMask;
            const idx = ((region.y + my) * stride) + ((region.x + mx) * 4);
            const gray = data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114;
            const grayDiff = gray - meanGray;

            covariance += maskDiff * grayDiff;
            maskVariance += maskDiff * maskDiff;
            grayVariance += grayDiff * grayDiff;
        }
    }

    if (maskVariance <= 0 || grayVariance <= 0) return 0;
    return covariance / Math.sqrt(maskVariance * grayVariance);
}

/**
 * 估算最佳的浮水印強度增益值 (alphaGain)
 * 使用多維度評估演算法，結合以下指標：
 * 1. 亮度一致性：水印區域內亮度的變異係數，越小越好
 * 2. 邊緣融合度：水印邊緣與背景的過渡是否自然
 * 3. 峰值檢測：處理後不應該有明顯的亮斑或暗斑
 *
 * 搜尋範圍：0.05 ~ 2.0，步进 0.01（200個候選值）
 */
function estimateOptimalGain(imageData, mask, posX, posY) {
    const data = imageData.data;
    const w = imageData.width;
    const h = imageData.height;

    // 搜尋範圍：擴大到 0.05 ~ 2.0，精度提升到 0.01
    const GAIN_MIN = 0.05;
    const GAIN_MAX = 2.0;
    const GAIN_STEP = 0.01;

    // 收集有效像素的位置（mask alpha > 0.05 的區域）
    const validPositions = [];
    for (let my = 0; my < mask.height; my++) {
        for (let mx = 0; mx < mask.width; mx++) {
            if (mask.alphas[my * mask.width + mx] > 0.05) {
                const ix = posX + mx;
                const iy = posY + my;
                if (ix >= 0 && ix < w && iy >= 0 && iy < h) {
                    validPositions.push({ mx, my, ix, iy });
                }
            }
        }
    }

    // 收集邊緣參考點（在水印區域邊緣外的像素，用於對比背景）
    const edgePositions = [];
    const edgeMargin = 5; // 邊緣參考的範圍
    const maskCenterX = posX + mask.width / 2;
    const maskCenterY = posY + mask.height / 2;

    // 收集四個方向的邊緣背景像素
    const directions = [
        { dx: -1, dy: 0 },  // 左
        { dx: 1, dy: 0 },   // 右
        { dx: 0, dy: -1 },  // 上
        { dx: 0, dy: 1 }    // 下
    ];

    for (let my = 0; my < mask.height; my++) {
        for (let mx = 0; mx < mask.width; mx++) {
            if (mask.alphas[my * mask.width + mx] > 0.05) {
                const ix = posX + mx;
                const iy = posY + my;

                // 檢查是否是邊緣像素（至少一面是背景）
                for (const dir of directions) {
                    const nx = ix + dir.dx;
                    const ny = iy + dir.dy;
                    // 如果相鄰像素不在水印區域內，則是邊緣參考點
                    const nxInMask = nx >= posX && nx < posX + mask.width && ny >= posY && ny < posY + mask.height;
                    const nMaskIdx = (ny - posY) * mask.width + (nx - posX);
                    if (!nxInMask || mask.alphas[nMaskIdx] <= 0.05) {
                        if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
                            edgePositions.push({ x: ix, y: iy });
                        }
                        break;
                    }
                }
            }
        }
    }

    let bestGain = 0.5;
    let bestScore = Number.NEGATIVE_INFINITY;

    // 搜尋每個候選 gain
    for (let g = GAIN_MIN; g <= GAIN_MAX; g += GAIN_STEP) {
        const scores = assessGain(imageData, mask, posX, posY, g, validPositions, edgePositions, w, h);
        const totalScore = scores.uniformity + scores.edgeBlend + scores.peak * 0.5;

        if (totalScore > bestScore) {
            bestScore = totalScore;
            bestGain = g;
        }
    }

    return parseFloat(bestGain.toFixed(2));
}

/**
 * 評估某個 gain 值的效果
 * 返回多維度評分
 */
function assessGain(imageData, mask, posX, posY, gain, validPositions, edgePositions, w, h) {
    const data = imageData.data;
    const logoValue = CONSTANTS.LOGO_VALUE;

    // 計算還原後的水印區域灰階值
    const grayValues = [];
    for (const pos of validPositions) {
        const mIdx = pos.my * mask.width + pos.mx;
        let alpha = mask.alphas[mIdx] * gain;
        if (alpha > CONSTANTS.MAX_ALPHA) alpha = CONSTANTS.MAX_ALPHA;
        if (alpha < CONSTANTS.ALPHA_THRESHOLD) {
            grayValues.push(null); // 跳過透明區域
            continue;
        }

        const oneMinusAlpha = 1.0 - alpha;
        const idx = (pos.iy * w + pos.ix) * 4;

        const r = clamp8((data[idx] - alpha * logoValue) / oneMinusAlpha);
        const gr = clamp8((data[idx + 1] - alpha * logoValue) / oneMinusAlpha);
        const b = clamp8((data[idx + 2] - alpha * logoValue) / oneMinusAlpha);

        const gray = r * 0.299 + gr * 0.587 + b * 0.114;
        grayValues.push(gray);
    }

    // 1. 評估亮度一致性（變異係數越小越好）
    const validGrays = grayValues.filter(g => g !== null);
    let uniformityScore = 0;
    if (validGrays.length > 1) {
        const mean = validGrays.reduce((a, b) => a + b, 0) / validGrays.length;
        const variance = validGrays.reduce((sum, g) => sum + (g - mean) ** 2, 0) / validGrays.length;
        const stdDev = Math.sqrt(variance);

        // 變異係數 (CV) = 標準差 / 平均值
        // CV 越小表示亮度越一致，水印消除越乾淨
        // 轉換為評分：CV 越小分數越高
        const cv = stdDev / (mean + 0.001);

        // 使用 Sigmoid 函數轉換：理想 CV 應該很小（< 0.1）
        // 轉換後的分數範圍是 0 ~ 1
        uniformityScore = 1 / (1 + Math.exp((cv - 0.05) * 20));
    }

    // 2. 評估邊緣融合度（處理後的亮度應該與背景接近）
    let edgeBlendScore = 0;
    if (edgePositions.length > 0) {
        // 收集處理後的水印邊緣像素
        const edgeProcessedGrays = [];
        for (const pos of validPositions) {
            const inEdgeList = edgePositions.some(e => e.x === pos.ix && e.y === pos.iy);
            if (inEdgeList && grayValues[validPositions.indexOf(pos)] !== null) {
                edgeProcessedGrays.push(grayValues[validPositions.indexOf(pos)]);
            }
        }

        // 收集邊緣外的背景像素（從水印中心向外延伸）
        const backgroundGrays = [];
        for (const pos of edgePositions) {
            const idx = (pos.y * w + pos.x) * 4;
            const gray = data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114;
            backgroundGrays.push(gray);
        }

        if (edgeProcessedGrays.length > 0 && backgroundGrays.length > 0) {
            const edgeMean = edgeProcessedGrays.reduce((a, b) => a + b, 0) / edgeProcessedGrays.length;
            const bgMean = backgroundGrays.reduce((a, b) => a + b, 0) / backgroundGrays.length;

            // 邊緣處理後的亮度應該接近背景
            // 差異越小分數越高
            const diff = Math.abs(edgeMean - bgMean);
            edgeBlendScore = Math.exp(-diff / 30); // 高斯衰減
        } else {
            edgeBlendScore = 0.5; // 無法評估時給中等分
        }
    } else {
        edgeBlendScore = 0.5;
    }

    // 3. 評估峰值（不應該有明顯的亮斑或暗斑）
    let peakScore = 0;
    if (validGrays.length > 0) {
        // 使用中位數絕對偏差 (MAD) 來檢測異常值
        const sorted = [...validGrays].sort((a, b) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)];
        const absDevs = validGrays.map(g => Math.abs(g - median));
        const mad = absDevs.reduce((a, b) => a + b, 0) / absDevs.length;

        // 計算有多少像素偏離中位數超過 2 * MAD
        const threshold = 2 * (mad + 0.001);
        const peakCount = absDevs.filter(d => d > threshold).length;
        const peakRatio = peakCount / validGrays.length;

        // 峰值比例越小越好
        peakScore = Math.exp(-peakRatio * 5);
    }

    return {
        uniformity: uniformityScore,
        edgeBlend: edgeBlendScore,
        peak: peakScore
    };
}

/**
 * 將浮點數限制在 0-255 範圍內
 */
function clamp8(val) {
    if (val < 0) return 0;
    if (val > 255) return 255;
    return val;
}
