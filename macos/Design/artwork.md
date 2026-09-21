# 美術來源與生成紀錄

採用內建 `image_gen`，未使用 CLI/API fallback。參照使用者提供的三張貓咪照片與已核可的溫暖繪本釣魚示意稿；沒有複製照片中的其他物品或文字。原始貓咪照片未加入 repository。

## 最終素材

- `approved-concept.png`：核可的角色與 Mac 視窗方向。
- `approved-fish.png`：核可的五種幻想魚造型，保留五個既有 species ID。
- `../Sources/CatPond/Resources/fish-atlas.png`：五魚繪本圖集。使用內建 imagegen 產生，沒有用程式改寫圖片；程式在顯示時依來源座標切換魚種，搭配 multiply 合成，使白底融入水色與紙色。此素材並非具有 alpha 的透明 PNG。
- `../Sources/CatPond/Resources/pond.png`：含貓咪的 4:3 場景。魚竿、魚線、浮標、水波以程式繪製。
- `../Sources/CatPond/Resources/pond-blink.png`：闭眼關鍵影格，執行時只用柔邊遮罩顯示眼睛區域，避免整個背景切換。

透明角色素材兩次生成均未提供真正 alpha，因此未採用；改用完整場景配合局部動畫遮罩。沒有把棋盤格當成透明圖放進產品。

新增收竿關鍵姿勢、核可分鏡與完整生成提示見 [reel-animation.md](reel-animation.md)。魚出水時以柔邊紙色光暈墊在繪本魚下，避免 multiply 合成讓魚身在深色樹影前過暗。

## pond.png 最終提示

> Create finished game scene by compositing the illustrated cat from reference 2 naturally onto the wooden dock of the environment in reference 1. Preserve landscape 4:3 aspect and scene composition from reference 1, camera and colors unchanged. Remove checkerboard entirely by painting the actual environment behind the cat. Cat sitting on dock at x=26%, feet y=78%; cat approximately 49% of image height, extending from y=29% to y=78%, both front paws held together at roughly x=34%, y=58%, facing right and looking attentively toward water. Keep exact cat markings and identity, gold-green eyes, plump gray striped body, cream face and chest, white muzzle, thick tail. Do not add a fishing rod, fishing line or bobber because these will be separately animated in code. No extra characters. The calm pond at x=68%, y=72% remains clear for the animated float. Original warm storybook gouache and pencil, harmonize lighting, anchor paws and tail on dock with soft contact shadow. Output only full-bleed environment with the cat, no text, no borders, no UI, no frame, no checkerboard. Production quality actual game background.

## pond-blink.png 最終提示

> Precise animation keyframe edit of the attached game scene. Change ONLY the cat's two EYES to gently CLOSED eyes, a natural relaxed blink, with curved dark eyelid lines and matching surrounding fur. Everything else must remain identical: preserve canvas dimensions, exact cat head position, facial markings, nose, muzzle, ears, paws, body, tail, dock, water, all foliage, lighting, brush texture and framing. Do not change the cat pose, facial proportions or expression except closing the eyes. No text, no added props, no rod. This image will be layered over the original at the eyes only for a blink animation, so eye-region alignment is essential. Output full scene same framing as reference.

## fish-atlas.png 最終提示

> Use case: game sprite atlas, production illustration. Transform the approved fish design reference into ONE clean TEXT-FREE SPRITE ATLAS. Preserve all FIVE fish designs, colors, details, silhouettes and hand-painted watercolor/gouache storybook charm from the reference. Layout is STRICTLY an evenly divided 3-COLUMN by 2-ROW grid on a 3:2 landscape canvas. Every cell is exactly square, invisible grid, no separators. Pure uniform WHITE #FFFFFF background, absolutely no paper texture or scenery outside fish. Each complete fish is entirely contained in its own cell with at least 10% WHITE padding to all four cell edges, centered, all facing RIGHT. Fish1 top-left: plump round peach-pink smiling fish with closed joyful crescent eyes, small rounded tail, cream belly and blush. Fish2 top-middle: graceful gold-orange goldfish with large scalloped fan tail and flowing dorsal fin. Fish3 top-right: slender mint-sage fish with pointed leafy fins and forked leaf tail. Fish4 BOTTOM-LEFT: chunky dark dusty-blue blueberry fish with high rounded dorsal fin and cream freckles. Fish5 BOTTOM-MIDDLE: elongated ethereal lavender-silver moon fish with long flowing crescent fins and small crescent flank marking. BOTTOM-RIGHT cell is EMPTY PURE WHITE. Important change from reference: the bottom two fish must occupy FIRST and SECOND cells, not centered across the row. NO TEXT, NO CAPTIONS, NO TITLE, NO SHADOWS OUTSIDE THE FISH, NO checkerboard, NO mockup, NO extra fish. Fine fins preserved; watercolor texture exists only inside each fish. Exact cell alignment and white padding are crucial for using the atlas in a real animated game. All 5 designs remain distinctly recognizable and highly polished.
