# 成大校園 3D 模擬器

網頁版的成大校園 3D 模擬器，範圍包括臺南車站和光復、成功、力行三個校區。可以自由探索、找 NPC 對話，也能搜尋建築並導航。

**線上試玩：https://yoyohuang1012.github.io/ncku-campus-3d/** ・ 規格書與開發歷程：[SPEC.md](SPEC.md)

![新臺南車站 2 號出口與迎新學長對話](screenshots/02_NPC對話.png)

目前進度：建築位置與輪廓來自 OpenStreetMap，外觀依成大素材網（material.ncku.edu.tw）的官方照片與 Google 街景逐棟調整。光復、成功、力行三個校區的建築、圍牆、行道樹、路燈座椅、雕塑，以及勝利路天橋、大學路牌坊、光復大門、成功湖都已做好，等最後一起校對。

## 執行

```bash
npm install
```

```bash
npm run dev
```

開啟 http://localhost:5173 。手機和電腦在同一個 Wi-Fi 下時，可以用終端機顯示的 Network 網址在手機上開啟。

操作：WASD／方向鍵移動、Shift 跑步、滑鼠拖曳轉視角、滾輪縮放、E 對話、M 地圖、點建築看資訊。手機版用左下角搖桿移動，在右半邊拖曳轉視角。

### 發布到 GitHub Pages

```bash
npm run build:pages
```

會把 CSS 與 JavaScript 全部內嵌成單一 `docs/index.html`，地圖資料複製到 `docs/data/`。GitHub Pages 設定為從 `main` 分支的 `/docs` 資料夾發布。

## 修改內容（不用改程式）

所有內容都在 `public/data/`：

| 檔案 | 內容 |
|---|---|
| `config/world.json` | 地圖範圍、玩家起點、校區定義、鐵路開關、預設樓層數 |
| `config/game.json` | 走路速度、攝影機、畫質、時鐘模式、小地圖大小；`ground.drawRoads`、`drawAreas`、`drawWater` 決定航照上要不要再畫馬路與標線、操場球場草地、水面 |
| `config/style.json` | 地面、樹（顏色與大小）、圍牆、路線等顏色；`theme` 是全域色調（彩度、亮度倍率，套在所有資料顏色上），`groundGrade` 調航照地面，`lighting` 是天空與光線，`water` 是水面、池岸與跨水小橋的顏色，`barrierThickness` 是各種圍牆的厚度（府城城垣很厚），`markings` 是道路標線（雙黃線、白色虛線、路緣線、斑馬線） |
| `config/building-styles.json` | 建築外觀風格：牆面材質、牆色、窗型、屋頂形式（平頂／四坡／弧形） |
| `overrides/buildings.json` | 手動修正建築：名稱、別名、樓層、外觀風格、入口、教室清單（`_ref` 記錄外觀依據） |
| `npcs/npcs.json` | NPC 名單與排程（哪天、幾點、在哪裡、講哪段對話） |
| `dialogues/dialogues.json` | 對話樹與選項動作 |
| `i18n/zh-TW.json` | 所有介面與對話文字（之後加英文就新增 `en.json`） |
| `overrides/streetscape.json` | 沿校區邊界自動產生的圍牆（出入口自動斷開，`wall.kind` 選材質、`wall.openings` 補 OSM 沒畫的開口）與內外兩排行道樹；`furniture` 自動擺外圍路燈、校內步道燈、座椅與垃圾桶；`canopy` 依航照綠色比例在校區內補樹；`avenues` 沿指定道路種一整排樹（雲平大道的椰子樹）；`alignProps` 讓候車亭、站牌自動面向車道 |
| `overrides/props.json` | 雕塑的個別造型（依名稱或位置對到 OSM 設施）與新增設施（牌坊、校門警衛亭、旗海）；造型種類見 `src/world/props.ts`，顏色在 `config/style.json` 的 `props` |
| `overrides/landmarks.json` | OSM 沒有的地標結構：跨路的鋼桁架天橋（`skybridges`）、走得下去的下沉廣場（`sunkenPlazas`，長方形坑＋階梯＋B1 入口門；`screens` 放螢幕或整面飾板，飾板可設 `seams` 分格與 `discs` 圓形裝飾，`offset` 控制前後層）、大頂棚（`canopies`）、走得上去的棧橋（`walkways`，可加鋼門架）、出入口站體／石牆／指示柱（`pavilions`，可在牆上寫字）。下沉廣場的坑底高度是負的，設施要放在坑底時在 `overrides/props.json` 的 `add` 寫 `y`；頂棚柱子落在坑裡或站體量體裡會自動省略。水池和池上小橋不用寫，直接用 OSM 的水域和 bridge 步道 |
| `overrides/extra-buildings.json` | OSM 缺漏、從航照描出來的建築（塔樓、街屋排） |
| `ortho/` | 國土測繪中心正射航照圖磚（地面貼圖與小地圖） |
| `world/generated.json`、`world/nav.json` | 由 OSM 自動產生，**不要手改** |

## 校對建築外觀

在網址加參數可以固定時間、讓攝影機繞著單棟建築：

```
http://localhost:5173/?time=10:30&inspect=osm-w252925613
```

也可以在瀏覽器主控台呼叫 `game.inspect('建築id', 方位角, 俯角, 距離倍率)`（方位角 0 = 從北邊看、90 = 從東邊看）。

要針對某一面牆或掛附加量體時，先查邊的編號：

```bash
node tools/buildings/edges.mjs osm-w252925613
```

## 更新地圖資料

```bash
npm run osm:fetch
```

```bash
npm run osm:build
```

第一個指令從 OpenStreetMap 重新下載資料，第二個指令重新產生 `world/` 底下的檔案（會一併套用 `extra-buildings.json`）。OSM 的古城牆（`historic=citywalls`）會變成 `city_wall` 圍牆，有候車亭的公車站（`shelter=yes`）會變成 `bus_shelter`。

重新下載航照（zoom 18 給手機和小地圖用，19 給電腦地面用）：

```bash
node tools/ortho/fetch-ortho.mjs 18 19
```

## 程式結構

```
src/
  core/    資料載入、型別、語言、時鐘、輸入
  world/   3D 場景組裝、幾何產生、碰撞
  player/  玩家、人物造型與動作、第三人稱攝影機
  npc/     NPC 排程與互動
  nav/     步行路網、A* 路線、地上箭頭
  ui/      狀態列、小地圖、搜尋、標籤、對話框、建築資訊
tools/osm/ OSM 下載與轉換腳本
tools/buildings/ 建築校對工具（列出輪廓的邊）
```

地圖資料 © OpenStreetMap 貢獻者，以 ODbL 授權。航照圖資來源：內政部國土測繪中心。
