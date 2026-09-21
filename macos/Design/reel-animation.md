# 收竿動畫美術

使用內建 imagegen；未使用 CLI/API fallback。使用者已核可四格分鏡 `approved-reel-storyboard.png`。

## 素材與合成

- `../Sources/CatPond/Resources/pond-pull.png`：後仰拉竿。
- `../Sources/CatPond/Resources/pond-lift.png`：抬手帶魚出水。
- `../Sources/CatPond/Resources/pond-happy.png`：開心伸掌接魚。

三張圖是與原池塘對位的完整 RGB 畫作，不是假稱透明的角色圖。App 只在貓咪周圍使用柔邊局部遮罩，短暫交融姿勢；湖面與遠景維持原背景。這是關鍵姿勢動畫，不是完整骨架動畫。前掌另外遮在握柄前，魚竿、魚線、浮標、水花與實際抽到的魚皆為獨立圖層。

四段時間為 0–0.4 秒上鉤、0.4–1.0 秒拉竿、1.0–1.8 秒出水、1.8–2.4 秒收穫。魚竿使用漸細竹木竿身、節環、明暗線、纏線握柄與尾帽；受力時彎曲，出水時衰減回彈。

## 最終生成提示

### 拉竿

Precise animation keyframe edit of reference 1, the existing game scene. Reference 2 is approved movement storyboard, use ONLY its top-right cat pulling pose as action guidance, NOT its layout or framing. Output ONE full-bleed 4:3 scene, exact same framing and camera as reference1. Edit ONLY the cat: while keeping both hind feet planted at their exact original coordinates (cat feet around x30%, y66%), lean its torso BACK toward left about 12 degrees, raise both forepaws together from original chest level to about x32%,y47%, as if firmly pulling an invisible fishing rod diagonally toward upper-right. Slightly concentrated face, eyes look upper-right, ears alert. Same gray/cream tabby identity, round golden eyes, plush chunky body, striped tail resting in same location. Keep head approximately original size and within same area. Preserve EVERY environment detail, tree, dock, sky, water, cottage, lighting, color, brushstroke style, at the exact original coordinates. No crop, no zoom. No rod, no line, no fish, no splash, no extra objects, no text: those are animated separately in code. This is a registered animation pose, not a new illustration. Warm storybook gouache. Preserve cat's full silhouette and all existing background pixels as closely as possible.

### 抬手

Precise registered animation keyframe edit of reference 1. Reference2 shows preceding pulling pose, reference3 is approved storyboard. Output ONE full bleed 4:3 game scene, identical camera/composition/background as reference1. Change ONLY cat pose into LIFTING THE CATCH: hind paws stay EXACTLY anchored in original positions x29%-35%,y66%, fluffy tail stays left on dock. Torso upright slightly stretched, head tipped UP watching upper right, mouth gently excited, golden-green eyes open. Both front paws raised together to around x33%,y40%, gripping an INVISIBLE fishing pole whose direction will be up-right. Same cat identity, dimensions, striped gray fur, cream muzzle/chest, plump proportions. Keep head size same, top of ears no higher than y23%. Keep ALL dock, lake, trees, sky, waterlilies, cottage, textures, lighting exactly registered to reference1, don't repaint them unnecessarily. NO fishing rod, NO line, NO fish, NO splash, no accessories, no text, no panels, no border: these objects are added separately in animation code. Original warm painterly gouache detail and colors. This is the third key pose of a production animation; alignment essential.

### 收穫

Precise registered animation keyframe edit of reference1 existing cat pond game scene. Reference2 is approved storyboard: use bottom-right happy catching expression and reaching paw as pose guidance only. Output ONE full-bleed 4:3 image exact same framing as reference1. Change ONLY cat: seated upright, SAME hind paws and fluffy tail in original positions, face happily smiling with gently closed crescent eyes, no teeth, soft joyful face. One front paw remains at original chest location around x32%,y51% ready to grip an invisible nearly upright rod. Other front paw extends toward RIGHT and slightly UP to x40%,y44%, reaching to greet a fish that will be separately animated. Cat head stays in original location, same size and identity, plush gray tabby with warm cream patches, pink nose, cream chin and chest. Anatomically two forepaws, two hind paws, one tail. Preserve exact original dock, water, vegetation, cottage, sky, sunlight, original detailed gouache texture, all in exact same coordinates. NO fish, NO fishing rod, NO line, NO sparkles, NO text, NO UI, NO borders. No zoom, no background repainting, no scene rearrangement. Need aligned game animation pose, not new scene.
