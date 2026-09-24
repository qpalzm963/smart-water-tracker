# 完整視窗 UI／UX 更新

## 已確認範圍

保留魚缸、圖鑑、喝水紀錄、設定與杯墊四個頁面，延續溫暖繪本風格。魚缸仍自動展示最近 12 隻，不新增自選展示或變更儲存格式。

- 魚缸：三張一致的水彩水景、實景佈置選項、跨越魚缸的自然巡游、緩慢變換深度與邊緣轉身、暫停／繼續、點魚查看個別捕獲日期與可用的城市／天氣資料。空缸依是否有釣魚機會提供下一步。
- 圖鑑：收藏進度、全部／已相遇／未相遇篩選、收藏數、首捕與最近捕獲資訊、未解鎖魚種的相遇條件。
- 紀錄：今日進度與快速記錄、七日圖表及目標虛線、按日期分組、分批載入。自訂水量顯示範圍與欄位錯誤，支援 Enter 送出。
- 設定：日常偏好、天氣、杯墊、資料保存分組；次要規則收合。目標輸入即時檢查，只有成功寫入才顯示儲存成功。
- 原生體驗：沿用原生按鈕、表單、sheet 與 Escape 關閉；自訂收藏／佈置／導覽按鈕有懸停和焦點回饋。完整視窗使用固定明亮紙色，避免系統深色模式下文字失去對比。魚缸遵循系統減少動態效果，詳情開啟時暫停。

## 素材與生成方式

使用內建 `image_gen`，未使用 CLI。資源一律打包於 `Sources/CatPond/Resources/`：

- `aquarium-garden.png`：水草水景。
- `aquarium-rocks.png`：同水景加上苔蘚石頭。
- `aquarium-cottage.png`：同水景加上木製小屋。

魚兒沿用現有 atlas。水景使用底部對齊的填滿裁切，確保寬視窗與縮圖都保留砂床和佈置。互動魚兒的動畫圖層整体使用 multiply，避免原始白底 atlas 在 Button 合成邊界出現白色方塊。

### 水景原始提示

```text
Use case: illustration-story
Asset type: production background image for an interactive macOS aquarium, 1536x1024 landscape.
Primary request: A serene underwater freshwater aquarium background in a delicate traditional watercolor children's picture-book style, warm and handmade, designed behind separately rendered collectible fish.
Scene/backdrop: pale luminous mint and celadon water, muted jade botanical silhouettes far behind, gentle rays of warm cream sunlight filtering from the upper water surface, warm pale sand at the bottom 15 percent, a few small smooth river pebbles and tiny leaves. Sparse graceful water plants at far left and far right edges frame the open middle; plant tips remain below upper third.
Composition: straight front view from inside the aquarium, edge-to-edge underwater scenery without a physical tank frame. At least 70 percent of the middle and upper image is clean light pale watery negative space, intended for moving fish. Subtle pigment granulation, fine organic brushwork, soft atmospheric depth. Calm airy light palette with enough brightness for watercolor fish to be multiplied over it. Bottom foreground sand has a softly curved natural edge.
Constraints: background only, absolutely no fish, no animals, no people, no text, no labels, no UI, no borders, no logos, no houses, no large central objects, not photorealistic, not 3D, not vector. Keep scene uncluttered and paper textured.
```

### 佈置變體提示

以下共同提示以 `aquarium-garden.png` 為編輯目標，將 `{decoration}` 分別替換為後方兩段文字。

```text
Use case: precise-object-edit
Asset type: production aquarium scenery variant.
Edit target: the provided watercolor underwater aquarium backdrop.
Change only this: add {decoration}
Preserve the exact existing composition, water color, light rays, pale brightness, watercolor texture, proportions, background plants, and blank central swimming area. Match the same delicate traditional watercolor illustration, organic edges, pigment granulation, soft diffused light. The added decoration should feel painted as part of the original picture.
No fish, animals, people, text, UI, borders, or other new objects. Not vector, not flat shapes, not 3D. Output same 1536x1024 landscape.
```

石頭：

```text
a small natural composition of three rounded river stones, subtly covered with moss, resting on the sand at the lower right around x=76 percent, y=88 percent. The stone group must be no taller than 18 percent of the image height and no wider than 22 percent. Preserve all plants.
```

小屋：

```text
one miniature rustic wooden aquarium cottage on the sand at the lower right around x=76 percent, y=86 percent. Warm weathered wood, a muted terracotta pitched roof, one dark arched open doorway. A tiny moss tuft sits beside it. The cottage must be no taller than 22 percent of image height, no wider than 18 percent. The house is entirely submerged and rests on the sand. Preserve all existing plants.
```

## 驗證

`DetailExperienceTests` 新增 5 項測試：水量與目標輸入邊界、午夜紀錄分组與分頁、最近 12 隻、全缸巡游幅度、移動連續性與朝向、目標儲存失敗回報，以及獨立資料原生畫面渲染。渲染覆蓋 820 / 1100 pt 視窗、空魚缸／圖鑑、已收藏／未收藏詳情、無效目標及三種靜態佈置；檢查渲染不改寫測試來源資料。既有 36 項規則／動畫／天氣測試繼續保留。

```sh
CATPOND_QA_ARTIFACTS="$PWD/build/ui-qa" swift test
bash scripts/build-app.sh
```

全視窗的離屏截圖無法完整擷取 NavigationSplitView 的原生側欄，側欄須以實際 App 驗證。`build/ui-qa/小貓釣魚介面測試.app` 使用獨立 bundle ID 與 LSEnvironment 指向 `build/ui-qa/state.json`，不讀寫使用者的飲水紀錄。

2026-09-22 驗證結果：全套 41 項測試、Release 建置與 `codesign --verify --deep --strict` 通過。在獨立測試 App 實際確認側欄、魚缸暫停、點魚詳情、Escape 關閉、小屋佈置保存、無效水量 0 的阻擋、250 ml 成功記錄、目標 2500 ml 保存與進度回饋，以及已全收集時的未相遇篩選空狀態。未重新驗證實體杯墊連線或切換系統的減少動態效果設定。

測試 App 已結束。原生介面自動化工具在最後切回使用者 App 時連線中斷，無法代為完成正式 App 的重啟；目前執行中的舊版需結束再開啟 `build/小貓釣魚.app`。重啟前的本機資料備份位於 `build/backups/before-ui-restart-20260922-174635.json`。
