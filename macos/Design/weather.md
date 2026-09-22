# 天氣與限定魚美術（2026-09-22）

使用內建 imagegen 生成，既有 fish-atlas.png 僅作風格參考，未修改。新圖集位於 `../Sources/CatPond/Resources/weather-fish-atlas.png`，1536 × 1024；上排由左至右為雨滴魚、雷光魚、霧紗魚，下排留白。純白背景，沿用 multiply 合成；不是透明 PNG。各魚裁切範圍在 FishArtView.swift，已確認尾鰭完整。

雨傘以 WeatherPainter 原生 Canvas 繪製，固定在棧台旁，保留原有貓咪待機與收竿姿勢。雨絲避開傘下角色區，搭配水面雨滴漣漪；雷雨只改雨勢與環境色，不產生閃光；霧層緩慢移動。圖層使用既有 TimelineView，遵循隱藏與減少動態效果設定。

## 最終生成提示

> Use case: illustration-story. Asset type: production game sprite atlas. Create a NEW atlas of exactly THREE weather fish matching the warm hand-painted watercolor/gouache children's storybook style of the reference (reference is style only; do not copy its five fish). Canvas 1536x1024, strict invisible 3 columns x 2 rows grid, each cell square. Only TOP ROW occupied, BOTTOM ROW completely empty pure white. Each fish entirely inside its own 512x512 cell with 9% padding, facing RIGHT, centered at y=256. Top LEFT: raindrop fish, plump soft aqua-blue body, cream belly, smiling tiny mouth, big warm dark eye, a single large elegant translucent water-drop-shaped tail and droplets pattern. Top MIDDLE: thunderlight fish, deep violet body with distinct golden lightning bolt on flank, lively jagged gold-edged fins and tail, friendly eye. Top RIGHT: mistveil fish, pearly silver-white slender body, sage-gray edge definition so visible on white, flowing wispy translucent veil fins, calm eye. Fine brush strokes and softly textured scales only inside fish. Pure WHITE #FFFFFF background with no scenery or texture, no shadows outside fish, no text, labels, grid, frames, UI, extra objects or extra fish. All complete fins must fit within each cell. Strong distinctive silhouettes legible at small game size. Return one finished atlas.

## 驗證

`WeatherIntegrationTests/testRenderWeatherScenesAndAllFishAssets` 可輸出普通、雨天、雷雨、霧天、雨天收竿三階段、天氣設定與八種魚的原生渲染；設 `CATPOND_QA_ARTIFACTS` 指定輸出位置。所有素材隨 App 資源打包，不依賴生成工具的暫存路徑。
