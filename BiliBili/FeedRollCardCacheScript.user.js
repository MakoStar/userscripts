// ==UserScript==
// @name         [Bili]FeedRollCardCacheScript
// @namespace    http://tampermonkey.net/
// @author       MakoStar
// @version      2.0.1
// @match        *://www.bilibili.com
// @match        *://www.bilibili.com/?*
// @match        *://www.bilibili.com/*
// @description  一个用于缓存换一换按钮随机出现的视频卡片信息的脚本 (使用 IndexedDB 缓存)
// @icon         https://www.google.com/s2/favicons?sz=64&domain=www.bilibili.com
// @run-at       document-start
// @grant        none
// @noframes
// ==/UserScript==

(function () {
    'use strict';

    // 仅迁移旧数据时使用，迁移完会被 removeItem
    const LOCALSTORAGE_KEY = "FRCCS_CACHE";
    const ROLL_CARD_MAX_CACHE_COUNT = 50;

    const IS_SAVE_AD_CACHE = true;
    // true 时按 ROLL_CARD_MAX_CACHE_COUNT 滚动淘汰最旧批
    const IS_ENABLE_CACHE_LIMIT = false;

    const DB_NAME = "FRCCS_DB";
    const STORE = "batches";
    const DB_VER = 1;

    const FEED_ROLL_BTN_SELECTOR = ".feed-roll-btn";
    const ROLL_BTN_SELECTOR = ".feed-roll-btn>.roll-btn";
    const SHADOW_ROOT_ID = "rb-snapshot-host";
    const ROLL_BACK_BTN_TEXT = "查看";
    const ALL = "__all__";

    const FEED_CARD_SELECTOR = ".feed-card";
    const REMOVE_AD_SLOT_CLASS = "remove-ad-slot";
    const FEED_CARD_SUBNODE_SELECTORS = [
        ".bili-video-card__info--tit",
        ".bili-video-card__image--link",
        ".bili-video-card__cover>img",
        ".bili-video-card__info--author",
        ".bili-video-card__stats--text"
    ];

    const INJECT_CSS = `
        .recommended-swipe,
        .floor-single-card,
        .bili-feed-card,
        .bili-video-card,
        .palette-button-wrap
        {
            display: none !important;
        }

        div.feed-card,
        div.feed-card>.bili-feed-card,
        div.feed-card>.bili-feed-card>.bili-video-card {
            display: block !important;
        }

        div.feed-card.remove-ad-slot {
            position: relative;
        }

        .feed-card.remove-ad-slot::before {
            content: "";
            position: absolute;
            top: 0;
            left: 0;
            display: flex;
            width: 100%;
            height: 100%;
            border-radius: 6px;
            background: rgb(0 0 0 / 82%);
            z-index: 99;
        }

        .recommended-container_floor-aside .container>*:nth-of-type(n + 8),
        .recommended-container_floor-aside .container.is-version8>*:nth-of-type(n + 13)
        {
            margin-top: 0 !important;
        }
    `;

    const SHADOW_DOM_CSS = `
        :host{all:initial}
        *{box-sizing:border-box;margin:0;padding:0}
        .rb-btn{position:fixed;right:22px;bottom:90px;z-index:10;display:flex;align-items:center;gap:8px;background:#fb7299;color:#fff;border:none;cursor:pointer;font:700 13px/1 "Noto Sans SC",system-ui,sans-serif;padding:11px 18px;border-radius:10px;box-shadow:0 4px 20px rgba(251,114,153,.45);transition:transform .2s,box-shadow .2s;user-select:none}
        .rb-btn:hover{transform:translateY(-2px) scale(1.04);box-shadow:0 8px 28px rgba(251,114,153,.55)}
        .rb-btn:active{transform:scale(.96)}
        .rb-btn svg{width:16px;height:16px;fill:currentColor}
        .rb-btn .rb-badge{font:600 10px/1 monospace;background:rgba(255,255,255,.25);padding:3px 6px;border-radius:4px}
        .rb-overlay{position:fixed;inset:0;z-index:20;background:rgba(8,12,22,.68);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);opacity:0;pointer-events:none;transition:opacity .35s ease}
        .rb-overlay.show{opacity:1;pointer-events:auto}
        .rb-panel{position:fixed;top:0;right:0;bottom:0;z-index:30;width:min(980px,96vw);display:flex;flex-direction:column;background:#141d2e;border-left:1px solid #25334d;box-shadow:-30px 0 80px rgba(0,0,0,.55);transform:translateX(105%);transition:transform .45s cubic-bezier(.22,1,.36,1);font-family:"Noto Sans SC",system-ui,-apple-system,sans-serif;color:#e9eff8}
        .rb-panel.open{transform:translateX(0)}
        .rb-head{position:relative;display:flex;padding:20px 22px 16px;border-bottom:1px solid #25334d;align-items:flex-start;justify-content:space-between;gap:14px;flex:none}
        .rb-head::before{content:"";position:absolute;left:0;top:0;right:0;height:2px;background:linear-gradient(90deg,#fb7299,#b48ef0 45%,#3fd0e0);opacity:.9}
        .rb-head-kicker{font:600 10px/1 monospace;color:#3fd0e0;letter-spacing:.28em;margin-bottom:8px}
        .rb-head h2{font:900 20px/1.35 "Noto Sans SC",sans-serif}
        .rb-head-meta{margin-top:6px;font:500 11px/1.5 monospace;color:#8ea2c0}
        .rb-head_buttons{display:flex;height:100%;flex-direction: row;align-items: center;gap: 8px;}
        .rb-clean{flex: none;width: 36px;height: 36px;border-radius: 8px; border: 1px solid #25334d;background: #1a2537;color: #8ea2c0;font-size: 15px;cursor: pointer;transition: .25s;display: grid;place-items: center;transition: transform .25s, border-color .25s, color .25s, background .25s;}
        .rb-clean > span {display: inline-block;transition: transform .25s;}
        .rb-close{flex:none;width:36px;height:36px;border-radius:8px;border:1px solid #25334d;background:#1a2537;color:#8ea2c0;font-size:15px;cursor:pointer;transition:.25s;display:grid;place-items:center;transition: transform .25s, border-color .25s, color .25s, background .25s;}
        .rb-close:hover,.rb-clean:hover{border-color:#fb7299;color:#fb7299;}
        .rb-clean:hover > span{transform: rotate(-20deg) translateY(1px);}
        .rb-close:hover{transform:rotate(90deg)}
        .rb-layout{flex:1;display:flex;min-height:0}
        .rb-side{flex:0 0 252px;display:flex;flex-direction:column;min-height:0;background:#101826;border-right:1px solid #25334d}
        .rb-side-head{display:flex;align-items:center;gap:8px;flex:none;padding:14px 16px;border-bottom:1px solid #1d2940;font:600 10px/1 monospace;color:#6b7fa0;letter-spacing:.2em}
        .live-dot{width:6px;height:6px;border-radius:50%;background:#8be28b;box-shadow:0 0 0 0 rgba(139,226,139,.6);animation:rbPulse 1.8s ease-out infinite}
        @keyframes rbPulse{0%{box-shadow:0 0 0 0 rgba(139,226,139,.5)}
        70%{box-shadow:0 0 0 7px rgba(139,226,139,0)}
        100%{box-shadow:0 0 0 0 rgba(139,226,139,0)}
        }.rb-side-n{margin-left:auto;background:rgba(251,114,153,.16);color:#fb7299;font:700 10px/1 monospace;padding:3px 7px;border-radius:5px}
        .rb-keylist{flex:1;overflow-y:auto;overscroll-behavior:contain;padding:8px 0;scrollbar-width:thin;scrollbar-color:#26344e transparent}
        .rb-keylist::-webkit-scrollbar{width:7px}
        .rb-keylist::-webkit-scrollbar-thumb{background:#26344e;border-radius:7px}
        .rb-key{display:grid;grid-template-columns:26px 1fr;gap:3px 10px;align-items:start;padding:11px 14px 11px 12px;cursor:pointer;position:relative;border-left:3px solid transparent;transition:background .2s,border-color .2s}
        .rb-key+.rb-key{border-top:1px solid rgba(255,255,255,.03)}
        .rb-key-idx{grid-row:1/4;align-self:center;font:600 11px/1 monospace;color:#3a4a66;transition:color .2s}
        .rb-key-id{font:600 12px/1.3 monospace;color:#9fb2cf;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;transition:color .2s}
        .rb-key-prev{font:400 11px/1.4 "Noto Sans SC",sans-serif;color:#5d7090;display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical;overflow:hidden}
        .rb-key-stats{grid-column:2;display:flex;gap:11px;margin-top:5px;font:600 9.5px/1 monospace}
        .st-v{color:#3fd0e0}
        .st-a{color:#ffb454}
        .st-v.dim,.st-a.dim{color:#33425e}
        .rb-key:hover{background:rgba(255,255,255,.035)}
        .rb-key:hover .rb-key-id{color:#cdd9ec}
        .rb-key.active{background:rgba(251,114,153,.1);border-left-color:#fb7299}
        .rb-key.active .rb-key-idx{color:#fb7299}
        .rb-key.active .rb-key-id{color:#fff}
        .rb-key.all .rb-key-id{letter-spacing:.02em}
        .rb-main{flex:1;display:flex;flex-direction:column;min-width:0;min-height:0}
        .rb-toolbar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:13px 22px;border-bottom:1px solid #25334d;flex:none}
        .rb-tabs{display:flex;gap:7px}
        .rb-tab{background:none;border:1px solid #25334d;color:#8ea2c0;font:500 12.5px/1 "Noto Sans SC",sans-serif;padding:7px 13px;border-radius:999px;cursor:pointer;transition:.2s}
        .rb-tab span{font:600 10px/1 monospace;opacity:.65;margin-left:3px}
        .rb-tab:hover{border-color:#33456a;color:#e9eff8}
        .rb-tab.active{background:#fb7299;border-color:#fb7299;color:#fff;font-weight:700}
        .rb-search{flex:1;min-width:130px;background:#1a2537;border:1px solid #25334d;color:#e9eff8;font:500 12.5px/1 monospace;padding:9px 13px;border-radius:8px;outline:none;transition:border-color .2s}
        .rb-search:focus{border-color:#3fd0e0}
        .rb-search::placeholder{color:#556a8a}
        .rb-scroll{flex:1;overflow-y:auto;overscroll-behavior:contain;min-height:0;scrollbar-width:thin;scrollbar-color:#33456a transparent}
        .rb-scroll::-webkit-scrollbar{width:8px}
        .rb-scroll::-webkit-scrollbar-thumb{background:#33456a;border-radius:8px;border:2px solid #141d2e}
        .rb-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(196px,1fr));gap:15px;padding:18px 22px 26px}
        .rb-card{background:#1a2537;border:1px solid #25334d;border-radius:10px;overflow:hidden;display:flex;flex-direction:column;animation:rbIn .45s cubic-bezier(.22,1,.36,1) both;animation-delay:var(--d);transition:transform .22s,border-color .22s,box-shadow .22s}
        .rb-card:hover{transform:translateY(-4px);border-color:#fb7299;box-shadow:0 12px 30px rgba(0,0,0,.4)}
        .rb-card.hide{display:none}
        .rb-card.is-ad{border-color:rgba(255,180,84,.3)}
        .rb-card.is-ad:hover{border-color:#ffb454}
        @keyframes rbIn{from{opacity:0;transform:translateY(18px) scale(.97)}
        to{opacity:1;transform:none}
        }.rb-cover{position:relative;aspect-ratio:16/9;display:block;overflow:hidden;background:#0a101c}
        .rb-cover img{width:100%;height:100%;object-fit:cover;display:block;transition:transform .5s cubic-bezier(.22,1,.36,1)}
        .rb-card:hover .rb-cover img{transform:scale(1.06)}
        .rb-play{position:absolute;left:50%;top:50%;width:40px;height:40px;margin:-20px 0 0 -20px;border-radius:50%;background:rgba(251,114,153,.9);color:#fff;display:grid;place-items:center;font-size:13px;padding-left:2px;opacity:0;transform:scale(.5);transition:.25s cubic-bezier(.34,1.56,.64,1);pointer-events:none}
        .rb-card:hover .rb-play{opacity:1;transform:scale(1)}
        .rb-badge-tag{position:absolute;left:7px;top:7px;font:600 9.5px/1 monospace;padding:4px 6px;border-radius:4px;letter-spacing:.03em}
        .rb-badge-bv{background:rgba(10,16,28,.85);color:#3fd0e0}
        .rb-badge-ad{background:#ffb454;color:#241505}
        .rb-src-tag{position:absolute;right:7px;bottom:7px;font:600 9px/1 monospace;color:#c9aef5;background:rgba(10,16,28,.82);padding:4px 6px;border-radius:4px;letter-spacing:.02em;max-width:62%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .rb-body{flex:1;display:flex;flex-direction:column;gap:9px;padding:11px 12px 12px}
        .rb-title{font-size:13px;line-height:1.55;font-weight:700;display:-webkit-box;-webkit-line-clamp:2;line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
        .rb-title a{color:#e9eff8;text-decoration:none;transition:color .2s}
        .rb-title a:hover{color:#fb7299}
        .rb-meta{display:flex;align-items:center;justify-content:space-between;gap:7px;margin-top:auto}
        .rb-author{display:inline-flex;align-items:center;gap:6px;min-width:0;font-size:11.5px;color:#8ea2c0;text-decoration:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;transition:color .2s}
        .rb-author:hover{color:#3fd0e0}
        .rb-avatar{flex:none;width:19px;height:19px;border-radius:5px;display:grid;place-items:center;font:700 10px/1 sans-serif;color:#0c1322}
        .rb-copy{flex:none;background:none;border:1px solid #25334d;color:#8ea2c0;font:600 10px/1 monospace;padding:4px 7px;border-radius:5px;cursor:pointer;transition:.2s}
        .rb-copy:hover{border-color:#3fd0e0;color:#3fd0e0}
        .rb-interest{font:600 10.5px/1 monospace;color:#ffb454}
        .rb-promo{font:600 9.5px/1 monospace;color:#8ea2c0;border:1px solid #25334d;padding:3px 6px;border-radius:4px}
        .rb-foot{display:flex;justify-content:space-between;gap:10px;padding:12px 22px;border-top:1px solid #25334d;font:500 10px/1 monospace;color:#556a8a;letter-spacing:.06em;flex:none}
        .rb-empty{grid-column:1/-1;text-align:center;padding:60px 20px;color:#556a8a;font-size:14px;line-height:2}
        .rb-empty code{display:inline-block;margin-top:8px;background:#1a2537;border:1px solid #25334d;border-radius:6px;padding:6px 14px;font:500 12px/1.6 monospace;color:#3fd0e0;word-break:break-all}
        .rb-no-match{display:none;text-align:center;padding:54px 20px;color:#556a8a;font-size:13px}
        .rb-no-match.show{display:block}
        .rb-toast{position:fixed;left:50%;bottom:56px;z-index:40;transform:translate(-50%,14px);background:#3fd0e0;color:#06222a;font:700 12.5px/1 "Noto Sans SC",sans-serif;padding:10px 20px;border-radius:8px;box-shadow:0 8px 26px rgba(0,0,0,.4);opacity:0;pointer-events:none;transition:.3s}
        .rb-toast.show{opacity:1;transform:translate(-50%,0)}
        @media (max-width:820px){.rb-panel{width:100vw}
        .rb-layout{flex-direction:column}
        .rb-side{flex:none;max-height:120px;border-right:none;border-bottom:1px solid #25334d}
        .rb-side-head{padding:10px 14px}
        .rb-keylist{display:flex;flex-direction:row;gap:8px;overflow-x:auto;overflow-y:hidden;padding:10px 12px}
        .rb-key{display:flex;flex-direction:row;align-items:center;gap:9px;flex:0 0 auto;border-left:none;border-top:none !important;background:#1a2537;border-radius:9px;padding:9px 13px;border-bottom:2px solid transparent}
        .rb-key+.rb-key{border-top:none}
        .rb-key-idx{grid-row:auto}
        .rb-key-prev{display:none}
        .rb-key-stats{margin:0}
        .rb-key.active{border-left-color:transparent;border-bottom-color:#fb7299;background:rgba(251,114,153,.12)}
        }
    `;

    const LOG_CSS = [
        "padding: 3px 6px; border-radius: 3px; color: #fff; background: #0087BD; font-weight: bold;",
        "",
        "padding: 3px 6px; border-radius: 0 3px 3px 0; color: #757A81; background: #FFF; font-weight: bold;"
    ];


    const https = u => (u && u.startsWith("//")) ? "https:" + u : (u || "#");
    const AVATAR_BG = ["#fb7299", "#3fd0e0", "#ffb454", "#8be28b", "#b48ef0"];
    const fmtDate = n => `${String(n).slice(0, 4)}-${String(n).slice(4, 6)}-${String(n).slice(6, 8)}`;
    const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));


    const logger = (msg, params = [], lv = "log", logCss = LOG_CSS) => {
        console[lv](`%c FRCCS %c ${msg}`, logCss[0], logCss[1], ...params);
    };


    const findRollButton = (btnSelector, callback, time = 500, maxCount = 10) => {
        logger("开始查找 roll-btn 按钮")
        let count = 0;
        const savedEvent = {};
        let timer = setInterval(() => {
            count += 1;
            const rollButton = document.querySelector(btnSelector);
            if (rollButton) {
                logger("找到 roll-btn 按钮")
                clearInterval(timer);
                callback(true, savedEvent);
            }
            if (count === maxCount) {
                clearInterval(timer);
                count = null;
                timer = null;
                logger("达到查找次数上限 未找到 roll-btn 按钮")
                callback(false, savedEvent);
            }
        }, time);
    };


    const injectStyle = () => {
        const s = document.createElement('style');
        s.type = 'text/css';
        s.innerHTML = INJECT_CSS;
        document.head.appendChild(s);
        logger("注入自定义排版样式", [s]);
    };


    const getDateFormatNumber = () => {
        const now = new Date();
        const Y = now.getFullYear();
        const M = String(now.getMonth() + 1).padStart(2, "0");
        const D = String(now.getDate()).padStart(2, "0");
        return Number(`${Y}${M}${D}`);
    };


    const convertDateByTimestamp = (timestamp) => {
        const date = new Date(timestamp);
        const [Y, M, D, h, m, s] = [
            date.getFullYear(),
            date.getMonth() + 1,
            date.getDate(),
            date.getHours(),
            date.getMinutes(),
            date.getSeconds()
        ].map((n, i) => i === 0 ? n : String(n).padStart(2, "0"));
        const ms = String(date.getMilliseconds()).padStart(3, "0");
        return `${Y}-${M}-${D} ${h}:${m}:${s}.${ms}`;
    };


    const encodeTimeKey = (str) => {
        return parseInt(str.replace(/[-:. ]/g, ''), 10).toString(36);
    };


    const decodeTimeKey = (key) => {
        const s = String(parseInt(key, 36)).padStart(14, '0');
        const date = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
        const time = `${s.slice(8, 10)}:${s.slice(10, 12)}:${s.slice(12, 14)}`;
        return `${date} ${time}`;
    };


    const reqP = (req) => new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });


    const txComplete = (tx) => new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error || new Error("transaction aborted"));
        tx.onerror = () => reject(tx.error);
    });


    const openDB = () => new Promise((resolve, reject) => {
        const openReq = indexedDB.open(DB_NAME, DB_VER);
        openReq.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE)) {
                const store = db.createObjectStore(STORE, { keyPath: "timeKey" });
                store.createIndex("byTs", "ts", { unique: false });
            }
        };
        openReq.onsuccess = () => resolve(openReq.result);
        openReq.onerror = () => reject(openReq.error);
        openReq.onblocked = () => reject(new Error("[FRCCS]: DB blocked,请关闭其它标签页后重试"));
    });


    const walkCursor = (source, range, dir, onCursor) => new Promise((resolve, reject) => {
        const req = source.openCursor(range ?? null, dir ?? "next");
        req.onsuccess = (e) => {
            const cursor = e.target.result;
            if (!cursor) return resolve();
            const ret = onCursor(cursor);
            if (ret === false) return resolve();
            Promise.resolve(ret).then(() => cursor.continue());
        };
        req.onerror = () => reject(req.error);
    });


    const putOneBatch = async (timeKey, videos, ads, ts = Date.now()) => {
        const db = await openDB();
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put({ timeKey, videos, ads, ts });
        await txComplete(tx);
        db.close();
    };


    const loadSnapshotFromIDB = async () => {
        const db = await openDB();
        const idx = db.transaction(STORE, "readonly").objectStore(STORE).index("byTs");
        const data = {}, ad = {}, keys = [];
        await walkCursor(idx, null, "prev", (c) => {
            const { timeKey, videos, ads } = c.value;
            keys.push(timeKey);
            data[timeKey] = videos || [];
            ad[timeKey] = ads || [];
        });
        db.close();
        return { snap: { data, ad, time: getDateFormatNumber() }, keys };
    };


    const evictOldest = async (maxCount) => {
        const db = await openDB();
        const tx = db.transaction(STORE, "readwrite");
        const store = tx.objectStore(STORE);
        const total = await reqP(store.count());
        let toDelete = Math.max(0, total - maxCount);
        if (toDelete > 0) {
            await walkCursor(store.index("byTs"), null, "next", (c) => {
                if (toDelete <= 0) return false;
                c.delete();
                toDelete--;
            });
        }
        await txComplete(tx);
        db.close();
    };


    const clearAllBatches = async () => {
        const db = await openDB();
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).clear();
        await txComplete(tx);
        db.close();
    };


    const countBatches = async () => {
        const db = await openDB();
        const n = await reqP(db.transaction(STORE, "readonly").objectStore(STORE).count());
        db.close();
        return n;
    };


    const tsFromTimeKey = (k) => {
        const t = new Date(decodeTimeKey(k)).getTime();
        return Number.isFinite(t) ? t : 0;
    };


    const migrateFromLocalStorage = async () => {
        let raw;
        try { raw = localStorage.getItem(LOCALSTORAGE_KEY); } catch (e) { return; }
        if (!raw) return;

        let old;
        try { old = JSON.parse(raw); } catch (e) { localStorage.removeItem(LOCALSTORAGE_KEY); return; }

        const dataMap = old?.data || {}, adMap = old?.ad || {};
        const allKeys = [...new Set([...Object.keys(dataMap), ...Object.keys(adMap)])];
        if (!allKeys.length) { localStorage.removeItem(LOCALSTORAGE_KEY); return; }

        let existing = 0;
        try { existing = await countBatches(); } catch (e) {
            /* 读不出就当 0，下面 put 事务失败会回滚 */
        }
        if (existing > 0) {
            localStorage.removeItem(LOCALSTORAGE_KEY);
            return;
        }

        try {
            const db = await openDB();
            const tx = db.transaction(STORE, "readwrite");
            const store = tx.objectStore(STORE);
            for (const k of allKeys) {
                store.put({ timeKey: k, videos: dataMap[k] || [], ads: adMap[k] || [], ts: tsFromTimeKey(k) });
            }
            await txComplete(tx);
            db.close();
            localStorage.removeItem(LOCALSTORAGE_KEY);
            logger("已从 localStorage 迁移批次到 IndexedDB", [allKeys.length]);
        } catch (e) {
            logger("localStorage → IndexedDB 迁移失败(不影响新数据写入)", [e?.name, e?.message], "warn");
        }
    };

    // 启动时确保 DB 就绪（建表 + 迁移）
    const ensureReady = async () => { await migrateFromLocalStorage(); };


    const processAd = (ele, adCard, dataMap, timeKey) => {
        if (!IS_SAVE_AD_CACHE) return;
        const arr = dataMap[timeKey] || [];
        arr.unshift(adCard);
        dataMap[timeKey] = arr;
    };


    const gatherFeedCardInfo = (timeKey, feedCardSelector = FEED_CARD_SELECTOR) => {
        const feedCardData = { [timeKey]: [] };
        const adData = { [timeKey]: [] };

        const feedCardNodes = document.querySelectorAll(feedCardSelector);

        for (const nodeItem of feedCardNodes) {
            const [T, L, I, A, G] = FEED_CARD_SUBNODE_SELECTORS.map(subNodeSelector => {
                return nodeItem.querySelector(subNodeSelector);
            });

            const t = T?.getAttribute("title");
            const a = A?.getAttribute("title");
            const l = L?.getAttribute("href");
            const i = I?.getAttribute("src");
            const s = A?.parentNode?.getAttribute("href");
            const v = l?.replace(/\S+(?=\/)\/([a-zA-Z1-9]+).*([\?]?)/, "$1");

            if (L?.hasAttribute("rel") || G?.textContent == "广告") {
                processAd(nodeItem, { t, a, l, i, s, v }, adData, timeKey);
                continue;
            }

            const arr = feedCardData[timeKey] || [];
            arr.push({ v, t, l, i, a, s });
            feedCardData[timeKey] = arr;

        }

        return [feedCardData, adData];
    };


    const bindClickEvent = (btnSelector, savedEvent = {}) => {
        const rollBtn = document.querySelector(btnSelector);
        if (!rollBtn) return;

        rollBtn.addEventListener("click", async () => {
            const rollCardTimestamp = convertDateByTimestamp(Date.now());
            const timeKey = encodeTimeKey(rollCardTimestamp);

            const [feedCardData, adData] = gatherFeedCardInfo(timeKey);

            try {
                await putOneBatch(timeKey, feedCardData[timeKey] || [], adData[timeKey] || [], Date.now());
                if (IS_ENABLE_CACHE_LIMIT) await evictOldest(ROLL_CARD_MAX_CACHE_COUNT);
                logger("IndexDB 缓存完成", [timeKey, rollCardTimestamp]);
            } catch (e) {
                logger("写入 IndexedDB 失败", [e?.name, e?.message], "error");
            }
        }, true);
    };


    const createShadowDom = (rootId = SHADOW_ROOT_ID) => {
        const root = document.createElement("div");
        root.id = rootId;
        root.style.cssText = `
            all:initial;
            position:fixed;
            z-index:1145141919810;
            top:0;
            left:0;
            width:0;
            height:0;
        `;
        document.documentElement.appendChild(root);
        const shadow = root.attachShadow({ mode: "closed" });

        const style = document.createElement("style");
        style.textContent = SHADOW_DOM_CSS;
        shadow.appendChild(style);
        return shadow;
    };


    const createShadowWrap = () => {
        const wrap = document.createElement("div");
        wrap.innerHTML = `
            <div class="rb-overlay" id="rbOverlay"></div>

            <aside class="rb-panel" id="rbPanel" role="dialog" aria-modal="true">
                <header class="rb-head">
                    <div>
                        <p class="rb-head-kicker">ROLLBACK // CACHE ARCHIVE</p>
                        <h2 id="rbTitle">缓存数据</h2>
                        <p class="rb-head-meta" id="rbMeta"></p>
                    </div>
                    <div class="rb-head_buttons">
                        <button class="rb-clean" id="rbClean" aria-label="清空" title="清空">
                            <span>🗑️</span>
                        </button>
                        <button class="rb-close" id="rbClose" aria-label="关闭" title="关闭">
                            <span>❌</span>
                        </button>
                    </div>
                </header>

                <div class="rb-layout">
                    <nav class="rb-side">
                        <div class="rb-side-head">
                            <span class="live-dot"></span>
                            KEYS
                            <span class="rb-side-n" id="rbSideN">0</span></div>
                        <div class="rb-keylist" id="rbKeylist"></div>
                    </nav>

                    <div class="rb-main">
                        <div class="rb-toolbar">
                            <div class="rb-tabs" id="rbTabs">
                                <button class="rb-tab active" data-f="all">全部 <span>0</span></button>
                                <button class="rb-tab" data-f="video">视频 <span>0</span></button>
                                <button class="rb-tab" data-f="ad">推广 <span>0</span></button>
                            </div>
                            <input class="rb-search" id="rbSearch" type="search" placeholder="搜索标题 / UP主…">
                        </div>
                        <div class="rb-scroll" id="rbScroll">
                            <div class="rb-cards" id="rbCards"></div>
                            <div class="rb-no-match" id="rbNoMatch">没有匹配的卡片，换个关键词或筛选试试</div>
                        </div>
                        <footer class="rb-foot">
                            <span id="rbFootKey">VIEW: --</span>
                            <span id="rbFootCount">-- / -- SHOWN</span>
                        </footer>
                    </div>
                </div>
            </aside>

            <div class="rb-toast" id="rbToast"></div>
        `;

        return wrap;
    };


    const appendFeedCardRollBackButton = (text = ROLL_BACK_BTN_TEXT) => {
        const feedRollBtn = document.querySelector(FEED_ROLL_BTN_SELECTOR);

        if (!feedRollBtn) {
            logger("未找到 feed-roll-btn");
            return;
        }

        const rollBackBtn = document.createElement("button");
        rollBackBtn.classList.add("primary-btn", "roll-btn", "roll-back-btn");
        rollBackBtn.style.marginTop = "2px";
        rollBackBtn.style.marginLeft = "0";
        rollBackBtn.id = "roll-back-btn";
        rollBackBtn.textContent = text;

        feedRollBtn.append(rollBackBtn);
    };


    const loadCache = async () => {
        try {
            return await loadSnapshotFromIDB();
        } catch (e) {
            const errCss = [
                "padding: 3px 6px; border-radius: 3px; color: #fff; background: #ff0000; font-weight: bold;",
                ""
            ];
            logger("IndexedDB 缓存读取失败", [e?.name, e?.message], "error", errCss);
            return { snap: null, keys: [] };
        }
    };


    const cleanCache = async () => {
        logger("触发手动清空 IndexedDB 缓存!");
        try {
            await clearAllBatches();
        } catch (e) {
            logger("清空 IndexedDB 失败", [e?.name, e?.message], "error");
        }
    };


    const createKeyItemHTML = (k, o) => {
        const keyId = k === ALL ? esc(o.id) : (decodeTimeKey(esc(o.id)) || esc(o.id));
        return `
            <article
                class="rb-key ${o.active ? "active" : ""} ${k === ALL ? "all" : ""}"
                data-key="${esc(k)}"
            >
                <span class="rb-key-idx">${esc(o.idx)}</span>
                <span class="rb-key-id">${keyId}</span>
                <span class="rb-key-prev">${esc(o.prev)}</span>
                <span class="rb-key-stats">
                    <span class="st-v ${o.nv ? "" : "dim"}">${o.nv} 视频</span>
                    <span class="st-a ${o.na ? "" : "dim"}">${o.na} 推广</span>
                </span>
            </article>
        `;
    };


    const createCardHTML = (item, idx, showSrc) => {
        const isAd = item.type === "ad";
        const link = https(item.l);
        const rbCover = `
            <a class="rb-cover" href="${link}" target="_blank" rel="noopener">
                <img src="${https(item.i)}" alt="${esc(item.t || "")}" loading="lazy" onerror="this.style.display='none'">
                <span class="rb-badge-tag ${isAd ? "rb-badge-ad" : "rb-badge-bv"}">${isAd ? "广告" : esc(item.v || "")}</span>
                ${showSrc ? `<span class="rb-src-tag" title="${esc(item.srcKey)}">${esc(item.srcKey)}</span>` : ""}
                <span class="rb-play">▶</span>
            </a>
        `;

        const rbMeta = isAd
            ? `<span class="rb-interest">🔥 ${esc(item.a || "")}</span><span class="rb-promo">推广</span>`
            : `<a class="rb-author" href="${https(item.s)}" target="_blank" rel="noopener">
                <span class="rb-avatar" style="background:${AVATAR_BG[idx % AVATAR_BG.length]}">${esc((item.a || "?")[0])}</span>${esc(item.a || "未知")}
                </a>
                <button class="rb-copy" data-bv="${esc(item.v || "")}" title="复制 BV 号">⧉ BV</button>`;

        const rbBody = `
            <div class="rb-body">
            <h3 class="rb-title"><a href="${link}" target="_blank" rel="noopener">${esc(item.t || "无标题")}</a></h3>
            <div class="rb-meta">
                ${rbMeta}
            </div>
        `;

        return `
            <article
                class="rb-card ${isAd ? "is-ad" : ""}"
                style="--d:${Math.min(idx, 8) * 40}ms"
                data-type="${item.type}"
                data-text="${esc(((item.t || "") + " " + (item.a || "")).toLowerCase())}"
            >
                ${rbCover}
                ${rbBody}
                </div>
            </article>
        `;
    };


    const createShadowRoot = () => {
        const shadow = createShadowDom();
        const wrap = createShadowWrap();
        shadow.appendChild(wrap);

        const $ = id => shadow.getElementById(id);
        const overlay = $("rbOverlay");
        const panel = $("rbPanel");
        const cardsEl = $("rbCards");
        const searchEl = $("rbSearch");
        const tabsEl = $("rbTabs");
        const toastEl = $("rbToast");
        const keylistEl = $("rbKeylist");
        const sideNEl = $("rbSideN");
        const scrollEl = $("rbScroll");
        const noMatchEl = $("rbNoMatch");
        const cleanEl = $("rbClean");

        let SNAP = null, KEYS = [], currentKey = ALL, currentFilter = "all", feedCache = [];

        const videosOf = k => (SNAP.data?.[k] || []).map(v => ({ ...v, type: "video", srcKey: k }));
        const adsOf = k => (SNAP.ad?.[k] || []).map(v => ({ ...v, type: "ad", srcKey: k }));
        const feedFor = k => [...videosOf(k), ...adsOf(k)];
        const currentFeed = () => currentKey === ALL ? KEYS.flatMap(feedFor) : feedFor(currentKey);

        const keyMeta = (k) => {
            const dv = SNAP.data?.[k] || [], da = SNAP.ad?.[k] || [];
            return { nv: dv.length, na: da.length, prev: (dv[0] && dv[0].t) || (da[0] && da[0].t) || "—" };
        };


        const renderSidebar = () => {
            const all = KEYS.flatMap(feedFor);
            let html = createKeyItemHTML(ALL, {
                idx: "✦", id: "全部随机卡缓存数据", prev: `合并 ${KEYS.length} 个键`,
                nv: all.filter(x => x.type === "video").length,
                na: all.filter(x => x.type === "ad").length,
                active: currentKey === ALL
            });
            KEYS.forEach((k, i) => {
                const m = keyMeta(k);
                html += createKeyItemHTML(k, { idx: String(i + 1).padStart(2, "0"), id: k, prev: m.prev, nv: m.nv, na: m.na, active: currentKey === k });
            });
            keylistEl.innerHTML = html;
            sideNEl.textContent = KEYS.length;
        };


        const applyFilter = () => {
            const kw = searchEl.value.trim().toLowerCase();
            let shown = 0;
            cardsEl.querySelectorAll(".rb-card").forEach(el => {
                const ok = (currentFilter === "all" || el.dataset.type === currentFilter) && (!kw || el.dataset.text.includes(kw));
                el.classList.toggle("hide", !ok);
                if (ok) shown++;
            });
            $("rbFootCount").textContent = `${shown} / ${feedCache.length} SHOWN`;
            noMatchEl.classList.toggle("show", feedCache.length > 0 && shown === 0);
        };


        const refresh = async () => {
            const r = await loadCache(); SNAP = r.snap; KEYS = r.keys;
            if (!SNAP) { SNAP = { data: {}, ad: {} }; KEYS = []; }
            if (currentKey !== ALL && !KEYS.includes(currentKey)) currentKey = ALL;
            renderSidebar();
            renderCards();
            const totalAll = KEYS.flatMap(feedFor).length;
            $("rbTitle").textContent = SNAP.time ? `随机卡缓存数据 · ${fmtDate(SNAP.time)}` : "随机卡缓存数据";
            $("rbMeta").textContent = `${KEYS.length} keys · ${totalAll} cards · IndexedDB`;
        };

        const renderCards = () => {
            const feed = currentFeed(); feedCache = feed;
            const showSrc = currentKey === ALL;
            const nAd = feed.filter(f => f.type === "ad").length, nVid = feed.length - nAd;

            tabsEl.querySelector("[data-f='all'] span").textContent = feed.length;
            tabsEl.querySelector("[data-f='video'] span").textContent = nVid;
            tabsEl.querySelector("[data-f='ad'] span").textContent = nAd;
            $("rbFootKey").textContent = currentKey === ALL ? "VIEW: ALL KEYS" : `KEY: ${currentKey}`;

            if (!feed.length) {
                cardsEl.innerHTML = KEYS.length === 0
                    ? `<div class="rb-empty">IndexedDB 中还没有缓存数据，请先点击「换一换」按钮随机一些卡片再来查看！</div>`
                    : `<div class="rb-empty">这个 Key 下没有卡片数据</div>`;
            } else {
                cardsEl.innerHTML = feed.map((it, i) => createCardHTML(it, i, showSrc)).join("");
            }
            applyFilter();
        };


        const openPanel = async () => {
            await refresh();
            panel.classList.add("open");
            overlay.classList.add("show");
            document.body.style.overflow = "hidden";
            $("rbClose").focus();
        };


        const closePanel = () => {
            panel.classList.remove("open");
            overlay.classList.remove("show");
            document.body.style.overflow = "";
        };


        cleanEl.addEventListener("click", async () => {
            await cleanCache();
            await openPanel();
        });

        // $("rbOpen").addEventListener("click", openPanel);
        document.getElementById("roll-back-btn").addEventListener("click", openPanel);
        $("rbClose").addEventListener("click", closePanel);

        overlay.addEventListener("click", closePanel);
        document.addEventListener("keydown", e => { if (e.key === "Escape" && panel.classList.contains("open")) closePanel(); });

        keylistEl.addEventListener("click", e => {
            const el = e.target.closest(".rb-key"); if (!el) return;
            const k = el.dataset.key; if (k === currentKey) return;
            keylistEl.querySelector(".rb-key.active")?.classList.remove("active");
            el.classList.add("active");
            currentKey = k;
            scrollEl.scrollTop = 0;
            renderCards();
        });

        tabsEl.addEventListener("click", e => {
            const btn = e.target.closest(".rb-tab"); if (!btn) return;
            tabsEl.querySelector(".active").classList.remove("active");
            btn.classList.add("active"); currentFilter = btn.dataset.f; applyFilter();
        });
        searchEl.addEventListener("input", applyFilter);


        let toastTimer;
        const showToast = (msg, timeout = 1400) => {
            toastEl.textContent = msg;
            toastEl.classList.add("show");
            clearTimeout(toastTimer);
            toastTimer = setTimeout(() => toastEl.classList.remove("show"), timeout);
        }

        cardsEl.addEventListener("click", e => {
            const btn = e.target.closest(".rb-copy"); if (!btn) return;
            const bv = btn.dataset.bv;
            navigator.clipboard?.writeText(bv).then(() => showToast(`已复制 ${bv}`)).catch(() => showToast("复制失败"));
        });

        return shadow;
    };


    const init = () => {
        logger("正在初始化中...");
        injectStyle();
        findRollButton(ROLL_BTN_SELECTOR, async (isFound, savedEvent) => {
            try { await ensureReady(); } catch (e) { logger("ensureReady 失败", [e?.name, e?.message], "warn"); }
            if (!isFound) return;
            bindClickEvent(ROLL_BTN_SELECTOR, savedEvent);
            appendFeedCardRollBackButton();
            const shadowRoot = createShadowRoot();
            try {
                const cacheData = await loadCache();
                logger(`加载缓存数据 -> DB: ${DB_NAME} store: ${STORE} len: ${cacheData.keys.length}`);
            } catch (e) {
                logger("初始化读取缓存失败", [e?.name, e?.message], "warn");
            }
            logger("初始化完成!");
        });
    };


    const main = () => {
        init();
    };


    main();

})();
