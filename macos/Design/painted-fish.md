# 程式繪製的新魚（2026-09-24）

新增櫻花、檸檬、草莓、小石、雲朵、泡泡、楓葉、緞帶、燈籠、極光十種普通魚。這次沒有生圖工具，改在 `Sources/CatPond/PaintedFish.swift` 以 SwiftUI Canvas 繪製，盡量貼近 `fish-atlas.png` 的繪本水彩風格：

- 水彩層：半透明底色、位移的二次上色、內部受光、色料暈染斑、邊緣加深、紙面顆粒。
- 魚身：背部較深、腹部奶油色，手繪感的鱗片與鰓線；共用 atlas 魚的琥珀大眼、腮紅與小嘴。小石魚是閉眼睡臉。
- 鰭：扇形鰭條、葉脈、花瓣缺口、楓葉、雲朵、緞帶與紗鰭，各魚剪影明顯不同，縮小時也能辨認。

每隻魚畫在 500 × 400 的畫布上、面朝右；`contentBounds` 記錄實際範圍，比照 atlas 的 `spriteBounds` 裁切放大填滿畫框。修改造型後需重新量測範圍，`PaintedFishTests` 會檢查每隻魚都有足夠的筆墨、而且沒有碰到畫框邊緣。每個魚種只繪製一次並快取成 2 倍解析度的點陣圖，魚缸游動時不會重畫。

程式繪製的筆觸質感仍比生成圖集平整。若之後想換成生成圖集，只要替這些魚種補上 `spriteBounds` 並指定圖集，`FishDrawing` 就會改用圖集顯示。

預覽：`CATPOND_QA_ARTIFACTS="$PWD/build/ui-qa" swift test --filter PaintedFishTests` 會輸出 `fish-gallery.png`（全部 18 種）。
